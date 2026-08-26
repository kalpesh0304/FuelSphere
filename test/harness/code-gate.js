// The extraction gate, now a convention: read what the handlers emit, compare
// against what the taxonomy carries, fail on any difference.
const fs=require('fs'), path=require('path');
const doc=fs.readFileSync('docs/design/03-VALIDATION-RULES.md','utf8');
const documented=new Set(doc.match(/\b[A-Z]{2,4}\d{3}\b/g)||[]);
for (const m of doc.matchAll(/\b([A-Z]{2,4})(\d{3})\s*-\s*(\d{3})\b/g))
  for (let n=+m[2]; n<=+m[3]; n++) documented.add(m[1]+n);
const emitted={};
(function walk(d){ for (const f of fs.readdirSync(d)) {
  const p=path.join(d,f); const st=fs.statSync(p);
  if (st.isDirectory()) walk(p);
  else if (f.endsWith('.js')) for (const c of fs.readFileSync(p,'utf8').match(/\b[A-Z]{2,4}\d{3}\b/g)||[])
    (emitted[c]=emitted[c]||new Set()).add(p);
}})('srv');
const missing=Object.keys(emitted).filter(c=>!documented.has(c)).sort();
console.log(`${Object.keys(emitted).length} distinct code(s) emitted by srv/**/*.js`);
console.log(`${missing.length} not carried by 03-VALIDATION-RULES.md`);
missing.forEach(c=>console.log(`  ${c.padEnd(8)} ${[...emitted[c]].join(', ')}`));
const controls=['EPD403','APU406','DSP450'].map(c=>`${c}:${documented.has(c)?'documented':'MISSING'}`);
console.log('controls —', controls.join('  '));
process.exit(missing.length ? 1 : 0);
