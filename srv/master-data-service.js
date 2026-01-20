/**
 * FuelSphere - Master Data Service Handler
 * Handles virtual elements for MasterDataService entities
 */

const cds = require('@sap/cds');

module.exports = class MasterDataService extends cds.ApplicationService {
    async init() {
        const { Manufacturers, Aircraft, Airports, Routes, Suppliers, Products, Contracts } = this.entities;

        // Helper function to set activeCriticality based on is_active
        const setActiveCriticality = (data) => {
            const items = Array.isArray(data) ? data : [data];
            items.forEach(item => {
                if (item) {
                    // Criticality: 3=Positive (green), 1=Negative (red)
                    item.activeCriticality = item.is_active ? 3 : 1;
                }
            });
        };

        // Add virtual element calculation for all entities with is_active field
        this.after(['READ'], Manufacturers, setActiveCriticality);
        this.after(['READ'], Aircraft, setActiveCriticality);
        this.after(['READ'], Airports, setActiveCriticality);
        this.after(['READ'], Routes, setActiveCriticality);
        this.after(['READ'], Suppliers, setActiveCriticality);
        this.after(['READ'], Products, setActiveCriticality);
        this.after(['READ'], Contracts, setActiveCriticality);

        await super.init();
    }
};
