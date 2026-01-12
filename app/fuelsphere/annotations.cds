using OperationsService as service from '../../srv/operations-service';

/**
 * Annotations for Fuel Orders
 */
annotate service.FuelOrders with @(
    UI: {
        HeaderInfo: {
            TypeName: 'Fuel Order',
            TypeNamePlural: 'Fuel Orders',
            Title: { Value: orderNumber },
            Description: { Value: status }
        },
        SelectionFields: [
            status,
            airport_ID,
            supplier_ID,
            fuelType_ID,
            orderDate
        ],
        LineItem: [
            { Value: orderNumber, Label: 'Order Number' },
            { Value: supplier.name, Label: 'Supplier' },
            { Value: airport.iataCode, Label: 'Airport' },
            { Value: fuelType.name, Label: 'Fuel Type' },
            { Value: orderedVolume, Label: 'Ordered (L)' },
            { Value: deliveredVolume, Label: 'Delivered (L)' },
            { Value: totalAmount, Label: 'Total Amount' },
            { Value: status, Label: 'Status', Criticality: statusCriticality },
            { Value: orderDate, Label: 'Order Date' }
        ],
        Facets: [
            {
                $Type: 'UI.ReferenceFacet',
                ID: 'GeneralInfo',
                Label: 'General Information',
                Target: '@UI.FieldGroup#GeneralInfo'
            },
            {
                $Type: 'UI.ReferenceFacet',
                ID: 'VolumeAndPricing',
                Label: 'Volume & Pricing',
                Target: '@UI.FieldGroup#VolumeAndPricing'
            },
            {
                $Type: 'UI.ReferenceFacet',
                ID: 'Dates',
                Label: 'Dates',
                Target: '@UI.FieldGroup#Dates'
            },
            {
                $Type: 'UI.ReferenceFacet',
                ID: 'Deliveries',
                Label: 'Deliveries',
                Target: 'deliveries/@UI.LineItem'
            }
        ],
        FieldGroup#GeneralInfo: {
            Data: [
                { Value: orderNumber },
                { Value: supplier_ID },
                { Value: contract_ID },
                { Value: airport_ID },
                { Value: fuelType_ID },
                { Value: flightRequirement_ID },
                { Value: status }
            ]
        },
        FieldGroup#VolumeAndPricing: {
            Data: [
                { Value: orderedVolume },
                { Value: deliveredVolume },
                { Value: unitPrice },
                { Value: totalAmount },
                { Value: currency_code }
            ]
        },
        FieldGroup#Dates: {
            Data: [
                { Value: orderDate },
                { Value: requestedDeliveryDate },
                { Value: actualDeliveryDate }
            ]
        }
    }
) {
    // Virtual field for status criticality
    statusCriticality: Integer @UI.Hidden;
};

/**
 * Annotations for Fuel Deliveries
 */
annotate service.FuelDeliveries with @(
    UI: {
        HeaderInfo: {
            TypeName: 'Delivery',
            TypeNamePlural: 'Deliveries',
            Title: { Value: deliveryNumber }
        },
        LineItem: [
            { Value: deliveryNumber, Label: 'Delivery Number' },
            { Value: deliveredVolume, Label: 'Volume (L)' },
            { Value: temperature, Label: 'Temperature (C)' },
            { Value: density, Label: 'Density' },
            { Value: deliveryDate, Label: 'Delivery Date' },
            { Value: qualityChecked, Label: 'QC Passed' }
        ]
    }
);

/**
 * Annotations for Flight Fuel Requirements
 */
annotate service.FlightFuelRequirements with @(
    UI: {
        HeaderInfo: {
            TypeName: 'Flight Fuel Requirement',
            TypeNamePlural: 'Flight Fuel Requirements',
            Title: { Value: flightNumber },
            Description: { Value: flightDate }
        },
        SelectionFields: [
            status,
            flightDate,
            departureAirport_ID,
            arrivalAirport_ID
        ],
        LineItem: [
            { Value: flightNumber, Label: 'Flight' },
            { Value: flightDate, Label: 'Date' },
            { Value: aircraft.registration, Label: 'Aircraft' },
            { Value: departureAirport.iataCode, Label: 'From' },
            { Value: arrivalAirport.iataCode, Label: 'To' },
            { Value: fuelType.name, Label: 'Fuel Type' },
            { Value: requiredVolume, Label: 'Required (L)' },
            { Value: estimatedCost, Label: 'Est. Cost' },
            { Value: status, Label: 'Status' }
        ],
        Facets: [
            {
                $Type: 'UI.ReferenceFacet',
                ID: 'FlightInfo',
                Label: 'Flight Information',
                Target: '@UI.FieldGroup#FlightInfo'
            },
            {
                $Type: 'UI.ReferenceFacet',
                ID: 'FuelInfo',
                Label: 'Fuel Requirements',
                Target: '@UI.FieldGroup#FuelInfo'
            },
            {
                $Type: 'UI.ReferenceFacet',
                ID: 'Orders',
                Label: 'Fuel Orders',
                Target: 'fuelOrders/@UI.LineItem'
            }
        ],
        FieldGroup#FlightInfo: {
            Data: [
                { Value: flightNumber },
                { Value: flightDate },
                { Value: aircraft_ID },
                { Value: departureAirport_ID },
                { Value: arrivalAirport_ID },
                { Value: status }
            ]
        },
        FieldGroup#FuelInfo: {
            Data: [
                { Value: fuelType_ID },
                { Value: requiredVolume },
                { Value: estimatedCost },
                { Value: currency_code }
            ]
        }
    }
);

/**
 * Annotations for Fueling Operations
 */
annotate service.FuelingOperations with @(
    UI: {
        HeaderInfo: {
            TypeName: 'Fueling Operation',
            TypeNamePlural: 'Fueling Operations',
            Title: { Value: operationNumber },
            Description: { Value: status }
        },
        SelectionFields: [
            status,
            airport_ID,
            startTime
        ],
        LineItem: [
            { Value: operationNumber, Label: 'Operation #' },
            { Value: aircraft.registration, Label: 'Aircraft' },
            { Value: airport.iataCode, Label: 'Airport' },
            { Value: fuelType.name, Label: 'Fuel Type' },
            { Value: volumeDispensed, Label: 'Volume (L)' },
            { Value: startTime, Label: 'Start' },
            { Value: endTime, Label: 'End' },
            { Value: status, Label: 'Status' }
        ],
        Facets: [
            {
                $Type: 'UI.ReferenceFacet',
                ID: 'OperationDetails',
                Label: 'Operation Details',
                Target: '@UI.FieldGroup#OperationDetails'
            },
            {
                $Type: 'UI.ReferenceFacet',
                ID: 'Timing',
                Label: 'Timing',
                Target: '@UI.FieldGroup#Timing'
            }
        ],
        FieldGroup#OperationDetails: {
            Data: [
                { Value: operationNumber },
                { Value: aircraft_ID },
                { Value: airport_ID },
                { Value: storageFacility_ID },
                { Value: fuelType_ID },
                { Value: volumeDispensed },
                { Value: operatorName },
                { Value: vehicleId },
                { Value: status }
            ]
        },
        FieldGroup#Timing: {
            Data: [
                { Value: startTime },
                { Value: endTime }
            ]
        }
    }
);

/**
 * Value Help annotations
 */
annotate service.FuelOrders with {
    supplier @(
        Common: {
            Text: supplier.name,
            TextArrangement: #TextFirst,
            ValueList: {
                Label: 'Suppliers',
                CollectionPath: 'Suppliers',
                Parameters: [
                    { $Type: 'Common.ValueListParameterInOut', LocalDataProperty: supplier_ID, ValueListProperty: 'ID' },
                    { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'name' },
                    { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'code' }
                ]
            }
        }
    );
    airport @(
        Common: {
            Text: airport.iataCode,
            TextArrangement: #TextFirst,
            ValueList: {
                Label: 'Airports',
                CollectionPath: 'Airports',
                Parameters: [
                    { $Type: 'Common.ValueListParameterInOut', LocalDataProperty: airport_ID, ValueListProperty: 'ID' },
                    { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'iataCode' },
                    { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'name' }
                ]
            }
        }
    );
    fuelType @(
        Common: {
            Text: fuelType.name,
            TextArrangement: #TextFirst,
            ValueList: {
                Label: 'Fuel Types',
                CollectionPath: 'FuelTypes',
                Parameters: [
                    { $Type: 'Common.ValueListParameterInOut', LocalDataProperty: fuelType_ID, ValueListProperty: 'ID' },
                    { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'name' },
                    { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'code' }
                ]
            }
        }
    );
};
