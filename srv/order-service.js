/**
 * FuelSphere - Fuel Order Service Handler
 * Handles virtual elements and business logic for FuelOrderService
 */

const cds = require('@sap/cds');

module.exports = class FuelOrderService extends cds.ApplicationService {
    async init() {
        const { FuelOrders, FuelDeliveries, FuelTickets } = this.entities;

        // Add virtual element calculation for FuelOrders
        this.after(['READ'], FuelOrders, (data) => {
            const items = Array.isArray(data) ? data : [data];
            items.forEach(item => {
                if (item) {
                    // Status criticality: 0=neutral, 1=negative, 2=critical, 3=positive
                    switch (item.status) {
                        case 'Draft':
                            item.statusCriticality = 0; // Neutral (grey)
                            break;
                        case 'Submitted':
                            item.statusCriticality = 2; // Warning (yellow)
                            break;
                        case 'Confirmed':
                            item.statusCriticality = 3; // Positive (green)
                            break;
                        case 'InProgress':
                            item.statusCriticality = 2; // Warning (yellow)
                            break;
                        case 'Delivered':
                            item.statusCriticality = 3; // Positive (green)
                            break;
                        case 'Cancelled':
                            item.statusCriticality = 1; // Negative (red)
                            break;
                        default:
                            item.statusCriticality = 0;
                    }

                    // Priority criticality
                    switch (item.priority) {
                        case 'Normal':
                            item.priorityCriticality = 0; // Neutral
                            break;
                        case 'High':
                            item.priorityCriticality = 2; // Warning
                            break;
                        case 'Urgent':
                            item.priorityCriticality = 1; // Negative/Critical
                            break;
                        default:
                            item.priorityCriticality = 0;
                    }
                }
            });
        });

        // Add virtual element calculation for FuelDeliveries
        this.after(['READ'], FuelDeliveries, (data) => {
            const items = Array.isArray(data) ? data : [data];
            items.forEach(item => {
                if (item) {
                    switch (item.status) {
                        case 'Scheduled':
                            item.statusCriticality = 0;
                            break;
                        case 'InProgress':
                            item.statusCriticality = 2;
                            break;
                        case 'Completed':
                            item.statusCriticality = 3;
                            break;
                        case 'Verified':
                            item.statusCriticality = 3;
                            break;
                        case 'Disputed':
                            item.statusCriticality = 1;
                            break;
                        default:
                            item.statusCriticality = 0;
                    }
                }
            });
        });

        await super.init();
    }
};
