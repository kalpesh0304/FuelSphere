# S/4 mapping tables, and why they sit beside DESIGNATED_SUPPLIERS

**Decided 30 September 2026.** Read this before changing anything in
`db/mapping-tables.cds`, `srv/mapping-service.js`, or
`db/designated-suppliers.cds`.

---

## 1. What was built

Four tables, maintained by hand, read by the posting that turns a fuel ticket
into a purchase order, a goods receipt and an FI document in S/4 through the
S2A destination.

| Table | Answers | Key |
|---|---|---|
| `CARRIER_MASTER` | which company code a carrier posts under | `carrier_code` |
| `STATION_PLANT_MAP` | which plant a station is, for a carrier, on a date | airport + carrier + validity |
| `STATION_SUPPLIER_MAP` | given a supplier, which contract line to post against | airport + carrier + supplier + validity |
| `FLIGHT_SUPPLIER_MAP` | which supplier fuels a named flight out of a station | flight + airport + carrier + validity |

Plus `STATION_SUPPLIER_OPTIONS`, a view over `CONTRACT_LOCATIONS` that feeds
the value helps and the save-time check.

Service: `MappingService` at `/odata/v4/mappings`, all four draft-enabled, with
`postingData(ticketID)` returning everything the S/4 documents need for one
ticket.

---

## 2. The decision, and the alternative that was rejected

`DESIGNATED_SUPPLIERS` already held station-level and flight-level supplier
rows with carrier scope, validity, priority and an active flag — 228 rows, 149
flight-level and 79 station-level, across 77 stations. The obvious move was to
extend it with the two missing fields and build the apps over it.

**That was recommended first, then withdrawn, because the two tables answer
different questions.**

`DESIGNATED_SUPPLIERS` answers *"who should fuel this flight?"*. It resolves to
**one** winner: flight beats station, then priority. Two active rows for the
same flight at the same priority are a defect there — `FLIGHT_DESIGNATION`
exists to rank them.

`STATION_SUPPLIER_MAP` answers *"the ticket says World Fuel — which contract
line do I post that against?"*. Several rows for one station and carrier are
**correct**: one per supplier. The ticket names the supplier; the map supplies
the paperwork. Folding that into a table whose job is to pick a winner would
make correct data look like unresolved conflicts, both to the resolver and to
anyone reading the screen.

So: separate tables, decided by the business owner on 30 September 2026, with
the Flight Schedule screens left untouched.

---

## 3. The overlap that remains, and what guards it

`FLIGHT_SUPPLIER_MAP` **does** overlap the flight axis of
`DESIGNATED_SUPPLIERS`. Both answer "who fuels B102 out of JFK". This is known
and accepted, not an oversight.

The guard is **CAR405** in `srv/mapping-service.js`: saving a flight mapping
that names a different supplier from an active designation for the same flight,
station and carrier reports the disagreement. It does **not** block —
deviating is what a flight-level mapping is for — but the disagreement is
visible when it is created rather than six months later in a posting nobody can
explain.

**If the two are ever merged**, the work is:

1. Move `contract_line_item` onto `DESIGNATED_SUPPLIERS`, and decide what a
   second supplier at one station means there (today: a priority conflict).
2. Migrate `STATION_SUPPLIER_MAP` and `FLIGHT_SUPPLIER_MAP` rows in.
3. Repoint `postingData` in `srv/mapping-service.js`.
4. Leave `FLIGHT_DESIGNATION`, `FLIGHT_CONTACTS` and the two Flight Schedule
   sections alone — they already read the designation table.

---

## 4. Rules, and why each exists

Error codes use the `CAR4xx` prefix, reserved in `05-CONVENTIONS.md` for
carrier arrangement resolution and unused before this.

| Code | Rule | Hard? |
|---|---|---|
| `CAR401` | the contract must belong to the chosen supplier, and be active | **reject** — wrong in every state of the data |
| `CAR402` | no two overlapping rows for one station + carrier + supplier | **reject** — two answers to one question |
| `CAR403` | no two overlapping plant mappings for one station + carrier | **reject** — the plant would be a coin toss |
| `CAR404` | no two overlapping rows for one flight + station + carrier | **reject** |
| `CAR405` | flight mapping disagrees with the flight schedule's designation | message |
| `CAR406` | valid-to before valid-from | **reject** |
| `CAR407` | supplier has no S/4 vendor number | message |
| `CAR408` | `postingData` called with an unknown ticket | **reject** |
| `CAR409` | the contract does not list that station among its locations | message |
| `CAR410` | a flight names a supplier the station is not mapped to | **reject** |

**There is no serial number on `STATION_SUPPLIER_MAP`.** The sheet had one; it
was doing nothing, because the supplier already discriminates the rows. What
the sheet was reaching for — "you cannot enter this twice" — is CAR402, a rule
rather than a column. An expired row does not block a new one.

---

## 5. Which list each app offers, and why they differ

The two supplier apps have different jobs, so they show different lists. This
was got wrong first time and corrected on 30 September 2026.

**Station-Supplier app — every supplier.** This screen is where somebody
*declares* that a supplier, on a contract, serves a station. Filtering it by
suppliers that already serve the station makes the screen its own
prerequisite: a contract signed this morning could never be mapped, because it
is not yet mapped. The contract field is then filtered by the supplier chosen
(`SupplierContracts`), so a brand-new contract is selectable the moment it
exists — `station_count` shows how many airports it lists, zero included.

**Flight-Supplier app — only what the station has.** A flight mapping is an
*exception* to a station's arrangement, and it names a supplier and nothing
else. The contract and line item it will post on live on the station mapping,
so the supplier list is `StationSuppliers`, filtered by the airport and carrier
on the row. CAR410 refuses a supplier the station has not been mapped to,
because the posting would have no contract line to use.

**The airport list is unfiltered on both.** Asked for explicitly: mappings are
master data maintained before a schedule is loaded, so narrowing to airports
already in `FLIGHT_SCHEDULE` would refuse good rows.

**The order the two apps are used in** is therefore: carrier → station-plant →
station-supplier → flight-supplier. Only the last one depends on another.

---

## 6. How the posting resolves one ticket

`postingData(ticketID)`, in `srv/mapping-service.js`:

| what | from |
|---|---|
| station | the flight's origin airport, else the order's station code |
| carrier | the flight's `airline_code` |
| company code | `CARRIER_MASTER` |
| plant | `STATION_PLANT_MAP` for station + carrier, valid on the delivery date |
| supplier | the **order's** supplier if the ticket has an order; else `FLIGHT_SUPPLIER_MAP`; else `STATION_SUPPLIER_MAP` **only when it maps exactly one supplier** |
| contract + line item | `STATION_SUPPLIER_MAP` for that supplier |
| quantity, amount | the ticket |

**Nothing throws.** The uplift is already recorded by the time this is asked; a
missing mapping is returned in `gaps` and the caller decides whether to post or
raise an exception. `supplier_source` says which of the three paths answered.

The S/4 field names are not in this yet — the API was not published when this
was built. The caller maps these onto it.

---

## 7. What is not done

- **AC is not in the carrier master.** `DESIGNATED_SUPPLIERS` carries `AC` on
  some rows and its company code was never supplied. An AC ticket will report
  a gap until somebody adds it.
- **No S/4 call exists.** `postingData` assembles the data; nothing sends it.
- **The mapping tables are empty** apart from the two seeded carriers (B6/B600,
  B7/B601, from the sheet).
