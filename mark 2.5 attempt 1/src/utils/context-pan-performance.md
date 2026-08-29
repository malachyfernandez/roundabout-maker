# Context: Firefox Pan Performance — Compositor Transform Approach & Next Steps

## The Task

Panning is smooth on Chrome but **very slow and choppy on Firefox**, specifically
when zoomed in on a complicated roundabout (e.g. the hard-roundabout.json fixture)
with the entire roundabout filling the screen. The user wants a fundamental
architectural change, not micro-adjustments.

### What has been implemented so far

A **compositor-transform pan** approach was implemented in `src/viewport/Viewport.tsx`.
Instead of updating the SVG `viewBox` every pan frame (which forces Firefox to
re-rasterize the entire complex SVG), the SVG element itself is translated using
a CSS `transform: translate(...)` during panning. The `viewBox` is only committed
(updated to the real pan position) when:
- The pan exceeds 75% of the culling margin (so content stays visible)
- The user releases the pointer (pointer-up)
- Momentum ends

The SVG element is sized larger than the container (by `CULL_MARGIN_RATIO` on each
side) and positioned absolutely, so translating it doesn't reveal edges. The
container has `overflow: hidden`.

### What was measured (Firefox, hard-roundabout.json, zoom=0.1)

**Attempt 1 — transform on SVG `<g>` child element:**
- Frame p95: 92ms, max: 131ms, 42/57 frames over 20ms
- viewBox mutations: 7, transform mutations: 60
- JS dispatch time: negligible (6ms total for 282 wheel events)
- **Conclusion**: Firefox does NOT compositor-accelerate CSS transforms on SVG
  child elements (`<g>`). It re-rasterizes the entire SVG content on every
  transform change. This approach failed.

**Attempt 2 — transform on `<svg>` element itself:**
- Frame p95: 62ms, max: 663ms, 41/86 frames over 20ms
- viewBox mutations: 26, transform mutations: 93
- JS dispatch time: still negligible (3ms for 189 wheel events)
- **Conclusion**: Better but still not good enough. Firefox appears to partially
  compositor-accelerate transforms on the `<svg>` element itself, but the
  improvement was modest (92ms → 62ms p95). The max frame of 663ms suggests
  periodic full re-rasterization. The approach is architecturally correct but
  Firefox's SVG rasterization remains the bottleneck.

### What the user wants next (NOT YET IMPLEMENTED)

The user proposed a **Firefox-specific aggressive approach**:

1. **WebGL rasterization overlay during pan**: When panning on Firefox,
   rasterize the current SVG to a bitmap (canvas/image), display that bitmap
   via WebGL or a simple `<canvas>`/`<img>` element with CSS transform for
   smooth compositor panning, and hide the live SVG. When the pan ends and
   things settle, swap back to the real SVG.

2. **"Firefox ugly version"**: A simplified/low-quality rendering during drag
   that superimposes the previous SVG rasterization. The full detailed SVG
   is only drawn when the user lets go and things settle.

3. **Browser detection**: Use the good (current) approach for Chrome where
   performance is already great. Use the ugly/WebGL approach for Firefox.
   This should be **configurable** (not just auto-detect — the user wants a
   setting).

4. **Don't hide gizmos/handles when panning**: The current implementation
   hides handles, lane profile controls, and other UI elements during pan
   (via `viewDetailsEnabled` and `effectsEnabled` flags tied to
   `interactionActive`). The user finds this annoying. These should remain
   visible during panning. (Note: they should still be hidden during geometry
   editing drags, just not during viewport pan/zoom.)

5. **Don't use Chrome for testing**: The browser preview tool opens Chrome,
   which is not the problem browser. Firefox needs to be tested directly.
   Firefox was not found at standard `/Applications/Firefox.app` path in the
   testing environment — the user will test manually.

---

## Key Terminology

- **Zoom**: In this codebase, `zoom` is a multiplier for the SVG `viewBox`
  size, NOT a pixel-scale factor. `viewBox = {vx, vy, baseViewSize * zoom,
  baseViewSize * zoom}`. **Higher zoom = larger viewBox = see more world =
  zoomed OUT.** **Lower zoom (e.g. 0.1) = smaller viewBox = zoomed IN.**
  The user's "really zoomed in" means `zoom` is low (near 0.1).

- **Pan**: The `{x, y}` center of the viewBox in world coordinates.

- **ViewBox**: The rectangular window of world coordinates displayed in the
  SVG. Computed as `{pan.x - width/2, pan.y - height/2, width, height}` where
  `width = 400 * zoom`.

- **Compositor transform**: Moving an element via CSS `transform` so the
  browser's compositor thread handles it without re-painting. Works well for
  HTML elements (`<div>`, `<img>`, `<svg>` as a whole) but NOT for SVG child
  elements (`<g>`, `<path>`) in Firefox.

- **Transient pan**: The period during which the user is actively panning
  (pointer drag, trackpad scroll, or momentum). The `viewBox` is held stable
  and the SVG element is CSS-transformed instead.

- **Commit**: When the transient pan ends (or exceeds the culling margin),
  the real `pan` state is updated via `setPan()`, which causes React to
  re-render with the new `viewBox` and clear the CSS transform.

- **CULL_MARGIN_RATIO**: 0.22. The viewBox is expanded by this ratio on each
  side so content is pre-rendered beyond the visible edge, allowing the SVG
  to be translated without showing blank areas. The commit threshold is 75%
  of this margin.

- **renderScale**: `1 + 2 * CULL_MARGIN_RATIO` = 1.44. The SVG element is
  sized at `100% * renderScale` of the container and positioned at
  `left: -100% * CULL_MARGIN_RATIO`, `top: -100% * CULL_MARGIN_RATIO`.

- **Performance presets**: Three modes (`live`, `balanced`, `release`) that
  control how much work happens during interactions. `balanced` is the
  default. These currently only address drag performance (editing geometry),
  NOT pan/zoom performance.

- **Segments (`ResolvedSegment`)**: The solved geometry pieces (lane fills,
  ring arcs, connectors, bypasses) that make up the roundabout.

- **Markings**: Semantic road markings (lane lines, edge lines, yield teeth,
  arrows, ring envelopes) generated from segments by `buildMarkings()`.

---

## Architecture: What Was Changed

### File: `src/viewport/Viewport.tsx` (the only modified file)

#### New refs
- `containerRef` — ref to the outer `<div>` container (needed for
  `getBoundingClientRect` since the SVG is now larger than the container)
- `renderedPanRef` — tracks the pan position that was last committed to the
  `viewBox` (used to compute the transient transform delta)

#### New constants
- `CULL_MARGIN_RATIO` changed from 0.06 to 0.22 (wider pre-rendered margin
  for compositor pan)
- `renderScale = 1 + 2 * CULL_MARGIN_RATIO` (1.44) — SVG element scale factor

#### New functions
- `applyTransientPan()` — computes the world-unit delta between
  `renderedPanRef` and `panRef`, converts to screen pixels using
  `svg.clientWidth / (baseViewSize * zoom * renderScale)`, and sets
  `svg.style.transform = translate(dxPx, dyPx)`.
- `commitTransientPan()` — calls `setPan(panRef.current)` to commit the real
  pan position, which triggers React re-render with new viewBox.
- `queuePanPreview()` — rAF-coalesced; either calls `applyTransientPan()` or
  `commitTransientPan()` depending on whether the delta exceeds 75% of the
  culling margin.

#### Modified SVG element
The `<svg>` element changed from:
```jsx
<svg viewBox={`${vx} ${vy} ${width} ${height}`}
     style={{ width: '100%', height: '100%', ... }}>
```
to:
```jsx
<svg viewBox={`${renderVx} ${renderVy} ${renderWidth} ${renderHeight}`}
     style={{
       position: 'absolute',
       width: `${100 * renderScale}%`,
       height: `${100 * renderScale}%`,
       left: `${-100 * CULL_MARGIN_RATIO}%`,
       top: `${-100 * CULL_MARGIN_RATIO}%`,
       willChange: interactionActive ? 'transform' : undefined,
       ...
     }}>
```

The outer container div got `overflow: hidden` and `ref={containerRef}`.

#### Modified event handlers
- **Wheel pan**: now calls `queuePanPreview()` instead of `queueViewUpdate()`
- **Pointer drag pan**: now calls `queuePanPreview()` instead of
  `queueViewUpdate()`
- **Pointer up**: calls `commitTransientPan()` before `setIsDragging(false)`
- **Momentum**: calls `markViewInteraction()` + `queuePanPreview()` each
  frame, and `commitTransientPan()` when momentum ends
- **Pinch zoom**: still uses `queueViewUpdate()` (zoom changes require
  viewBox update)
- **Reset View**: now syncs `zoomRef`/`panRef` before `setZoom`/`setPan`

#### All `getBoundingClientRect()` calls
Changed from `svgRef.current.getBoundingClientRect()` to
`(containerRef.current ?? svgRef.current).getBoundingClientRect()` because
the SVG is now larger than the visible area. This affects:
- Wheel handler (rect for coordinate conversion)
- Pointer move handler (rect for coordinate conversion)
- All FloatingButton anchor calculations (5 locations)

#### Pan performance instrumentation (COMMENTED OUT)
A complete instrumentation system was added and then commented out. It
tracked: frame intervals, viewBox mutations, transform mutations, applies,
commits, momentum frames, wheel events, pointer moves, and per-phase JS
dispatch times. It printed a grouped summary to the console when panning
stopped. To re-enable, uncomment:
1. The `PAN_PERF` block and all `panPerf*` functions (lines ~35-121)
2. `panPerfMark('rAF-apply', ...)` in `applyTransientPan`
3. `panPerfMark('rAF-commit', ...)` in `commitTransientPan`
4. `panPerfMark('layout-effect', ...)` in the layout effect
5. `panPerfRecordFrame()` in `queuePanPreview`'s rAF callback
6. `panPerfStart()` in `markViewInteraction`
7. `panPerfScheduleReport('view-idle')` in the idle timer callback
8. `panPerfScheduleReport('momentum-end')` in momentum end
9. `panPerfMark('momentum', ...)` and `PAN_PERF.momentumFrames++` in momentum
10. `PAN_PERF.wheelEvents++` and `panPerfMark('wheel', ...)` in wheel handler
11. `PAN_PERF.pointerMoves++` and `panPerfMark('pointermove', ...)` in pointermove
12. `panPerfScheduleReport('pointer-up')` in pointer up
13. The `__panPerfInstall` MutationObserver setup effect

---

## What Was NOT Changed (and why)

- **`getScreenCTM()` still works**: `screenToWorld` and `worldToScreen` in
  `src/viewport/transform.ts` use `getScreenCTM()` which accounts for CSS
  transforms, so coordinate conversion remains correct during transient pan.
- **Culling still works**: `visibleBounds` is computed from the committed
  `pan`/`zoom` state, so culling uses the "real" viewBox, not the transient
  one. The expanded viewBox (with margin) means culled content is still
  pre-rendered.
- **Pinch zoom still uses `queueViewUpdate()`**: Zoom changes alter the
  viewBox size, which can't be faked with a translate. This is acceptable
  because pinch zoom is less frequent than pan.
- **Smart zoom animation**: Still uses `setZoom`/`setPan` directly (not
  transient). This is a brief animated transition, not a sustained pan.

---

## Key File Paths

All paths relative to `roundabout-maker/mark 2.5 attempt 1/`:

| File | Role |
|------|------|
| `src/viewport/Viewport.tsx` | **MODIFIED** — compositor pan, all changes here |
| `src/viewport/transform.ts` | `screenToWorld` / `worldToScreen` (unchanged, uses getScreenCTM) |
| `src/canvas/GeometryLayer.tsx` | Renders pavement fills + centerlines (has culling) |
| `src/canvas/MarkingsLayer.tsx` | Renders semantic markings (has culling) |
| `src/canvas/CenterlineLayer.tsx` | Renders road spline guides (has `#road-guide-shadow` filter) |
| `src/canvas/HandlesLayer.tsx` | Renders drag handles for selected elements |
| `src/canvas/LaneProfileLayer.tsx` | Renders lane profile editing controls |
| `src/rendering/bounds.ts` | `boundsIntersect`, `resolvedSegmentBounds`, `markingBounds` |
| `src/rendering/markings.ts` | `buildMarkings()` — generates all markings from segments |
| `src/editor/performance.ts` | Performance presets (`live`, `balanced`, `release`) |
| `src/editor/editorStore.ts` | Zustand store; holds config, selection, drag, settings |
| `src/solver/useSolvedGeometry.ts` | Memoized solver hook (does NOT re-run during pan) |
| `src/utils/hard-roundabout.json` | Complex regression fixture (exported state format) |
| `src/utils/context-pan-performance.md` | **THIS FILE** |

---

## Build / Lint / Test

Run from `roundabout-maker/mark 2.5 attempt 1/`:
- `npm run dev` — Vite dev server
- `npm test` — Vitest (44 tests, all passing)
- `npm run build` — `tsc -b && vite build` (strict TypeScript, passing)
- `npm run lint` — oxlint (0 warnings, 0 errors)

---

## Firefox-Specific Findings

1. **Firefox does NOT compositor-accelerate CSS transforms on SVG child
   elements** (`<g>`, `<path>`). Changing `transform` on a `<g>` inside a
   complex SVG forces a full re-rasterization of all SVG content. Measured:
   92ms p95 per frame.

2. **Firefox PARTIALLY compositor-accelerates CSS transforms on the `<svg>`
   element itself**. Better than `<g>` but still not smooth enough: 62ms p95.
   The `<svg>` is an HTML-level replaced element, so Firefox treats it more
   like an `<img>`, but the complex internal content still causes overhead.

3. **Chrome handles both approaches fine** (~8ms p95 at 120Hz). The
   compositor-transform approach is not needed on Chrome but doesn't hurt.

4. **JS dispatch is never the bottleneck**. Wheel event handling, React
   state updates, and transform application all take <1ms per call. The
   entire bottleneck is browser-side SVG rasterization/compositing.

5. **The existing viewport culling (already present before this work) is
   not the bottleneck either**. Hiding all geometry/markings/background
   made no measurable difference in frame times on Chrome. The issue is
   Firefox's rasterization of the visible complex SVG content itself.

---

## Constraints

- **Stack**: Vite + React 19 + TypeScript + Zustand + SVG. No canvas/WebGL
  currently — everything is SVG `<path>` elements. The proposed WebGL
  approach would be the first non-SVG rendering.
- **Do NOT assume a single roundabout**: The data model supports one config
  currently but is designed for multiple roundabouts. Avoid global lookups.
- **"Outermost ring" is ambiguous**: Default config has two offset rings
  with equal `radius + width/2`. Clearance checks must iterate ALL rings.
- **The hard-roundabout.json fixture is in exported state format**: It's a
  JSON object with keys like `roundabout_config` (stringified JSON),
  `roundabout_pan`, `roundabout_zoom`, etc. These are loaded into
  localStorage and the page is refreshed. See `src/ui/Sidebar.tsx`
  `handleImportFile` for the import logic.
- **Firefox is not at standard path in the dev environment**: The user will
  test Firefox manually. Don't rely on automated Firefox testing.
- **Don't open Chrome browser preview for Firefox testing**: The
  `browser_preview` tool opens Chrome. The user finds this unhelpful for
  Firefox-specific work.

---

## Suggested Implementation Plan for the New Thread

1. **Implement WebGL/canvas rasterization overlay for Firefox pan**:
   - On pan start (Firefox only, configurable): rasterize the current SVG
     to a bitmap (e.g. `svgToImage` via `XMLSerializer` + `Image` or
     `canvas.drawImage`).
   - Display the bitmap as a positioned `<img>` or `<canvas>` element with
     CSS transform for smooth compositor panning.
   - Hide or simplify the live SVG during pan.
   - On pan end: swap back to the live SVG, commit the real viewBox.

2. **Browser detection + configuration**:
   - Detect Firefox (e.g. `navigator.userAgent.includes('Firefox')` or
     feature detection).
   - Add a setting to `editorStore.ts` settings (e.g.
     `panRenderingMode: 'auto' | 'svg-transform' | 'raster-overlay'`).
   - `auto` = use raster overlay on Firefox, svg-transform on Chrome.

3. **Keep gizmos visible during pan**:
   - Currently `viewDetailsEnabled` and `effectsEnabled` are false during
     `viewInteracting` (which includes pan).
   - Separate pan-interaction from edit-interaction: pan should NOT hide
     handles/profile controls. Only geometry editing drags should.
   - The `interactionActive` flag is `Boolean(activeDrag?.active) ||
     isDragging || viewInteracting`. Pan uses `isDragging` and
     `viewInteracting`. Editing uses `activeDrag?.active`.
   - Consider: `effectsEnabled` should be true during pan (just not during
     active geometry drag). `viewDetailsEnabled` should be true during pan.

4. **Test on Firefox manually** with hard-roundabout.json at zoom=0.1.

5. **Re-enable pan-perf instrumentation** (uncomment) if needed for
   measurement, then comment it back out when done.

6. **Run tests, lint, build** after changes.
