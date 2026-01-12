using { fuelsphere as db } from '../db/schema';

/**
 * Operations Service for Daily Fuel Management Operations
 * Used by operations staff, dispatchers, and ground crew
 */
@path: '/operations'
@requires: 'authenticated-user'
service OperationsService {

    // Flight Fuel Requirements - Core operational entity
    entity FlightFuelRequirements as projection on db.FlightFuelRequirements {
        *,
        aircraft : redirected to Aircraft,
        departureAirport : redirected to Airports,
        arrivalAirport : redirected to Airports,
        fuelType : redirected to FuelTypes,
        fuelOrders : redirected to FuelOrders
    } actions {
        action confirmRequirement() returns FlightFuelRequirements;
        action cancelRequirement() returns FlightFuelRequirements;
    };

    // Fuel Orders
    entity FuelOrders as projection on db.FuelOrders {
        *,
        flightRequirement : redirected to FlightFuelRequirements,
        supplier : redirected to Suppliers,
        contract : redirected to SupplierContracts,
        fuelType : redirected to FuelTypes,
        airport : redirected to Airports,
        deliveries : redirected to FuelDeliveries
    } actions {
        action confirmOrder() returns FuelOrders;
        action cancelOrder() returns FuelOrders;
        action recordDelivery(volume: Decimal, temperature: Decimal, density: Decimal) returns FuelDeliveries;
    };

    // Fuel Deliveries
    entity FuelDeliveries as projection on db.FuelDeliveries {
        *,
        order : redirected to FuelOrders,
        storageFacility : redirected to StorageFacilities
    } actions {
        action approveDelivery() returns FuelDeliveries;
        action rejectDelivery(reason: String) returns FuelDeliveries;
    };

    // Fueling Operations
    entity FuelingOperations as projection on db.FuelingOperations {
        *,
        flightRequirement : redirected to FlightFuelRequirements,
        aircraft : redirected to Aircraft,
        airport : redirected to Airports,
        storageFacility : redirected to StorageFacilities,
        fuelType : redirected to FuelTypes
    } actions {
        action startFueling() returns FuelingOperations;
        action completeFueling(volumeDispensed: Decimal) returns FuelingOperations;
        action abortFueling(reason: String) returns FuelingOperations;
    };

    // Inventory Transactions
    entity InventoryTransactions as projection on db.InventoryTransactions {
        *,
        storageFacility : redirected to StorageFacilities
    };

    // Read-only reference data
    @readonly entity FuelTypes as projection on db.FuelTypes where isActive = true;
    @readonly entity Airports as projection on db.Airports;
    @readonly entity Aircraft as projection on db.Aircraft where isActive = true;
    @readonly entity Suppliers as projection on db.Suppliers where isActive = true;
    @readonly entity SupplierContracts as projection on db.SupplierContracts where status = 'ACTIVE';
    @readonly entity StorageFacilities as projection on db.StorageFacilities where isOperational = true;

    // Complex functions
    function getAvailableFuel(airportId: UUID, fuelTypeId: UUID) returns Decimal;
    function getOptimalSupplier(airportId: UUID, fuelTypeId: UUID, volume: Decimal) returns SupplierRecommendation;
    function getFlightFuelCost(flightRequirementId: UUID) returns CostBreakdown;

    type SupplierRecommendation {
        supplierId      : UUID;
        supplierName    : String;
        contractId      : UUID;
        pricePerLiter   : Decimal;
        estimatedTotal  : Decimal;
        currency        : String;
    }

    type CostBreakdown {
        fuelCost        : Decimal;
        taxes           : Decimal;
        fees            : Decimal;
        totalCost       : Decimal;
        currency        : String;
    }

    // Actions for bulk operations
    action createFuelRequirementFromSchedule(scheduleData: array of FlightScheduleInput) returns array of FlightFuelRequirements;
    action optimizeDailyOrders(date: Date, airportId: UUID) returns array of FuelOrders;

    type FlightScheduleInput {
        flightNumber    : String;
        flightDate      : Date;
        aircraftReg     : String;
        departureIata   : String;
        arrivalIata     : String;
        requiredVolume  : Decimal;
    }
}
