/**
 * FuelSphere - Invoice Verification Service Handler (FDD-06)
 * Populates virtual elements for Invoices entity
 *
 * SAP Criticality Scale:
 *   0 = Neutral (grey)
 *   1 = Negative/Critical (red)
 *   2 = Warning (orange/yellow)
 *   3 = Positive/Success (green)
 */

const cds = require('@sap/cds');

module.exports = class InvoiceService extends cds.ApplicationService {
    async init() {
        const { Invoices } = this.entities;

        // ====================================================================
        // Invoices - Virtual Fields
        // ====================================================================
        this.after(['READ'], Invoices, (data) => {
            const items = Array.isArray(data) ? data : [data];
            const today = new Date();
            today.setHours(0, 0, 0, 0);

            items.forEach(item => {
                if (!item) return;

                // statusCriticality - maps InvoiceStatus to UI criticality
                switch (item.status) {
                    case 'DRAFT':
                        item.statusCriticality = 0; // Neutral
                        break;
                    case 'VERIFIED':
                        item.statusCriticality = 3; // Positive
                        break;
                    case 'POSTED':
                        item.statusCriticality = 3; // Positive
                        break;
                    case 'PAID':
                        item.statusCriticality = 3; // Positive
                        break;
                    case 'CANCELLED':
                        item.statusCriticality = 1; // Negative
                        break;
                    default:
                        item.statusCriticality = 0;
                }

                // approvalCriticality - maps InvoiceApprovalStatus
                switch (item.approval_status) {
                    case 'PENDING':
                        item.approvalCriticality = 2; // Warning
                        break;
                    case 'APPROVED':
                        item.approvalCriticality = 3; // Positive
                        break;
                    case 'REJECTED':
                        item.approvalCriticality = 1; // Negative
                        break;
                    case 'ESCALATED':
                        item.approvalCriticality = 2; // Warning
                        break;
                    case 'BLOCKED':
                        item.approvalCriticality = 1; // Negative
                        break;
                    case 'UNDER_REVIEW':
                        item.approvalCriticality = 2; // Warning
                        break;
                    default:
                        item.approvalCriticality = 0;
                }

                // matchingCriticality - maps InvoiceMatchStatus
                switch (item.match_status) {
                    case 'UNMATCHED':
                        item.matchingCriticality = 0; // Neutral
                        break;
                    case 'MATCHED':
                        item.matchingCriticality = 3; // Positive
                        break;
                    case 'PARTIAL_MATCH':
                        item.matchingCriticality = 2; // Warning
                        break;
                    case 'PRICE_VARIANCE':
                        item.matchingCriticality = 2; // Warning
                        break;
                    case 'QTY_VARIANCE':
                        item.matchingCriticality = 2; // Warning
                        break;
                    case 'EXCEPTION':
                        item.matchingCriticality = 1; // Negative
                        break;
                    case 'MULTIPLE_ERRORS':
                        item.matchingCriticality = 1; // Negative
                        break;
                    default:
                        item.matchingCriticality = 0;
                }

                // daysUntilDue - computed from due_date
                item.daysUntilDue = null;
                if (item.due_date) {
                    const dueDate = new Date(item.due_date);
                    dueDate.setHours(0, 0, 0, 0);
                    const diffMs = dueDate.getTime() - today.getTime();
                    item.daysUntilDue = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
                }
            });
        });

        await super.init();
    }
};
