import {
  ACadVersion,
  BoundaryPathFlags,
  Hatch,
  HatchBoundaryPath,
  HatchBoundaryPathPolyline,
  HatchPattern,
  HatchStyleType,
  CadDocument,
  Color,
  DwgWriter,
  DxfWriter,
  Layer,
  LwPolyline,
  LwPolylineVertex,
  UnitsType,
  VPort,
  XY,
  XYZ,
} from '@node-projects/acad-ts';
import type { TraceResult } from './trace';

export interface ExportOptions {
  /** Ancho final del dibujo, en unidades CAD (mm). */
  width: number;
  /** Añadir el relleno como sombreado sólido (capa «Relleno», debajo de los contornos). */
  fill?: boolean;
}

const round = (v: number) => Math.round(v * 10000) / 10000;

/**
 * Documento CAD con una capa "Contorno" y una polilínea por trazo
 * y, si se pide, una capa "Relleno" con un sombreado sólido.
 * Se guarda como AutoCAD 2000 (AC1015): lo abre cualquier programa CAD
 * y es la versión que LibreDWG lee sin ningún aviso.
 */
function buildDocument(tr: TraceResult, opts: ExportOptions): CadDocument {
  const doc = new CadDocument();
  doc.header!.version = ACadVersion.AC1015;
  doc.header!.insUnits = UnitsType.Millimeters;

  const layer = new Layer('Contorno');
  layer.color = new Color(7); // blanco/negro según el fondo del programa CAD
  doc.layers!.add(layer);

  const s = opts.width / tr.width;
  // y de la imagen va hacia abajo; en CAD va hacia arriba
  const toCad = ([x, y]: [number, number]) => new XY(round(x * s), round((tr.height - y) * s));

  // El relleno va primero para quedar por debajo de los contornos
  if (opts.fill && tr.fills.length) {
    const fillLayer = new Layer('Relleno');
    fillLayer.color = new Color(7);
    doc.layers!.add(fillLayer);

    const hatch = new Hatch();
    hatch.isSolid = true;
    hatch.pattern = HatchPattern.solid;
    hatch.style = HatchStyleType.Normal; // par-impar: los huecos quedan vacíos
    for (const loop of tr.fills) {
      const edge = new HatchBoundaryPathPolyline();
      edge.vertices = loop.map((p) => { const q = toCad(p); return new XYZ(q.x, q.y, 0); });
      edge.isClosed = true;
      const path = new HatchBoundaryPath([edge]);
      path.flags = BoundaryPathFlags.Polyline | BoundaryPathFlags.External;
      hatch.paths.push(path);
    }
    hatch.layer = fillLayer;
    hatch.color = Color.byLayer;
    doc.modelSpace!.entities.add(hatch);
  }

  for (const stroke of tr.strokes) {
    const vertices = stroke.points.map((p) => new LwPolylineVertex(toCad(p)));
    const pl = new LwPolyline(vertices);
    pl.isClosed = stroke.closed;
    pl.layer = layer;
    pl.color = Color.byLayer;
    doc.modelSpace!.entities.add(pl);
  }

  frameModelSpace(doc, opts.width, tr.height * s);
  return doc;
}

/**
 * Hace que el archivo se abra en la pestaña Modelo (no en la Presentación)
 * y con el dibujo centrado y entero en pantalla.
 */
function frameModelSpace(doc: CadDocument, w: number, h: number) {
  const header = doc.header!;
  header.showModelSpace = true; // TILEMODE = 1 → abre en Modelo (acad-ts lo deja en 0 por defecto)
  header.modelSpaceExtMin = new XYZ(0, 0, 0);
  header.modelSpaceExtMax = new XYZ(w, h, 0);
  header.modelSpaceLimitsMin = new XY(0, 0);
  header.modelSpaceLimitsMax = new XY(w, h);

  // Vista inicial (*Active): centrada en el dibujo, con un 10 % de margen.
  // Se calcula para una ventana apaisada (16:10); AutoCAD ajusta el resto al tamaño real.
  const aspect = 1.6;
  for (const vp of doc.vPorts!) {
    if (vp.name.toLowerCase() !== VPort.defaultName.toLowerCase()) continue;
    vp.center = new XY(w / 2, h / 2);
    vp.viewHeight = Math.max(h, w / aspect) * 1.1;
    vp.aspectRatio = aspect;
  }
}

export function toDwg(tr: TraceResult, opts: ExportOptions): Uint8Array {
  return DwgWriter.writeToBuffer(buildDocument(tr, opts));
}

export function toDxf(tr: TraceResult, opts: ExportOptions): Uint8Array {
  const parts: string[] = [];
  DxfWriter.writeToStream({ write: (v: string) => void parts.push(v) }, buildDocument(tr, opts));
  return new TextEncoder().encode(parts.join(''));
}
