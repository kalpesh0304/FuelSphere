# Flight Fuel Overview — Fiori Elements Overview Page

One card so far: **Fuel status**, the reconciliation verdict per delivery.

## Why this app exists rather than a preview

`$fiori-preview` **cannot show an overview page.** Its router is
`/:service/:entity` and the manifest it synthesises hardcodes two targets,
`sap.fe.templates.ListReport` and `sap.fe.templates.ObjectPage`. Asking it for
an OVP returns `400 No such entity 'ovp'`. An OVP has no single entity, so
there is nowhere for it to hang.

## Running it

    cd app/flight-overview
    npm install
    npm start

It expects the CAP service on `http://localhost:4004` — start that first with
`cds watch` from the repository root. `ui5.yaml` proxies `/odata/v4/planning/`
to it.

**This will not render inside the build container.** UI5 loads from
`https://ui5.sap.com`, which answers `403 to CONNECT` there, and Fiori Elements
and `sap.ovp` are not published to public npm — only `@openui5/sap.ui.core` is,
and it carries neither. There is no offline path. The app renders on a machine
with ordinary internet access.

## How the card is verified without looking at it

`test/harness/e2a-ovp-card-harness.js`, six criteria. The two that matter:

* **the annotation the card names exists on the entity the card names**,
  checked in the emitted EDMX, qualifier included
* **the binding returns rows, and the rows carry values**

A person looking at the page cannot tell an empty card from a card whose data
happens to be absent today. Seven distinct causes have produced an empty
section in this repository — a dangling path, an unexposed target, an
unmodelled navigation, a wrong field name, a null foreign key, a virtual
element nobody wrote, and a facet on an unannotated entity — and **not one of
them is visible by looking.** A binding that returns rows catches all seven.
