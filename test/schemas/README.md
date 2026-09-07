# `OverviewPageConfig.json`

SAP's own Overview Page manifest specification, taken verbatim from
`@sap/ux-specification/dist/schemas/v2/OverviewPageConfig.json`.

## Why it is committed here

**The generator emits `"cards": {}`.** Every OVP card in this repository is
hand-written, and until now there was no check between the hand and the
schema — while the schema sat in `node_modules` the whole time.

That cost one card. The Fuel Status card named
`sap.ovp.cards.list` — the **OData V2** card component — against a V4 model.
The schema enumerates both:

```
sap.ovp.cards.list        and  sap.ovp.cards.v4.list
sap.ovp.cards.table       and  sap.ovp.cards.v4.table
sap.ovp.cards.linklist    and  sap.ovp.cards.v4.linklist
sap.ovp.cards.stack       v2 only
```

The shell rendered, the filter bar rendered, the card **frame** rendered, and
the body bound nothing. Nothing errored.

## Why the v2 file governs a v4 app

`@sap/ux-specification` ships `OverviewPageConfig.json` under `v2/` only —
there is no `v4/OverviewPageConfig.json`. But the file itself enumerates the
`v4.*` card components, so it is the specification for both. The directory
name describes where SAP filed it, not which OData version it covers.

## Keeping it current

It is a copy, so it can go stale. `ovp-manifest-harness` asserts the copy
still matches the installed package where one is present, and skips that
assertion rather than failing where it is not — the app's own dependencies
are not installed in every environment.
