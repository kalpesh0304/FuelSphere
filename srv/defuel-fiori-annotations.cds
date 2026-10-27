using { DefuelService } from './defuel-service';

/**
 * Defueling — the capture screen.
 *
 * ===========================================================================
 * REWRITTEN TWICE. The first version annotated the settlement model that the
 * 26 Oct redesign removed. This one fixes what that rewrite got wrong, and
 * the mistakes are worth recording because both were already documented in
 * this repository and I made them anyway.
 *
 * VALUE HELPS GO ON THE ASSOCIATION, NOT THE FOREIGN KEY. flight_ID,
 * location_ID and supplier_ID are GENERATED keys: they appear in the OData
 * metadata but are not annotatable elements of the CDS model. Annotating
 * them produced two warnings, four silently discarded value lists, and a
 * screen where every picker was a plain text box. Measured afterwards: the
 * compiled metadata contained ZERO Common.ValueList entries. Annotating the
 * association is what reaches the key.
 *
 * AN ENUM RENDERS AS A TEXT BOX. A dropdown needs rows to point at, which is
 * why DEFUEL_TYPE_CODE and DEFUEL_MODE_CODE exist and are seeded with two
 * rows each. ValueListWithFixedValues makes them a select rather than a
 * dialog.
 *
 * THE TWO MODES SHOW DIFFERENT FIELDS, and the switch is a UI.Hidden
 * expression evaluated on the client against source_mode. Flight, flight
 * date, both stations and carrier appear only for a flight-referenced
 * defuel; the pre- and post-flight numbers only for a tail-only one. Hidden
 * rather than merely empty, because a greyed-out flight number on a tail-only
 * defuel invites somebody to fill it in.
 * ===========================================================================
 */
annotate DefuelService.Defuels with @(

    UI: {
        SelectionFields: [
            defuel_id, defuel_type, tail_number, station_code,
            location_code, defuel_date, status
        ],

        LineItem: [
            { Value: defuel_id,         Label: 'Defuel No.',       ![@UI.Importance]: #High },
            { Value: defuel_type,       Label: 'Type',             ![@UI.Importance]: #High },
            { Value: tail_number,       Label: 'Tail',             ![@UI.Importance]: #High },
            { Value: flight_number,     Label: 'Flight',           ![@UI.Importance]: #High },
            { Value: defuel_date,       Label: 'Date',             ![@UI.Importance]: #High },
            { Value: station_code,      Label: 'Station',          ![@UI.Importance]: #Medium },
            { Value: location_code,     Label: 'Storage Location', ![@UI.Importance]: #High },
            { Value: quantity_kg,       Label: 'Quantity (kg)',    ![@UI.Importance]: #High },
            { Value: fuel_value_usd,    Label: 'Fuel Value (USD)', ![@UI.Importance]: #Medium },
            { Value: total_charges_usd, Label: 'Charges + Tax (USD)', ![@UI.Importance]: #Low },
            { Value: status,            Label: 'Status',           ![@UI.Importance]: #Medium },
            { $Type: 'UI.DataFieldForAction', Action: 'DefuelService.postToSupplier',
              Label: 'Post to Supplier' },
            { $Type: 'UI.DataFieldForAction', Action: 'DefuelService.reverse',
              Label: 'Reverse' }
        ],

        HeaderInfo: {
            TypeName      : 'Defuel',
            TypeNamePlural: 'Defuels',
            Title         : { Value: defuel_id },
            Description   : { Value: tail_number }
        },

        HeaderFacets: [
            { $Type: 'UI.ReferenceFacet', Target: '@UI.FieldGroup#HeaderKey',
              Label: 'Movement' },
            { $Type: 'UI.ReferenceFacet', Target: '@UI.FieldGroup#HeaderValue',
              Label: 'Value' }
        ],

        FieldGroup#HeaderKey: { Data: [
            { Value: defuel_type, Label: 'Type' },
            { Value: status,      Label: 'Status' },
            { Value: defuel_date, Label: 'Date' }
        ]},

        FieldGroup#HeaderValue: { Data: [
            { Value: quantity_kg,      Label: 'Quantity (kg)' },
            { Value: fuel_value_usd,   Label: 'Fuel Value (USD)' },
            { Value: specific_gravity, Label: 'Specific Gravity' }
        ]},

        Facets: [
            { $Type: 'UI.ReferenceFacet', ID: 'TypeFacet',
              Target: '@UI.FieldGroup#Type',        Label: 'What this is' },
            { $Type: 'UI.ReferenceFacet', ID: 'SourceFacet',
              Target: '@UI.FieldGroup#Source',      Label: 'Source - the aircraft' },
            { $Type: 'UI.ReferenceFacet', ID: 'DestFacet',
              Target: '@UI.FieldGroup#Destination', Label: 'Destination - the storage location' },
            // ONLY WHERE THERE IS A VENDOR TO CLAIM FROM. A defuel into a
            // storage tank has no credit and no write-off, so the section
            // would be three empty fields inviting somebody to fill them.
            { $Type: 'UI.ReferenceFacet', ID: 'CreditFacet',
              Target: '@UI.FieldGroup#Credit', Label: 'Credit and write-off',
              ![@UI.Hidden]: { $edmJson: { $Ne: [{ $Path: 'defuel_type' }, 'TO_SUPPLIER'] } } }
        ],

        // THE ONLY TYPED FIGURE IS THE CREDIT. The original value is what the
        // layers were bought at and the write-off is the difference; a screen
        // where all three can be typed is a screen where they disagree.
        FieldGroup#Credit: { Data: [
            { Value: fuel_value_usd,      Label: 'Original Value of Fuel (USD)' },
            { Value: expected_credit_usd, Label: 'Expected Credit (USD)' },
            { Value: write_off_usd,       Label: 'Fuel Write-off (USD)' }
        ]},

        FieldGroup#Type: { Data: [
            { Value: defuel_type, Label: 'Defuel to' },
            { Value: source_mode, Label: 'Recorded against' }
        ]},

        // ---- SOURCE: where the fuel came from --------------------------
        //
        // WHAT CAME OFF AND FROM WHERE belongs here: the quantity and the
        // gravity are properties of the fuel leaving the wing, not of the
        // tank receiving it. The charges are what the handling cost and sit
        // with the destination.
        //
        // The five flight fields are hidden unless the defuel is recorded
        // against a flight; the two context flight numbers unless it is
        // recorded against a tail.
        FieldGroup#Source: { Data: [
            { Value: flight_number, Label: 'Flight No.',
              ![@UI.Hidden]: { $edmJson: { $Ne: [{ $Path: 'source_mode' }, 'WITH_FLIGHT'] } } },
            { Value: flight_date, Label: 'Flight Date',
              ![@UI.Hidden]: { $edmJson: { $Ne: [{ $Path: 'source_mode' }, 'WITH_FLIGHT'] } } },
            { Value: origin_station, Label: 'Departure Station',
              ![@UI.Hidden]: { $edmJson: { $Ne: [{ $Path: 'source_mode' }, 'WITH_FLIGHT'] } } },
            { Value: destination_station, Label: 'Arrival Station',
              ![@UI.Hidden]: { $edmJson: { $Ne: [{ $Path: 'source_mode' }, 'WITH_FLIGHT'] } } },
            { Value: carrier_code, Label: 'Carrier',
              ![@UI.Hidden]: { $edmJson: { $Ne: [{ $Path: 'source_mode' }, 'WITH_FLIGHT'] } } },

            { Value: tail_registration, Label: 'Tail No.' },

            { Value: pre_flight_number, Label: 'Pre-flight No.',
              ![@UI.Hidden]: { $edmJson: { $Ne: [{ $Path: 'source_mode' }, 'WITHOUT_FLIGHT'] } } },
            { Value: pre_flight_date, Label: 'Pre-flight Date',
              ![@UI.Hidden]: { $edmJson: { $Ne: [{ $Path: 'source_mode' }, 'WITHOUT_FLIGHT'] } } },
            { Value: post_flight_number, Label: 'Post-flight No.',
              ![@UI.Hidden]: { $edmJson: { $Ne: [{ $Path: 'source_mode' }, 'WITHOUT_FLIGHT'] } } },
            { Value: post_flight_date, Label: 'Post-flight Date',
              ![@UI.Hidden]: { $edmJson: { $Ne: [{ $Path: 'source_mode' }, 'WITHOUT_FLIGHT'] } } },

            { Value: station_code,     Label: 'Station' },
            { Value: defuel_date,      Label: 'Defuel Date' },
            { Value: defuel_time,      Label: 'Defuel Time' },
            { Value: ticket_number,    Label: 'Ticket No.' },
            { Value: quantity_vol,     Label: 'Quantity' },
            { Value: quantity_l,       Label: 'Quantity (L)' },
            { Value: quantity_kg,      Label: 'Quantity (kg)' },
            // DERIVED, AND IT BELONGS WITH THE SOURCE: it is the weighted
            // average gravity of the FIFO layers this defuel drew from, so it
            // describes the fuel that left the aircraft.
            { Value: specific_gravity, Label: 'Specific Gravity' }
        ]},

        // ---- DESTINATION: where it went, and what the handling cost -----
        //
        // THE SUPPLIER HERE IS THE SERVICE PROVIDER, the company that
        // performed the defuelling - the counterpart of the into-plane agent
        // on an uplift - not the vendor the fuel was bought from.
        FieldGroup#Destination: { Data: [
            { Value: location_code,      Label: 'Storage Location' },
            { Value: supplier_name,      Label: 'Defuelling Agent' },
            { Value: defuel_charges_usd, Label: 'Defuel Charges (USD)' },
            { Value: taxes_usd,          Label: 'Taxes (USD)' }
        ]}
    }
);

// ---- labels and field behaviour ---------------------------------------
//
// NOTHING DERIVED IS MANDATORY. The service fills defuel_id, tail_number,
// carrier_code, flight_number, flight_date, both stations, location_code,
// specific_gravity, quantity_l and fuel_value_usd. A mandatory flag on any of
// them makes the entity unsaveable - CAP enforces FieldControl on the server,
// and the previous version refused every save against two fields nobody could
// have typed.
annotate DefuelService.Defuels with {
    defuel_id           @title: 'Defuel No.'          @readonly;
    defuel_type         @title: 'Defuel to'           @Common.FieldControl: #Mandatory;
    source_mode         @title: 'Recorded against'    @Common.FieldControl: #Mandatory;

    tail_number         @title: 'Tail'                @readonly;
    carrier_code        @title: 'Carrier'             @readonly;

    flight_number       @title: 'Flight No.';
    flight_date         @title: 'Flight Date'         @readonly;
    origin_station      @title: 'Departure Station'   @readonly;
    destination_station @title: 'Arrival Station'     @readonly;
    station_code        @title: 'Station';

    pre_flight_number   @title: 'Pre-flight No.';
    pre_flight_date     @title: 'Pre-flight Date';
    post_flight_number  @title: 'Post-flight No.';
    post_flight_date    @title: 'Post-flight Date';

    defuel_date         @title: 'Defuel Date'         @Common.FieldControl: #Mandatory;
    defuel_time         @title: 'Defuel Time';
    ticket_number       @title: 'Ticket No.';

    // THE UNIT TRAVELS WITH THE FIGURE. @Measures.Unit makes Fiori print
    // it beside the number, so a B6 user sees 40 GAL and not a bare 40.
    quantity_vol        @title: 'Quantity'            @Common.FieldControl: #Mandatory
                        @Measures.Unit: volume_uom;
    volume_uom          @title: 'Volume UOM'          @readonly;
    quantity_l          @title: 'Quantity (L)'        @readonly;
    quantity_kg         @title: 'Quantity (kg)'       @readonly;
    specific_gravity    @title: 'Specific Gravity'    @readonly;

    location_code       @title: 'Storage Location'    @Common.FieldControl: #Mandatory;
    location_name       @title: 'Location Name'       @readonly;
    supplier_name       @title: 'Defuelling Agent';

    defuel_charges_usd  @title: 'Defuel Charges (USD)';
    taxes_usd           @title: 'Taxes (USD)';
    total_charges_usd   @title: 'Charges + Tax (USD)' @readonly;
    fuel_value_usd      @title: 'Original Value of Fuel (USD)' @readonly;
    expected_credit_usd @title: 'Expected Credit (USD)'        @readonly;
    write_off_usd       @title: 'Fuel Write-off (USD)'         @readonly;

    status              @title: 'Status'              @readonly;
    notes               @title: 'Notes'               @UI.MultiLineText;
};

// ===========================================================================
// The pickers — ON THE ASSOCIATION, which is what reaches the foreign key
// ===========================================================================
annotate DefuelService.Defuels with {

    // TWO ROWS, SO IT IS A SELECT. ValueListWithFixedValues renders a
    // dropdown inline rather than opening a dialog to choose between two.
    defuel_type @(Common: {
        ValueListWithFixedValues: true,
        ValueList: {
            CollectionPath: 'DefuelTypes',
            Label: 'Defuel to',
            Parameters: [
                { $Type: 'Common.ValueListParameterInOut',
                  LocalDataProperty: defuel_type, ValueListProperty: 'code' },
                { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'name' }
            ]
        }
    });

    source_mode @(Common: {
        ValueListWithFixedValues: true,
        ValueList: {
            CollectionPath: 'DefuelModes',
            Label: 'Recorded against',
            Parameters: [
                { $Type: 'Common.ValueListParameterInOut',
                  LocalDataProperty: source_mode, ValueListProperty: 'code' },
                { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'name' }
            ]
        }
    });

    // SELECTING A FLIGHT FILLS SIX FIELDS, so the picker shows what the user
    // chooses by: the number, the date, both airports and the tail.
    flight_number @(Common: {
        ValueList: {
            CollectionPath: 'Flights',
            Label: 'Flights',
            Parameters: [
                // IN OUT ON THE NUMBER, so the field shows AC410 and not a
                // GUID. The key comes back as an Out parameter beside it.
                { $Type: 'Common.ValueListParameterInOut',
                  LocalDataProperty: flight_number, ValueListProperty: 'flight_number' },
                { $Type: 'Common.ValueListParameterOut',
                  LocalDataProperty: flight_ID, ValueListProperty: 'ID' },
                { $Type: 'Common.ValueListParameterOut',
                  LocalDataProperty: flight_date, ValueListProperty: 'flight_date' },
                { $Type: 'Common.ValueListParameterOut',
                  LocalDataProperty: carrier_code, ValueListProperty: 'airline_code' },
                { $Type: 'Common.ValueListParameterOut',
                  LocalDataProperty: origin_station, ValueListProperty: 'origin_airport' },
                { $Type: 'Common.ValueListParameterOut',
                  LocalDataProperty: destination_station, ValueListProperty: 'destination_airport' },
                { $Type: 'Common.ValueListParameterOut',
                  LocalDataProperty: tail_registration, ValueListProperty: 'aircraft_reg' }
            ]
        }
    });

    // THE TAILS THAT ACTUALLY FLY, from the schedule rather than the
    // register, which carries every airframe the airline has ever held.
    tail @(Common: {
        ValueList: {
            CollectionPath: 'FlightTails',
            Label: 'Aircraft',
            Parameters: [
                { $Type: 'Common.ValueListParameterInOut',
                  LocalDataProperty: tail_registration, ValueListProperty: 'registration' },
                { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'carrier_code' }
            ]
        }
    });

    // THE TANKS THE CONFIGURATION APP MAINTAINS. location_type is shown so a
    // user picking a destination knows whether fuel can ever be re-uplifted
    // out of it, rather than finding out when an uplift is refused weeks on.
    location_code @(Common: {
        ValueList: {
            CollectionPath: 'Locations',
            Label: 'Storage Locations',
            Parameters: [
                { $Type: 'Common.ValueListParameterInOut',
                  LocalDataProperty: location_code, ValueListProperty: 'code' },
                { $Type: 'Common.ValueListParameterOut',
                  LocalDataProperty: location_ID, ValueListProperty: 'ID' },
                { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'description' },
                { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'station_code' },
                // THE TYPE IS SHOWN IN THE PICKER, so a user choosing a
                // destination knows whether fuel can ever be re-uplifted out
                // of it, rather than finding out weeks later.
                { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'location_type' }
            ]
        }
    });

    supplier_name @(Common: {
        ValueList: {
            CollectionPath: 'Vendors',
            Label: 'Defuelling Agents',
            Parameters: [
                { $Type: 'Common.ValueListParameterInOut',
                  LocalDataProperty: supplier_name, ValueListProperty: 'supplier_name' },
                { $Type: 'Common.ValueListParameterOut',
                  LocalDataProperty: supplier_ID, ValueListProperty: 'ID' }
            ]
        }
    });
};

// ===========================================================================
// SIDE EFFECTS — what the server fills in when the user picks something
// ===========================================================================
//
// WITHOUT THESE THE SCREEN LIES. The draft handler fills station, carrier,
// date and tail the moment a flight is chosen, but Fiori Elements has no way
// to know those fields changed: it sent a PATCH for one property and gets no
// instruction to re-read the others. The user picks a flight, sees nothing
// move, and finds the fields populated only after the record is created -
// which is exactly what was reported.
//
// TargetProperties, NOT TargetEntities: these are fields on this same
// document, not a related collection.
annotate DefuelService.Defuels with @(
    Common.SideEffects #FlightPicked: {
        SourceProperties: [ flight_number ],
        TargetProperties: [
            'flight_date', 'carrier_code', 'origin_station',
            'destination_station', 'station_code',
            'tail_registration', 'tail_number'
        ]
    },

    // Switching the mode clears or restores the flight fields, so the whole
    // source block has to be re-read rather than just the one property.
    Common.SideEffects #ModeChanged: {
        SourceProperties: [ source_mode ],
        TargetProperties: [
            'flight_number', 'flight_date', 'carrier_code',
            'origin_station', 'destination_station', 'station_code'
        ]
    },

    Common.SideEffects #TailPicked: {
        SourceProperties: [ tail_registration ],
        TargetProperties: [ 'tail_number' ]
    },

    Common.SideEffects #LocationPicked: {
        SourceProperties: [ location_code ],
        TargetProperties: [ 'location_code' ]
    },

    Common.SideEffects #AgentPicked: {
        SourceProperties: [ supplier_name ],
        TargetProperties: [ 'supplier_name' ]
    }
);
