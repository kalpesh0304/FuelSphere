// Every service entity and its elements, from the compiled model - what a
// projection actually exposes, which is not always what its source carries.
const cds = require('@sap/cds');
(async () => {
    const m = cds.linked(await cds.load(['db', 'srv']));
    const out = {};
    for (const [n, d] of Object.entries(m.definitions)) {
        if (d.kind !== 'entity' || !n.includes('.') || n.startsWith('fuelsphere.') || n.endsWith('.drafts')
            || n.startsWith('DRAFT.') || n.startsWith('sap.') || n.endsWith('.texts')) continue;
        const svc = n.split('.')[0];
        if (!m.definitions[svc] || m.definitions[svc].kind !== 'service') continue;
        out[n] = Object.entries(d.elements).map(([k, e]) => ({ name: k, title: e['@title'] || e['@Common.Label'] || null,
            unit: e['@Measures.Unit'] ? (e['@Measures.Unit']['='] || e['@Measures.Unit']) : null }));
    }
    require('fs').writeFileSync(process.argv[2], JSON.stringify(out, null, 1));
    console.log(Object.keys(out).length, 'service entities');
})();
