using MappingService from './mapping-service';

/**
 * FuelSphere - the four mapping maintenance screens.
 *
 * List report and object page each, all four draft enabled, so create, edit
 * and delete are the framework's rather than anything written here.
 *
 * THE VALUE HELPS ARE THE FIRST LINE OF THE VALIDATION. A filtered list is
 * what stops the wrong supplier being chosen at the keyboard; the rules in
 * mapping-service.js are what stop it arriving any other way. Both are needed
 * and neither is sufficient - see CAR401 in that file.
 */

// ===========================================================================
// 1. CARRIERS
// ===========================================================================

annotate MappingService.Carriers with @(
    UI: {
        HeaderInfo: {
            TypeName       : 'Carrier',
            TypeNamePlural : 'Carriers',
            Title          : { Value: carrier_code },
            Description    : { Value: carrier_name }
        },
        SelectionFields: [ carrier_code, company_code, is_active ],
        LineItem: [
            { Value: carrier_code,  Label: 'Carrier code' },
            { Value: carrier_name,  Label: 'Carrier name' },
            { Value: company_code,  Label: 'Company code' },
            { Value: is_active,     Label: 'Active' }
        ],
        Facets: [
            { $Type: 'UI.ReferenceFacet', ID: 'CarrierDetails',
              Target: '@UI.FieldGroup#CarrierDetails', Label: 'Carrier' },
            // THE TOLERANCE LIMITS, asked for 2 Oct 2026. Their own section
            // rather than more rows under Carrier: twelve numbers that are
            // read together and against each other do not belong in a list
            // with the company code.
            { $Type: 'UI.ReferenceFacet', ID: 'CarrierTolerances',
              Target: '@UI.FieldGroup#Tolerances', Label: 'Tolerance limits' }
        ],
        FieldGroup #CarrierDetails: {
            Data: [
                { Value: carrier_code, Label: 'Carrier code' },
                { Value: carrier_name, Label: 'Carrier name' },
                { Value: company_code, Label: 'Company code' },
                { Value: is_active,    Label: 'Active' },
                { Value: notes,        Label: 'Notes' }
            ]
        },

        // THE PAIRS STAY TOGETHER, AND IN THE ORDER THE CHECKS RUN - delivery
        // first, because that is the first check a ticket meets, then the
        // invoice line, then the invoice header. Reading down the section is
        // reading the sequence a quantity actually travels through.
        FieldGroup #Tolerances: {
            Data: [
                { Value: delivery_qty_tol_pct,      Label: 'Delivery qty %' },
                { Value: delivery_qty_tol_abs,      Label: 'Delivery qty absolute (kg)' },
                { Value: inv_line_qty_tol_pct,      Label: 'Invoice qty (line) %' },
                { Value: inv_line_qty_tol_abs,      Label: 'Invoice qty (line) absolute (kg)' },
                { Value: inv_line_rate_tol_pct,     Label: 'Invoice rate (line) %' },
                { Value: inv_line_rate_tol_abs,     Label: 'Invoice rate (line) absolute' },
                { Value: inv_line_amount_tol_pct,   Label: 'Invoice amount (line) %' },
                { Value: inv_line_amount_tol_abs,   Label: 'Invoice amount (line) absolute' },
                { Value: inv_header_qty_tol_pct,    Label: 'Invoice qty (header) %' },
                { Value: inv_header_qty_tol_abs,    Label: 'Invoice qty (header) absolute (kg)' },
                { Value: inv_header_amount_tol_pct, Label: 'Invoice amount (header) %' },
                { Value: inv_header_amount_tol_abs, Label: 'Invoice amount (header) absolute' }
            ]
        }
    }
);

annotate MappingService.Carriers with {
    carrier_code @title: 'Carrier code' @Common.FieldControl: #Mandatory;
    carrier_name @title: 'Carrier name';
    // The books the S/4 documents post under. Mandatory because a purchase
    // order without one cannot be created at all.
    company_code @title: 'Company code' @Common.FieldControl: #Mandatory;
    is_active    @title: 'Active';
    notes        @title: 'Notes' @UI.MultiLineText;

    // BLANK MEANS "USE THE SYSTEM RULE", NOT ZERO - said on the first field
    // rather than twelve times over.
    delivery_qty_tol_pct       @title: 'Delivery qty %'
                               @Common.QuickInfo: 'Percentage variance allowed between the quantity delivered and the gauge readings. BLANK FALLS BACK TO THE SYSTEM TOLERANCE RULE - it does not mean zero. A row passes if it is inside EITHER this or the absolute beside it.';
    delivery_qty_tol_abs       @title: 'Delivery qty absolute (kg)'
                               @Common.QuickInfo: 'Absolute variance allowed, in kilograms. This is what stops a small uplift breaching on a percentage that is only meaningful at scale: 0.5% of a 200 kg top-up is one kilogram.';
    inv_line_qty_tol_pct       @title: 'Invoice qty (line) %';
    inv_line_qty_tol_abs       @title: 'Invoice qty (line) absolute (kg)';
    inv_line_rate_tol_pct      @title: 'Invoice rate (line) %';
    inv_line_rate_tol_abs      @title: 'Invoice rate (line) absolute';
    inv_line_amount_tol_pct    @title: 'Invoice amount (line) %';
    inv_line_amount_tol_abs    @title: 'Invoice amount (line) absolute';
    inv_header_qty_tol_pct     @title: 'Invoice qty (header) %';
    inv_header_qty_tol_abs     @title: 'Invoice qty (header) absolute (kg)'
                               @Common.QuickInfo: 'Checked against the invoice as a whole, separately from the line limits above. Lines within an invoice can offset each other, so a header can sit inside its limit while individual lines do not - which is why this is its own control rather than a sum.';
    inv_header_amount_tol_pct  @title: 'Invoice amount (header) %';
    inv_header_amount_tol_abs  @title: 'Invoice amount (header) absolute';
}

// ===========================================================================
// 2. STATION TO PLANT
// ===========================================================================

annotate MappingService.StationPlantMappings with @(
    UI: {
        HeaderInfo: {
            TypeName       : 'Station-plant mapping',
            TypeNamePlural : 'Station-Plant Mappings',
            Title          : { Value: airport.iata_code },
            Description    : { Value: plant.werks }
        },
        SelectionFields: [ airport_ID, carrier_carrier_code, plant_werks, is_active ],
        LineItem: [
            { Value: airport.iata_code,    Label: 'Airport' },
            { Value: airport.airport_name, Label: 'Airport name' },
            { Value: airport.city,         Label: 'City' },
            { Value: carrier_carrier_code, Label: 'Carrier code' },
            { Value: plant.werks,          Label: 'Plant' },
            { Value: plant.name1,          Label: 'Plant name' },
            { Value: valid_from,           Label: 'Valid from' },
            { Value: valid_to,             Label: 'Valid to' },
            { Value: is_active,            Label: 'Active' }
        ],
        Facets: [
            { $Type: 'UI.ReferenceFacet', ID: 'PlantMapping',
              Target: '@UI.FieldGroup#PlantMapping', Label: 'Mapping' },
            { $Type: 'UI.ReferenceFacet', ID: 'PlantStation',
              Target: '@UI.FieldGroup#PlantStation', Label: 'Station (from the airport master)' }
        ],
        FieldGroup #PlantMapping: {
            Data: [
                { Value: airport_ID,           Label: 'Airport' },
                { Value: carrier_carrier_code, Label: 'Carrier code' },
                { Value: plant_werks,          Label: 'Plant' },
                { Value: timezone,             Label: 'Time zone' },
                { Value: valid_from,           Label: 'Valid from' },
                { Value: valid_to,             Label: 'Valid to' },
                { Value: is_active,            Label: 'Active' }
            ]
        },
        // READ-ONLY, AND READ RATHER THAN COPIED. The sheet calls these "auto
        // picked based on airport"; they are the airport master's own fields,
        // shown here so the person can see they picked the right station.
        FieldGroup #PlantStation: {
            Data: [
                { Value: airport.airport_name, Label: 'Airport name' },
                { Value: airport.city,         Label: 'City' },
                { Value: airport.country_code, Label: 'Country' },
                { Value: airport.icao_code,    Label: 'ICAO' },
                { Value: airport.timezone,     Label: 'Airport time zone' }
            ]
        }
    }
);

annotate MappingService.StationPlantMappings with {
    airport_ID           @title: 'Airport' @Common.FieldControl: #Mandatory;
    carrier_carrier_code @title: 'Carrier code' @Common.FieldControl: #Mandatory;
    plant_werks          @title: 'Plant' @Common.FieldControl: #Mandatory;
    timezone             @title: 'Time zone';
    valid_from           @title: 'Valid from' @Common.FieldControl: #Mandatory;
    valid_to             @title: 'Valid to';
    is_active            @title: 'Active';
}

// ===========================================================================
// 3. STATION TO SUPPLIER AND CONTRACT LINE
// ===========================================================================

annotate MappingService.StationSupplierMappings with @(
    UI: {
        HeaderInfo: {
            TypeName       : 'Station-supplier mapping',
            TypeNamePlural : 'Station-Supplier Mappings',
            Title          : { Value: airport.iata_code },
            Description    : { Value: supplier.supplier_name }
        },
        SelectionFields: [ airport_ID, carrier_carrier_code, supplier_ID, is_active ],
        LineItem: [
            { Value: airport.iata_code,             Label: 'Airport' },
            { Value: carrier_carrier_code,          Label: 'Carrier code' },
            { Value: supplier.supplier_name,        Label: 'Supplier' },
            { Value: supplier.s4_vendor_no,         Label: 'SAP supplier no' },
            { Value: contract.s4_contract_number,   Label: 'SAP contract no' },
            { Value: contract_line_item,            Label: 'Contract line item' },
            { Value: valid_from,                    Label: 'Valid from' },
            { Value: valid_to,                      Label: 'Valid to' },
            { Value: is_active,                     Label: 'Active' }
        ],
        Facets: [
            { $Type: 'UI.ReferenceFacet', ID: 'SupplierMapping',
              Target: '@UI.FieldGroup#SupplierMapping', Label: 'Mapping' },
            { $Type: 'UI.ReferenceFacet', ID: 'SupplierS4',
              Target: '@UI.FieldGroup#SupplierS4', Label: 'What posts to S/4' }
        ],
        FieldGroup #SupplierMapping: {
            Data: [
                { Value: airport_ID,           Label: 'Airport' },
                { Value: carrier_carrier_code, Label: 'Carrier code' },
                { Value: supplier_ID,          Label: 'Supplier' },
                { Value: contract_ID,          Label: 'Contract' },
                { Value: contract_line_item,   Label: 'Contract line item' },
                { Value: valid_from,           Label: 'Valid from' },
                { Value: valid_to,             Label: 'Valid to' },
                { Value: is_active,            Label: 'Active' }
            ]
        },
        // The numbers themselves are the masters', shown here so the person
        // maintaining the mapping can see what will actually be posted.
        FieldGroup #SupplierS4: {
            Data: [
                { Value: supplier.s4_vendor_no,       Label: 'SAP supplier no' },
                { Value: contract.contract_number,    Label: 'Contract' },
                { Value: contract.s4_contract_number, Label: 'SAP contract no' },
                { Value: contract_line_item,          Label: 'Contract line item' }
            ]
        }
    }
);

annotate MappingService.StationSupplierMappings with {
    airport_ID           @title: 'Airport' @Common.FieldControl: #Mandatory;
    carrier_carrier_code @title: 'Carrier code' @Common.FieldControl: #Mandatory;
    supplier_ID          @title: 'Supplier' @Common.FieldControl: #Mandatory;
    contract_ID          @title: 'Contract' @Common.FieldControl: #Mandatory;
    contract_line_item   @title: 'Contract line item' @Common.FieldControl: #Mandatory;
    valid_from           @title: 'Valid from' @Common.FieldControl: #Mandatory;
    valid_to             @title: 'Valid to';
    is_active            @title: 'Active';
}

// ===========================================================================
// 4. FLIGHT TO SUPPLIER
// ===========================================================================

annotate MappingService.FlightSupplierMappings with @(
    UI: {
        HeaderInfo: {
            TypeName       : 'Flight-supplier mapping',
            TypeNamePlural : 'Flight-Supplier Mappings',
            Title          : { Value: flight_number },
            Description    : { Value: supplier.supplier_name }
        },
        SelectionFields: [ flight_number, airport_ID, carrier_carrier_code, supplier_ID, is_active ],
        LineItem: [
            { Value: flight_number,          Label: 'Flight no' },
            { Value: airport.iata_code,      Label: 'Airport' },
            { Value: carrier_carrier_code,   Label: 'Carrier code' },
            { Value: supplier.supplier_name, Label: 'Supplier' },
            { Value: supplier.s4_vendor_no,  Label: 'SAP supplier no' },
            { Value: valid_from,             Label: 'Valid from' },
            { Value: valid_to,               Label: 'Valid to' },
            { Value: is_active,              Label: 'Active' }
        ],
        Facets: [
            { $Type: 'UI.ReferenceFacet', ID: 'FlightMapping',
              Target: '@UI.FieldGroup#FlightMapping', Label: 'Mapping' }
        ],
        FieldGroup #FlightMapping: {
            Data: [
                { Value: flight_number,          Label: 'Flight no' },
                { Value: airport_ID,             Label: 'Airport' },
                { Value: carrier_carrier_code,   Label: 'Carrier code' },
                { Value: supplier_ID,            Label: 'Supplier' },
                { Value: supplier.s4_vendor_no,  Label: 'SAP supplier no' },
                { Value: valid_from,             Label: 'Valid from' },
                { Value: valid_to,               Label: 'Valid to' },
                { Value: is_active,              Label: 'Active' }
            ]
        }
    }
);

annotate MappingService.FlightSupplierMappings with {
    flight_number        @title: 'Flight no' @Common.FieldControl: #Mandatory;
    airport_ID           @title: 'Airport' @Common.FieldControl: #Mandatory;
    carrier_carrier_code @title: 'Carrier code' @Common.FieldControl: #Mandatory;
    supplier_ID          @title: 'Supplier' @Common.FieldControl: #Mandatory;
    valid_from           @title: 'Valid from' @Common.FieldControl: #Mandatory;
    valid_to             @title: 'Valid to';
    is_active            @title: 'Active';
}

// ===========================================================================
// THE VALUE HELPS
// ===========================================================================
//
// ANNOTATED ON THE ASSOCIATION, not on the foreign key. Both compile; only
// this one reaches the metadata, and it is the idiom the rest of FuelSphere
// uses (see order-fiori-annotations.cds). A value help written against
// airport_ID disappears silently, which is a slow afternoon for whoever
// inherits it.

// EVERY AIRPORT, on all three mapping apps. Asked for explicitly: these are
// master data maintained before a schedule exists, so a list narrowed to
// airports already in FLIGHT_SCHEDULE would refuse perfectly good rows.
annotate MappingService.StationPlantMappings with {
    airport @(
        Common: {
            Label: 'Airport',
            Text: airport.iata_code,
            TextArrangement: #TextOnly,
            ValueList: {
                Label: 'Airports',
                CollectionPath: 'Airports',
                Parameters: [
                    { $Type: 'Common.ValueListParameterInOut', LocalDataProperty: airport_ID, ValueListProperty: 'ID' },
                    { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'iata_code' },
                    { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'airport_name' },
                    { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'city' },
                    { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'country_code' }
                ]
            }
        }
    );

    carrier @(
        Common: {
            Label: 'Carrier code',
            Text: carrier.carrier_name,
            TextArrangement: #TextFirst,
            ValueList: {
                Label: 'Carriers',
                CollectionPath: 'Carriers',
                Parameters: [
                    { $Type: 'Common.ValueListParameterInOut', LocalDataProperty: carrier_carrier_code, ValueListProperty: 'carrier_code' },
                    { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'carrier_name' },
                    { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'company_code' }
                ]
            }
        }
    );

    plant @(
        Common: {
            Label: 'Plant',
            Text: plant.name1,
            TextArrangement: #TextFirst,
            ValueList: {
                Label: 'Plants',
                CollectionPath: 'Plants',
                Parameters: [
                    { $Type: 'Common.ValueListParameterInOut', LocalDataProperty: plant_werks, ValueListProperty: 'werks' },
                    { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'name1' },
                    { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'ort01' }
                ]
            }
        }
    );
}

annotate MappingService.FlightSupplierMappings with {
    airport @(
        Common: {
            Label: 'Airport',
            Text: airport.iata_code,
            TextArrangement: #TextOnly,
            ValueList: {
                Label: 'Airports',
                CollectionPath: 'Airports',
                Parameters: [
                    { $Type: 'Common.ValueListParameterInOut', LocalDataProperty: airport_ID, ValueListProperty: 'ID' },
                    { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'iata_code' },
                    { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'airport_name' },
                    { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'city' },
                    { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'country_code' }
                ]
            }
        }
    );

    carrier @(
        Common: {
            Label: 'Carrier code',
            Text: carrier.carrier_name,
            TextArrangement: #TextFirst,
            ValueList: {
                Label: 'Carriers',
                CollectionPath: 'Carriers',
                Parameters: [
                    { $Type: 'Common.ValueListParameterInOut', LocalDataProperty: carrier_carrier_code, ValueListProperty: 'carrier_code' },
                    { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'carrier_name' },
                    { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'company_code' }
                ]
            }
        }
    );

    // ONLY THE SUPPLIERS THIS STATION IS ALREADY MAPPED TO.
    //
    // ValueListParameterIn on airport_ID does it, against the station-supplier
    // mapping rather than against the contracts. A flight mapping is an
    // EXCEPTION to a station's arrangement, so there has to be an arrangement
    // first - and what the posting needs, the contract and its line item,
    // exists only on the station mapping. Naming a supplier the station does
    // not have would leave the posting with no contract line to use.
    //
    // The list shows the contract and line item each supplier would post on,
    // so the person can see what they are choosing between.
    supplier @(
        Common: {
            Label: 'Supplier',
            Text: supplier.supplier_name,
            TextArrangement: #TextFirst,
            ValueList: {
                Label: 'Suppliers mapped to this station',
                CollectionPath: 'StationSuppliers',
                Parameters: [
                    { $Type: 'Common.ValueListParameterIn', LocalDataProperty: airport_ID, ValueListProperty: 'airport_ID' },
                    { $Type: 'Common.ValueListParameterIn', LocalDataProperty: carrier_carrier_code, ValueListProperty: 'carrier_code' },
                    { $Type: 'Common.ValueListParameterInOut', LocalDataProperty: supplier_ID, ValueListProperty: 'supplier_ID' },
                    { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'supplier_name' },
                    { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 's4_vendor_no' },
                    { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'contract_number' },
                    { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'contract_line_item' },
                    { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'valid_from' },
                    { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'valid_to' }
                ]
            }
        }
    );
}

annotate MappingService.StationSupplierMappings with {
    airport @(
        Common: {
            Label: 'Airport',
            Text: airport.iata_code,
            TextArrangement: #TextOnly,
            ValueList: {
                Label: 'Airports',
                CollectionPath: 'Airports',
                Parameters: [
                    { $Type: 'Common.ValueListParameterInOut', LocalDataProperty: airport_ID, ValueListProperty: 'ID' },
                    { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'iata_code' },
                    { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'airport_name' },
                    { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'city' },
                    { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'country_code' }
                ]
            }
        }
    );

    carrier @(
        Common: {
            Label: 'Carrier code',
            Text: carrier.carrier_name,
            TextArrangement: #TextFirst,
            ValueList: {
                Label: 'Carriers',
                CollectionPath: 'Carriers',
                Parameters: [
                    { $Type: 'Common.ValueListParameterInOut', LocalDataProperty: carrier_carrier_code, ValueListProperty: 'carrier_code' },
                    { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'carrier_name' },
                    { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'company_code' }
                ]
            }
        }
    );

    // EVERY SUPPLIER, AND THAT IS THE POINT OF THIS APP.
    //
    // This screen is where somebody DECLARES that a supplier, on a contract,
    // serves a station. Filtering the list by suppliers that already serve the
    // station would make the screen its own prerequisite: a contract signed
    // this morning with a supplier new to that airport could never be mapped,
    // because it is not yet mapped.
    //
    // The pairing is still guarded - CAR401 refuses a contract belonging to
    // somebody else - and the contract list below is filtered by whichever
    // supplier is chosen here.
    supplier @(
        Common: {
            Label: 'Supplier',
            Text: supplier.supplier_name,
            TextArrangement: #TextFirst,
            ValueList: {
                Label: 'Suppliers',
                CollectionPath: 'Suppliers',
                Parameters: [
                    { $Type: 'Common.ValueListParameterInOut', LocalDataProperty: supplier_ID, ValueListProperty: 'ID' },
                    { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'supplier_code' },
                    { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'supplier_name' },
                    { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 's4_vendor_no' },
                    { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'supplier_type' }
                ]
            }
        }
    );

    // FILTERED BY SUPPLIER, NOT BY STATION - and that is deliberate.
    //
    // A contract signed this morning has no station coverage recorded yet. A
    // station-filtered list would not show it, and the mapping could not be
    // made at all, on a table the transactional apps depend on. Filtered by
    // supplier, it is selectable the moment it exists; station_count tells the
    // person whether it lists any airports yet, and CAR409 says so on save
    // without refusing the row.
    contract @(
        Common: {
            Text: contract.contract_number,
            TextArrangement: #TextFirst,
            ValueList: {
                Label: 'Contracts held by this supplier',
                CollectionPath: 'SupplierContracts',
                Parameters: [
                    { $Type: 'Common.ValueListParameterIn', LocalDataProperty: supplier_ID, ValueListProperty: 'supplier_ID' },
                    { $Type: 'Common.ValueListParameterInOut', LocalDataProperty: contract_ID, ValueListProperty: 'contract_ID' },
                    { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'contract_number' },
                    { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 's4_contract_number' },
                    { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'contract_type' },
                    { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'valid_from' },
                    { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'valid_to' },
                    { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'station_count' }
                ]
            }
        }
    );
}
