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
        const draftEnabledEntities = [Manufacturers, Aircraft, Airports, Routes, Suppliers, Products, Contracts];
        for (const entity of draftEnabledEntities) {
            this.after(['READ'], entity, setActiveCriticality);
            this.after(['NEW'], entity, setActiveCriticality);
            this.after(['EDIT'], entity, setActiveCriticality);
            this.after(['PATCH'], entity, setActiveCriticality);
        }

        // Strip deep-update through non-composition associations between
        // separate draft-enabled entities. The Fiori UI sends PATCH with
        // association data via Common.Text annotations (e.g. manufacturer.manufacture_name),
        // but CAP cannot deep-update through these associations in draft mode.
        this.before(['UPDATE', 'PATCH', 'NEW'], Aircraft, (req) => {
            if (req.data.manufacturer) delete req.data.manufacturer;
        });
        this.before(['UPDATE', 'PATCH', 'NEW'], Routes, (req) => {
            if (req.data.origin) delete req.data.origin;
            if (req.data.destination) delete req.data.destination;
        });
        this.before(['UPDATE', 'PATCH', 'NEW'], Contracts, (req) => {
            if (req.data.supplier) delete req.data.supplier;
        });

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
            // STEP 3: Map S4 fields → HANA entity fields
            // ------------------------------------------------------------------
            const mappedRows = s4Data.map((s4Row, idx) => {
                try {
                    return config.mapRow(s4Row);
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
            // STEP 4: Full replace in HANA Cloud (inside DB transaction)
            // DELETE all → chunked INSERT
            // ------------------------------------------------------------------
            const dbEntity = cds.entities[config.dbEntity]
                          || cds.model.definitions[config.dbEntity];

            // await cds.tx(req, async (tx) => {

                // 4a. DELETE all existing records
                LOG.info(`[${entityType}] Deleting existing records...`);
                // await tx.run(DELETE.from(dbEntity));
                await DELETE.from(dbEntity);
                /***  4b. Batch INSERT — 200 rows per chunk to avoid DB limits **/
                const CHUNK_SIZE = 200;
                for (let i = 0; i < mappedRows.length; i += CHUNK_SIZE) {
                    const chunk = mappedRows.slice(i, i + CHUNK_SIZE);
                    // await tx.run(INSERT.into(dbEntity).entries(chunk));
                    await INSERT.into(dbEntity).entries(chunk);
                    LOG.info(`[${entityType}] Inserted ${Math.min(i + CHUNK_SIZE, mappedRows.length)}/${mappedRows.length}`);
                }
            // });

           const { cnt } = await cds.run(
            SELECT.one
                .from(dbEntity)
                .columns('count(*) as cnt')
            );

            LOG.info(`[${entityType}] DB COUNT AFTER SYNC = ${cnt}`);
            LOG.info(`[${entityType}] Sync complete. ${mappedRows.length} records inserted.`);

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
