using MasterDataService as service from './master-data-service';

// =============================================================================
// AIRPORTS - List Report + Object Page
// =============================================================================

// Enable CRUD operations for Airports
annotate service.Airports with @(
    Capabilities: {
        InsertRestrictions: { Insertable: true },
        UpdateRestrictions: { Updatable: true },
        DeleteRestrictions: { Deletable: true }
    }
);

annotate service.Airports with @(
    UI: {
        HeaderInfo: {
            TypeName: 'Airport',
            TypeNamePlural: 'Airports',
            Title: { Value: airport_name },
            Description: { Value: iata_code }
        },
        SelectionFields: [
            iata_code,
            country_code,
            is_active
        ],
        LineItem: [
            { Value: iata_code, Label: 'IATA Code' },
            { Value: icao_code, Label: 'ICAO Code' },
            { Value: airport_name, Label: 'Airport Name' },
            { Value: city, Label: 'City' },
            { Value: country_code, Label: 'Country' },
            { Value: timezone, Label: 'Timezone' },
            { Value: is_active, Label: 'Active' }
        ],
        Facets: [
            {
                $Type: 'UI.ReferenceFacet',
                ID: 'GeneralInfo',
                Label: 'General Information',
                Target: '@UI.FieldGroup#GeneralInfo'
            }
        ],
        FieldGroup#GeneralInfo: {
            Data: [
                { Value: iata_code, Label: 'IATA Code' },
                { Value: icao_code, Label: 'ICAO Code' },
                { Value: airport_name, Label: 'Airport Name' },
                { Value: city, Label: 'City' },
                { Value: country_code, Label: 'Country' },
                { Value: timezone, Label: 'Timezone' },
                { Value: s4_plant_code, Label: 'S/4 Plant Code' },
                { Value: is_active, Label: 'Active' },
                { Value: created_by, Label: 'Created By' },
                { Value: created_at, Label: 'Created At' }
            ]
        }
    }
);

// =============================================================================
// AIRCRAFT
// =============================================================================
annotate service.Aircraft with @(
    UI: {
        HeaderInfo: {
            TypeName: 'Aircraft',
            TypeNamePlural: 'Aircraft',
            Title: { Value: aircraft_type },
            Description: { Value: iata_code }
        },
        SelectionFields: [
            aircraft_type,
            is_active
        ],
        LineItem: [
            { Value: aircraft_type, Label: 'Aircraft Type' },
            { Value: iata_code, Label: 'IATA Code' },
            { Value: icao_code, Label: 'ICAO Code' },
            { Value: max_fuel_capacity_kg, Label: 'Max Fuel (kg)' },
            { Value: fuel_burn_rate_kg_hr, Label: 'Burn Rate (kg/hr)' },
            { Value: is_active, Label: 'Active' }
        ]
    }
);

// =============================================================================
// ROUTES
// =============================================================================
annotate service.Routes with @(
    UI: {
        HeaderInfo: {
            TypeName: 'Route',
            TypeNamePlural: 'Routes',
            Title: { Value: route_code },
            Description: { Value: route_name }
        },
        SelectionFields: [
            route_code,
            is_active
        ],
        LineItem: [
            { Value: route_code, Label: 'Route Code' },
            { Value: route_name, Label: 'Route Name' },
            { Value: distance_km, Label: 'Distance (km)' },
            { Value: flight_time_mins, Label: 'Flight Time (min)' },
            { Value: fuel_required, Label: 'Fuel Required (kg)' },
            { Value: is_active, Label: 'Active' }
        ]
    }
);

// =============================================================================
// SUPPLIERS
// =============================================================================
annotate service.Suppliers with @(
    UI: {
        HeaderInfo: {
            TypeName: 'Supplier',
            TypeNamePlural: 'Suppliers',
            Title: { Value: supplier_name },
            Description: { Value: supplier_code }
        },
        SelectionFields: [
            supplier_code,
            supplier_type,
            is_active
        ],
        LineItem: [
            { Value: supplier_code, Label: 'Supplier Code' },
            { Value: supplier_name, Label: 'Supplier Name' },
            { Value: supplier_type, Label: 'Type' },
            { Value: city, Label: 'City' },
            { Value: country_code, Label: 'Country' },
            { Value: is_active, Label: 'Active' }
        ]
    }
);

// =============================================================================
// PRODUCTS
// =============================================================================
annotate service.Products with @(
    UI: {
        HeaderInfo: {
            TypeName: 'Product',
            TypeNamePlural: 'Products',
            Title: { Value: product_name },
            Description: { Value: product_code }
        },
        SelectionFields: [
            product_code,
            is_active
        ],
        LineItem: [
            { Value: product_code, Label: 'Product Code' },
            { Value: product_name, Label: 'Product Name' },
            { Value: product_category, Label: 'Category' },
            { Value: specification, Label: 'Specification' },
            { Value: base_uom, Label: 'Base UoM' },
            { Value: is_active, Label: 'Active' }
        ]
    }
);

// =============================================================================
// CONTRACTS
// =============================================================================
annotate service.Contracts with @(
    UI: {
        HeaderInfo: {
            TypeName: 'Contract',
            TypeNamePlural: 'Contracts',
            Title: { Value: contract_name },
            Description: { Value: contract_number }
        },
        SelectionFields: [
            contract_number,
            contract_type,
            is_active
        ],
        LineItem: [
            { Value: contract_number, Label: 'Contract Number' },
            { Value: contract_name, Label: 'Contract Name' },
            { Value: contract_type, Label: 'Type' },
            { Value: valid_from, Label: 'Valid From' },
            { Value: valid_to, Label: 'Valid To' },
            { Value: currency_code, Label: 'Currency' },
            { Value: is_active, Label: 'Active' }
        ]
    }
);

// =============================================================================
// REFERENCE DATA
// =============================================================================
annotate service.Countries with @(
    UI: {
        HeaderInfo: {
            TypeName: 'Country',
            TypeNamePlural: 'Countries',
            Title: { Value: landx }
        },
        LineItem: [
            { Value: land1, Label: 'Country Code' },
            { Value: landx, Label: 'Country Name' },
            { Value: landgr, Label: 'Region' },
            { Value: currcode, Label: 'Currency' }
        ]
    }
);

annotate service.Currencies with @(
    UI: {
        HeaderInfo: {
            TypeName: 'Currency',
            TypeNamePlural: 'Currencies',
            Title: { Value: currency_name }
        },
        LineItem: [
            { Value: currency_code, Label: 'Currency Code' },
            { Value: currency_name, Label: 'Currency Name' },
            { Value: symbol, Label: 'Symbol' }
        ]
    }
);

annotate service.Plants with @(
    UI: {
        HeaderInfo: {
            TypeName: 'Plant',
            TypeNamePlural: 'Plants',
            Title: { Value: name1 }
        },
        LineItem: [
            { Value: werks, Label: 'Plant Code' },
            { Value: name1, Label: 'Plant Name' },
            { Value: ort01, Label: 'City' }
        ]
    }
);
