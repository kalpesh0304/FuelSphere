using { fuelsphere as db } from '../db/schema';
using { fuelsphere as exc } from '../db/exception-reports';

/**
 * FuelSphere - Exception Reports.
 *
 * Four read-only reports behind one filter bar. Everything here is a view over
 * data other services own, so nothing on this service writes.
 */
@path: '/odata/v4/exceptions'
@impl: './exception-service.js'
service ExceptionService {

    @readonly entity UninvoicedTickets   as projection on exc.EXC_UNINVOICED_TICKETS;
    @readonly entity DeliveriesAwaitingReadings as projection on exc.EXC_DELIVERIES_AWAITING_READINGS;
    @readonly entity DeliveryVariances   as projection on exc.EXC_DELIVERY_VARIANCES;
    @readonly entity FlightCompleteness  as projection on exc.EXC_FLIGHT_COMPLETENESS;

    // Value helps for the filter bar. Small lists, read straight from master
    // data, so the four filters offer what exists rather than free text.
    @readonly entity Flights   as projection on exc.EXC_FLIGHT_NUMBERS;
    @readonly entity Stations  as projection on db.MASTER_AIRPORTS  { key ID, iata_code, airport_name, city };
    @readonly entity Suppliers as projection on db.MASTER_SUPPLIERS { key ID, supplier_code, supplier_name };

    /**
     * The four chart totals in one call.
     *
     * The overview page draws four charts from one request rather than four:
     * the filter bar applies to all of them, so they are always asked for
     * together, and a single result keeps them consistent with each other.
     *
     * Every argument is optional - no filter means the current month, which is
     * what the page opens on.
     */
    function summary(
        flightNumber : String,
        dateFrom     : Date,
        dateTo       : Date,
        station      : String,
        supplier     : String
    ) returns {
        asOf       : Date;
        periodFrom : Date;
        periodTo   : Date;
        cards : array of {
            cardKey  : String;   // uninvoiced | readings | variances | completeness
            title    : String;
            total    : Integer;  // rows behind the chart
            headline : String;   // the one figure worth reading first
            slices   : array of { label : String; value : Decimal; count : Integer; };
        };
    };
}
