const cds=require('@sap/cds');
(async()=>{const m=cds.linked(await cds.load('db'));const out={};
for(const [n,e] of Object.entries(m.definitions)){ if(!n.startsWith('fuelsphere.')||e.kind!=='entity'||e.query||e.projection) continue;
 const cols={};
 for(const [k,v] of Object.entries(e.elements)){ if(v.virtual||v.value) continue;
  if(v.isAssociation){ if(!v.keys) continue; for(const kk of v.keys){cols[k+'_'+(kk.ref||[kk.as]).join('_')]={type:'FK',target:v.target};} continue;}
  if(v.isComposition) continue;
  cols[k]={type:v.type, len:v.length, enum:v.enum?Object.entries(v.enum).map(([a,b])=>b.val??a):undefined, mandatory:!!v['@mandatory'], key:!!v.key};}
 out[n.replace('fuelsphere.','')]=cols;}
require('fs').writeFileSync(process.argv[2],JSON.stringify(out,null,1));})();
