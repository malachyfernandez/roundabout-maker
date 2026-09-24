import React from 'react';
import { type RoundaboutConfig } from '../config/types';
import { type ResolvedSegment, solveGeometry } from '../core/solver';
import { compileRoutes } from '../core/routes';
import { generateVariableWidthPath } from '../rendering/segmentPath';
import { MarkingsLayer } from '../canvas/MarkingsLayer';
import { resolvedSegmentBounds, offsetBounds, boundsFromPoints, type Bounds } from '../rendering/bounds';
import { getRoadProfile } from '../core/profile';
import { atProfileDistance, profileGeometry } from '../profile/worldGeometry';
import { pointsToSvgPath, splineToSvgPath } from '../math/spline';
import { useEditorStore, type Settings } from '../editor/editorStore';
import { PERFORMANCE_PRESETS } from '../editor/performance';

/**
 * Every preview renders the user's actual roundabout (committedConfig) through
 * the real pipeline: compileRoutes -> solveGeometry -> the same pavement paths
 * as GeometryLayer, the real MarkingsLayer, and guide paths computed with the
 * same profileGeometry/getRoadProfile logic as CenterlineLayer. Nothing here
 * invents geometry — the miniatures are exact copies of the canvas.
 */

type SolvedScene = { segments: ResolvedSegment[]; bounds: Bounds };
const sceneCache = new WeakMap<RoundaboutConfig, SolvedScene>();

function solvePreviewScene(config: RoundaboutConfig): SolvedScene {
  const cached = sceneCache.get(config);
  if (cached) return cached;
  let segments: ResolvedSegment[] = [];
  try {
    segments = solveGeometry(config, compileRoutes(config, { profileEnabled: true, bypassEnabled: true, sampleCount: 90 }));
  } catch {
    segments = [];
  }
  const c = config.island.center;
  const r = config.island.radius;
  let minX = c.x - r, minY = c.y - r, maxX = c.x + r, maxY = c.y + r;
  const grow = (b: Bounds) => {
    minX = Math.min(minX, b.minX);
    minY = Math.min(minY, b.minY);
    maxX = Math.max(maxX, b.maxX);
    maxY = Math.max(maxY, b.maxY);
  };
  // Segment geometry is island-relative; arm nodes are world coords.
  for (const seg of segments) grow(offsetBounds(resolvedSegmentBounds(seg), c));
  for (const arm of config.arms) for (const n of arm.nodes) grow(boundsFromPoints([n.point], 4));
  const pad = Math.max(8, (maxX - minX + maxY - minY) * 0.04);
  const scene: SolvedScene = {
    segments,
    bounds: { minX: minX - pad, minY: minY - pad, maxX: maxX + pad, maxY: maxY + pad }
  };
  sceneCache.set(config, scene);
  return scene;
}

const usePreviewScene = () => {
  const config = useEditorStore(s => s.committedConfig);
  const scene = React.useMemo(() => solvePreviewScene(config), [config]);
  return { config, ...scene };
};

/** Fit bounds into a target aspect ratio by expanding the shorter axis. */
type FitView = { x: number; y: number; w: number; h: number };
const fitView = (b: Bounds, aspect: number): FitView => {
  const cx = (b.minX + b.maxX) / 2;
  const cy = (b.minY + b.maxY) / 2;
  let w = Math.max(1, b.maxX - b.minX);
  let h = Math.max(1, b.maxY - b.minY);
  if (w / h > aspect) h = w / aspect; else w = h * aspect;
  return { x: cx - w / 2, y: cy - h / 2, w, h };
};

/**
 * Road guides rendered exactly like an unselected arm in CenterlineLayer:
 * the "propper road" middle path (profileGeometry trimmed to the end caps),
 * same hsl color, dash pattern and feDropShadow formula.
 */
const SceneGuides: React.FC<{ config: RoundaboutConfig; zoom: number; opacity?: number }> = ({ config, zoom, opacity = 1 }) => {
  const lightness = useEditorStore(s => s.settings.roadGuideLightness);
  const strength = useEditorStore(s => s.settings.roadGuideShadowStrength);
  const blur = useEditorStore(s => s.settings.roadGuideShadowBlur);
  const offsetY = useEditorStore(s => s.settings.roadGuideShadowOffsetY);
  const filterId = React.useId().replace(/[^a-zA-Z0-9]/g, '');
  const color = `hsl(221, 83%, ${lightness}%)`;

  const paths = config.arms.map(arm => {
    if (arm.nodes.length < 2) return null;
    const spline = { points: arm.nodes.map(n => n.point), nodes: arm.nodes, alpha: 0.5, tension: 0 };
    let d: string;
    try {
      const geometry = profileGeometry(arm);
      const profile = getRoadProfile(arm, geometry.totalLength);
      const startCap = profile.find(p => p.endAnchor === 'start') ?? profile[0];
      const endCap = profile.find(p => p.endAnchor === 'end') ?? profile[profile.length - 1];
      const startDistance = Math.max(0, Math.min(geometry.totalLength, startCap?.distance ?? 0));
      const endDistance = Math.max(startDistance, Math.min(geometry.totalLength, endCap?.distance ?? geometry.totalLength));
      const start = atProfileDistance(geometry, startDistance).p;
      const end = atProfileDistance(geometry, endDistance).p;
      const middle = geometry.samples.filter(s => s.distance > startDistance && s.distance < endDistance).map(s => s.p);
      d = pointsToSvgPath([start, ...middle, end]);
    } catch {
      d = splineToSvgPath(spline);
    }
    return { id: arm.id, d };
  });

  return (
    <g pointerEvents="none" opacity={opacity}>
      <defs>
        <filter id={`pg${filterId}`} x="-40%" y="-40%" width="180%" height="180%">
          <feDropShadow dx={0} dy={offsetY * zoom} stdDeviation={blur * zoom * Math.max(0, strength)} floodColor="#000" floodOpacity={Math.min(1, Math.max(0, strength))} />
        </filter>
      </defs>
      {paths.map(p => p && (
        <path
          key={p.id}
          d={p.d}
          fill="none"
          stroke={color}
          strokeWidth={1.25 * zoom}
          strokeDasharray={`${5 * zoom} ${5 * zoom}`}
          filter={strength > 0 ? `url(#pg${filterId})` : undefined}
        />
      ))}
    </g>
  );
};

const HUGE_BOUNDS: Bounds = { minX: -1e6, minY: -1e6, maxX: 1e6, maxY: 1e6 };

/**
 * The canonical editor look: gray pavement + island (GeometryLayer's rendered
 * appearance), real MarkingsLayer output, and real guide paths on top —
 * the same layer order as the Viewport svg.
 */
const SceneContent: React.FC<{
  config: RoundaboutConfig;
  segments: ResolvedSegment[];
  zoom: number;
  markingsOpacity?: number;
  guidesOpacity?: number;
}> = ({ config, segments, zoom, markingsOpacity = 1, guidesOpacity = 1 }) => {
  const c = config.island.center;
  return (
    <g pointerEvents="none">
      <g transform={`translate(${c.x}, ${c.y})`}>
        <circle cx={0} cy={0} r={config.island.radius} fill="#ccc" stroke="#999" strokeWidth={0.5} />
        {segments.map(seg => (
          <path key={`${seg.routeId}-${seg.segIndex}`} d={generateVariableWidthPath(seg)} fill="#555" />
        ))}
      </g>
      <g opacity={markingsOpacity}>
        <MarkingsLayer config={config} segments={segments} defer={false} visibleBounds={HUGE_BOUNDS} />
      </g>
      <SceneGuides config={config} zoom={zoom} opacity={guidesOpacity} />
    </g>
  );
};

const PREVIEW_ASPECT = 2.15;

/** Full real-render scene fitted into the preview card. */
export const ScenePreview: React.FC<{
  markingsOpacity?: number;
  guidesOpacity?: number;
  overlay?: (zoom: number) => React.ReactNode;
}> = ({ markingsOpacity, guidesOpacity, overlay }) => {
  const { config, segments, bounds } = usePreviewScene();
  const view = fitView(bounds, PREVIEW_ASPECT);
  const zoom = view.w / 400; // same semantics as Viewport: world units per 400px
  return (
    <svg viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`} className="sp-preview-svg">
      <SceneContent config={config} segments={segments} zoom={zoom} markingsOpacity={markingsOpacity} guidesOpacity={guidesOpacity} />
      {overlay?.(zoom)}
    </svg>
  );
};

export const GuidesPreview: React.FC<{ settings: Settings }> = () => (
  <ScenePreview markingsOpacity={0.35} />
);

export const MarkingsPreview: React.FC<{ settings: Settings }> = () => (
  <ScenePreview guidesOpacity={0.3} />
);

export const YieldPreview: React.FC<{ settings: Settings }> = () => (
  <ScenePreview guidesOpacity={0.3} />
);

export const PerformancePreview: React.FC<{ settings: Settings }> = ({ settings }) => {
  const policy = PERFORMANCE_PRESETS[settings.performancePreset].policy;
  const config = useEditorStore(s => s.committedConfig);
  const d = React.useMemo(() => {
    const arm = config.arms.find(a => a.nodes.length >= 2);
    if (!arm) return '';
    return splineToSvgPath({ points: arm.nodes.map(n => n.point), nodes: arm.nodes, alpha: 0.5, tension: 0 });
  }, [config]);
  const chips: { label: string; live: boolean }[] = [
    { label: 'Controls', live: true },
    { label: 'Geometry', live: policy.solveDuringDrag },
    { label: 'Markings', live: policy.markingsDuringDrag },
    { label: 'Effects', live: policy.effectsDuringInteraction }
  ];
  return (
    <div>
      <ScenePreview
        markingsOpacity={policy.markingsDuringDrag ? 1 : 0.15}
        overlay={zoom => d ? (
          <circle r={5.5 * zoom} fill="#fff" stroke="#2563eb" strokeWidth={1.8 * zoom}>
            <animateMotion dur="2.8s" repeatCount="indefinite" path={d} />
          </circle>
        ) : null}
      />
      <div className="sp-perf-chips">
        {chips.map(chip => (
          <span key={chip.label} className={`sp-perf-chip${chip.live ? ' live' : ''}`}>
            <i />{chip.label}<em>{chip.live ? 'live' : 'on release'}</em>
          </span>
        ))}
      </div>
    </div>
  );
};

/**
 * Interactive mini-viewport over the real scene: wheel pans (panSensitivity),
 * ctrl/⌘-wheel or pinch zooms toward the cursor (zoomSensitivity), drag pans.
 * With smart zoom on, the view eases back to keep a selected node inside the
 * margins — the same keepRangeVisible behavior as the real viewport.
 */
const NAV_W = 320;
const NAV_H = 132;

export const NavigationPreview: React.FC<{ settings: Settings }> = ({ settings }) => {
  const { config, segments, bounds } = usePreviewScene();
  const world = React.useMemo(() => ({
    w: Math.max(1, bounds.maxX - bounds.minX),
    h: Math.max(1, bounds.maxY - bounds.minY)
  }), [bounds]);
  const initialView = React.useMemo(() => {
    const k = Math.min(NAV_W / world.w, NAV_H / world.h) * 0.94;
    return { x: (NAV_W - world.w * k) / 2, y: (NAV_H - world.h * k) / 2, k };
  }, [world]);
  // A real node smart-zoom keeps in view — the last node of the first arm.
  const control = React.useMemo(() => {
    const arm = config.arms.find(a => a.nodes.length > 0);
    return arm ? arm.nodes[arm.nodes.length - 1].point : config.island.center;
  }, [config]);

  const [{ x, y, k }, setViewState] = React.useState(initialView);
  const viewRef = React.useRef({ x, y, k });
  const [snapping, setSnapping] = React.useState(false);
  const snapTimer = React.useRef<number | null>(null);
  const idleTimer = React.useRef<number | null>(null);
  const [settleTick, setSettleTick] = React.useState(0);
  const dragRef = React.useRef<{ x: number; y: number } | null>(null);
  const boxRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => setView(initialView), [initialView]);

  const setView = (v: { x: number; y: number; k: number }) => {
    viewRef.current = v;
    setViewState(v);
  };

  const scheduleSettle = () => {
    if (idleTimer.current !== null) window.clearTimeout(idleTimer.current);
    idleTimer.current = window.setTimeout(() => setSettleTick(t => t + 1), 600);
  };

  const kMin = initialView.k * 0.4;
  const kMax = initialView.k * 4;
  const guideZoom = NAV_W / (400 * k); // world units per 400px, same as Viewport
  const nodeR = 5.5 / k; // constant on-screen size

  // Smart zoom: once the user settles (or the toggle turns on), ease the view
  // back so the selected control stays inside an 18% safe margin.
  React.useEffect(() => {
    if (!settings.smartZoom) return;
    const v = viewRef.current;
    const margin = 0.18;
    const clampAxis = (cv: number, size: number) => Math.max(size * margin, Math.min(size * (1 - margin), cv));
    const csx = (control.x - bounds.minX) * v.k + v.x;
    const csy = (control.y - bounds.minY) * v.k + v.y;
    const tx = v.x + (clampAxis(csx, NAV_W) - csx);
    const ty = v.y + (clampAxis(csy, NAV_H) - csy);
    if (Math.abs(tx - v.x) > 0.5 || Math.abs(ty - v.y) > 0.5) {
      setSnapping(true);
      setView({ x: tx, y: ty, k: v.k });
      if (snapTimer.current !== null) window.clearTimeout(snapTimer.current);
      snapTimer.current = window.setTimeout(() => setSnapping(false), 480);
    }
  }, [settleTick, settings.smartZoom, control, bounds]);

  React.useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      setSnapping(false);
      const v = viewRef.current;
      const rect = el.getBoundingClientRect();
      const cxp = e.clientX - rect.left;
      const cyp = e.clientY - rect.top;
      if (e.ctrlKey) {
        const intensity = Math.min(Math.abs(e.deltaY) / 80, 2);
        const factor = e.deltaY > 0 ? 1 + settings.zoomSensitivity * intensity : 1 - settings.zoomSensitivity * intensity;
        const k2 = Math.max(kMin, Math.min(kMax, v.k * factor));
        setView({ x: cxp - (cxp - v.x) * (k2 / v.k), y: cyp - (cyp - v.y) * (k2 / v.k), k: k2 });
      } else {
        setView({ x: v.x - e.deltaX * settings.panSensitivity, y: v.y - e.deltaY * settings.panSensitivity, k: v.k });
      }
      scheduleSettle();
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [settings.zoomSensitivity, settings.panSensitivity, kMin, kMax]);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    setSnapping(false);
    dragRef.current = { x: e.clientX, y: e.clientY };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    const v = viewRef.current;
    setView({
      x: v.x + (e.clientX - dragRef.current.x) * settings.panSensitivity,
      y: v.y + (e.clientY - dragRef.current.y) * settings.panSensitivity,
      k: v.k
    });
    dragRef.current = { x: e.clientX, y: e.clientY };
  };
  const onPointerEnd = () => {
    if (!dragRef.current) return;
    dragRef.current = null;
    scheduleSettle();
  };

  return (
    <div
      ref={boxRef}
      className="sp-nav-preview"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
    >
      <div
        className={`sp-nav-world${snapping ? ' snapping' : ''}`}
        style={{ transform: `translate(${x}px, ${y}px) scale(${k})` }}
      >
        <svg
          viewBox={`${bounds.minX} ${bounds.minY} ${world.w} ${world.h}`}
          width={world.w}
          height={world.h}
        >
          <SceneContent config={config} segments={segments} zoom={guideZoom} />
          {/* the "selected" node smart zoom keeps in view */}
          <circle cx={control.x} cy={control.y} r={11 / k} fill="rgba(37,99,235,.15)" />
          <circle cx={control.x} cy={control.y} r={nodeR} fill="#fff" stroke="#2563eb" strokeWidth={1.8 / k} />
        </svg>
      </div>
      <span className="sp-nav-hint">scroll to pan · ⌃/pinch to zoom · drag to move</span>
    </div>
  );
};
