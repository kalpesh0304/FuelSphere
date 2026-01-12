namespace fuelsphere;

using { cuid, managed, Currency, Country } from '@sap/cds/common';

/**
 * Master Data: Fuel Types
 */
entity FuelTypes : cuid, managed {
    code            : String(10) @mandatory;
    name            : String(100) @mandatory;
    description     : String(500);
    density         : Decimal(10, 4);  // kg/liter
    specificEnergy  : Decimal(10, 2);  // MJ/kg
    carbonFactor    : Decimal(10, 4);  // kg CO2/kg fuel
    isActive        : Boolean default true;
}

/**
 * Master Data: Airports/Locations
 */
entity Airports : cuid, managed {
    iataCode        : String(3) @mandatory;
    icaoCode        : String(4);
    name            : String(200) @mandatory;
    city            : String(100);
    country         : Country;
    latitude        : Decimal(10, 6);
    longitude       : Decimal(10, 6);
    timezone        : String(50);
    storageFacilities : Association to many StorageFacilities on storageFacilities.airport = $self;
}

/**
 * Master Data: Storage Facilities
 */
entity StorageFacilities : cuid, managed {
    code            : String(20) @mandatory;
    name            : String(200) @mandatory;
    airport         : Association to Airports @mandatory;
    fuelType        : Association to FuelTypes @mandatory;
    capacity        : Decimal(15, 2);  // liters
    currentLevel    : Decimal(15, 2);  // liters
    minLevel        : Decimal(15, 2);  // minimum threshold
    isOperational   : Boolean default true;
}

/**
 * Master Data: Suppliers
 */
entity Suppliers : cuid, managed {
    code            : String(20) @mandatory;
    name            : String(200) @mandatory;
    country         : Country;
    contactEmail    : String(255);
    contactPhone    : String(50);
    isActive        : Boolean default true;
    contracts       : Association to many SupplierContracts on contracts.supplier = $self;
}

/**
 * Supplier Contracts
 */
entity SupplierContracts : cuid, managed {
    contractNumber  : String(50) @mandatory;
    supplier        : Association to Suppliers @mandatory;
    fuelType        : Association to FuelTypes @mandatory;
    validFrom       : Date @mandatory;
    validTo         : Date @mandatory;
    pricePerLiter   : Decimal(10, 4);
    currency        : Currency;
    minVolume       : Decimal(15, 2);  // minimum order volume
    maxVolume       : Decimal(15, 2);  // maximum order volume
    status          : String(20) default 'ACTIVE'; // ACTIVE, EXPIRED, SUSPENDED
}

/**
 * Master Data: Aircraft
 */
entity Aircraft : cuid, managed {
    registration    : String(20) @mandatory;
    aircraftType    : String(50) @mandatory;
    operator        : String(100);
    fuelCapacity    : Decimal(15, 2);  // liters
    fuelType        : Association to FuelTypes;
    isActive        : Boolean default true;
}

/**
 * Flight Fuel Requirements
 */
entity FlightFuelRequirements : cuid, managed {
    flightNumber    : String(20) @mandatory;
    flightDate      : Date @mandatory;
    aircraft        : Association to Aircraft;
    departureAirport : Association to Airports @mandatory;
    arrivalAirport  : Association to Airports @mandatory;
    fuelType        : Association to FuelTypes @mandatory;
    requiredVolume  : Decimal(15, 2) @mandatory;  // liters
    estimatedCost   : Decimal(15, 2);
    currency        : Currency;
    status          : String(20) default 'PLANNED'; // PLANNED, CONFIRMED, FUELED, DEPARTED
    fuelOrders      : Association to many FuelOrders on fuelOrders.flightRequirement = $self;
}

/**
 * Fuel Orders
 */
entity FuelOrders : cuid, managed {
    orderNumber     : String(50) @mandatory;
    flightRequirement : Association to FlightFuelRequirements;
    supplier        : Association to Suppliers @mandatory;
    contract        : Association to SupplierContracts;
    fuelType        : Association to FuelTypes @mandatory;
    airport         : Association to Airports @mandatory;
    orderedVolume   : Decimal(15, 2) @mandatory;
    deliveredVolume : Decimal(15, 2);
    unitPrice       : Decimal(10, 4);
    totalAmount     : Decimal(15, 2);
    currency        : Currency;
    orderDate       : DateTime @mandatory;
    requestedDeliveryDate : DateTime;
    actualDeliveryDate : DateTime;
    status          : String(20) default 'PENDING'; // PENDING, CONFIRMED, DELIVERED, CANCELLED
    deliveries      : Association to many FuelDeliveries on deliveries.order = $self;
}

/**
 * Fuel Deliveries
 */
entity FuelDeliveries : cuid, managed {
    deliveryNumber  : String(50) @mandatory;
    order           : Association to FuelOrders @mandatory;
    storageFacility : Association to StorageFacilities;
    deliveredVolume : Decimal(15, 2) @mandatory;
    temperature     : Decimal(5, 2);  // Celsius
    density         : Decimal(10, 4);
    deliveryDate    : DateTime @mandatory;
    receivedBy      : String(100);
    qualityChecked  : Boolean default false;
    remarks         : String(1000);
}

/**
 * Aircraft Fueling Operations
 */
entity FuelingOperations : cuid, managed {
    operationNumber : String(50) @mandatory;
    flightRequirement : Association to FlightFuelRequirements;
    aircraft        : Association to Aircraft @mandatory;
    airport         : Association to Airports @mandatory;
    storageFacility : Association to StorageFacilities;
    fuelType        : Association to FuelTypes @mandatory;
    volumeDispensed : Decimal(15, 2) @mandatory;
    startTime       : DateTime @mandatory;
    endTime         : DateTime;
    operatorName    : String(100);
    vehicleId       : String(50);
    status          : String(20) default 'IN_PROGRESS'; // IN_PROGRESS, COMPLETED, ABORTED
}

/**
 * Fuel Inventory Transactions
 */
entity InventoryTransactions : cuid, managed {
    transactionNumber : String(50) @mandatory;
    storageFacility : Association to StorageFacilities @mandatory;
    transactionType : String(20) @mandatory; // RECEIPT, DISPENSE, ADJUSTMENT, TRANSFER
    volume          : Decimal(15, 2) @mandatory;  // positive for receipt, negative for dispense
    balanceBefore   : Decimal(15, 2);
    balanceAfter    : Decimal(15, 2);
    referenceDoc    : String(100);  // delivery number or fueling operation number
    transactionDate : DateTime @mandatory;
    remarks         : String(500);
}

/**
 * Fuel Price History
 */
entity FuelPriceHistory : cuid, managed {
    airport         : Association to Airports @mandatory;
    fuelType        : Association to FuelTypes @mandatory;
    supplier        : Association to Suppliers;
    effectiveDate   : Date @mandatory;
    pricePerLiter   : Decimal(10, 4) @mandatory;
    currency        : Currency;
    source          : String(50);  // CONTRACT, SPOT, MARKET
}

/**
 * Audit Log for compliance tracking
 */
entity AuditLog : cuid {
    entityName      : String(100) @mandatory;
    entityId        : String(36) @mandatory;
    action          : String(20) @mandatory;  // CREATE, UPDATE, DELETE
    changedBy       : String(255);
    changedAt       : DateTime @mandatory;
    oldValues       : LargeString;
    newValues       : LargeString;
}
