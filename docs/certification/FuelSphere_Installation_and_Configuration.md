# FuelSphere — installation and configuration guide

**Version 1.0.0 · SAP BTP, Cloud Foundry environment · draft for SAP ICC (Cert ID 26150)**

Steps marked **⚠** do not work as written today. See `FuelSphere_Certification_Readiness_Gaps.md`.

## 1. Prerequisites

| Item | Requirement |
|---|---|
| SAP BTP | Non-trial global account and subaccount with Cloud Foundry enabled, plus a space |
| Entitlements | SAP HANA Cloud (`hana-cloud` + `hana` / `hdi-shared`), Authorization & Trust Management (`xsuaa` / `application`), Destination (`lite`), Connectivity (`lite`), Application Logging (`lite`) |
| SAP HANA Cloud | A running HANA Cloud database instance mapped to the subaccount or space |
| Identity | SAP Cloud Identity Services – Identity Authentication tenant, trusted by the subaccount |
| SAP S/4HANA Cloud Public Edition | Tenant with a communication system, a communication user, and communication arrangements for the scenarios in the supplementary TPP |
| Tools | Node.js 22, `@sap/cds-dk` 8, Cloud MTA Build Tool (`mbt`), Cloud Foundry CLI with the MultiApps plugin |

## 2. Build

```bash
git clone https://github.com/kalpesh0304/FuelSphere && cd FuelSphere
npm install
npm run build          # cds build --production → gen/srv, gen/db
mbt build              # → mta_archives/fuelsphere_1.0.0.mtar
```

## 3. Deploy

```bash
cf login -a https://api.cf.<region>.hana.ondemand.com
cf deploy mta_archives/fuelsphere_1.0.0.mtar
```

The MTA (`mta.yaml`) creates these service instances:

| Instance | Service / plan | Bound to |
|---|---|---|
| `fuelsphere-db` | hana / hdi-shared | srv, db-deployer |
| `fuelsphere-auth` | xsuaa / application (uses `xs-security.json`) | approuter, srv |
| `fuelsphere-destination` | destination / lite | srv |
| `fuelsphere-connectivity` | connectivity / lite | srv |
| `fuelsphere-logging` | application-logs / lite | srv |

It also deploys three apps:

- `fuelsphere-approuter`: the Application Router, and the entry URL.
- `fuelsphere-srv`: the CAP OData V4 service.
- `fuelsphere-db-deployer`: creates the HANA schema and loads the seed data, then stops.

Check with `cf apps` and `cf services`.

## 4. Configure

### 4.1 Trust and users
1. In the BTP cockpit, go to **Security › Trust Configuration** and establish trust with the Identity Authentication tenant.
2. Assign role collections to users or IAS groups:

| Role collection | For |
|---|---|
| FuelSphere_FuelPlanner | Fuel planner |
| FuelSphere_DispatchTeam | Flight dispatch |
| FuelSphere_CockpitCrew | Pilots |
| FuelSphere_StationCoordinator | Station |
| FuelSphere_OperationsManager | Operations manager |
| FuelSphere_FulfillmentCrew | Into-plane crew |
| FuelSphere_SupplierPlanner | Fuel supplier |
| FuelSphere_ProcurementSpecialist | Procurement |
| FuelSphere_FinanceController | Finance |
| FuelSphere_MasterDataManager | Master data |
| FuelSphere_IntegrationAdmin | Integration monitoring, S/4 sync |
| FuelSphere_SystemAdmin | Administrator |
| FuelSphere_Viewer | Read only |

### 4.2 Connect SAP S/4HANA Cloud
1. In S/4HANA, create a communication system with inbound OAuth 2.0 client credentials and a communication user.
2. Create a communication arrangement for each scenario listed in the supplementary TPP.
3. In the BTP cockpit, open **Connectivity › Destinations › `S4HC_TECHNICAL`** and add:
   - the URL `https://<tenant>-api.s4hana.cloud.sap`
   - the token service URL, client ID and client secret
   - the AIR key header
4. **⚠** The code currently looks for a destination named `S2A` (`package.json`). Until gap A4 is fixed, either create a destination named `S2A` with the same settings, or apply the one-line fix.

### 4.3 First data load
Run the sync as a user holding `IntegrationMonitor` or `AdminAccess`, **in this order**:

```
POST /odata/v4/master/syncFromS4HANA  { "entityType": "Countries" }
POST ...                                    { "entityType": "Plants" }
POST ...                                    { "entityType": "Suppliers" }
POST ...                                    { "entityType": "Contracts" }   ← always after Suppliers
```

Each call returns `success`, `recordsSync` and `errors`. A response with zero records aborts without deleting existing data.

## 5. Verify
- Open the Application Router URL. You are redirected to the IAS login, and the launchpad or apps load.
- `GET /odata/v4/orders/$metadata` returns 200 when called with a token.
- Check the logs: `cf logs fuelsphere-srv --recent`, or open **Logs** in the BTP cockpit.

## 6. Update
Rebuild and run `cf deploy` with the new `.mtar`. The HDI deployer applies schema changes in place, and existing data is kept.

## 7. Troubleshooting (outline for the administration guide)

| Symptom | Check |
|---|---|
| Sync returns `success: false` with a connection error | Destination URL and credentials, the communication arrangement is active, the AIR key header |
| Sync returns "S4 returned 0 records" | API authorisation of the communication user, the filter in `srv/config/s4-sync-config.js` |
| 403 on an action | The user's role collection. See the scopes in `xs-security.json` |
| App loads but tables are empty | Token forwarding (`forwardAuthToken`), then `cf logs fuelsphere-srv` |
