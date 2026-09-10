/**
 * FuelSphere - S4 Sync Configuration
 *
 * Central config map for all S4 → HANA Cloud sync operations.
 * Each key matches the entityType parameter passed to syncFromS4HANA action.
 *
 * To add a new entity:
 *  1. Add a new entry below following the same structure
 *  2. Define apiPath, dbEntity, keyField and mapRow
 *  3. No changes needed in master-data-service.js
 *
 * Sync Schedule:
 *  - Countries     : On-demand (manual S4 Sync button)
 *  - Plants        : Daily
 *  - Suppliers     : On-demand via A_BusinessPartner (general BP data)
 *  - SuppliersVendor : On-demand via A_Supplier (vendor-specific enrichment)
 *  - Contracts     : On-demand (manual S4 Sync button)
 *
 * Recommended sync order for Suppliers:
 *  1. Suppliers       → inserts all BP records
 *  2. SuppliersVendor → enriches with vendor-specific fields (LIFNR, payment terms)
 *
 * ⚠️ Suppliers → Contracts ordering is REQUIRED, every time, not just once:
 *  Suppliers uses full-replace (DELETE ALL → reinsert), and MASTER_SUPPLIERS
 *  uses a generated UUID key. Every Suppliers sync therefore gives every
 *  supplier row a NEW UUID. MASTER_CONTRACTS.supplier is a managed
 *  association holding that UUID (supplier_ID), so any Suppliers sync run
 *  AFTER a Contracts sync silently orphans every contract's supplier link.
 *  Re-run Contracts sync immediately after any Suppliers sync to re-resolve
 *  the links — there is no code-level guard against this today.
 */

// Parses an OData V2 "/Date(1690848000000)/" literal (or an already-ISO
// value) down to a plain YYYY-MM-DD string for a CDS Date field.
function parseODataDate(value) {
    if (!value) return null;
    const m = /\/Date\((\d+)\)\//.exec(value);
    if (m) return new Date(Number(m[1])).toISOString().slice(0, 10);
    return String(value).slice(0, 10);
}

module.exports = {

    // ==========================================================================
    // COUNTRIES — API_COUNTRY_SRV
    // S4 EntitySet : A_Country
    // HANA Entity  : fuelsphere.T005_COUNTRY
    // ==========================================================================
    Countries: {
        apiPath  : `/sap/opu/odata/sap/API_COUNTRY_SRV/A_CountryText?$expand=to_Country&$filter=Language eq 'EN'`, // A_CountryText
        dbEntity : 'fuelsphere.T005_COUNTRY',
        keyField : 'land1',
        mapRow   : (s4) => ({
            land1    : s4.Country         || '',
            landx    : s4.CountryName     || '',
            landx50  : s4.CountryFullName || s4.CountryName || '',
            natio    : s4.NationalityName || '',
            landgr   : s4.CountryGroup    || '',
            currcode : s4.Currency        || s4.to_Country?.CountryCurrency || '',
            spras    : s4.Language        || '',
            // Compliance fields — not available in S4 API, set defaults
            // Manage these manually in the app after sync
            is_embargoed           : false,
            embargo_effective_date : null,
            embargo_reason         : null,
            sanction_programs      : null,
            risk_level             : 'LOW',
            is_active              : true
        })
    },

    // ==========================================================================
    // PLANTS — ZAPI_PLANT_SRV (custom S4 API)
    // S4 EntitySet : A_Plant
    // HANA Entity  : fuelsphere.T001W_PLANT
    //
    // Note: land1 is an Association to T005_COUNTRY in HANA schema.
    //       CAP resolves the association via FK value automatically —
    //       store the country key string and CAP handles the join.
    //       Ensure Countries are synced BEFORE Plants so the FK resolves.
    // ==========================================================================
    Plants: {
        apiPath  : '/sap/opu/odata/sap/API_PLANT_SRV/A_Plant',
        dbEntity : 'fuelsphere.T001W_PLANT',
        keyField : 'werks',
        mapRow   : (s4) => ({
            werks     : s4.Plant      || '',
            name1     : s4.PlantName  || '',
            stras     : s4.StreetName || '',
            ort01     : s4.CityName   || '',
            land1     : s4.Country    || '',   // FK → T005_COUNTRY.land1
            regio     : s4.Region     || '',
            pstlz     : s4.PostalCode || '',
            spras     : s4.Language   || '',
            is_active : true
        })
    },

    // ==========================================================================
    // SUPPLIERS — API_BUSINESS_PARTNER / A_BusinessPartner
    // S4 EntitySet : A_BusinessPartner
    // HANA Entity  : fuelsphere.MASTER_SUPPLIERS
    //
    // Fetches general Business Partner data (name, country, category).
    // BP Category 2 = Organization — covers all supplier BPs.
    // Run this FIRST before SuppliersVendor.
    // ==========================================================================
    Suppliers: {
        apiPath  : '/sap/opu/odata/sap/API_BUSINESS_PARTNER/A_BusinessPartner' +
                   '?$filter=BusinessPartnerCategory eq \'2\'',  // Organizations only
        dbEntity : 'fuelsphere.MASTER_SUPPLIERS',
        keyField : 'supplier_code',
        mapRow   : (s4) => ({
            supplier_code : s4.BusinessPartner         || '',
            supplier_name : s4.BusinessPartnerFullName || s4.OrganizationBPName1 || '',
            supplier_type : 'EXTERNAL',                          // default for BP records
            country_code  : s4.NameCountry             || '',   // FK → T005_COUNTRY.land1
            payment_terms : s4.PaymentTerms            || '',
            s4_vendor_no  : s4.BusinessPartner         || '',   // BP number as vendor reference
            is_active     : true
        })
    },

    // ==========================================================================
    // CONTRACTS — API_PURCHASECONTRACT_PROCESS_SRV
    // S4 EntitySet : A_PurchaseContract
    // HANA Entity  : fuelsphere.MASTER_CONTRACTS
    //
    // apiPath / field names verified against live $metadata on 2026-09-03
    // (dgits4h20hyd gateway) — entity set and every field below confirmed
    // to exist. No header-level description field exists anywhere in this
    // service (checked full $metadata): the only text field is item-level
    // PurchaseContractItemType.PurchaseContractItemText ("Short Text"),
    // reached via to_PurchaseContractItem — not used here since a contract
    // can have many items and no single one is "the" name. contract_name
    // intentionally falls back to the contract number.
    //
    // Note: supplier is a MANAGED association (MASTER_CONTRACTS.supplier ->
    //       MASTER_SUPPLIERS), unlike land1/currency_code elsewhere in this
    //       file which are unmanaged (matched by business key). CAP needs
    //       the actual supplier row's UUID (supplier_ID), so resolveRefs
    //       pre-fetches a s4_vendor_no -> ID lookup once before mapping.
    //       Sync Suppliers BEFORE Contracts or this lookup will come up
    //       empty and the row will be skipped with a mapping error.
    //
    // contract_type / price_type are FuelSphere-native classifications
    // (SPOT/TERM/FRAMEWORK, CPE/FIXED/NATIVE) with no S4 equivalent — real
    // PurchaseContractType values seen (WK/MK/ZDOC) don't map cleanly, so
    // these are defaulted here, same as Countries' compliance fields;
    // manage them manually in the app after sync if the defaults don't fit.
    // ==========================================================================
    Contracts: {
        apiPath  : `/sap/opu/odata/sap/API_PURCHASECONTRACT_PROCESS_SRV/A_PurchaseContract` +
                   `?$filter=PurchasingDocumentDeletionCode eq ''`,
        dbEntity : 'fuelsphere.MASTER_CONTRACTS',
        keyField : 'contract_number',

        resolveRefs: async () => {
            const suppliers = await SELECT.from('fuelsphere.MASTER_SUPPLIERS').columns('ID', 's4_vendor_no');
            const bySupplierNo = {};
            suppliers.forEach(s => { if (s.s4_vendor_no) bySupplierNo[s.s4_vendor_no] = s.ID; });
            return { bySupplierNo };
        },

        mapRow: (s4, refs) => {
            const supplierId = refs.bySupplierNo[s4.Supplier];
            if (!supplierId) {
                throw new Error(`No MASTER_SUPPLIERS record for S4 vendor "${s4.Supplier}" — sync Suppliers first`);
            }
            return {
                contract_number    : s4.PurchaseContract || '',
                contract_name      : s4.PurchaseContract || '',  // no header description field exists in this API
                supplier_ID        : supplierId,
                valid_from         : parseODataDate(s4.ValidityStartDate),
                valid_to           : parseODataDate(s4.ValidityEndDate),
                contract_type      : 'TERM',   // FuelSphere-native — no S4 equivalent, verify default fits
                price_type         : 'FIXED',  // FuelSphere-native — no S4 equivalent, verify default fits
                currency_code      : s4.DocumentCurrency || '',
                payment_terms      : s4.PaymentTerms || '',
                incoterms          : s4.IncotermsClassification || '',
                min_volume_kg      : null,
                max_volume_kg      : null,
                s4_contract_number : s4.PurchaseContract || '',
                is_active          : true
            };
        }
    },

    // ==========================================================================
    // SUPPLIERS VENDOR ENRICHMENT — API_BUSINESS_PARTNER / A_Supplier
    // S4 EntitySet : A_Supplier
    // HANA Entity  : fuelsphere.MASTER_SUPPLIERS
    //
    // Fetches vendor-specific data (LIFNR, payment terms, blocked status).
    // Run this AFTER Suppliers sync to enrich existing records.
    //
    // ⚠️  WARNING: Full replace strategy will DELETE all supplier records first.
    //     Always run 'Suppliers' sync immediately before 'SuppliersVendor'
    //     in the same session, or switch this to an UPSERT strategy.
    // ==========================================================================
    // SuppliersVendor: {
    //     apiPath  : '/sap/opu/odata/sap/API_BUSINESS_PARTNER/A_Supplier',
    //     dbEntity : 'fuelsphere.MASTER_SUPPLIERS',
    //     keyField : 'supplier_code',
    //     mapRow   : (s4) => ({
    //         supplier_code : s4.Supplier      || '',
    //         supplier_name : s4.SupplierName  || '',
    //         supplier_type : 'EXTERNAL',
    //         country_code  : s4.Country       || '',
    //         payment_terms : s4.PaymentTerms  || '',
    //         s4_vendor_no  : s4.Supplier      || '',   // LIFNR
    //         is_active     : s4.IsBlocked === false     // active if vendor NOT blocked in S4
    //     })
    // },

    // ==========================================================================
    // CURRENCIES — API_CURRENCY_SRV  [PENDING]
    // ==========================================================================
    // Currencies: {
    //     apiPath  : '/sap/opu/odata/sap/API_CURRENCY_SRV/A_Currency',
    //     dbEntity : 'fuelsphere.CURRENCY_MASTER',
    //     keyField : 'waers',
    //     mapRow   : (s4) => ({
    //         waers : s4.Currency     || '',
    //         ltext : s4.CurrencyName || '',
    //         // add remaining field mappings here
    //     })
    // },

    // ==========================================================================
    // UNITS OF MEASURE — API_UNITOFMEASURE_SRV  [PENDING]
    // ==========================================================================
    // UnitsOfMeasure: {
    //     apiPath  : '/sap/opu/odata/sap/API_UNITOFMEASURE_SRV/A_UnitOfMeasure',
    //     dbEntity : 'fuelsphere.UNIT_OF_MEASURE',
    //     keyField : 'msehi',
    //     mapRow   : (s4) => ({
    //         msehi : s4.UnitOfMeasure         || '',
    //         msehl : s4.UnitOfMeasureLongName || '',
    //         // add remaining field mappings here
    //     })
    // },

};