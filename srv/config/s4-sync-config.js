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
 *
 * Recommended sync order for Suppliers:
 *  1. Suppliers       → inserts all BP records
 *  2. SuppliersVendor → enriches with vendor-specific fields (LIFNR, payment terms)
 */

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