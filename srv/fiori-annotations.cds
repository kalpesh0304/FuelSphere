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
                { Value: alternate_name, Label: 'Alternate Name' },
                { Value: is_active, Label: 'Active' }
            ]
        },

        FieldGroup#GeographicInfo: {
            Label: 'Geographic Details',
            Data: [
                { Value: city, Label: 'City' },
                { Value: country_code, Label: 'Country Code' },
                { Value: country.landx, Label: 'Country Name' },
                { Value: latitude, Label: 'Latitude' },
                { Value: longitude, Label: 'Longitude' },
                { Value: elevation_ft, Label: 'Elevation (ft)' },
                { Value: timezone, Label: 'Timezone' }
            ]
        },

        FieldGroup#S4Integration: {
            Label: 'S/4HANA Integration',
            Data: [
                { Value: s4_plant_code, Label: 'Plant Code' },
                { Value: s4_storage_location, Label: 'Storage Location' },
                { Value: s4_profit_center, Label: 'Profit Center' },
                { Value: s4_cost_center, Label: 'Cost Center' }
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
    iata_code       @title: 'IATA Code' @mandatory;
    icao_code       @title: 'ICAO Code';
    airport_name    @title: 'Airport Name' @mandatory;
    alternate_name  @title: 'Alternate Name';
    city            @title: 'City' @mandatory;
    country_code    @title: 'Country' @mandatory;
    latitude        @title: 'Latitude';
    longitude       @title: 'Longitude';
    elevation_ft    @title: 'Elevation (ft)';
    timezone        @title: 'Timezone';
    s4_plant_code   @title: 'S/4 Plant Code';
    s4_storage_location @title: 'Storage Location';
    s4_profit_center @title: 'Profit Center';
    s4_cost_center  @title: 'Cost Center';
    is_active       @title: 'Active';
    created_at      @title: 'Created At' @Common.FieldControl: #ReadOnly;
    created_by      @title: 'Created By' @Common.FieldControl: #ReadOnly;
    modified_at     @title: 'Modified At' @Common.FieldControl: #ReadOnly;
    modified_by     @title: 'Modified By' @Common.FieldControl: #ReadOnly;
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
            Title          : { Value: aircraft_type },
            Description    : { Value: iata_code },
            ImageUrl       : 'sap-icon://flight'
        },

        SelectionFields: [
            aircraft_type,
            iata_code,
            manufacturer_ID,
            is_active
        ],

        LineItem: [
            { Value: aircraft_type, Label: 'Aircraft Type', ![@UI.Importance]: #High },
            { Value: iata_code, Label: 'IATA Code', ![@UI.Importance]: #High },
            { Value: icao_code, Label: 'ICAO Code', ![@UI.Importance]: #Medium },
            { Value: manufacturer.manufacturer_name, Label: 'Manufacturer', ![@UI.Importance]: #Medium },
            { Value: max_fuel_capacity_kg, Label: 'Max Fuel (kg)', ![@UI.Importance]: #High },
            { Value: fuel_burn_rate_kg_hr, Label: 'Burn Rate (kg/hr)', ![@UI.Importance]: #Medium },
            { Value: mtow_kg, Label: 'MTOW (kg)', ![@UI.Importance]: #Low },
            {
                Value: is_active,
                Label: 'Status',
                Criticality: activeCriticality,
                ![@UI.Importance]: #High
            }
        ],

        PresentationVariant: {
            SortOrder: [
                { Property: aircraft_type, Descending: false }
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
                { Value: is_active, Label: 'Active', Criticality: activeCriticality }
            ]
        },

        FieldGroup#FuelCapacity: {
            Data: [
                { Value: max_fuel_capacity_kg, Label: 'Max Capacity (kg)' },
                { Value: fuel_burn_rate_kg_hr, Label: 'Burn Rate (kg/hr)' }
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
                ID     : 'FuelSpecs',
                Label  : 'Fuel Specifications',
                Target : '@UI.FieldGroup#FuelSpecs'
            },
            {
                $Type  : 'UI.ReferenceFacet',
                ID     : 'Performance',
                Label  : 'Performance Data',
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
                { Value: aircraft_type, Label: 'Aircraft Type' },
                { Value: iata_code, Label: 'IATA Code' },
                { Value: icao_code, Label: 'ICAO Code' },
                { Value: manufacturer.manufacturer_name, Label: 'Manufacturer' },
                { Value: category, Label: 'Category' },
                { Value: engine_type, Label: 'Engine Type' },
                { Value: engine_count, Label: 'Number of Engines' },
                { Value: is_active, Label: 'Active' }
            ]
        },

        FieldGroup#FuelSpecs: {
            Label: 'Fuel Specifications',
            Data: [
                { Value: max_fuel_capacity_kg, Label: 'Max Fuel Capacity (kg)' },
                { Value: max_fuel_capacity_liters, Label: 'Max Fuel Capacity (L)' },
                { Value: fuel_burn_rate_kg_hr, Label: 'Fuel Burn Rate (kg/hr)' },
                { Value: taxi_fuel_kg, Label: 'Taxi Fuel (kg)' },
                { Value: reserve_fuel_kg, Label: 'Reserve Fuel (kg)' },
                { Value: min_landing_fuel_kg, Label: 'Min Landing Fuel (kg)' }
            ]
        },

        FieldGroup#Performance: {
            Label: 'Performance Data',
            Data: [
                { Value: mtow_kg, Label: 'Max Takeoff Weight (kg)' },
                { Value: max_payload_kg, Label: 'Max Payload (kg)' },
                { Value: max_range_km, Label: 'Max Range (km)' },
                { Value: cruise_speed_kmh, Label: 'Cruise Speed (km/h)' },
                { Value: passenger_capacity, Label: 'Passenger Capacity' }
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
    ID                      @UI.Hidden;
    aircraft_type           @title: 'Aircraft Type' @mandatory;
    iata_code               @title: 'IATA Code' @mandatory;
    icao_code               @title: 'ICAO Code';
    category                @title: 'Category';
    engine_type             @title: 'Engine Type';
    engine_count            @title: 'Engine Count';
    max_fuel_capacity_kg    @title: 'Max Fuel (kg)' @mandatory;
    max_fuel_capacity_liters @title: 'Max Fuel (L)';
    fuel_burn_rate_kg_hr    @title: 'Burn Rate (kg/hr)';
    taxi_fuel_kg            @title: 'Taxi Fuel (kg)';
    reserve_fuel_kg         @title: 'Reserve Fuel (kg)';
    min_landing_fuel_kg     @title: 'Min Landing Fuel (kg)';
    mtow_kg                 @title: 'MTOW (kg)';
    max_payload_kg          @title: 'Max Payload (kg)';
    max_range_km            @title: 'Max Range (km)';
    cruise_speed_kmh        @title: 'Cruise Speed (km/h)';
    passenger_capacity      @title: 'Passenger Capacity';
    is_active               @title: 'Active';
};

// Value Help for Manufacturer
annotate service.Aircraft with {
    manufacturer @(
        Common: {
            Text: manufacturer.manufacturer_name,
            TextArrangement: #TextFirst,
            ValueList: {
                Label: 'Manufacturers',
                CollectionPath: 'Manufacturers',
                Parameters: [
                    { $Type: 'Common.ValueListParameterInOut', LocalDataProperty: manufacturer_ID, ValueListProperty: 'ID' },
                    { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'manufacturer_code' },
                    { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'manufacturer_name' }
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
            Description    : { Value: route_name },
            ImageUrl       : 'sap-icon://map-2'
        },

        SelectionFields: [
            route_code,
            origin_ID,
            destination_ID,
            is_active
        ],

        LineItem: [
            { Value: route_code, Label: 'Route Code', ![@UI.Importance]: #High },
            { Value: route_name, Label: 'Route Name', ![@UI.Importance]: #High },
            { Value: origin.iata_code, Label: 'Origin', ![@UI.Importance]: #High },
            { Value: destination.iata_code, Label: 'Destination', ![@UI.Importance]: #High },
            { Value: distance_km, Label: 'Distance (km)', ![@UI.Importance]: #Medium },
            { Value: flight_time_mins, Label: 'Flight Time (min)', ![@UI.Importance]: #Medium },
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
                { Value: is_active, Label: 'Active', Criticality: activeCriticality }
            ]
        },

        FieldGroup#RouteDistance: {
            Data: [
                { Value: distance_km, Label: 'Distance (km)' },
                { Value: flight_time_mins, Label: 'Flight Time (min)' }
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
                ID     : 'FuelCalculation',
                Label  : 'Fuel Calculation',
                Target : '@UI.FieldGroup#FuelCalculation'
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
                { Value: route_name, Label: 'Route Name' },
                { Value: route_type, Label: 'Route Type' },
                { Value: is_active, Label: 'Active' }
            ]
        },

        FieldGroup#RouteAirports: {
            Label: 'Origin & Destination',
            Data: [
                { Value: origin.iata_code, Label: 'Origin IATA' },
                { Value: origin.airport_name, Label: 'Origin Airport' },
                { Value: origin.city, Label: 'Origin City' },
                { Value: destination.iata_code, Label: 'Destination IATA' },
                { Value: destination.airport_name, Label: 'Destination Airport' },
                { Value: destination.city, Label: 'Destination City' }
            ]
        },

        FieldGroup#FlightData: {
            Label: 'Flight Data',
            Data: [
                { Value: distance_km, Label: 'Distance (km)' },
                { Value: distance_nm, Label: 'Distance (nm)' },
                { Value: flight_time_mins, Label: 'Flight Time (min)' },
                { Value: block_time_mins, Label: 'Block Time (min)' }
            ]
        },

        FieldGroup#FuelCalculation: {
            Label: 'Fuel Calculation',
            Data: [
                { Value: fuel_required, Label: 'Fuel Required (kg)' },
                { Value: contingency_fuel, Label: 'Contingency Fuel (kg)' },
                { Value: alternate_fuel, Label: 'Alternate Fuel (kg)' },
                { Value: reserve_fuel, Label: 'Reserve Fuel (kg)' },
                { Value: total_fuel, Label: 'Total Fuel (kg)' }
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
    ID               @UI.Hidden;
    route_code       @title: 'Route Code' @mandatory;
    route_name       @title: 'Route Name' @mandatory;
    route_type       @title: 'Route Type';
    distance_km      @title: 'Distance (km)' @mandatory;
    distance_nm      @title: 'Distance (nm)';
    flight_time_mins @title: 'Flight Time (min)';
    block_time_mins  @title: 'Block Time (min)';
    fuel_required    @title: 'Fuel Required (kg)' @mandatory;
    contingency_fuel @title: 'Contingency Fuel (kg)';
    alternate_fuel   @title: 'Alternate Fuel (kg)';
    reserve_fuel     @title: 'Reserve Fuel (kg)';
    total_fuel       @title: 'Total Fuel (kg)';
    is_active        @title: 'Active';
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
                    { $Type: 'Common.ValueListParameterInOut', LocalDataProperty: origin_ID, ValueListProperty: 'ID' },
                    { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'iata_code' },
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
                    { $Type: 'Common.ValueListParameterInOut', LocalDataProperty: destination_ID, ValueListProperty: 'ID' },
                    { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'iata_code' },
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
            { Value: city, Label: 'City', ![@UI.Importance]: #Medium },
            { Value: country_code, Label: 'Country', ![@UI.Importance]: #Medium },
            { Value: s4_vendor_code, Label: 'S/4 Vendor', ![@UI.Importance]: #Low },
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
                ID     : 'Address',
                Label  : 'Address',
                Target : '@UI.FieldGroup#SupplierAddress'
            },
            {
                $Type  : 'UI.ReferenceFacet',
                ID     : 'Contact',
                Label  : 'Contact Information',
                Target : '@UI.FieldGroup#SupplierContact'
            },
            {
                $Type  : 'UI.ReferenceFacet',
                ID     : 'S4Integration',
                Label  : 'S/4HANA Integration',
                Target : '@UI.FieldGroup#SupplierS4'
            },
            {
                $Type  : 'UI.ReferenceFacet',
                ID     : 'Contracts',
                Label  : 'Contracts',
                Target : 'contracts/@UI.LineItem'
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
                { Value: tax_id, Label: 'Tax ID' },
                { Value: is_active, Label: 'Active' }
            ]
        },

        FieldGroup#SupplierAddress: {
            Label: 'Address',
            Data: [
                { Value: address_line1, Label: 'Address Line 1' },
                { Value: address_line2, Label: 'Address Line 2' },
                { Value: city, Label: 'City' },
                { Value: state_region, Label: 'State/Region' },
                { Value: postal_code, Label: 'Postal Code' },
                { Value: country_code, Label: 'Country' }
            ]
        },

        FieldGroup#SupplierContact: {
            Label: 'Contact Information',
            Data: [
                { Value: contact_person, Label: 'Contact Person' },
                { Value: phone, Label: 'Phone' },
                { Value: email, Label: 'Email' },
                { Value: website, Label: 'Website' }
            ]
        },

        FieldGroup#SupplierS4: {
            Label: 'S/4HANA Integration',
            Data: [
                { Value: s4_vendor_code, Label: 'Vendor Code' },
                { Value: s4_company_code, Label: 'Company Code' },
                { Value: s4_purchasing_org, Label: 'Purchasing Org' },
                { Value: payment_terms, Label: 'Payment Terms' },
                { Value: currency_code, Label: 'Currency' }
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
            product_category,
            is_active
        ],

        LineItem: [
            { Value: product_code, Label: 'Product Code', ![@UI.Importance]: #High },
            { Value: product_name, Label: 'Product Name', ![@UI.Importance]: #High },
            { Value: product_category, Label: 'Category', ![@UI.Importance]: #Medium },
            { Value: specification, Label: 'Specification', ![@UI.Importance]: #Medium },
            { Value: base_uom, Label: 'Base UoM', ![@UI.Importance]: #Low },
            { Value: s4_material_code, Label: 'S/4 Material', ![@UI.Importance]: #Low },
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
                { Value: product_category, Label: 'Category' },
                { Value: product_type, Label: 'Type' },
                { Value: is_active, Label: 'Active' }
            ]
        },

        FieldGroup#ProductSpecs: {
            Label: 'Specifications',
            Data: [
                { Value: specification, Label: 'Specification' },
                { Value: base_uom, Label: 'Base UoM' },
                { Value: density_at_15c, Label: 'Density @ 15°C' },
                { Value: flash_point_celsius, Label: 'Flash Point (°C)' },
                { Value: freeze_point_celsius, Label: 'Freeze Point (°C)' }
            ]
        },

        FieldGroup#ProductS4: {
            Label: 'S/4HANA Integration',
            Data: [
                { Value: s4_material_code, Label: 'Material Code' },
                { Value: s4_material_group, Label: 'Material Group' },
                { Value: s4_valuation_class, Label: 'Valuation Class' }
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
            { Value: total_value, Label: 'Total Value', ![@UI.Importance]: #Medium },
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
            },
            {
                $Type  : 'UI.ReferenceFacet',
                Target : '@UI.FieldGroup#ContractValue',
                Label  : 'Value'
            }
        ],

        FieldGroup#ContractStatus: {
            Data: [
                { Value: is_active, Label: 'Active', Criticality: activeCriticality }
            ]
        },

        FieldGroup#ContractValidity: {
            Data: [
                { Value: valid_from, Label: 'From' },
                { Value: valid_to, Label: 'To' }
            ]
        },

        FieldGroup#ContractValue: {
            Data: [
                { Value: total_value, Label: 'Value' },
                { Value: currency_code, Label: 'Currency' }
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
                Label  : 'Pricing',
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
                { Value: supplier.supplier_name, Label: 'Supplier' },
                { Value: supplier.supplier_code, Label: 'Supplier Code' },
                { Value: airport.airport_name, Label: 'Airport' },
                { Value: airport.iata_code, Label: 'Airport IATA' }
            ]
        },

        FieldGroup#ContractPricing: {
            Label: 'Pricing',
            Data: [
                { Value: pricing_type, Label: 'Pricing Type' },
                { Value: base_price, Label: 'Base Price' },
                { Value: total_value, Label: 'Total Value' },
                { Value: currency_code, Label: 'Currency' },
                { Value: min_quantity, Label: 'Min Quantity' },
                { Value: max_quantity, Label: 'Max Quantity' },
                { Value: quantity_uom, Label: 'Quantity UoM' }
            ]
        },

        FieldGroup#ContractS4: {
            Label: 'S/4HANA Integration',
            Data: [
                { Value: s4_contract_number, Label: 'S/4 Contract Number' },
                { Value: s4_contract_item, Label: 'S/4 Contract Item' },
                { Value: s4_purchasing_org, Label: 'Purchasing Org' },
                { Value: s4_company_code, Label: 'Company Code' }
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
            Title          : { Value: manufacturer_name },
            Description    : { Value: manufacturer_code },
            ImageUrl       : 'sap-icon://factory'
        },

        SelectionFields: [
            manufacturer_code,
            manufacturer_name,
            country_of_origin,
            is_active
        ],

        LineItem: [
            { Value: manufacturer_code, Label: 'Code', ![@UI.Importance]: #High },
            { Value: manufacturer_name, Label: 'Name', ![@UI.Importance]: #High },
            { Value: country_of_origin, Label: 'Country of Origin', ![@UI.Importance]: #Medium },
            { Value: founded_year, Label: 'Founded', ![@UI.Importance]: #Low },
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
                ID     : 'Aircraft',
                Label  : 'Aircraft',
                Target : 'aircraft/@UI.LineItem'
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
                { Value: manufacturer_code, Label: 'Manufacturer Code' },
                { Value: manufacturer_name, Label: 'Manufacturer Name' },
                { Value: country_of_origin, Label: 'Country of Origin' },
                { Value: founded_year, Label: 'Founded Year' },
                { Value: headquarters, Label: 'Headquarters' },
                { Value: website, Label: 'Website' },
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

// =============================================================================
// REFERENCE DATA (Read-Only - S/4HANA Synchronized)
// =============================================================================

annotate service.Countries with @(
    Capabilities: {
        InsertRestrictions: { Insertable: false },
        UpdateRestrictions: { Updatable: false },
        DeleteRestrictions: { Deletable: false }
    },
    UI: {
        HeaderInfo: {
            TypeName       : 'Country',
            TypeNamePlural : 'Countries',
            Title          : { Value: landx }
        },
        SelectionFields: [ land1, landgr ],
        LineItem: [
            { Value: land1, Label: 'Country Code', ![@UI.Importance]: #High },
            { Value: landx, Label: 'Country Name', ![@UI.Importance]: #High },
            { Value: landgr, Label: 'Region', ![@UI.Importance]: #Medium },
            { Value: currcode, Label: 'Currency', ![@UI.Importance]: #Medium }
        ]
    }
);

annotate service.Currencies with @(
    Capabilities: {
        InsertRestrictions: { Insertable: false },
        UpdateRestrictions: { Updatable: false },
        DeleteRestrictions: { Deletable: false }
    },
    UI: {
        HeaderInfo: {
            TypeName       : 'Currency',
            TypeNamePlural : 'Currencies',
            Title          : { Value: currency_name }
        },
        LineItem: [
            { Value: currency_code, Label: 'Currency Code', ![@UI.Importance]: #High },
            { Value: currency_name, Label: 'Currency Name', ![@UI.Importance]: #High },
            { Value: symbol, Label: 'Symbol', ![@UI.Importance]: #Medium }
        ]
    }
);

annotate service.Plants with @(
    Capabilities: {
        InsertRestrictions: { Insertable: false },
        UpdateRestrictions: { Updatable: false },
        DeleteRestrictions: { Deletable: false }
    },
    UI: {
        HeaderInfo: {
            TypeName       : 'Plant',
            TypeNamePlural : 'Plants',
            Title          : { Value: name1 }
        },
        SelectionFields: [ werks ],
        LineItem: [
            { Value: werks, Label: 'Plant Code', ![@UI.Importance]: #High },
            { Value: name1, Label: 'Plant Name', ![@UI.Importance]: #High },
            { Value: ort01, Label: 'City', ![@UI.Importance]: #Medium }
        ]
    }
);

annotate service.UnitsOfMeasure with @(
    Capabilities: {
        InsertRestrictions: { Insertable: false },
        UpdateRestrictions: { Updatable: false },
        DeleteRestrictions: { Deletable: false }
    },
    UI: {
        HeaderInfo: {
            TypeName       : 'Unit of Measure',
            TypeNamePlural : 'Units of Measure',
            Title          : { Value: uom_name }
        },
        LineItem: [
            { Value: uom_code, Label: 'UoM Code', ![@UI.Importance]: #High },
            { Value: uom_name, Label: 'UoM Name', ![@UI.Importance]: #High },
            { Value: uom_type, Label: 'Type', ![@UI.Importance]: #Medium }
        ]
    }
);
