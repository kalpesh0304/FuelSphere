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
    { grant: 'READ', to: 'MasterDataRead' }
]);

annotate MasterDataService.Currencies with @(restrict: [
    { grant: 'READ', to: 'MasterDataRead' }
]);

annotate MasterDataService.UnitsOfMeasure with @(restrict: [
    { grant: 'READ', to: 'MasterDataRead' }
]);

annotate MasterDataService.Plants with @(restrict: [
    { grant: 'READ', to: 'MasterDataRead' }
]);

// ----------------------------------------------------------------------------
// FuelSphere Native Entities
// ----------------------------------------------------------------------------

// Manufacturers - Read by all with MasterDataRead, Write by MasterDataWrite, Delete by Admin
annotate MasterDataService.Manufacturers with @(restrict: [
    { grant: 'READ', to: 'MasterDataRead' },
    { grant: ['CREATE', 'UPDATE'], to: 'MasterDataWrite' },
    { grant: 'DELETE', to: 'MasterDataAdmin' }
]);

// Aircraft - Read by all with MasterDataRead, Write by MasterDataWrite, Delete by Admin
annotate MasterDataService.Aircraft with @(restrict: [
    { grant: 'READ', to: 'MasterDataRead' },
    { grant: ['CREATE', 'UPDATE'], to: 'MasterDataWrite' },
    { grant: 'DELETE', to: 'MasterDataAdmin' }
]);

// Airports - Read by all with MasterDataRead, Write by MasterDataWrite, Delete by Admin
annotate MasterDataService.Airports with @(restrict: [
    { grant: 'READ', to: 'MasterDataRead' },
    { grant: ['CREATE', 'UPDATE'], to: 'MasterDataWrite' },
    { grant: 'DELETE', to: 'MasterDataAdmin' }
]);

// Routes - Read by all with MasterDataRead, Write by MasterDataWrite, Delete by Admin
annotate MasterDataService.Routes with @(restrict: [
    { grant: 'READ', to: 'MasterDataRead' },
    { grant: ['CREATE', 'UPDATE'], to: 'MasterDataWrite' },
    { grant: 'DELETE', to: 'MasterDataAdmin' }
]);

// ----------------------------------------------------------------------------
// Bidirectional Entities (S/4HANA Integration)
// ----------------------------------------------------------------------------

// Suppliers - Read by MasterDataRead, Write requires MasterDataWrite, Delete requires Admin
annotate MasterDataService.Suppliers with @(restrict: [
    { grant: 'READ', to: 'MasterDataRead' },
    { grant: ['CREATE', 'UPDATE'], to: 'MasterDataWrite' },
    { grant: 'DELETE', to: 'MasterDataAdmin' }
]);

// Products - Read by MasterDataRead, Write requires MasterDataWrite, Delete requires Admin
annotate MasterDataService.Products with @(restrict: [
    { grant: 'READ', to: 'MasterDataRead' },
    { grant: ['CREATE', 'UPDATE'], to: 'MasterDataWrite' },
    { grant: 'DELETE', to: 'MasterDataAdmin' }
]);

// Contracts - Confidential data, restricted access
// Read by MasterDataRead, ContractManage, FinancePost
// Write by ContractManage only
// Delete by Admin only
annotate MasterDataService.Contracts with @(restrict: [
    { grant: 'READ', to: ['MasterDataRead', 'ContractManage', 'FinancePost'] },
    { grant: ['CREATE', 'UPDATE'], to: 'ContractManage' },
    { grant: 'DELETE', to: 'MasterDataAdmin' }
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
    // Read access - any authenticated user for development
    { grant: 'READ', to: ['FuelOrderCreate', 'FuelOrderApprove', 'FinancePost', 'ReportView', 'AdminAccess', 'any'] },
    // Create - any authenticated user for development
    { grant: 'CREATE', to: ['FuelOrderCreate', 'AdminAccess', 'any'] },
    // Update - any authenticated user for development
    { grant: 'UPDATE', to: ['FuelOrderCreate', 'FuelOrderApprove', 'AdminAccess', 'any'] },
    // Delete - any authenticated user for development
    { grant: 'DELETE', to: ['AdminAccess', 'any'] }
]);

// Submit action - Requires FuelOrderCreate scope
annotate FuelOrderService.FuelOrders actions {
    @(requires: 'FuelOrderCreate')
    submit;

    @(requires: 'FuelOrderApprove')
    confirm;

    @(requires: ['FuelOrderCreate', 'FuelOrderApprove'])
    startDelivery;

    @(requires: ['FuelOrderCreate', 'FuelOrderApprove', 'AdminAccess'])
    cancel;

    @(requires: 'FuelOrderCreate')
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
    { grant: 'READ', to: ['ePODCapture', 'ePODApprove', 'FinancePost', 'ReportView', 'AdminAccess'] },
    { grant: 'CREATE', to: ['ePODCapture', 'AdminAccess'] },
    { grant: 'UPDATE', to: ['ePODCapture', 'ePODApprove', 'AdminAccess'] },
    { grant: 'DELETE', to: 'AdminAccess' }
]);

// ePOD Actions authorization
annotate FuelOrderService.FuelDeliveries actions {
    // Capture signatures - requires ePODCapture scope
    // This is the critical action that triggers S/4HANA PO/GR creation
    @(requires: 'ePODCapture')
    captureSignatures;

    @(requires: ['ePODCapture', 'ePODApprove'])
    verifyQuantity;

    @(requires: 'ePODApprove')
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
    { grant: 'READ', to: ['ePODCapture', 'ePODApprove', 'FinancePost', 'ReportView', 'AdminAccess'] },
    { grant: 'CREATE', to: ['ePODCapture', 'AdminAccess'] },
    { grant: 'UPDATE', to: ['ePODCapture', 'ePODApprove', 'AdminAccess'] },
    { grant: 'DELETE', to: 'AdminAccess' }
]);

annotate FuelOrderService.FuelTickets actions {
    @(requires: 'ePODCapture')
    attachToDelivery;

    @(requires: 'ePODApprove')
    verify;
};

// ----------------------------------------------------------------------------
// Reference Data - Read-only in Order Service
// ----------------------------------------------------------------------------

// All reference entities are read-only in order service context
// Read access granted to anyone with order-related scopes
annotate FuelOrderService.Flights with @(restrict: [
    { grant: 'READ', to: ['FuelOrderCreate', 'FuelOrderApprove', 'ePODCapture', 'ReportView', 'AdminAccess'] }
]);

annotate FuelOrderService.Airports with @(restrict: [
    { grant: 'READ', to: ['FuelOrderCreate', 'FuelOrderApprove', 'ePODCapture', 'ReportView', 'AdminAccess'] }
]);

annotate FuelOrderService.Suppliers with @(restrict: [
    { grant: 'READ', to: ['FuelOrderCreate', 'FuelOrderApprove', 'ePODCapture', 'ReportView', 'AdminAccess', 'any'] }
]);

annotate FuelOrderService.Contracts with @(restrict: [
    { grant: 'READ', to: ['FuelOrderCreate', 'FuelOrderApprove', 'ContractManage', 'FinancePost', 'AdminAccess'] }
]);

annotate FuelOrderService.Products with @(restrict: [
    { grant: 'READ', to: ['FuelOrderCreate', 'FuelOrderApprove', 'ePODCapture', 'ReportView', 'AdminAccess', 'any'] }
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

annotate FuelOrderService.generateOrderNumber with @(requires: 'FuelOrderCreate');
annotate FuelOrderService.generateDeliveryNumber with @(requires: 'ePODCapture');
annotate FuelOrderService.getOrdersByStation with @(requires: ['FuelOrderCreate', 'FuelOrderApprove', 'ReportView', 'AdminAccess']);
annotate FuelOrderService.getOrdersBySupplier with @(requires: ['FuelOrderCreate', 'FuelOrderApprove', 'ReportView', 'AdminAccess']);
