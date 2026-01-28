/**
 * FuelSphere - Ticket Service Handler
 * Handles virtual elements and business logic for TicketService
 */

const cds = require('@sap/cds');

module.exports = class TicketService extends cds.ApplicationService {
    async init() {
        const { FuelTickets } = this.entities;

        // Set statusCriticality based on status field
        this.after(['READ'], FuelTickets, (data) => {
            const items = Array.isArray(data) ? data : [data];
            items.forEach(item => {
                if (item) {
                    // Criticality based on ticket status
                    switch (item.status) {
                        case 'Pending':
                            item.statusCriticality = 2; // Yellow/Warning
                            break;
                        case 'Verified':
                            item.statusCriticality = 3; // Green/Positive
                            break;
                        case 'Rejected':
                            item.statusCriticality = 1; // Red/Negative
                            break;
                        case 'Attached':
                            item.statusCriticality = 3; // Green/Positive
                            break;
                        default:
                            item.statusCriticality = 0; // Neutral
                    }
                }
            });
        });

        await super.init();
    }
};
