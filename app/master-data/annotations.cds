using MasterDataService as service from '../../srv/master-data-service';

// =============================================================================
// AIRPORTS - List Report + Object Page
// =============================================================================
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
            { Value: iata_code, Label: 'IATA Code', ![@UI.Importance]: #High },
            { Value: icao_code, Label: 'ICAO Code' },
            { Value: airport_name, Label: 'Airport Name', ![@UI.Importance]: #High },
            { Value: city, Label: 'City' },
            { Value: country_code, Label: 'Country' },
            { Value: timezone, Label: 'Timezone' },
            { Value: s4_plant_code, Label: 'S/4 Plant' },
            { Value: is_active, Label: 'Active', Criticality: activeCriticality }
        ],
        Facets: [
            {
                $Type: 'UI.ReferenceFacet',
                ID: 'GeneralInfo',
                Label: 'General Information',
                Target: '@UI.FieldGroup#GeneralInfo'
            },
            {
                $Type: 'UI.ReferenceFacet',
                ID: 'LocationInfo',
                Label: 'Location Details',
                Target: '@UI.FieldGroup#LocationInfo'
            },
            {
                $Type: 'UI.ReferenceFacet',
                ID: 'SystemInfo',
                Label: 'System Information',
                Target: '@UI.FieldGroup#SystemInfo'
            }
        ],
        FieldGroup#GeneralInfo: {
            Data: [
                { Value: iata_code, Label: 'IATA Code' },
                { Value: icao_code, Label: 'ICAO Code' },
                { Value: airport_name, Label: 'Airport Name' },
                { Value: s4_plant_code, Label: 'S/4 Plant Code' },
                { Value: is_active, Label: 'Active' }
            ]
        },
        FieldGroup#LocationInfo: {
            Data: [
                { Value: city, Label: 'City' },
                { Value: country_code, Label: 'Country' },
                { Value: timezone, Label: 'Timezone' }
            ]
        },
        FieldGroup#SystemInfo: {
            Data: [
                { Value: created_at, Label: 'Created At' },
                { Value: created_by, Label: 'Created By' },
                { Value: modified_at, Label: 'Modified At' },
                { Value: modified_by, Label: 'Modified By' }
            ]
        }
    }
) {
    activeCriticality @UI.Hidden;
};

// =============================================================================
// AIRCRAFT - List Report + Object Page
// =============================================================================
annotate service.Aircraft with @(
    UI: {
        HeaderInfo: {
            TypeName: 'Aircraft',
            TypeNamePlural: 'Aircraft',
            Title: { Value: aircraft_type },
            Description: { Value: manufacturer_ID }
        },
        SelectionFields: [
            aircraft_type,
            manufacturer_ID,
            is_active
        ],
        LineItem: [
            { Value: aircraft_type, Label: 'Aircraft Type', ![@UI.Importance]: #High },
            { Value: manufacturer_ID, Label: 'Manufacturer' },
            { Value: iata_code, Label: 'IATA Code' },
            { Value: icao_code, Label: 'ICAO Code' },
            { Value: max_fuel_capacity_kg, Label: 'Max Fuel (kg)' },
            { Value: fuel_burn_rate_kg_hr, Label: 'Burn Rate (kg/hr)' },
            { Value: is_active, Label: 'Active', Criticality: activeCriticality }
        ],
        Facets: [
            {
                $Type: 'UI.ReferenceFacet',
                ID: 'GeneralInfo',
                Label: 'General Information',
                Target: '@UI.FieldGroup#GeneralInfo'
            },
            {
                $Type: 'UI.ReferenceFacet',
                ID: 'FuelSpecs',
                Label: 'Fuel Specifications',
                Target: '@UI.FieldGroup#FuelSpecs'
            },
            {
                $Type: 'UI.ReferenceFacet',
                ID: 'SystemInfo',
                Label: 'System Information',
                Target: '@UI.FieldGroup#SystemInfo'
            }
        ],
        FieldGroup#GeneralInfo: {
            Data: [
                { Value: aircraft_type, Label: 'Aircraft Type' },
                { Value: manufacturer_ID, Label: 'Manufacturer' },
                { Value: iata_code, Label: 'IATA Code' },
                { Value: icao_code, Label: 'ICAO Code' },
                { Value: is_active, Label: 'Active' }
            ]
        },
        FieldGroup#FuelSpecs: {
            Data: [
                { Value: max_fuel_capacity_kg, Label: 'Max Fuel Capacity (kg)' },
                { Value: fuel_burn_rate_kg_hr, Label: 'Fuel Burn Rate (kg/hr)' }
            ]
        },
        FieldGroup#SystemInfo: {
            Data: [
                { Value: created_at, Label: 'Created At' },
                { Value: created_by, Label: 'Created By' },
                { Value: modified_at, Label: 'Modified At' },
                { Value: modified_by, Label: 'Modified By' }
            ]
        }
    }
) {
    activeCriticality @UI.Hidden;
};

// =============================================================================
// ROUTES - List Report + Object Page
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
            departure_airport_ID,
            arrival_airport_ID,
            is_active
        ],
        LineItem: [
            { Value: route_code, Label: 'Route Code', ![@UI.Importance]: #High },
            { Value: route_name, Label: 'Route Name', ![@UI.Importance]: #High },
            { Value: departure_airport_ID, Label: 'Departure' },
            { Value: arrival_airport_ID, Label: 'Arrival' },
            { Value: distance_km, Label: 'Distance (km)' },
            { Value: flight_time_mins, Label: 'Flight Time (min)' },
            { Value: fuel_required, Label: 'Fuel Required (kg)' },
            { Value: is_active, Label: 'Active', Criticality: activeCriticality }
        ],
        Facets: [
            {
                $Type: 'UI.ReferenceFacet',
                ID: 'GeneralInfo',
                Label: 'Route Information',
                Target: '@UI.FieldGroup#GeneralInfo'
            },
            {
                $Type: 'UI.ReferenceFacet',
                ID: 'FlightDetails',
                Label: 'Flight Details',
                Target: '@UI.FieldGroup#FlightDetails'
            },
            {
                $Type: 'UI.ReferenceFacet',
                ID: 'SystemInfo',
                Label: 'System Information',
                Target: '@UI.FieldGroup#SystemInfo'
            }
        ],
        FieldGroup#GeneralInfo: {
            Data: [
                { Value: route_code, Label: 'Route Code' },
                { Value: route_name, Label: 'Route Name' },
                { Value: departure_airport_ID, Label: 'Departure Airport' },
                { Value: arrival_airport_ID, Label: 'Arrival Airport' },
                { Value: is_active, Label: 'Active' }
            ]
        },
        FieldGroup#FlightDetails: {
            Data: [
                { Value: distance_km, Label: 'Distance (km)' },
                { Value: flight_time_mins, Label: 'Flight Time (mins)' },
                { Value: fuel_required, Label: 'Fuel Required (kg)' }
            ]
        },
        FieldGroup#SystemInfo: {
            Data: [
                { Value: created_at, Label: 'Created At' },
                { Value: created_by, Label: 'Created By' },
                { Value: modified_at, Label: 'Modified At' },
                { Value: modified_by, Label: 'Modified By' }
            ]
        }
    }
) {
    activeCriticality @UI.Hidden;
};

// =============================================================================
// SUPPLIERS - List Report + Object Page
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
            country_code,
            is_active
        ],
        LineItem: [
            { Value: supplier_code, Label: 'Supplier Code', ![@UI.Importance]: #High },
            { Value: supplier_name, Label: 'Supplier Name', ![@UI.Importance]: #High },
            { Value: supplier_type, Label: 'Type' },
            { Value: country_code, Label: 'Country' },
            { Value: city, Label: 'City' },
            { Value: payment_terms, Label: 'Payment Terms' },
            { Value: is_active, Label: 'Active', Criticality: activeCriticality }
        ],
        Facets: [
            {
                $Type: 'UI.ReferenceFacet',
                ID: 'GeneralInfo',
                Label: 'General Information',
                Target: '@UI.FieldGroup#GeneralInfo'
            },
            {
                $Type: 'UI.ReferenceFacet',
                ID: 'ContactInfo',
                Label: 'Contact Information',
                Target: '@UI.FieldGroup#ContactInfo'
            },
            {
                $Type: 'UI.ReferenceFacet',
                ID: 'AddressInfo',
                Label: 'Address',
                Target: '@UI.FieldGroup#AddressInfo'
            },
            {
                $Type: 'UI.ReferenceFacet',
                ID: 'SystemInfo',
                Label: 'System Information',
                Target: '@UI.FieldGroup#SystemInfo'
            }
        ],
        FieldGroup#GeneralInfo: {
            Data: [
                { Value: supplier_code, Label: 'Supplier Code' },
                { Value: supplier_name, Label: 'Supplier Name' },
                { Value: supplier_type, Label: 'Supplier Type' },
                { Value: s4_vendor_code, Label: 'S/4 Vendor Code' },
                { Value: payment_terms, Label: 'Payment Terms' },
                { Value: currency_code, Label: 'Currency' },
                { Value: is_active, Label: 'Active' }
            ]
        },
        FieldGroup#ContactInfo: {
            Data: [
                { Value: contact_person, Label: 'Contact Person' },
                { Value: contact_email, Label: 'Email' },
                { Value: contact_phone, Label: 'Phone' }
            ]
        },
        FieldGroup#AddressInfo: {
            Data: [
                { Value: address_line1, Label: 'Address Line 1' },
                { Value: address_line2, Label: 'Address Line 2' },
                { Value: city, Label: 'City' },
                { Value: postal_code, Label: 'Postal Code' },
                { Value: country_code, Label: 'Country' }
            ]
        },
        FieldGroup#SystemInfo: {
            Data: [
                { Value: created_at, Label: 'Created At' },
                { Value: created_by, Label: 'Created By' },
                { Value: modified_at, Label: 'Modified At' },
                { Value: modified_by, Label: 'Modified By' }
            ]
        }
    }
) {
    activeCriticality @UI.Hidden;
};

// =============================================================================
// PRODUCTS - List Report + Object Page
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
            product_category,
            is_active
        ],
        LineItem: [
            { Value: product_code, Label: 'Product Code', ![@UI.Importance]: #High },
            { Value: product_name, Label: 'Product Name', ![@UI.Importance]: #High },
            { Value: product_category, Label: 'Category' },
            { Value: specification, Label: 'Specification' },
            { Value: base_uom, Label: 'Base UoM' },
            { Value: density_kg_ltr, Label: 'Density (kg/L)' },
            { Value: is_active, Label: 'Active', Criticality: activeCriticality }
        ],
        Facets: [
            {
                $Type: 'UI.ReferenceFacet',
                ID: 'GeneralInfo',
                Label: 'General Information',
                Target: '@UI.FieldGroup#GeneralInfo'
            },
            {
                $Type: 'UI.ReferenceFacet',
                ID: 'Specifications',
                Label: 'Specifications',
                Target: '@UI.FieldGroup#Specifications'
            },
            {
                $Type: 'UI.ReferenceFacet',
                ID: 'SystemInfo',
                Label: 'System Information',
                Target: '@UI.FieldGroup#SystemInfo'
            }
        ],
        FieldGroup#GeneralInfo: {
            Data: [
                { Value: product_code, Label: 'Product Code' },
                { Value: product_name, Label: 'Product Name' },
                { Value: product_category, Label: 'Category' },
                { Value: s4_material_code, Label: 'S/4 Material Code' },
                { Value: is_active, Label: 'Active' }
            ]
        },
        FieldGroup#Specifications: {
            Data: [
                { Value: specification, Label: 'Specification' },
                { Value: base_uom, Label: 'Base Unit of Measure' },
                { Value: density_kg_ltr, Label: 'Density (kg/L)' },
                { Value: flash_point_c, Label: 'Flash Point (°C)' },
                { Value: freeze_point_c, Label: 'Freeze Point (°C)' }
            ]
        },
        FieldGroup#SystemInfo: {
            Data: [
                { Value: created_at, Label: 'Created At' },
                { Value: created_by, Label: 'Created By' },
                { Value: modified_at, Label: 'Modified At' },
                { Value: modified_by, Label: 'Modified By' }
            ]
        }
    }
) {
    activeCriticality @UI.Hidden;
};

// =============================================================================
// CONTRACTS - List Report + Object Page
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
            supplier_ID,
            contract_type,
            is_active
        ],
        LineItem: [
            { Value: contract_number, Label: 'Contract Number', ![@UI.Importance]: #High },
            { Value: contract_name, Label: 'Contract Name', ![@UI.Importance]: #High },
            { Value: supplier_ID, Label: 'Supplier' },
            { Value: contract_type, Label: 'Type' },
            { Value: valid_from, Label: 'Valid From' },
            { Value: valid_to, Label: 'Valid To' },
            { Value: price_type, Label: 'Price Type' },
            { Value: currency_code, Label: 'Currency' },
            { Value: is_active, Label: 'Active', Criticality: activeCriticality }
        ],
        Facets: [
            {
                $Type: 'UI.ReferenceFacet',
                ID: 'GeneralInfo',
                Label: 'General Information',
                Target: '@UI.FieldGroup#GeneralInfo'
            },
            {
                $Type: 'UI.ReferenceFacet',
                ID: 'Validity',
                Label: 'Validity Period',
                Target: '@UI.FieldGroup#Validity'
            },
            {
                $Type: 'UI.ReferenceFacet',
                ID: 'Pricing',
                Label: 'Pricing Information',
                Target: '@UI.FieldGroup#Pricing'
            },
            {
                $Type: 'UI.ReferenceFacet',
                ID: 'SystemInfo',
                Label: 'System Information',
                Target: '@UI.FieldGroup#SystemInfo'
            }
        ],
        FieldGroup#GeneralInfo: {
            Data: [
                { Value: contract_number, Label: 'Contract Number' },
                { Value: contract_name, Label: 'Contract Name' },
                { Value: supplier_ID, Label: 'Supplier' },
                { Value: contract_type, Label: 'Contract Type' },
                { Value: s4_contract_number, Label: 'S/4 Contract Number' },
                { Value: is_active, Label: 'Active' }
            ]
        },
        FieldGroup#Validity: {
            Data: [
                { Value: valid_from, Label: 'Valid From' },
                { Value: valid_to, Label: 'Valid To' }
            ]
        },
        FieldGroup#Pricing: {
            Data: [
                { Value: price_type, Label: 'Price Type' },
                { Value: currency_code, Label: 'Currency' }
            ]
        },
        FieldGroup#SystemInfo: {
            Data: [
                { Value: created_at, Label: 'Created At' },
                { Value: created_by, Label: 'Created By' },
                { Value: modified_at, Label: 'Modified At' },
                { Value: modified_by, Label: 'Modified By' }
            ]
        }
    }
) {
    activeCriticality @UI.Hidden;
};

// =============================================================================
// MANUFACTURERS - List Report + Object Page
// =============================================================================
annotate service.Manufacturers with @(
    UI: {
        HeaderInfo: {
            TypeName: 'Manufacturer',
            TypeNamePlural: 'Manufacturers',
            Title: { Value: manufacturer_name },
            Description: { Value: manufacturer_code }
        },
        SelectionFields: [
            manufacturer_code,
            is_active
        ],
        LineItem: [
            { Value: manufacturer_code, Label: 'Code', ![@UI.Importance]: #High },
            { Value: manufacturer_name, Label: 'Manufacturer Name', ![@UI.Importance]: #High },
            { Value: country_of_origin, Label: 'Country of Origin' },
            { Value: is_active, Label: 'Active', Criticality: activeCriticality }
        ],
        Facets: [
            {
                $Type: 'UI.ReferenceFacet',
                ID: 'GeneralInfo',
                Label: 'General Information',
                Target: '@UI.FieldGroup#GeneralInfo'
            },
            {
                $Type: 'UI.ReferenceFacet',
                ID: 'SystemInfo',
                Label: 'System Information',
                Target: '@UI.FieldGroup#SystemInfo'
            }
        ],
        FieldGroup#GeneralInfo: {
            Data: [
                { Value: manufacturer_code, Label: 'Manufacturer Code' },
                { Value: manufacturer_name, Label: 'Manufacturer Name' },
                { Value: country_of_origin, Label: 'Country of Origin' },
                { Value: is_active, Label: 'Active' }
            ]
        },
        FieldGroup#SystemInfo: {
            Data: [
                { Value: created_at, Label: 'Created At' },
                { Value: created_by, Label: 'Created By' },
                { Value: modified_at, Label: 'Modified At' },
                { Value: modified_by, Label: 'Modified By' }
            ]
        }
    }
) {
    activeCriticality @UI.Hidden;
};

// =============================================================================
// REFERENCE DATA - Simple List Reports
// =============================================================================

// Countries
annotate service.Countries with @(
    UI: {
        HeaderInfo: {
            TypeName: 'Country',
            TypeNamePlural: 'Countries',
            Title: { Value: landx },
            Description: { Value: land1 }
        },
        SelectionFields: [ land1, landgr ],
        LineItem: [
            { Value: land1, Label: 'Country Code', ![@UI.Importance]: #High },
            { Value: landx, Label: 'Country Name', ![@UI.Importance]: #High },
            { Value: landgr, Label: 'Region' },
            { Value: currcode, Label: 'Currency' },
            { Value: is_active, Label: 'Active' }
        ]
    }
);

// Currencies
annotate service.Currencies with @(
    UI: {
        HeaderInfo: {
            TypeName: 'Currency',
            TypeNamePlural: 'Currencies',
            Title: { Value: currency_name },
            Description: { Value: currency_code }
        },
        SelectionFields: [ currency_code ],
        LineItem: [
            { Value: currency_code, Label: 'Currency Code', ![@UI.Importance]: #High },
            { Value: currency_name, Label: 'Currency Name', ![@UI.Importance]: #High },
            { Value: symbol, Label: 'Symbol' },
            { Value: decimal_places, Label: 'Decimals' },
            { Value: is_active, Label: 'Active' }
        ]
    }
);

// Units of Measure
annotate service.UnitsOfMeasure with @(
    UI: {
        HeaderInfo: {
            TypeName: 'Unit of Measure',
            TypeNamePlural: 'Units of Measure',
            Title: { Value: uom_name },
            Description: { Value: uom_code }
        },
        SelectionFields: [ uom_code, uom_category ],
        LineItem: [
            { Value: uom_code, Label: 'UoM Code', ![@UI.Importance]: #High },
            { Value: uom_name, Label: 'UoM Name', ![@UI.Importance]: #High },
            { Value: uom_category, Label: 'Category' },
            { Value: conversion_to_kg, Label: 'Conversion to kg' },
            { Value: is_active, Label: 'Active' }
        ]
    }
);

// Plants
annotate service.Plants with @(
    UI: {
        HeaderInfo: {
            TypeName: 'Plant',
            TypeNamePlural: 'Plants',
            Title: { Value: name1 },
            Description: { Value: werks }
        },
        SelectionFields: [ werks, land1_land1 ],
        LineItem: [
            { Value: werks, Label: 'Plant Code', ![@UI.Importance]: #High },
            { Value: name1, Label: 'Plant Name', ![@UI.Importance]: #High },
            { Value: ort01, Label: 'City' },
            { Value: land1_land1, Label: 'Country' },
            { Value: is_active, Label: 'Active' }
        ]
    }
);

// =============================================================================
// VALUE HELPS
// =============================================================================
annotate service.Airports with {
    country_code @(
        Common: {
            Text: country_code,
            ValueList: {
                Label: 'Countries',
                CollectionPath: 'Countries',
                Parameters: [
                    { $Type: 'Common.ValueListParameterInOut', LocalDataProperty: country_code, ValueListProperty: 'land1' },
                    { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'landx' }
                ]
            }
        }
    );
};

annotate service.Aircraft with {
    manufacturer_ID @(
        Common: {
            Text: manufacturer.manufacturer_name,
            TextArrangement: #TextFirst,
            ValueList: {
                Label: 'Manufacturers',
                CollectionPath: 'Manufacturers',
                Parameters: [
                    { $Type: 'Common.ValueListParameterInOut', LocalDataProperty: manufacturer_ID, ValueListProperty: 'ID' },
                    { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'manufacturer_name' }
                ]
            }
        }
    );
};

annotate service.Routes with {
    departure_airport_ID @(
        Common: {
            Text: departure_airport.airport_name,
            TextArrangement: #TextFirst,
            ValueList: {
                Label: 'Airports',
                CollectionPath: 'Airports',
                Parameters: [
                    { $Type: 'Common.ValueListParameterInOut', LocalDataProperty: departure_airport_ID, ValueListProperty: 'ID' },
                    { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'iata_code' },
                    { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'airport_name' }
                ]
            }
        }
    );
    arrival_airport_ID @(
        Common: {
            Text: arrival_airport.airport_name,
            TextArrangement: #TextFirst,
            ValueList: {
                Label: 'Airports',
                CollectionPath: 'Airports',
                Parameters: [
                    { $Type: 'Common.ValueListParameterInOut', LocalDataProperty: arrival_airport_ID, ValueListProperty: 'ID' },
                    { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'iata_code' },
                    { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'airport_name' }
                ]
            }
        }
    );
};

annotate service.Contracts with {
    supplier_ID @(
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
