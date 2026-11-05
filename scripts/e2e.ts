// Prueba de extremo a extremo sin navegador: imagen sintética → contornos → DWG/DXF.
// Se ejecuta con `npm test`; después scripts/verify.mjs relee el DWG con LibreDWG.
import { writeFileSync } from 'fs';
import { trace } from '../src/trace';
import { toDwg, toDxf } from '../src/dwg';
import { toSvg } from '../src/svg';

const W = 300, H = 200;
const data = new Uint8ClampedArray(W * H * 4);
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  let c = [255, 255, 255];
  if ((x - 80) ** 2 + (y - 100) ** 2 < 60 ** 2) c = [220, 30, 40]; // círculo rojo
  if (x > 170 && x < 270 && y > 50 && y < 150 && !(x > 200 && x < 240 && y > 80 && y < 120)) c = [20, 60, 200]; // cuadrado con agujero
  if (x > 170 && x < 270 && y > 130 && y < 150) c = [240, 190, 20]; // franja amarilla pegada al cuadrado
  data.set([...c, 255], (y * W + x) * 4);
}

const tr = trace({ width: W, height: H, data }, { detail: 6 });
const closed = tr.strokes.filter((s) => s.closed).length;
const open = tr.strokes.length - closed;
console.log(`trazos: ${tr.strokes.length} (cerrados ${closed}, abiertos ${open}), vértices: ${tr.strokes.reduce((n, s) => n + s.points.length, 0)}`);

// Esperado: círculo y agujero = 2 lazos cerrados; cuadrado+franja = contorno exterior y
// frontera común, unidos en 2 cruces → 3 trazos abiertos (sin líneas duplicadas).
if (closed !== 2 || open !== 3) {
  console.error('ERROR: número de trazos inesperado');
  process.exit(1);
}
writeFileSync('scripts/e2e.dwg', toDwg(tr, { width: 300 }));
writeFileSync('scripts/e2e.dxf', toDxf(tr, { width: 300 }));

// SVG: tamaño real en mm y un <path> por trazo
const svg = new TextDecoder().decode(toSvg(tr, { width: 300 }));
const paths = (svg.match(/<path /g) || []).length;
if (!svg.includes('width="300mm"') || !svg.includes('height="200mm"') || paths !== tr.strokes.length) {
  console.error('ERROR: SVG incorrecto', { paths });
  process.exit(1);
}
console.log(`svg: 300 × 200 mm, ${paths} trazos`);

// Relleno: círculo, contorno de cuadrado+franja y el hueco = 3 formas cerradas
if (tr.fills.length !== 3) {
  console.error('ERROR: número de formas de relleno inesperado', tr.fills.length);
  process.exit(1);
}
writeFileSync('scripts/e2e_fill.dwg', toDwg(tr, { width: 300, fill: true }));
const svgFill = new TextDecoder().decode(toSvg(tr, { width: 300, fill: true }));
if (!svgFill.includes('id="Relleno"') || !svgFill.includes('fill-rule="evenodd"')) {
  console.error('ERROR: el SVG con relleno no lleva el relleno');
  process.exit(1);
}
console.log(`relleno: ${tr.fills.length} formas`);
console.log('ok');
