// Verifies a DWG with LibreDWG (independent of acad-ts). Usage: node scripts/verify.mjs file.dwg
import fs from 'fs';
import { Dwg_File_Type, LibreDwg } from '@mlightcad/libredwg-web';
const lib = await LibreDwg.create('./node_modules/@mlightcad/libredwg-web/wasm/');
const bytes = fs.readFileSync(process.argv[2]);
const dwg = lib.dwg_read_data(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), Dwg_File_Type.DWG);
if (!dwg) { console.log('LIBREDWG FAILED TO READ'); process.exit(1); }
const db = lib.convert(dwg);
const layers = db.tables.LAYER.entries.map(l => `${l.name} color=${l.colorIndex} true=${l.trueColor?.toString(16) ?? l.color}`);
console.log('version', db.header?.ACADVER ?? '?');
console.log('layers:', layers);
const counts = {};
for (const e of db.entities) { const k = e.type + '@' + e.layer; counts[k] = (counts[k] || 0) + 1; }
console.log('entities:', counts);
const h = db.header ?? {};
console.log('TILEMODE:', h.TILEMODE, '(1 = se abre en Modelo)');
console.log('EXTMIN/EXTMAX:', JSON.stringify(h.EXTMIN), JSON.stringify(h.EXTMAX));
const vp = db.tables.VPORT?.entries?.find((v) => v.name?.toUpperCase() === '*ACTIVE');
if (vp) console.log('vista *Active:', JSON.stringify({ center: vp.center, viewHeight: vp.viewHeight, aspectRatio: vp.aspectRatio }));
lib.dwg_free(dwg);
