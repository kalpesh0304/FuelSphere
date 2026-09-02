/**
 * FuelSphere - Refueler/Supplier Service
 *
 * Manages the fuel sales order lifecycle from the refueler/supplier perspective:
 * - Sales order confirmation and scheduling
 * - Delivery recording with quantity/quality data
 * - Invoice creation
 * - Uplift history tracking
 *
 * Service Path: /odata/v4/refueler
 */

using { fuelsphere as db } from '../db/schema';

@path: '/odata/v4/refueler'
@requires: 'authenticated-user'
service RefuelerService {

    // ========================================================================
    // CORE ENTITIES - Fuel Sales Orders
    // ========================================================================

    /**
     * SalesOrders - Main sales order entity (supplier/refueler perspective)
     * Draft-enabled for save-as-draft functionality
     *
     * Lifecycle: RECEIVED -> CONFIRMED -> SCHEDULED -> IN_DELIVERY -> DELIVERED -> INVOICED -> CLOSED
     */
    @odata.draft.enabled
    entity SalesOrders as projection on db.FUEL_SALES_ORDERS {
        *, virtual null as statusCriticality : Integer
    } actions {
        /**
         * Confirm receipt of order from airline
         * Transitions: RECEIVED -> CONFIRMED
         */
        action confirmOrder() returns SalesOrders;

        /**
         * Schedule delivery with vehicle and driver assignment
         * Transitions: CONFIRMED -> SCHEDULED
         */
        action scheduleDelivery(
            scheduledDate : Date,
            scheduledTime : Time,
            vehicleId     : String,
            driverName    : String
        ) returns SalesOrders;

        /**
         * Record actual fuel delivery with quantity and quality data
         * Transitions: SCHEDULED/IN_DELIVERY -> DELIVERED
         * Creates a FUEL_DELIVERIES record
         */
        action recordDelivery(
            deliveredQuantity : Decimal,
            temperature       : Decimal,
            density           : Decimal,
            driverName        : String,
            vehicleId         : String
        ) returns SalesOrders;

        /**
         * Create invoice for delivered fuel
         * Transitions: DELIVERED -> INVOICED
         */
        action createInvoice(
            invoiceNumber : String,
            invoiceDate   : Date
        ) returns SalesOrders;

        /**
         * Cancel sales order
         * Transitions: any active status -> CANCELLED
         */
        action cancel(reason : String) returns SalesOrders;
    };

    // ========================================================================
    // DELIVERY RECORDS
    // ========================================================================

    @cds.redirection.target
    entity DeliveryRecords as projection on db.FUEL_DELIVERIES {
        *, virtual null as statusCriticality : Integer
    };

    /**
     * SourceDocuments - the evidence layer, exposed so the delivery can reach
     * it.
     *
     * WP-31 step 3 MOVED the signature time and location off FUEL_DELIVERIES
     * and onto the pilot signature document, and said so in a comment beside
     * the annotation that reads them:
     *
     *     signature_pilot_document.captured_at
     *     signature_pilot_document.capture_location
     *
     * The move was deliberate; EXPOSING THE TARGET WAS FORGOTTEN. The
     * compiler emitted "No OData navigation property generated, target
     * SOURCE_DOCUMENTS is outside of service RefuelerService" - a warning
     * about the ASSOCIATION - and said nothing at all about the two
     * annotations, so the Digital Signatures group has shown two permanently
     * blank fields since WP-31.
     *
     * NOT A PARTY BOUNDARY. D43 left four such gaps closed deliberately, one
     * of them because exposing the supplier's own sales order on the
     * airline's order service crosses between parties rather than between
     * modules. This is the opposite case: the signature is the evidence for
     * THIS delivery, the refueller is the party who witnessed its capture,
     * and SOURCE_DOCUMENTS is already exposed on FuelOrderService and
     * PlanningService. A third exposure of the same entity is the precedent,
     * not a departure from it.
     *
     * Read-only, because the refueller reads this evidence and does not
     * author it.
     */
    @readonly
    entity SourceDocuments as projection on db.SOURCE_DOCUMENTS;

    // ========================================================================
    // UPLIFT HISTORY (Read-only view of posted/verified deliveries)
    // ========================================================================

    @readonly
    entity UpliftHistory as select from db.FUEL_DELIVERIES {
        key ID,
        delivery_date,
        delivered_quantity,
        status
    } where status = 'Posted' or status = 'Verified';

    // ========================================================================
    // REFERENCE DATA (Read-only from Master Data)
    // ========================================================================

    @readonly entity Airports as projection on db.MASTER_AIRPORTS;
    @readonly entity Products as projection on db.MASTER_PRODUCTS;
    @readonly entity Aircraft as projection on db.AIRCRAFT_MASTER;
    @readonly entity FlightSchedule as projection on db.FLIGHT_SCHEDULE;
    @readonly entity Contracts as projection on db.MASTER_CONTRACTS;
    @readonly entity Suppliers as projection on db.MASTER_SUPPLIERS;
}
