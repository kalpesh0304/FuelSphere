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
            index_source,
            currency_code,
            is_active
        ],

        LineItem: [
            { Value: index_code, Label: 'Index Code', ![@UI.Importance]: #High },
            { Value: index_name, Label: 'Index Name', ![@UI.Importance]: #High },
            { Value: index_source, Label: 'Source', ![@UI.Importance]: #High },
            { Value: currency_code, Label: 'Currency', ![@UI.Importance]: #Medium },
            { Value: uom_code, Label: 'UoM', ![@UI.Importance]: #Medium },
            { Value: latest_value, Label: 'Latest Value', ![@UI.Importance]: #High },
            { Value: latest_date, Label: 'Latest Date', ![@UI.Importance]: #Medium },
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
                { Value: is_active, Label: 'Active', Criticality: activeCriticality }
            ]
        },

        FieldGroup#LatestValue: {
            Data: [
                { Value: latest_value, Label: 'Value' },
                { Value: latest_date, Label: 'Date' }
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
                { Value: description, Label: 'Description' },
                { Value: currency_code, Label: 'Currency' },
                { Value: uom_code, Label: 'Unit of Measure' },
                { Value: is_active, Label: 'Active' }
            ]
        },

        FieldGroup#DataSource: {
            Label: 'Data Source',
            Data: [
                { Value: index_source, Label: 'Source' },
                { Value: source_url, Label: 'Source URL' },
                { Value: refresh_frequency, Label: 'Refresh Frequency' },
                { Value: last_import_date, Label: 'Last Import Date' },
                { Value: next_import_date, Label: 'Next Import Date' }
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
            Title          : { Value: value_date }
        },

        LineItem: [
            { Value: value_date, Label: 'Date', ![@UI.Importance]: #High },
            { Value: value, Label: 'Value', ![@UI.Importance]: #High },
            { Value: currency_code, Label: 'Currency', ![@UI.Importance]: #Medium },
            { Value: change_amount, Label: 'Change', ![@UI.Importance]: #Medium },
            { Value: change_percentage, Label: 'Change %', ![@UI.Importance]: #Medium },
            { Value: source, Label: 'Source', ![@UI.Importance]: #Low }
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
            formula_code,
            formula_type,
            airport_ID,
            product_ID,
            status
        ],

        LineItem: [
            { Value: formula_code, Label: 'Formula Code', ![@UI.Importance]: #High },
            { Value: formula_name, Label: 'Formula Name', ![@UI.Importance]: #High },
            { Value: formula_type, Label: 'Type', ![@UI.Importance]: #Medium },
            { Value: airport.iata_code, Label: 'Airport', ![@UI.Importance]: #High },
            { Value: product.product_name, Label: 'Product', ![@UI.Importance]: #Medium },
            { Value: effective_from, Label: 'Effective From', ![@UI.Importance]: #Medium },
            { Value: effective_to, Label: 'Effective To', ![@UI.Importance]: #Medium },
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
                { Value: effective_from, Label: 'From' },
                { Value: effective_to, Label: 'To' }
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
                { Value: formula_code, Label: 'Formula Code' },
                { Value: formula_name, Label: 'Formula Name' },
                { Value: description, Label: 'Description' },
                { Value: formula_type, Label: 'Formula Type' },
                { Value: effective_from, Label: 'Effective From' },
                { Value: effective_to, Label: 'Effective To' },
                { Value: status, Label: 'Status' }
            ]
        },

        FieldGroup#FormulaScope: {
            Label: 'Scope',
            Data: [
                { Value: airport.airport_name, Label: 'Airport' },
                { Value: airport.iata_code, Label: 'Airport IATA' },
                { Value: product.product_name, Label: 'Product' },
                { Value: supplier.supplier_name, Label: 'Supplier' },
                { Value: currency_code, Label: 'Currency' }
            ]
        },

        FieldGroup#FormulaApproval: {
            Label: 'Approval Workflow',
            Data: [
                { Value: submitted_by, Label: 'Submitted By' },
                { Value: submitted_at, Label: 'Submitted At' },
                { Value: first_approver, Label: 'First Approver' },
                { Value: first_approved_at, Label: 'First Approved At' },
                { Value: second_approver, Label: 'Second Approver' },
                { Value: second_approved_at, Label: 'Second Approved At' },
                { Value: rejected_by, Label: 'Rejected By' },
                { Value: rejected_at, Label: 'Rejected At' },
                { Value: rejection_reason, Label: 'Rejection Reason' }
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
            { Value: index.index_name, Label: 'Index', ![@UI.Importance]: #Medium },
            { Value: fixed_value, Label: 'Fixed Value', ![@UI.Importance]: #Medium },
            { Value: percentage_value, Label: 'Percentage', ![@UI.Importance]: #Medium },
            { Value: operation, Label: 'Operation', ![@UI.Importance]: #Low }
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
                { Value: description, Label: 'Description' },
                { Value: index.index_name, Label: 'Market Index' },
                { Value: fixed_value, Label: 'Fixed Value' },
                { Value: percentage_value, Label: 'Percentage' },
                { Value: min_value, Label: 'Minimum Value' },
                { Value: max_value, Label: 'Maximum Value' },
                { Value: operation, Label: 'Operation' },
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
            Title          : { Value: airport.iata_code },
            Description    : { Value: price_date }
        },

        SelectionFields: [
            airport_ID,
            product_ID,
            supplier_ID,
            price_date
        ],

        LineItem: [
            { Value: price_date, Label: 'Price Date', ![@UI.Importance]: #High },
            { Value: airport.iata_code, Label: 'Airport', ![@UI.Importance]: #High },
            { Value: product.product_name, Label: 'Product', ![@UI.Importance]: #High },
            { Value: supplier.supplier_name, Label: 'Supplier', ![@UI.Importance]: #Medium },
            { Value: base_index_value, Label: 'Index Value', ![@UI.Importance]: #Medium },
            { Value: final_price, Label: 'Final Price', ![@UI.Importance]: #High },
            { Value: currency_code, Label: 'Currency', ![@UI.Importance]: #Medium },
            { Value: cpe_price, Label: 'CPE Price', ![@UI.Importance]: #Low },
            { Value: price_variance, Label: 'Variance', ![@UI.Importance]: #Low }
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
                ID     : 'PriceComponents',
                Label  : 'Price Components',
                Target : '@UI.FieldGroup#PriceComponents'
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
                { Value: airport.airport_name, Label: 'Airport' },
                { Value: product.product_name, Label: 'Product' },
                { Value: supplier.supplier_name, Label: 'Supplier' },
                { Value: formula.formula_name, Label: 'Formula' },
                { Value: final_price, Label: 'Final Price' },
                { Value: currency_code, Label: 'Currency' },
                { Value: uom_code, Label: 'UoM' }
            ]
        },

        FieldGroup#PriceComponents: {
            Data: [
                { Value: base_index_value, Label: 'Base Index Value' },
                { Value: premium_amount, Label: 'Premium' },
                { Value: into_plane_fee, Label: 'Into-Plane Fee' },
                { Value: transport_cost, Label: 'Transport Cost' },
                { Value: handling_fee, Label: 'Handling Fee' },
                { Value: tax_amount, Label: 'Taxes' },
                { Value: final_price, Label: 'Final Price' }
            ]
        },

        FieldGroup#CPEComparison: {
            Data: [
                { Value: cpe_price, Label: 'CPE Price' },
                { Value: price_variance, Label: 'Price Variance' },
                { Value: variance_percentage, Label: 'Variance %' },
                { Value: variance_reason, Label: 'Variance Reason' }
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
            status
        ],

        LineItem: [
            { Value: simulation_name, Label: 'Simulation Name', ![@UI.Importance]: #High },
            { Value: simulation_date, Label: 'Date', ![@UI.Importance]: #High },
            { Value: formula.formula_name, Label: 'Formula', ![@UI.Importance]: #High },
            { Value: base_price, Label: 'Base Price', ![@UI.Importance]: #Medium },
            { Value: simulated_price, Label: 'Simulated Price', ![@UI.Importance]: #High },
            { Value: impact_amount, Label: 'Impact', ![@UI.Importance]: #Medium },
            { Value: impact_percentage, Label: 'Impact %', ![@UI.Importance]: #Medium },
            {
                Value: status,
                Label: 'Status',
                Criticality: statusCriticality,
                ![@UI.Importance]: #High
            }
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
                { Value: simulation_name, Label: 'Simulation Name' },
                { Value: description, Label: 'Description' },
                { Value: simulation_date, Label: 'Simulation Date' },
                { Value: formula.formula_name, Label: 'Formula' },
                { Value: scenario_type, Label: 'Scenario Type' },
                { Value: index_change_percentage, Label: 'Index Change %' },
                { Value: status, Label: 'Status' }
            ]
        },

        FieldGroup#SimulationResults: {
            Data: [
                { Value: base_price, Label: 'Base Price' },
                { Value: simulated_price, Label: 'Simulated Price' },
                { Value: impact_amount, Label: 'Impact Amount' },
                { Value: impact_percentage, Label: 'Impact %' },
                { Value: currency_code, Label: 'Currency' },
                { Value: executed_at, Label: 'Executed At' },
                { Value: executed_by, Label: 'Executed By' }
            ]
        }
    }
);

// Value Help for Pricing associations
annotate PricingService.PricingFormulas with {
    airport @(
        Common: {
            Text: airport.airport_name,
            TextArrangement: #TextFirst,
            ValueList: {
                Label: 'Airports',
                CollectionPath: 'Airports',
                Parameters: [
                    { $Type: 'Common.ValueListParameterInOut', LocalDataProperty: airport_ID, ValueListProperty: 'ID' },
                    { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'iata_code' },
                    { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'airport_name' }
                ]
            }
        }
    );

    product @(
        Common: {
            Text: product.product_name,
            TextArrangement: #TextFirst,
            ValueList: {
                Label: 'Products',
                CollectionPath: 'Products',
                Parameters: [
                    { $Type: 'Common.ValueListParameterInOut', LocalDataProperty: product_ID, ValueListProperty: 'ID' },
                    { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'product_code' },
                    { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'product_name' }
                ]
            }
        }
    );

    supplier @(
        Common: {
            Text: supplier.supplier_name,
            TextArrangement: #TextFirst,
            ValueList: {
                Label: 'Suppliers',
                CollectionPath: 'Suppliers',
                Parameters: [
                    { $Type: 'Common.ValueListParameterInOut', LocalDataProperty: supplier_ID, ValueListProperty: 'ID' },
                    { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'supplier_code' },
                    { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'supplier_name' }
                ]
            }
        }
    );
};
