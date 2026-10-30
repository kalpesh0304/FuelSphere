/**
 * FuelSphere - Ticket Service Fiori Annotations
 *
 * UI for the standalone Fuel Ticket create/edit app (TicketService,
 * /odata/v4/tickets). Neither a Fuel Order nor a Flight is required - decision
 * A1, an order-less ticket is legitimate - but picking either is offered.
 * Picking an order auto-fills the flight fields from it; picking a flight
 * directly auto-fills aircraft_reg instead (both via before-PATCH hooks in
 * ticket-service.js). internal_number is generated from whichever flight is
 * resolved either way, on Create; it is never user-entered.
 */

using TicketService from './ticket-service';

// ============================================================================
// FuelOrders - reference data exposed only so the order F4 has something
// useful to show (order number, station, flight, status). Read-only; the
// real FuelOrders UI lives in FuelOrderService / the fuelorders app.
// ============================================================================
annotate TicketService.FuelOrders with @(
    UI: {
        HeaderInfo: {
            TypeName       : 'Fuel Order',
            TypeNamePlural : 'Fuel Orders',
            Title          : { Value: order_number },
            Description    : { Value: station_code }
        },
        SelectionFields: [ order_number, station_code, status ],
        LineItem: [
            { Value: order_number,  Label: 'Order Number' },
            { Value: station_code,  Label: 'Station' },
            { Value: flight_number, Label: 'Flight' },
            { Value: status,        Label: 'Status' }
        ]
    }
);

annotate TicketService.FuelOrders with {
    // Hidden so the F4 popup shows only the readable columns - it would
    // otherwise add the raw GUID as a column via the ValueList's InOut
    // parameter below.
    ID            @UI.Hidden;
    order_number  @title: 'Order Number';
    station_code  @title: 'Station';
    // #ReadOnly strips the @mandatory this inherits from
    // FLIGHT_SCHEDULE.flight_number by being displayed through the
    // association. Without it the F4 list paints an asterisk on a column
    // nobody can type into.
    flight_number @title: 'Flight' @Common.FieldControl: #ReadOnly;
    status        @title: 'Status';
};

// ============================================================================
// FlightSchedule - value-help target for flight_number, the alternative to
// picking an order.
// ============================================================================
annotate TicketService.FlightSchedule with @(
    UI.LineItem: [
        { Value: flight_number,       Label: 'Flight' },
        { Value: flight_date,         Label: 'Flight Date' },
        { Value: origin_airport,      Label: 'From' },
        { Value: destination_airport, Label: 'To' },
        { Value: aircraft_reg,        Label: 'Aircraft Reg' }
    ]
);

annotate TicketService.FlightSchedule with {
    ID                  @UI.Hidden;
    flight_number       @title: 'Flight';
    // #ReadOnly FOR THE SAME REASON flight_number carries it on FuelOrders
    // above: the ticket screen shows this through the `flight` association,
    // so it inherits the @mandatory on FLIGHT_SCHEDULE.flight_date and
    // paints a red asterisk on a field nobody can type into. An uplift at a
    // tail has no flight at all, and was being asked for the flight's date.
    // Reported 30 Oct 2026.
    flight_date         @title: 'Flight Date' @Common.FieldControl: #ReadOnly;
    origin_airport       @title: 'From';
    destination_airport  @title: 'To';
    aircraft_reg         @title: 'Aircraft Reg';
};

// ============================================================================
// UnitsOfMeasure - value-help target for uom_code.
// ============================================================================
annotate TicketService.UnitsOfMeasure with @(
    UI.LineItem: [
        { Value: uom_code, Label: 'UoM' },
        { Value: uom_name, Label: 'Description' }
    ]
);

annotate TicketService.UnitsOfMeasure with {
    uom_code @title: 'UoM';
    uom_name @title: 'Description';
};

// ============================================================================
// FuelTickets - the create/edit screen itself.
// ============================================================================

// Without this, the server-derived flight_number/aircraft_reg/uom_code/
// supplier_ticket_ref (populateFromOrder in ticket-service.js) are correctly
// written to the draft, but the UI never re-fetches them after the PATCH
// that set order_ID - the exact symptom observed: fields staying blank
// after picking an order. This is what tells Fiori Elements to refresh
// them. Entity-level with a qualifier and SourceProperties - NOT nested
// inside order's own Common block above, which silently drops it (no
// SourceProperties there for SideEffects to key off).
annotate TicketService.FuelTickets with @(
    // Every entry quoted - see the note on DeliveryService.FuelDeliveries'
    // copy: an unquoted entry compiles to <Path> and is silently ignored,
    // which is why these fields stayed blank after picking an order.
    Common.SideEffects #OrderPicked: {
        SourceProperties : [order_ID],
        // supplier_name_v AND ITS SIBLINGS WERE MISSING HERE, and that is the
        // whole of the reported "supplier does not appear until after the
        // ticket is created". They are VIRTUAL - filled by an after-READ
        // handler that already covers drafts - so the server computes them
        // correctly and Fiori simply never asks again. A side effect that
        // omits a derived field leaves the screen showing the value from
        // before the change.
        //
        // tailFieldControl COMES WITH THEM. Choosing an order makes the tail
        // derived and so read-only; CLEARING one makes it typeable again,
        // which is the uplift at a tail. Without it here the control is
        // whatever it was when the page loaded, and the field stays locked
        // after the order it came from has been removed.
        TargetProperties : ['flight_ID', 'flight/flight_number', 'flight/flight_date',
                            'flight_number', 'aircraft_reg', 'tailFieldControl',
                            'station_code', 'uom_code', 'supplier_ticket_ref', 'currency_code',
                            'supplier_name_v', 's4_vendor_no_v', 'billing_status_v']
    },
    // The alternative path: picking a flight directly, with no order,
    // auto-fills aircraft_reg (populateFromFlight in ticket-service.js).
    Common.SideEffects #FlightPicked: {
        SourceProperties : [flight_ID],
        TargetProperties : ['flight/flight_number', 'flight/flight_date',
                            'flight_number', 'aircraft_reg', 'tailFieldControl',
                            'station_code',
                            'supplier_name_v', 's4_vendor_no_v', 'billing_status_v']
    },

    // THE STATION DECIDES THE SUPPLIER on a ticket with no order - the
    // designation is keyed on the airport, the carrier and the date - so
    // naming a station has to re-read who is going to be billed. Without
    // this the vendor stays blank on exactly the path that needs it most.
    Common.SideEffects #StationPicked: {
        SourceProperties : [station_code],
        TargetProperties : ['supplier_name_v', 's4_vendor_no_v', 'billing_status_v']
    },

    // The tail decides the carrier, and the carrier is half the designation
    // key. Picking one therefore moves the vendor as surely as the station.
    Common.SideEffects #TailPicked: {
        SourceProperties : [aircraft_reg],
        TargetProperties : ['carrier_code', 'supplier_name_v', 's4_vendor_no_v']
    },
    // The amount re-derives from the rate AND from either meter reading,
    // because the metered quantity is what it multiplies (see
    // srv/lib/ticket-measurement.js). Typing a meter reading and watching
    // the amount stay put would read as a stale price.
    Common.SideEffects #AmountInputs: {
        SourceProperties : [rate_per_litre, meter_start, meter_end, quantity],
        TargetProperties : ['quantity_metered', 'quantity_kg', 'total_amount']
    },
    // Switching the unit switches whether density is required, so the
    // control has to be re-read or the asterisk appears only after a reload.
    // The density inputs come with it because the mass depends on them.
    Common.SideEffects #UomChanged: {
        SourceProperties : [uom_code],
        TargetProperties : ['densityFieldControl', 'density_value', 'density_uom', 'quantity_kg']
    }
);

annotate TicketService.FuelTickets with @(
    UI: {
        HeaderInfo: {
            TypeName       : 'Fuel Ticket',
            TypeNamePlural : 'Fuel Tickets',
            Title          : { Value: ticket_number },
            Description    : { Value: status }
        },

        // WP-UI-01: a list with no filter bar makes an operator scroll.
        SelectionFields: [
            // FIRST, and it is what the cross-app link needs. A ticket
            // number arriving as a startup parameter from the invoicing
            // app is only applied as a filter if it IS a filter field -
            // otherwise the link lands on an unfiltered list and the
            // operator hunts for the row they just clicked.
            ticket_number,
            order_ID,
            flight_number,
            status,
            match_status,
            delivery_timestamp
        ],

        LineItem: [
            { Value: ticket_number,      Label: 'Ticket Number',  ![@UI.Importance]: #High },
            { Value: order.order_number, Label: 'Order',          ![@UI.Importance]: #High },
            { Value: flight_number,      Label: 'Flight',         ![@UI.Importance]: #High },
            { Value: flight_date,        Label: 'Flight Date',    ![@UI.Importance]: #Medium },
            { Value: aircraft_reg,       Label: 'Aircraft Reg',   ![@UI.Importance]: #Medium },
            { Value: quantity,           Label: 'Quantity',       ![@UI.Importance]: #High },
            { Value: quantity_cv,           Label: 'Quantity (carrier)',       ![@UI.Importance]: #High },
            { Value: uom_code,           Label: 'UoM',            ![@UI.Importance]: #Medium },
            { Value: rate_per_litre,     Label: 'Rate (per litre)', ![@UI.Importance]: #Medium },
            {
                Value: status,
                Label: 'Status',
                Criticality: { $edmJson: { $If: [
                    { $Eq: [{ $Path: 'status' }, 'Rejected'] }, 1,
                    { $If: [ { $In: [{ $Path: 'status' }, ['Verified', 'Closed', 'Attached']] }, 3, 0 ] } ] } },
                ![@UI.Importance]: #High
            },
            { Value: match_status,       Label: 'Match Status',   ![@UI.Importance]: #Medium },
            // BILLING, ON THE LIST. The status says whether this ticket has
            // reached an invoice and the number says which - and the number
            // is a link to it. Both were on the object page only, so
            // answering "has this been billed?" cost one navigation per
            // ticket.
            { Value: billing_status_v, Label: 'Billing status', ![@UI.Importance]: #Medium },
            { Value: invoice_number_v, Label: 'Invoice number', ![@UI.Importance]: #Medium },
            // SCANNED, NOT OPENED. A buyer reconciling against S/4 wants the
            // PO and GR in the list; the rest of the trail is one click away.
            { Value: s4_po_number,     Label: 'Purchase order',  ![@UI.Importance]: #Medium },
            { Value: s4_gr_number,     Label: 'Goods receipt',    ![@UI.Importance]: #Medium },
            { Value: s4_posting_status, Label: 'S/4 status',      ![@UI.Importance]: #Low }
        ],

        HeaderFacets: [
            { $Type: 'UI.ReferenceFacet', Target: '@UI.FieldGroup#TicketStatus', Label: 'Status' }
        ],

        Facets: [
            { $Type: 'UI.ReferenceFacet', ID: 'OrderFlight',  Target: '@UI.FieldGroup#OrderFlight',  Label: 'Fuel Order & Flight' },
            { $Type: 'UI.ReferenceFacet', ID: 'TicketDetails', Target: '@UI.FieldGroup#TicketDetails', Label: 'Ticket Details' },
            { $Type: 'UI.ReferenceFacet', ID: 'Measurement',   Target: '@UI.FieldGroup#Measurement',   Label: 'Meter & Density' },
            { $Type: 'UI.ReferenceFacet', ID: 'Pricing',       Target: '@UI.FieldGroup#Pricing',       Label: 'Rate & Amount' },
            { $Type: 'UI.ReferenceFacet', ID: 'Verification',  Target: '@UI.FieldGroup#Verification',  Label: 'Verification' },
            { $Type: 'UI.ReferenceFacet', ID: 'Billing',       Target: '@UI.FieldGroup#Billing',       Label: 'Supplier & Invoice' },

            // EVERY LINE THAT BILLED THIS TICKET - 7 Oct 2026.
            //
            // The Billing group above names the FIRST invoice and counts the
            // rest. That was the whole story while a second line meant a
            // duplicate; under a third-party into-plane arrangement the
            // supplier bills the fuel and the agent bills the uplift, so two
            // lines are correct and the reader needs both, each with its own
            // line item number.
            { $Type: 'UI.ReferenceFacet', ID: 'InvoiceLines',
              Target: 'invoice_lines/@UI.LineItem', Label: 'Invoice Lines' },

            // WHAT S/4 CREATED FOR THIS UPLIFT - 13 Oct 2026.
            //
            // Its own card, not folded into Supplier & Invoice, because these
            // are documents in ANOTHER system. The numbers above are
            // FuelSphere's view of the supplier's billing; these are what
            // ME23N, MB03 and MIR4 will open.
            { $Type: 'UI.ReferenceFacet', ID: 'S4Posting',
              Target: '@UI.FieldGroup#S4Posting', Label: 'S/4HANA Posting' },

            // EVERY ATTEMPT, BENEATH THE LATEST ONE. The card above answers
            // "where did this ticket end up"; this answers "how did it get
            // there" - which is the only question worth asking of a ticket
            // that was posted, reversed and posted again.
            { $Type: 'UI.ReferenceFacet', ID: 'S4PostingHistory',
              Target: 's4_attempts/@UI.LineItem', Label: 'S/4HANA Posting History' }
        ],

        FieldGroup #TicketStatus: {
            Data: [
                { Value: status },
                { Value: match_status }
            ]
        },

        // THE ORDER OR THE FLIGHT, PICKED FIRST — neither is required
        // (decision A1), but picking either is offered. Picking an order
        // auto-fills flight_number/aircraft_reg from it (populateFromOrder);
        // picking a flight directly auto-fills aircraft_reg instead
        // (populateFromFlight). aircraft_reg reads read-only because of it
        // either way.
        FieldGroup #OrderFlight: {
            Data: [
                { Value: order_ID },
                { Value: flight_ID,          ![@UI.Importance]: #High },
                // Read through the association, not as a column: this is a
                // create screen, and an association path resolves on a draft
                // row where a calculated column does not.
                { Value: flight.flight_date, Label: 'Flight Date' },
                // STILL AUTO-FILLED FROM THE ORDER OR THE FLIGHT. The value
                // help only matters on the third path - no order, no flight,
                // an uplift at tail - where nothing can derive it.
                { Value: aircraft_reg,       ![@UI.Importance]: #High },

                // WHERE THE FUEL WENT IN. Derived from the order or the
                // flight where there is one; on an uplift at a tail there is
                // neither, and this is the only thing that can say. Every
                // S/4 mapping lookup starts from it - the plant, the
                // designated supplier and the contract are all keyed on the
                // airport - so a ticket without it cannot post.
                { Value: station_code,       Label: 'Station',
                  ![@UI.Importance]: #High },

                // WHERE THE FUEL CAME FROM. A supplier sells it; a storage
                // tank already holds it, bought and valued weeks ago.
                { Value: uplift_source,      Label: 'Fuel Source',
                  ![@UI.Importance]: #High },
                { Value: storage_location_code, Label: 'Storage Location',
                  ![@UI.Importance]: #High,
                  // ASKED FOR ONLY WHEN IT APPLIES. On a supplier uplift this
                  // is a field inviting an answer the service then clears.
                  ![@UI.Hidden]: { $edmJson: { $Ne: [{ $Path: 'uplift_source' }, 'STORAGE'] } } }
            ]
        },

        // Same field set as FuelOrderService.FuelTickets' #TicketDetails
        // (order-fiori-annotations.cds) - identical create screen either way.
        FieldGroup #TicketDetails: {
            Data: [
                { Value: delivery_ID, Label: 'Fuel Delivery' },
                { Value: create_new_delivery, Label: 'Create new delivery for this ticket' },
                { Value: ticket_number },
                { Value: internal_number },
                { Value: quantity },
            { Value: quantity_cv, Label: 'Quantity (carrier)' },
                { Value: uom_code },
                { Value: delivery_timestamp },
                { Value: supplier_ticket_ref },
                { Value: ticket_source },
                { Value: ticket_capture_source, ![@UI.Importance]: #Medium },
                { Value: status },
                { Value: match_status }
            ]
        },

        // Same field set as FuelOrderService.FuelTickets' #Measurement.
        FieldGroup #Measurement: {
            Data: [
                { Value: meter_start },
                { Value: meter_end },
                { Value: quantity_metered },
            { Value: quantity_metered_cv, Label: 'Quantity metered (carrier)' },
                { Value: quantity_flag },
                { Value: density_value },
                { Value: density_basis },
                { Value: density_temp_c },
                { Value: quantity_cm },
                { Value: batch_coa_ref },
                { Value: vehicle_id },
                { Value: meter_serial },
                { Value: meter_calibration_cert },
                { Value: meter_calibration_valid_to }
            ]
        },

        // The rate is typed; the amount is derived from it and the metered
        // quantity. Same group on both ticket screens.
        FieldGroup #Pricing: {
            Data: [
                { Value: rate_per_litre },
                { Value: total_amount }
            ]
        },

        // SUPPLIER AND INVOICE, filled on read by srv/ticket-service.js.
        // billing_status is the same rule UNBILLED_TICKETS uses: BILLED when
        // an invoice line references this ticket, UNBILLED when it has an
        // order and no line, UNBILLABLE when it has neither - a ticket with
        // no order can never be matched to an invoice, and saying so is the
        // point of the third state.
        FieldGroup #Billing: {
            Data: [
                { Value: supplier_name_v,  Label: 'Fuel supplier' },
                { Value: s4_vendor_no_v,   Label: 'SAP supplier no' },
                { Value: billing_status_v, Label: 'Billing status' },
                { Value: invoice_number_v, Label: 'Invoice number' },
                { Value: invoice_line_v,   Label: 'Invoice line item' },
                { Value: invoice_status_v, Label: 'Invoice status' },
                // PROJECTED, not emitted - the fuel is in the wing. This is
                // the figure SAP Green Ledger receives.
                { Value: carbon_projected_kg, Label: 'Projected carbon (kg CO2)' },
                { Value: co2_factor_v,        Label: 'Combustion factor' }
            ]
        },

        // THE STATUS AND THE MESSAGE LEAD, because when something is wrong
        // that is the only part worth reading - the numbers below are blank
        // precisely then.
        FieldGroup #S4Posting: {
            Data: [
                { Value: s4_posting_status,   Label: 'Posting status' },
                { Value: s4_posting_message,  Label: 'Posting message' },
                { Value: s4_posted_at,        Label: 'Last attempted' },
                { Value: s4_contract_number,  Label: 'Contract called off' },
                { Value: s4_po_number,        Label: 'Purchase order' },
                { Value: s4_po_item,          Label: 'PO item' },
                { Value: s4_po_quantity,      Label: 'PO quantity' },
                { Value: s4_po_unit,          Label: 'PO unit' },
                { Value: s4_gr_number,        Label: 'Goods receipt' },
                { Value: s4_gr_year,          Label: 'GR year' },
                { Value: s4_invoice_number,   Label: 'S/4 supplier invoice' },
                { Value: s4_invoice_year,     Label: 'S/4 invoice year' },
                { Value: s4_invoice_amount,   Label: 'S/4 invoice amount' },
                { Value: s4_invoice_currency, Label: 'Currency' },
                { $Type: 'UI.DataFieldForAction', Label: 'Post to S/4HANA',
                  Action: 'TicketService.postToS4' }
            ]
        },

        FieldGroup #Verification: {
            Data: [
                { Value: verified_by },
                { Value: verified_at }
            ]
        }
    }
);

annotate TicketService.FuelTickets with {
    // THE ID FIELD — server-generated on Create, never user-entered.
    // @Core.Computed is the standard OData V4 signal for "this field is
    // system-derived": Fiori elements renders it read-only in both the
    // create screen and afterwards, without needing a separate
    // FieldControl annotation the way the station-keyed order_number/
    // delivery_number fields use elsewhere in this codebase.
    internal_number     @title: 'Fuel Ticket ID' @Core.Computed;

    // Same titles/units as FuelOrderService.FuelTickets (order-fiori-
    // annotations.cds) throughout this block - identical field-for-field.
    ticket_number        @title: 'Ticket Number' @mandatory;
    // Derived now, not picked: the F4 moved onto the `flight` association
    // below so a pick names one flight ROW (and so carries its date), where
    // picking a flight NUMBER named a string that recurs every day it flies.
    flight_number         @title: 'Flight' @Common.FieldControl: #ReadOnly;
    // #ReadOnly for two reasons, not one: it is derived from the flight the
    // user picked, and without it the column inherits the @mandatory on
    // FLIGHT_SCHEDULE.flight_date and paints an asterisk on a field nobody
    // can type into.
    flight_date           @title: 'Flight Date' @Common.FieldControl: #ReadOnly;
    // NOT #ReadOnly ANY MORE, and that one word was the whole defect. The
    // tail carried a value help and a flat read-only control at the same
    // time, so the picker could never be opened and an uplift at a tail -
    // the case with no order and no flight to derive the tail from - could
    // not be captured. tailFieldControl is read-only under an order or a
    // flight and editable under neither. See srv/ticket-service.js.
    aircraft_reg         @title: 'Aircraft Reg' @Common.FieldControl: tailFieldControl;
    quantity             @title: 'Claimed Quantity' @mandatory @Measures.Unit: uom_code;
    uom_code             @title: 'Unit of Measure'
                          @Common.ValueList: {
                              CollectionPath: 'UnitsOfMeasure',
                              Parameters: [
                                  { $Type: 'Common.ValueListParameterInOut', LocalDataProperty: uom_code, ValueListProperty: 'uom_code' }
                              ]
                          };
    delivery_timestamp   @title: 'Delivery Time' @mandatory;
    meter_start          @title: 'Meter Start' @Measures.Unit: uom_code;
    meter_end            @title: 'Meter End' @Measures.Unit: uom_code;
    quantity_metered     @title: 'Metered Quantity' @Measures.Unit: uom_code @Common.FieldControl: #ReadOnly;
    quantity_flag        @title: 'Quantity Basis';
    rate_per_litre       @title: 'Rate (per litre)' @Measures.ISOCurrency: currency_code;
    currency_code        @title: 'Currency';
    // Derived, never typed - @Core.Computed renders it read-only on the
    // create screen and afterwards, the same treatment internal_number gets.
    total_amount         @title: 'Total Amount' @Core.Computed @Measures.ISOCurrency: currency_code;
    quantity_kg          @title: 'Uplift by Meter (kg)' @Common.FieldControl: #ReadOnly;
    // MANDATORY ON A LITRE TICKET, optional on a mass one - the control is
    // computed per row (applyDensityFieldControl), because without a density
    // a litre figure never becomes the kilograms the ROB ledger, the
    // reconciliation and the invoice match all read.
    density_value        @title: 'Density' @Measures.Unit: density_uom
                         @Common.FieldControl: densityFieldControl;
    density_uom          @title: 'Density Unit'
        // EDITABLE SINCE 27 Oct 2026. It was read-only ("always KGL"), and CAP
        // drops a read-only field from the request - so a vendor's lb/USG
        // figure arrived unitless and was stored as kg/L, 8.3 times too
        // dense. The operator states the unit the ticket is printed in;
        // ticket-measurement.js converts and the row is still stored as KGL.
        @Common.QuickInfo: 'The unit the ticket states: KGL (kg/L), KGM (kg/m3) or LBG (lb per US gallon). Saved as KGL.';
    density_basis        @title: 'Density Basis';
    density_temp_c       @title: 'Density Temperature (°C)';
    batch_coa_ref         @title: 'Batch Certificate';
    vehicle_id             @title: 'Vehicle';
    meter_serial           @title: 'Meter Serial';
    // THE TICKET'S INVOICE, one click away. Semantic object `invoices`, the
    // inbound the Manage Fuel Invoices app registers in its manifest.
    //
    // THE ID MAPPING IS NOT DECORATION. Fiori hands the target app every
    // property named here, and the source row's own ID travels under the name
    // `ID` unless it is renamed - the invoices app would read that as an
    // invoice key and open nothing, or the wrong document. So ID is renamed
    // to something that app ignores, and listed FIRST so it is emptied before
    // anything useful is appended. This is the mirror of the link on the
    // invoice side (invoice-fiori-annotations.cds), where the same ordering
    // is recorded as load-bearing after it caused exactly that bug.
    invoice_number_v @Common.SemanticObject: 'invoices'
                     @Common.SemanticObjectMapping: [
                         { LocalProperty: ID,               SemanticObjectProperty: 'FuelTicketID' },
                         // THE INVOICE'S KEY, which is what makes this open the
                         // invoice instead of the invoice LIST. Fiori deep-links
                         // when the startup parameters carry the target's key;
                         // with only a number to go on it can do no better than
                         // open the list, which is what it did until 5 Oct 2026.
                         //
                         // THE KEY AND NOT A SEMANTIC KEY ON THE NUMBER: an
                         // invoice number is unique per SUPPLIER, not globally
                         // - INV473 exists to enforce that, and the seed carries
                         // a deliberate repeat to prove the check works. Keyed
                         // on the number, those would open one of two documents
                         // with nothing to say which.
                         { LocalProperty: invoice_id_v,     SemanticObjectProperty: 'ID' },
                         { LocalProperty: invoice_number_v, SemanticObjectProperty: 'invoice_number' }
                     ];

    meter_calibration_cert     @title: 'Calibration Certificate No'
                               @Common.QuickInfo: 'The meter calibration certificate this uplift was metered under, as printed on it. A meter reading is evidence only while the meter is certified.';
    meter_calibration_valid_to @title: 'Calibration Valid Until'
                               @Common.QuickInfo: 'The last day the certificate covers. Captured on the ticket, not the vehicle: recertifying a bowser later does not make an earlier reading certified.';
    supplier_ticket_ref  @title: 'Supplier Reference';
    ticket_source          @title: 'Ticket Source';
    ticket_capture_source  @title: 'Capture Source';
    status                @title: 'Status' @Common.FieldControl: #ReadOnly;
    match_status          @title: 'Match Status' @Common.FieldControl: #ReadOnly;
    verified_by           @title: 'Verified By' @Common.FieldControl: #ReadOnly;
    verified_at           @title: 'Verified At' @Common.FieldControl: #ReadOnly;

    // THE F4 ITSELF. Text + TextOnly make the field display just the order
    // number once picked (TextOnly, not TextFirst - TextFirst shows
    // "order_number (GUID)", which is what was actually rendering).
    // ValueList is what puts the search-help icon on the field at all -
    // annotating order_ID alone (as an earlier draft of this file did)
    // gives neither. Label is set here too - dropped when this block was
    // first written, which is why the field rendered with no label at all.
    order @(
        Common: {
            Label: 'Fuel Order',
            Text: order.order_number,
            TextArrangement: #TextOnly,
            ValueList: {
                Label: 'Fuel Order',
                CollectionPath: 'FuelOrders',
                Parameters: [
                    { $Type: 'Common.ValueListParameterInOut', LocalDataProperty: order_ID, ValueListProperty: 'ID' },
                    { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'order_number' },
                    { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'station_code' },
                    { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'flight_number' },
                    { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'status' }
                ]
            }
        }
    );

    flight @(
        Common: {
            Label: 'Flight',
            Text: flight.flight_number,
            TextArrangement: #TextOnly,
            ValueList: {
                Label: 'Flight',
                CollectionPath: 'FlightSchedule',
                Parameters: [
                    { $Type: 'Common.ValueListParameterInOut', LocalDataProperty: flight_ID, ValueListProperty: 'ID' },
                    { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'flight_number' },
                    { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'flight_date' },
                    { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'origin_airport' },
                    { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'destination_airport' },
                    { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'aircraft_reg' }
                ]
            }
        }
    );
};

// ============================================================================
// VIRTUAL ELEMENTS ARE NOT FILTERABLE - and Fiori has to be told.
//
// statusCriticality and densityFieldControl are computed per read by
// ticket-service.js; there is no column behind them, so a $filter on either
// is rejected by the server with "Virtual elements are not allowed in
// expressions" - a 500, which reached a user as "Internal Server Error".
//
// How it got there: a cross-app link hands the target the whole source row,
// and the Fuel Tickets list applies every incoming value whose NAME matches
// one of its own properties as a filter. The invoice row carried a
// statusCriticality of its own, which matched this virtual one by name.
// Declaring them non-filterable stops Fiori building a filter on them from
// ANY source - a startup parameter, an app state, or a user.
// ============================================================================
annotate TicketService.FuelTickets with @(
    // THE WHOLE SET, not only the two that a cross-app link once collided
    // with. The billing and carbon columns (srv/lib/ticket-billing.js,
    // srv/lib/carbon-emissions.js) are filled on read like the two above and
    // reject a filter for exactly the same reason; the column-header filter
    // enabled on 2 Oct 2026 made that reachable from the table itself rather
    // than only from an incoming startup parameter.
    Capabilities.FilterRestrictions: {
        NonFilterableProperties: [
            statusCriticality, densityFieldControl,
            supplier_name_v, s4_vendor_no_v, billing_status_v,
            invoice_id_v, invoice_number_v, invoice_line_v, invoice_status_v,
            invoice_count_v, carbon_projected_kg, co2_factor_v
        ]
    },
    // AND SORTING, which the original pair never declared. $orderby is pushed
    // down the same way $filter is: sorting a virtual is the same 500.
    Capabilities.SortRestrictions: {
        NonSortableProperties: [
            statusCriticality, densityFieldControl,
            supplier_name_v, s4_vendor_no_v, billing_status_v,
            invoice_id_v, invoice_number_v, invoice_line_v, invoice_status_v,
            invoice_count_v, carbon_projected_kg, co2_factor_v
        ]
    }
);

// ============================================================================
// THE TICKET NUMBER IS THE SEMANTIC KEY - which is what makes the invoice's
// ticket link land on the ticket.
//
// Read from the UI5 source (sap.fe.core RoutingService), not assumed. When an
// app opens from another app, Fiori decides whether to deep-link straight to
// an object page by looking for the entity's keys in the startup parameters,
// and SEMANTIC KEYS ARE CHECKED FIRST:
//
//   const m = semanticKey ? keysFromStartupParams(semanticKey) : undefined;
//   const d = !m ? keysFromStartupParams(technicalKey)      : undefined;
//
// With no semantic key declared, Fiori fell back to ID - and ID is exactly
// the parameter the invoicing app struggles to hand over cleanly, since it
// passes the whole invoice row and that row has an ID of its own. When the
// key did not arrive as a single value, there was no deep link, the list
// loaded instead, and the list applied the invoice's other fields as filters.
//
// ticket_number arrives cleanly: it is the number the supplier quoted and the
// link carries it by name. As the semantic key, Fiori deep-links on it -
// querying ticket_number and requiring EXACTLY ONE row - and never consults
// ID at all. It is also simply the right key: it is what a person uses to
// identify a ticket, and it is already this entity's HeaderInfo title.
//
// Relies on ticket numbers being unique (all 30 seeded are). Where two ever
// collide, Fiori finds two rows, declines to guess, and shows the list
// filtered to both - a safe failure, not a wrong ticket.
// ============================================================================
annotate TicketService.FuelTickets with @(
    Common.SemanticKey: [ ticket_number ]
);

// ============================================================================
// WHICH DELIVERY THIS TICKET BELONGS TO (Sep 2026).
//
// The first ticket of a flight raises its own delivery and needs neither
// field. A later one does: the operator either picks a delivery this flight
// already has, or ticks the box for another. The dropdown is filtered to THIS
// flight - a delivery on another flight is never the right answer, and an
// unfiltered list of every delivery in the system invites exactly that error.
//
// The checkbox WINS over the dropdown, which srv/lib/ticket-delivery.js states
// and the label says here, so the screen and the rule cannot disagree.
// ============================================================================
annotate TicketService.FuelTickets with {
    delivery @(
        Common: {
            Label: 'Fuel Delivery',
            Text: delivery.delivery_number,
            TextArrangement: #TextOnly,
            ValueList: {
                Label: 'Deliveries for this flight',
                CollectionPath: 'FuelDeliveries',
                Parameters: [
                    { $Type: 'Common.ValueListParameterInOut', LocalDataProperty: delivery_ID, ValueListProperty: 'ID' },
                    { $Type: 'Common.ValueListParameterIn', LocalDataProperty: flight_ID, ValueListProperty: 'flight_ID' },
                    { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'delivery_number' },
                    { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'delivery_date' },
                    { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'delivery_time' },
                    { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'delivered_quantity' },
                    { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'status' }
                ]
            }
        }
    );
    create_new_delivery @title: 'Create new delivery for this ticket'
                        @Common.QuickInfo: 'Ticked, a new delivery is raised for this ticket and whatever is in Fuel Delivery is ignored. Two suppliers fuelling one turnaround are one delivery with two tickets; a separate uplift is a separate delivery, and only the person capturing it can tell which this is.';
};

// The rate's currency: defaulted from the contract on the order (USD where
// there is none) and picked from the currency master when it differs.
annotate TicketService.FuelTickets with {
    currency_code @(
        Common: {
            Label: 'Currency',
            ValueListWithFixedValues: true,
            ValueList: {
                Label: 'Currency',
                CollectionPath: 'Currencies',
                Parameters: [
                    { $Type: 'Common.ValueListParameterInOut', LocalDataProperty: currency_code, ValueListProperty: 'currency_code' },
                    { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'currency_name' },
                    { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'symbol' }
                ]
            }
        }
    );
};

// ===========================================================================
// WHERE A TICKET WAS BILLED - one row per invoice line
// ===========================================================================
//
// THE VENDOR AND THE CHARGE ARE THE TWO COLUMNS THAT MATTER, and neither was
// reachable before. A ticket under a third-party into-plane arrangement
// carries two lines: the supplier's fuel and the agent's uplift service. With
// only the invoice number and the line item visible, those two rows are
// indistinguishable from a double-billing; with the vendor and the charge they
// read as the arrangement they are.
//
// Ordered by charge then vendor, so the fuel line leads and the handling line
// follows it - the order somebody reading a ticket expects, and stable where
// two agents bill the same uplift.
annotate TicketService.TicketInvoiceLines with @(
    UI: {
        LineItem: [
            { Value: invoice_number,    Label: 'Invoice number',   ![@UI.Importance]: #High },
            { Value: line_number,       Label: 'Invoice line item', ![@UI.Importance]: #High },
            { Value: charge_type,       Label: 'Charge',           ![@UI.Importance]: #High },
            { Value: vendor_name,       Label: 'Billed by',        ![@UI.Importance]: #High },
            { Value: vendor_s4_no,      Label: 'SAP vendor no',    ![@UI.Importance]: #Low },
            { Value: invoice_date,      Label: 'Invoice date',     ![@UI.Importance]: #Medium },
            { Value: invoice_status,    Label: 'Invoice status',    ![@UI.Importance]: #Medium },
            { Value: description,       Label: 'Description',      ![@UI.Importance]: #Low },
            { Value: quantity,          Label: 'Quantity',         ![@UI.Importance]: #Medium },
            { Value: quantity_cv,          Label: 'Quantity (carrier)',         ![@UI.Importance]: #Medium },
            { Value: uom_code,          Label: 'UoM',              ![@UI.Importance]: #Low },
            { Value: unit_price,        Label: 'Unit price',       ![@UI.Importance]: #Medium },
            { Value: net_amount,        Label: 'Net amount',       ![@UI.Importance]: #High },
            { Value: tolerance_status,  Label: 'Tolerance',        ![@UI.Importance]: #Low }
        ],

        PresentationVariant: {
            SortOrder: [ { Property: charge_type }, { Property: vendor_name }, { Property: line_number } ],
            Visualizations: ['@UI.LineItem']
        },

        HeaderInfo: {
            TypeName       : 'Invoice line',
            TypeNamePlural : 'Invoice Lines',
            Title          : { Value: invoice_number },
            Description    : { Value: charge_type }
        }
    }
);

annotate TicketService.TicketInvoiceLines with {
    invoice_number   @title: 'Invoice number';
    line_number      @title: 'Invoice line item';
    charge_type      @title: 'Charge'
                     @Common.QuickInfo: 'FUEL is the product. INTO_PLANE is the service of putting it in the wing, billed by a third-party agent where the supplier does not do it.';
    vendor_name      @title: 'Billed by'
                     @Common.QuickInfo: 'The invoice header supplier. Two rows with different vendors on one ticket is a third-party into-plane arrangement, not a duplicate.';
    vendor_s4_no     @title: 'SAP vendor no';
    invoice_date     @title: 'Invoice date';
    invoice_status   @title: 'Invoice status';
    description      @title: 'Description';
    quantity         @title: 'Quantity';
    uom_code         @title: 'UoM';
    unit_price       @title: 'Unit price';
    net_amount       @title: 'Net amount';
    tax_amount       @title: 'Tax amount';
    tolerance_status @title: 'Tolerance';
    line_match_status @title: 'Match status';
}

// ===========================================================================
// THE S/4 TRAIL - titles, because a card column with none falls back to the
// technical name and ui02 EXIT-2c ratchets exactly that.
// ===========================================================================
// ---------------------------------------------------------------------------
// EVERY FIELD BELOW IS WRITTEN BY THE POSTING, NEVER BY A USER.
//
// They are what S/4 answered - the purchase order it created, the goods
// receipt, the invoice, and the status of the exchange. A typeable PO number
// is an invitation to record a document that does not exist, and nothing
// would ever reconcile against it. Read-only on the screen; postToS4 is the
// only thing that fills them.
// ---------------------------------------------------------------------------
annotate TicketService.FuelTickets with {
    s4_posting_status    @readonly;
    s4_posting_message   @readonly;
    s4_posted_at         @readonly;
    s4_contract_number   @readonly;
    s4_po_number         @readonly;
    s4_po_item           @readonly;
    s4_po_quantity       @readonly;
    s4_po_unit           @readonly;
    s4_gr_number         @readonly;
    s4_gr_year           @readonly;
    s4_invoice_number    @readonly;
    s4_invoice_year      @readonly;
    s4_invoice_amount    @readonly;
    s4_invoice_currency  @readonly;
    s4_fi_posting_date   @readonly;
};

annotate TicketService.FuelTickets with {
    s4_posting_status    @title: 'S/4 Posting Status'
                         @Common.QuickInfo: 'S complete, P partial - some documents posted and a later step failed, E error. Empty means the ticket has never been sent to S/4.';
    s4_posting_message   @title: 'S/4 Posting Message'
                         @Common.QuickInfo: 'What S/4 said, prefixed with the FuelSphere code for the step still missing: INT401 no purchase order, INT402 no goods receipt, INV406 no supplier invoice.'
                         @UI.MultiLineText;
    s4_posted_at         @title: 'S/4 Last Attempted'
                         @Common.QuickInfo: 'Stamped on every attempt including the failures, so a stale error cannot look fresh.';
    s4_contract_number   @title: 'Contract Called Off'
                         @Common.QuickInfo: 'The contract S/4 actually used. It can differ from the order''s: where no contract is sent, S/4 picks the valid one for the plant and material with open quantity.';
    s4_po_number         @title: 'Purchase Order'
                         @Common.QuickInfo: 'Created in S/4 when the ticket was saved. Open it with ME23N.';
    s4_po_item           @title: 'PO Item';
    s4_po_quantity       @title: 'PO Quantity'
                         @Common.QuickInfo: 'As the purchase order carries it, which is not always what the ticket says - a kilogram ticket against a contract in litres is converted by S/4 using the density.';
    s4_po_unit           @title: 'PO Unit';
    s4_gr_number         @title: 'Goods Receipt'
                         @Common.QuickInfo: 'Movement type 101, posted with the purchase order. Open it with MB03 - the year is part of the key.';
    s4_gr_year           @title: 'GR Year';
    s4_invoice_number    @title: 'S/4 Supplier Invoice'
                         @Common.QuickInfo: 'Posted from the Invoices app, not on ticket save: the invoice follows the supplier''s document. Distinct from the FuelSphere invoice number above, which is the document being verified.';
    s4_invoice_year      @title: 'S/4 Invoice Year';
    s4_invoice_amount    @title: 'S/4 Invoice Amount';
    s4_invoice_currency  @title: 'S/4 Invoice Currency';
}

// ===========================================================================
// THE POSTING HISTORY, AND THE MESSAGES UNDER IT
// ===========================================================================
//
// NEWEST FIRST. A ticket posted three times is read from the outcome
// backwards - what is true now, then how it got there. Ascending order would
// bury the current state at the bottom of the table.
annotate TicketService.TicketPostingAttempts with @(
    UI: {
        LineItem: [
            { Value: attempt_no,      Label: 'Attempt',       ![@UI.Importance]: #High },
            { Value: attempted_at,    Label: 'When',          ![@UI.Importance]: #High },
            { Value: posting_kind,    Label: 'Posting',       ![@UI.Importance]: #High },
            { Value: outcome,         Label: 'Outcome',       ![@UI.Importance]: #High,
              Criticality: outcomeCriticality },
            { Value: message,         Label: 'Message',       ![@UI.Importance]: #High },
            { Value: po_number,       Label: 'Purchase order', ![@UI.Importance]: #Medium },
            { Value: po_item,         Label: 'PO item',       ![@UI.Importance]: #Low },
            { Value: gr_number,       Label: 'Goods receipt', ![@UI.Importance]: #Medium },
            { Value: gr_year,         Label: 'GR year',       ![@UI.Importance]: #Low },
            { Value: fi_doc_number,   Label: 'FI document',   ![@UI.Importance]: #Medium },
            { Value: company_code,    Label: 'Company code',  ![@UI.Importance]: #Low },
            { Value: contract_number, Label: 'Contract',      ![@UI.Importance]: #Low },
            { Value: invoice_number,  Label: 'S/4 invoice',   ![@UI.Importance]: #Medium }
        ],

        PresentationVariant: {
            SortOrder: [ { Property: attempt_no, Descending: true } ],
            Visualizations: ['@UI.LineItem']
        },

        HeaderInfo: {
            TypeName       : 'Posting attempt',
            TypeNamePlural : 'Posting Attempts',
            Title          : { Value: posting_kind },
            Description    : { Value: outcome }
        },

        Facets: [
            { $Type: 'UI.ReferenceFacet', ID: 'AttemptDetail',
              Target: '@UI.FieldGroup#AttemptDetail', Label: 'What S/4 created' },
            { $Type: 'UI.ReferenceFacet', ID: 'AttemptMessages',
              Target: 'messages/@UI.LineItem', Label: 'S/4HANA Messages' }
        ],

        FieldGroup #AttemptDetail: {
            Data: [
                { Value: attempt_no,              Label: 'Attempt' },
                { Value: posting_kind,            Label: 'Posting' },
                { Value: outcome,                 Label: 'Outcome' },
                { Value: attempted_at,            Label: 'Attempted at' },
                { Value: message,                 Label: 'Message' },
                { Value: company_code,            Label: 'Company code' },
                { Value: contract_number,         Label: 'Contract called off' },
                { Value: po_number,               Label: 'Purchase order' },
                { Value: po_item,                 Label: 'PO item' },
                { Value: po_quantity,             Label: 'PO quantity' },
                { Value: po_unit,                 Label: 'PO unit' },
                { Value: gr_number,               Label: 'Goods receipt' },
                { Value: gr_year,                 Label: 'GR year' },
                { Value: fi_doc_number,           Label: 'FI document' },
                { Value: fi_fiscal_year,          Label: 'FI fiscal year' },
                { Value: ses_number,              Label: 'Service entry sheet' },
                { Value: gi_doc_number,           Label: 'Goods issue' },
                { Value: gi_doc_year,             Label: 'GI year' },
                { Value: invoice_number,          Label: 'S/4 invoice' },
                { Value: invoice_item,            Label: 'S/4 invoice item' },
                { Value: invoice_year,            Label: 'S/4 invoice year' },
                { Value: supplier_invoice_number, Label: 'Supplier invoice no' }
            ]
        }
    }
);

annotate TicketService.TicketPostingAttempts with {
    attempt_no      @title: 'Attempt'
                    @Common.QuickInfo: 'Counted within the ticket, in the order attempted. A ticket posted, reversed and posted again has three.';
    attempted_at    @title: 'When';
    posting_kind    @title: 'Posting'
                    @Common.QuickInfo: 'UPLIFT is the PO and goods receipt. INTO_PLANE is a third-party agent service chain, GOODS_ISSUE a draw from the airline own storage, INVOICE the supplier invoice, REVERSAL an undo of an earlier attempt.';
    outcome         @title: 'Outcome'
                    @Common.QuickInfo: 'S both documents posted. POERR the purchase order failed and nothing posted. GRERR the purchase order posted and the goods receipt failed. P partial, E error.';
    message         @title: 'Message' @UI.MultiLineText;
    company_code    @title: 'Company Code';
    contract_number @title: 'Contract Called Off';
    po_number       @title: 'Purchase Order';
    po_item         @title: 'PO Item';
    po_quantity     @title: 'PO Quantity';
    po_unit         @title: 'PO Unit';
    gr_number       @title: 'Goods Receipt';
    gr_year         @title: 'GR Year';
    fi_doc_number   @title: 'FI Document'
                    @Common.QuickInfo: 'Created by the goods receipt. Empty until S/4 returns it - see CR-2 in docs/S4_Backend_Change_Requests.md.';
    fi_fiscal_year  @title: 'FI Fiscal Year';
    ses_number      @title: 'Service Entry Sheet';
    gi_doc_number   @title: 'Goods Issue';
    gi_doc_year     @title: 'GI Year';
    invoice_number  @title: 'S/4 Invoice';
    invoice_item    @title: 'S/4 Invoice Item';
    invoice_year    @title: 'S/4 Invoice Year';
    supplier_invoice_number @title: 'Supplier Invoice No';
}

// THE MESSAGE CLASS AND NUMBER ARE COLUMNS, not text to read. "M8 215" is
// how a functional person finds the tolerance-key problem; burying it in a
// sentence makes them read every sentence.
annotate TicketService.TicketPostingMessages with @(
    UI: {
        LineItem: [
            { Value: msg_type,   Label: 'Type',    ![@UI.Importance]: #High,
              Criticality: msgCriticality },
            { Value: step,       Label: 'Step',    ![@UI.Importance]: #High },
            { Value: msg_id,     Label: 'Class',   ![@UI.Importance]: #High },
            { Value: msg_number, Label: 'Number',  ![@UI.Importance]: #High },
            { Value: msg_text,   Label: 'Message', ![@UI.Importance]: #High },
            { Value: msg_v1,     Label: 'Var 1',   ![@UI.Importance]: #Low },
            { Value: msg_v2,     Label: 'Var 2',   ![@UI.Importance]: #Low },
            { Value: msg_v3,     Label: 'Var 3',   ![@UI.Importance]: #Low },
            { Value: msg_v4,     Label: 'Var 4',   ![@UI.Importance]: #Low }
        ],
        PresentationVariant: {
            SortOrder: [ { Property: sequence } ],
            Visualizations: ['@UI.LineItem']
        }
    }
);

annotate TicketService.TicketPostingMessages with {
    msg_type   @title: 'Type'
               @Common.QuickInfo: 'E error, W warning, I information, S success - as S/4 types them.';
    step       @title: 'Step'
               @Common.QuickInfo: 'Which step raised it: PO, GR, FI, SES, GI or INVOICE. The same message class can come from more than one.';
    msg_id     @title: 'Message Class'
               @Common.QuickInfo: 'The SAP message class, e.g. M8. Looked up with the number in SE91.';
    msg_number @title: 'Message Number';
    msg_text   @title: 'Message' @UI.MultiLineText;
    msg_v1     @title: 'Variable 1';
    msg_v2     @title: 'Variable 2';
    msg_v3     @title: 'Variable 3';
    msg_v4     @title: 'Variable 4';
    sequence   @title: 'Sequence';
}


// ============================================================================
// Uplift at tail, and uplift from a storage location
// ============================================================================
//
// THE TAIL WAS ONLY EVER DERIVED - from the order, or from the flight. That
// covers an ordered uplift and leaves out the one the schema has always
// anticipated: a verbal top-up, a diversion, an aircraft on the ground. The
// field stays auto-filled on the order and flight paths; the value help is
// what makes the third path reachable.
//
// ON aircraft_reg ITSELF, which is a real String element and so can carry a
// value list. The generated foreign key tail_registration cannot - annotating
// one is discarded in silence, which is what left every picker on the
// defueling app showing a GUID.
annotate TicketService.Tails with @(
    UI.LineItem: [
        { Value: registration,       Label: 'Tail No.' },
        { Value: aircraft_type_code, Label: 'Type' },
        { Value: fuel_capacity_kg,   Label: 'Capacity (kg)' }
    ]
);

annotate TicketService.Tails with {
    registration       @title: 'Tail No.';
    aircraft_type_code @title: 'Type';
    fuel_capacity_kg   @title: 'Capacity (kg)';
};

annotate TicketService.StorageLocations with @(
    UI.LineItem: [
        { Value: code,          Label: 'Location' },
        { Value: description,   Label: 'Description' },
        { Value: station_code,  Label: 'Station' },
        // THE TYPE IS SHOWN so a user picking a source can see that a DEFUEL
        // tank is not one, rather than discovering it on save.
        { Value: location_type, Label: 'Type' }
    ]
);

annotate TicketService.StorageLocations with {
    ID            @UI.Hidden;
    code          @title: 'Location';
    description   @title: 'Description';
    station_code  @title: 'Station';
    location_type @title: 'Type';
};

annotate TicketService.FuelTickets with {
    uplift_source         @title: 'Fuel Source';
    storage_location_code @title: 'Storage Location';

    // THE SAME CONTROL THE TAIL USES, because it is the same case: derived
    // under an order or a flight, the user's to state under neither.
    station_code          @title: 'Station' @Common.FieldControl: tailFieldControl;

    station_code @(Common: {
        ValueList: {
            CollectionPath: 'Airports',
            Label: 'Airports',
            Parameters: [
                { $Type: 'Common.ValueListParameterInOut',
                  LocalDataProperty: station_code, ValueListProperty: 'iata_code' },
                { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'airport_name' },
                { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'city' }
            ]
        }
    });

    // TWO ROWS, SO IT IS A SELECT rather than a text box somebody types
    // SUPPLIER into. ValueListWithFixedValues renders it inline instead of
    // opening a dialog to choose between two.
    uplift_source @(Common: {
        ValueListWithFixedValues: true,
        ValueList: {
            CollectionPath: 'UpliftSources',
            Label: 'Fuel source',
            Parameters: [
                { $Type: 'Common.ValueListParameterInOut',
                  LocalDataProperty: uplift_source, ValueListProperty: 'code' },
                { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'name' }
            ]
        }
    });

    aircraft_reg @(Common: {
        ValueList: {
            CollectionPath: 'Tails',
            Label: 'Aircraft',
            Parameters: [
                { $Type: 'Common.ValueListParameterInOut',
                  LocalDataProperty: aircraft_reg, ValueListProperty: 'registration' },
                { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'aircraft_type_code' },
                { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'fuel_capacity_kg' }
            ]
        }
    });

    storage_location_code @(Common: {
        ValueList: {
            CollectionPath: 'StorageLocations',
            Label: 'Storage Locations',
            Parameters: [
                { $Type: 'Common.ValueListParameterInOut',
                  LocalDataProperty: storage_location_code, ValueListProperty: 'code' },
                { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'description' },
                { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'station_code' },
                { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'location_type' }
            ]
        }
    });
};

// THE STORAGE LOCATION IS ONLY ASKED FOR WHEN THE FUEL CAME FROM ONE. On a
// supplier uplift it would be a field inviting an answer that the service
// then has to clear.
annotate TicketService.FuelTickets with @(
    Common.SideEffects #SourcePicked: {
        SourceProperties : [uplift_source],
        TargetProperties : ['storage_location_code', 'supplier_name_v']
    }
);
