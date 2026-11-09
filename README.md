# ModCut

Scale a 3D model and cut it into modules that fit your printer's build plate, inspired by Luban 3D.

![Windows](https://img.shields.io/badge/Windows-10%20%2F%2011-blue)

## Features

- **Opens** STL, OBJ, 3MF, PLY, GLB/GLTF, FBX, AMF, VRML, and STEP/IGES/BREP (CAD).
- **Printer-aware:** asks for your build volume (with presets) and finds the fewest cuts that fit, with a safety margin and optional rotation.
- **Scale and orient:** scale by % or by target size in mm, set units, rotate 90°, mirror.
- **Manual cuts:** drag the cut planes in 3D or type exact positions. Sections that don't fit are shown in red.
- **Watertight cuts** (manifold-3d) with **connectors:** dowel holes plus printable pins, or peg + socket, with adjustable clearance.
- **Preview before accepting:** exploded view, **Print layout** (all parts auto-oriented and packed onto build plates, supports shown in orange) and **Single part** view.
- **Auto-orient:** each part is placed in the position that needs the least support and still fits the plate.
- **Filament estimate:** weight, length, support share and cost per part. Defaults to 2% rectilinear infill with supports; infill, pattern, support density, overhang threshold, walls, line width and filament Ø are adjustable.
- **Export:** one STL per part in print position, packed plate STLs, dowel pins, and an HTML assembly report.

## Download

**[Download ModCut.exe](https://github.com/j-jovan/mod-cut/raw/main/release/ModCut.exe)**. It's a single 12 MB file with nothing to install. It runs on Windows 10/11 and uses the Edge WebView2 runtime that ships with Windows.
It isn't code-signed, so on first launch choose **More info → Run anyway**.

## Build

Requires Node 18+.

```sh
npm ci
npm run build:exe        # → lite/dist/ModCut/ModCut-win_x64.exe (single exe, ~12 MB)
```

Alternative Electron build (larger, ~73 MB):

```sh
npm run build            # bundle src/app.js → app/bundle.js
npx electron-builder --win --x64
```

## Layout

| Path | What |
|---|---|
| `src/app.js` | UI, viewport, cut layout, preview/print-layout views, export |
| `app/geo-core.js`, `app/geo-worker.js` | Mesh welding/repair, plane cuts, connectors (manifold-3d, in a worker) |
| `app/print-est.js`, `app/orient-worker.js` | Overhang/support analysis, auto-orientation, filament maths |
| `app/step-worker.js` | STEP/IGES import (occt-import-js) |
| `lite/` | Single-exe build (Neutralino + WebView2): `native-neu.js` adapter, config, icon patch |
| `main.js`, `preload.js`, `afterPack.cjs` | Electron shell (alternative build) |

Weight and support figures are estimated from geometry, not a real slice, so expect them to be within roughly 10–15% of your slicer.
