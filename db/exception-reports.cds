namespace fuelsphere;

using { fuelsphere as db } from './schema';

/**
 * FuelSphere - the four exception reports.
 *
 * Each one answers a question somebody asks at period close:
 *
 *   1. Un-invoiced tickets        fuel we have had and nobody has billed us for
 *   2. Deliveries without gauge   uplift that cannot be reconciled yet
 *   3. Delivery variances         where the bowser and the aircraft disagree
 *   4. Flight data completeness   which legs are missing what
 *
 * ALL FOUR CARRY THE SAME FOUR FILTER COLUMNS - flight_number, flight_date,
 * station and supplier_name - under the same names, because one filter bar
 * drives all four charts. A report that named its station something else
 * would simply ignore the filter, which looks like a broken filter rather
 * than a differently-named column.
 *
 * STATION IS THE FLIGHT'S DEPARTURE AIRPORT throughout (the user's decision).
 * On a tankering leg that is not where the fuel was bought, so the reports
 * agree with each other rather than each being right in its own way.
 *
 * The arithmetic that needs a date or a running total lives in
 * srv/lib/exception-reports.js, where it can be read as ordinary JavaScript.
 * These views do the joining and the filtering, which is what SQL is for.
 */

// The flight's APU cycles. FLIGHT_SCHEDULE reaches its dispatches, tickets and
// deliveries already; APU_USAGE points AT the flight and nothing points back,
// so report 4 could not ask "does this leg have APU hours" without this.
extend db.FLIGHT_SCHEDULE with {
    apu_cycles : Association to many db.APU_USAGE on apu_cycles.flight = $self;
}

// ===========================================================================
// 1. UN-INVOICED TICKETS - uplift recorded with no supplier invoice received
// ===========================================================================
//
// TWO STATES, NOT ONE, and the column says which:
//   UNBILLED     no invoice line yet, but the ticket has an order behind it
//   UNBILLABLE   no invoice line AND no order - fuel that reached an aircraft
//                with nothing in FuelSphere authorising it, and no PO for any
//                invoice to ever match
//
// Billed tickets are excluded here rather than shown and filtered out on the
// screen: this is the exception list, and 1,700 billed rows would bury the
// handful that need chasing.
entity EXC_UNINVOICED_TICKETS as select from db.FUEL_TICKETS as t {
    key t.ID,
        t.ticket_number,
        t.internal_number,

        case when not exists t.order then 'UNBILLABLE' else 'UNBILLED' end as billing_state : String(12),

        // The four shared filter columns.
        t.flight.flight_number                as flight_number   : String(10),
        t.flight.flight_date                  as flight_date     : Date,
        t.flight.origin_airport               as station         : String(3),
        t.order.supplier.supplier_name        as supplier_name   : String(100),

        t.flight.destination_airport          as destination     : String(3),
        t.aircraft_reg                        as tail            : String(10),
        t.quantity                            as volume          : Decimal(15,2),
        t.uom_code                            as uom_code        : String(3),
        t.quantity_kg                         as volume_kg       : Decimal(15,2),
        t.total_amount                        as value_amount    : Decimal(15,2),
        t.currency_code                       as currency_code   : String(3),
        t.delivery_timestamp                  as delivered_at    : DateTime,
        t.status                              as ticket_status   : String(20),

        // Filled by srv/lib/exception-reports.js on read.
        virtual null as sector    : String(12),
        virtual null as days_open : Integer
}
where not exists t.invoice_lines;

// ===========================================================================
// 2. DELIVERIES WITHOUT GAUGE READINGS - uplift that cannot be reconciled
// ===========================================================================
//
// A delivery needs BOTH aircraft readings before anything can be compared
// against it, so one reading is as incomplete as none - the report shows
// which of the two is missing rather than just that something is.
entity EXC_DELIVERIES_AWAITING_READINGS as select from db.FUEL_DELIVERIES as d {
    key d.ID,
        d.delivery_number,

        d.flight.flight_number                as flight_number   : String(10),
        d.flight.flight_date                  as flight_date     : Date,
        d.flight.origin_airport               as station         : String(3),
        d.order.supplier.supplier_name        as supplier_name   : String(100),

        d.flight.destination_airport          as destination     : String(3),
        d.aircraft_reg                        as tail            : String(10),
        d.delivered_quantity                  as volume          : Decimal(15,2),
        d.uom_code                            as uom_code        : String(3),
        d.fob_before_kg                       as fob_before_kg   : Decimal(15,2),
        d.fob_after_kg                        as fob_after_kg    : Decimal(15,2),
        d.delivery_date                       as delivery_date   : Date,
        d.status                              as delivery_status : String(20),

        virtual null as sector       : String(12),
        virtual null as days_open    : Integer,
        virtual null as missing_what : String(30)
}
where d.fob_before_kg is null or d.fob_after_kg is null;

// The metered mass written to each delivery. Its own view because a left join
// to the tickets would DUPLICATE a delivery that carries two of them, and two
// suppliers on one refuelling is the ordinary case, not the odd one.
entity EXC_DELIVERY_METERED as select from db.FUEL_TICKETS {
    key delivery.ID              as delivery_ID : UUID,
        sum(quantity_kg)         as metered_kg  : Decimal(15,2),
        count(*)                 as ticket_count : Integer
}
group by delivery.ID;

// ===========================================================================
// 3. DELIVERY VARIANCES - where delivered and measured quantities disagree
// ===========================================================================
//
// Expected is what the bowser metered (the tickets), actual is what the
// aircraft's gauge moved (after less before). Only deliveries with BOTH
// readings appear - without them there is nothing to compare, and those rows
// are report 2's subject, not this one's.
//
// THE +/-0.50% BAND IS FLAT, by decision, and stated in one place: the CASE
// expression below. The configured FOB tolerance rules (0.5% on an ACARS
// reading, 1.5% on a crew-reported one) are deliberately NOT used here - one
// number on the report is what was asked for.
//
// THE VERDICT IS COMPUTED HERE RATHER THAN IN JAVASCRIPT, and that is not a
// style choice: $filter runs in the database, so a verdict derived after the
// read cannot be filtered on. The chart counts the rows outside the band and
// the table has to show exactly those rows - with the verdict computed in the
// handler, the chart said 22 and the table listed 264.
entity EXC_DELIVERY_VARIANCES as select from db.FUEL_DELIVERIES as d
    left join EXC_DELIVERY_METERED as m on m.delivery_ID = d.ID
{
    key d.ID,
        d.delivery_number,

        d.flight.flight_number                as flight_number   : String(10),
        d.flight.flight_date                  as flight_date     : Date,
        d.flight.origin_airport               as station         : String(3),
        d.order.supplier.supplier_name        as supplier_name   : String(100),

        d.flight.destination_airport          as destination     : String(3),
        d.aircraft_reg                        as tail            : String(10),
        m.metered_kg                          as expected_kg     : Decimal(15,2),
        m.ticket_count                        as ticket_count    : Integer,
        d.fob_delta_kg                        as actual_kg       : Decimal(15,2),

        // What the gauge moved, less what the bowser metered.
        d.fob_delta_kg - m.metered_kg         as variance_kg     : Decimal(15,2),
        case when m.metered_kg is null or m.metered_kg = 0 or d.fob_delta_kg is null then null
             else (d.fob_delta_kg - m.metered_kg) / m.metered_kg * 100
        end                                   as variance_pct    : Decimal(9,2),
        case when m.metered_kg is null or m.metered_kg = 0 or d.fob_delta_kg is null then 'Not comparable'
             when (d.fob_delta_kg - m.metered_kg) / m.metered_kg * 100 >  0.5 then 'Outside tolerance'
             when (d.fob_delta_kg - m.metered_kg) / m.metered_kg * 100 < -0.5 then 'Outside tolerance'
             else 'Within tolerance'
        end                                   as verdict         : String(20),

        d.fob_before_kg                       as fob_before_kg   : Decimal(15,2),
        d.fob_after_kg                        as fob_after_kg    : Decimal(15,2),
        d.fob_source                          as fob_source      : String(20),
        d.delivery_date                       as delivery_date   : Date,

        virtual null as sector       : String(12)
}
where d.fob_before_kg is not null and d.fob_after_kg is not null;

// ===========================================================================
// 4. FLIGHT DATA COMPLETENESS - whether each leg carries what the reports need
// ===========================================================================
//
// Five things make a leg complete: a dispatch plan, an uplift, both FOB
// readings and APU hours. Each is a yes/no of its own so the gap is visible
// rather than summarised - "Incomplete" alone sends someone hunting.
entity EXC_FLIGHT_COMPLETENESS as select from db.FLIGHT_SCHEDULE as f {
    key f.ID,

        f.flight_number                       as flight_number   : String(10),
        f.flight_date                         as flight_date     : Date,
        f.origin_airport                      as station         : String(3),
        // A leg has no supplier of its own; its order's is the closest thing,
        // and a leg with two orders would duplicate, so this is left to the
        // handler to resolve from the first order it finds.
        cast(null as String(100))             as supplier_name   : String(100),

        f.destination_airport                 as destination     : String(3),
        f.aircraft_reg                        as tail            : String(10),
        f.status                              as flight_status   : String(20),
        f.fob_at_out_kg                       as fob_out_kg      : Decimal(15,2),
        f.fob_at_in_kg                        as fob_in_kg       : Decimal(15,2),

        case when exists f.dispatches  then true else false end as has_dispatch : Boolean,
        case when exists f.tickets     then true else false end as has_uplift   : Boolean,
        case when exists f.apu_cycles  then true else false end as has_apu      : Boolean,

        // THE FOB FLAGS AND THE VERDICT ARE COMPUTED HERE, IN SQL, not on
        // read. A chart slice is a filter - press "Complete" and the table
        // must ask the database for the complete legs - and $filter runs in
        // the database, which cannot see a column a handler fills afterwards.
        // The variance verdict moved here for the same reason.
        case when f.fob_at_out_kg is not null then true else false end as has_fob_out : Boolean,
        case when f.fob_at_in_kg  is not null then true else false end as has_fob_in  : Boolean,

        case when exists f.dispatches
              and exists f.tickets
              and exists f.apu_cycles
              and f.fob_at_out_kg is not null
              and f.fob_at_in_kg  is not null
             then 'Complete'
             else 'Incomplete'
        end                                                     as completeness_status : String(12),

        virtual null as sector      : String(12)
};

/**
 * EXC_FLIGHT_NUMBERS - the flight numbers a reader can filter by.
 *
 * A value help, not a report: the filter bar offers the numbers that have
 * actually been flown rather than an empty box to type into. DISTINCT, because
 * a number is flown every day and a list with a thousand B62725s in it helps
 * nobody.
 */
define view EXC_FLIGHT_NUMBERS as
    select from db.FLIGHT_SCHEDULE {
        key flight_number
    }
    where flight_number is not null
    group by flight_number;
