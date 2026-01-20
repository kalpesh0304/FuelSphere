/**
 * FuelSphere CDS Authorization Annotations
 * Document ID: FS-FND-003-B
 * Version: 1.0
 * 
 * This file contains the authorization annotations for all FuelSphere services.
 * These annotations enforce RBAC at the CDS service level using @requires and @restrict.
 */

using { fuelsphere as fs } from '../db/schema';

// ============================================================================
// MASTER DATA SERVICE
// ============================================================================

service MasterDataService @(requires: 'authenticated-user') {
  
  // Aircraft Master - Read by all, Write by MasterData roles
  entity Aircraft @(restrict: [
    { grant: 'READ', to: 'MasterDataRead' },
    { grant: ['CREATE', 'UPDATE'], to: 'MasterDataWrite' },
    { grant: 'DELETE', to: 'MasterDataAdmin' }
  ]) as projection on fs.Aircraft;
  
  // Airport Master - Read by all, Write by MasterData roles
  entity Airports @(restrict: [
    { grant: 'READ', to: 'MasterDataRead' },
    { grant: ['CREATE', 'UPDATE'], to: 'MasterDataWrite' },
    { grant: 'DELETE', to: 'MasterDataAdmin' }
  ]) as projection on fs.Airports;
  
  // Supplier Master - Row-level security by Company Code
  entity Suppliers @(restrict: [
    { grant: 'READ', to: 'MasterDataRead', where: 'companyCode = $user.CompanyCode' },
    { grant: ['CREATE', 'UPDATE'], to: 'MasterDataWrite', where: 'companyCode = $user.CompanyCode' },
    { grant: 'DELETE', to: 'MasterDataAdmin' }
  ]) as projection on fs.Suppliers;
  
  // Product Master
  entity Products @(restrict: [
    { grant: 'READ', to: 'MasterDataRead' },
    { grant: ['CREATE', 'UPDATE'], to: 'MasterDataWrite' },
    { grant: 'DELETE', to: 'MasterDataAdmin' }
  ]) as projection on fs.Products;
  
  // Contract Master - Confidential data, restricted access
  entity Contracts @(restrict: [
    { grant: 'READ', to: ['MasterDataRead', 'ContractManage', 'FinancePost'] },
    { grant: ['CREATE', 'UPDATE'], to: 'ContractManage' },
    { grant: 'DELETE', to: 'MasterDataAdmin' }
  ]) as projection on fs.Contracts;
  
  // Route Master
  entity Routes @(restrict: [
    { grant: 'READ', to: 'MasterDataRead' },
    { grant: ['CREATE', 'UPDATE'], to: 'MasterDataWrite' },
    { grant: 'DELETE', to: 'MasterDataAdmin' }
  ]) as projection on fs.Routes;
  
  // Action: Approve master data changes (four-eyes principle)
  action approveMasterData(entityType: String, entityID: UUID) @(requires: 'MasterDataAdmin');
}

// ============================================================================
// PLANNING SERVICE
// ============================================================================

service PlanningService @(requires: 'authenticated-user') {
  
  // Fuel Demand Forecasts
  entity FuelDemandForecasts @(restrict: [
    { grant: 'READ', to: ['PlanningAccess', 'ReportView'] },
    { grant: ['CREATE', 'UPDATE'], to: 'PlanningAccess' },
    { grant: 'DELETE', to: 'AdminAccess' }
  ]) as projection on fs.FuelDemandForecasts;
  
  // Budget Versions - Row-level by Company Code
  entity BudgetVersions @(restrict: [
    { grant: 'READ', to: 'PlanningAccess', where: 'companyCode = $user.CompanyCode' },
    { grant: ['CREATE', 'UPDATE'], to: 'PlanningAccess', where: 'companyCode = $user.CompanyCode' }
  ]) as projection on fs.BudgetVersions;
  
  // Price Plans
  entity PricePlans @(restrict: [
    { grant: 'READ', to: ['PlanningAccess', 'ContractManage'] },
    { grant: ['CREATE', 'UPDATE'], to: 'PlanningAccess' }
  ]) as projection on fs.PricePlans;
  
  // Action: Submit budget for approval
  action submitBudget(budgetID: UUID) @(requires: 'PlanningAccess');
  
  // Action: Approve budget (different user required - SoD)
  action approveBudget(budgetID: UUID) @(requires: 'AdminAccess');
}

// ============================================================================
// FUEL ORDER SERVICE
// ============================================================================

service OrderService @(requires: 'authenticated-user') {
  
  // Fuel Orders - Row-level by Plant (Station)
  entity FuelOrders @(restrict: [
    { grant: 'READ', to: ['FuelOrderCreate', 'FuelOrderApprove', 'ReportView'], 
      where: 'plant = $user.Plant OR $user.Plant IS NULL' },
    { grant: 'CREATE', to: 'FuelOrderCreate', 
      where: 'plant = $user.Plant' },
    { grant: 'UPDATE', to: 'FuelOrderCreate', 
      where: 'plant = $user.Plant AND status = ''Draft''' },
    { grant: 'UPDATE', to: 'FuelOrderApprove', 
      where: 'status = ''Submitted''' }
  ]) as projection on fs.FuelOrders;
  
  // Order Line Items
  entity FuelOrderItems @(restrict: [
    { grant: 'READ', to: ['FuelOrderCreate', 'FuelOrderApprove', 'ReportView'] },
    { grant: ['CREATE', 'UPDATE', 'DELETE'], to: 'FuelOrderCreate' }
  ]) as projection on fs.FuelOrderItems;
  
  // Order Milestones
  entity OrderMilestones @(restrict: [
    { grant: 'READ', to: ['FuelOrderCreate', 'FuelOrderApprove', 'ReportView'] },
    { grant: 'UPDATE', to: 'FuelOrderCreate' }
  ]) as projection on fs.OrderMilestones;
  
  // Action: Submit order for approval
  action submitOrder(orderID: UUID) @(requires: 'FuelOrderCreate');
  
  // Action: Approve order (SoD - different user than creator)
  action approveOrder(orderID: UUID) @(requires: 'FuelOrderApprove');
  
  // Action: Reject order with reason
  action rejectOrder(orderID: UUID, reason: String) @(requires: 'FuelOrderApprove');
}

// ============================================================================
// DELIVERY SERVICE (ePOD)
// ============================================================================

service DeliveryService @(requires: 'authenticated-user') {
  
  // ePOD Records - Row-level by Plant
  entity ePODs @(restrict: [
    { grant: 'READ', to: ['ePODCapture', 'ePODApprove', 'ReportView'], 
      where: 'plant = $user.Plant OR $user.Plant IS NULL' },
    { grant: 'CREATE', to: 'ePODCapture', 
      where: 'plant = $user.Plant' },
    { grant: 'UPDATE', to: 'ePODCapture', 
      where: 'plant = $user.Plant AND status IN (''Draft'', ''Pending'')' },
    { grant: 'UPDATE', to: 'ePODApprove', 
      where: 'status = ''Submitted''' }
  ]) as projection on fs.ePODs;
  
  // Fuel Tickets
  entity FuelTickets @(restrict: [
    { grant: 'READ', to: ['ePODCapture', 'ePODApprove', 'ReportView'] },
    { grant: ['CREATE', 'UPDATE'], to: 'ePODCapture' }
  ]) as projection on fs.FuelTickets;
  
  // Digital Signatures
  entity DigitalSignatures @(restrict: [
    { grant: 'READ', to: ['ePODCapture', 'ePODApprove'] },
    { grant: 'CREATE', to: 'ePODCapture' }
  ]) as projection on fs.DigitalSignatures;
  
  // Action: Submit ePOD for approval
  action submitePOD(epodID: UUID) @(requires: 'ePODCapture');
  
  // Action: Approve ePOD
  action approveePOD(epodID: UUID) @(requires: 'ePODApprove');
  
  // Action: Capture digital signature
  action captureSignature(epodID: UUID, signatureData: String) @(requires: 'ePODCapture');
}

// ============================================================================
// INVOICE SERVICE
// ============================================================================

service InvoiceService @(requires: 'authenticated-user') {
  
  // Invoices - Row-level by Company Code
  entity Invoices @(restrict: [
    { grant: 'READ', to: ['InvoiceVerify', 'InvoiceApprove', 'FinancePost', 'ReportView'], 
      where: 'companyCode = $user.CompanyCode OR $user.CompanyCode IS NULL' },
    { grant: 'CREATE', to: 'InvoiceVerify', 
      where: 'companyCode = $user.CompanyCode' },
    { grant: 'UPDATE', to: 'InvoiceVerify', 
      where: 'status IN (''Draft'', ''Pending'', ''Exception'')' },
    { grant: 'UPDATE', to: 'InvoiceApprove', 
      where: 'status = ''Verified''' }
  ]) as projection on fs.Invoices;
  
  // Invoice Line Items
  entity InvoiceItems @(restrict: [
    { grant: 'READ', to: ['InvoiceVerify', 'InvoiceApprove', 'ReportView'] },
    { grant: ['CREATE', 'UPDATE'], to: 'InvoiceVerify' }
  ]) as projection on fs.InvoiceItems;
  
  // Three-Way Match Results
  entity MatchResults @(restrict: [
    { grant: 'READ', to: ['InvoiceVerify', 'InvoiceApprove', 'ReportView'] },
    { grant: 'CREATE', to: 'InvoiceVerify' }
  ]) as projection on fs.MatchResults;
  
  // Invoice Exceptions
  entity InvoiceExceptions @(restrict: [
    { grant: 'READ', to: ['InvoiceVerify', 'InvoiceApprove'] },
    { grant: ['CREATE', 'UPDATE'], to: 'InvoiceVerify' },
    { grant: 'UPDATE', to: 'InvoiceApprove' }
  ]) as projection on fs.InvoiceExceptions;
  
  // Action: Verify invoice (three-way match)
  action verifyInvoice(invoiceID: UUID) @(requires: 'InvoiceVerify');
  
  // Action: Approve invoice (SoD - different user than verifier)
  action approveInvoice(invoiceID: UUID) @(requires: 'InvoiceApprove');
  
  // Action: Reject invoice with reason
  action rejectInvoice(invoiceID: UUID, reason: String) @(requires: 'InvoiceApprove');
  
  // Action: Create exception
  action createException(invoiceID: UUID, type: String, description: String) @(requires: 'InvoiceVerify');
}

// ============================================================================
// FINANCE SERVICE
// ============================================================================

service FinanceService @(requires: 'authenticated-user') {
  
  // Journal Entries - Row-level by Company Code
  entity JournalEntries @(restrict: [
    { grant: 'READ', to: ['FinancePost', 'ReportView'], 
      where: 'companyCode = $user.CompanyCode OR $user.CompanyCode IS NULL' },
    { grant: 'CREATE', to: 'FinancePost' }
  ]) as projection on fs.JournalEntries;
  
  // Cost Allocations
  entity CostAllocations @(restrict: [
    { grant: 'READ', to: ['FinancePost', 'ReportView'] },
    { grant: ['CREATE', 'UPDATE'], to: 'FinancePost' }
  ]) as projection on fs.CostAllocations;
  
  // GR/IR Clearing
  entity GRIRClearing @(restrict: [
    { grant: 'READ', to: ['FinancePost', 'ReportView'] },
    { grant: 'CREATE', to: 'FinancePost' }
  ]) as projection on fs.GRIRClearing;
  
  // Action: Post to S/4HANA (critical - SOX controlled)
  action postToS4HANA(invoiceID: UUID) @(requires: 'FinancePost');
  
  // Action: Create accrual
  action createAccrual(month: String, companyCode: String, amount: Decimal) @(requires: 'FinancePost');
  
  // Action: Reverse posting (requires dual approval)
  action reversePosting(documentID: String, reason: String) @(requires: 'AdminAccess');
}

// ============================================================================
// BURN SERVICE (Fuel Burn & ROB)
// ============================================================================

service BurnService @(requires: 'authenticated-user') {
  
  // Fuel Burn Records
  entity FuelBurnRecords @(restrict: [
    { grant: 'READ', to: ['BurnDataView', 'ReportView'] },
    { grant: 'CREATE', to: 'BurnDataEdit' },
    { grant: 'UPDATE', to: 'BurnDataEdit', where: 'status != ''Closed''' }
  ]) as projection on fs.FuelBurnRecords;
  
  // ROB Ledger - By Aircraft Tail
  entity ROBLedger @(restrict: [
    { grant: 'READ', to: ['BurnDataView', 'ReportView'] },
    { grant: 'UPDATE', to: 'BurnDataEdit' }
  ]) as projection on fs.ROBLedger;
  
  // Burn Variances
  entity BurnVariances @(restrict: [
    { grant: 'READ', to: ['BurnDataView', 'ReportView'] }
  ]) as projection on fs.BurnVariances;
  
  // Action: Record fuel burn
  action recordBurn(flightID: UUID, burnAmount: Decimal) @(requires: 'BurnDataEdit');
  
  // Action: Adjust ROB (with audit trail)
  action adjustROB(aircraftID: UUID, adjustment: Decimal, reason: String) @(requires: 'BurnDataEdit');
}

// ============================================================================
// INTEGRATION SERVICE
// ============================================================================

service IntegrationService @(requires: 'authenticated-user') {
  
  // Integration Logs
  entity IntegrationLogs @(restrict: [
    { grant: 'READ', to: ['IntegrationMonitor', 'AdminAccess'] }
  ]) as projection on fs.IntegrationLogs;
  
  // API Errors
  entity APIErrors @(restrict: [
    { grant: 'READ', to: ['IntegrationMonitor', 'AdminAccess'] },
    { grant: 'UPDATE', to: 'IntegrationMonitor' }
  ]) as projection on fs.APIErrors;
  
  // System Health
  entity SystemHealth @(restrict: [
    { grant: 'READ', to: ['IntegrationMonitor', 'AdminAccess'] }
  ]) as projection on fs.SystemHealth;
  
  // Action: Retry failed integration
  action retryIntegration(logID: UUID) @(requires: 'IntegrationMonitor');
  
  // Action: Mark error as resolved
  action resolveError(errorID: UUID, resolution: String) @(requires: 'IntegrationMonitor');
}

// ============================================================================
// ADMIN SERVICE
// ============================================================================

service AdminService @(requires: 'AdminAccess') {
  
  // Audit Logs - Read-only, immutable
  entity AuditLogs @(restrict: [
    { grant: 'READ', to: 'AdminAccess' }
  ]) as projection on fs.AuditLogs;
  
  // Security Events
  entity SecurityEvents @(restrict: [
    { grant: 'READ', to: 'AdminAccess' }
  ]) as projection on fs.SecurityEvents;
  
  // User Activity
  entity UserActivity @(restrict: [
    { grant: 'READ', to: 'AdminAccess' }
  ]) as projection on fs.UserActivity;
  
  // Configuration
  entity SystemConfiguration @(restrict: [
    { grant: 'READ', to: 'AdminAccess' },
    { grant: 'UPDATE', to: 'AdminAccess' }
  ]) as projection on fs.SystemConfiguration;
  
  // Action: Export audit logs
  action exportAuditLogs(startDate: Date, endDate: Date, format: String) @(requires: 'AdminAccess');
  
  // Action: Generate SoD report
  action generateSoDReport() @(requires: 'AdminAccess');
  
  // Action: Run access review
  action runAccessReview() @(requires: 'AdminAccess');
}

// ============================================================================
// COMMON ANNOTATIONS
// ============================================================================

// Require authentication for all entities (defense in depth)
annotate fs with @(requires: 'authenticated-user');

// Audit logging aspect - automatically log all changes
aspect auditLogging {
  createdAt  : Timestamp @cds.on.insert: $now;
  createdBy  : String    @cds.on.insert: $user;
  modifiedAt : Timestamp @cds.on.insert: $now  @cds.on.update: $now;
  modifiedBy : String    @cds.on.insert: $user @cds.on.update: $user;
}
