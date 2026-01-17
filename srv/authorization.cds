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
