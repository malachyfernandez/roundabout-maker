import React, { useState, useRef } from 'react';
import { Trash2 } from 'lucide-react';
import { type ArmConfig, type RoundaboutConfig, type SelectionTarget } from '../config/types';
import { type ResolvedSegment } from '../core/solver';
import { useEditorStore } from '../editor/editorStore';
import { GeometryLayer } from '../canvas/GeometryLayer';
import { HandlesLayer } from '../canvas/HandlesLayer';
import { LaneProfileLayer } from '../canvas/LaneProfileLayer';
import { CenterlineLayer } from '../canvas/CenterlineLayer';
import { MarkingsLayer } from '../canvas/MarkingsLayer';
import { FloatingButton } from '../ui/FloatingButton';
import { BackgroundPanel } from '../ui/BackgroundPanel';
import { DELETE_SHORTCUT, matchesShortcut } from '../ui/keyboard';
import { screenToWorld, worldToScreen } from './transform';
import { type Vec2, add, len, scale, sub } from '../math/vector';
import { connectBypassLanes, isRightTurnPair } from '../core/bypass';
import { removeArmNode, removeRing } from '../editor/constraints';
import { resolveLaneRing } from '../core/routes';
import { addProfilePoint, estimateArmLength, getRoadProfile, laneBounds, removeProfileLane, removeProfileLanePoint, removeProfileLaneSegment, removeProfilePoint } from '../core/profile';
import { findLanePoint } from '../core/profile/authored';
import { sampleSpline } from '../math/spline';
import { profileSideOuter } from '../profile/editorMath';
import { atProfileDistance, profileDirectionSign, profileGeometry, projectProfileDistance } from '../profile/worldGeometry';
import { performancePolicy } from '../editor/performance';
import { deleteSelectionTargets, hasDeletableSelection } from '../editor/selectionMutations';
import { focusedArmIds } from '../editor/selection';

type Props = {
  renderConfig: RoundaboutConfig;
  segments: ResolvedSegment[];
};

const DEFAULT_BACKGROUND = '/default-background.png';
const PASS_THROUGH_EXIT_TOLERANCE = 12;
const SMART_FOCUS_ZOOM = 0.30;
const SMART_ZOOM_MARGIN = 0.14;
const SMART_ZOOM_DURATION = 280;
const CULL_MARGIN_RATIO = 0.22;

// ---- Pan performance instrumentation (temporary diagnostic, commented out) ----
// To re-enable: uncomment this block and all panPerf* call sites below.
// See docs/context-pan-performance.md at the project root for full details.
//
// type PanPerfSample = {
//   phase: 'wheel' | 'pointermove' | 'rAF-apply' | 'rAF-commit' | 'layout-effect' | 'momentum';
//   ms: number;
// };
// type PanPerfState = {
//   active: boolean;
//   startedAt: number;
//   lastFrameTs: number;
//   frameIntervals: number[];
//   samples: PanPerfSample[];
//   viewBoxMutations: number;
//   transformMutations: number;
//   commits: number;
//   applies: number;
//   wheelEvents: number;
//   pointerMoves: number;
//   momentumFrames: number;
//   idleTimer: number | null;
// };
// const PAN_PERF: PanPerfState = {
//   active: false, startedAt: 0, lastFrameTs: 0, frameIntervals: [], samples: [],
//   viewBoxMutations: 0, transformMutations: 0, commits: 0, applies: 0,
//   wheelEvents: 0, pointerMoves: 0, momentumFrames: 0, idleTimer: null,
// };
// const panPerfStart = () => {
//   if (!PAN_PERF.active) {
//     PAN_PERF.active = true; PAN_PERF.startedAt = performance.now(); PAN_PERF.lastFrameTs = performance.now();
//     PAN_PERF.frameIntervals = []; PAN_PERF.samples = [];
//     PAN_PERF.viewBoxMutations = 0; PAN_PERF.transformMutations = 0; PAN_PERF.commits = 0;
//     PAN_PERF.applies = 0; PAN_PERF.wheelEvents = 0; PAN_PERF.pointerMoves = 0; PAN_PERF.momentumFrames = 0;
//     console.log('%c[pan-perf] recording started', 'color:#2563eb;font-weight:bold');
//   }
//   if (PAN_PERF.idleTimer !== null) { clearTimeout(PAN_PERF.idleTimer); PAN_PERF.idleTimer = null; }
// };
// const panPerfRecordFrame = () => {
//   const now = performance.now();
//   if (PAN_PERF.lastFrameTs) PAN_PERF.frameIntervals.push(now - PAN_PERF.lastFrameTs);
//   PAN_PERF.lastFrameTs = now;
// };
// const panPerfSample = (phase: PanPerfSample['phase'], ms: number) => {
//   if (!PAN_PERF.active) return;
//   PAN_PERF.samples.push({ phase, ms });
// };
// const panPerfScheduleReport = (reason: string) => {
//   if (!PAN_PERF.active) return;
//   if (PAN_PERF.idleTimer !== null) clearTimeout(PAN_PERF.idleTimer);
//   PAN_PERF.idleTimer = window.setTimeout(() => {
//     PAN_PERF.idleTimer = null; PAN_PERF.active = false;
//     const dur = performance.now() - PAN_PERF.startedAt;
//     const fi = [...PAN_PERF.frameIntervals].sort((a, b) => a - b);
//     const q = (a: number[]) => (a.length ? a[Math.floor(a.length * 0.95)] : 0);
//     const byPhase = (p: PanPerfSample['phase']) => PAN_PERF.samples.filter(s => s.phase === p).map(s => s.ms);
//     const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
//     const fmt = (a: number[]) => a.length ? `n=${a.length} total=${sum(a).toFixed(1)}ms p95=${q([...a].sort((x, y) => x - y)).toFixed(2)}ms max=${Math.max(...a).toFixed(2)}ms` : 'n=0';
//     console.group(`%c[pan-perf] report (${reason}) — ${dur.toFixed(0)}ms total`, 'color:#16a34a;font-weight:bold');
//     console.log('frame intervals:', fmt(fi), `over20ms=${fi.filter(x => x > 20).length}/${fi.length}`);
//     console.log('viewBox mutations:', PAN_PERF.viewBoxMutations, '| transform mutations:', PAN_PERF.transformMutations);
//     console.log('applies:', PAN_PERF.applies, '| commits:', PAN_PERF.commits, '| momentumFrames:', PAN_PERF.momentumFrames);
//     console.log('wheel events:', PAN_PERF.wheelEvents, '| pointer moves:', PAN_PERF.pointerMoves);
//     console.log('wheel dispatch:', fmt(byPhase('wheel')));
//     console.log('pointermove dispatch:', fmt(byPhase('pointermove')));
//     console.log('rAF applyTransientPan:', fmt(byPhase('rAF-apply')));
//     console.log('rAF commitTransientPan:', fmt(byPhase('rAF-commit')));
//     console.log('layout-effect:', fmt(byPhase('layout-effect')));
//     console.log('momentum step:', fmt(byPhase('momentum')));
//     console.groupEnd();
//   }, 500);
// };
// const panPerfMark = (phase: PanPerfSample['phase'], fn: () => void) => {
//   if (!PAN_PERF.active) { fn(); return; }
//   const s = performance.now(); fn(); panPerfSample(phase, performance.now() - s);
// };
// (window as unknown as { __panPerfInstall?: (svg: SVGSVGElement) => void }).__panPerfInstall = (svg: SVGSVGElement) => {
//   if ((svg as unknown as { __panPerfObserved?: boolean }).__panPerfObserved) return;
//   (svg as unknown as { __panPerfObserved?: boolean }).__panPerfObserved = true;
//   const obs = new MutationObserver(records => {
//     for (const r of records) {
//       if (r.attributeName === 'viewBox') PAN_PERF.viewBoxMutations++;
//       if (r.attributeName === 'style') PAN_PERF.transformMutations++;
//     }
//   });
//   obs.observe(svg, { attributes: true });
// };


const hitTestTargets = (x: number, y: number, passThroughStack: string[]) => {
  const elements = document.elementsFromPoint(x, y);
  const targetElement = elements.find(element => {
    const target = element.getAttribute('data-target');
    return target && !passThroughStack.includes(target);
  }) ?? null;
  return { elements, targetElement, target: targetElement?.getAttribute('data-target') ?? null };
};

const isTooltipElement = (element: Element) =>
  element.hasAttribute('data-tooltip-error') ||
  element.hasAttribute('data-tooltip') ||
  element.hasAttribute('data-target') ||
  element.hasAttribute('data-handle') ||
  element instanceof HTMLButtonElement ||
  element instanceof HTMLInputElement ||
  element instanceof HTMLSelectElement;

const profilePointPosition = (arm: ArmConfig, pointId: string) => {
  const point = getRoadProfile(arm, estimateArmLength(arm)).find(candidate => candidate.id === pointId);
  if (!point) return null;
  const samples = sampleSpline({ points: arm.nodes.map(node => node.point), nodes: arm.nodes, alpha: 0.5, tension: 0 }, Math.max(120, arm.nodes.length * 60));
  if (!samples.length) return null;
  let distance = 0;
  for (let index = 1; index < samples.length; index++) {
    const segmentLength = len(sub(samples[index].p, samples[index - 1].p));
    if (distance + segmentLength >= point.distance) {
      const t = segmentLength ? (point.distance - distance) / segmentLength : 0;
      return {
        x: samples[index - 1].p.x + (samples[index].p.x - samples[index - 1].p.x) * t,
        y: samples[index - 1].p.y + (samples[index].p.y - samples[index - 1].p.y) * t
      };
    }
    distance += segmentLength;
  }
  return samples[samples.length - 1].p;
};

const laneNodePosition = (arm: ArmConfig, config: RoundaboutConfig, pointId: string, dir: 'in' | 'out', laneIndex: number) => {
  const geometry = profileGeometry(arm);
  const point = findLanePoint(arm, getRoadProfile(arm, geometry.totalLength), dir, laneIndex, pointId);
  if (!point || !geometry.samples.length) return null;
  const bounds = laneBounds(point, dir, laneIndex);
  const location = atProfileDistance(geometry, point.distance);
  return add(location.p, scale(location.normal, profileDirectionSign(config, dir) * (bounds.inner + (bounds.outer - bounds.inner) / 2)));
};

export const Viewport: React.FC<Props> = ({ renderConfig, segments }) => {
  const getStored = <T,>(key: string, fallback: T): T => {
    const saved = localStorage.getItem(key);
    if (saved) try { return JSON.parse(saved) as T; } catch {}
    return fallback;
  };

  const [bgImage, setBgImage] = useState<string | null>(() => {
    const saved = localStorage.getItem('roundabout_bg');
    return saved === 'none' ? null : saved || DEFAULT_BACKGROUND;
  });
  const [bgOpacity, setBgOpacity] = useState(() => getStored('roundabout_bgOp', 0.5));
  const [bgRect, setBgRect] = useState<{ x: number; y: number; w: number; h: number }>(() => {
    const saved = getStored<{ x: number; y: number; w: number; h: number } | null>('roundabout_bgRect', null);
    if (saved && saved.w > 0 && saved.h > 0) return saved;
    const legacy = getStored('roundabout_bgSize', 200);
    return { x: -legacy / 2, y: -legacy / 2, w: legacy, h: legacy };
  });
  const [calibPoints, setCalibPoints] = useState<Vec2[]>([]);
  const [calibFeet, setCalibFeet] = useState('');
  const bgAspectRef = useRef(1);
  const [pan, setPan] = useState(() => getStored('roundabout_pan', { x: 0, y: 0 }));
  const [zoom, setZoom] = useState(() => getStored('roundabout_zoom', 1));
  const panRef = useRef(pan);
  const zoomRef = useRef(zoom);
  const viewAnimationRef = useRef<number | null>(null);
  const viewUpdateRef = useRef<number | null>(null);
  const viewIdleTimerRef = useRef<number | null>(null);
  const hoverFrameRef = useRef<number | null>(null);

  React.useEffect(() => {
    const reset = () => {
      if (viewAnimationRef.current !== null) cancelAnimationFrame(viewAnimationRef.current);
      if (viewUpdateRef.current !== null) cancelAnimationFrame(viewUpdateRef.current);
      viewAnimationRef.current = null;
      viewUpdateRef.current = null;
      panRef.current = { x: 0, y: 0 };
      zoomRef.current = 1;
      setBgImage(DEFAULT_BACKGROUND);
      setBgOpacity(0.5);
      setBgRect({ x: -100, y: -100 / bgAspectRef.current, w: 200, h: 200 / bgAspectRef.current });
      setPan({ x: 0, y: 0 });
      setZoom(1);
    };
    window.addEventListener('roundabout-reset', reset);
    return () => window.removeEventListener('roundabout-reset', reset);
  }, []);

  React.useEffect(() => { localStorage.setItem('roundabout_bg', bgImage ?? 'none'); }, [bgImage]);
  React.useEffect(() => { localStorage.setItem('roundabout_bgOp', JSON.stringify(bgOpacity)); }, [bgOpacity]);
  React.useEffect(() => { localStorage.setItem('roundabout_bgRect', JSON.stringify(bgRect)); }, [bgRect]);

  // Keep the rendered rect true to the image's own aspect ratio.
  React.useEffect(() => {
    if (!bgImage) return;
    const img = new Image();
    img.onload = () => {
      if (!img.naturalWidth || !img.naturalHeight) return;
      const aspect = img.naturalWidth / img.naturalHeight;
      bgAspectRef.current = aspect;
      setBgRect(rect => {
        const h = rect.w / aspect;
        if (Math.abs(rect.h - h) < 1e-9) return rect;
        return { ...rect, y: rect.y + (rect.h - h) / 2, h };
      });
    };
    img.src = bgImage;
  }, [bgImage]);

  React.useEffect(() => {
    const resetView = () => {
      if (viewAnimationRef.current !== null) cancelAnimationFrame(viewAnimationRef.current);
      viewAnimationRef.current = null;
      zoomRef.current = 1;
      panRef.current = { x: 0, y: 0 };
      setZoom(1);
      setPan({ x: 0, y: 0 });
    };
    window.addEventListener('roundabout-reset-view', resetView);
    return () => window.removeEventListener('roundabout-reset-view', resetView);
  }, []);
  React.useEffect(() => {
    const timeout = window.setTimeout(() => {
      localStorage.setItem('roundabout_pan', JSON.stringify(pan));
      localStorage.setItem('roundabout_zoom', JSON.stringify(zoom));
    }, 180);
    return () => clearTimeout(timeout);
  }, [pan, zoom]);

  const [isDragging, setIsDragging] = useState(false);
  const [viewInteracting, setViewInteracting] = useState(false);
  const lastMouseRef = useRef({ x: 0, y: 0 });
  const panMouseRef = useRef({ x: 0, y: 0 });
  const clickSelectRef = useRef<{ target: SelectionTarget; x: number; y: number } | null>(null);
  const passThroughContactRef = useRef<{ x: number; y: number } | null>(null);
  const pointerOverCanvasRef = useRef(false);
  
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const setSelection = useEditorStore(state => state.setSelection);
  const selectTarget = useEditorStore(state => state.selectTarget);
  const setHovered = useEditorStore(state => state.setHovered);
  const activeDrag = useEditorStore(state => state.drag);
  const committedConfig = useEditorStore(state => state.committedConfig);
  const draftConfig = useEditorStore(state => state.draftConfig);
  const setCommittedConfig = useEditorStore(state => state.setCommittedConfig);
  const selection = useEditorStore(state => state.selection);
  const selections = useEditorStore(state => state.selections);
  const viewMode = useEditorStore(state => state.viewMode);
  const activeTool = useEditorStore(state => state.activeTool);
  const setActiveTool = useEditorStore(state => state.setActiveTool);
  const pendingRoadStart = useEditorStore(state => state.pendingRoadStart);
  const setPendingRoadStart = useEditorStore(state => state.setPendingRoadStart);
  const pendingBypassSource = useEditorStore(state => state.pendingBypassSource);
  const setPendingBypassSource = useEditorStore(state => state.setPendingBypassSource);
  const settings = useEditorStore(state => state.settings);
  const pushPassThrough = useEditorStore(state => state.pushPassThrough);
  const clearPassThrough = useEditorStore(state => state.clearPassThrough);
  const addToast = useEditorStore(state => state.addToast);
  const [toolPointer, setToolPointer] = useState<Vec2 | null>(null);
  const modalToolActive = activeTool === 'add-road' || activeTool === 'add-ring' || activeTool === 'connect-bypass' || activeTool === 'calibrate-bg';

  const baseViewSize = 400;
  const width = baseViewSize * zoom;
  const height = baseViewSize * zoom;
  const vx = pan.x - width / 2;
  const vy = pan.y - height / 2;
  const visibleBounds = React.useMemo(() => {
    const margin = Math.max(width, height) * CULL_MARGIN_RATIO;
    return {
      minX: vx - margin,
      minY: vy - margin,
      maxX: vx + width + margin,
      maxY: vy + height + margin
    };
  }, [height, vx, vy, width]);
  const policy = performancePolicy(settings.performancePreset);
  const roadFocused = focusedArmIds(selections).size > 0;
  const interactionActive = Boolean(activeDrag?.active) || isDragging || viewInteracting;
  const effectsEnabled = policy.effectsDuringInteraction || !interactionActive;
  const viewDetailsEnabled = policy.effectsDuringInteraction || (!isDragging && !viewInteracting);

  const queueViewUpdate = React.useCallback(() => {
    if (viewUpdateRef.current !== null) return;
    viewUpdateRef.current = requestAnimationFrame(() => {
      viewUpdateRef.current = null;
      setZoom(zoomRef.current);
      setPan(panRef.current);
    });
  }, []);

  const markViewInteraction = React.useCallback(() => {
    // panPerfStart();
    setViewInteracting(true);
    if (viewIdleTimerRef.current !== null) clearTimeout(viewIdleTimerRef.current);
    viewIdleTimerRef.current = window.setTimeout(() => {
      viewIdleTimerRef.current = null;
      setViewInteracting(false);
      // panPerfScheduleReport('view-idle');
    }, 140);
  }, []);

  React.useEffect(() => () => {
    if (viewUpdateRef.current !== null) cancelAnimationFrame(viewUpdateRef.current);
    if (hoverFrameRef.current !== null) cancelAnimationFrame(hoverFrameRef.current);
    if (viewIdleTimerRef.current !== null) clearTimeout(viewIdleTimerRef.current);
  }, []);

  const cancelViewAnimation = React.useCallback(() => {
    if (viewAnimationRef.current !== null) cancelAnimationFrame(viewAnimationRef.current);
    viewAnimationRef.current = null;
  }, []);

  const smartZoom = React.useCallback((points: Vec2[], mode: 'focus' | 'fit') => {
    if (!settings.smartZoom || points.length === 0) return;
    const currentPan = panRef.current;
    const currentZoom = zoomRef.current;
    const safeHalfSize = baseViewSize * currentZoom * (0.5 - SMART_ZOOM_MARGIN);
    const allVisible = points.every(point => Math.abs(point.x - currentPan.x) <= safeHalfSize && Math.abs(point.y - currentPan.y) <= safeHalfSize);
    if (allVisible && (mode === 'fit' || currentZoom <= SMART_FOCUS_ZOOM)) return;

    const minX = Math.min(...points.map(point => point.x));
    const maxX = Math.max(...points.map(point => point.x));
    const minY = Math.min(...points.map(point => point.y));
    const maxY = Math.max(...points.map(point => point.y));
    const usableSize = baseViewSize * (1 - SMART_ZOOM_MARGIN * 2);
    const fitZoom = Math.max((maxX - minX) / usableSize, (maxY - minY) / usableSize, 0.1);
    const targetZoom = Math.min(20, mode === 'focus' ? Math.max(Math.min(currentZoom, SMART_FOCUS_ZOOM), fitZoom) : Math.max(currentZoom, fitZoom));
    const targetHalfSize = baseViewSize * targetZoom * (0.5 - SMART_ZOOM_MARGIN);
    const keepRangeVisible = (current: number, min: number, max: number) => {
      const lower = max - targetHalfSize;
      const upper = min + targetHalfSize;
      return lower <= upper ? Math.max(lower, Math.min(upper, current)) : (min + max) / 2;
    };
    const targetPan = {
      x: keepRangeVisible(currentPan.x, minX, maxX),
      y: keepRangeVisible(currentPan.y, minY, maxY)
    };
    if (Math.abs(targetZoom - currentZoom) < 1e-4 && len(sub(targetPan, currentPan)) < 1e-3) return;

    cancelViewAnimation();
    const start = performance.now();
    const animate = (now: number) => {
      markViewInteraction();
      const progress = Math.min(1, (now - start) / SMART_ZOOM_DURATION);
      const eased = 1 - Math.pow(1 - progress, 3);
      const nextZoom = currentZoom + (targetZoom - currentZoom) * eased;
      const nextPan = {
        x: currentPan.x + (targetPan.x - currentPan.x) * eased,
        y: currentPan.y + (targetPan.y - currentPan.y) * eased
      };
      zoomRef.current = nextZoom;
      panRef.current = nextPan;
      setZoom(nextZoom);
      setPan(nextPan);
      viewAnimationRef.current = progress < 1 ? requestAnimationFrame(animate) : null;
    };
    viewAnimationRef.current = requestAnimationFrame(animate);
  }, [cancelViewAnimation, markViewInteraction, settings.smartZoom]);

  React.useEffect(() => cancelViewAnimation, [cancelViewAnimation]);
  React.useEffect(() => { if (!settings.smartZoom) cancelViewAnimation(); }, [cancelViewAnimation, settings.smartZoom]);

  // Native non-passive wheel listener so preventDefault works for trackpad gestures.
  // React's onWheel uses passive listeners in some browsers, making preventDefault a no-op.
  React.useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      cancelViewAnimation();
      markViewInteraction();
      // if (PAN_PERF.active) PAN_PERF.wheelEvents++;
      // panPerfMark('wheel', () => {
      const rect = (containerRef.current ?? svg).getBoundingClientRect();
      const currentZoom = zoomRef.current;
      const currentPan = panRef.current;
      const currentWidth = baseViewSize * currentZoom;
      const currentHeight = baseViewSize * currentZoom;
      const currentVx = currentPan.x - currentWidth / 2;
      const currentVy = currentPan.y - currentHeight / 2;

      // Pinch-to-zoom on trackpads fires with ctrlKey=true.
      // Two-finger panning fires with ctrlKey=false and both deltaX/deltaY set.
      if (e.ctrlKey) {
        // Pinch zoom — uses zoomSensitivity from settings
        const intensity = Math.min(Math.abs(e.deltaY) / 80, 2);
        const zoomFactor = e.deltaY > 0 ? 1 + settings.zoomSensitivity * intensity : 1 - settings.zoomSensitivity * intensity;
        const cursorX = e.clientX - rect.left;
        const cursorY = e.clientY - rect.top;
        const svgCursorX = currentVx + (cursorX / rect.width) * currentWidth;
        const svgCursorY = currentVy + (cursorY / rect.height) * currentHeight;
        const newZoom = Math.max(0.1, Math.min(20, currentZoom * zoomFactor));
        const newWidth = baseViewSize * newZoom;
        const newHeight = baseViewSize * newZoom;
        const newVx = svgCursorX - (cursorX / rect.width) * newWidth;
        const newVy = svgCursorY - (cursorY / rect.height) * newHeight;
        zoomRef.current = newZoom;
        panRef.current = { x: newVx + newWidth / 2, y: newVy + newHeight / 2 };
        queueViewUpdate();
      } else {
        // Two-finger pan (trackpad) or mouse wheel scroll.
        // Convert screen-pixel delta to world coordinates using the
        // world-to-screen ratio (scales with zoom level).
        const worldPerPixel = currentWidth / rect.width;
        const dx = e.deltaX * worldPerPixel * settings.panSensitivity;
        const dy = e.deltaY * worldPerPixel * settings.panSensitivity;
        panRef.current = { x: currentPan.x + dx, y: currentPan.y + dy };
        queueViewUpdate();
      }
      // });
    };
    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onWheel);
  }, [settings.zoomSensitivity, settings.panSensitivity, cancelViewAnimation, markViewInteraction, queueViewUpdate]);

  // Re-evaluate hover at the last known mouse position, skipping passed-through targets.
  // Used both by pointermove and the P key handler so hover updates immediately.
  const reevaluateHover = React.useCallback(() => {
    const { x, y } = lastMouseRef.current;
    const stack = useEditorStore.getState().passThroughStack;
    const { elements, targetElement } = hitTestTargets(x, y, stack);
    const handleElement = elements.find(element => element.getAttribute('data-handle') === 'true') ?? null;

    // While a road holds the selection, hover only engages inside that road —
    // clicking off it just deselects, so out-of-scope targets stay quiet.
    const focused = focusedArmIds(useEditorStore.getState().selections);
    const targetInFocus = (raw: string | null) => {
      if (!raw || stack.includes(raw)) return false;
      if (!focused.size) return true;
      try {
        const parsed = JSON.parse(raw) as SelectionTarget;
        return 'armId' in parsed && focused.has(parsed.armId);
      } catch { return false; }
    };
    const hoverElement = focused.size
      ? elements.find(element => targetInFocus(element.getAttribute('data-target'))) ?? null
      : targetElement;
    const hoverTarget = hoverElement?.getAttribute('data-target') ?? null;

    if (hoverTarget && !handleElement) {
      try { setHovered(JSON.parse(hoverTarget)); } catch { setHovered(null); }
    } else {
      setHovered(null);
    }

    if (stack.length === 0) {
      passThroughContactRef.current = null;
    } else {
      const stillOverPassed = elements.some(element => {
        const elementTarget = element.getAttribute('data-target');
        return elementTarget && stack.includes(elementTarget);
      });
      if (stillOverPassed) {
        passThroughContactRef.current = { x, y };
      } else if (passThroughContactRef.current && Math.hypot(x - passThroughContactRef.current.x, y - passThroughContactRef.current.y) > PASS_THROUGH_EXIT_TOLERANCE) {
        clearPassThrough();
        passThroughContactRef.current = null;
      }
    }

    const tooltipElement = handleElement ?? hoverElement ?? elements.find(element => {
      const elementTarget = element.getAttribute('data-target');
      return (!elementTarget || (!stack.includes(elementTarget) && targetInFocus(elementTarget))) && isTooltipElement(element);
    }) ?? null;
    window.dispatchEvent(new CustomEvent('tooltip-reevaluate', { detail: { x, y, element: tooltipElement } }));
  }, [setHovered, clearPassThrough]);

  const queueHoverEvaluation = React.useCallback(() => {
    if (hoverFrameRef.current !== null) return;
    hoverFrameRef.current = requestAnimationFrame(() => {
      hoverFrameRef.current = null;
      reevaluateHover();
    });
  }, [reevaluateHover]);

  // Clicking geometry changes what the element under a stationary cursor
  // means (e.g. selecting a road switches lane paths from "Select road" to
  // "Select entry lane"), so re-evaluate hover without waiting for a move.
  React.useEffect(() => {
    if (!pointerOverCanvasRef.current || isDragging || activeDrag) return;
    queueHoverEvaluation();
  }, [selection, isDragging, activeDrag, queueHoverEvaluation]);

  // Pass-through keyboard shortcut: press P to pass through the currently hovered target
  React.useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (!matchesShortcut(event, { key: 'P' })) return;
      const hovered = useEditorStore.getState().hovered;
      if (!hovered) return;
      event.preventDefault();
      passThroughContactRef.current = { ...lastMouseRef.current };
      pushPassThrough(JSON.stringify(hovered));
      // Immediately re-evaluate hover so the item below is highlighted without moving the mouse
      queueHoverEvaluation();
    };
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  }, [pushPassThrough, queueHoverEvaluation]);

  React.useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (!matchesShortcut(event, DELETE_SHORTCUT)) return;
      const state = useEditorStore.getState();
      if (state.selections.length < 2 || !hasDeletableSelection(state.selections)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      state.setCommittedConfig(deleteSelectionTargets(state.committedConfig, state.selections));
      state.setSelection(null);
    };
    window.addEventListener('keydown', keydown, true);
    return () => window.removeEventListener('keydown', keydown, true);
  }, []);

  // Non-deletable selections show no delete button, so their shortcut would
  // silently do nothing — surface the reason as a toast instead.
  React.useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (!matchesShortcut(event, DELETE_SHORTCUT)) return;
      const state = useEditorStore.getState();
      const sel = state.selection;
      if (sel?.kind !== 'profile-point' && sel?.kind !== 'lane-node' && sel?.kind !== 'arm-node') return;
      const arm = state.committedConfig.arms.find(candidate => candidate.id === sel.armId);
      if (!arm) return;
      let title: string;
      let subtitle: string;
      if (sel.kind === 'lane-node') {
        const profile = getRoadProfile(arm, estimateArmLength(arm));
        const point = findLanePoint(arm, profile, sel.dir, sel.laneIndex, sel.pointId);
        if (!point || (profile.length > 2 && !point.endAnchor && (!arm.authoredProfile || arm.authoredProfile[sel.dir][sel.laneIndex]?.keys.some(key => key.id === sel.pointId)))) return;
        title = "Can't delete lane node";
        subtitle = 'The first and last nodes of a road cannot be deleted.';
      } else if (sel.kind === 'profile-point') {
        const profile = getRoadProfile(arm, estimateArmLength(arm));
        const point = profile.find(candidate => candidate.id === sel.pointId);
        if (!point || (profile.length > 2 && !point.endAnchor)) return;
        title = "Can't delete cross-section";
        subtitle = 'The first and last cross-sections cannot be deleted.';
      } else {
        const nodeIndex = arm.nodes.findIndex(candidate => candidate.id === sel.nodeId);
        if (nodeIndex < 0) return;
        if (arm.nodes.length > 2 && nodeIndex > 0 && nodeIndex < arm.nodes.length - 1) return;
        title = "Can't delete node";
        subtitle = 'The first and last nodes of a road cannot be deleted.';
      }
      event.preventDefault();
      if (state.toasts.some(toast => toast.title === title)) return;
      state.addToast({ title, subtitle, dismissible: true });
    };
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  }, []);

  const handlePointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    cancelViewAnimation();
    pointerOverCanvasRef.current = true;
    clickSelectRef.current = null;
    // If we clicked a handle, let the handle capture it.
    if ((e.target as Element).closest('[data-handle]')) return;

    lastMouseRef.current = { x: e.clientX, y: e.clientY };
    const hit = hitTestTargets(e.clientX, e.clientY, useEditorStore.getState().passThroughStack);

    if (modalToolActive) {
      const point = screenToWorld(e, e.currentTarget);
      if (activeTool === 'calibrate-bg') {
        setCalibPoints(points => (points.length >= 2 ? points : [...points, point]));
        return;
      }
      const next = structuredClone(committedConfig);
      const id = Math.random().toString(36).slice(2, 7);
      if (activeTool === 'connect-bypass') {
        if (!hit.target || !pendingBypassSource) return;
        try {
          const target = JSON.parse(hit.target);
          const sourceArm = next.arms.find(arm => arm.id === pendingBypassSource.armId);
          const targetArm = next.arms.find(arm => arm.id === target.armId);
          if (target.kind !== 'lane' || target.dir !== 'out' || !isRightTurnPair(sourceArm, targetArm)) return;
          const sourceLane = { kind: 'lane' as const, armId: pendingBypassSource.armId, dir: 'in' as const, laneIndex: pendingBypassSource.laneIndex };
          const targetLane = { kind: 'lane' as const, armId: target.armId, dir: 'out' as const, laneIndex: target.laneIndex };
          const connected = connectBypassLanes(next, sourceLane, targetLane, 32);
          if (!connected) return;
          setCommittedConfig(connected);
          setSelection({ kind: 'lane', armId: pendingBypassSource.armId, dir: 'in', laneIndex: pendingBypassSource.laneIndex });
          setPendingBypassSource(null);
          setActiveTool('select');
        } catch {}
        return;
      }
      if (activeTool === 'add-ring') {
        const ringId = `ring_${id}`;
        next.rings.push({ id: ringId, center: point, radius: 35, width: 12 });
        setCommittedConfig(next);
        setSelection({ kind: 'ring', ringId });
        setActiveTool('select');
        return;
      }
      if (activeTool === 'add-road') {
        if (!pendingRoadStart) {
          setPendingRoadStart(point);
          setToolPointer(point);
          return;
        }
        if (len(sub(point, pendingRoadStart)) < 20) return;
        const armId = `road_${id}`;
        next.arms.push({
          id: armId,
          nodes: [
            { id: `${armId}_0`, point: pendingRoadStart, medianWidth: 4, laneWidthsIn: [10], laneWidthsOut: [10] },
            { id: `${armId}_1`, point, medianWidth: 4, laneWidthsIn: [10], laneWidthsOut: [10] }
          ],
          lanesIn: [{ filletRadius: 40 }],
          lanesOut: [{ filletRadius: 40, dropsRing: false }]
        });
        setCommittedConfig(next);
        setSelection({ kind: 'arm', armId });
        setActiveTool('select');
        return;
      }
    }
    
    // Otherwise, check if we hit a geometry element
    if (hit.target) {
      try {
        const target = JSON.parse(hit.target) as SelectionTarget;
        // Roads drill in: a click on a lane, node, or cross-section of a road
        // outside the current selection selects the whole road first; once the
        // road is in the selection scope, clicks reach the individual parts.
        const isArmPart = target.kind === 'lane' || target.kind === 'arm-node' || target.kind === 'profile-point' || target.kind === 'profile-control' || target.kind === 'lane-node' || target.kind === 'lane-segment';
        const selections = useEditorStore.getState().selections;
        const armOpen = isArmPart && selections.some(selected => 'armId' in selected && selected.armId === target.armId);
        const effectiveTarget: SelectionTarget = isArmPart && !armOpen ? { kind: 'arm', armId: target.armId } : target;
        // While a road holds the selection, clicking anything outside that
        // road only drops the selection — the hit target doesn't get selected
        // until the road is deselected. Shift-click still multi-selects.
        const focused = focusedArmIds(selections);
        if (focused.size > 0 && !e.shiftKey && !('armId' in effectiveTarget && focused.has(effectiveTarget.armId))) {
          setSelection(null);
        } else {
          selectTarget(effectiveTarget, e.shiftKey);
          // Keep a multi-selection intact on press so the group can be dragged;
          // if the pointer comes back up without moving, the plain click
          // collapses the selection to just this target.
          clickSelectRef.current = e.shiftKey ? null : { target: effectiveTarget, x: e.clientX, y: e.clientY };
        }
      } catch { if (!e.shiftKey) setSelection(null); }
    } else if (!e.shiftKey) {
      setSelection(null);
    }

    setIsDragging(true);
    panMouseRef.current = { x: e.clientX, y: e.clientY };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  
  const handlePointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (modalToolActive) {
      if (activeTool !== 'connect-bypass') setToolPointer(screenToWorld(e, e.currentTarget));
      return;
    }

    // Track mouse position for immediate re-evaluation (e.g. after P key)
    lastMouseRef.current = { x: e.clientX, y: e.clientY };
    pointerOverCanvasRef.current = true;

    // Hover logic — use elementsFromPoint to find all targets at this point,
    // then skip any that are in the pass-through stack.
    if (!isDragging && !activeDrag) {
      queueHoverEvaluation();
    }

    if (!isDragging) return;
    // if (PAN_PERF.active) PAN_PERF.pointerMoves++;
    // panPerfMark('pointermove', () => {
    const dx = e.clientX - panMouseRef.current.x;
    const dy = e.clientY - panMouseRef.current.y;
    
    if (svgRef.current) {
      const rect = (containerRef.current ?? svgRef.current).getBoundingClientRect();
      const currentWidth = baseViewSize * zoomRef.current;
      panRef.current = {
        x: panRef.current.x - dx * currentWidth / rect.width,
        y: panRef.current.y - dy * currentWidth / rect.height
      };
      queueViewUpdate();
    }
    // });
    panMouseRef.current = { x: e.clientX, y: e.clientY };
  };
  
  const handlePointerUp = (e: React.PointerEvent) => {
    const clickSelect = clickSelectRef.current;
    clickSelectRef.current = null;
    if (clickSelect && Math.hypot(e.clientX - clickSelect.x, e.clientY - clickSelect.y) < 4) setSelection(clickSelect.target);
    setIsDragging(false);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    // panPerfScheduleReport('pointer-up');
  };

  // Double-clicking a lane inserts a lane node there. Handled at the svg level
  // because the element under the cursor can change between the two clicks
  // (e.g. the first click mounts the lane editing layer), which makes the
  // browser dispatch dblclick to a common ancestor instead of the lane path.
  const handleDoubleClick = (e: React.MouseEvent<SVGSVGElement>) => {
    if (modalToolActive || useEditorStore.getState().drag?.active) return;
    const stack = useEditorStore.getState().passThroughStack;
    const hit = hitTestTargets(e.clientX, e.clientY, stack);
    if (!hit.target || !hit.targetElement) return;
    // Ignore double-clicks that land on a handle in front of the target —
    // nodes and markers have their own meaning, and stacking a new node on
    // one is never wanted. A lane segment's hit region is itself marked as a
    // drag handle, so only other handles stacked in front of it block the add.
    if (hit.elements.slice(0, hit.elements.indexOf(hit.targetElement))
      .some(element => element.getAttribute('data-handle') === 'true' && !stack.includes(element.getAttribute('data-target') ?? ''))) return;
    try {
      const target = JSON.parse(hit.target) as SelectionTarget;
      if (target.kind !== 'lane' && target.kind !== 'lane-segment') return;
      const committed = useEditorStore.getState().committedConfig;
      const arm = committed.arms.find(candidate => candidate.id === target.armId);
      if (!arm) return;
      const world = screenToWorld(e, e.currentTarget);
      const center = committed.island.center ?? { x: 0, y: 0 };
      const local = { x: world.x - center.x, y: world.y - center.y };
      const added = addProfilePoint(committed, target.armId, projectProfileDistance(profileGeometry(arm), local), target.dir, target.laneIndex);
      if (!added.pointId) return;
      setCommittedConfig(added.config);
      setSelection({ kind: 'lane-node', armId: target.armId, pointId: added.pointId, dir: target.dir, laneIndex: target.laneIndex });
    } catch { /* malformed data-target */ }
  };

  const handlePointerLeave = (e: React.PointerEvent<SVGSVGElement>) => {
    pointerOverCanvasRef.current = false;
    handlePointerUp(e);
  };

  const deleteSelectedGroup = () => {
    if (selections.length < 2 || !hasDeletableSelection(selections)) return false;
    setCommittedConfig(deleteSelectionTargets(committedConfig, selections));
    setSelection(null);
    return true;
  };

  const handleImageFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = ev => {
      setBgImage(ev.target?.result as string);
      setCalibPoints([]);
      setCalibFeet('');
      setActiveTool('calibrate-bg');
    };
    reader.readAsDataURL(file);
  };

  React.useEffect(() => {
    if (activeTool !== 'calibrate-bg') {
      setCalibPoints([]);
      setCalibFeet('');
    }
  }, [activeTool]);

  const applyCalibration = () => {
    if (calibPoints.length !== 2) return;
    const feet = Number(calibFeet);
    const measured = len(sub(calibPoints[1], calibPoints[0]));
    if (!Number.isFinite(feet) || feet <= 0 || measured < 1e-6) return;
    const k = feet / measured;
    const anchor = calibPoints[0];
    setBgRect(rect => ({
      x: anchor.x + (rect.x - anchor.x) * k,
      y: anchor.y + (rect.y - anchor.y) * k,
      w: rect.w * k,
      h: rect.h * k
    }));
    setActiveTool('select');
    const title = 'Reference image scaled';
    if (!useEditorStore.getState().toasts.some(toast => toast.title === title)) {
      addToast({ title, subtitle: `${feet} ft now spans the two picked points.`, dismissible: true });
    }
  };

  return (
    <div ref={containerRef} style={{ position: 'relative', width: '100%', height: '100%', backgroundColor: '#f0f0f0', overflow: 'hidden' }}>
      
      <BackgroundPanel
        hasImage={Boolean(bgImage)}
        opacity={bgOpacity}
        widthFt={bgRect.w}
        heightFt={bgRect.h}
        calibrating={activeTool === 'calibrate-bg'}
        onUploadFile={handleImageFile}
        onOpacity={setBgOpacity}
        onWidthFt={w => setBgRect(rect => {
          const cx = rect.x + rect.w / 2;
          const cy = rect.y + rect.h / 2;
          const h = rect.h * (w / rect.w);
          return { x: cx - w / 2, y: cy - h / 2, w, h };
        })}
        onCalibrate={() => setActiveTool('calibrate-bg')}
        onCenter={() => setBgRect(rect => ({ ...rect, x: panRef.current.x - rect.w / 2, y: panRef.current.y - rect.h / 2 }))}
        onRemove={() => setBgImage(null)}
        onUseDefault={() => setBgImage(DEFAULT_BACKGROUND)}
      />

      <svg 
        ref={svgRef}
        viewBox={`${vx} ${vy} ${width} ${height}`}
        style={{
          width: '100%',
          height: '100%',
          cursor: modalToolActive ? 'crosshair' : isDragging ? 'grabbing' : 'default',
          touchAction: 'none'
        }}
        data-tooltip={activeTool === 'connect-bypass' ? 'Click a highlighted exit lane on another road to complete the right-turn bypass.' : activeTool === 'add-road' ? (pendingRoadStart ? 'Click to place the second endpoint of the new road.' : 'Click to place the first endpoint of the new road.') : activeTool === 'add-ring' ? 'Click to place a new ring center.' : activeTool === 'calibrate-bg' ? (calibPoints.length ? 'Click a second point on the reference image.' : 'Click the first of two points on the reference image.') : undefined}
        onPointerDownCapture={cancelViewAnimation}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerLeave}
        onDoubleClick={handleDoubleClick}
      >
        {bgImage && (
          <image
            href={bgImage}
            x={bgRect.x}
            y={bgRect.y}
            width={bgRect.w}
            height={bgRect.h}
            preserveAspectRatio="none"
            style={{ opacity: bgOpacity * (roadFocused ? 0.5 : 1), transition: 'opacity 160ms ease', imageRendering: interactionActive && !policy.effectsDuringInteraction ? 'pixelated' : 'auto' }}
            pointerEvents="none"
          />
        )}
        {activeTool === 'add-road' && pendingRoadStart && toolPointer && (
          <g pointerEvents="none">
            <line x1={pendingRoadStart.x} y1={pendingRoadStart.y} x2={toolPointer.x} y2={toolPointer.y} stroke="#2563eb" strokeWidth={2 * zoom} strokeDasharray={`${6 * zoom} ${4 * zoom}`} />
            <circle cx={pendingRoadStart.x} cy={pendingRoadStart.y} r={5 * zoom} fill="#fff" stroke="#2563eb" strokeWidth={2 * zoom} />
            <circle cx={toolPointer.x} cy={toolPointer.y} r={5 * zoom} fill="#dbeafe" stroke="#2563eb" strokeWidth={2 * zoom} />
          </g>
        )}
        {activeTool === 'add-ring' && toolPointer && (
          <g pointerEvents="none">
            <circle cx={toolPointer.x} cy={toolPointer.y} r={35} fill="rgba(37,99,235,.08)" stroke="#2563eb" strokeWidth={2 * zoom} strokeDasharray={`${5 * zoom} ${4 * zoom}`} />
            <circle cx={toolPointer.x} cy={toolPointer.y} r={3.5 * zoom} fill="#2563eb" />
          </g>
        )}
        <GeometryLayer config={renderConfig} segments={segments} effectsEnabled={effectsEnabled} visibleBounds={visibleBounds} />
        {viewMode !== 'segment' && (
          <MarkingsLayer config={renderConfig} segments={segments} defer={Boolean(activeDrag?.active) && !policy.markingsDuringDrag} visibleBounds={visibleBounds} />
        )}
        <CenterlineLayer config={draftConfig || committedConfig} zoom={zoom} />
        {viewDetailsEnabled && <LaneProfileLayer zoom={zoom} onSmartZoom={smartZoom} />}
        {(viewDetailsEnabled || activeDrag?.active) && <HandlesLayer zoom={zoom} segments={segments} />}
        {activeTool === 'calibrate-bg' && calibPoints.length > 0 && (
          <g pointerEvents="none">
            <line
              x1={calibPoints[0].x}
              y1={calibPoints[0].y}
              x2={(calibPoints[1] ?? toolPointer ?? calibPoints[0]).x}
              y2={(calibPoints[1] ?? toolPointer ?? calibPoints[0]).y}
              stroke="#7c3aed"
              strokeWidth={2 * zoom}
              strokeDasharray={`${6 * zoom} ${4 * zoom}`}
            />
            {calibPoints.map((point, index) => (
              <circle key={index} cx={point.x} cy={point.y} r={4.5 * zoom} fill="#fff" stroke="#7c3aed" strokeWidth={2 * zoom} />
            ))}
            {calibPoints.length === 1 && toolPointer && (
              <circle cx={toolPointer.x} cy={toolPointer.y} r={4.5 * zoom} fill="#ede9fe" stroke="#7c3aed" strokeWidth={2 * zoom} />
            )}
          </g>
        )}
      </svg>
      {activeTool === 'calibrate-bg' && calibPoints.length === 2 && svgRef.current && (() => {
        const rect = (containerRef.current ?? svgRef.current).getBoundingClientRect();
        const mid = { x: (calibPoints[0].x + calibPoints[1].x) / 2, y: (calibPoints[0].y + calibPoints[1].y) / 2 };
        const screen = worldToScreen(mid, svgRef.current);
        const measured = len(sub(calibPoints[1], calibPoints[0]));
        const feet = Number(calibFeet);
        const valid = Number.isFinite(feet) && feet > 0;
        return (
          <div className="calib-card" style={{ left: Math.min(Math.max(screen.x - rect.left, 120), rect.width - 120), top: screen.y - rect.top }}>
            <span className="calib-measured">{measured.toFixed(1)} ft =</span>
            <input
              autoFocus
              type="number"
              min={0}
              placeholder="ft"
              value={calibFeet}
              onChange={e => setCalibFeet(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && valid) applyCalibration();
                if (e.key === 'Escape') setActiveTool('select');
              }}
            />
            <span className="calib-unit">ft</span>
            <button type="button" disabled={!valid} onClick={applyCalibration}>Apply</button>
            <button type="button" className="calib-redo" data-tooltip="Pick the two points again" onClick={() => { setCalibPoints([]); setCalibFeet(''); }}>Redo</button>
          </div>
        );
      })()}
      {effectsEnabled && selection?.kind === 'ring' && svgRef.current && (() => {
        const ring = committedConfig.rings.find(candidate => candidate.id === selection.ringId);
        if (!ring) return null;
        const rect = containerRef.current?.getBoundingClientRect() ?? svgRef.current.getBoundingClientRect();
        return (
          <FloatingButton
            key={`${selection.ringId}-delete`}
            storageKey="delete_ring"
            anchorPoint={worldToScreen(ring.center, svgRef.current)}
            defaultOffset={{ x: 24, y: -24 }}
            bounds={{ left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom }}
            label="Delete Ring"
            tooltip="Delete this ring."
            shortcut={DELETE_SHORTCUT}
            icon={<Trash2 size={14} />}
            onClick={() => {
              if (deleteSelectedGroup()) return;
              if (!window.confirm(`Delete ring ${selection.ringId}?`)) return;
              setCommittedConfig(removeRing(committedConfig, selection.ringId));
              setSelection(null);
            }}
          />
        );
      })()}
      {effectsEnabled && selection?.kind === 'profile-point' && svgRef.current && (() => {
        const svg = svgRef.current;
        const arm = committedConfig.arms.find(candidate => candidate.id === selection.armId);
        const position = arm && profilePointPosition(arm, selection.pointId);
        if (!arm || !position) return null;
        const profile = getRoadProfile(arm, estimateArmLength(arm));
        const pointIndex = profile.findIndex(point => point.id === selection.pointId);
        const point = profile[pointIndex];
        if (!point) return null;
        // Non-deletable cross-sections (the anchored first/last points) get no
        // button at all; pressing Delete still explains why via a toast.
        if (!(profile.length > 2 && !point.endAnchor)) return null;
        const rect = (containerRef.current ?? svg).getBoundingClientRect();
        const center = worldToScreen(position, svg);
        const lineRadius = Math.max(profileSideOuter(point, 'in'), profileSideOuter(point, 'out')) + 14 * zoom;
        const radiusEdge = worldToScreen({ x: position.x + lineRadius, y: position.y }, svg);
        const screenRadius = Math.hypot(radiusEdge.x - center.x, radiusEdge.y - center.y);
        const actionAnchor = { x: center.x + screenRadius * .8, y: center.y - screenRadius * .8 };
        return (
          <FloatingButton
            key={`${selection.armId}-${selection.pointId}-delete`}
            storageKey="delete_lane_point"
            anchorPoint={actionAnchor}
            defaultOffset={{ x: 16, y: -48 }}
            bounds={{ left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom }}
            label="Delete Cross-section"
            tooltip="Delete this cross-section."
            shortcut={DELETE_SHORTCUT}
            icon={<Trash2 size={14} />}
            onClick={() => {
              if (deleteSelectedGroup()) return;
              setCommittedConfig(removeProfilePoint(committedConfig, selection.armId, selection.pointId));
              setSelection({ kind: 'arm', armId: selection.armId });
            }}
          />
        );
      })()}
      {effectsEnabled && selection?.kind === 'lane-node' && svgRef.current && (() => {
        const svg = svgRef.current;
        const arm = committedConfig.arms.find(candidate => candidate.id === selection.armId);
        const position = arm && laneNodePosition(arm, committedConfig, selection.pointId, selection.dir, selection.laneIndex);
        if (!arm || !position) return null;
        const profile = getRoadProfile(arm, estimateArmLength(arm));
        const point = findLanePoint(arm, profile, selection.dir, selection.laneIndex, selection.pointId);
        // Anchored end nodes can't be deleted; the button stays hidden and
        // pressing Delete explains why via a toast.
        if (!point || !(profile.length > 2 && !point.endAnchor) || arm.authoredProfile && !arm.authoredProfile[selection.dir][selection.laneIndex]?.keys.some(key => key.id === selection.pointId)) return null;
        const rect = (containerRef.current ?? svg).getBoundingClientRect();
        return (
          <FloatingButton
            key={`${selection.armId}-${selection.pointId}-${selection.dir}-${selection.laneIndex}-delete`}
            storageKey="delete_lane_node"
            anchorPoint={worldToScreen(position, svg)}
            defaultOffset={{ x: 24, y: -48 }}
            bounds={{ left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom }}
            label="Delete Node"
            tooltip="Delete this lane node."
            shortcut={DELETE_SHORTCUT}
            icon={<Trash2 size={14} />}
            onClick={() => {
              if (deleteSelectedGroup()) return;
              setCommittedConfig(removeProfileLanePoint(committedConfig, selection.armId, selection.pointId, selection.dir, selection.laneIndex));
              setSelection({ kind: 'lane', armId: selection.armId, dir: selection.dir, laneIndex: selection.laneIndex });
            }}
          />
        );
      })()}
      {effectsEnabled && selection?.kind === 'arm' && svgRef.current && (() => {
        const svg = svgRef.current;
        const arm = (draftConfig || committedConfig).arms.find(a => a.id === selection.armId);
        if (!arm || arm.nodes.length === 0) return null;
        const rect = (containerRef.current ?? svg).getBoundingClientRect();

        // Convert both end nodes to screen space.
        // worldToScreen uses getScreenCTM() which already returns absolute
        // screen coordinates — no need to add rect.left/rect.top.
        const nearNode = arm.nodes[0];
        const farNode = arm.nodes[arm.nodes.length - 1];
        const nearScreen = worldToScreen(nearNode.point, svg);
        const farScreen = worldToScreen(farNode.point, svg);

        // Pick the endpoint closest to the center of the viewport (screen center)
        const viewportCenterX = rect.left + rect.width / 2;
        const viewportCenterY = rect.top + rect.height / 2;
        const nearDist = Math.hypot(nearScreen.x - viewportCenterX, nearScreen.y - viewportCenterY);
        const farDist = Math.hypot(farScreen.x - viewportCenterX, farScreen.y - viewportCenterY);
        const anchorPoint = nearDist <= farDist ? nearScreen : farScreen;

        // Bounds = the SVG element's screen rect (so button stays within the canvas)
        const bounds = { left: rect.left, top: rect.top, right: rect.left + rect.width, bottom: rect.top + rect.height };

        return (
          <FloatingButton
            key={`${selection.armId}-delete`}
            storageKey="delete_road"
            anchorPoint={anchorPoint}
            defaultOffset={{ x: 24, y: -24 }}
            bounds={bounds}
            label="Delete Road"
            tooltip="Delete this road."
            shortcut={DELETE_SHORTCUT}
            icon={<Trash2 size={14} />}
            onClick={() => {
              if (deleteSelectedGroup()) return;
              const next = structuredClone(committedConfig);
              next.arms = next.arms.filter(candidate => candidate.id !== selection.armId);
              next.bypasses = (next.bypasses ?? []).filter(bypass => bypass.fromArmId !== selection.armId && bypass.toArmId !== selection.armId);
              setCommittedConfig(next);
              setSelection(null);
            }}
          />
        );
      })()}
      {effectsEnabled && selection?.kind === 'arm-node' && svgRef.current && (() => {
        const svg = svgRef.current;
        const arm = committedConfig.arms.find(a => a.id === selection.armId);
        const nodeIndex = arm?.nodes.findIndex(n => n.id === selection.nodeId) ?? -1;
        const node = nodeIndex >= 0 ? arm?.nodes[nodeIndex] : undefined;
        if (!arm || !node) return null;
        // The road's anchored end nodes can't be deleted; the button stays
        // hidden and pressing Delete explains why via a toast.
        if (arm.nodes.length <= 2 || nodeIndex === 0 || nodeIndex === arm.nodes.length - 1) return null;
        const rect = (containerRef.current ?? svg).getBoundingClientRect();
        const bounds = { left: rect.left, top: rect.top, right: rect.left + rect.width, bottom: rect.top + rect.height };
        return (
          <FloatingButton
            key={`${selection.armId}-${selection.nodeId}-delete`}
            storageKey="delete_node"
            anchorPoint={worldToScreen(node.point, svg)}
            defaultOffset={{ x: 24, y: -24 }}
            bounds={bounds}
            label="Delete Node"
            tooltip="Delete this road node."
            shortcut={DELETE_SHORTCUT}
            icon={<Trash2 size={14} />}
            onClick={() => {
              if (deleteSelectedGroup()) return;
              setCommittedConfig(removeArmNode(committedConfig, selection.armId, selection.nodeId));
              setSelection({ kind: 'arm', armId: selection.armId });
            }}
          />
        );
      })()}
      {effectsEnabled && selection?.kind === 'lane' && svgRef.current && (() => {
        const svg = svgRef.current;
        const arm = committedConfig.arms.find(candidate => candidate.id === selection.armId);
        const lane = selection.dir === 'in' ? arm?.lanesIn[selection.laneIndex] : arm?.lanesOut[selection.laneIndex];
        if (!arm || !lane) return null;
        const ring = resolveLaneRing(committedConfig, arm, selection.dir, selection.laneIndex);
        const anchor = ring?.center ?? arm.nodes[0]?.point;
        if (!anchor) return null;
        const rect = (containerRef.current ?? svg).getBoundingClientRect();
        return (
          <FloatingButton
            key={`${selection.armId}-${selection.dir}-${selection.laneIndex}-delete`}
            storageKey="delete_lane"
            anchorPoint={worldToScreen(anchor, svg)}
            defaultOffset={{ x: 24, y: selection.dir === 'out' ? 20 : -24 }}
            bounds={{ left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom }}
            label="Delete Lane"
            tooltip={`Delete this ${selection.dir === 'in' ? 'entry' : 'exit'} lane.`}
            shortcut={DELETE_SHORTCUT}
            icon={<Trash2 size={14} />}
            onClick={() => {
              if (deleteSelectedGroup()) return;
              setCommittedConfig(removeProfileLane(committedConfig, selection.armId, selection.dir, selection.laneIndex));
              setSelection({ kind: 'arm', armId: selection.armId });
            }}
          />
        );
      })()}
      {effectsEnabled && selection?.kind === 'lane-segment' && svgRef.current && (() => {
        const svg = svgRef.current;
        const arm = committedConfig.arms.find(candidate => candidate.id === selection.armId);
        if (!arm) return null;
        const from = laneNodePosition(arm, committedConfig, selection.fromPointId, selection.dir, selection.laneIndex);
        const to = laneNodePosition(arm, committedConfig, selection.toPointId, selection.dir, selection.laneIndex);
        const anchor = from && to ? { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 } : from ?? to;
        if (!anchor) return null;
        const rect = (containerRef.current ?? svg).getBoundingClientRect();
        return (
          <FloatingButton
            key={`${selection.armId}-${selection.dir}-${selection.laneIndex}-${selection.fromPointId}-${selection.toPointId}-delete`}
            storageKey="delete_section"
            anchorPoint={worldToScreen(anchor, svg)}
            defaultOffset={{ x: 24, y: -24 }}
            bounds={{ left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom }}
            label="Delete Section"
            tooltip="Delete this lane section's nodes — or the lane itself when only its ends remain."
            shortcut={DELETE_SHORTCUT}
            icon={<Trash2 size={14} />}
            onClick={() => {
              if (deleteSelectedGroup()) return;
              setCommittedConfig(removeProfileLaneSegment(committedConfig, selection.armId, selection.fromPointId, selection.toPointId, selection.dir, selection.laneIndex));
            }}
          />
        );
      })()}
      {effectsEnabled && selection?.kind === 'lane' && svgRef.current && (() => {
        const svg = svgRef.current;
        const config = draftConfig || committedConfig;
        const arm = config.arms.find(a => a.id === selection.armId);
        const lane = selection.dir === 'in' ? arm?.lanesIn[selection.laneIndex] : arm?.lanesOut[selection.laneIndex];
        if (!arm || !lane) return null;
        const endpoint = selection.dir === 'in' ? 'end' : 'start';
        const ring = resolveLaneRing(config, arm, selection.dir, selection.laneIndex, endpoint);
        if (!ring) return null;
        const rect = (containerRef.current ?? svg).getBoundingClientRect();
        const anchorPoint = worldToScreen(ring.center, svg);
        const bounds = { left: rect.left, top: rect.top, right: rect.left + rect.width, bottom: rect.top + rect.height };
        return (
          <FloatingButton
            key={`${selection.armId}-${selection.dir}-${selection.laneIndex}-drops`}
            storageKey="drops_ring"
            anchorPoint={anchorPoint}
            defaultOffset={{ x: 24, y: -24 }}
            bounds={bounds}
            label="Drops Ring"
            tooltip="When checked, this exit lane drops the remainder of its source ring instead of continuing the circle."
            shortcut={{ key: 'D' }}
            checked={lane.dropsRing ?? false}
            onClick={() => {
              const next = structuredClone(committedConfig);
              const targetArm = next.arms.find(a => a.id === selection.armId);
              const targetLane = selection.dir === 'in' ? targetArm?.lanesIn[selection.laneIndex] : targetArm?.lanesOut[selection.laneIndex];
              if (targetLane) targetLane.dropsRing = !(targetLane.dropsRing ?? false);
              setCommittedConfig(next);
            }}
          />
        );
      })()}
    </div>
  );
};
