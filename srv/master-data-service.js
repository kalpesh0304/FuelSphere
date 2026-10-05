/**
 * FuelSphere - Master Data Service Handler
 * Handles virtual elements for MasterDataService entities
 */

const cds = require('@sap/cds');
const LOG = cds.log('MasterDataService');
const S4_SYNC_CONFIG = require('./config/s4-sync-config');

module.exports = class MasterDataService extends cds.ApplicationService {
    async init() {
        const { Manufacturers, Aircraft, Airports, Routes, Suppliers, Products, Contracts } = this.entities;

        // Helper function to set activeCriticality based on is_active
        const setActiveCriticality = (data) => {
            const items = Array.isArray(data) ? data : [data];
            items.forEach(item => {
                if (item) {
                    // Criticality: 3=Positive (green), 1=Negative (red)
                    item.activeCriticality = item.is_active ? 3 : 1;
                }
            });
        };

        // Add virtual element calculation for all entities with is_active field
        this.after(['READ'], Manufacturers, setActiveCriticality);
        this.after(['READ'], Aircraft, setActiveCriticality);
        this.after(['READ'], Airports, setActiveCriticality);
        this.after(['READ'], Routes, setActiveCriticality);
        this.after(['READ'], Suppliers, setActiveCriticality);
        this.after(['READ'], Products, setActiveCriticality);
        this.after(['READ'], Contracts, setActiveCriticality);

        // ====================================================================
        // ACTIONS: S4_Sync
        // Thin wrapper — delegates to generic _syncFromS4 for Countries
        // Kept parameterless so Fiori button triggers without dialog popup
        this.on('S4_SyncCountries', async (req) => {
            return this._syncFromS4('Countries', req);
        });

        this.on('S4_SyncPlants', async (req) => {
            return this._syncFromS4('Plants', req);
        });
        
        this.on('S4_SyncSuppliers', async (req) => {
            return this._syncFromS4('Suppliers', req);
        });

        this.on('S4_SyncContracts', async (req) => {
            return this._syncFromS4('Contracts', req);
        });

        // ====================================================================
        // ACTION: syncFromS4HANA
        // Generic action — entityType param drives which entity to sync
        // Can be called programmatically or extended to other entities later
        // ====================================================================
        this.on('syncFromS4HANA', async (req) => {
            const { entityType } = req.data;

            if (!entityType) {
                return req.error(400, 'entityType parameter is required');
            }

            if (!S4_SYNC_CONFIG[entityType]) {
                return req.error(400, `Unsupported entityType: "${entityType}". Supported: ${Object.keys(S4_SYNC_CONFIG).join(', ')}`);
            }

            LOG.info(`syncFromS4HANA triggered for entityType: ${entityType}`);
            return this._syncFromS4(entityType, req);
        });

        this.before('CREATE', Aircraft.drafts, (req) => {
            if (!req.data.type_code) {
                req.error(500, `Please provide the Type Code to Proceed!`);
            }
        });

        this.before('CREATE', Routes.drafts, (req) => {
            if (!req.data.route_code) {
                req.error(500, `Please provide the Route Code to Proceed!`);
            }
        });

        this.before('CREATE', Manufacturers.drafts, (req) => {
            if (!req.data.manufacture_code) {
                req.error(500, `Please provide the Manufacturer Code to Proceed!`);
            }
        })

        await super.init();
    }

    // ==========================================================================
    // PRIVATE: _syncFromS4
    // Core sync logic — reused by both actions
    // Full replace strategy: DELETE all → batch INSERT from S4
    // ==========================================================================
    async _syncFromS4(entityType, req) {
        const syncTimestamp = new Date().toISOString();
        const errors = [];
        const config = S4_SYNC_CONFIG[entityType];

        try {
            // ------------------------------------------------------------------
            // STEP 1: Connect to S4 via BTP Destination S2A
            // ------------------------------------------------------------------
            LOG.info(`[${entityType}] Connecting to S4 via destination S2A...`);
            const s2a = await cds.connect.to('odata_api');

            // ------------------------------------------------------------------
            // STEP 2: Fetch data from S4 API
            // ------------------------------------------------------------------
            LOG.info(`[${entityType}] Fetching from S4: ${config.apiPath}`);
            console.log(`Connection to S4 via destination S2A successful and Fetching data from S4: ${config.apiPath}`);
            let s4Data = [];

            try {
                //const raw = await s2a.get(config.apiPath);
                const raw = await s2a.send({
                    method: 'GET',
                    path: config.apiPath
                });
                // const raw = await s2a.run(
                //     SELECT.from('S2A.CountryText')
                //         //.expand('to_Country')
                //     );
                // Unwrap OData v2 response wrapper if present
                if (Array.isArray(raw)) s4Data = raw;
                // S4 OData v2 returns { d: { results: [...] } }
                else if (raw?.d?.results && Array.isArray(raw.d.results)) s4Data = raw.d.results;
                else if (raw?.value && Array.isArray(raw.value))  s4Data = raw.value;  // OData v4 style
                else {
                   // throw new Error(`Unexpected S4 response format`);
                console.log('===== RAW S4 RESPONSE START =====');
                console.log(JSON.stringify(raw, null, 2));
                console.log('===== RAW S4 RESPONSE END =====');
                }
            } catch (fetchErr) {
                LOG.error(`[${entityType}] S4 fetch failed:`, fetchErr.message);
                return {
                    success     : false,
                    recordsSync : 0,
                    errors      : [fetchErr.message],
                    syncTime    : syncTimestamp
                };
            }

            const totalFetched = s4Data.length;
            LOG.info(`[${entityType}] Fetched ${totalFetched} records from S4`);

            // Guard: abort if S4 returns empty to avoid wiping HANA table
            if (totalFetched === 0) {
                return {
                    success     : false,
                    recordsSync : 0,
                    errors      : [`S4 returned 0 records for ${entityType} — sync aborted to prevent data loss`],
                    syncTime    : syncTimestamp
                };
            }

            // ------------------------------------------------------------------
            // STEP 2.5: Resolve references (e.g. FK lookups for managed
            // associations). Most entities key-match on a business key
            // (land1, werks, ...) so this is a no-op for them; entities with
            // a managed association (e.g. Contracts.supplier) need the
            // actual target UUID, resolved once here rather than per row.
            // ------------------------------------------------------------------
            const refs = typeof config.resolveRefs === 'function'
                ? await config.resolveRefs()
                : {};

            // ------------------------------------------------------------------
            // STEP 3: Map S4 fields → HANA entity fields
            // ------------------------------------------------------------------
            const mappedRows = s4Data.map((s4Row, idx) => {
                try {
                    return config.mapRow(s4Row, refs);
                } catch (mapErr) {
                    errors.push(`Row ${idx} mapping error: ${mapErr.message}`);
                    return null;
                }
            }).filter(Boolean);

            // if there is nothing mapped return and stop the deletion.
            if (mappedRows.length === 0) {
                return {
                    success     : false,
                    recordsSync : 0,
                    errors      : ['No valid rows after mapping — sync aborted'],
                    syncTime    : syncTimestamp
                };
            }
            // ------------------------------------------------------------------
            // STEP 4: MATCH ON THE BUSINESS KEY AND KEEP THE ROW'S IDENTITY.
            //
            // THIS WAS "DELETE all -> INSERT" AND IT DESTROYED THE LANDSCAPE ON
            // 2 Oct 2026. These tables carry a generated UUID, and every other
            // table points at that UUID: DESIGNATED_SUPPLIERS, MASTER_CONTRACTS,
            // FUEL_ORDERS, INVOICES, SUPPLIER_CONTACTS, STATION_SUPPLIER_MAP and
            // FLIGHT_SUPPLIER_MAP all store supplier_ID. mapRow does not set ID,
            // so the re-insert minted a NEW uuid for every row and every one of
            // those foreign keys was left pointing at a row that no longer
            // existed. One button press, and the supplier went blank on the
            // Flight Schedule, the fuel orders and the invoices at once, with
            // nothing on any screen to say why. Nothing errored: a dangling
            // managed association renders as empty, not as a failure.
            //
            // SO THE ROW'S IDENTITY IS NOW PRESERVED. S/4 is the authority on
            // what a supplier is CALLED; this system is the authority on which
            // row that supplier IS. The business key (config.keyField) joins the
            // two, which is what a key is for.
            //
            // AND NOTHING IS DELETED. A row S/4 no longer returns is REPORTED,
            // never removed - deleting it would break the same references by a
            // slower route, and a fuel ticket from March still has to name the
            // supplier that fuelled it even if that contract has since ended.
            // ------------------------------------------------------------------
            const dbEntity = cds.entities[config.dbEntity]
                          || cds.model.definitions[config.dbEntity];
            const keyField = config.keyField;
            if (!keyField) {
                return {
                    success     : false,
                    recordsSync : 0,
                    errors      : [`No keyField configured for ${entityType} - refusing to sync, `
                                 + 'because without a business key the only way to apply this data '
                                 + 'is to replace rows, and that breaks every reference to them.'],
                    syncTime    : syncTimestamp
                };
            }

            // 4a. What is already here, by business key.
            const existing = await SELECT.from(dbEntity).columns('ID', keyField);
            const idByKey = new Map(existing
                .filter(r => r[keyField] !== null && r[keyField] !== undefined)
                .map(r => [String(r[keyField]), r.ID]));
            LOG.info(`[${entityType}] ${existing.length} existing row(s), `
                   + `${idByKey.size} with a business key`);

            // 4b. Each S/4 row onto the row that already holds its key, or in
            //     as a new one. UPDATE rather than INSERT is the whole point:
            //     the ID stays, so every reference to it stays.
            let updated = 0, inserted = 0;
            const seen = new Set();
            for (const row of mappedRows) {
                const key = row[keyField] === null || row[keyField] === undefined
                    ? null : String(row[keyField]);
                if (!key) { errors.push(`A row arrived with no ${keyField} and was skipped`); continue; }
                seen.add(key);
                const id = idByKey.get(key);
                if (id) {
                    // The key identifies the row; it is not re-written.
                    const { [keyField]: _k, ID: _id, ...changes } = row;
                    await UPDATE(dbEntity).set(changes).where({ ID: id });
                    updated++;
                } else {
                    await INSERT.into(dbEntity).entries(row);
                    inserted++;
                }
            }

            // 4c. What S/4 did not return. Reported, not touched.
            const absent = [...idByKey.keys()].filter(k => !seen.has(k));
            if (absent.length) {
                LOG.info(`[${entityType}] ${absent.length} local row(s) not returned by S/4, left in place`);
                errors.push(`${absent.length} record(s) exist here but were not returned by S/4 and `
                          + `were left untouched (${keyField}: ${absent.slice(0, 10).join(', ')}`
                          + `${absent.length > 10 ? ', ...' : ''}). They are still referenced by `
                          + 'existing documents; deactivate them in the app if they are genuinely gone.');
            }
            LOG.info(`[${entityType}] ${updated} updated, ${inserted} inserted, ${absent.length} left alone`);

           const { cnt } = await cds.run(
            SELECT.one
                .from(dbEntity)
                .columns('count(*) as cnt')
            );

            LOG.info(`[${entityType}] DB COUNT AFTER SYNC = ${cnt}`);
            LOG.info(`[${entityType}] Sync complete. ${updated} updated, ${inserted} inserted.`);

            // ------------------------------------------------------------------
            // STEP 5: Return result — matches SyncResult type in .cds
            // ------------------------------------------------------------------
            return {
                success     : true,
                recordsSync : mappedRows.length,
                errors,
                syncTime    : syncTimestamp
            };

        } catch (err) {
            LOG.error(`[${entityType}] Sync failed:`, err.message);
            return req.error(500, `Sync failed for ${entityType}: ${err.message}`);
        }
    }
};
