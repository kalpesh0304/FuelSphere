# FuelSphere

FuelSphere is a comprehensive Airline Fuel Lifecycle Management Solution built on SAP Business Technology Platform (BTP). It delivers an end-to-end digital backbone for managing aviation fuel — from strategic planning and procurement through delivery operations and financial settlement. The solution eliminates manual processes and provides flight-level cost visibility.

## Architecture

This application is built using:
- **SAP Cloud Application Programming Model (CAP)** - Backend services
- **SAP HANA Cloud** - Database (production)
- **SQLite** - Database (local development)
- **SAP Fiori Elements** - User interface
- **SAP XSUAA** - Authentication and authorization

## Project Structure

```
FuelSphere/
├── db/                      # Database layer
│   ├── schema.cds           # Data model definitions
│   └── data/                # Sample/seed data (CSV)
├── srv/                     # Service layer
│   ├── admin-service.cds    # Admin service definitions
│   ├── operations-service.cds   # Operations service definitions
│   ├── operations-service.js    # Operations service implementation
│   └── analytics-service.cds    # Analytics service definitions
├── app/                     # UI layer
│   ├── fuelsphere/          # Fiori Elements application
│   └── router/              # App router configuration
├── mta.yaml                 # MTA deployment descriptor
├── xs-security.json         # XSUAA security configuration
└── package.json             # Project configuration
```

## Data Model

The solution manages the following core entities:

- **FuelTypes** - Aviation fuel specifications (Jet A-1, AVGAS, SAF, etc.)
- **Airports** - Airport master data with storage facilities
- **Suppliers** - Fuel supplier information and contracts
- **Aircraft** - Fleet information with fuel capacity
- **FlightFuelRequirements** - Fuel requirements per flight
- **FuelOrders** - Procurement orders
- **FuelDeliveries** - Delivery receipts
- **FuelingOperations** - Aircraft fueling operations
- **InventoryTransactions** - Inventory movements

## Services

### Admin Service (`/admin`)
Master data management for administrators:
- Fuel types, airports, suppliers, aircraft
- Contract management
- Audit log access

### Operations Service (`/operations`)
Day-to-day fuel operations:
- Flight fuel requirements
- Fuel ordering and delivery tracking
- Aircraft fueling operations
- Inventory management

### Analytics Service (`/analytics`)
Business intelligence and reporting:
- Fuel consumption analysis
- Cost trends and forecasting
- Supplier performance metrics
- Carbon emission tracking

## Getting Started

### Prerequisites

- Node.js >= 20
- SAP CAP CLI (`npm install -g @sap/cds-dk`)
- Cloud Foundry CLI (for deployment)

### Local Development

1. Install dependencies:
   ```bash
   npm install
   ```

2. Start the development server:
   ```bash
   cds watch
   ```

3. Access the services:
   - OData services: http://localhost:4004
   - Fiori UI: http://localhost:4004/fuelsphere/webapp/index.html

### Build for Production

```bash
npm run build
```

### Deploy to SAP BTP

1. Build the MTA archive:
   ```bash
   mbt build
   ```

2. Deploy to Cloud Foundry:
   ```bash
   cf deploy mta_archives/fuelsphere_1.0.0.mtar
   ```

## Security Roles

| Role | Description |
|------|-------------|
| Administrator | Full system access |
| OperationsManager | Manage orders and operations |
| OperationsStaff | Execute fueling operations |
| Analyst | View analytics and reports |
| Viewer | Read-only access |

## License

MIT License - see [LICENSE](LICENSE) for details.
