import type { TraceResult } from './trace';
import type { ExportOptions } from './dwg';

const n = (v: number) => (Math.round(v * 1000) / 1000).toString();

/**
 * SVG con los contornos a tamaño real (width/height en mm, viewBox en mm),
 * para abrirlo con la medida correcta en Illustrator, Inkscape o una cortadora láser.
 * Mismos trazos que el DWG: un grupo "Contorno" con un <path> por trazo y,
 * si se pide, un grupo "Relleno" debajo.
 */
export function toSvg(tr: TraceResult, opts: ExportOptions): Uint8Array {
  const s = opts.width / tr.width;
  const w = opts.width;
  const h = tr.height * s;
  const paths = tr.strokes
    .map((st) => {
      const d = 'M' + st.points.map(([x, y]) => `${n(x * s)} ${n(y * s)}`).join(' L') + (st.closed ? ' Z' : '');
      return `    <path d="${d}"/>`;
    })
    .join('\n');
  // Relleno: una sola forma con la regla par-impar (los huecos quedan vacíos), debajo de los contornos
  const fill =
    opts.fill && tr.fills.length
      ? `  <g id="Relleno">\n    <path fill="#4c5361" fill-rule="evenodd" d="` +
        tr.fills.map((loop) => 'M' + loop.map(([x, y]) => `${n(x * s)} ${n(y * s)}`).join(' L') + ' Z').join(' ') +
        `"/>\n  </g>\n`
      : '';
  const svg =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<svg xmlns="http://www.w3.org/2000/svg" width="${n(w)}mm" height="${n(h)}mm" viewBox="0 0 ${n(w)} ${n(h)}">\n` +
    fill +
    `  <g id="Contorno" fill="none" stroke="#4c5361" stroke-width="0.25" stroke-linejoin="round" stroke-linecap="round">\n` +
    `${paths}\n` +
    `  </g>\n` +
    `</svg>\n`;
  return new TextEncoder().encode(svg);
}
