using { fuelsphere as db } from '../db/schema';

/**
 * Administrative Service for Master Data Management
 * Restricted to administrators and data stewards
 */
@path: '/admin'
@requires: 'admin'
service AdminService {

    // Fuel Type Management
    entity FuelTypes as projection on db.FuelTypes;

    // Airport Management
    entity Airports as projection on db.Airports {
        *,
        storageFacilities : redirected to StorageFacilities
    };

    // Storage Facility Management
    entity StorageFacilities as projection on db.StorageFacilities {
        *,
        airport : redirected to Airports,
        fuelType : redirected to FuelTypes
    };

    // Supplier Management
    entity Suppliers as projection on db.Suppliers {
        *,
        contracts : redirected to SupplierContracts
    };

    // Contract Management
    entity SupplierContracts as projection on db.SupplierContracts {
        *,
        supplier : redirected to Suppliers,
        fuelType : redirected to FuelTypes
    };

    // Aircraft Management
    entity Aircraft as projection on db.Aircraft {
        *,
        fuelType : redirected to FuelTypes
    };

    // Audit Log (read-only)
    @readonly
    entity AuditLog as projection on db.AuditLog;

    // Actions for bulk operations
    action importAirports(data: array of AirportData) returns array of String;
    action importSuppliers(data: array of SupplierData) returns array of String;
    action deactivateExpiredContracts() returns Integer;

    type AirportData {
        iataCode    : String(3);
        icaoCode    : String(4);
        name        : String(200);
        city        : String(100);
        country     : String(3);
    }

    type SupplierData {
        code        : String(20);
        name        : String(200);
        country     : String(3);
        contactEmail : String(255);
    }
}
