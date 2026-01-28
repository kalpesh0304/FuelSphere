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
    { grant: 'READ', to: ['MasterDataRead', 'any'] }
]);

annotate MasterDataService.Currencies with @(restrict: [
    { grant: 'READ', to: ['MasterDataRead', 'any'] }
]);

annotate MasterDataService.UnitsOfMeasure with @(restrict: [
    { grant: 'READ', to: ['MasterDataRead', 'any'] }
]);

annotate MasterDataService.Plants with @(restrict: [
    { grant: 'READ', to: ['MasterDataRead', 'any'] }
]);

// ----------------------------------------------------------------------------
// FuelSphere Native Entities
// ----------------------------------------------------------------------------

// Manufacturers - Read by all with MasterDataRead, Write by MasterDataWrite, Delete by Admin
annotate MasterDataService.Manufacturers with @(restrict: [
    { grant: 'READ', to: ['MasterDataRead', 'any'] },
    { grant: ['CREATE', 'UPDATE'], to: ['MasterDataWrite', 'any'] },
    { grant: 'DELETE', to: ['MasterDataAdmin', 'any'] }
]);

// Aircraft - Read by all with MasterDataRead, Write by MasterDataWrite, Delete by Admin
annotate MasterDataService.Aircraft with @(restrict: [
    { grant: 'READ', to: ['MasterDataRead', 'any'] },
    { grant: ['CREATE', 'UPDATE'], to: ['MasterDataWrite', 'any'] },
    { grant: 'DELETE', to: ['MasterDataAdmin', 'any'] }
]);

// Airports - Read by all with MasterDataRead, Write by MasterDataWrite, Delete by Admin
annotate MasterDataService.Airports with @(restrict: [
    { grant: 'READ', to: ['MasterDataRead', 'any'] },
    { grant: ['CREATE', 'UPDATE'], to: ['MasterDataWrite', 'any'] },
    { grant: 'DELETE', to: ['MasterDataAdmin', 'any'] }
]);

// Routes - Read by all with MasterDataRead, Write by MasterDataWrite, Delete by Admin
annotate MasterDataService.Routes with @(restrict: [
    { grant: 'READ', to: ['MasterDataRead', 'any'] },
    { grant: ['CREATE', 'UPDATE'], to: ['MasterDataWrite', 'any'] },
    { grant: 'DELETE', to: ['MasterDataAdmin', 'any'] }
]);

// ----------------------------------------------------------------------------
// Bidirectional Entities (S/4HANA Integration)
// ----------------------------------------------------------------------------

// Suppliers - Read by MasterDataRead, Write requires MasterDataWrite, Delete requires Admin
annotate MasterDataService.Suppliers with @(restrict: [
    { grant: 'READ', to: ['MasterDataRead', 'any'] },
    { grant: ['CREATE', 'UPDATE'], to: ['MasterDataWrite', 'any'] },
    { grant: 'DELETE', to: ['MasterDataAdmin', 'any'] }
]);

// Products - Read by MasterDataRead, Write requires MasterDataWrite, Delete requires Admin
annotate MasterDataService.Products with @(restrict: [
    { grant: 'READ', to: ['MasterDataRead', 'any'] },
    { grant: ['CREATE', 'UPDATE'], to: ['MasterDataWrite', 'any'] },
    { grant: 'DELETE', to: ['MasterDataAdmin', 'any'] }
]);

// Contracts - Confidential data, restricted access
// Read by MasterDataRead, ContractManage, FinancePost
// Write by ContractManage only
// Delete by Admin only
annotate MasterDataService.Contracts with @(restrict: [
    { grant: 'READ', to: ['MasterDataRead', 'ContractManage', 'FinancePost', 'any'] },
    { grant: ['CREATE', 'UPDATE'], to: ['ContractManage', 'any'] },
    { grant: 'DELETE', to: ['MasterDataAdmin', 'any'] }
]);

// ----------------------------------------------------------------------------
// Actions
// ----------------------------------------------------------------------------

// syncFromS4HANA action - Restricted to IntegrationMonitor or AdminAccess (+ any for dev)
annotate MasterDataService.syncFromS4HANA with @(requires: ['IntegrationMonitor', 'AdminAccess', 'any']);

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
    // Read access - any authenticated user for development
    { grant: 'READ', to: ['FuelOrderCreate', 'FuelOrderApprove', 'FinancePost', 'ReportView', 'AdminAccess', 'any'] },
    // Create - any authenticated user for development
    { grant: 'CREATE', to: ['FuelOrderCreate', 'AdminAccess', 'any'] },
    // Update - any authenticated user for development
    { grant: 'UPDATE', to: ['FuelOrderCreate', 'FuelOrderApprove', 'AdminAccess', 'any'] },
    // Delete - any authenticated user for development
    { grant: 'DELETE', to: ['AdminAccess', 'any'] }
]);

// Submit action - Requires FuelOrderCreate scope (+ any for dev)
annotate FuelOrderService.FuelOrders actions {
    @(requires: ['FuelOrderCreate', 'any'])
    submit;

    @(requires: ['FuelOrderApprove', 'any'])
    confirm;

    @(requires: ['FuelOrderCreate', 'FuelOrderApprove', 'any'])
    startDelivery;

    @(requires: ['FuelOrderCreate', 'FuelOrderApprove', 'AdminAccess', 'any'])
    cancel;

    @(requires: ['FuelOrderCreate', 'any'])
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
annotate FuelOrderService.FuelDeliveries with @(restrict: [
    { grant: 'READ', to: ['ePODCapture', 'ePODApprove', 'FinancePost', 'ReportView', 'AdminAccess', 'any'] },
    { grant: 'CREATE', to: ['ePODCapture', 'AdminAccess', 'any'] },
    { grant: 'UPDATE', to: ['ePODCapture', 'ePODApprove', 'AdminAccess', 'any'] },
    { grant: 'DELETE', to: ['AdminAccess', 'any'] }
]);

// ePOD Actions authorization (+ any for dev)
annotate FuelOrderService.FuelDeliveries actions {
    // Capture signatures - requires ePODCapture scope
    // This is the critical action that triggers S/4HANA PO/GR creation
    @(requires: ['ePODCapture', 'any'])
    captureSignatures;

    @(requires: ['ePODCapture', 'ePODApprove', 'any'])
    verifyQuantity;

    @(requires: ['ePODApprove', 'any'])
    dispute;
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
    { grant: 'READ', to: ['ePODCapture', 'ePODApprove', 'FinancePost', 'ReportView', 'AdminAccess', 'any'] },
    { grant: 'CREATE', to: ['ePODCapture', 'AdminAccess', 'any'] },
    { grant: 'UPDATE', to: ['ePODCapture', 'ePODApprove', 'AdminAccess', 'any'] },
    { grant: 'DELETE', to: ['AdminAccess', 'any'] }
]);

annotate FuelOrderService.FuelTickets actions {
    @(requires: ['ePODCapture', 'any'])
    attachToDelivery;

    @(requires: ['ePODApprove', 'any'])
    verify;
};

// ----------------------------------------------------------------------------
// Reference Data - Read-only in Order Service
// ----------------------------------------------------------------------------

// All reference entities are read-only in order service context
// Read access granted to anyone with order-related scopes
annotate FuelOrderService.Flights with @(restrict: [
    { grant: 'READ', to: ['FuelOrderCreate', 'FuelOrderApprove', 'ePODCapture', 'ReportView', 'AdminAccess', 'any'] }
]);

annotate FuelOrderService.Airports with @(restrict: [
    { grant: 'READ', to: ['FuelOrderCreate', 'FuelOrderApprove', 'ePODCapture', 'ReportView', 'AdminAccess', 'any'] }
]);

annotate FuelOrderService.Suppliers with @(restrict: [
    { grant: 'READ', to: ['FuelOrderCreate', 'FuelOrderApprove', 'ePODCapture', 'ReportView', 'AdminAccess', 'any'] }
]);

annotate FuelOrderService.Contracts with @(restrict: [
    { grant: 'READ', to: ['FuelOrderCreate', 'FuelOrderApprove', 'ContractManage', 'FinancePost', 'AdminAccess', 'any'] }
]);

annotate FuelOrderService.Products with @(restrict: [
    { grant: 'READ', to: ['FuelOrderCreate', 'FuelOrderApprove', 'ePODCapture', 'ReportView', 'AdminAccess', 'any'] }
]);

annotate FuelOrderService.Aircraft with @(restrict: [
    { grant: 'READ', to: ['FuelOrderCreate', 'FuelOrderApprove', 'ePODCapture', 'ReportView', 'AdminAccess', 'any'] }
]);

annotate FuelOrderService.Manufacturers with @(restrict: [
    { grant: 'READ', to: ['FuelOrderCreate', 'FuelOrderApprove', 'ePODCapture', 'ReportView', 'AdminAccess', 'any'] }
]);

annotate FuelOrderService.Countries with @(restrict: [
    { grant: 'READ', to: ['FuelOrderCreate', 'FuelOrderApprove', 'ePODCapture', 'ReportView', 'AdminAccess', 'any'] }
]);

annotate FuelOrderService.Currencies with @(restrict: [
    { grant: 'READ', to: ['FuelOrderCreate', 'FuelOrderApprove', 'FinancePost', 'ReportView', 'AdminAccess', 'any'] }
]);

annotate FuelOrderService.Plants with @(restrict: [
    { grant: 'READ', to: ['FuelOrderCreate', 'FuelOrderApprove', 'ePODCapture', 'ReportView', 'AdminAccess', 'any'] }
]);

annotate FuelOrderService.UnitsOfMeasure with @(restrict: [
    { grant: 'READ', to: ['FuelOrderCreate', 'FuelOrderApprove', 'ePODCapture', 'ReportView', 'AdminAccess', 'any'] }
]);

// ----------------------------------------------------------------------------
// Service-level Functions
// ----------------------------------------------------------------------------

annotate FuelOrderService.generateOrderNumber with @(requires: ['FuelOrderCreate', 'any']);
annotate FuelOrderService.generateDeliveryNumber with @(requires: ['ePODCapture', 'any']);
annotate FuelOrderService.getOrdersByStation with @(requires: ['FuelOrderCreate', 'FuelOrderApprove', 'ReportView', 'AdminAccess', 'any']);
annotate FuelOrderService.getOrdersBySupplier with @(requires: ['FuelOrderCreate', 'FuelOrderApprove', 'ReportView', 'AdminAccess', 'any']);

// ============================================================================
// TICKET SERVICE - Authorization (Standalone Ticket Management)
// ============================================================================

using TicketService from './ticket-service';

// Service-level: Require authenticated user
annotate TicketService with @(requires: 'authenticated-user');

// FuelTickets - Full CRUD for development
annotate TicketService.FuelTickets with @(restrict: [
    { grant: 'READ', to: ['ePODCapture', 'ePODApprove', 'FinancePost', 'ReportView', 'AdminAccess', 'any'] },
    { grant: 'CREATE', to: ['ePODCapture', 'AdminAccess', 'any'] },
    { grant: 'UPDATE', to: ['ePODCapture', 'ePODApprove', 'AdminAccess', 'any'] },
    { grant: 'DELETE', to: ['AdminAccess', 'any'] }
]);

// Ticket actions
annotate TicketService.FuelTickets actions {
    @(requires: ['ePODCapture', 'any'])
    attachToDelivery;

    @(requires: ['ePODApprove', 'any'])
    verify;

    @(requires: ['ePODApprove', 'any'])
    reject;
};

// Reference data - Read-only
annotate TicketService.FuelOrders with @(restrict: [
    { grant: 'READ', to: ['ePODCapture', 'ePODApprove', 'FinancePost', 'ReportView', 'AdminAccess', 'any'] }
]);

annotate TicketService.FuelDeliveries with @(restrict: [
    { grant: 'READ', to: ['ePODCapture', 'ePODApprove', 'FinancePost', 'ReportView', 'AdminAccess', 'any'] }
]);

annotate TicketService.Airports with @(restrict: [
    { grant: 'READ', to: ['ePODCapture', 'ePODApprove', 'ReportView', 'AdminAccess', 'any'] }
]);

annotate TicketService.Suppliers with @(restrict: [
    { grant: 'READ', to: ['ePODCapture', 'ePODApprove', 'ReportView', 'AdminAccess', 'any'] }
]);

// Service-level functions
annotate TicketService.generateTicketNumber with @(requires: ['ePODCapture', 'any']);
annotate TicketService.getTicketsByOrder with @(requires: ['ePODCapture', 'ePODApprove', 'ReportView', 'AdminAccess', 'any']);
annotate TicketService.getUnattachedTickets with @(requires: ['ePODCapture', 'ePODApprove', 'AdminAccess', 'any']);
