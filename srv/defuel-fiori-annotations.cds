using { DefuelService } from './defuel-service';

/**
 * Defueling — the capture screen.
 *
 * ===========================================================================
 * REWRITTEN 26 Oct 2026 with the service beneath it. The previous file
 * annotated the settlement model: parked parcels, held value, credits and
 * write-offs. None of those fields exist any more.
 *
 * AND IT CARRIED A TRAP WORTH RECORDING. It set
 * `@Common.FieldControl: #Mandatory` on tail_number and carrier_code, both of
 * which the SERVICE fills rather than the user. CAP enforces FieldControl on
 * the server, so every save was refused with "Value is required" against two
 * fields nobody could have typed. An annotation is not decoration: a
 * mandatory flag on a derived field makes the entity unsaveable.
 *
 * TWO SECTIONS, SOURCE THEN DESTINATION, because that is the shape of the
 * transaction and the order a station user works in: where the fuel came
 * from, then where it went.
 *
 * ON RADIO BUTTONS: the specification asks for a radio group for the two
 * types. Fiori Elements has no radio control - an enum field renders as a
 * dropdown, and forcing radios would mean a custom fragment and a freestyle
 * page. Both choices are modelled as enums so the BEHAVIOUR is right and the
 * control is the platform's; a custom fragment can replace the control later
 * without touching the data model.
 * ===========================================================================
 */
annotate DefuelService.Defuels with @(

    UI: {
        // ---- the list -------------------------------------------------
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

        // ---- the object page header -----------------------------------
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

        // ---- the form -------------------------------------------------
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

        // THE FLIGHT FIELD COMES FIRST and fills the four beneath it.
        // Station, date, carrier and tail are SHOWN rather than hidden, so a
        // user can see what the schedule supplied before saving.
        FieldGroup#Source: { Data: [
            { Value: flight_ID,          Label: 'Flight' },
            { Value: flight_date,        Label: 'Flight Date' },
            { Value: station_code,       Label: 'Station' },
            { Value: carrier_code,       Label: 'Carrier' },
            { Value: tail_registration,  Label: 'Tail No.' },
            { Value: pre_flight_number,  Label: 'Pre-flight No.' },
            { Value: post_flight_number, Label: 'Post-flight No.' },
            { Value: defuel_date,        Label: 'Defuel Date' },
            { Value: defuel_time,        Label: 'Defuel Time' },
            { Value: ticket_number,      Label: 'Ticket No.' },
            { Value: supplier_ID,        Label: 'Supplier' },
            { Value: quantity_kg,        Label: 'Quantity (kg)' },
            { Value: defuel_charges_usd, Label: 'Defuel Charges (USD)' },
            { Value: taxes_usd,          Label: 'Taxes (USD)' }
        ]},

        // ONE SET OF VALUES, SHOWN TWICE. Answered 26 Oct: the fuel that
        // leaves the wing is the fuel that reaches the tank, so quantity,
        // supplier, charges and taxes are the SAME fields repeated here for
        // readability rather than second copies that could disagree.
        FieldGroup#Destination: { Data: [
            { Value: location_ID,        Label: 'Storage Location' },
            { Value: quantity_kg,        Label: 'Quantity (kg)' },
            { Value: supplier_ID,        Label: 'Supplier' },
            { Value: specific_gravity,   Label: 'Specific Gravity' },
            { Value: defuel_charges_usd, Label: 'Defuel Charges (USD)' },
            { Value: taxes_usd,          Label: 'Taxes (USD)' }
        ]}
    }
);

// ---- labels and field behaviour ---------------------------------------
//
// NOTHING DERIVED IS MANDATORY. The service fills defuel_id, tail_number,
// carrier_code, flight_number, flight_date, location_code, specific_gravity,
// quantity_l and fuel_value_usd, so none of them may carry a mandatory flag -
// that is precisely what made the previous version unsaveable.
annotate DefuelService.Defuels with {
    defuel_id          @title: 'Defuel No.'          @readonly;
    defuel_type        @title: 'Defuel to'           @Common.FieldControl: #Mandatory;
    source_mode        @title: 'Recorded against'    @Common.FieldControl: #Mandatory;

    tail_registration  @title: 'Tail No.'            @Common.FieldControl: #Mandatory;
    tail_number        @title: 'Tail'                @readonly;
    carrier_code       @title: 'Carrier'             @readonly;

    flight_ID          @title: 'Flight';
    flight_number      @title: 'Flight No.'          @readonly;
    flight_date        @title: 'Flight Date'         @readonly;
    station_code       @title: 'Station';

    pre_flight_number  @title: 'Pre-flight No.';
    post_flight_number @title: 'Post-flight No.';

    defuel_date        @title: 'Defuel Date'         @Common.FieldControl: #Mandatory;
    defuel_time        @title: 'Defuel Time';
    ticket_number      @title: 'Ticket No.';
    supplier_ID        @title: 'Supplier';

    quantity_kg        @title: 'Quantity (kg)'       @Common.FieldControl: #Mandatory;
    quantity_l         @title: 'Quantity (L)'        @readonly;
    specific_gravity   @title: 'Specific Gravity'    @readonly;

    location_ID        @title: 'Storage Location'    @Common.FieldControl: #Mandatory;
    location_code      @title: 'Storage Location'    @readonly;
    location_name      @title: 'Location Name'       @readonly;
    supplier_name      @title: 'Supplier'            @readonly;

    defuel_charges_usd @title: 'Defuel Charges (USD)';
    taxes_usd          @title: 'Taxes (USD)';
    total_charges_usd  @title: 'Charges + Tax (USD)' @readonly;
    fuel_value_usd     @title: 'Fuel Value (USD)'    @readonly;

    status             @title: 'Status'              @readonly;
    notes              @title: 'Notes'               @UI.MultiLineText;
};

// ---- the pickers ------------------------------------------------------
//
// EVERY F4 SHOWS WHAT THE USER CHOOSES BY, not just the key. A flight list
// of bare UUIDs would be unusable, which is what a value help without a text
// arrangement amounts to.
annotate DefuelService.Defuels with {

    flight_ID @(Common: {
        Text: flight_number, TextArrangement: #TextOnly,
        ValueListWithFixedValues: false,
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

    tail_registration @(Common: {
        ValueListWithFixedValues: false,
        ValueList: {
            CollectionPath: 'Tails',
            Label: 'Aircraft',
            Parameters: [
                { $Type: 'Common.ValueListParameterInOut',
                  LocalDataProperty: tail_registration, ValueListProperty: 'registration' },
                { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'aircraft_type_code' }
            ]
        }
    });

    location_ID @(Common: {
        Text: location_code, TextArrangement: #TextOnly,
        ValueListWithFixedValues: false,
        ValueList: {
            CollectionPath: 'Locations',
            Label: 'Storage Locations',
            Parameters: [
                { $Type: 'Common.ValueListParameterInOut',
                  LocalDataProperty: location_ID, ValueListProperty: 'ID' },
                { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'code' },
                { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'description' },
                { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'station_code' },
                // THE TYPE IS SHOWN IN THE PICKER, so a user choosing a
                // destination knows whether fuel can ever be re-uplifted out
                // of it, rather than discovering it when an uplift is refused
                // weeks later.
                { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'location_type' }
            ]
        }
    });

    supplier_ID @(Common: {
        Text: supplier_name, TextArrangement: #TextOnly,
        ValueListWithFixedValues: false,
        ValueList: {
            CollectionPath: 'Vendors',
            Label: 'Suppliers',
            Parameters: [
                { $Type: 'Common.ValueListParameterInOut',
                  LocalDataProperty: supplier_ID, ValueListProperty: 'ID' },
                { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'supplier_name' }
            ]
        }
    });
};
