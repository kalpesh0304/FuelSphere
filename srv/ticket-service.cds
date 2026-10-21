/**
 * FuelSphere - Ticket Service
 *
 * Standalone service for independent Fuel Ticket management
 * Allows creating/managing tickets outside the FuelOrders draft flow
 *
 * Service Path: /odata/v4/tickets
 */

using { fuelsphere as db } from '../db/schema';

@path: '/odata/v4/tickets'
service TicketService {

    // ========================================================================
    // FUEL TICKETS - Independent Management
    // ========================================================================

    /**
     * FuelTickets - Standalone Fuel Ticket Entity
     * Draft-enabled for independent ticket management
     *
     * order is NOT mandatory here - matches db/schema.cds decision A1: fuel
     * is routinely delivered with no order in the system at all, and this
     * app accepts that ticket same as any other capture path does. A ticket
     * captured through this app can instead reference a Flight directly, or
     * neither, or both - nothing here or in ticket-service.js gates on it.
     *
     * Picking an order auto-fills the flight fields from it (populateFromOrder
     * in ticket-service.js). Picking a flight directly (no order) auto-fills
     * aircraft_reg from it instead (populateFromFlight). internal_number is
     * generated from whichever flight is resolved either way, falling back
     * to station numbering where only an order is available, and left unset
     * where neither is.
     */
    @odata.draft.enabled
    entity FuelTickets as projection on db.FUEL_TICKETS {
        *,
        order    : redirected to FuelOrders,
        flight   : redirected to FlightSchedule,
        delivery : redirected to FuelDeliveries,
        // The ticket's own flight where it has one, the order's otherwise -
        // a ticket may be raised against either (A1). A column rather than an
        // association path so the LIST can sort and filter on it; the object
        // page reads flight.flight_date through the association as before.
        coalesce(flight.flight_date, order.flight.flight_date) as flight_date : Date,
        virtual null as statusCriticality : Integer,

        // WHO SOLD THE FUEL, AND WHERE IT ENDED UP BILLED. Asked for 1 Oct
        // 2026. All four are read at read time (srv/ticket-service.js) rather
        // than stored: the supplier belongs to the order and the invoice line
        // belongs to the invoice, and copying either onto the ticket would
        // leave it saying something the source has since corrected.
        //
        // A ticket may carry several invoice lines in principle. Where it
        // does, these name the FIRST and the count says so - the detail is in
        // the invoice itself, and a ticket billed twice is an exception the
        // invoice screens already report.
        virtual null as supplier_name_v    : String(100),
        virtual null as s4_vendor_no_v     : String(10),
        virtual null as billing_status_v   : String(12),
        // THE INVOICE'S KEY, so the link on the number can open that invoice
        // rather than the invoice list. Not displayed - it exists to be handed
        // to the target app as a startup parameter.
        virtual null as invoice_id_v       : UUID,
        virtual null as invoice_number_v   : String(30),
        virtual null as invoice_line_v     : Integer,
        virtual null as invoice_status_v   : String(20),
        virtual null as invoice_count_v    : Integer,

        // PROJECTED CARBON, uplift x the combustion factor. Projected, not
        // emitted: the fuel is in the wing and may be burnt on another leg or
        // tankered onward. This is the figure headed for SAP Green Ledger.
        virtual null as carbon_projected_kg : Decimal(15,3),
        virtual null as co2_factor_v        : Decimal(8,4),
        // Drives density_value/density_uom's FieldControl: mandatory on a
        // volume ticket, optional on a mass one. See applyDensityFieldControl.
        virtual null as densityFieldControl : Integer @UI.Hidden,

        // EVERY LINE THAT BILLED THIS TICKET, not just the first. The three
        // scalars above name the first and count the rest, which was the
        // whole truth while a second line meant a duplicate. A third-party
        // into-plane agent bills the uplift separately from the supplier's
        // fuel, so the object page needs the list.
        invoice_lines : redirected to TicketInvoiceLines,

        // EVERY S/4 POSTING OF THIS TICKET. The s4_* fields hold the latest;
        // this is the chain - posted, reversed, reposted - which the business
        // asked to be kept in full.
        s4_attempts   : redirected to TicketPostingAttempts
    } actions {
        /**
         * Attach ticket to delivery
         */
        action attachToDelivery(deliveryId: UUID) returns FuelTickets;

        /**
         * Attach an unmatched ticket to an order - the matching workbench.
         * Allocates the internal number if the ticket was captured without one.
         */
        action attachToOrder(orderId: UUID) returns FuelTickets;

        /**
         * Verify ticket
         */
        action verify() returns FuelTickets;

        /**
         * Reject ticket
         */
        action reject(reason: String) returns FuelTickets;
    };

    // ========================================================================
    // REFERENCE DATA (Read-only)
    // ========================================================================

    @readonly
    entity FuelOrders as projection on db.FUEL_ORDERS {
        *,
        airport  : redirected to Airports,
        supplier : redirected to Suppliers,
        // See the identical note in delivery-service.cds: the order F4 lists a
        // Flight column that had no element behind it.
        flight.flight_number as flight_number
    };

    @readonly
    entity FuelDeliveries as projection on db.FUEL_DELIVERIES {
        *,
        order : redirected to FuelOrders
    };

    // Value-help target for flight_number's F4 - the alternative to picking
    // an order.
    @readonly
    entity FlightSchedule as projection on db.FLIGHT_SCHEDULE;

    @readonly
    entity Airports as projection on db.MASTER_AIRPORTS;

    @readonly
    entity Suppliers as projection on db.MASTER_SUPPLIERS;

    /**
     * TicketPostingAttempts - what S/4 did, attempt by attempt.
     *
     * READ-ONLY, AND THAT IS NOT NEGOTIABLE. Every row is what S/4 answered;
     * a row typed on a screen would be a document number nobody can find in
     * S/4. The only way a row appears here is a posting.
     *
     * THE FAILURES ARE THE POINT. A ticket that posted cleanly needs one
     * glance at the card above it; a ticket that did not is why this table
     * exists, which is why outcome and message lead the columns.
     */
    @readonly
    // THE CANONICAL PROJECTION OF S4_POSTING_ATTEMPTS ON THIS SERVICE.
    //
    // S4PostingErrors projects it too, so CAP cannot pick a target for
    // TicketPostingMessages:attempt and refuses to guess. Pinned HERE
    // because this is the one the ticket page navigates into; the error tile
    // is a report over the same rows, not the place a message belongs to.
    // Same reasoning as @cds.redirection.target on InvoiceService.FuelTickets.
    @cds.redirection.target
    entity TicketPostingAttempts as projection on db.S4_POSTING_ATTEMPTS {
        *,
        ticket   : redirected to FuelTickets,
        messages : redirected to TicketPostingMessages,

        // A SEARCHED CASE, NOT A SIMPLE ONE. `case outcome when null then 0`
        // never matches - SQL compares NULL with = and gets unknown, so every
        // unposted row would fall through to the else and render GREEN. That
        // defect is recorded in invoice-service.cds and is not repeated here.
        //
        // Every branch is a PREDICATE, which HANA requires: a bare column as
        // a CASE condition compiles on SQLite and fails the HANA view builder
        // with "incorrect syntax near THEN" - already paid for once.
        case
            when outcome = 'S'                      then 3
            when outcome = 'P'                      then 2
            when outcome in ('E', 'POERR', 'GRERR') then 1
            else                                         0
        end as outcomeCriticality : Integer
    };

    /**
     * TicketPostingMessages - the S/4 application log for one attempt.
     *
     * The message class and number are what a functional person looks up -
     * M8 215 is the tolerance-key problem by name - so they are columns, not
     * buried in the text.
     */
    /**
     * S4PostingErrors - the tile, across every ticket.
     *
     * WHAT THE BUSINESS ASKED FOR, in its words: error details "logged
     * (similar to SAP application log) and accessible via a tile to
     * understand reason of error and resolution".
     *
     * CROSS-TICKET, AND THAT IS THE DIFFERENCE from the history table on the
     * ticket page. The question at 08:00 is "what failed overnight", not
     * "what happened to this one ticket" - and answering the first from the
     * second means opening tickets one at a time to find out which broke.
     *
     * NOT FILTERED TO FAILURES IN THE MODEL. The entity carries every
     * attempt and the app's own filter opens on the failures: a reader who
     * has fixed a configuration problem wants to see the successful repost
     * beside the error it replaced, and a view that cannot show success
     * cannot show that it was fixed.
     */
    @readonly
    entity S4PostingErrors as projection on db.S4_POSTING_ATTEMPTS {
        *,
        // ---- THE STAMP FIRST, THE ASSOCIATION AS FALLBACK ---------------
        //
        // These read ONLY through `ticket` until 21 Oct 2026, and the posting
        // log showed a column of outcomes with no ticket, no tail and no
        // flight beside them - rows that say something failed without saying
        // what. Whatever stops the association resolving (a ticket deleted
        // after its posting, a row whose fields were never filled), the log
        // is the one place that must still be able to say which uplift it is
        // talking about.
        //
        // THE COALESCE IS FOR THE ROWS THAT PREDATE THE STAMP. Attempts
        // written before this change have no stamped values, so they keep
        // resolving the old way; attempts written after it no longer depend
        // on anything but themselves. Once no unstamped rows remain the
        // fallback can go, and nothing will change when it does.
        coalesce(ticket_number,      ticket.ticket_number)      as ticket_number      : String(50),
        coalesce(internal_number,    ticket.internal_number)    as internal_number    : String(30),
        coalesce(aircraft_reg,       ticket.aircraft_reg)       as aircraft_reg       : String(10),
        coalesce(flight_number,      ticket.flight_number)      as flight_number      : String(10),
        coalesce(delivery_timestamp, ticket.delivery_timestamp) as delivery_timestamp : Timestamp,
        ticket                      : redirected to FuelTickets,
        messages                    : redirected to TicketPostingMessages,

        // THE FIRST MESSAGE'S CLASS AND NUMBER, ON THE LIST ROW. "M8 215" is
        // how the tolerance-key problem is recognised, and a list that makes
        // somebody open each row to see it is a list nobody scans.
        case
            when outcome = 'S'                      then 3
            when outcome = 'P'                      then 2
            when outcome in ('E', 'POERR', 'GRERR') then 1
            else                                         0
        end as outcomeCriticality : Integer,

        // A PLAIN FLAG TO FILTER ON. The app opens on failures, and a filter
        // bar needs something simpler than three status values to do it.
        case
            when outcome in ('E', 'POERR', 'GRERR') then true
            else                                         false
        end as is_failure : Boolean
    };

    @readonly
    entity TicketPostingMessages as projection on db.S4_POSTING_MESSAGES {
        *,
        case
            when msg_type = 'S' then 3
            when msg_type = 'W' then 2
            when msg_type = 'E' then 1
            else                     0
        end as msgCriticality : Integer
    };

    /**
     * TicketInvoiceLines - where this ticket was billed, one row per line.
     *
     * READ-ONLY AND FLATTENED. An invoice line belongs to the invoice, not to
     * the ticket; this exists so the ticket page can SHOW the billing without
     * owning it, and nothing here is editable from a ticket screen.
     *
     * THE VENDOR IS ON THE INVOICE, NOT THE LINE, and that is the column that
     * makes the table worth having. Under a third-party into-plane
     * arrangement the same ticket carries two lines whose charge_type differs
     * and whose VENDORS differ - the supplier billed the fuel, the agent
     * billed putting it in the wing. Without the vendor the two rows look
     * like a duplicate; with it they read as the arrangement.
     */
    @readonly
    entity TicketInvoiceLines as projection on db.INVOICE_ITEMS {
        ID,
        ticket,
        invoice,
        invoice.invoice_number           as invoice_number   : String(30),
        invoice.invoice_date             as invoice_date     : Date,
        invoice.status                   as invoice_status    : String(20),
        invoice.supplier.supplier_name   as vendor_name       : String(100),
        invoice.supplier.s4_vendor_no    as vendor_s4_no      : String(10),
        line_number,
        charge_type,
        description,
        quantity,
        uom_code,
        unit_price,
        net_amount,
        tax_amount,
        line_match_status,
        tolerance_status
    };

    // Value-help target for uom_code's F4.
    @readonly
    entity UnitsOfMeasure as projection on db.UNIT_OF_MEASURE;

    // The currency behind the rate's F4.
    @readonly
    entity Currencies as projection on db.CURRENCY_MASTER;

    // ========================================================================
    // SERVICE-LEVEL FUNCTIONS
    // ========================================================================

    /**
     * Generate next ticket number for a station
     * Format: FT-{STATION}-{YYYYMMDD}-{SEQ}
     */
    function generateTicketNumber(stationCode: String, ticketDate: Date) returns String;

    /**
     * Get tickets by order
     */
    function getTicketsByOrder(orderId: UUID) returns array of FuelTickets;

    /**
     * Get unattached tickets (not linked to any delivery)
     */
    function getUnattachedTickets(stationCode: String) returns array of FuelTickets;

    /**
     * Capture a supplier's fuel ticket against an order.
     *
     * THE ONE WRITER. FuelOrderService.FuelOrders offers a bound form of this
     * so a clerk can raise a ticket from the order they are looking at; that
     * handler delegates here and writes nothing itself. D44 is two independent
     * implementations of one rule disagreeing one day with nothing to notice.
     *
     * NO GATE - DECISION A1. The fuel is already in the tanks when a ticket is
     * written, so capture is never blocked. That is the opposite of order
     * creation, which refuses on MDM402 for a provisional registration. A
     * ticket with no order at all is legitimate and seeded (5 of 30), so this
     * is the DEMO path rather than the only one, and `getUnattachedTickets`
     * already serves the other.
     *
     * SEVEN TYPED, AND density_uom IS THE EIGHTH BECAUSE THE MASS DERIVATION
     * CANNOT RUN WITHOUT IT. `deriveTicketMassKg` returns null with the reason
     * "no density_uom, so density_value has no meaning" on any VOLUME ticket -
     * and uom_code defaults to LTR, so the default ticket is a volume ticket.
     * 14 of 30 seeded tickets are LTR and 17 carry no density_uom at all.
     * Typing density_value without it would have produced a null mass on every
     * litre ticket, which is the inert-rule shape again: a requirement written
     * in one unit against a screen that types another.
     *
     * A MASS ticket needs no density - the unit's own factor carries it - so
     * the density inputs are optional rather than mandatory, and the
     * derivation says why it declined rather than guessing.
     *
     * NOT TAKEN, AND MEASURED RATHER THAN ASSUMED:
     *   density_basis  no contract carries one. MASTER_CONTRACTS,
     *                  CONTRACT_PRODUCTS and MASTER_PRODUCTS have NO density
     *                  or temperature field at all, and nothing in srv/ writes
     *                  this. It has an entity default of 'MEA' (29 of 30
     *                  seeded; one OBS), so it is an optional override here,
     *                  not a resolved value and not a mandatory input.
     *
     * DERIVED BY THE EXISTING before-CREATE HOOKS, not by this action:
     *   quantity_metered  meter_end - meter_start        deriveMeasurement
     *   quantity_kg       metered x density              deriveTicketMassKg
     *   tail              from the registration          resolveTicketTail
     *   internal_number   from the order's station       allocateTicketNumber
     *   match_status      MATCHED, because there is an order
     */
    action captureTicketForOrder(
        // FROM THE CALLER'S CONTEXT
        orderId            : UUID @mandatory,

        // TYPED - only a person reading the supplier's paperwork knows these
        ticketNumber       : String(50) @mandatory,
        quantity           : Decimal(12,2) @mandatory,
        deliveryTimestamp  : DateTime @mandatory,
        meterStart         : Decimal(12,2),
        meterEnd           : Decimal(12,2),
        densityValue       : Decimal(8,4),
        densityUom         : String(10),
        densityTempC       : Decimal(5,2),

        // OPTIONAL OVERRIDES - both carry an entity default
        uomCode            : String(3),
        densityBasis       : String(10),

        vehicleId          : String(50),
        meterSerial        : String(50),
        supplierTicketRef  : String(50)
    ) returns FuelTickets;
}
