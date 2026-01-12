const cds = require('@sap/cds');

/**
 * Implementation for Operations Service
 */
module.exports = class OperationsService extends cds.ApplicationService {

    async init() {
        const {
            FlightFuelRequirements,
            FuelOrders,
            FuelDeliveries,
            FuelingOperations,
            InventoryTransactions,
            StorageFacilities,
            SupplierContracts
        } = this.entities;

        // Generate unique order numbers
        this.before('CREATE', FuelOrders, async (req) => {
            req.data.orderNumber = await this._generateOrderNumber();
            req.data.orderDate = new Date().toISOString();
        });

        // Generate unique delivery numbers
        this.before('CREATE', FuelDeliveries, async (req) => {
            req.data.deliveryNumber = await this._generateDeliveryNumber();
        });

        // Generate unique operation numbers
        this.before('CREATE', FuelingOperations, async (req) => {
            req.data.operationNumber = await this._generateOperationNumber();
        });

        // Bound actions for FlightFuelRequirements
        this.on('confirmRequirement', FlightFuelRequirements, async (req) => {
            const { ID } = req.params[0];
            await UPDATE(FlightFuelRequirements).where({ ID }).set({ status: 'CONFIRMED' });
            return SELECT.one.from(FlightFuelRequirements).where({ ID });
        });

        this.on('cancelRequirement', FlightFuelRequirements, async (req) => {
            const { ID } = req.params[0];
            await UPDATE(FlightFuelRequirements).where({ ID }).set({ status: 'CANCELLED' });
            return SELECT.one.from(FlightFuelRequirements).where({ ID });
        });

        // Bound actions for FuelOrders
        this.on('confirmOrder', FuelOrders, async (req) => {
            const { ID } = req.params[0];
            await UPDATE(FuelOrders).where({ ID }).set({ status: 'CONFIRMED' });
            return SELECT.one.from(FuelOrders).where({ ID });
        });

        this.on('cancelOrder', FuelOrders, async (req) => {
            const { ID } = req.params[0];
            const order = await SELECT.one.from(FuelOrders).where({ ID });
            if (order.status === 'DELIVERED') {
                req.error(400, 'Cannot cancel a delivered order');
            }
            await UPDATE(FuelOrders).where({ ID }).set({ status: 'CANCELLED' });
            return SELECT.one.from(FuelOrders).where({ ID });
        });

        this.on('recordDelivery', FuelOrders, async (req) => {
            const { ID } = req.params[0];
            const { volume, temperature, density } = req.data;

            const order = await SELECT.one.from(FuelOrders).where({ ID });
            if (!order) req.error(404, 'Order not found');

            const delivery = {
                deliveryNumber: await this._generateDeliveryNumber(),
                order_ID: ID,
                deliveredVolume: volume,
                temperature: temperature,
                density: density,
                deliveryDate: new Date().toISOString()
            };

            const result = await INSERT.into(FuelDeliveries).entries(delivery);

            // Update order status
            await UPDATE(FuelOrders).where({ ID }).set({
                status: 'DELIVERED',
                deliveredVolume: volume,
                actualDeliveryDate: new Date().toISOString()
            });

            return SELECT.one.from(FuelDeliveries).where({ deliveryNumber: delivery.deliveryNumber });
        });

        // Bound actions for FuelingOperations
        this.on('startFueling', FuelingOperations, async (req) => {
            const { ID } = req.params[0];
            await UPDATE(FuelingOperations).where({ ID }).set({
                status: 'IN_PROGRESS',
                startTime: new Date().toISOString()
            });
            return SELECT.one.from(FuelingOperations).where({ ID });
        });

        this.on('completeFueling', FuelingOperations, async (req) => {
            const { ID } = req.params[0];
            const { volumeDispensed } = req.data;

            const operation = await SELECT.one.from(FuelingOperations).where({ ID });
            if (!operation) req.error(404, 'Operation not found');

            await UPDATE(FuelingOperations).where({ ID }).set({
                status: 'COMPLETED',
                volumeDispensed: volumeDispensed,
                endTime: new Date().toISOString()
            });

            // Update inventory
            if (operation.storageFacility_ID) {
                await this._updateInventory(
                    operation.storageFacility_ID,
                    'DISPENSE',
                    -volumeDispensed,
                    operation.operationNumber
                );
            }

            return SELECT.one.from(FuelingOperations).where({ ID });
        });

        // Functions
        this.on('getAvailableFuel', async (req) => {
            const { airportId, fuelTypeId } = req.data;
            const facilities = await SELECT.from(StorageFacilities)
                .where({ airport_ID: airportId, fuelType_ID: fuelTypeId, isOperational: true });
            return facilities.reduce((sum, f) => sum + (f.currentLevel || 0), 0);
        });

        this.on('getOptimalSupplier', async (req) => {
            const { airportId, fuelTypeId, volume } = req.data;
            const today = new Date().toISOString().split('T')[0];

            const contracts = await SELECT.from(SupplierContracts)
                .where({
                    fuelType_ID: fuelTypeId,
                    status: 'ACTIVE'
                })
                .and(`validFrom <= '${today}' AND validTo >= '${today}'`)
                .and(`minVolume <= ${volume} AND maxVolume >= ${volume}`)
                .orderBy('pricePerLiter asc');

            if (contracts.length === 0) {
                return null;
            }

            const best = contracts[0];
            // Get supplier details
            const db = cds.db || await cds.connect.to('db');
            const supplier = await db.run(
                SELECT.one.from('fuelsphere.Suppliers').where({ ID: best.supplier_ID })
            );

            return {
                supplierId: best.supplier_ID,
                supplierName: supplier?.name || 'Unknown',
                contractId: best.ID,
                pricePerLiter: best.pricePerLiter,
                estimatedTotal: best.pricePerLiter * volume,
                currency: best.currency_code || 'USD'
            };
        });

        this.on('getFlightFuelCost', async (req) => {
            const { flightRequirementId } = req.data;
            const requirement = await SELECT.one.from(FlightFuelRequirements)
                .where({ ID: flightRequirementId });

            if (!requirement) req.error(404, 'Flight requirement not found');

            const orders = await SELECT.from(FuelOrders)
                .where({ flightRequirement_ID: flightRequirementId });

            const fuelCost = orders.reduce((sum, o) => sum + (o.totalAmount || 0), 0);

            return {
                fuelCost: fuelCost,
                taxes: fuelCost * 0.05, // Simplified tax calculation
                fees: fuelCost * 0.02,  // Simplified fee calculation
                totalCost: fuelCost * 1.07,
                currency: requirement.currency_code || 'USD'
            };
        });

        await super.init();
    }

    async _generateOrderNumber() {
        const date = new Date();
        const prefix = 'FO';
        const dateStr = date.toISOString().slice(0, 10).replace(/-/g, '');
        const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
        return `${prefix}-${dateStr}-${random}`;
    }

    async _generateDeliveryNumber() {
        const date = new Date();
        const prefix = 'DL';
        const dateStr = date.toISOString().slice(0, 10).replace(/-/g, '');
        const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
        return `${prefix}-${dateStr}-${random}`;
    }

    async _generateOperationNumber() {
        const date = new Date();
        const prefix = 'OP';
        const dateStr = date.toISOString().slice(0, 10).replace(/-/g, '');
        const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
        return `${prefix}-${dateStr}-${random}`;
    }

    async _updateInventory(facilityId, transactionType, volume, referenceDoc) {
        const { StorageFacilities, InventoryTransactions } = this.entities;

        const facility = await SELECT.one.from(StorageFacilities).where({ ID: facilityId });
        if (!facility) return;

        const balanceBefore = facility.currentLevel || 0;
        const balanceAfter = balanceBefore + volume;

        // Create inventory transaction
        await INSERT.into(InventoryTransactions).entries({
            transactionNumber: `IT-${Date.now()}`,
            storageFacility_ID: facilityId,
            transactionType: transactionType,
            volume: volume,
            balanceBefore: balanceBefore,
            balanceAfter: balanceAfter,
            referenceDoc: referenceDoc,
            transactionDate: new Date().toISOString()
        });

        // Update facility level
        await UPDATE(StorageFacilities).where({ ID: facilityId }).set({
            currentLevel: balanceAfter
        });
    }
};
