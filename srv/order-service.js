/**
 * FuelSphere - Fuel Order Service Handler
 * Handles virtual elements and business logic for FuelOrderService
 */

const cds = require('@sap/cds');
const { SELECT } = require('@sap/cds/lib/ql/cds-ql');

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

        /* Logic to update the total amount on chnage of unit price or ordered quantity */
        this.before(['PATCH','UPDATE'], [FuelOrders, FuelOrders.drafts], async(req) => {
            const {ordered_quantity, unit_price} = req.data;
            if (ordered_quantity !== undefined || unit_price !== undefined) {
                // const current = await SELECT.one.from(req.target).where({ID: req.data.ID});

                const current = await SELECT.one.from(req.subject);
                
                const quan = ordered_quantity ?? current.ordered_quantity ?? 0;
                const unit = unit_price ?? current.unit_price ?? 0;
                if (quan > 100000) {
                    req.error(400, "Large order detected. Please verify quantity.");
                    return;
                }
                req.data.total_amount =  Number((quan * unit).toFixed(2));
                console.log(200, `Total Amount recalculated: ${req.data.total_amount}`);
                
            }
        });

        /* Logic to generate Fuel Order No and changing the status from draft to Created */
        this.before('CREATE', FuelOrders, async (req) => {
            const { FuelOrders } = this.entities;
            const { station_code } = req.data;

            // 1. Generate YYYYMMDD string
            const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');

            // 2. Default station if missing (or throw error)
            const stn = station_code || 'XXX';

            // 3. Find the last sequence used TODAY for this STATION
            // Pattern: FO-SIN-20260306-%
            const pattern = `FO-${stn}-${today}-%`;
            const lastOrder = await SELECT.one.from(FuelOrders)
                .columns('order_number')
                .where({ order_number: { like: pattern } })
                .orderBy('order_number desc');

            let nextSeq = 1;
            if (lastOrder) {
                // Extract the last 3 digits from FO-SIN-20260306-005 -> 005
                const lastSeqStr = lastOrder.order_number.split('-').pop();
                nextSeq = parseInt(lastSeqStr) + 1;
            }

            // 4. Format: FO-SIN-20260306-001
            const seqStr = String(nextSeq).padStart(3, '0');
            req.data.order_number = `FO-${stn}-${today}-${seqStr}`;

            // 5. Update Status
            req.data.status = 'Created';
        });

        // To enable submit for approval button in object page
        this.after(['READ', 'EDIT'], FuelOrders, (data) => {
            const items = Array.isArray(data) ? data : [data];
            items.forEach(item => {
                if (item) {
                    // Button is visible ONLY if status is 'Created'
                    item.canSubmit = (item.status === 'Created') ? true : false;
                }
            });
        });

        await super.init();
    }
};
