# Document Capture and OCR — Specification

**FuelSphere · the evidence layer**
`docs/design/Document_Capture_Specification.md`
24 August 2026

---

## 1. What this is for

**Five** points in the fuel lifecycle where **a number is written on paper or shown on a dial**, and somebody has to get it into the system.

| | Instrument | Owner | Yields |
|---|---|---|---|
| **Tech log** | The aircraft's record | Airline | **Flight closure time** · uplift as recorded · defects |
| **Cockpit gauge, before** | FQIS | Airline | Fuel on board before refuelling |
| **Cockpit gauge, after** | FQIS | Airline | Fuel on board after refuelling |
| **Fuel ticket** | The supplier's document | Supplier | Ticket number · quantity · density · signature |
| **Bowser meter** | The supplier's instrument | Supplier | Meter start and end |

**One mobile device does all five.** Photograph, OCR, confirm on screen.

### The principle the whole design rests on

**The image is retained whether OCR succeeded or not.**

It is not a convenience. **It is the compliance record** — so the number and its evidence arrive together, and a disputed figure has a picture behind it eighteen months later.

---

## 2. The entity

`SOURCE_DOCUMENTS` — new, and nothing like it exists today.

```cds
entity SOURCE_DOCUMENTS : cuid, AuditTrail {
  document_type    : DocumentType   @mandatory;
  image_uri        : String(500)    @mandatory;
  image_hash       : String(64);
  capture_method   : CaptureMethod  @mandatory;
  captured_by      : String(50)     @mandatory;
  captured_at      : Timestamp      @mandatory;
  capture_station  : String(3);

  ocr_status       : OcrStatus      @mandatory;
  ocr_confidence   : Decimal(5,2);
  ocr_engine       : String(50);
  ocr_raw          : LargeString;

  confirmed_by     : String(50);
  confirmed_at     : Timestamp;

  capture_location : String(100);   // from signature_location
}
```

**`SOURCE_DOCUMENTS` HOLDS NO LINK BACK TO ITS SUBJECT.** A document is reached **only** through the field that cites it — `closure_document`, `gauge_before_document`, `ticket_document` and their siblings.

> **CORRECTED 24 August.** An earlier draft declared `flight`, `delivery` and `ticket` associations here **as well as** the parent-side fields. **That models one relationship twice, and two links can disagree** — with nothing saying which wins. Section 4's rule already settles it: the reference lives on the parent field, beside the value it evidences.
>
> **The cost is retrieval.** *"Every image for this delivery"* becomes a read of that delivery's own two document fields rather than a filter on `SOURCE_DOCUMENTS`. **At most two per entity**, so the cost is small and the ambiguity is gone.
>
> **The consequence to watch:** a document row exists briefly before the parent field is set. **Write both in one transaction**, or an unreferenced document is a photograph nobody can find.

### Enumerations

| Type | Values |
|---|---|
| `DocumentType` | `TECH_LOG` · `GAUGE_BEFORE` · `GAUGE_AFTER` · `FUEL_TICKET` · `BOWSER_METER` · **`SIGNATURE_PILOT`** · **`SIGNATURE_CREW`** |
| `CaptureMethod` | `MOBILE_CAMERA` · `UPLOAD` · `EMAIL` |
| `OcrStatus` | `NOT_ATTEMPTED` · `READ` · `PARTIAL` · `FAILED` |

**Every one needs `@assert.range`.** WP-13 measured that a declared enum enforces nothing without it — and that it works on **both** enum membership and numeric bounds — D30 was corrected on 24 August after a false restatement claiming otherwise.

---

## 3. Source flags — every extracted value says where it came from

A value without a provenance flag is a value nobody can weigh. **The flag also selects the tolerance**, which is already how `fob_source` behaves.

### On `FLIGHT_SCHEDULE` — **NINE OF THESE NOW EXIST. BUILT BY WP-33.**

> **CORRECTED 24 August.** This section was written before WP-33 merged and said the fields were absent. **`fob_at_out_kg`, `fob_at_off_kg`, `fob_at_on_kg`, `fob_at_in_kg`, `fob_source`, `flight_closure_utc`, `closure_source`, `flight_start_utc` and `start_source` are all on `main`.** Only **`closure_document`** is absent, and it is the only one WP-31 adds.
>
> The claim that *trip burn cannot be computed today* is also no longer true — **WP-33 supplied exactly those operands.**

```cds
fob_at_out_kg       : Decimal(10,2);
fob_at_off_kg       : Decimal(10,2);
fob_at_on_kg        : Decimal(10,2);
fob_at_in_kg        : Decimal(10,2);
fob_source          : FobSource;

flight_closure_utc  : Timestamp;
closure_source      : ClosureSource;
closure_document    : Association to SOURCE_DOCUMENTS;

flight_start_utc    : Timestamp;
start_source        : ClosureSource;
```

**`aobt`, `atot`, `aldt` and `aibt` now carry a fuel figure each — WP-33 added them, and trip burn is computable.** An earlier version of this line said the opposite and survived the retraction seventeen lines above it. **`closure_document` is the only field this section still adds.**

| `ClosureSource` | |
|---|---|
| `OCR` | Read from a photographed tech log and confirmed |
| `MANUAL` | Keyed by a person |
| `NONE` | **Not captured — and then there is no split point** |

### On `FUEL_DELIVERIES` — the gauge images

```cds
gauge_before_document : Association to SOURCE_DOCUMENTS;
gauge_after_document  : Association to SOURCE_DOCUMENTS;
```

`fob_source` already exists and already selects the tolerance. **It gains `OCR_CONFIRMED`** — see §5.

### On `FUEL_TICKETS` — the ticket and the meter

```cds
ticket_document : Association to SOURCE_DOCUMENTS;
meter_document  : Association to SOURCE_DOCUMENTS;
ticket_source   : TicketSource;
```

| `TicketSource` | |
|---|---|
| `OCR` | Photographed and read |
| `MANUAL` | Keyed |
| `ELECTRONIC` | The supplier sent a structured document |

**Two documents on one ticket, and they are different photographs** — the paper ticket and the bowser's meter face. Where one supplier's ticket shows the meter reading printed on it, one document may serve both.

---

## 4. One document, several values

A tech log yields **the closure timestamp, the uplift as recorded, and any defects raised.** One image, three fields.

**The reference lives on the parent field, not in a separate extraction table.** That keeps the value beside what it means and avoids a join to answer *where did this number come from*.

```
SOURCE_DOCUMENTS  1 ──── N  the fields that cite it

and nothing points the other way
```

**Do not build an `OCR_EXTRACTIONS` table.** It would be correct and nobody would ever query it — the question is always *where did THIS field come from*, never *what did that image yield*.

---

## 5. The confirmed value is what is used

**Never the raw OCR output.**

```
photograph  →  OCR reads  →  person sees the read on screen
            →  accepts or corrects  →  THAT value is stored
```

`ocr_raw` is retained for audit and is never read by anything downstream. `confirmed_by` and `confirmed_at` are what make the figure defensible.

### Which is why OCR earns the tighter tolerance

`fob_source` gains **`OCR_CONFIRMED`**, taking the same tolerance as `ACARS`.

> **MEASURED 24 August, and only half of it is in the data.** `TOL-FOB-ACARS` carries `floor_value = 50` and **`tolerance_value` EMPTY** — as do all three FOB rows. **The 50 kg floor is confirmed; the 0.5% is not in `TOLERANCE_RULES` at all.** So a new `OCR_CONFIRMED` row copying ACARS would copy an empty percentage. **The reasoning below holds; the percentage needs a source**, like the confidence threshold in section 10.

**The reason is rounding, not accuracy.** Decision C-5: the same load cell drives the ACARS downlink and the cockpit dial, so the instrument error is identical. What differs is the recording — a crew figure is written down to the nearest 100 kg, and an OCR read of the dial is to the kilogram.

> **A confirmed OCR read is a transcription of the dial, not a re-measurement.** It earns ACARS's tolerance because it carries ACARS's precision.

### And low confidence gates

Below a threshold, the value **cannot be accepted without explicit manual confirmation** — the person must key it rather than tap accept.

**The threshold belongs in `TOLERANCE_RULES`**, alongside everything else WP-13 collected. Not a literal.

`ocr_confidence` needs a **handler** check — **not because `@assert.range` fails on a numeric bound, which is a claim that was retracted on 24 August.** It enforces. The reason is that **the threshold is resolved from `TOLERANCE_RULES` and an annotation is a compile-time literal that cannot read a store.**

---

## 6. Capture is never blocked

**A1, applied to evidence.**

| | |
|---|---|
| OCR fails entirely | **Capture still succeeds.** `ocr_status = FAILED`, the image is stored, the value is keyed |
| No image at all | The value may still be keyed. `source = MANUAL` |
| Image but no value | Stored with `ocr_status = NOT_ATTEMPTED`. Somebody reads it later |

> **The fuel is already in the tanks.** Refusing to record it because a photograph would not read puts money outside the system, which is the thing A1 exists to prevent.

**What may be gated is what follows** — a delivery with no gauge image is `NOT_RECONCILED`, and a flight with no closure timestamp has no ground-gap split. Both are findings, not refusals.

---

## 7. Five things that will be got wrong

**1 · The image is the record, not a convenience.** Deleting it after a successful OCR read destroys the evidence and keeps only the claim. **Retention is a compliance question, not a storage one.**

**2 · A confirmed value must be distinguishable from an unconfirmed one.** `ocr_status = READ` with `confirmed_by` null is a number nobody has looked at. It is not the same as a confirmed figure and must not render as one.

**3 · `NONE` is not zero.** No closure timestamp means no split point — not a split at zero, not the whole gap on one flight. The scenario is `NOT_ATTRIBUTABLE` in the same sense as everything else that cannot be resolved.

**4 · One image may serve two fields, and that is fine.** A supplier ticket showing the meter reading printed on it is one document cited by both `ticket_document` and `meter_document`. Do not force a second photograph to satisfy a model.

**5 · Do not put the image in the database.** `image_uri` into the object store, and `image_hash` so the record can prove which image it referred to.

---

## 8. What must be built

| | |
|---|---|
| `SOURCE_DOCUMENTS` | New entity, four enums, `@assert.range` on each |
| **One** field on `FLIGHT_SCHEDULE` | **`closure_document` only.** The other nine landed with WP-33 |
| Two associations on `FUEL_DELIVERIES` | And `OCR_CONFIRMED` on `FobSource` |
| **Two** fields on `FUEL_TICKETS` | Two document associations. **`ticket_source` already exists** |
| Confirmation handler | Raw read → person → stored value |
| Confidence threshold | From `TOLERANCE_RULES`, handler-enforced |
| Object store integration | `image_uri` and `image_hash` |
| **Migrate two signature fields** | `pilot_signature` and `ground_crew_signature` out of `FUEL_DELIVERIES`, into `SOURCE_DOCUMENTS`. **Bytes to the object store**, row keeps a reference |
| `capture_location` | New on `SOURCE_DOCUMENTS`, from `signature_location`. GPS on every capture |

**No OCR engine.** That is a service the mobile app calls; FuelSphere records what it returned and who confirmed it.

---

## 8A. The two signature fields migrate in — **SURVEYED AND DECIDED, 24 August**

### What the schema actually holds

Searched for `image`, `photo`, `attachment`, `document`, `proof`, `epod`, `signature`, and separately for `_uri`, `_url`, `blob`, `LargeBinary`, `MediaType`.

**The entire evidence layer is four fields on `FUEL_DELIVERIES`:**

```cds
pilot_signature       : LargeBinary;    // Pilot signature image
ground_crew_signature : LargeBinary;    // Ground crew signature image
signature_timestamp   : Timestamp;
signature_location    : String(100);    // GPS coordinates or location
```

**No image URI exists anywhere.** All seven `_uri` and `_url` hits are endpoints, navigation targets or a runbook link. **There is nothing to extend** — WP-31 builds.

### Two problems in what does exist

**`LargeBinary` stores the image in the row**, and the comment beside it reads *"stored as base64 or reference to Object Store"*. **Nobody decided.** An undecided decision sitting in a comment is D28's class again.

Fine for a signature at a few kilobytes. **A photographed tech log is 2 to 5 MB**, and putting those in HANA rows is a mistake nobody notices until the table is large.

**And the signatures carry no provenance.** No source, no confirmation, no hash. **They are stored, not evidenced.**

### The decision

**Both signature fields migrate into `SOURCE_DOCUMENTS`** as `SIGNATURE_PILOT` and `SIGNATURE_CREW`.

**One evidence model, not two.** A signature gets the same treatment as every other captured image — URI, hash, capture method, who captured it and when.

> Leaving them would mean **the ePOD signature is stored one way and the tech log photograph another, for no reason but the order they were built in.** Two evidence models in one system is exactly what the survey was meant to prevent.

**The cost is a real migration.** `LargeBinary` to `image_uri` is not a rename — the bytes move to the object store and the row keeps a reference.

| | |
|---|---|
| `signature_timestamp` | Becomes `captured_at` on the document |
| `signature_location` | Becomes `capture_location`, **a new field on `SOURCE_DOCUMENTS`** — GPS is worth having on every capture, not only signatures |
| `ocr_status` | `NOT_ATTEMPTED`. **A signature is not read; it is held** |
| `confirmed_by` | The signatory. Which is what a signature already means |

### This is the first removal this project will make

**Every merged package so far has been additive.** The only prior removal is WP-08's duplicate pricing family. **D24's three orphaned CSVs are still on `main`** — `Airports`, `FuelTypes` and `Suppliers`; D24 says delete and nobody has. **So this is the first removal of a FIELD**, which is the stronger claim and still true.

**Four fields with seeded data behind them leave `FUEL_DELIVERIES`:**

```
pilot_signature
ground_crew_signature
signature_timestamp
signature_location
```

**Decided 24 August: migrate.** One evidence model is worth the risk, and leaving the signatures would create a legacy corner that every later package has to know about.

### Which means the sequence matters

**Do not remove and add in one commit.** Four steps, and the old fields survive until the last:

| | |
|---|---|
| **1** | Build `SOURCE_DOCUMENTS`. Add nothing to, remove nothing from, `FUEL_DELIVERIES` |
| **2** | **Migrate the data.** Every signature becomes a document row, bytes to the object store. The old fields still hold their values |
| **3** | **Move every reader.** Handlers, projections, annotations, harnesses, seed CSVs. **The old fields are still there, so nothing breaks while this happens** |
| **4** | Remove the four fields. **Only after step 3 proves zero readers remain** |

> **A removal that fails loudly is recoverable. One that fails quietly is D32** — three UI bindings reading fields that never existed on `INVOICES`, rendering blank for months, and **the Exception Queue permanently claiming "No exceptions — all clear" whatever the data said.** Nobody noticed because nothing threw.

**Step 3 is the whole package.** Steps 1, 2 and 4 are mechanical.

### Survey the readers first, and count them

```
srv/     handlers, projections, annotation files
db/      the schema, and every seed CSV column header
app/     the five freestyle apps — ePOD capture is in Fulfillment
test/    every harness asserting on a signature
```

**Report the count before moving anything.** If it is zero, say so and prove the instrument fires on a known-present field — a search that finds nothing and a search that is broken look identical.

---

## 9. Check before building

**An attachment mechanism may already exist.** The ePOD design says *ePOD attachment is 1:N per proof record*, which is the same shape. **If a document entity is already there, this extends it rather than duplicating it** — and two attachment models in one system is worse than either.

**`FUEL_DELIVERIES` carries no proof association.** WP-12 built the measurement fields and no evidence link.

> **Still survey the READERS of the two signature fields before moving them.** the shipped UI reads **five** fields that never existed on `INVOICES` — D32 " that is what happens when a field moves and a reader does not.

---

## 10. Open points this raises

| | |
|---|---|
| **What does "flight start" mean?** | Engineering releasing the aircraft, the outbound crew signing the tech log, or `AOBT`? **They are not the same**, and the ground gap needs the first — `AOBT` is after refuelling and would put the departing flight's APU burn nowhere |
| **Does the tech log carry a release timestamp at all?** | A question for the SME, not for the model |
| **Retention period for images** | A compliance question with a jurisdiction attached |
| **Confidence threshold value** | Needs a basis, like `APU406`'s missing cap. An invented number is worse than none |
