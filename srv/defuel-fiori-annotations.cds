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
              Target: '@UI.FieldGroup#Destination', Label: 'Destination - the storage location' }
        ],

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
            { Value: flight_ID, Label: 'Flight No.',
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
            { Value: post_flight_number, Label: 'Post-flight No.',
              ![@UI.Hidden]: { $edmJson: { $Ne: [{ $Path: 'source_mode' }, 'WITHOUT_FLIGHT'] } } },

            { Value: station_code,     Label: 'Station' },
            { Value: defuel_date,      Label: 'Defuel Date' },
            { Value: defuel_time,      Label: 'Defuel Time' },
            { Value: ticket_number,    Label: 'Ticket No.' },
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
            { Value: location_ID,        Label: 'Storage Location' },
            { Value: supplier_ID,        Label: 'Defuelling Agent' },
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

    flight_number       @title: 'Flight No.'          @readonly;
    flight_date         @title: 'Flight Date'         @readonly;
    origin_station      @title: 'Departure Station'   @readonly;
    destination_station @title: 'Arrival Station'     @readonly;
    station_code        @title: 'Station';

    pre_flight_number   @title: 'Pre-flight No.';
    post_flight_number  @title: 'Post-flight No.';

    defuel_date         @title: 'Defuel Date'         @Common.FieldControl: #Mandatory;
    defuel_time         @title: 'Defuel Time';
    ticket_number       @title: 'Ticket No.';

    quantity_kg         @title: 'Quantity (kg)'       @Common.FieldControl: #Mandatory;
    quantity_l          @title: 'Quantity (L)'        @readonly;
    specific_gravity    @title: 'Specific Gravity'    @readonly;

    location_code       @title: 'Storage Location'    @readonly;
    location_name       @title: 'Location Name'       @readonly;
    supplier_name       @title: 'Defuelling Agent'    @readonly;

    defuel_charges_usd  @title: 'Defuel Charges (USD)';
    taxes_usd           @title: 'Taxes (USD)';
    total_charges_usd   @title: 'Charges + Tax (USD)' @readonly;
    fuel_value_usd      @title: 'Fuel Value (USD)'    @readonly;

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
    flight @(Common: {
        Text: flight_number, TextArrangement: #TextOnly,
        ValueList: {
            CollectionPath: 'Flights',
            Label: 'Flights',
            Parameters: [
                { $Type: 'Common.ValueListParameterInOut',
                  LocalDataProperty: flight_ID, ValueListProperty: 'ID' },
                { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'flight_number' },
                { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'flight_date' },
                { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'airline_code' },
                { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'aircraft_reg' },
                { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'origin_airport' },
                { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'destination_airport' }
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
    location @(Common: {
        Text: location_code, TextArrangement: #TextOnly,
        ValueList: {
            CollectionPath: 'Locations',
            Label: 'Storage Locations',
            Parameters: [
                { $Type: 'Common.ValueListParameterInOut',
                  LocalDataProperty: location_ID, ValueListProperty: 'ID' },
                { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'code' },
                { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'description' },
                { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'station_code' },
                { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'location_type' }
            ]
        }
    });

    supplier @(Common: {
        Text: supplier_name, TextArrangement: #TextOnly,
        ValueList: {
            CollectionPath: 'Vendors',
            Label: 'Defuelling Agents',
            Parameters: [
                { $Type: 'Common.ValueListParameterInOut',
                  LocalDataProperty: supplier_ID, ValueListProperty: 'ID' },
                { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'supplier_name' }
            ]
        }
    });
};
