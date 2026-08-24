/**
 * FuelSphere CDS Authorization Annotations
 * Document ID: FS-FND-003-B
 * Version: 1.0
 *
 * This file contains the authorization annotations for all FuelSphere services.
 * These annotations enforce RBAC at the CDS service level using @requires and @restrict.
 *
 * Scopes (defined in xs-security.json):
 * - MasterDataRead: Read access to master data entities
 * - MasterDataWrite: Create and update master data records
 * - MasterDataAdmin: Full master data administration including delete
 * - FuelOrderCreate: Create and submit fuel orders
 * - FuelOrderApprove: Approve or reject fuel orders
 * - ePODCapture: Capture electronic proof of delivery
 * - ePODApprove: Approve ePOD records
 * - InvoiceVerify: Verify and process invoices
 * - InvoiceApprove: Approve invoices for payment
 * - FinancePost: Post journal entries to S/4HANA
 * - BurnDataView: View fuel burn and ROB data
 * - BurnDataEdit: Edit and correct fuel burn records
 * - ContractManage: Manage fuel purchase contracts
 * - PlanningAccess: Access fuel planning and forecasting
 * - ReportView: View reports and analytics
 * - IntegrationMonitor: Monitor integration status and errors
 * - AdminAccess: Full system administration access
 */

using MasterDataService from './master-data-service';

// ============================================================================
// MASTER DATA SERVICE - Authorization
// ============================================================================

// Service-level: Require authenticated user
annotate MasterDataService with @(requires: 'authenticated-user');

// ----------------------------------------------------------------------------
// Reference Data (S/4HANA Synchronized) - Read-only for all authenticated users
// ----------------------------------------------------------------------------

annotate MasterDataService.Countries with @(restrict: [
    { grant: 'READ', to: ['MasterDataRead'] }
]);

annotate MasterDataService.Currencies with @(restrict: [
    { grant: 'READ', to: ['MasterDataRead'] }
]);

annotate MasterDataService.UnitsOfMeasure with @(restrict: [
    { grant: 'READ', to: ['MasterDataRead'] }
]);

annotate MasterDataService.Plants with @(restrict: [
    { grant: 'READ', to: ['MasterDataRead'] }
]);

// ----------------------------------------------------------------------------
// FuelSphere Native Entities
// ----------------------------------------------------------------------------

// Manufacturers - Read by all with MasterDataRead, Write by MasterDataWrite, Delete by Admin
annotate MasterDataService.Manufacturers with @(restrict: [
    { grant: 'READ', to: ['MasterDataRead'] },
    { grant: ['CREATE', 'UPDATE'], to: ['MasterDataWrite'] },
    { grant: 'DELETE', to: ['MasterDataAdmin'] }
]);

// Aircraft - Read by all with MasterDataRead, Write by MasterDataWrite, Delete by Admin
annotate MasterDataService.AircraftRegistrations with @(restrict: [
    { grant: 'READ', to: ['MasterDataRead'] },
    { grant: ['CREATE', 'UPDATE'], to: ['MasterDataWrite'] },
    { grant: 'DELETE', to: ['MasterDataAdmin'] }
]);

annotate MasterDataService.Aircraft with @(restrict: [
    { grant: 'READ', to: ['MasterDataRead'] },
    { grant: ['CREATE', 'UPDATE'], to: ['MasterDataWrite'] },
    { grant: 'DELETE', to: ['MasterDataAdmin'] }
]);

// Airports - Read by all with MasterDataRead, Write by MasterDataWrite, Delete by Admin
annotate MasterDataService.Airports with @(restrict: [
    { grant: 'READ', to: ['MasterDataRead'] },
    { grant: ['CREATE', 'UPDATE'], to: ['MasterDataWrite'] },
    { grant: 'DELETE', to: ['MasterDataAdmin'] }
]);

// Routes - Read by all with MasterDataRead, Write by MasterDataWrite, Delete by Admin
annotate MasterDataService.Routes with @(restrict: [
    { grant: 'READ', to: ['MasterDataRead'] },
    { grant: ['CREATE', 'UPDATE'], to: ['MasterDataWrite'] },
    { grant: 'DELETE', to: ['MasterDataAdmin'] }
]);

// ----------------------------------------------------------------------------
// Bidirectional Entities (S/4HANA Integration)
// ----------------------------------------------------------------------------

// Suppliers - Read by MasterDataRead, Write requires MasterDataWrite, Delete requires Admin
annotate MasterDataService.Suppliers with @(restrict: [
    { grant: 'READ', to: ['MasterDataRead'] },
    { grant: ['CREATE', 'UPDATE'], to: ['MasterDataWrite'] },
    { grant: 'DELETE', to: ['MasterDataAdmin'] }
]);

// Products - Read by MasterDataRead, Write requires MasterDataWrite, Delete requires Admin
annotate MasterDataService.Products with @(restrict: [
    { grant: 'READ', to: ['MasterDataRead'] },
    { grant: ['CREATE', 'UPDATE'], to: ['MasterDataWrite'] },
    { grant: 'DELETE', to: ['MasterDataAdmin'] }
]);

// Contracts - Confidential data, restricted access
// Read by MasterDataRead, ContractManage, FinancePost
// Write by ContractManage only
// Delete by Admin only
annotate MasterDataService.Contracts with @(restrict: [
    { grant: 'READ', to: ['MasterDataRead', 'ContractManage', 'FinancePost'] },
    { grant: ['CREATE', 'UPDATE'], to: ['ContractManage'] },
    { grant: 'DELETE', to: ['MasterDataAdmin'] }
]);

// ----------------------------------------------------------------------------
// Actions
// ----------------------------------------------------------------------------

// syncFromS4HANA action - Restricted to IntegrationMonitor or AdminAccess
annotate MasterDataService.syncFromS4HANA with @(requires: ['IntegrationMonitor', 'AdminAccess']);

// ============================================================================
// FUEL ORDER SERVICE - Authorization (FDD-04)
// ============================================================================

using FuelOrderService from './order-service';

// Service-level: Require authenticated user
annotate FuelOrderService with @(requires: 'authenticated-user');

// ----------------------------------------------------------------------------
// Fuel Orders - Core transactional entity
// ----------------------------------------------------------------------------

/**
 * FuelOrders Authorization Matrix:
 * - Station Coordinator: Create/Read/Update for own stations, Cancel Draft
 * - Operations Manager: Full CRUD for all stations
 * - Fuel Planner: Create/Read
 * - Finance Controller: Read only
 * - System Administrator: Full access
 * - Viewer: Read only
 *
 * Row-level security enforced via Plant attribute for Station Coordinators
 */
annotate FuelOrderService.FuelOrders with @(restrict: [
    // Read - order, approval, finance and reporting scopes
    { grant: 'READ', to: ['FuelOrderCreate', 'FuelOrderApprove', 'FinancePost', 'ReportView', 'AdminAccess'] },
    // Create - FuelOrderCreate or AdminAccess
    { grant: 'CREATE', to: ['FuelOrderCreate', 'AdminAccess'] },
    // Update - FuelOrderCreate, FuelOrderApprove or AdminAccess
    { grant: 'UPDATE', to: ['FuelOrderCreate', 'FuelOrderApprove', 'AdminAccess'] },
    // Delete - AdminAccess only
    { grant: 'DELETE', to: ['AdminAccess'] },

    // D22 - a bound action needs its own grant. CAP matches the action name
    // against this list; READ/CREATE/UPDATE/DELETE do not imply it, so
    // without these entries every call below is refused before the action's
    // own @requires is ever read. Each mirrors that @requires exactly and
    // grants nothing that was not already declared.
    { grant: 'submit',        to: ['FuelOrderCreate'] },
    { grant: 'confirm',       to: ['FuelOrderApprove'] },
    { grant: 'startDelivery', to: ['FuelOrderCreate', 'FuelOrderApprove'] },
    { grant: 'cancel',        to: ['FuelOrderCreate', 'FuelOrderApprove', 'AdminAccess'] },
    { grant: 'calculatePrice', to: ['FuelOrderCreate'] },

    // D26 / WP-02C. These eighteen bound actions declare NO @requires of their
    // own, so there was nothing to mirror and WP-02B could not fix them
    // mechanically. Decision D26: MIRROR THE ENTITY'S UPDATE GRANT AS A FLOOR
    // — an action that modifies an entity should require at least what
    // modifying it directly requires, which widens nothing.
    //
    // A FLOOR, NOT A CORRECT ANSWER. Several warrant a higher scope; those are
    // flagged in the pull request for a production review, not decided here.
    { grant: 'complete',   to: ['FuelOrderCreate', 'FuelOrderApprove', 'AdminAccess'] },
    { grant: 'crewReview', to: ['FuelOrderCreate', 'FuelOrderApprove', 'AdminAccess'] }
]);

// Submit action - Requires FuelOrderCreate scope
annotate FuelOrderService.FuelOrders actions {
    @(requires: ['FuelOrderCreate'])
    submit;

    @(requires: ['FuelOrderApprove'])
    confirm;

    @(requires: ['FuelOrderCreate', 'FuelOrderApprove'])
    startDelivery;

    @(requires: ['FuelOrderCreate', 'FuelOrderApprove', 'AdminAccess'])
    cancel;

    @(requires: ['FuelOrderCreate'])
    calculatePrice;
};

// ----------------------------------------------------------------------------
// Fuel Deliveries (ePOD) - Electronic Proof of Delivery
// ----------------------------------------------------------------------------

/**
 * FuelDeliveries Authorization:
 * - Station Coordinator: Create/Update (ePOD capture)
 * - Operations Manager: Full access including verification
 * - Finance Controller: Read for invoice matching
 */
// WP-31. The evidence layer. READ is wide because a document is the proof
// behind a number many roles already see; WRITE is narrow because capture is
// an operational act. No DELETE outside AdminAccess: THE IMAGE IS THE
// COMPLIANCE RECORD, and deleting it after a successful read destroys the
// evidence and keeps only the claim.
annotate FuelOrderService.SourceDocuments with @(restrict: [
    { grant: 'READ',   to: ['ePODCapture', 'ePODApprove', 'FinancePost', 'ReportView', 'AdminAccess'] },
    { grant: 'CREATE', to: ['ePODCapture', 'AdminAccess'] },
    { grant: 'UPDATE', to: ['ePODCapture', 'ePODApprove', 'AdminAccess'] },
    { grant: 'DELETE', to: ['AdminAccess'] }
]);

annotate FuelOrderService.FuelDeliveries with @(restrict: [
    { grant: 'READ', to: ['ePODCapture', 'ePODApprove', 'FinancePost', 'ReportView', 'AdminAccess'] },
    { grant: 'CREATE', to: ['ePODCapture', 'AdminAccess'] },
    { grant: 'UPDATE', to: ['ePODCapture', 'ePODApprove', 'AdminAccess'] },
    { grant: 'DELETE', to: ['AdminAccess'] },

    // D22 - see the note on FuelOrders. Mirrors each action's own @requires.
    { grant: 'captureSignatures', to: ['ePODCapture'] },
    { grant: 'verifyQuantity',    to: ['ePODCapture', 'ePODApprove'] },
    { grant: 'dispute',           to: ['ePODApprove'] },
    // WP-17. Declared with its grant in the same change, because D22 makes an
    // action without one unreachable for every user including AdminAccess.
    { grant: 'reconcile',         to: ['ePODCapture', 'ePODApprove'] },
    // WP-34, same rule as above: the grant lands in the same change as the
    // action, because D22 makes an ungranted bound action unreachable for
    // every user including one holding all scopes.
    { grant: 'deriveGaugeReadings', to: ['ePODCapture', 'ePODApprove'] },

    // D26 / WP-02C. These eighteen bound actions declare NO @requires of their
    // own, so there was nothing to mirror and WP-02B could not fix them
    // mechanically. Decision D26: MIRROR THE ENTITY'S UPDATE GRANT AS A FLOOR
    // — an action that modifies an entity should require at least what
    // modifying it directly requires, which widens nothing.
    //
    // A FLOOR, NOT A CORRECT ANSWER. Several warrant a higher scope; those are
    // flagged in the pull request for a production review, not decided here.
    { grant: 'calculateTemperatureCorrection', to: ['ePODCapture', 'ePODApprove', 'AdminAccess'] },
    { grant: 'validateDelivery',               to: ['ePODCapture', 'ePODApprove', 'AdminAccess'] }
]);

// ePOD Actions authorization
annotate FuelOrderService.FuelDeliveries actions {
    // Capture signatures - requires ePODCapture scope
    // This is the critical action that triggers S/4HANA PO/GR creation
    @(requires: ['ePODCapture'])
    captureSignatures;

    @(requires: ['ePODCapture', 'ePODApprove'])
    verifyQuantity;

    @(requires: ['ePODApprove'])
    dispute;

    // Mirrors verifyQuantity - reconciliation is the verification pair's job
    // and introduces no new scope.
    @(requires: ['ePODCapture', 'ePODApprove'])
    reconcile;
};

// ----------------------------------------------------------------------------
// Fuel Tickets
// ----------------------------------------------------------------------------

/**
 * FuelTickets Authorization:
 * - Station Coordinator: Create/Update tickets
 * - Operations Manager: Full access
 * - Finance Controller: Read for invoice verification
 */
annotate FuelOrderService.FuelTickets with @(restrict: [
    { grant: 'READ', to: ['ePODCapture', 'ePODApprove', 'FinancePost', 'ReportView', 'AdminAccess'] },
    { grant: 'CREATE', to: ['ePODCapture', 'AdminAccess'] },
    { grant: 'UPDATE', to: ['ePODCapture', 'ePODApprove', 'AdminAccess'] },
    { grant: 'DELETE', to: ['AdminAccess'] },

    // D22 - see the note on FuelOrders. Mirrors each action's own @requires.
    { grant: 'attachToDelivery', to: ['ePODCapture'] },
    { grant: 'verify',           to: ['ePODApprove'] }
]);

annotate FuelOrderService.FuelTickets actions {
    @(requires: ['ePODCapture'])
    attachToDelivery;

    @(requires: ['ePODApprove'])
    verify;
};

// ----------------------------------------------------------------------------
// Flight Dispatches - Dispatch data from external systems
// ----------------------------------------------------------------------------

annotate FuelOrderService.FlightDispatches with @(restrict: [
    { grant: 'READ', to: ['FuelOrderCreate', 'FuelOrderApprove', 'ePODCapture', 'ReportView', 'AdminAccess'] },
    { grant: 'CREATE', to: ['FuelOrderCreate', 'AdminAccess'] },
    { grant: 'UPDATE', to: ['FuelOrderCreate', 'AdminAccess'] },
    { grant: 'DELETE', to: ['AdminAccess'] }
]);

// ----------------------------------------------------------------------------
// Reference Data - Read-only in Order Service
// ----------------------------------------------------------------------------

// All reference entities are read-only in order service context
// Read access granted to anyone with order-related scopes
annotate FuelOrderService.FlightSchedule with @(restrict: [
    { grant: 'READ', to: ['FuelOrderCreate', 'FuelOrderApprove', 'ePODCapture', 'ReportView', 'AdminAccess'] }
]);

annotate FuelOrderService.Airports with @(restrict: [
    { grant: 'READ', to: ['FuelOrderCreate', 'FuelOrderApprove', 'ePODCapture', 'ReportView', 'AdminAccess'] }
]);

annotate FuelOrderService.Suppliers with @(restrict: [
    { grant: 'READ', to: ['FuelOrderCreate', 'FuelOrderApprove', 'ePODCapture', 'ReportView', 'AdminAccess'] }
]);

annotate FuelOrderService.Contracts with @(restrict: [
    { grant: 'READ', to: ['FuelOrderCreate', 'FuelOrderApprove', 'ContractManage', 'FinancePost', 'AdminAccess'] }
]);

annotate FuelOrderService.Products with @(restrict: [
    { grant: 'READ', to: ['FuelOrderCreate', 'FuelOrderApprove', 'ePODCapture', 'ReportView', 'AdminAccess'] }
]);

annotate FuelOrderService.Aircraft with @(restrict: [
    { grant: 'READ', to: ['FuelOrderCreate', 'FuelOrderApprove', 'ePODCapture', 'ReportView', 'AdminAccess'] }
]);

annotate FuelOrderService.Manufacturers with @(restrict: [
    { grant: 'READ', to: ['FuelOrderCreate', 'FuelOrderApprove', 'ePODCapture', 'ReportView', 'AdminAccess'] }
]);

annotate FuelOrderService.Countries with @(restrict: [
    { grant: 'READ', to: ['FuelOrderCreate', 'FuelOrderApprove', 'ePODCapture', 'ReportView', 'AdminAccess'] }
]);

annotate FuelOrderService.Currencies with @(restrict: [
    { grant: 'READ', to: ['FuelOrderCreate', 'FuelOrderApprove', 'FinancePost', 'ReportView', 'AdminAccess'] }
]);

annotate FuelOrderService.Plants with @(restrict: [
    { grant: 'READ', to: ['FuelOrderCreate', 'FuelOrderApprove', 'ePODCapture', 'ReportView', 'AdminAccess'] }
]);

annotate FuelOrderService.UnitsOfMeasure with @(restrict: [
    { grant: 'READ', to: ['FuelOrderCreate', 'FuelOrderApprove', 'ePODCapture', 'ReportView', 'AdminAccess'] }
]);

// ----------------------------------------------------------------------------
// Service-level Functions
// ----------------------------------------------------------------------------

annotate FuelOrderService.generateOrderNumber with @(requires: ['FuelOrderCreate']);
annotate FuelOrderService.generateDeliveryNumber with @(requires: ['ePODCapture']);
annotate FuelOrderService.getOrdersByStation with @(requires: ['FuelOrderCreate', 'FuelOrderApprove', 'ReportView', 'AdminAccess']);
annotate FuelOrderService.getOrdersBySupplier with @(requires: ['FuelOrderCreate', 'FuelOrderApprove', 'ReportView', 'AdminAccess']);

// ============================================================================
// TICKET SERVICE - Authorization (Standalone Ticket Management)
// ============================================================================

using TicketService from './ticket-service';

// Service-level: Require authenticated user
annotate TicketService with @(requires: 'authenticated-user');

// FuelTickets - Full CRUD for development
annotate TicketService.FuelTickets with @(restrict: [
    { grant: 'READ', to: ['ePODCapture', 'ePODApprove', 'FinancePost', 'ReportView', 'AdminAccess'] },
    { grant: 'CREATE', to: ['ePODCapture', 'AdminAccess'] },
    { grant: 'UPDATE', to: ['ePODCapture', 'ePODApprove', 'AdminAccess'] },
    { grant: 'DELETE', to: ['AdminAccess'] },

    // D22 - see the note on FuelOrders. Mirrors each action's own @requires.
    { grant: 'attachToDelivery', to: ['ePODCapture'] },
    { grant: 'verify',           to: ['ePODApprove'] },
    { grant: 'reject',           to: ['ePODApprove'] },

    // D26 / WP-02C. These eighteen bound actions declare NO @requires of their
    // own, so there was nothing to mirror and WP-02B could not fix them
    // mechanically. Decision D26: MIRROR THE ENTITY'S UPDATE GRANT AS A FLOOR
    // — an action that modifies an entity should require at least what
    // modifying it directly requires, which widens nothing.
    //
    // A FLOOR, NOT A CORRECT ANSWER. Several warrant a higher scope; those are
    // flagged in the pull request for a production review, not decided here.
    { grant: 'attachToOrder', to: ['ePODCapture', 'ePODApprove', 'AdminAccess'] }
]);

// Ticket actions
annotate TicketService.FuelTickets actions {
    @(requires: ['ePODCapture'])
    attachToDelivery;

    @(requires: ['ePODApprove'])
    verify;

    @(requires: ['ePODApprove'])
    reject;
};

// Reference data - Read-only
annotate TicketService.FuelOrders with @(restrict: [
    { grant: 'READ', to: ['ePODCapture', 'ePODApprove', 'FinancePost', 'ReportView', 'AdminAccess'] }
]);

annotate TicketService.FuelDeliveries with @(restrict: [
    { grant: 'READ', to: ['ePODCapture', 'ePODApprove', 'FinancePost', 'ReportView', 'AdminAccess'] }
]);

annotate TicketService.Airports with @(restrict: [
    { grant: 'READ', to: ['ePODCapture', 'ePODApprove', 'ReportView', 'AdminAccess'] }
]);

annotate TicketService.Suppliers with @(restrict: [
    { grant: 'READ', to: ['ePODCapture', 'ePODApprove', 'ReportView', 'AdminAccess'] }
]);

// Service-level functions
annotate TicketService.generateTicketNumber with @(requires: ['ePODCapture']);
annotate TicketService.getTicketsByOrder with @(requires: ['ePODCapture', 'ePODApprove', 'ReportView', 'AdminAccess']);
annotate TicketService.getUnattachedTickets with @(requires: ['ePODCapture', 'ePODApprove', 'AdminAccess']);

// ============================================================================
// BURN SERVICE - Authorization (Fuel Burn & ROB Tracking)
// ============================================================================

using BurnService from './burn-service';

// Service-level: Require authenticated user
annotate BurnService with @(requires: 'authenticated-user');

// ----------------------------------------------------------------------------
// FuelBurns - Actual burn records from ACARS/EFB/Manual/Jefferson
// ----------------------------------------------------------------------------

annotate BurnService.FuelBurns with @(restrict: [
    { grant: 'READ', to: ['BurnDataView', 'BurnDataEdit', 'ReportView', 'AdminAccess'] },
    { grant: ['CREATE', 'UPDATE'], to: ['BurnDataEdit', 'AdminAccess'] },
    { grant: 'DELETE', to: ['AdminAccess'] },

    // D26 / WP-02C. These eighteen bound actions declare NO @requires of their
    // own, so there was nothing to mirror and WP-02B could not fix them
    // mechanically. Decision D26: MIRROR THE ENTITY'S UPDATE GRANT AS A FLOOR
    // — an action that modifies an entity should require at least what
    // modifying it directly requires, which widens nothing.
    //
    // A FLOOR, NOT A CORRECT ANSWER. Several warrant a higher scope; those are
    // flagged in the pull request for a production review, not decided here.
    { grant: 'confirm',             to: ['BurnDataEdit', 'AdminAccess'] },
    { grant: 'reject',              to: ['BurnDataEdit', 'AdminAccess'] },
    { grant: 'recalculateVariance', to: ['BurnDataEdit', 'AdminAccess'] },
    { grant: 'flagForReview',       to: ['BurnDataEdit', 'AdminAccess'] },
    { grant: 'completeReview',      to: ['BurnDataEdit', 'AdminAccess'] },
    { grant: 'postToFinance',       to: ['BurnDataEdit', 'AdminAccess'] }
]);

// ----------------------------------------------------------------------------
// ROBLedger - Remaining On Board tracking
// ----------------------------------------------------------------------------

annotate BurnService.ROBLedger with @(restrict: [
    { grant: 'READ', to: ['BurnDataView', 'BurnDataEdit', 'ReportView', 'AdminAccess'] },
    { grant: ['CREATE', 'UPDATE'], to: ['BurnDataEdit', 'AdminAccess'] },
    { grant: 'DELETE', to: ['AdminAccess'] },

    // D26 / WP-02C. These eighteen bound actions declare NO @requires of their
    // own, so there was nothing to mirror and WP-02B could not fix them
    // mechanically. Decision D26: MIRROR THE ENTITY'S UPDATE GRANT AS A FLOOR
    // — an action that modifies an entity should require at least what
    // modifying it directly requires, which widens nothing.
    //
    // A FLOOR, NOT A CORRECT ANSWER. Several warrant a higher scope; those are
    // flagged in the pull request for a production review, not decided here.
    { grant: 'approveAdjustment', to: ['BurnDataEdit', 'AdminAccess'] },
    { grant: 'rejectAdjustment',  to: ['BurnDataEdit', 'AdminAccess'] }
]);

// ----------------------------------------------------------------------------
// FuelBurnExceptions - Variance exception records
// ----------------------------------------------------------------------------

annotate BurnService.FuelBurnExceptions with @(restrict: [
    { grant: 'READ', to: ['BurnDataView', 'BurnDataEdit', 'ReportView', 'AdminAccess'] },
    { grant: ['CREATE', 'UPDATE'], to: ['BurnDataEdit', 'AdminAccess'] },
    { grant: 'DELETE', to: ['AdminAccess'] },

    // D26 / WP-02C. These eighteen bound actions declare NO @requires of their
    // own, so there was nothing to mirror and WP-02B could not fix them
    // mechanically. Decision D26: MIRROR THE ENTITY'S UPDATE GRANT AS A FLOOR
    // — an action that modifies an entity should require at least what
    // modifying it directly requires, which widens nothing.
    //
    // A FLOOR, NOT A CORRECT ANSWER. Several warrant a higher scope; those are
    // flagged in the pull request for a production review, not decided here.
    { grant: 'assign',             to: ['BurnDataEdit', 'AdminAccess'] },
    { grant: 'startInvestigation', to: ['BurnDataEdit', 'AdminAccess'] },
    { grant: 'resolve',            to: ['BurnDataEdit', 'AdminAccess'] },
    { grant: 'close',              to: ['BurnDataEdit', 'AdminAccess'] },
    { grant: 'linkMaintenance',    to: ['BurnDataEdit', 'AdminAccess'] }
]);

// ----------------------------------------------------------------------------
// BurnService Actions - Upload permissions
// ----------------------------------------------------------------------------

// WP-19. ApuUsage and its bound action. Declared with its grant in the same
// change: D22 makes a bound action without one unreachable for every user.
annotate BurnService.ApuUsage with @(restrict: [
    { grant: 'READ', to: ['BurnDataView', 'BurnDataEdit', 'ReportView', 'AdminAccess'] },
    { grant: ['CREATE', 'UPDATE'], to: ['BurnDataEdit', 'AdminAccess'] },
    { grant: 'DELETE', to: ['AdminAccess'] },
    { grant: 'deriveBurn', to: ['BurnDataEdit', 'AdminAccess'] }
]);

annotate BurnService.ApuUsage actions {
    @(requires: ['BurnDataEdit', 'AdminAccess'])
    deriveBurn;
};

annotate BurnService.importFuelBurnExcel with @(requires: ['BurnDataEdit', 'AdminAccess']);
annotate BurnService.importROBInitialExcel with @(requires: ['BurnDataEdit', 'AdminAccess']);
annotate BurnService.importPlannedBurnExcel with @(requires: ['BurnDataEdit', 'AdminAccess']);
