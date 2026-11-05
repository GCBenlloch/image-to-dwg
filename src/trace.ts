/**
 * Detección automática de contornos.
 *
 * 1. Agrupa los píxeles en zonas de color parecido (el número de zonas se decide solo).
 * 2. Limpia el resultado: quita píxeles sueltos del antialiasing y manchas pequeñas.
 * 3. Recorre las fronteras entre zonas (las "grietas" entre píxeles) y las encadena en trazos.
 *    Cada frontera se dibuja una sola vez, y los trazos se tocan exactamente en los cruces.
 * 4. Suaviza la escalera de píxeles y reduce vértices (Douglas-Peucker).
 */

/** Imagen RGBA simple (compatible con ImageData del navegador). */
export interface Pixels {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

interface RGB {
  r: number;
  g: number;
  b: number;
}

export type Pt = [number, number];

/** Un trazo en coordenadas de la imagen (y hacia abajo). */
export interface Stroke {
  points: Pt[];
  closed: boolean;
}

export interface TraceResult {
  width: number;
  height: number;
  strokes: Stroke[];
  /**
   * Relleno: formas cerradas (exteriores y huecos) hechas con los mismos trazos que separan
   * el dibujo del fondo. Se rellenan con la regla par-impar (un hueco dentro de una forma queda vacío).
   */
  fills: Pt[][];
}

export interface TraceOptions {
  /** 1 (más suave y simple) … 10 (más fiel, más vértices). */
  detail: number;
}

// ---------------------------------------------------------------- color

/** Elimina la transparencia mezclando con blanco. */
export function flattenAlpha(px: Pixels): Pixels {
  const d = new Uint8ClampedArray(px.data);
  for (let i = 0; i < d.length; i += 4) {
    const a = d[i + 3] / 255;
    if (a < 1) {
      d[i] = d[i] * a + 255 * (1 - a);
      d[i + 1] = d[i + 1] * a + 255 * (1 - a);
      d[i + 2] = d[i + 2] * a + 255 * (1 - a);
      d[i + 3] = 255;
    }
  }
  return { width: px.width, height: px.height, data: d };
}

const d2 = (a: RGB, b: RGB) => (a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2;
const pix = (d: Uint8ClampedArray, i: number): RGB => ({ r: d[i], g: d[i + 1], b: d[i + 2] });

/** k-means (inicialización k-means++ determinista) sobre una muestra. Devuelve centros y su peso. */
function kmeans(px: Pixels, k: number): { c: RGB; n: number }[] {
  const { data } = px;
  const total = px.width * px.height;
  const step = Math.max(1, Math.floor(total / 20000));
  const sample: RGB[] = [];
  for (let p = 0; p < total; p += step) sample.push(pix(data, p * 4));

  const centers: RGB[] = [sample[0]];
  const best = new Float64Array(sample.length).fill(Infinity);
  while (centers.length < k) {
    const c = centers[centers.length - 1];
    let far = -1, farIdx = 0;
    sample.forEach((s, i) => {
      const dd = d2(s, c);
      if (dd < best[i]) best[i] = dd;
      if (best[i] > far) { far = best[i]; farIdx = i; }
    });
    if (far < 100) break; // no quedan colores claramente distintos
    centers.push(sample[farIdx]);
  }

  let counts: number[] = [];
  for (let iter = 0; iter < 15; iter++) {
    const acc = centers.map(() => ({ r: 0, g: 0, b: 0, n: 0 }));
    for (const s of sample) {
      let bi = 0, bd = Infinity;
      centers.forEach((c, i) => { const dd = d2(s, c); if (dd < bd) { bd = dd; bi = i; } });
      const a = acc[bi];
      a.r += s.r; a.g += s.g; a.b += s.b; a.n++;
    }
    counts = acc.map((a) => a.n);
    let moved = 0;
    acc.forEach((a, i) => {
      if (!a.n) return;
      const nc = { r: a.r / a.n, g: a.g / a.n, b: a.b / a.n };
      moved = Math.max(moved, d2(nc, centers[i]));
      centers[i] = nc;
    });
    if (moved < 0.25) break;
  }
  return centers.map((c, i) => ({ c, n: counts[i] / sample.length })).filter((x) => x.n > 0);
}

/** Distancia de p al segmento a-b (en RGB). */
function distToSegment(p: RGB, a: RGB, b: RGB): number {
  const ab = { r: b.r - a.r, g: b.g - a.g, b: b.b - a.b };
  const len2 = ab.r ** 2 + ab.g ** 2 + ab.b ** 2 || 1;
  const t = Math.max(0, Math.min(1, ((p.r - a.r) * ab.r + (p.g - a.g) * ab.g + (p.b - a.b) * ab.b) / len2));
  return Math.sqrt(d2(p, { r: a.r + t * ab.r, g: a.g + t * ab.g, b: a.b + t * ab.b }));
}

/**
 * Elige automáticamente los colores "reales" de la imagen:
 * - une colores muy parecidos,
 * - descarta colores escasos que son mezcla de otros dos (bordes suavizados / antialiasing),
 * - descarta colores casi inexistentes (ruido).
 */
function autoPalette(px: Pixels): RGB[] {
  let cl = kmeans(px, 10);

  // unir colores parecidos
  for (let merged = true; merged && cl.length > 1;) {
    merged = false;
    outer: for (let i = 0; i < cl.length; i++)
      for (let j = i + 1; j < cl.length; j++)
        if (d2(cl[i].c, cl[j].c) < 45 ** 2) {
          const a = cl[i], b = cl[j], n = a.n + b.n;
          cl[i] = { c: { r: (a.c.r * a.n + b.c.r * b.n) / n, g: (a.c.g * a.n + b.c.g * b.n) / n, b: (a.c.b * a.n + b.c.b * b.n) / n }, n };
          cl.splice(j, 1);
          merged = true;
          break outer;
        }
  }

  // quitar mezclas (de menor a mayor peso)
  cl.sort((a, b) => a.n - b.n);
  for (let i = 0; i < cl.length && cl.length > 2;) {
    const x = cl[i];
    const others = cl.filter((_, j) => j !== i && cl[j].n > x.n);
    let isBlend = false;
    if (x.n < 0.08)
      for (let a = 0; a < others.length && !isBlend; a++)
        for (let b = a + 1; b < others.length && !isBlend; b++)
          if (distToSegment(x.c, others[a].c, others[b].c) < 30) isBlend = true;
    if (isBlend || x.n < 0.002) cl.splice(i, 1);
    else i++;
  }
  return cl.map((x) => x.c);
}

// ---------------------------------------------------------------- zonas

function labelPixels(px: Pixels, palette: RGB[]): Int32Array {
  const { width: W, height: H, data } = px;
  const lab = new Int32Array(W * H);
  const pr = palette.map((c) => c.r), pg = palette.map((c) => c.g), pb = palette.map((c) => c.b);
  const n = palette.length;
  const cache = new Map<number, number>(); // las imágenes de logos repiten mucho los mismos colores
  for (let p = 0, i = 0; p < W * H; p++, i += 4) {
    const key = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2];
    let bi = cache.get(key);
    if (bi === undefined) {
      let bd = Infinity;
      bi = 0;
      for (let k = 0; k < n; k++) {
        const dr = data[i] - pr[k], dg = data[i + 1] - pg[k], db = data[i + 2] - pb[k];
        const dd = dr * dr + dg * dg + db * db;
        if (dd < bd) { bd = dd; bi = k; }
      }
      cache.set(key, bi);
    }
    lab[p] = bi;
  }
  return lab;
}

/** Filtro de mayoría 3x3: elimina píxeles sueltos y suaviza bordes dentados. */
function majority(lab: Int32Array, W: number, H: number, nLabels: number): Int32Array {
  const out = new Int32Array(lab);
  const cnt = new Int32Array(nLabels);
  for (let y = 1; y < H - 1; y++)
    for (let x = 1; x < W - 1; x++) {
      const p = y * W + x, l = lab[p];
      // atajo: si los 4 vecinos coinciden con el píxel, ya tiene mayoría (5 de 9)
      if (lab[p - 1] === l && lab[p + 1] === l && lab[p - W] === l && lab[p + W] === l) continue;
      cnt.fill(0);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) cnt[lab[(y + dy) * W + x + dx]]++;
      let best = lab[y * W + x], bc = cnt[best];
      for (let i = 0; i < nLabels; i++) if (cnt[i] > bc) { bc = cnt[i]; best = i; }
      if (bc >= 5) out[y * W + x] = best;
    }
  return out;
}

/** Une las manchas más pequeñas que minArea a la zona vecina con la que más frontera comparten. */
function removeSpecks(lab: Int32Array, W: number, H: number, minArea: number) {
  const comp = new Int32Array(W * H).fill(-1);
  const comps: { label: number; pixels: number[] }[] = [];
  const stack: number[] = [];
  for (let s = 0; s < W * H; s++) {
    if (comp[s] !== -1) continue;
    const id = comps.length, l = lab[s], pixels: number[] = [];
    comp[s] = id; stack.push(s);
    while (stack.length) {
      const p = stack.pop()!;
      pixels.push(p);
      const x = p % W, y = (p / W) | 0;
      for (const q of [x > 0 ? p - 1 : -1, x < W - 1 ? p + 1 : -1, y > 0 ? p - W : -1, y < H - 1 ? p + W : -1])
        if (q >= 0 && comp[q] === -1 && lab[q] === l) { comp[q] = id; stack.push(q); }
    }
    comps.push({ label: l, pixels });
  }
  const small = comps.filter((c) => c.pixels.length < minArea).sort((a, b) => a.pixels.length - b.pixels.length);
  for (const c of small) {
    const votes = new Map<number, number>();
    for (const p of c.pixels) {
      const x = p % W, y = (p / W) | 0;
      for (const q of [x > 0 ? p - 1 : -1, x < W - 1 ? p + 1 : -1, y > 0 ? p - W : -1, y < H - 1 ? p + W : -1])
        if (q >= 0 && lab[q] !== c.label) votes.set(lab[q], (votes.get(lab[q]) ?? 0) + 1);
    }
    if (!votes.size) continue;
    const to = [...votes].sort((a, b) => b[1] - a[1])[0][0];
    for (const p of c.pixels) lab[p] = to;
  }
}

/** Zona que domina el borde de la imagen = fondo. */
function backgroundLabel(lab: Int32Array, W: number, H: number): number {
  const votes = new Map<number, number>();
  const vote = (p: number) => votes.set(lab[p], (votes.get(lab[p]) ?? 0) + 1);
  for (let x = 0; x < W; x++) { vote(x); vote((H - 1) * W + x); }
  for (let y = 0; y < H; y++) { vote(y * W); vote(y * W + W - 1); }
  return [...votes].sort((a, b) => b[1] - a[1])[0][0];
}

// ---------------------------------------------------------------- fronteras

/**
 * Las fronteras se recorren sobre la rejilla de esquinas de píxel ((W+1) x (H+1) vértices).
 * Arista horizontal (x,y)-(x+1,y): separa el píxel (x,y-1) del (x,y).
 * Arista vertical   (x,y)-(x,y+1): separa el píxel (x-1,y) del (x,y).
 * Fuera de la imagen se considera fondo.
 */
type BgSide = 'left' | 'right' | null;

function extractBoundaries(lab: Int32Array, W: number, H: number, bg: number): { pts: Pt[]; closed: boolean; bgSide: BgSide }[] {
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= W || y >= H ? bg : lab[y * W + x]);
  const hOn = new Uint8Array(W * (H + 1)); // índice y*W + x
  const vOn = new Uint8Array((W + 1) * H); // índice y*(W+1) + x
  for (let y = 0; y <= H; y++) for (let x = 0; x < W; x++) if (at(x, y - 1) !== at(x, y)) hOn[y * W + x] = 1;
  for (let y = 0; y < H; y++) for (let x = 0; x <= W; x++) if (at(x - 1, y) !== at(x, y)) vOn[y * (W + 1) + x] = 1;

  // aristas activas que salen de un vértice: [tipo, índice, vecino x, vecino y]
  const incident = (x: number, y: number): [Uint8Array, number, number, number][] => {
    const r: [Uint8Array, number, number, number][] = [];
    if (x < W && hOn[y * W + x]) r.push([hOn, y * W + x, x + 1, y]);
    if (x > 0 && hOn[y * W + x - 1]) r.push([hOn, y * W + x - 1, x - 1, y]);
    if (y < H && vOn[y * (W + 1) + x]) r.push([vOn, y * (W + 1) + x, x, y + 1]);
    if (y > 0 && vOn[(y - 1) * (W + 1) + x]) r.push([vOn, (y - 1) * (W + 1) + x, x, y - 1]);
    return r;
  };
  // vértices donde se cruzan 3 o 4 fronteras (o termina una)
  const junction = new Uint8Array((W + 1) * (H + 1));
  for (let y = 0; y <= H; y++)
    for (let x = 0; x <= W; x++) {
      const n = incident(x, y).length;
      if (n > 0 && n !== 2) junction[y * (W + 1) + x] = 1;
    }

  // recorre desde (x,y) por una arista hasta llegar a un cruce o volver al inicio; las aristas usadas se apagan
  const walk = (x0: number, y0: number, first: [Uint8Array, number, number, number]) => {
    const pts: Pt[] = [[x0, y0]];
    let [arr, idx, x, y] = first;
    arr[idx] = 0;
    for (;;) {
      pts.push([x, y]);
      if ((x === x0 && y === y0) || junction[y * (W + 1) + x]) break;
      const next = incident(x, y)[0];
      if (!next) break;
      [arr, idx] = next;
      arr[idx] = 0;
      x = next[2]; y = next[3];
    }
    return pts;
  };

  /**
   * Lado del trazo donde queda el fondo, mirando su primer tramo (en coordenadas de imagen, y hacia abajo):
   * el píxel de la izquierda está en medio + ½·(dy, −dx) y el de la derecha en medio − ½·(dy, −dx).
   * null si el trazo separa dos zonas del dibujo (no es borde del relleno).
   */
  const sideOfBg = (pts: Pt[]): BgSide => {
    const [ax, ay] = pts[0], [bx, by] = pts[1];
    const dx = bx - ax, dy = by - ay, mx = (ax + bx) / 2, my = (ay + by) / 2;
    const left = at(Math.floor(mx + dy / 2), Math.floor(my - dx / 2));
    const right = at(Math.floor(mx - dy / 2), Math.floor(my + dx / 2));
    if (left === bg && right !== bg) return 'left';
    if (right === bg && left !== bg) return 'right';
    return null;
  };

  const out: { pts: Pt[]; closed: boolean; bgSide: BgSide }[] = [];
  // 1) trazos abiertos: de cruce a cruce
  for (let y = 0; y <= H; y++)
    for (let x = 0; x <= W; x++)
      if (junction[y * (W + 1) + x])
        for (let e = incident(x, y); e.length; e = incident(x, y)) {
          const pts = walk(x, y, e[0]);
          out.push({ pts, closed: false, bgSide: sideOfBg(pts) });
        }
  // 2) lazos cerrados (sin cruces)
  for (let y = 0; y <= H; y++)
    for (let x = 0; x <= W; x++) {
      const e = incident(x, y);
      if (e.length) {
        const pts = walk(x, y, e[0]);
        const bgSide = sideOfBg(pts);
        pts.pop(); // el último repite el primero
        out.push({ pts, closed: true, bgSide });
      }
    }
  return out;
}

// ---------------------------------------------------------------- suavizado

/**
 * Quita la "escalera" de los píxeles sin redondear las esquinas reales:
 * 1. se toman los puntos medios de cada escalón,
 * 2. se detectan las esquinas mirando la dirección a 4 puntos de distancia
 *    (los escalones de un píxel no cuentan, un pico de verdad sí),
 * 3. se suaviza todo lo demás varias veces; las esquinas y los cruces no se mueven.
 */
function smooth(pts: Pt[], closed: boolean, iterations: number): Pt[] {
  let p: Pt[] = [];
  const n = pts.length;
  if (!closed) p.push(pts[0]);
  for (let i = 0; i < (closed ? n : n - 1); i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    p.push([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]);
  }
  if (!closed) p.push(pts[n - 1]);

  const m = p.length;
  const fixed = new Uint8Array(m);
  if (!closed) fixed[0] = fixed[m - 1] = 1;

  const K = 4;
  if (m > 2 * K + 1) {
    const turn = new Float64Array(m);
    for (let i = 0; i < m; i++) {
      if (!closed && (i < K || i >= m - K)) continue;
      const a = p[(i - K + m) % m], c = p[i], b = p[(i + K) % m];
      const ux = c[0] - a[0], uy = c[1] - a[1], vx = b[0] - c[0], vy = b[1] - c[1];
      turn[i] = Math.abs(Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy));
    }
    const CORNER = (50 * Math.PI) / 180;
    for (let i = 0; i < m; i++) {
      if (turn[i] < CORNER) continue;
      let isMax = true;
      for (let j = -K; j <= K && isMax; j++) {
        const t = closed ? turn[(i + j + m) % m] : turn[i + j] ?? 0;
        if (t > turn[i] || (t === turn[i] && j < 0)) isMax = false;
      }
      if (isMax) fixed[i] = 1;
    }
  }

  for (let it = 0; it < iterations; it++) {
    const q: Pt[] = p.map((v) => [v[0], v[1]]);
    for (let i = 0; i < m; i++) {
      if (fixed[i]) continue;
      const a = p[(i - 1 + m) % m], b = p[(i + 1) % m];
      q[i] = [(a[0] + 2 * p[i][0] + b[0]) / 4, (a[1] + 2 * p[i][1] + b[1]) / 4];
    }
    p = q;
  }
  return p;
}

function douglasPeucker(p: Pt[], eps: number): Pt[] {
  if (p.length < 3) return p;
  const keep = new Uint8Array(p.length);
  keep[0] = keep[p.length - 1] = 1;
  const stack: [number, number][] = [[0, p.length - 1]];
  while (stack.length) {
    const [i, j] = stack.pop()!;
    const [ax, ay] = p[i], [bx, by] = p[j];
    const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy);
    let far = -1, fi = -1;
    for (let k = i + 1; k < j; k++) {
      const d = len === 0 ? Math.hypot(p[k][0] - ax, p[k][1] - ay) : Math.abs(dy * (p[k][0] - ax) - dx * (p[k][1] - ay)) / len;
      if (d > far) { far = d; fi = k; }
    }
    if (far > eps) { keep[fi] = 1; stack.push([i, fi], [fi, j]); }
  }
  return p.filter((_, i) => keep[i]);
}

function simplify(p: Pt[], closed: boolean, eps: number): Pt[] {
  if (!closed) return douglasPeucker(p, eps);
  // lazo cerrado: se parte en dos por el punto más alejado del primero
  let far = 0;
  p.forEach((v, i) => { if (Math.hypot(v[0] - p[0][0], v[1] - p[0][1]) > Math.hypot(p[far][0] - p[0][0], p[far][1] - p[0][1])) far = i; });
  const a = douglasPeucker(p.slice(0, far + 1), eps);
  const b = douglasPeucker([...p.slice(far), p[0]], eps);
  return [...a, ...b.slice(1, -1)];
}

// ---------------------------------------------------------------- relleno

/**
 * Une los trazos que separan dibujo y fondo en formas cerradas.
 * Cada trazo llega orientado con el dibujo a su izquierda; en cada cruce se continúa por el trazo
 * que sale de ese punto (si hay dos, como en dos zonas que se tocan en diagonal, se gira lo más
 * posible hacia el dibujo para no mezclar formas). Los extremos de los trazos son exactos
 * (el suavizado no los mueve), así que el relleno coincide con las líneas.
 */
function buildFills(chains: { points: Pt[]; closed: boolean }[]): Pt[][] {
  const fills: Pt[][] = [];
  const key = (p: Pt) => `${p[0]},${p[1]}`;
  const open = chains.filter((c) => !c.closed);
  for (const c of chains) if (c.closed && c.points.length >= 3) fills.push(c.points);

  const byStart = new Map<string, number[]>();
  open.forEach((c, i) => {
    const k = key(c.points[0]);
    if (!byStart.has(k)) byStart.set(k, []);
    byStart.get(k)!.push(i);
  });
  const used = new Uint8Array(open.length);

  for (let i0 = 0; i0 < open.length; i0++) {
    if (used[i0]) continue;
    used[i0] = 1;
    const loop: Pt[] = [...open[i0].points];
    const startKey = key(loop[0]);
    for (let guard = 0; guard < open.length; guard++) {
      const end = loop[loop.length - 1];
      if (key(end) === startKey) break;
      const cands = (byStart.get(key(end)) ?? []).filter((j) => !used[j]);
      if (!cands.length) break;
      let next = cands[0];
      if (cands.length > 1) {
        // girar lo más posible hacia la izquierda (hacia el dibujo); con y hacia abajo, izquierda = giro negativo
        const prev = loop[loop.length - 2];
        const ax = end[0] - prev[0], ay = end[1] - prev[1];
        let best = Infinity;
        for (const j of cands) {
          const q = open[j].points[1];
          const bx = q[0] - end[0], by = q[1] - end[1];
          const turn = Math.atan2(ax * by - ay * bx, ax * bx + ay * by);
          if (turn < best) { best = turn; next = j; }
        }
      }
      used[next] = 1;
      loop.push(...open[next].points.slice(1));
    }
    if (key(loop[loop.length - 1]) === startKey) loop.pop();
    if (loop.length >= 3) fills.push(loop);
  }
  return fills;
}

// ---------------------------------------------------------------- principal

export function trace(input: Pixels, opts: TraceOptions): TraceResult {
  const px = flattenAlpha(input);
  const { width: W, height: H } = px;
  const detail = Math.min(10, Math.max(1, opts.detail));

  const palette = autoPalette(px);
  let lab = labelPixels(px, palette);
  lab = majority(lab, W, H, palette.length);
  // manchas de ruido: tamaño fijo y pequeño, para no borrar trazos finos del dibujo
  const minArea = Math.max(8, Math.round(W * H * 0.00003));
  removeSpecks(lab, W, H, minArea);
  const bg = backgroundLabel(lab, W, H);

  // Detalle solo decide cuánto se suaviza y simplifica; la escalera de píxeles se quita siempre
  const iterations = 3 + Math.round((10 - detail) * 0.7); // 3 … 9
  const eps = 0.5 + (10 - detail) * 0.11; // 0.5 … 1.5 px

  const strokes: Stroke[] = [];
  const edgeChains: { points: Pt[]; closed: boolean }[] = []; // bordes dibujo/fondo, con el dibujo a la izquierda
  for (const { pts, closed, bgSide } of extractBoundaries(lab, W, H, bg)) {
    const s = simplify(smooth(pts, closed, iterations), closed, eps);
    if (closed ? s.length >= 3 : s.length >= 2) strokes.push({ points: s, closed });
    if (bgSide) edgeChains.push({ points: bgSide === 'left' ? [...s].reverse() : s, closed });
  }
  return { width: W, height: H, strokes, fills: buildFills(edgeChains) };
}
