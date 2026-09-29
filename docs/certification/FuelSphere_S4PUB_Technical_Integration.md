# FuelSphere — technical integration with SAP S/4HANA Cloud Public Edition

**Supporting document to the BTP-EXT-S/4PUB supplementary TPP · Cert ID 26150 · measured against `main` at `6189e0b`**

## 1. Principles
- FuelSphere runs on SAP BTP. S/4HANA Cloud is reached **only through SAP released APIs** from the SAP Business Accelerator Hub.
- **No developer extensibility.** Nothing is created inside S/4HANA: no custom CDS views, no custom APIs, no ABAP.
- Connection details sit in the BTP Destination service. The code carries no URLs and no credentials.
- The authentication is OAuth 2.0 client credentials for a communication user (a technical user, no user present).

## 2. Read integration — implemented

**Code:** `srv/master-data-service.js` (`syncFromS4HANA` and `_syncFromS4`) and `srv/config/s4-sync-config.js`.
**Protocol:** HTTPS, OData V2, through CAP remote service `odata_api` (`kind: odata-v2`, CSRF on).

| Entity in FuelSphere | Released API · entity set | Key | Scenario |
|---|---|---|---|
| `T005_COUNTRY` | API_COUNTRY_SRV · A_CountryText (+ `to_Country`), language EN | `land1` | *verify on the Hub* |
| `T001W_PLANT` | API_PLANT_SRV · A_Plant | `werks` | **⚠ verify that it is released** (the code comment calls it custom) |
| `MASTER_SUPPLIERS` | API_BUSINESS_PARTNER · A_BusinessPartner | business partner | SAP_COM_0008 |
| `MASTER_CONTRACTS` | API_PURCHASECONTRACT_PROCESS_SRV · A_PurchaseContract | contract number | *verify on the Hub* |

The two pending entries (`API_CURRENCY_SRV` and `API_UNITOFMEASURE_SRV`) are commented out in the config.

**Flow:**
1. A user with `IntegrationMonitor` or `AdminAccess` calls `syncFromS4HANA(entityType)`.
2. CAP resolves the destination and runs a `GET` on the API path.
3. The service unwraps the `d.results` response.
4. If S/4 returns zero rows, the sync aborts so no data is wiped.
5. Otherwise it resolves references (e.g. contract → supplier UUID), maps the fields and replaces the table in the request's transaction.
6. It returns `{ success, recordsSync, errors, syncTime }` and logs each step through `cds.log('MasterDataService')`.

**Ordering constraint:** Suppliers is a full replace with generated keys, so **Contracts must be re-synced after every Suppliers sync**.

## 3. Post integration — in certification scope, not yet built

| Business event in FuelSphere | S/4HANA object | Candidate released API |
|---|---|---|
| Fuel order confirmed | Purchase order | API_PURCHASEORDER_PROCESS_SRV |
| Delivery signed at the aircraft (`captureSignatures`) | Goods receipt | API_MATERIAL_DOCUMENT_SRV |
| Invoice passes the FuelSphere readiness gate | Supplier invoice. S/4 performs the three-way match at posting | Supplier invoice API (to be selected) |
| Flight cost allocation | Journal entry | Journal entry API (to be selected) |

**Today** `captureSignatures` generates *random* PO and GR numbers (`srv/order-service.js:1202-1206`). No posting happens. See gap A2.

**Target design:** CAP raises the business event, and a Cloud Integration iFlow maps it and calls the released API with the AIR key header. The resulting document number is written back to FuelSphere through its OData V4 service. Errors go to FuelSphere's exception queue and the iFlow's message monitor.

## 4. Destinations

| Name | Authentication | Used by |
|---|---|---|
| S4HC_TECHNICAL | OAuth2ClientCredentials | *intended* for all reads and posts |
| S4HC_USER | OAuth2SAMLBearerAssertion | not used. Reserved for when user-level S/4 authorisation is needed |
| S2A | — | **⚠ what the code uses today, and not provisioned by the MTA** (gap A4) |

## 5. AIR key
**Not implemented yet** (gap A1). Target: the key is stored in the destination and sent as a request header, named exactly as in SAP's AIR Adoption Guide, on every S/4 call. That covers the CAP remote service and every iFlow receiver channel.

## 6. Error handling

| Situation | Behaviour |
|---|---|
| Unknown `entityType` | 400, listing the supported types |
| Destination unreachable or HTTP error | `success: false`, error text returned and logged, no data changed |
| S/4 returns 0 rows | `success: false`, "sync aborted to prevent data loss" |
| Unexpected response shape | ⚠ logged raw and treated as 0 rows (D20). Indistinguishable from an empty source |
| Mapping or insert failure | `req.error(500)`, and CAP rolls the request transaction back |

## 7. Testing
- The automated harnesses in `test/harness` (mocha + `cds.test`) cover the FuelSphere side, with S/4 mocked.
- Integration test script for ICC: BTP-APP TPP, test case 2 (master data sync) and error case 4 (S/4 unavailable).
- ⚠ No automated test runs against a live S/4 tenant yet (gap C8).
