using { fuelsphere as db } from '../db/schema';

/**
 * Analytics Service for Reporting and Dashboards
 * Provides aggregated views for business intelligence
 */
@path: '/analytics'
@requires: 'authenticated-user'
@readonly
service AnalyticsService {

    // Price History for trend analysis
    entity FuelPriceHistory as projection on db.FuelPriceHistory {
        *,
        airport : redirected to Airports,
        fuelType : redirected to FuelTypes,
        supplier : redirected to Suppliers
    };

    // Reference data for filtering
    entity Airports as projection on db.Airports;
    entity FuelTypes as projection on db.FuelTypes;
    entity Suppliers as projection on db.Suppliers;

    // Analytical Views
    @cds.persistence.skip
    entity FuelConsumptionByAirport {
        key airportId       : UUID;
        airportName         : String;
        iataCode            : String;
        fuelTypeId          : UUID;
        fuelTypeName        : String;
        period              : String;  // YYYY-MM
        totalVolume         : Decimal;
        totalCost           : Decimal;
        avgPricePerLiter    : Decimal;
        numberOfFlights     : Integer;
        currency            : String;
    }

    @cds.persistence.skip
    entity FuelCostBySupplier {
        key supplierId      : UUID;
        supplierName        : String;
        period              : String;
        totalVolume         : Decimal;
        totalCost           : Decimal;
        avgPricePerLiter    : Decimal;
        orderCount          : Integer;
        onTimeDeliveryRate  : Decimal;
        currency            : String;
    }

    @cds.persistence.skip
    entity InventoryStatus {
        key facilityId      : UUID;
        facilityCode        : String;
        facilityName        : String;
        airportIata         : String;
        fuelTypeName        : String;
        capacity            : Decimal;
        currentLevel        : Decimal;
        utilizationPercent  : Decimal;
        daysToEmpty         : Integer;
        status              : String;  // CRITICAL, LOW, NORMAL, HIGH
    }

    @cds.persistence.skip
    entity DailyOperationsSummary {
        key date            : Date;
        key airportId       : UUID;
        airportIata         : String;
        totalFlightsFueled  : Integer;
        totalVolumeDispensed : Decimal;
        totalDeliveriesReceived : Integer;
        totalVolumeReceived : Decimal;
        avgFuelingTime      : Integer;  // minutes
    }

    @cds.persistence.skip
    entity CarbonEmissions {
        key period          : String;
        key airportId       : UUID;
        airportName         : String;
        totalFuelVolume     : Decimal;
        totalCO2Emissions   : Decimal;  // kg
        avgCO2PerFlight     : Decimal;
        safUsagePercent     : Decimal;  // Sustainable Aviation Fuel
    }

    // Functions for custom analytics
    function getFuelCostTrend(
        airportId: UUID,
        fuelTypeId: UUID,
        fromDate: Date,
        toDate: Date
    ) returns array of PriceTrendPoint;

    function getConsumptionForecast(
        airportId: UUID,
        fuelTypeId: UUID,
        days: Integer
    ) returns array of ForecastPoint;

    function getSupplierPerformance(
        supplierId: UUID,
        fromDate: Date,
        toDate: Date
    ) returns SupplierPerformanceMetrics;

    function getDashboardKPIs(airportId: UUID) returns DashboardKPIs;

    // Types for analytics results
    type PriceTrendPoint {
        date            : Date;
        avgPrice        : Decimal;
        minPrice        : Decimal;
        maxPrice        : Decimal;
        volume          : Decimal;
    }

    type ForecastPoint {
        date            : Date;
        forecastVolume  : Decimal;
        confidenceLow   : Decimal;
        confidenceHigh  : Decimal;
    }

    type SupplierPerformanceMetrics {
        supplierId          : UUID;
        supplierName        : String;
        totalOrders         : Integer;
        totalVolume         : Decimal;
        avgDeliveryTime     : Decimal;  // hours
        onTimeDeliveryRate  : Decimal;
        qualityIssueRate    : Decimal;
        avgPrice            : Decimal;
        priceCompetitiveness : String;  // BELOW_MARKET, AT_MARKET, ABOVE_MARKET
    }

    type DashboardKPIs {
        currentInventoryLevel : Decimal;
        todayFuelingOps     : Integer;
        todayDeliveries     : Integer;
        pendingOrders       : Integer;
        avgCostPerLiter     : Decimal;
        monthToDateVolume   : Decimal;
        monthToDateCost     : Decimal;
        lowInventoryAlerts  : Integer;
    }
}
