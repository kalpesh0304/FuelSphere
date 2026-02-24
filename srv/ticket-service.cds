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
     */
    @odata.draft.enabled
    entity FuelTickets as projection on db.FUEL_TICKETS {
        *,
        order    : redirected to FuelOrders,
        delivery : redirected to FuelDeliveries,
        virtual null as statusCriticality : Integer
    } actions {
        /**
         * Attach ticket to delivery
         */
        action attachToDelivery(deliveryId: UUID) returns FuelTickets;

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
        supplier : redirected to Suppliers
    };

    @readonly
    entity FuelDeliveries as projection on db.FUEL_DELIVERIES {
        *,
        order : redirected to FuelOrders
    };

    @readonly
    entity Airports as projection on db.MASTER_AIRPORTS;

    @readonly
    entity Suppliers as projection on db.MASTER_SUPPLIERS;

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

    // ========================================================================
    // FUEL TICKET DASHBOARD TYPES (for FuelTicketDashboard TSX)
    // ========================================================================

    /**
     * KPI tiles for the Fuel Ticket Dashboard
     * Shows ticket counts by lifecycle status
     * Lifecycle: OPEN → PRICE_CAPTURED → COMPLETED → VALIDATED → POSTED → CLOSED
     */
    type FuelTicketDashboardKPIs {
        totalTickets            : Integer;          // Total tickets in period
        openTickets             : Integer;          // Status = OPEN
        priceCapturedTickets    : Integer;          // Status = PRICE_CAPTURED
        validatedTickets        : Integer;          // Status = VALIDATED
        postedTickets           : Integer;          // Status = POSTED
        totalTrend              : Decimal(5,2);     // % change vs prior period
        openTrend               : Decimal(5,2);
        validatedTrend          : Decimal(5,2);
    };

    /**
     * Price variance trend data point for chart
     * Tracks CPE price variance over time
     */
    type TicketPriceVarianceTrendItem {
        period                  : String(10);       // Date label (e.g. "Jan 24")
        avgVariance             : Decimal(5,2);     // Average price variance %
        avgPrice                : Decimal(15,4);    // Average unit price
        ticketCount             : Integer;          // Tickets in this period
    };

    /**
     * Ticket status breakdown for donut chart
     */
    type TicketStatusBreakdownItem {
        status                  : String(20);       // OPEN, PRICE_CAPTURED, VALIDATED, etc.
        count                   : Integer;
        percentage              : Decimal(5,2);
    };

    /**
     * Exception alert for the ticket dashboard
     */
    type TicketExceptionAlert {
        alertId                 : UUID;
        alertType               : String(30);       // PRICE_VARIANCE, MISSING_RECEIPT, DUPLICATE, STALE
        severity                : String(10);       // critical, high, medium, low
        message                 : String(500);
        ticketNumber            : String(25);
        stationCode             : String(3);
        timestamp               : DateTime;
    };

    /**
     * Summary row for the recent tickets table
     */
    type FuelTicketSummaryItem {
        ticketId                : UUID;
        ticketNumber            : String(25);       // FT-{STATION}-{DATE}-{SEQ}
        flightNumber            : String(10);
        stationCode             : String(3);
        stationName             : String(100);
        supplierName            : String(100);
        quantity                : Decimal(12,2);    // Delivered quantity
        uom                     : String(3);        // KG, LTR, GAL
        unitPrice               : Decimal(15,4);
        totalAmount             : Decimal(15,2);
        currency                : String(3);
        status                  : String(20);       // Ticket lifecycle status
        ticketDate              : Date;
        priceVariance           : Decimal(5,2);     // % variance from contract price
    };

    function getFuelTicketDashboardKPIs(
        stationCode             : String,
        fromDate                : Date,
        toDate                  : Date
    ) returns FuelTicketDashboardKPIs;

    function getTicketPriceVarianceTrend(
        stationCode             : String,
        days                    : Integer
    ) returns array of TicketPriceVarianceTrendItem;

    function getTicketStatusBreakdown(
        stationCode             : String
    ) returns array of TicketStatusBreakdownItem;

    function getTicketExceptionAlerts(
        stationCode             : String
    ) returns array of TicketExceptionAlert;

    function getRecentTickets(
        stationCode             : String,
        statusFilter            : String,
        skip                    : Integer,
        top                     : Integer
    ) returns array of FuelTicketSummaryItem;

    // ========================================================================
    // FUEL TICKET DETAIL TYPES (for FuelTicketDetail TSX)
    // ========================================================================

    /**
     * Ticket lifecycle milestone for timeline display
     * Shows progression through OPEN → PRICE_CAPTURED → ... → CLOSED
     */
    type TicketLifecycleMilestone {
        step                    : Integer;          // Step order
        label                   : String(30);       // Status label
        status                  : String(20);       // completed, current, pending
        timestamp               : DateTime;         // When this step was reached
        completedBy             : String(100);      // User who completed
    };

    /**
     * CPE pricing snapshot for the Pricing tab
     * Multi-component fuel pricing at time of ticket capture
     */
    type TicketCPEPricingSnapshot {
        basePrice               : Decimal(15,4);    // Platts-based price
        contractPremium         : Decimal(15,4);    // Contract premium/discount
        airportFees             : Decimal(15,4);    // Airport throughput fees
        intoPlaneServiceFee     : Decimal(15,4);    // Into-plane service charge
        totalUnitPrice          : Decimal(15,4);    // Sum of all components
        currency                : String(3);
        cpeIndexCode            : String(20);       // e.g., "PLATTS-JET-CIF-NWE"
        cpeIndexValue           : Decimal(15,4);    // CPE index value at capture
        cpeEffectiveDate        : Date;             // CPE effective date
        contractNumber          : String(20);
        priceVariance           : Decimal(5,2);     // Variance from expected price %
    };

    /**
     * Receipt data for the Receipt tab
     * Captures pilot/ground crew confirmation and meter readings
     */
    type TicketReceiptData {
        pilotName               : String(100);
        pilotId                 : String(20);
        pilotSignatureCaptured  : Boolean;
        pilotSignatureTime      : DateTime;
        groundCrewName          : String(100);
        groundCrewSignatureCaptured : Boolean;
        groundCrewSignatureTime : DateTime;
        meterStart              : Decimal(12,2);    // Meter reading start
        meterEnd                : Decimal(12,2);    // Meter reading end
        meterQuantity           : Decimal(12,2);    // meterEnd - meterStart
        ticketQuantity          : Decimal(12,2);    // Quantity on ticket
        quantityVariance        : Decimal(5,2);     // Meter vs ticket variance %
        temperature             : Decimal(5,2);     // °C at delivery
        density                 : Decimal(8,4);     // kg/L at delivery
        correctedQuantity       : Decimal(12,2);    // Temperature-corrected quantity
    };

    /**
     * Validation check result for the Validation tab
     */
    type TicketValidationCheck {
        ruleId                  : String(10);       // EPDxxx rule code
        ruleName                : String(100);      // Human-readable rule name
        result                  : String(10);       // PASS, FAIL, WARNING, SKIPPED
        message                 : String(500);      // Validation message
        severity                : String(10);       // ERROR, WARNING, INFO
        checkedAt               : DateTime;
    };

    function getTicketLifecycle(ticketId: UUID) returns array of TicketLifecycleMilestone;
    function getTicketCPEPricing(ticketId: UUID) returns TicketCPEPricingSnapshot;
    function getTicketReceipt(ticketId: UUID) returns TicketReceiptData;
    function getTicketValidationResults(ticketId: UUID) returns array of TicketValidationCheck;

    /**
     * Capture/update pricing on a ticket
     */
    action captureTicketPrice(ticketId: UUID, unitPrice: Decimal, currency: String) returns FuelTickets;

    /**
     * Run validation checks on a ticket
     */
    action validateTicket(ticketId: UUID) returns array of TicketValidationCheck;

    /**
     * Post a validated ticket to S/4HANA
     */
    action postTicket(ticketId: UUID) returns FuelTickets;

    /**
     * Export ticket report for a station
     */
    action exportTicketReport(
        stationCode             : String,
        fromDate                : Date,
        toDate                  : Date,
        format                  : String
    ) returns TicketExportResult;

    type TicketExportResult {
        success                 : Boolean;
        fileName                : String(255);
        recordCount             : Integer;
        message                 : String(500);
    };
}
