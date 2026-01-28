/**
 * FuelSphere - Pricing Service Fiori Annotations
 * Based on FDD-10: Native Pricing Engine
 *
 * Screens:
 * - PRC-001: Market Indices List
 * - PRC-002: Pricing Formulas List
 * - PRC-003: Formula Detail (Object Page)
 * - PRC-004: Derived Prices List
 * - PRC-005: Price Simulation
 */

using PricingService from './pricing-service';

// =============================================================================
// MARKET INDICES - List Report + Object Page
// =============================================================================

annotate PricingService.MarketIndices with @(
    Capabilities: {
        InsertRestrictions: { Insertable: true },
        UpdateRestrictions: { Updatable: true },
        DeleteRestrictions: { Deletable: false }
    }
);

annotate PricingService.MarketIndices with @(
    UI: {
        HeaderInfo: {
            TypeName       : 'Market Index',
            TypeNamePlural : 'Market Indices',
            Title          : { Value: index_name },
            Description    : { Value: index_code },
            ImageUrl       : 'sap-icon://line-chart'
        },

        SelectionFields: [
            index_code,
            provider,
            currency_ID,
            is_active
        ],

        LineItem: [
            { Value: index_code, Label: 'Index Code', ![@UI.Importance]: #High },
            { Value: index_name, Label: 'Index Name', ![@UI.Importance]: #High },
            { Value: provider, Label: 'Provider', ![@UI.Importance]: #High },
            { Value: currency_ID, Label: 'Currency', ![@UI.Importance]: #Medium },
            { Value: uom_ID, Label: 'UoM', ![@UI.Importance]: #Medium },
            { Value: index_type, Label: 'Index Type', ![@UI.Importance]: #Medium },
            { Value: region, Label: 'Region', ![@UI.Importance]: #Medium },
            {
                Value: is_active,
                Label: 'Status',
                Criticality: activeCriticality,
                ![@UI.Importance]: #High
            }
        ],

        PresentationVariant: {
            SortOrder: [
                { Property: index_name, Descending: false }
            ],
            Visualizations: [ '@UI.LineItem' ]
        },

        HeaderFacets: [
            {
                $Type  : 'UI.ReferenceFacet',
                Target : '@UI.FieldGroup#IndexStatus',
                Label  : 'Status'
            },
            {
                $Type  : 'UI.ReferenceFacet',
                Target : '@UI.FieldGroup#LatestValue',
                Label  : 'Latest Value'
            }
        ],

        FieldGroup#IndexStatus: {
            Data: [
                { Value: is_active, Label: 'Active', Criticality: activeCriticality },
                { Value: import_enabled, Label: 'Import Enabled' }
            ]
        },

        FieldGroup#LatestValue: {
            Data: [
                { Value: frequency, Label: 'Frequency' },
                { Value: publication_time, Label: 'Publication Time' }
            ]
        },

        Facets: [
            {
                $Type  : 'UI.ReferenceFacet',
                ID     : 'GeneralInfo',
                Label  : 'General Information',
                Target : '@UI.FieldGroup#IndexGeneral'
            },
            {
                $Type  : 'UI.ReferenceFacet',
                ID     : 'DataSource',
                Label  : 'Data Source',
                Target : '@UI.FieldGroup#DataSource'
            },
            {
                $Type  : 'UI.ReferenceFacet',
                ID     : 'IndexValues',
                Label  : 'Historical Values',
                Target : 'values/@UI.LineItem'
            },
            {
                $Type  : 'UI.ReferenceFacet',
                ID     : 'Administrative',
                Label  : 'Administrative',
                Target : '@UI.FieldGroup#IndexAdmin'
            }
        ],

        FieldGroup#IndexGeneral: {
            Label: 'General Information',
            Data: [
                { Value: index_code, Label: 'Index Code' },
                { Value: index_name, Label: 'Index Name' },
                { Value: index_description, Label: 'Description' },
                { Value: index_type, Label: 'Index Type' },
                { Value: product_type, Label: 'Product Type' },
                { Value: region, Label: 'Region' },
                { Value: currency_ID, Label: 'Currency' },
                { Value: uom_ID, Label: 'Unit of Measure' },
                { Value: is_active, Label: 'Active' }
            ]
        },

        FieldGroup#DataSource: {
            Label: 'Data Source',
            Data: [
                { Value: provider, Label: 'Provider' },
                { Value: provider_reference, Label: 'Provider Reference' },
                { Value: frequency, Label: 'Frequency' },
                { Value: publication_time, Label: 'Publication Time' },
                { Value: timezone, Label: 'Timezone' },
                { Value: import_source, Label: 'Import Source' },
                { Value: import_format, Label: 'Import Format' },
                { Value: import_enabled, Label: 'Import Enabled' }
            ]
        },

        FieldGroup#IndexAdmin: {
            Label: 'Administrative',
            Data: [
                { Value: created_at, Label: 'Created At' },
                { Value: created_by, Label: 'Created By' },
                { Value: modified_at, Label: 'Modified At' },
                { Value: modified_by, Label: 'Modified By' }
            ]
        }
    }
);

// =============================================================================
// MARKET INDEX VALUES - Historical data
// =============================================================================

annotate PricingService.MarketIndexValues with @(
    UI: {
        HeaderInfo: {
            TypeName       : 'Index Value',
            TypeNamePlural : 'Index Values',
            Title          : { Value: effective_date }
        },

        LineItem: [
            { Value: effective_date, Label: 'Date', ![@UI.Importance]: #High },
            { Value: index_value, Label: 'Value', ![@UI.Importance]: #High },
            { Value: previous_value, Label: 'Previous', ![@UI.Importance]: #Medium },
            { Value: daily_change, Label: 'Change', ![@UI.Importance]: #Medium },
            { Value: daily_change_pct, Label: 'Change %', ![@UI.Importance]: #Medium },
            { Value: verification_status, Label: 'Verification', ![@UI.Importance]: #Medium },
            { Value: import_source, Label: 'Source', ![@UI.Importance]: #Low }
        ]
    }
);

// =============================================================================
// PRICING FORMULAS - List Report + Object Page
// =============================================================================

annotate PricingService.PricingFormulas with @(
    Capabilities: {
        InsertRestrictions: { Insertable: true },
        UpdateRestrictions: { Updatable: true },
        DeleteRestrictions: { Deletable: false }
    }
);

annotate PricingService.PricingFormulas with @(
    UI: {
        HeaderInfo: {
            TypeName       : 'Pricing Formula',
            TypeNamePlural : 'Pricing Formulas',
            Title          : { Value: formula_name },
            Description    : { Value: formula_code },
            ImageUrl       : 'sap-icon://simulate'
        },

        SelectionFields: [
            formula_id,
            formula_type,
            company_code,
            status
        ],

        LineItem: [
            { Value: formula_id, Label: 'Formula Code', ![@UI.Importance]: #High },
            { Value: formula_name, Label: 'Formula Name', ![@UI.Importance]: #High },
            { Value: formula_type, Label: 'Type', ![@UI.Importance]: #Medium },
            { Value: base_index_type, Label: 'Base Index Type', ![@UI.Importance]: #Medium },
            { Value: company_code, Label: 'Company Code', ![@UI.Importance]: #Medium },
            { Value: valid_from, Label: 'Valid From', ![@UI.Importance]: #Medium },
            { Value: valid_to, Label: 'Valid To', ![@UI.Importance]: #Medium },
            {
                Value: status,
                Label: 'Status',
                Criticality: statusCriticality,
                ![@UI.Importance]: #High
            }
        ],

        PresentationVariant: {
            SortOrder: [
                { Property: formula_name, Descending: false }
            ],
            Visualizations: [ '@UI.LineItem' ]
        },

        HeaderFacets: [
            {
                $Type  : 'UI.ReferenceFacet',
                Target : '@UI.FieldGroup#FormulaStatus',
                Label  : 'Status'
            },
            {
                $Type  : 'UI.ReferenceFacet',
                Target : '@UI.FieldGroup#FormulaValidity',
                Label  : 'Validity'
            }
        ],

        FieldGroup#FormulaStatus: {
            Data: [
                { Value: status, Label: 'Status', Criticality: statusCriticality }
            ]
        },

        FieldGroup#FormulaValidity: {
            Data: [
                { Value: valid_from, Label: 'From' },
                { Value: valid_to, Label: 'To' }
            ]
        },

        Facets: [
            {
                $Type  : 'UI.ReferenceFacet',
                ID     : 'GeneralInfo',
                Label  : 'General Information',
                Target : '@UI.FieldGroup#FormulaGeneral'
            },
            {
                $Type  : 'UI.ReferenceFacet',
                ID     : 'Scope',
                Label  : 'Scope',
                Target : '@UI.FieldGroup#FormulaScope'
            },
            {
                $Type  : 'UI.ReferenceFacet',
                ID     : 'Components',
                Label  : 'Formula Components',
                Target : 'components/@UI.LineItem'
            },
            {
                $Type  : 'UI.ReferenceFacet',
                ID     : 'Approval',
                Label  : 'Approval Workflow',
                Target : '@UI.FieldGroup#FormulaApproval'
            },
            {
                $Type  : 'UI.ReferenceFacet',
                ID     : 'Administrative',
                Label  : 'Administrative',
                Target : '@UI.FieldGroup#FormulaAdmin'
            }
        ],

        FieldGroup#FormulaGeneral: {
            Label: 'General Information',
            Data: [
                { Value: formula_id, Label: 'Formula Code' },
                { Value: formula_name, Label: 'Formula Name' },
                { Value: formula_description, Label: 'Description' },
                { Value: formula_type, Label: 'Formula Type' },
                { Value: base_index_type, Label: 'Base Index Type' },
                { Value: valid_from, Label: 'Valid From' },
                { Value: valid_to, Label: 'Valid To' },
                { Value: version, Label: 'Version' },
                { Value: status, Label: 'Status' }
            ]
        },

        FieldGroup#FormulaScope: {
            Label: 'Scope',
            Data: [
                { Value: company_code, Label: 'Company Code' },
                { Value: currency_ID, Label: 'Currency' },
                { Value: uom_ID, Label: 'Unit of Measure' },
                { Value: requires_approval, Label: 'Requires Approval' },
                { Value: approval_threshold, Label: 'Approval Threshold' }
            ]
        },

        FieldGroup#FormulaApproval: {
            Label: 'Approval Workflow',
            Data: [
                { Value: requested_by, Label: 'Requested By' },
                { Value: requested_at, Label: 'Requested At' },
                { Value: approved_by, Label: 'Approved By' },
                { Value: approved_at, Label: 'Approved At' },
                { Value: second_approver, Label: 'Second Approver' },
                { Value: second_approved_at, Label: 'Second Approved At' },
                { Value: rejection_reason, Label: 'Rejection Reason' },
                { Value: status_changed_by, Label: 'Status Changed By' },
                { Value: status_changed_at, Label: 'Status Changed At' }
            ]
        },

        FieldGroup#FormulaAdmin: {
            Label: 'Administrative',
            Data: [
                { Value: created_at, Label: 'Created At' },
                { Value: created_by, Label: 'Created By' },
                { Value: modified_at, Label: 'Modified At' },
                { Value: modified_by, Label: 'Modified By' }
            ]
        }
    }
);

// =============================================================================
// FORMULA COMPONENTS - Line Items
// =============================================================================

annotate PricingService.FormulaComponents with @(
    UI: {
        HeaderInfo: {
            TypeName       : 'Component',
            TypeNamePlural : 'Components',
            Title          : { Value: component_name }
        },

        LineItem: [
            { Value: sequence, Label: 'Seq', ![@UI.Importance]: #High },
            { Value: component_type, Label: 'Type', ![@UI.Importance]: #High },
            { Value: component_name, Label: 'Name', ![@UI.Importance]: #High },
            { Value: calculation_type, Label: 'Calculation', ![@UI.Importance]: #Medium },
            { Value: fixed_value, Label: 'Fixed Value', ![@UI.Importance]: #Medium },
            { Value: percentage_value, Label: 'Percentage', ![@UI.Importance]: #Medium },
            { Value: apply_to, Label: 'Apply To', ![@UI.Importance]: #Low },
            { Value: is_active, Label: 'Active', ![@UI.Importance]: #Low }
        ],

        Facets: [
            {
                $Type  : 'UI.ReferenceFacet',
                ID     : 'ComponentDetails',
                Label  : 'Component Details',
                Target : '@UI.FieldGroup#ComponentDetails'
            }
        ],

        FieldGroup#ComponentDetails: {
            Data: [
                { Value: sequence, Label: 'Sequence' },
                { Value: component_type, Label: 'Component Type' },
                { Value: component_name, Label: 'Component Name' },
                { Value: component_description, Label: 'Description' },
                { Value: calculation_type, Label: 'Calculation Type' },
                { Value: lookup_index.index_name, Label: 'Market Index' },
                { Value: index_offset_days, Label: 'Index Offset Days' },
                { Value: use_average, Label: 'Use Average' },
                { Value: average_days, Label: 'Average Days' },
                { Value: fixed_value, Label: 'Fixed Value' },
                { Value: percentage_value, Label: 'Percentage' },
                { Value: min_value, Label: 'Minimum Value' },
                { Value: max_value, Label: 'Maximum Value' },
                { Value: apply_to, Label: 'Apply To' },
                { Value: is_active, Label: 'Active' }
            ]
        }
    }
);

// =============================================================================
// DERIVED PRICES - Calculated Prices
// =============================================================================

annotate PricingService.DerivedPrices with @(
    Capabilities: {
        InsertRestrictions: { Insertable: false },
        UpdateRestrictions: { Updatable: false },
        DeleteRestrictions: { Deletable: false }
    }
);

annotate PricingService.DerivedPrices with @(
    UI: {
        HeaderInfo: {
            TypeName       : 'Derived Price',
            TypeNamePlural : 'Derived Prices',
            Title          : { Value: contract_number },
            Description    : { Value: price_date }
        },

        SelectionFields: [
            contract_ID,
            price_date,
            pricing_engine,
            variance_flag
        ],

        LineItem: [
            { Value: price_date, Label: 'Price Date', ![@UI.Importance]: #High },
            { Value: contract_number, Label: 'Contract', ![@UI.Importance]: #High },
            { Value: formula.formula_name, Label: 'Formula', ![@UI.Importance]: #Medium },
            { Value: base_index_value, Label: 'Index Value', ![@UI.Importance]: #Medium },
            { Value: derived_price, Label: 'Derived Price', ![@UI.Importance]: #High },
            { Value: pricing_engine, Label: 'Engine', ![@UI.Importance]: #Medium },
            { Value: cpe_price, Label: 'CPE Price', ![@UI.Importance]: #Low },
            { Value: price_variance, Label: 'Variance', ![@UI.Importance]: #Low },
            { Value: variance_flag, Label: 'Flag', ![@UI.Importance]: #Low }
        ],

        PresentationVariant: {
            SortOrder: [
                { Property: price_date, Descending: true }
            ],
            Visualizations: [ '@UI.LineItem' ]
        },

        Facets: [
            {
                $Type  : 'UI.ReferenceFacet',
                ID     : 'PriceDetails',
                Label  : 'Price Details',
                Target : '@UI.FieldGroup#PriceDetails'
            },
            {
                $Type  : 'UI.ReferenceFacet',
                ID     : 'IndexDetails',
                Label  : 'Index Details',
                Target : '@UI.FieldGroup#IndexDetails'
            },
            {
                $Type  : 'UI.ReferenceFacet',
                ID     : 'Comparison',
                Label  : 'CPE Comparison',
                Target : '@UI.FieldGroup#CPEComparison'
            }
        ],

        FieldGroup#PriceDetails: {
            Data: [
                { Value: price_date, Label: 'Price Date' },
                { Value: contract_number, Label: 'Contract Number' },
                { Value: contract.contract_name, Label: 'Contract Name' },
                { Value: formula.formula_name, Label: 'Formula' },
                { Value: formula_version, Label: 'Formula Version' },
                { Value: derived_price, Label: 'Derived Price' },
                { Value: pricing_engine, Label: 'Pricing Engine' },
                { Value: valid_from, Label: 'Valid From' },
                { Value: valid_to, Label: 'Valid To' },
                { Value: is_current, Label: 'Is Current' }
            ]
        },

        FieldGroup#IndexDetails: {
            Data: [
                { Value: base_index.index_name, Label: 'Base Index' },
                { Value: base_index_value, Label: 'Base Index Value' },
                { Value: base_index_date, Label: 'Base Index Date' },
                { Value: calculated_at, Label: 'Calculated At' },
                { Value: calculation_duration_ms, Label: 'Calculation Duration (ms)' }
            ]
        },

        FieldGroup#CPEComparison: {
            Data: [
                { Value: cpe_price, Label: 'CPE Price' },
                { Value: price_variance, Label: 'Price Variance' },
                { Value: variance_pct, Label: 'Variance %' },
                { Value: variance_flag, Label: 'Variance Flag' }
            ]
        }
    }
);

// =============================================================================
// PRICE SIMULATIONS
// =============================================================================

annotate PricingService.PriceSimulations with @(
    Capabilities: {
        InsertRestrictions: { Insertable: true },
        UpdateRestrictions: { Updatable: true },
        DeleteRestrictions: { Deletable: true }
    }
);

annotate PricingService.PriceSimulations with @(
    UI: {
        HeaderInfo: {
            TypeName       : 'Simulation',
            TypeNamePlural : 'Simulations',
            Title          : { Value: simulation_name },
            Description    : { Value: simulation_date },
            ImageUrl       : 'sap-icon://simulate'
        },

        SelectionFields: [
            simulation_date,
            formula_ID,
            contract_ID
        ],

        LineItem: [
            { Value: simulation_id, Label: 'Simulation ID', ![@UI.Importance]: #High },
            { Value: simulation_name, Label: 'Simulation Name', ![@UI.Importance]: #High },
            { Value: simulation_date, Label: 'Date', ![@UI.Importance]: #High },
            { Value: formula.formula_name, Label: 'Formula', ![@UI.Importance]: #High },
            { Value: current_price, Label: 'Current Price', ![@UI.Importance]: #Medium },
            { Value: simulated_price, Label: 'Simulated Price', ![@UI.Importance]: #High },
            { Value: price_difference, Label: 'Difference', ![@UI.Importance]: #Medium },
            { Value: difference_pct, Label: 'Difference %', ![@UI.Importance]: #Medium }
        ],

        Facets: [
            {
                $Type  : 'UI.ReferenceFacet',
                ID     : 'SimulationDetails',
                Label  : 'Simulation Details',
                Target : '@UI.FieldGroup#SimulationDetails'
            },
            {
                $Type  : 'UI.ReferenceFacet',
                ID     : 'Results',
                Label  : 'Results',
                Target : '@UI.FieldGroup#SimulationResults'
            }
        ],

        FieldGroup#SimulationDetails: {
            Data: [
                { Value: simulation_id, Label: 'Simulation ID' },
                { Value: simulation_name, Label: 'Simulation Name' },
                { Value: simulation_notes, Label: 'Notes' },
                { Value: simulation_date, Label: 'Simulation Date' },
                { Value: contract.contract_name, Label: 'Contract' },
                { Value: formula.formula_name, Label: 'Formula' }
            ]
        },

        FieldGroup#SimulationResults: {
            Data: [
                { Value: current_price, Label: 'Current Price' },
                { Value: simulated_price, Label: 'Simulated Price' },
                { Value: price_difference, Label: 'Price Difference' },
                { Value: difference_pct, Label: 'Difference %' },
                { Value: simulated_at, Label: 'Simulated At' },
                { Value: simulated_by, Label: 'Simulated By' }
            ]
        }
    }
);

// Field-level annotations for PricingFormulas
annotate PricingService.PricingFormulas with {
    ID                   @UI.Hidden;
    formula_id           @title: 'Formula Code' @mandatory;
    formula_name         @title: 'Formula Name' @mandatory;
    formula_description  @title: 'Description' @UI.MultiLineText;
    formula_type         @title: 'Formula Type' @mandatory;
    base_index_type      @title: 'Base Index Type';
    currency_ID          @title: 'Currency' @mandatory;
    uom_ID               @title: 'Unit of Measure' @mandatory;
    valid_from           @title: 'Valid From' @mandatory;
    valid_to             @title: 'Valid To';
    version              @title: 'Version';
    status               @title: 'Status';
    company_code         @title: 'Company Code';
    requires_approval    @title: 'Requires Approval';
    approval_threshold   @title: 'Approval Threshold';
    requested_by         @title: 'Requested By';
    requested_at         @title: 'Requested At';
    approved_by          @title: 'Approved By';
    approved_at          @title: 'Approved At';
    second_approver      @title: 'Second Approver';
    second_approved_at   @title: 'Second Approved At';
    rejection_reason     @title: 'Rejection Reason' @UI.MultiLineText;
    created_at           @title: 'Created At' @Common.FieldControl: #ReadOnly;
    created_by           @title: 'Created By' @Common.FieldControl: #ReadOnly;
    modified_at          @title: 'Modified At' @Common.FieldControl: #ReadOnly;
    modified_by          @title: 'Modified By' @Common.FieldControl: #ReadOnly;
};

// Field-level annotations for MarketIndices
annotate PricingService.MarketIndices with {
    ID                   @UI.Hidden;
    index_code           @title: 'Index Code' @mandatory;
    index_name           @title: 'Index Name' @mandatory;
    index_description    @title: 'Description' @UI.MultiLineText;
    provider             @title: 'Provider' @mandatory;
    provider_reference   @title: 'Provider Reference';
    index_type           @title: 'Index Type' @mandatory;
    product_type         @title: 'Product Type';
    region               @title: 'Region';
    currency_ID          @title: 'Currency' @mandatory;
    uom_ID               @title: 'Unit of Measure' @mandatory;
    frequency            @title: 'Frequency';
    publication_time     @title: 'Publication Time';
    timezone             @title: 'Timezone';
    import_enabled       @title: 'Import Enabled';
    import_source        @title: 'Import Source';
    import_format        @title: 'Import Format';
    is_active            @title: 'Active';
    created_at           @title: 'Created At' @Common.FieldControl: #ReadOnly;
    created_by           @title: 'Created By' @Common.FieldControl: #ReadOnly;
    modified_at          @title: 'Modified At' @Common.FieldControl: #ReadOnly;
    modified_by          @title: 'Modified By' @Common.FieldControl: #ReadOnly;
};

// Field-level annotations for MarketIndexValues
annotate PricingService.MarketIndexValues with {
    ID                   @UI.Hidden;
    effective_date       @title: 'Effective Date' @mandatory;
    index_value          @title: 'Index Value' @mandatory;
    previous_value       @title: 'Previous Value';
    daily_change         @title: 'Daily Change';
    daily_change_pct     @title: 'Daily Change %';
    high_value           @title: 'High Value';
    low_value            @title: 'Low Value';
    average_value        @title: 'Average Value';
    import_source        @title: 'Import Source';
    verification_status  @title: 'Verification Status';
    verified_by          @title: 'Verified By';
    verified_at          @title: 'Verified At';
    is_estimated         @title: 'Is Estimated';
    is_holiday           @title: 'Is Holiday';
    is_corrected         @title: 'Is Corrected';
};
