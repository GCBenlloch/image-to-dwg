import '@fontsource/open-sans/300.css';
import '@fontsource/open-sans/400.css';
import '@fontsource/open-sans/600.css';
import '@fontsource/open-sans/700.css';
import './style.css';
import { trace, type Pixels, type TraceResult } from './trace';
import { toDwg, toDxf, type ExportOptions } from './dwg';
import { toSvg } from './svg';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const drop = $<HTMLLabelElement>('drop');
const fileInput = $<HTMLInputElement>('file');
const original = $<HTMLImageElement>('original');
const preview = $<HTMLDivElement>('preview');
const finalPreview = $<HTMLDivElement>('finalPreview');
const detail = $<HTMLInputElement>('detail');
const widthInput = $<HTMLInputElement>('width');
const showImage = $<HTMLInputElement>('showImage');
const previewWrap = $<HTMLDivElement>('previewWrap');
const stats = $<HTMLDivElement>('stats');
const sizeInfo = $<HTMLElement>('sizeInfo');
const downloaded = $<HTMLParagraphElement>('downloaded');
const btnDwg = $<HTMLButtonElement>('downloadDwg');
const btnDxf = $<HTMLButtonElement>('downloadDxf');
const btnSvg = $<HTMLButtonElement>('downloadSvg');
const tabs = [...document.querySelectorAll<HTMLButtonElement>('.steps [role="tab"]')];

let pixels: Pixels | null = null;
let result: TraceResult | null = null;
let baseName = 'dibujo';
let imageUrl = '';
let step = 1;

// ---------- Pestañas (pasos) ----------

/** Muestra el paso n (1 subir, 2 revisar, 3 descargar). Los pasos 2 y 3 necesitan una imagen. */
function goTo(n: number) {
  if (n > 1 && !pixels) return;
  step = n;
  for (let k = 1; k <= 3; k++) $(`view${k}`).hidden = k !== n;
  tabs.forEach((tab) => {
    const k = +tab.dataset.step!;
    tab.classList.toggle('active', k === n);
    tab.classList.toggle('done', k < n && !!pixels);
    tab.setAttribute('aria-selected', String(k === n));
    tab.disabled = k > 1 && !pixels;
    tab.title = tab.disabled ? 'Primero sube una imagen' : '';
  });
  $('keepCurrent').hidden = !pixels;
  downloaded.hidden = true;
  if (n === 3) renderFinal();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

tabs.forEach((tab) => tab.addEventListener('click', () => goTo(+tab.dataset.step!)));
document.querySelectorAll<HTMLElement>('[data-goto]').forEach((el) =>
  el.addEventListener('click', () => goTo(+el.dataset.goto!)),
);
// flechas izquierda/derecha para moverse entre pestañas con el teclado
document.querySelector('.steps')!.addEventListener('keydown', (e) => {
  const key = (e as KeyboardEvent).key;
  if (key !== 'ArrowRight' && key !== 'ArrowLeft') return;
  const enabled = tabs.filter((t) => !t.disabled);
  const i = enabled.findIndex((t) => +t.dataset.step! === step);
  const next = enabled[(i + (key === 'ArrowRight' ? 1 : enabled.length - 1)) % enabled.length];
  goTo(+next.dataset.step!);
  next.focus();
});

// ---------- Carga de imagen ----------

// Todas las imágenes se trabajan con el lado mayor a 1600 px: las pequeñas se amplían
// (los trazos finos sobreviven y las curvas salen más suaves) y las grandes se reducen (velocidad).
const WORK_SIDE = 1600;

/**
 * Nombre base para el DWG: quita todas las extensiones de imagen del final
 * («escudo.svg.png» → «escudo»), no solo la última.
 */
function cleanName(name: string): string {
  return name.replace(/(\.(svg|png|jpe?g|jfif|webp|gif|bmp|tiff?|avif|heic))+$/i, '').trim() || 'dibujo';
}

async function loadFile(file: File) {
  if (!/^image\/(png|jpeg|webp)$/.test(file.type)) {
    alert('Formato no admitido. Usa una imagen JPG, PNG o WEBP.');
    return;
  }
  baseName = cleanName(file.name);
  const bmp = await createImageBitmap(file);
  const longest = Math.max(bmp.width, bmp.height);
  const scale = WORK_SIDE / longest;
  const w = Math.max(1, Math.round(bmp.width * scale));
  const h = Math.max(1, Math.round(bmp.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp, 0, 0, w, h);
  pixels = ctx.getImageData(0, 0, w, h);

  if (imageUrl) URL.revokeObjectURL(imageUrl);
  imageUrl = original.src = URL.createObjectURL(file);
  $('currentName').textContent = file.name;
  $('fileTitle').textContent = baseName;
  result = null;
  goTo(2);
  run();
}

fileInput.addEventListener('change', () => fileInput.files?.[0] && loadFile(fileInput.files[0]));
drop.addEventListener('keydown', (e) => (e.key === 'Enter' || e.key === ' ') && fileInput.click());
['dragenter', 'dragover'].forEach((ev) =>
  document.addEventListener(ev, (e) => {
    e.preventDefault();
    drop.classList.add('over');
  }),
);
['dragleave', 'drop'].forEach((ev) => document.addEventListener(ev, () => drop.classList.remove('over')));
document.addEventListener('drop', (e) => {
  e.preventDefault();
  const f = (e as DragEvent).dataTransfer?.files?.[0];
  if (f) loadFile(f);
});
document.addEventListener('paste', (e) => {
  const item = [...(e.clipboardData?.items ?? [])].find((i) => i.type.startsWith('image/'));
  const f = item?.getAsFile();
  if (f) loadFile(new File([f], 'imagen-pegada.png', { type: f.type }));
});

// ---------- Vectorizado y vista previa ----------

let timer = 0;
function run() {
  updateLabels();
  if (!pixels) return;
  previewWrap.classList.add('busy');
  clearTimeout(timer);
  timer = window.setTimeout(() => {
    result = trace(pixels!, { detail: +detail.value });
    render();
    previewWrap.classList.remove('busy');
  }, 150);
}

function updateLabels() {
  $('detailVal').textContent = detail.value;
  // parte rellena de la pista del deslizador (Chrome/Edge no la pintan solos)
  const fill = ((+detail.value - +detail.min) / (+detail.max - +detail.min)) * 100;
  detail.style.setProperty('--fill', `${fill}%`);
}

/** SVG con los trazos; opcionalmente con la imagen original de fondo. */
function strokesSvg(tr: TraceResult, withImage: boolean, withFill = false): string {
  const { width, height, strokes } = tr;
  const d = strokes
    .map((s) => 'M' + s.points.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join('L') + (s.closed ? 'Z' : ''))
    .join('');
  const under = withImage
    ? `<image href="${imageUrl}" width="${width}" height="${height}" opacity="0.25" preserveAspectRatio="none" />`
    : '';
  return (
    `<svg viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">${under}` +
    (withFill ? `<path d="${fillPath(tr)}" fill="#4c5361" fill-rule="evenodd" />` : '') +
    `<path d="${d}" fill="none" stroke="#4c5361" stroke-width="1.6" stroke-linejoin="round" vector-effect="non-scaling-stroke" /></svg>`
  );
}

function render() {
  if (!result) return;
  const { strokes } = result;
  preview.innerHTML = strokesSvg(result, showImage.checked);

  const nPts = strokes.reduce((n, s) => n + s.points.length, 0);
  stats.innerHTML = strokes.length
    ? `<span class="chip"><b>${strokes.length}</b> trazos</span>` +
      `<span class="chip"><b>${nPts.toLocaleString('es')}</b> vértices</span>`
    : '<span class="msg">No se ha encontrado ningún contorno en la imagen.</span>';
  $<HTMLButtonElement>('toDownload').disabled = !strokes.length;
  tabs[2].disabled = !strokes.length;
  if (step === 3) renderFinal();
}

const fmt = (v: number) => v.toLocaleString('es', { maximumFractionDigits: 1 });

// Vista y contenido de la descarga: solo contorno, o contorno + relleno
let finalMode: 'outline' | 'fill' = 'outline';

/** Formas del relleno como un único path (regla par-impar: los huecos quedan vacíos). */
function fillPath(tr: TraceResult): string {
  return tr.fills.map((loop) => 'M' + loop.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join('L') + 'Z').join('');
}

function renderFinal() {
  if (!result) return;
  finalPreview.innerHTML = strokesSvg(result, false, finalMode === 'fill');
  $('fileDesc').textContent =
    finalMode === 'fill'
      ? 'Capas «Contorno» (polilíneas) y «Relleno» (sombreado sólido)'
      : 'Una capa «Contorno» con polilíneas';
  updateSize();
}

document.querySelectorAll<HTMLButtonElement>('.seg [data-mode]').forEach((btn) =>
  btn.addEventListener('click', () => {
    finalMode = btn.dataset.mode as typeof finalMode;
    document.querySelectorAll<HTMLButtonElement>('.seg [data-mode]').forEach((b) =>
      b.setAttribute('aria-checked', String(b === btn)),
    );
    renderFinal();
  }),
);

function updateSize() {
  if (!result) return;
  const w = exportOptions().width;
  sizeInfo.textContent = `El dibujo medirá ${fmt(w)} × ${fmt((w * result.height) / result.width)} mm`;
  btnDwg.disabled = btnDxf.disabled = btnSvg.disabled = !result.strokes.length;
}

detail.addEventListener('input', run);
showImage.addEventListener('input', render);
widthInput.addEventListener('input', updateSize);

// ---------- Descargas ----------

function exportOptions(): ExportOptions {
  const w = +widthInput.value;
  return { width: w > 0 ? w : 100, fill: finalMode === 'fill' };
}

function download(bytes: Uint8Array, ext: string) {
  const type = ext === 'svg' ? 'image/svg+xml' : 'application/octet-stream';
  const blob = new Blob([bytes as BlobPart], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${baseName}.${ext}`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  downloaded.innerHTML =
    '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12 5 5 9-10" /></svg>';
  downloaded.append(`Descargado ${baseName}.${ext}`);
  downloaded.hidden = false;
}

function safely(fn: () => void) {
  try {
    fn();
  } catch (err) {
    console.error(err);
    alert('No se pudo generar el archivo: ' + (err as Error).message);
  }
}

btnDwg.addEventListener('click', () => result && safely(() => download(toDwg(result!, exportOptions()), 'dwg')));
btnDxf.addEventListener('click', () => result && safely(() => download(toDxf(result!, exportOptions()), 'dxf')));
btnSvg.addEventListener('click', () => result && safely(() => download(toSvg(result!, exportOptions()), 'svg')));

updateLabels();
goTo(1);
