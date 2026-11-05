# Imagen → DWG

Herramienta web gratuita que saca el **contorno** de logos, escudos e imágenes sencillas y lo guarda como dibujo **DWG**, **DXF** o **SVG** a tamaño real.

**Úsala aquí: <https://gcbenlloch.github.io/image-to-dwg/>**

Todo se hace en tu navegador: no hay servidor y tus imágenes no se suben a ningún sitio.

## Qué hace

- Detecta los contornos **automáticamente**, sin elegir colores ni umbrales.
- Cada borde se dibuja **una sola vez**: donde se tocan dos zonas hay una única línea, y las líneas se unen exactamente en los cruces. Así el dibujo queda limpio para CAD.
- Quita la «escalera» de los píxeles y conserva las esquinas afiladas.
- Opcionalmente añade un **relleno sólido** (sombreado) que coincide exactamente con las líneas.

## Cómo se usa

1. **Sube la imagen** (JPG, PNG o WEBP): arrástrala, haz clic para elegirla o pégala con Ctrl+V.
2. **Revisa el trazado** y, si hace falta, mueve **Detalle**: menos = líneas más suaves y simples; más = más fiel al original.
3. **Descarga**: elige el **ancho final** en mm y si quieres solo **Contorno** o también **Relleno**, y descarga el formato que necesites.

| Formato | Para qué | Contenido |
|---|---|---|
| **DWG** | AutoCAD y la mayoría de programas CAD | AutoCAD 2000, capa `Contorno` con polilíneas (+ capa `Relleno` con sombreado sólido) |
| **DXF** | Otros programas CAD | Igual que el DWG |
| **SVG** | Diseño (Illustrator, Inkscape) y corte láser | Medidas reales en mm, grupo `Contorno` (+ grupo `Relleno`) |

> Se trazan los **bordes** de las zonas: en un dibujo hecho con líneas gruesas, cada línea da dos contornos (uno por cada borde). Funciona mejor con logos y escudos de zonas rellenas.

## Cómo funciona

1. **Colores**: agrupa los colores de la imagen y descarta automáticamente los tonos intermedios de los bordes suavizados y el ruido de los JPG.
2. **Limpieza**: quita píxeles sueltos y manchas diminutas. El color que rodea la imagen se toma como fondo.
3. **Fronteras**: sigue los bordes entre zonas píxel a píxel y los encadena en trazos que se cortan en los cruces.
4. **Suavizado**: elimina la escalera de los píxeles respetando las esquinas reales y reduce vértices (Douglas-Peucker).
5. **Relleno**: une los trazos que separan dibujo y fondo en formas cerradas con sus huecos.

El código del trazado está en [`src/trace.ts`](src/trace.ts) y no tiene dependencias.

## Desarrollo

Requiere [Node.js](https://nodejs.org/) 20 o superior.

```bash
npm install
npm run dev      # servidor local
npm test         # prueba de extremo a extremo
npm run build    # versión para publicar, en dist/
```

`npm test` traza una imagen sintética, comprueba que no hay líneas duplicadas y que el relleno es correcto, genera DWG, DXF y SVG, y relee los DWG con [LibreDWG](https://www.gnu.org/software/libredwg/) (un lector independiente) para confirmar que son válidos.

### Estructura

| Archivo | Qué hace |
|---|---|
| `src/trace.ts` | Detección de contornos y relleno |
| `src/dwg.ts` | Exportación a DWG y DXF |
| `src/svg.ts` | Exportación a SVG |
| `src/main.ts` | Interfaz (pestañas, vista previa, descargas) |
| `scripts/` | Prueba de extremo a extremo y verificación con LibreDWG |

## Publicación

Cada cambio en la rama `main` se publica solo en GitHub Pages mediante [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) (en el repositorio: **Settings → Pages → Source: GitHub Actions**).

También sirve cualquier alojamiento estático (Netlify, Cloudflare Pages…): basta con subir la carpeta `dist/`.

## Créditos

- [acad-ts](https://github.com/node-projects/acad-ts) (MIT): escritura de DWG y DXF en el navegador.
- [Open Sans](https://fonts.google.com/specimen/Open+Sans) (SIL Open Font License 1.1), servida con [Fontsource](https://fontsource.org/).
- [LibreDWG](https://www.gnu.org/software/libredwg/) (GPL-3.0), mediante [libredwg-web](https://github.com/mlightcad/libredwg-web): solo se usa en las pruebas y no forma parte de la web publicada.
- [Vite](https://vite.dev/) y [TypeScript](https://www.typescriptlang.org/).

## Licencia

Copyright © 2026 Gonzalo Cañada

Este programa es software libre: puedes redistribuirlo y modificarlo bajo los términos de la
[GNU Affero General Public License](LICENSE), versión 3 o (a tu elección) cualquier versión posterior.

En pocas palabras: puedes usarlo, estudiarlo, modificarlo y compartirlo, pero si publicas una versión
modificada —también si la ofreces como web— debes publicar su código con la misma licencia.
Se distribuye **sin ninguna garantía**; consulta el texto completo en [LICENSE](LICENSE).
