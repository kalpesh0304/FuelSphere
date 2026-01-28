/**
 * FuelSphere - Master Data Service Fiori Annotations
 * Enhanced based on FIGMA specifications in docs/figma/
 *
 * Screens:
 * - AIRPORT_MASTER_001: Airport Master Data (List Report)
 * - AIRPORT_DETAIL_001: Airport Detail (Object Page)
 * - AIRCRAFT_MASTER_001: Aircraft Master Data (List Report)
 * - AIRCRAFT_DETAIL_001: Aircraft Detail (Object Page)
 * - ROUTE_MASTER_001: Route Master Data (List Report)
 * - ROUTE_DETAIL_001: Route Detail (Object Page)
 * - MASTER_DATA_DASHBOARD_001: Master Data Dashboard (Overview Page)
 */

using MasterDataService as service from './master-data-service';

// =============================================================================
// AIRPORTS - List Report (AIRPORT_MASTER_001) + Object Page (AIRPORT_DETAIL_001)
// =============================================================================

annotate service.Airports with @(
    Capabilities: {
        InsertRestrictions: { Insertable: true },
        UpdateRestrictions: { Updatable: true },
        DeleteRestrictions: { Deletable: true },
        FilterRestrictions: {
            FilterExpressionRestrictions: [
                { Property: created_at, AllowedExpressions: 'SingleRange' }
            ]
        }
    }
);

annotate service.Airports with @(
    UI: {
        // Header Info for Object Page
        HeaderInfo: {
            TypeName       : 'Airport',
            TypeNamePlural : 'Airports',
            Title          : { Value: airport_name },
            Description    : { Value: iata_code },
            ImageUrl       : 'sap-icon://flight'
        },

        // Filter Bar Selection Fields
        SelectionFields: [
            iata_code,
            icao_code,
            city,
            country_code,
            timezone,
            is_active
        ],

        // Table Columns for List Report
        LineItem: [
            { Value: iata_code, Label: 'IATA Code', ![@UI.Importance]: #High },
            { Value: icao_code, Label: 'ICAO Code', ![@UI.Importance]: #Medium },
            { Value: airport_name, Label: 'Airport Name', ![@UI.Importance]: #High },
            { Value: city, Label: 'City', ![@UI.Importance]: #High },
            { Value: country_code, Label: 'Country', ![@UI.Importance]: #Medium },
            { Value: timezone, Label: 'Timezone', ![@UI.Importance]: #Low },
            { Value: s4_plant_code, Label: 'S/4 Plant', ![@UI.Importance]: #Low },
            {
                Value: is_active,
                Label: 'Status',
                Criticality: activeCriticality,
                ![@UI.Importance]: #High
            }
        ],

        // Default Sorting
        PresentationVariant: {
            SortOrder: [
                { Property: iata_code, Descending: false }
            ],
            Visualizations: [ '@UI.LineItem' ]
        },

        // Object Page Header Facets
        HeaderFacets: [
            {
                $Type  : 'UI.ReferenceFacet',
                Target : '@UI.FieldGroup#AirportStatus',
                Label  : 'Status'
            },
            {
                $Type  : 'UI.ReferenceFacet',
                Target : '@UI.FieldGroup#AirportCodes',
                Label  : 'Codes'
            },
            {
                $Type  : 'UI.ReferenceFacet',
                Target : '@UI.FieldGroup#AirportLocation',
                Label  : 'Location'
            }
        ],

        FieldGroup#AirportStatus: {
            Data: [
                { Value: is_active, Label: 'Active', Criticality: activeCriticality }
            ]
        },

        FieldGroup#AirportCodes: {
            Data: [
                { Value: iata_code, Label: 'IATA' },
                { Value: icao_code, Label: 'ICAO' }
            ]
        },

        FieldGroup#AirportLocation: {
            Data: [
                { Value: city, Label: 'City' },
                { Value: country_code, Label: 'Country' }
            ]
        },

        // Object Page Sections
        Facets: [
            {
                $Type  : 'UI.ReferenceFacet',
                ID     : 'GeneralInfo',
                Label  : 'General Information',
                Target : '@UI.FieldGroup#GeneralInfo'
            },
            {
                $Type  : 'UI.ReferenceFacet',
                ID     : 'GeographicInfo',
                Label  : 'Geographic Details',
                Target : '@UI.FieldGroup#GeographicInfo'
            },
            {
                $Type  : 'UI.ReferenceFacet',
                ID     : 'S4Integration',
                Label  : 'S/4HANA Integration',
                Target : '@UI.FieldGroup#S4Integration'
            },
            {
                $Type  : 'UI.ReferenceFacet',
                ID     : 'Administrative',
                Label  : 'Administrative',
                Target : '@UI.FieldGroup#Administrative'
            }
        ],

        FieldGroup#GeneralInfo: {
            Label: 'General Information',
            Data: [
                { Value: iata_code, Label: 'IATA Code' },
                { Value: icao_code, Label: 'ICAO Code' },
                { Value: airport_name, Label: 'Airport Name' },
                { Value: is_active, Label: 'Active' }
            ]
        },

        FieldGroup#GeographicInfo: {
            Label: 'Geographic Details',
            Data: [
                { Value: city, Label: 'City' },
                { Value: country_code, Label: 'Country Code' },
                { Value: country.landx, Label: 'Country Name' },
                { Value: timezone, Label: 'Timezone' }
            ]
        },

        FieldGroup#S4Integration: {
            Label: 'S/4HANA Integration',
            Data: [
                { Value: s4_plant_code, Label: 'Plant Code' },
                { Value: plant.name1, Label: 'Plant Name' }
            ]
        },

        FieldGroup#Administrative: {
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

// Field-level annotations for Airports
annotate service.Airports with {
    ID              @UI.Hidden;
    iata_code       @title: 'IATA Code';
    icao_code       @title: 'ICAO Code';
    airport_name    @title: 'Airport Name';
    city            @title: 'City';
    country_code    @title: 'Country';
    timezone        @title: 'Timezone';
    s4_plant_code   @title: 'S/4 Plant Code';
    is_active       @title: 'Active';
    created_at      @title: 'Created At';
    created_by      @title: 'Created By';
    modified_at     @title: 'Modified At';
    modified_by     @title: 'Modified By';
};

// Value Help for Country
annotate service.Airports with {
    country @(
        Common: {
            Text: country.landx,
            TextArrangement: #TextFirst,
            ValueList: {
                Label: 'Countries',
                CollectionPath: 'Countries',
                Parameters: [
                    { $Type: 'Common.ValueListParameterInOut', LocalDataProperty: country_code, ValueListProperty: 'land1' },
                    { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'landx' },
                    { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'landgr' }
                ]
            }
        }
    );
};

// =============================================================================
// AIRCRAFT - List Report (AIRCRAFT_MASTER_001) + Object Page (AIRCRAFT_DETAIL_001)
// =============================================================================

annotate service.Aircraft with @(
    Capabilities: {
        InsertRestrictions: { Insertable: true },
        UpdateRestrictions: { Updatable: true },
        DeleteRestrictions: { Deletable: true }
    }
);

annotate service.Aircraft with @(
    UI: {
        HeaderInfo: {
            TypeName       : 'Aircraft',
            TypeNamePlural : 'Aircraft',
            Title          : { Value: aircraft_model },
            Description    : { Value: type_code },
            ImageUrl       : 'sap-icon://flight'
        },

        SelectionFields: [
            type_code,
            aircraft_model,
            manufacturer_code,
            is_active
        ],

        LineItem: [
            { Value: type_code, Label: 'Type Code', ![@UI.Importance]: #High },
            { Value: aircraft_model, Label: 'Aircraft Model', ![@UI.Importance]: #High },
            { Value: manufacturer.manufacture_name, Label: 'Manufacturer', ![@UI.Importance]: #Medium },
            { Value: fuel_capacity_kg, Label: 'Fuel Capacity (kg)', ![@UI.Importance]: #High },
            { Value: cruise_burn_kgph, Label: 'Burn Rate (kg/hr)', ![@UI.Importance]: #Medium },
            { Value: mtow_kg, Label: 'MTOW (kg)', ![@UI.Importance]: #Low },
            { Value: fleet_size, Label: 'Fleet Size', ![@UI.Importance]: #Low },
            {
                Value: is_active,
                Label: 'Status',
                Criticality: activeCriticality,
                ![@UI.Importance]: #High
            }
        ],

        PresentationVariant: {
            SortOrder: [
                { Property: type_code, Descending: false }
            ],
            Visualizations: [ '@UI.LineItem' ]
        },

        HeaderFacets: [
            {
                $Type  : 'UI.ReferenceFacet',
                Target : '@UI.FieldGroup#AircraftStatus',
                Label  : 'Status'
            },
            {
                $Type  : 'UI.ReferenceFacet',
                Target : '@UI.FieldGroup#FuelCapacity',
                Label  : 'Fuel Capacity'
            }
        ],

        FieldGroup#AircraftStatus: {
            Data: [
                { Value: is_active, Label: 'Active', Criticality: activeCriticality },
                { Value: status, Label: 'Status' }
            ]
        },

        FieldGroup#FuelCapacity: {
            Data: [
                { Value: fuel_capacity_kg, Label: 'Fuel Capacity (kg)' },
                { Value: cruise_burn_kgph, Label: 'Burn Rate (kg/hr)' }
            ]
        },

        Facets: [
            {
                $Type  : 'UI.ReferenceFacet',
                ID     : 'GeneralInfo',
                Label  : 'General Information',
                Target : '@UI.FieldGroup#AircraftGeneral'
            },
            {
                $Type  : 'UI.ReferenceFacet',
                ID     : 'Performance',
                Label  : 'Performance & Fleet',
                Target : '@UI.FieldGroup#Performance'
            },
            {
                $Type  : 'UI.ReferenceFacet',
                ID     : 'Administrative',
                Label  : 'Administrative',
                Target : '@UI.FieldGroup#AircraftAdmin'
            }
        ],

        FieldGroup#AircraftGeneral: {
            Label: 'General Information',
            Data: [
                { Value: type_code, Label: 'Type Code' },
                { Value: aircraft_model, Label: 'Aircraft Model' },
                { Value: manufacturer.manufacture_name, Label: 'Manufacturer' },
                { Value: manufacturer_code, Label: 'Manufacturer Code' },
                { Value: is_active, Label: 'Active' }
            ]
        },

        FieldGroup#Performance: {
            Label: 'Performance & Fleet',
            Data: [
                { Value: fuel_capacity_kg, Label: 'Fuel Capacity (kg)' },
                { Value: cruise_burn_kgph, Label: 'Cruise Burn Rate (kg/hr)' },
                { Value: mtow_kg, Label: 'Max Takeoff Weight (kg)' },
                { Value: fleet_size, Label: 'Fleet Size' },
                { Value: status, Label: 'Operational Status' }
            ]
        },

        FieldGroup#AircraftAdmin: {
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

// Field-level annotations for Aircraft
annotate service.Aircraft with {
    type_code        @title: 'Type Code';
    aircraft_model   @title: 'Aircraft Model';
    manufacturer_code @title: 'Manufacturer Code';
    fuel_capacity_kg @title: 'Fuel Capacity (kg)';
    mtow_kg          @title: 'MTOW (kg)';
    cruise_burn_kgph @title: 'Burn Rate (kg/hr)';
    fleet_size       @title: 'Fleet Size';
    status           @title: 'Status';
    is_active        @title: 'Active';
    created_at       @title: 'Created At';
    created_by       @title: 'Created By';
    modified_at      @title: 'Modified At';
    modified_by      @title: 'Modified By';
};

// Value Help for Manufacturer
annotate service.Aircraft with {
    manufacturer @(
        Common: {
            Text: manufacturer.manufacture_name,
            TextArrangement: #TextFirst,
            ValueList: {
                Label: 'Manufacturers',
                CollectionPath: 'Manufacturers',
                Parameters: [
                    { $Type: 'Common.ValueListParameterInOut', LocalDataProperty: manufacturer_code, ValueListProperty: 'manufacture_code' },
                    { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'manufacture_name' }
                ]
            }
        }
    );
};

// =============================================================================
// ROUTES - List Report (ROUTE_MASTER_001) + Object Page (ROUTE_DETAIL_001)
// =============================================================================

annotate service.Routes with @(
    Capabilities: {
        InsertRestrictions: { Insertable: true },
        UpdateRestrictions: { Updatable: true },
        DeleteRestrictions: { Deletable: true }
    }
);

annotate service.Routes with @(
    UI: {
        HeaderInfo: {
            TypeName       : 'Route',
            TypeNamePlural : 'Routes',
            Title          : { Value: route_code },
            Description    : { Value: status },
            ImageUrl       : 'sap-icon://map-2'
        },

        SelectionFields: [
            route_code,
            origin_airport,
            destination_airport,
            is_active
        ],

        LineItem: [
            { Value: route_code, Label: 'Route Code', ![@UI.Importance]: #High },
            { Value: origin.iata_code, Label: 'Origin', ![@UI.Importance]: #High },
            { Value: destination.iata_code, Label: 'Destination', ![@UI.Importance]: #High },
            { Value: distance_km, Label: 'Distance (km)', ![@UI.Importance]: #Medium },
            { Value: avg_flight_time, Label: 'Flight Time', ![@UI.Importance]: #Medium },
            { Value: fuel_required, Label: 'Fuel Required (kg)', ![@UI.Importance]: #High },
            {
                Value: is_active,
                Label: 'Status',
                Criticality: activeCriticality,
                ![@UI.Importance]: #High
            }
        ],

        PresentationVariant: {
            SortOrder: [
                { Property: route_code, Descending: false }
            ],
            Visualizations: [ '@UI.LineItem' ]
        },

        HeaderFacets: [
            {
                $Type  : 'UI.ReferenceFacet',
                Target : '@UI.FieldGroup#RouteStatus',
                Label  : 'Status'
            },
            {
                $Type  : 'UI.ReferenceFacet',
                Target : '@UI.FieldGroup#RouteDistance',
                Label  : 'Distance'
            },
            {
                $Type  : 'UI.ReferenceFacet',
                Target : '@UI.FieldGroup#RouteFuel',
                Label  : 'Fuel'
            }
        ],

        FieldGroup#RouteStatus: {
            Data: [
                { Value: is_active, Label: 'Active', Criticality: activeCriticality },
                { Value: status, Label: 'Status' }
            ]
        },

        FieldGroup#RouteDistance: {
            Data: [
                { Value: distance_km, Label: 'Distance (km)' },
                { Value: avg_flight_time, Label: 'Flight Time' }
            ]
        },

        FieldGroup#RouteFuel: {
            Data: [
                { Value: fuel_required, Label: 'Required (kg)' }
            ]
        },

        Facets: [
            {
                $Type  : 'UI.ReferenceFacet',
                ID     : 'GeneralInfo',
                Label  : 'General Information',
                Target : '@UI.FieldGroup#RouteGeneral'
            },
            {
                $Type  : 'UI.ReferenceFacet',
                ID     : 'Airports',
                Label  : 'Origin & Destination',
                Target : '@UI.FieldGroup#RouteAirports'
            },
            {
                $Type  : 'UI.ReferenceFacet',
                ID     : 'FlightData',
                Label  : 'Flight Data',
                Target : '@UI.FieldGroup#FlightData'
            },
            {
                $Type  : 'UI.ReferenceFacet',
                ID     : 'Administrative',
                Label  : 'Administrative',
                Target : '@UI.FieldGroup#RouteAdmin'
            }
        ],

        FieldGroup#RouteGeneral: {
            Label: 'General Information',
            Data: [
                { Value: route_code, Label: 'Route Code' },
                { Value: status, Label: 'Operational Status' },
                { Value: alternate_count, Label: 'Alternate Airports' },
                { Value: is_active, Label: 'Active' }
            ]
        },

        FieldGroup#RouteAirports: {
            Label: 'Origin & Destination',
            Data: [
                { Value: origin_airport, Label: 'Origin Code' },
                { Value: origin.iata_code, Label: 'Origin IATA' },
                { Value: origin.airport_name, Label: 'Origin Airport' },
                { Value: origin.city, Label: 'Origin City' },
                { Value: destination_airport, Label: 'Destination Code' },
                { Value: destination.iata_code, Label: 'Destination IATA' },
                { Value: destination.airport_name, Label: 'Destination Airport' },
                { Value: destination.city, Label: 'Destination City' }
            ]
        },

        FieldGroup#FlightData: {
            Label: 'Flight Data',
            Data: [
                { Value: distance_km, Label: 'Distance (km)' },
                { Value: avg_flight_time, Label: 'Average Flight Time' },
                { Value: fuel_required, Label: 'Fuel Required (kg)' }
            ]
        },

        FieldGroup#RouteAdmin: {
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

// Field-level annotations for Routes
annotate service.Routes with {
    route_code          @title: 'Route Code';
    origin_airport      @title: 'Origin';
    destination_airport @title: 'Destination';
    distance_km         @title: 'Distance (km)';
    avg_flight_time     @title: 'Flight Time';
    fuel_required       @title: 'Fuel Required (kg)';
    alternate_count     @title: 'Alternate Airports';
    status              @title: 'Status';
    is_active           @title: 'Active';
    created_at          @title: 'Created At';
    created_by          @title: 'Created By';
    modified_at         @title: 'Modified At';
    modified_by         @title: 'Modified By';
};

// Value Help for Origin/Destination
annotate service.Routes with {
    origin @(
        Common: {
            Text: origin.airport_name,
            TextArrangement: #TextFirst,
            ValueList: {
                Label: 'Airports',
                CollectionPath: 'Airports',
                Parameters: [
                    { $Type: 'Common.ValueListParameterInOut', LocalDataProperty: origin_airport, ValueListProperty: 'iata_code' },
                    { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'airport_name' },
                    { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'city' }
                ]
            }
        }
    );

    destination @(
        Common: {
            Text: destination.airport_name,
            TextArrangement: #TextFirst,
            ValueList: {
                Label: 'Airports',
                CollectionPath: 'Airports',
                Parameters: [
                    { $Type: 'Common.ValueListParameterInOut', LocalDataProperty: destination_airport, ValueListProperty: 'iata_code' },
                    { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'airport_name' },
                    { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'city' }
                ]
            }
        }
    );
};

// =============================================================================
// SUPPLIERS - Enhanced List Report + Object Page
// =============================================================================

annotate service.Suppliers with @(
    Capabilities: {
        InsertRestrictions: { Insertable: true },
        UpdateRestrictions: { Updatable: true },
        DeleteRestrictions: { Deletable: true }
    }
);

annotate service.Suppliers with @(
    UI: {
        HeaderInfo: {
            TypeName       : 'Supplier',
            TypeNamePlural : 'Suppliers',
            Title          : { Value: supplier_name },
            Description    : { Value: supplier_code },
            ImageUrl       : 'sap-icon://supplier'
        },

        SelectionFields: [
            supplier_code,
            supplier_name,
            supplier_type,
            country_code,
            is_active
        ],

        LineItem: [
            { Value: supplier_code, Label: 'Supplier Code', ![@UI.Importance]: #High },
            { Value: supplier_name, Label: 'Supplier Name', ![@UI.Importance]: #High },
            { Value: supplier_type, Label: 'Type', ![@UI.Importance]: #Medium },
            { Value: country_code, Label: 'Country', ![@UI.Importance]: #Medium },
            { Value: payment_terms, Label: 'Payment Terms', ![@UI.Importance]: #Low },
            { Value: s4_vendor_no, Label: 'S/4 Vendor', ![@UI.Importance]: #Low },
            {
                Value: is_active,
                Label: 'Status',
                Criticality: activeCriticality,
                ![@UI.Importance]: #High
            }
        ],

        PresentationVariant: {
            SortOrder: [
                { Property: supplier_name, Descending: false }
            ],
            Visualizations: [ '@UI.LineItem' ]
        },

        HeaderFacets: [
            {
                $Type  : 'UI.ReferenceFacet',
                Target : '@UI.FieldGroup#SupplierStatus',
                Label  : 'Status'
            },
            {
                $Type  : 'UI.ReferenceFacet',
                Target : '@UI.FieldGroup#SupplierType',
                Label  : 'Type'
            }
        ],

        FieldGroup#SupplierStatus: {
            Data: [
                { Value: is_active, Label: 'Active', Criticality: activeCriticality }
            ]
        },

        FieldGroup#SupplierType: {
            Data: [
                { Value: supplier_type, Label: 'Supplier Type' }
            ]
        },

        Facets: [
            {
                $Type  : 'UI.ReferenceFacet',
                ID     : 'GeneralInfo',
                Label  : 'General Information',
                Target : '@UI.FieldGroup#SupplierGeneral'
            },
            {
                $Type  : 'UI.ReferenceFacet',
                ID     : 'S4Integration',
                Label  : 'S/4HANA Integration',
                Target : '@UI.FieldGroup#SupplierS4'
            },
            {
                $Type  : 'UI.ReferenceFacet',
                ID     : 'Administrative',
                Label  : 'Administrative',
                Target : '@UI.FieldGroup#SupplierAdmin'
            }
        ],

        FieldGroup#SupplierGeneral: {
            Label: 'General Information',
            Data: [
                { Value: supplier_code, Label: 'Supplier Code' },
                { Value: supplier_name, Label: 'Supplier Name' },
                { Value: supplier_type, Label: 'Supplier Type' },
                { Value: country_code, Label: 'Country Code' },
                { Value: country.landx, Label: 'Country Name' },
                { Value: is_active, Label: 'Active' }
            ]
        },

        FieldGroup#SupplierS4: {
            Label: 'S/4HANA Integration',
            Data: [
                { Value: s4_vendor_no, Label: 'S/4 Vendor Number' },
                { Value: payment_terms, Label: 'Payment Terms' }
            ]
        },

        FieldGroup#SupplierAdmin: {
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

// Field-level annotations for Suppliers
annotate service.Suppliers with {
    ID              @UI.Hidden;
    supplier_code   @title: 'Supplier Code';
    supplier_name   @title: 'Supplier Name';
    supplier_type   @title: 'Supplier Type';
    country_code    @title: 'Country';
    payment_terms   @title: 'Payment Terms';
    s4_vendor_no    @title: 'S/4 Vendor Number';
    is_active       @title: 'Active';
    created_at      @title: 'Created At';
    created_by      @title: 'Created By';
    modified_at     @title: 'Modified At';
    modified_by     @title: 'Modified By';
};

// =============================================================================
// PRODUCTS - Enhanced List Report + Object Page
// =============================================================================

annotate service.Products with @(
    Capabilities: {
        InsertRestrictions: { Insertable: true },
        UpdateRestrictions: { Updatable: true },
        DeleteRestrictions: { Deletable: true }
    }
);

annotate service.Products with @(
    UI: {
        HeaderInfo: {
            TypeName       : 'Product',
            TypeNamePlural : 'Products',
            Title          : { Value: product_name },
            Description    : { Value: product_code },
            ImageUrl       : 'sap-icon://product'
        },

        SelectionFields: [
            product_code,
            product_name,
            product_type,
            is_active
        ],

        LineItem: [
            { Value: product_code, Label: 'Product Code', ![@UI.Importance]: #High },
            { Value: product_name, Label: 'Product Name', ![@UI.Importance]: #High },
            { Value: product_type, Label: 'Product Type', ![@UI.Importance]: #Medium },
            { Value: specification, Label: 'Specification', ![@UI.Importance]: #Medium },
            { Value: uom_code, Label: 'UoM', ![@UI.Importance]: #Low },
            { Value: s4_material_number, Label: 'S/4 Material', ![@UI.Importance]: #Low },
            {
                Value: is_active,
                Label: 'Status',
                Criticality: activeCriticality,
                ![@UI.Importance]: #High
            }
        ],

        PresentationVariant: {
            SortOrder: [
                { Property: product_code, Descending: false }
            ],
            Visualizations: [ '@UI.LineItem' ]
        },

        Facets: [
            {
                $Type  : 'UI.ReferenceFacet',
                ID     : 'GeneralInfo',
                Label  : 'General Information',
                Target : '@UI.FieldGroup#ProductGeneral'
            },
            {
                $Type  : 'UI.ReferenceFacet',
                ID     : 'Specifications',
                Label  : 'Specifications',
                Target : '@UI.FieldGroup#ProductSpecs'
            },
            {
                $Type  : 'UI.ReferenceFacet',
                ID     : 'S4Integration',
                Label  : 'S/4HANA Integration',
                Target : '@UI.FieldGroup#ProductS4'
            },
            {
                $Type  : 'UI.ReferenceFacet',
                ID     : 'Administrative',
                Label  : 'Administrative',
                Target : '@UI.FieldGroup#ProductAdmin'
            }
        ],

        FieldGroup#ProductGeneral: {
            Label: 'General Information',
            Data: [
                { Value: product_code, Label: 'Product Code' },
                { Value: product_name, Label: 'Product Name' },
                { Value: product_type, Label: 'Product Type' },
                { Value: is_active, Label: 'Active' }
            ]
        },

        FieldGroup#ProductSpecs: {
            Label: 'Specifications',
            Data: [
                { Value: specification, Label: 'Specification' },
                { Value: uom_code, Label: 'Unit of Measure' },
                { Value: uom.uom_name, Label: 'UoM Name' }
            ]
        },

        FieldGroup#ProductS4: {
            Label: 'S/4HANA Integration',
            Data: [
                { Value: s4_material_number, Label: 'S/4 Material Number' }
            ]
        },

        FieldGroup#ProductAdmin: {
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

// Field-level annotations for Products
annotate service.Products with {
    ID                  @UI.Hidden;
    product_code        @title: 'Product Code';
    product_name        @title: 'Product Name';
    product_type        @title: 'Product Type';
    specification       @title: 'Specification';
    uom_code            @title: 'UoM';
    s4_material_number  @title: 'S/4 Material Number';
    is_active           @title: 'Active';
    created_at          @title: 'Created At';
    created_by          @title: 'Created By';
    modified_at         @title: 'Modified At';
    modified_by         @title: 'Modified By';
};

// =============================================================================
// CONTRACTS - Enhanced List Report + Object Page
// =============================================================================

annotate service.Contracts with @(
    Capabilities: {
        InsertRestrictions: { Insertable: true },
        UpdateRestrictions: { Updatable: true },
        DeleteRestrictions: { Deletable: true }
    }
);

annotate service.Contracts with @(
    UI: {
        HeaderInfo: {
            TypeName       : 'Contract',
            TypeNamePlural : 'Contracts',
            Title          : { Value: contract_name },
            Description    : { Value: contract_number },
            ImageUrl       : 'sap-icon://document'
        },

        SelectionFields: [
            contract_number,
            contract_type,
            supplier_ID,
            valid_from,
            valid_to,
            is_active
        ],

        LineItem: [
            { Value: contract_number, Label: 'Contract Number', ![@UI.Importance]: #High },
            { Value: contract_name, Label: 'Contract Name', ![@UI.Importance]: #High },
            { Value: contract_type, Label: 'Type', ![@UI.Importance]: #Medium },
            { Value: supplier.supplier_name, Label: 'Supplier', ![@UI.Importance]: #High },
            { Value: valid_from, Label: 'Valid From', ![@UI.Importance]: #Medium },
            { Value: valid_to, Label: 'Valid To', ![@UI.Importance]: #Medium },
            { Value: price_type, Label: 'Price Type', ![@UI.Importance]: #Medium },
            { Value: currency_code, Label: 'Currency', ![@UI.Importance]: #Low },
            {
                Value: is_active,
                Label: 'Status',
                Criticality: activeCriticality,
                ![@UI.Importance]: #High
            }
        ],

        PresentationVariant: {
            SortOrder: [
                { Property: valid_to, Descending: true }
            ],
            Visualizations: [ '@UI.LineItem' ]
        },

        HeaderFacets: [
            {
                $Type  : 'UI.ReferenceFacet',
                Target : '@UI.FieldGroup#ContractStatus',
                Label  : 'Status'
            },
            {
                $Type  : 'UI.ReferenceFacet',
                Target : '@UI.FieldGroup#ContractValidity',
                Label  : 'Validity'
            }
        ],

        FieldGroup#ContractStatus: {
            Data: [
                { Value: is_active, Label: 'Active', Criticality: activeCriticality },
                { Value: contract_type, Label: 'Type' }
            ]
        },

        FieldGroup#ContractValidity: {
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
                Target : '@UI.FieldGroup#ContractGeneral'
            },
            {
                $Type  : 'UI.ReferenceFacet',
                ID     : 'Parties',
                Label  : 'Contract Parties',
                Target : '@UI.FieldGroup#ContractParties'
            },
            {
                $Type  : 'UI.ReferenceFacet',
                ID     : 'Pricing',
                Label  : 'Pricing & Volume',
                Target : '@UI.FieldGroup#ContractPricing'
            },
            {
                $Type  : 'UI.ReferenceFacet',
                ID     : 'S4Integration',
                Label  : 'S/4HANA Integration',
                Target : '@UI.FieldGroup#ContractS4'
            },
            {
                $Type  : 'UI.ReferenceFacet',
                ID     : 'Administrative',
                Label  : 'Administrative',
                Target : '@UI.FieldGroup#ContractAdmin'
            }
        ],

        FieldGroup#ContractGeneral: {
            Label: 'General Information',
            Data: [
                { Value: contract_number, Label: 'Contract Number' },
                { Value: contract_name, Label: 'Contract Name' },
                { Value: contract_type, Label: 'Contract Type' },
                { Value: valid_from, Label: 'Valid From' },
                { Value: valid_to, Label: 'Valid To' },
                { Value: is_active, Label: 'Active' }
            ]
        },

        FieldGroup#ContractParties: {
            Label: 'Contract Parties',
            Data: [
                { Value: supplier.supplier_name, Label: 'Supplier Name' },
                { Value: supplier.supplier_code, Label: 'Supplier Code' }
            ]
        },

        FieldGroup#ContractPricing: {
            Label: 'Pricing & Volume',
            Data: [
                { Value: price_type, Label: 'Price Type' },
                { Value: currency_code, Label: 'Currency' },
                { Value: currency.currency_name, Label: 'Currency Name' },
                { Value: payment_terms, Label: 'Payment Terms' },
                { Value: incoterms, Label: 'Incoterms' },
                { Value: min_volume_kg, Label: 'Min Volume (kg)' },
                { Value: max_volume_kg, Label: 'Max Volume (kg)' }
            ]
        },

        FieldGroup#ContractS4: {
            Label: 'S/4HANA Integration',
            Data: [
                { Value: s4_contract_number, Label: 'S/4 Contract Number' }
            ]
        },

        FieldGroup#ContractAdmin: {
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

// Field-level annotations for Contracts
annotate service.Contracts with {
    ID                  @UI.Hidden;
    contract_number     @title: 'Contract Number';
    contract_name       @title: 'Contract Name';
    contract_type       @title: 'Contract Type';
    price_type          @title: 'Price Type';
    valid_from          @title: 'Valid From';
    valid_to            @title: 'Valid To';
    currency_code       @title: 'Currency';
    payment_terms       @title: 'Payment Terms';
    incoterms           @title: 'Incoterms';
    min_volume_kg       @title: 'Min Volume (kg)';
    max_volume_kg       @title: 'Max Volume (kg)';
    s4_contract_number  @title: 'S/4 Contract Number';
    is_active           @title: 'Active';
    created_at          @title: 'Created At';
    created_by          @title: 'Created By';
    modified_at         @title: 'Modified At';
    modified_by         @title: 'Modified By';
};

// Value Help for Contract associations
annotate service.Contracts with {
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

    currency @(
        Common: {
            Text: currency.currency_name,
            TextArrangement: #TextFirst,
            ValueList: {
                Label: 'Currencies',
                CollectionPath: 'Currencies',
                Parameters: [
                    { $Type: 'Common.ValueListParameterInOut', LocalDataProperty: currency_code, ValueListProperty: 'currency_code' },
                    { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'currency_name' }
                ]
            }
        }
    );
};

// =============================================================================
// MANUFACTURERS - Enhanced List Report + Object Page
// =============================================================================

annotate service.Manufacturers with @(
    Capabilities: {
        InsertRestrictions: { Insertable: true },
        UpdateRestrictions: { Updatable: true },
        DeleteRestrictions: { Deletable: true }
    }
);

annotate service.Manufacturers with @(
    UI: {
        HeaderInfo: {
            TypeName       : 'Manufacturer',
            TypeNamePlural : 'Manufacturers',
            Title          : { Value: manufacture_name },
            Description    : { Value: manufacture_code },
            ImageUrl       : 'sap-icon://factory'
        },

        SelectionFields: [
            manufacture_code,
            manufacture_name,
            is_active
        ],

        LineItem: [
            { Value: manufacture_code, Label: 'Manufacturer Code', ![@UI.Importance]: #High },
            { Value: manufacture_name, Label: 'Manufacturer Name', ![@UI.Importance]: #High },
            {
                Value: is_active,
                Label: 'Status',
                Criticality: activeCriticality,
                ![@UI.Importance]: #High
            }
        ],

        Facets: [
            {
                $Type  : 'UI.ReferenceFacet',
                ID     : 'GeneralInfo',
                Label  : 'General Information',
                Target : '@UI.FieldGroup#ManufacturerGeneral'
            },
            {
                $Type  : 'UI.ReferenceFacet',
                ID     : 'Administrative',
                Label  : 'Administrative',
                Target : '@UI.FieldGroup#ManufacturerAdmin'
            }
        ],

        FieldGroup#ManufacturerGeneral: {
            Label: 'General Information',
            Data: [
                { Value: manufacture_code, Label: 'Manufacturer Code' },
                { Value: manufacture_name, Label: 'Manufacturer Name' },
                { Value: is_active, Label: 'Active' }
            ]
        },

        FieldGroup#ManufacturerAdmin: {
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

// Field-level annotations for Manufacturers
annotate service.Manufacturers with {
    manufacture_code @title: 'Manufacturer Code';
    manufacture_name @title: 'Manufacturer Name';
    is_active        @title: 'Active';
    created_at       @title: 'Created At';
    created_by       @title: 'Created By';
    modified_at      @title: 'Modified At';
    modified_by      @title: 'Modified By';
};

// =============================================================================
// REFERENCE DATA (Read-Only - S/4HANA Synchronized)
// =============================================================================

annotate service.Countries with @(
    Capabilities: {
        InsertRestrictions: { Insertable: false },
        UpdateRestrictions: { Updatable: false },
        DeleteRestrictions: { Deletable: false }
    }
);

annotate service.Countries with @(
    UI: {
        HeaderInfo: {
            TypeName       : 'Country',
            TypeNamePlural : 'Countries',
            Title          : { Value: landx },
            Description    : { Value: land1 }
        },
        SelectionFields: [ land1, landgr, is_embargoed ],
        LineItem: [
            { Value: land1, Label: 'Country Code', ![@UI.Importance]: #High },
            { Value: landx, Label: 'Country Name', ![@UI.Importance]: #High },
            { Value: landgr, Label: 'Region', ![@UI.Importance]: #Medium },
            { Value: currcode, Label: 'Currency', ![@UI.Importance]: #Medium },
            { Value: is_active, Label: 'Active', ![@UI.Importance]: #High },
            { Value: is_embargoed, Label: 'Embargoed', ![@UI.Importance]: #High }
        ],
        Facets: [
            {
                $Type  : 'UI.ReferenceFacet',
                ID     : 'GeneralInfo',
                Target : '@UI.FieldGroup#CountryDetails',
                Label  : 'General Information'
            },
            {
                $Type  : 'UI.ReferenceFacet',
                ID     : 'ComplianceInfo',
                Target : '@UI.FieldGroup#ComplianceInfo',
                Label  : 'Compliance'
            }
        ],
        FieldGroup#CountryDetails: {
            Data: [
                { Value: land1, Label: 'Country Code' },
                { Value: landx, Label: 'Country Name' },
                { Value: landx50, Label: 'Full Name' },
                { Value: landgr, Label: 'Region' },
                { Value: currcode, Label: 'Currency' },
                { Value: natio, Label: 'Nationality' },
                { Value: spras, Label: 'Language' },
                { Value: is_active, Label: 'Active' }
            ]
        },
        FieldGroup#ComplianceInfo: {
            Data: [
                { Value: is_embargoed, Label: 'Embargoed' },
                { Value: embargo_effective_date, Label: 'Embargo Date' },
                { Value: embargo_reason, Label: 'Embargo Reason' },
                { Value: sanction_programs, Label: 'Sanction Programs' },
                { Value: risk_level, Label: 'Risk Level' }
            ]
        }
    }
);

// Field-level annotations for Countries
annotate service.Countries with {
    land1                   @title: 'Country Code';
    landx                   @title: 'Country Name';
    landx50                 @title: 'Full Name';
    natio                   @title: 'Nationality';
    landgr                  @title: 'Region';
    currcode                @title: 'Currency';
    spras                   @title: 'Language';
    is_active               @title: 'Active';
    is_embargoed            @title: 'Embargoed';
    embargo_effective_date  @title: 'Embargo Date';
    embargo_reason          @title: 'Embargo Reason';
    sanction_programs       @title: 'Sanction Programs';
    risk_level              @title: 'Risk Level';
};

annotate service.Currencies with @(
    Capabilities: {
        InsertRestrictions: { Insertable: false },
        UpdateRestrictions: { Updatable: false },
        DeleteRestrictions: { Deletable: false }
    }
);

annotate service.Currencies with @(
    UI: {
        HeaderInfo: {
            TypeName       : 'Currency',
            TypeNamePlural : 'Currencies',
            Title          : { Value: currency_name },
            Description    : { Value: currency_code }
        },
        SelectionFields: [ currency_code ],
        LineItem: [
            { Value: currency_code, Label: 'Currency Code', ![@UI.Importance]: #High },
            { Value: currency_name, Label: 'Currency Name', ![@UI.Importance]: #High },
            { Value: symbol, Label: 'Symbol', ![@UI.Importance]: #Medium },
            { Value: is_active, Label: 'Active', ![@UI.Importance]: #High }
        ],
        Facets: [
            {
                $Type  : 'UI.ReferenceFacet',
                ID     : 'CurrencyDetails',
                Target : '@UI.FieldGroup#CurrencyDetails',
                Label  : 'Currency Details'
            }
        ],
        FieldGroup#CurrencyDetails: {
            Data: [
                { Value: currency_code, Label: 'Currency Code' },
                { Value: currency_name, Label: 'Currency Name' },
                { Value: symbol, Label: 'Symbol' },
                { Value: decimal_places, Label: 'Decimal Places' },
                { Value: is_active, Label: 'Active' }
            ]
        }
    }
);

// Field-level annotations for Currencies
annotate service.Currencies with {
    currency_code   @title: 'Currency Code';
    currency_name   @title: 'Currency Name';
    symbol          @title: 'Symbol';
    decimal_places  @title: 'Decimal Places';
    is_active       @title: 'Active';
};

annotate service.Plants with @(
    Capabilities: {
        InsertRestrictions: { Insertable: false },
        UpdateRestrictions: { Updatable: false },
        DeleteRestrictions: { Deletable: false }
    }
);

annotate service.Plants with @(
    UI: {
        HeaderInfo: {
            TypeName       : 'Plant',
            TypeNamePlural : 'Plants',
            Title          : { Value: name1 },
            Description    : { Value: werks }
        },
        SelectionFields: [ werks, ort01 ],
        LineItem: [
            { Value: werks, Label: 'Plant Code', ![@UI.Importance]: #High },
            { Value: name1, Label: 'Plant Name', ![@UI.Importance]: #High },
            { Value: ort01, Label: 'City', ![@UI.Importance]: #Medium },
            { Value: land1_land1, Label: 'Country', ![@UI.Importance]: #Medium },
            { Value: is_active, Label: 'Active', ![@UI.Importance]: #High }
        ],
        Facets: [
            {
                $Type  : 'UI.ReferenceFacet',
                ID     : 'PlantDetails',
                Target : '@UI.FieldGroup#PlantDetails',
                Label  : 'Plant Details'
            },
            {
                $Type  : 'UI.ReferenceFacet',
                ID     : 'PlantAddress',
                Target : '@UI.FieldGroup#PlantAddress',
                Label  : 'Address'
            }
        ],
        FieldGroup#PlantDetails: {
            Data: [
                { Value: werks, Label: 'Plant Code' },
                { Value: name1, Label: 'Plant Name' },
                { Value: spras, Label: 'Language' },
                { Value: is_active, Label: 'Active' }
            ]
        },
        FieldGroup#PlantAddress: {
            Data: [
                { Value: stras, Label: 'Street' },
                { Value: ort01, Label: 'City' },
                { Value: regio, Label: 'Region' },
                { Value: pstlz, Label: 'Postal Code' },
                { Value: land1_land1, Label: 'Country' }
            ]
        }
    }
);

// Field-level annotations for Plants
annotate service.Plants with {
    werks       @title: 'Plant Code';
    name1       @title: 'Plant Name';
    stras       @title: 'Street';
    ort01       @title: 'City';
    regio       @title: 'Region';
    pstlz       @title: 'Postal Code';
    land1_land1 @title: 'Country';
    spras       @title: 'Language';
    is_active   @title: 'Active';
};

annotate service.UnitsOfMeasure with @(
    Capabilities: {
        InsertRestrictions: { Insertable: false },
        UpdateRestrictions: { Updatable: false },
        DeleteRestrictions: { Deletable: false }
    }
);

annotate service.UnitsOfMeasure with @(
    UI: {
        HeaderInfo: {
            TypeName       : 'Unit of Measure',
            TypeNamePlural : 'Units of Measure',
            Title          : { Value: uom_name },
            Description    : { Value: uom_code }
        },
        SelectionFields: [ uom_code, uom_category ],
        LineItem: [
            { Value: uom_code, Label: 'UoM Code', ![@UI.Importance]: #High },
            { Value: uom_name, Label: 'UoM Name', ![@UI.Importance]: #High },
            { Value: uom_category, Label: 'Category', ![@UI.Importance]: #Medium },
            { Value: is_active, Label: 'Active', ![@UI.Importance]: #High }
        ],
        Facets: [
            {
                $Type  : 'UI.ReferenceFacet',
                ID     : 'UoMDetails',
                Target : '@UI.FieldGroup#UoMDetails',
                Label  : 'Unit of Measure Details'
            }
        ],
        FieldGroup#UoMDetails: {
            Data: [
                { Value: uom_code, Label: 'UoM Code' },
                { Value: uom_name, Label: 'UoM Name' },
                { Value: uom_category, Label: 'Category' },
                { Value: conversion_to_kg, Label: 'Conversion to KG' },
                { Value: is_active, Label: 'Active' }
            ]
        }
    }
);

// Field-level annotations for UnitsOfMeasure
annotate service.UnitsOfMeasure with {
    uom_code        @title: 'UoM Code';
    uom_name        @title: 'UoM Name';
    uom_category    @title: 'Category';
    conversion_to_kg @title: 'Conversion to KG';
    is_active       @title: 'Active';
};
