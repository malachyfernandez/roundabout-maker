import React from 'react';
import { type ArmConfig, type RoadProfilePoint, type RoundaboutConfig } from '../config/types';
import {
  addProfileLane,
  addProfilePoint,
  estimateArmLength,
  getRoadProfile,
  interpolateProfile,
  isProfileLanePresent,
  laneBounds,
  moveProfileLaneTransition,
  moveProfilePoint,
  profileLaneTransitions,
  setProfileControl
} from '../core/profile';
import { useEditorStore } from '../editor/editorStore';
import { sampleSpline, type CatmullRomSpline } from '../math/spline';
import { add, dot, len, norm, perpLeft, scale, sub, type Vec2 } from '../math/vector';
import { screenToWorld } from '../viewport/transform';

type Props = { zoom: number; onSmartZoom: (points: Vec2[], mode: 'focus' | 'fit') => void };
type Direction = 'in' | 'out';
type ProfileGeometry = { samples: { p: Vec2; tangent: Vec2; normal: Vec2; distance: number }[]; totalLength: number };
type DragState =
  | { kind: 'distance'; armId: string; pointId: string; startDistance: number; moved: boolean; original: RoundaboutConfig }
  | { kind: 'control'; armId: string; pointId: string; dir: Direction; control: 'gap' | 'width'; laneIndex: number; base: Vec2; normal: Vec2; sign: number; original: RoundaboutConfig }
  | { kind: 'transition'; armId: string; dir: Direction; laneIndex: number; boundaryIndex: number; original: RoundaboutConfig };

type TransitionDrag = { sourceBoundary: number; targetBoundary: number | null; point: Vec2 };

const makeSpline = (arm: ArmConfig): CatmullRomSpline => ({ points: arm.nodes.map(node => node.point), nodes: arm.nodes, alpha: 0.5, tension: 0 });

function profileGeometry(arm: ArmConfig): ProfileGeometry {
  const raw = sampleSpline(makeSpline(arm), Math.max(120, arm.nodes.length * 60));
  let distance = 0;
  const samples = raw.map((sample, index) => {
    if (index) distance += len(sub(sample.p, raw[index - 1].p));
    return { ...sample, tangent: norm(sample.tangent), normal: norm(perpLeft(sample.tangent)), distance };
  });
  return { samples, totalLength: distance };
}

function atDistance(geometry: ProfileGeometry, distance: number) {
  const target = Math.max(0, Math.min(geometry.totalLength, distance));
  const upper = geometry.samples.findIndex(sample => sample.distance >= target);
  if (upper <= 0) return geometry.samples[0];
  const a = geometry.samples[upper - 1];
  const b = geometry.samples[upper];
  const t = (target - a.distance) / Math.max(1e-6, b.distance - a.distance);
  const tangent = norm(add(scale(a.tangent, 1 - t), scale(b.tangent, t)));
  return { p: add(scale(a.p, 1 - t), scale(b.p, t)), tangent, normal: norm(perpLeft(tangent)), distance: target };
}

function projectDistance(geometry: ProfileGeometry, point: Vec2) {
  let bestDistance = 0;
  let bestGap = Infinity;
  for (let index = 1; index < geometry.samples.length; index++) {
    const a = geometry.samples[index - 1];
    const b = geometry.samples[index];
    const edge = sub(b.p, a.p);
    const lengthSquared = dot(edge, edge);
    const t = lengthSquared ? Math.max(0, Math.min(1, dot(sub(point, a.p), edge) / lengthSquared)) : 0;
    const projected = add(a.p, scale(edge, t));
    const gap = len(sub(point, projected));
    if (gap < bestGap) {
      bestGap = gap;
      bestDistance = a.distance + (b.distance - a.distance) * t;
    }
  }
  return bestDistance;
}

function directionSign(config: RoundaboutConfig, dir: Direction) {
  const isRhd = config.circulation === 'ccw';
  return isRhd ? (dir === 'in' ? 1 : -1) : (dir === 'in' ? -1 : 1);
}

function sideOuter(point: RoadProfilePoint, dir: Direction) {
  const lanes = dir === 'in' ? point.lanesIn : point.lanesOut;
  return lanes.reduce((outer, lane, laneIndex) => isProfileLanePresent(lane) ? Math.max(outer, laneBounds(point, dir, laneIndex).outer) : outer, point.medianWidth / 2);
}

function pointsPath(points: Vec2[]) {
  return points.length ? `M ${points.map(point => `${point.x} ${point.y}`).join(' L ')}` : '';
}

const CONTROL_COLORS = ['#2563eb', '#7c3aed', '#0891b2', '#0d9488', '#4f46e5'];

const MOVEMENT_POINTER_PATH = 'M0.793044 3.29289L3.29304 0.792893C3.48058 0.605357 3.73493 0.5 4.00015 0.5H6.58594C7.13822 0.5 7.58594 0.947715 7.58594 1.5V6.5C7.58594 7.05228 7.13822 7.5 6.58594 7.5H4.00015C3.73493 7.5 3.48058 7.39464 3.29304 7.20711L0.793044 4.70711C0.40252 4.31658 0.402519 3.68342 0.793044 3.29289Z';
const WIDTH_POINTER_PATH = 'M6.5166 4.5H3.93081C3.6656 4.5 3.41125 4.39464 3.22371 4.20711L1.7666 2.75L0.891602 1.875L0.721389 1.70479C0.553128 1.53653 0.473907 1.29886 0.507559 1.0633L0.50889 1.05398C0.514022 1.01806 0.522177 0.982633 0.533269 0.948083C0.618894 0.681374 0.866945 0.500475 1.14706 0.500455L6.51653 0.500071C7.06884 0.500032 7.5166 0.947759 7.5166 1.50007V3.5C7.5166 4.05228 7.06889 4.5 6.5166 4.5Z';

function pointerTransform(center: Vec2, travel: Vec2, sideNormal: Vec2, zoom: number, anchorX: number, anchorY: number, flipY = false) {
  const size = 1.6 * zoom;
  const a = -travel.x * size;
  const b = -travel.y * size;
  const c = (flipY ? -1 : 1) * sideNormal.x * size;
  const d = (flipY ? -1 : 1) * sideNormal.y * size;
  return `matrix(${a} ${b} ${c} ${d} ${center.x - a * anchorX - c * anchorY} ${center.y - b * anchorX - d * anchorY})`;
}

export const LaneProfileLayer: React.FC<Props> = ({ zoom, onSmartZoom }) => {
  const committedConfig = useEditorStore(state => state.committedConfig);
  const draftConfig = useEditorStore(state => state.draftConfig);
  const selection = useEditorStore(state => state.selection);
  const viewMode = useEditorStore(state => state.viewMode);
  const activeDrag = useEditorStore(state => state.drag);
  const setSelection = useEditorStore(state => state.setSelection);
  const setCommittedConfig = useEditorStore(state => state.setCommittedConfig);
  const setDraftConfig = useEditorStore(state => state.setDraftConfig);
  const commitDraft = useEditorStore(state => state.commitDraft);
  const setDrag = useEditorStore(state => state.setDrag);
  const dragRef = React.useRef<DragState | null>(null);
  const [ghost, setGhost] = React.useState<{ armId: string; distance: number } | null>(null);
  const [transitionDrag, setTransitionDrag] = React.useState<TransitionDrag | null>(null);
  const [widthSnapMatches, setWidthSnapMatches] = React.useState<{ dir: Direction; laneIndex: number }[]>([]);
  const transitionMagnetRef = React.useRef<number | null>(null);
  const config = draftConfig ?? committedConfig;
  const armId = selection && 'armId' in selection ? selection.armId : null;
  const arm = armId ? config.arms.find(candidate => candidate.id === armId) : null;
  const geometry = React.useMemo(() => arm ? profileGeometry(arm) : null, [arm]);
  const profile = React.useMemo(() => arm && geometry ? getRoadProfile(arm, geometry.totalLength) : [], [arm, geometry]);
  const selectedPoint = selection?.kind === 'profile-point' ? profile.find(point => point.id === selection.pointId) : null;

  React.useEffect(() => {
    setGhost(null);
    setTransitionDrag(null);
    setWidthSnapMatches([]);
    transitionMagnetRef.current = null;
  }, [armId]);

  React.useEffect(() => {
    if (activeDrag || !selectedPoint || !geometry) return;
    const location = atDistance(geometry, selectedPoint.distance);
    const inEnd = add(location.p, scale(location.normal, directionSign(config, 'in') * (sideOuter(selectedPoint, 'in') + 10)));
    const outEnd = add(location.p, scale(location.normal, directionSign(config, 'out') * (sideOuter(selectedPoint, 'out') + 10)));
    onSmartZoom([inEnd, outEnd], 'focus');
  }, [activeDrag, config, geometry, onSmartZoom, selectedPoint]);

  if (viewMode === 'rendered' || !arm || !geometry || !selection || !['arm', 'lane', 'profile-point'].includes(selection.kind)) return null;

  const localPointer = (event: React.PointerEvent<SVGElement>) => {
    const svg = event.currentTarget.closest('svg');
    return svg ? screenToWorld(event, svg) : null;
  };

  const transitionPosition = (dir: Direction, laneIndex: number, boundaryIndex: number, sourceBoundary?: number) => {
    const distance = (profile[boundaryIndex].distance + profile[boundaryIndex + 1].distance) / 2;
    const section = interpolateProfile(profile, distance) as RoadProfilePoint;
    if (sourceBoundary !== undefined && boundaryIndex !== sourceBoundary) {
      const sourceTransition = profileLaneTransitions(profile, dir).find(transition => transition.laneIndex === laneIndex && transition.boundaryIndex === sourceBoundary);
      const templatePoint = sourceTransition?.fromPresent ? profile[sourceBoundary] : profile[sourceBoundary + 1];
      const template = templatePoint && (dir === 'in' ? templatePoint.lanesIn : templatePoint.lanesOut)[laneIndex];
      const lanes = dir === 'in' ? section.lanesIn : section.lanesOut;
      if (template) lanes[laneIndex] = { width: template.width / 2, gap: template.gap / 2 };
    }
    const location = atDistance(geometry, distance);
    const sideNormal = scale(location.normal, directionSign(config, dir));
    const bounds = laneBounds(section, dir, laneIndex);
    return add(location.p, scale(sideNormal, bounds.inner + (bounds.outer - bounds.inner) / 2));
  };

  const transitionTargets = (dir: Direction, laneIndex: number, boundaryIndex: number) => {
    const boundaries = profileLaneTransitions(profile, dir)
      .filter(transition => transition.laneIndex === laneIndex)
      .map(transition => transition.boundaryIndex)
      .sort((a, b) => a - b);
    const transitionIndex = boundaries.indexOf(boundaryIndex);
    const first = (boundaries[transitionIndex - 1] ?? -1) + 1;
    const last = (boundaries[transitionIndex + 1] ?? profile.length - 1) - 1;
    return Array.from({ length: Math.max(0, last - first + 1) }, (_, index) => first + index).filter(candidate => candidate !== boundaryIndex);
  };

  const finishDrag = (event: React.PointerEvent<SVGElement>) => {
    const state = dragRef.current;
    if (!state) return;
    if (state.kind === 'transition') {
      setDraftConfig(null);
      const target = transitionMagnetRef.current;
      if (target !== null) setCommittedConfig(moveProfileLaneTransition(state.original, state.armId, state.dir, state.laneIndex, state.boundaryIndex, target));
    } else {
      commitDraft();
    }
    dragRef.current = null;
    transitionMagnetRef.current = null;
    setTransitionDrag(null);
    setWidthSnapMatches([]);
    setDrag(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const moveDrag = (event: React.PointerEvent<SVGElement>) => {
    const state = dragRef.current;
    const pointer = localPointer(event);
    if (!state || !pointer) return;
    if (state.kind === 'distance') {
      const distance = projectDistance(geometry, pointer);
      if (Math.abs(distance - state.startDistance) > .75) state.moved = true;
      setDraftConfig(moveProfilePoint(state.original, state.armId, state.pointId, distance));
      return;
    }
    if (state.kind === 'transition') {
      const targets = transitionTargets(state.dir, state.laneIndex, state.boundaryIndex);
      const captureRadius = 16 * zoom;
      let target = transitionMagnetRef.current;
      if (target === null || len(sub(transitionPosition(state.dir, state.laneIndex, target, state.boundaryIndex), pointer)) > captureRadius) {
        target = null;
        let nearestDistance = Infinity;
        for (const candidate of targets) {
          const distance = len(sub(transitionPosition(state.dir, state.laneIndex, candidate, state.boundaryIndex), pointer));
          if (distance < nearestDistance) { target = candidate; nearestDistance = distance; }
        }
        if (nearestDistance > captureRadius) target = null;
      }
      transitionMagnetRef.current = target;
      setTransitionDrag({ sourceBoundary: state.boundaryIndex, targetBoundary: target, point: target === null ? pointer : transitionPosition(state.dir, state.laneIndex, target, state.boundaryIndex) });
      return;
    }
    const offset = dot(sub(pointer, state.base), state.normal) * state.sign;
    const sourceArm = state.original.arms.find(candidate => candidate.id === state.armId);
    if (!sourceArm) return;
    const sourcePoint = getRoadProfile(sourceArm, estimateArmLength(sourceArm)).find(point => point.id === state.pointId);
    if (!sourcePoint) return;
    const bounds = laneBounds(sourcePoint, state.dir, state.laneIndex);
    const lane = (state.dir === 'in' ? sourcePoint.lanesIn : sourcePoint.lanesOut)[state.laneIndex];
    let value = state.control === 'gap'
      ? offset - bounds.base - (lane?.width ?? 0) / 2
      : offset - bounds.inner;
    if (state.control === 'width') {
      const snapThreshold = .5;
      let snappedWidth: number | null = null;
      let snapDist = Infinity;
      for (const checkDir of ['in', 'out'] as const) {
        const checkLanes = checkDir === 'in' ? sourcePoint.lanesIn : sourcePoint.lanesOut;
        checkLanes.forEach((checkLane, checkIndex) => {
          if (checkDir === state.dir && checkIndex === state.laneIndex) return;
          if (!isProfileLanePresent(checkLane)) return;
          const dist = Math.abs(value - checkLane.width);
          if (dist < snapThreshold && dist < snapDist) { snapDist = dist; snappedWidth = checkLane.width; }
        });
      }
      if (snappedWidth !== null) {
        value = snappedWidth;
        const matches: { dir: Direction; laneIndex: number }[] = [];
        for (const checkDir of ['in', 'out'] as const) {
          const checkLanes = checkDir === 'in' ? sourcePoint.lanesIn : sourcePoint.lanesOut;
          checkLanes.forEach((checkLane, checkIndex) => {
            if (!isProfileLanePresent(checkLane)) return;
            if (Math.abs(snappedWidth! - checkLane.width) < .01) matches.push({ dir: checkDir, laneIndex: checkIndex });
          });
        }
        setWidthSnapMatches(matches);
      } else {
        setWidthSnapMatches([]);
      }
    }
    setDraftConfig(setProfileControl(state.original, state.armId, state.pointId, state.dir, state.control, Math.max(0, value), state.laneIndex));
  };

  const startDistanceDrag = (event: React.PointerEvent<SVGElement>, pointId: string) => {
    event.preventDefault();
    event.stopPropagation();
    setSelection({ kind: 'profile-point', armId: arm.id, pointId });
    const point = profile.find(candidate => candidate.id === pointId);
    dragRef.current = { kind: 'distance', armId: arm.id, pointId, startDistance: point?.distance ?? 0, moved: false, original: structuredClone(committedConfig) };
    setDrag({ active: true, type: 'profile-distance' });
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const startControlDrag = (event: React.PointerEvent<SVGElement>, point: RoadProfilePoint, dir: Direction, control: 'gap' | 'width', laneIndex: number) => {
    event.preventDefault();
    event.stopPropagation();
    const location = atDistance(geometry, point.distance);
    dragRef.current = {
      kind: 'control', armId: arm.id, pointId: point.id, dir, control, laneIndex,
      base: location.p, normal: location.normal, sign: directionSign(committedConfig, dir), original: structuredClone(committedConfig)
    };
    setDrag({ active: true, type: `profile-${control}` });
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const startTransitionDrag = (event: React.PointerEvent<SVGElement>, dir: Direction, laneIndex: number, boundaryIndex: number) => {
    event.preventDefault();
    event.stopPropagation();
    const point = transitionPosition(dir, laneIndex, boundaryIndex);
    const targets = transitionTargets(dir, laneIndex, boundaryIndex).map(target => transitionPosition(dir, laneIndex, target, boundaryIndex));
    onSmartZoom([point, ...targets], 'fit');
    dragRef.current = { kind: 'transition', armId: arm.id, dir, laneIndex, boundaryIndex, original: structuredClone(committedConfig) };
    transitionMagnetRef.current = null;
    setTransitionDrag({ sourceBoundary: boundaryIndex, targetBoundary: null, point });
    setDrag({ active: true, type: 'profile-lane-transition' });
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const ghostLine = ghost && ghost.armId === arm.id ? (() => {
    const section = interpolateProfile(profile, ghost.distance);
    const location = atDistance(geometry, ghost.distance);
    const inPoint = add(location.p, scale(location.normal, directionSign(config, 'in') * (sideOuter(section as RoadProfilePoint, 'in') + 16 * zoom)));
    const outPoint = add(location.p, scale(location.normal, directionSign(config, 'out') * (sideOuter(section as RoadProfilePoint, 'out') + 16 * zoom)));
    return <line x1={inPoint.x} y1={inPoint.y} x2={outPoint.x} y2={outPoint.y} stroke="#2563eb" strokeWidth={1.5 * zoom} strokeDasharray={`${4 * zoom} ${3 * zoom}`} opacity=".55" pointerEvents="none" />;
  })() : null;

  const bands = (['in', 'out'] as const).map(dir => {
    const sign = directionSign(config, dir);
    const points = geometry.samples.map(sample => {
      const section = interpolateProfile(profile, sample.distance);
      return add(sample.p, scale(sample.normal, sign * (sideOuter(section as RoadProfilePoint, dir) + 13 * zoom)));
    });
    return (
      <path
        key={`ghost-band-${dir}`}
        d={pointsPath(points)}
        fill="none"
        stroke="transparent"
        strokeWidth="18"
        vectorEffect="non-scaling-stroke"
        pointerEvents="stroke"
        cursor="crosshair"
        data-handle="true"
        data-tooltip="Add point."
        onPointerMove={event => {
          if (dragRef.current) return;
          const pointer = localPointer(event);
          if (pointer) setGhost({ armId: arm.id, distance: projectDistance(geometry, pointer) });
        }}
        onPointerLeave={() => { if (!dragRef.current) setGhost(null); }}
        onPointerDown={event => {
          event.preventDefault();
          event.stopPropagation();
          const pointer = localPointer(event);
          if (!pointer) return;
          const added = addProfilePoint(committedConfig, arm.id, projectDistance(geometry, pointer));
          setCommittedConfig(added.config);
          if (added.pointId) setSelection({ kind: 'profile-point', armId: arm.id, pointId: added.pointId });
          setGhost(null);
        }}
      />
    );
  });

  return (
    <g>
      {bands}
      {ghostLine}
      {profile.map((point, pointIndex) => {
        const location = atDistance(geometry, point.distance);
        const selected = selectedPoint?.id === point.id;
        const internal = pointIndex > 0 && pointIndex < profile.length - 1;
        const lineTooltip = selected ? 'Move point.' : 'Select point.';
        const endpointTooltip = !selected ? 'Select point.' : internal ? 'Drag to move.' : 'Move point.';
        const inEnd = add(location.p, scale(location.normal, directionSign(config, 'in') * (sideOuter(point, 'in') + 14 * zoom)));
        const outEnd = add(location.p, scale(location.normal, directionSign(config, 'out') * (sideOuter(point, 'out') + 14 * zoom)));
        const dragEvents = {
          onPointerMove: moveDrag,
          onPointerUp: finishDrag,
          onPointerCancel: finishDrag
        };
        return (
          <g key={point.id}>
            <line x1={inEnd.x} y1={inEnd.y} x2={outEnd.x} y2={outEnd.y} stroke={selected ? '#2563eb' : '#64748b'} strokeWidth={(selected ? 1.8 : 1) * zoom} opacity={selected ? .88 : .42} pointerEvents="none" />
            <line x1={inEnd.x} y1={inEnd.y} x2={outEnd.x} y2={outEnd.y} stroke="transparent" strokeWidth="9" vectorEffect="non-scaling-stroke" cursor="move" data-handle="true" data-tooltip={lineTooltip} onPointerDown={event => startDistanceDrag(event, point.id)} {...dragEvents} />
            {[inEnd, outEnd].map((end, index) => (
              <circle key={index} cx={end.x} cy={end.y} r={(selected ? 5 : 4) * zoom} fill="#fff" stroke={selected ? '#2563eb' : '#64748b'} strokeWidth={2 * zoom} cursor="move" data-handle="true" data-tooltip={endpointTooltip} onPointerDown={event => startDistanceDrag(event, point.id)} {...dragEvents} />
            ))}
          </g>
        );
      })}
      {(['in', 'out'] as const).flatMap(dir => profileLaneTransitions(profile, dir).map(transition => {
        const home = transitionPosition(dir, transition.laneIndex, transition.boundaryIndex);
        const state = dragRef.current;
        const dragging = state?.kind === 'transition' && state.dir === dir && state.laneIndex === transition.laneIndex && state.boundaryIndex === transition.boundaryIndex;
        const center = dragging && transitionDrag ? transitionDrag.point : home;
        const added = dir === 'out' ? transition.toPresent : transition.fromPresent;
        const color = CONTROL_COLORS[transition.laneIndex % CONTROL_COLORS.length];
        const targets = dragging ? transitionTargets(dir, transition.laneIndex, transition.boundaryIndex) : [];
        return (
          <g key={`${dir}-${transition.laneIndex}-transition-${transition.boundaryIndex}`}>
            {targets.map(boundaryIndex => {
              const point = transitionPosition(dir, transition.laneIndex, boundaryIndex, transition.boundaryIndex);
              const active = transitionDrag?.targetBoundary === boundaryIndex;
              return <circle key={boundaryIndex} cx={point.x} cy={point.y} r={(active ? 8 : 6) * zoom} fill={active ? '#ede9fe' : '#fff'} stroke="#7c3aed" strokeWidth={(active ? 3 : 2) * zoom} strokeDasharray={active ? undefined : `${3 * zoom} ${2 * zoom}`} pointerEvents="none" />;
            })}
            {dragging && transitionDrag && len(sub(center, home)) > zoom && <line x1={home.x} y1={home.y} x2={center.x} y2={center.y} stroke="#7c3aed" strokeWidth={2 * zoom} strokeDasharray={`${5 * zoom} ${4 * zoom}`} strokeLinecap="round" opacity={transitionDrag.targetBoundary === null ? .55 : .9} pointerEvents="none" />}
            <g transform={`translate(${center.x} ${center.y})`} cursor="grab" onPointerDown={event => startTransitionDrag(event, dir, transition.laneIndex, transition.boundaryIndex)} onPointerMove={moveDrag} onPointerUp={finishDrag} onPointerCancel={finishDrag}>
              <circle r={9 * zoom} fill="transparent" data-handle="true" data-tooltip={added ? 'Move lane start.' : 'Move lane end.'} />
              <path d={`M 0 ${-7.5 * zoom} L ${7.5 * zoom} 0 L 0 ${7.5 * zoom} L ${-7.5 * zoom} 0 Z`} fill="#fff" stroke={color} strokeWidth={1.5 * zoom} strokeLinejoin="round" pointerEvents="none" />
              <path d={added ? `M ${-2 * zoom} 0 H ${2 * zoom} M 0 ${-2 * zoom} V ${2 * zoom}` : `M ${-2 * zoom} 0 H ${2 * zoom}`} fill="none" stroke={color} strokeWidth={1.5 * zoom} strokeLinecap="round" pointerEvents="none" />
            </g>
          </g>
        );
      }))}
      {widthSnapMatches.length > 0 && selectedPoint && (() => {
        const location = atDistance(geometry, selectedPoint.distance);
        return widthSnapMatches.map(({ dir, laneIndex }) => {
          const matchSign = directionSign(config, dir);
          const matchSideNormal = scale(location.normal, matchSign);
          const matchBounds = laneBounds(selectedPoint, dir, laneIndex);
          const inner = add(location.p, scale(matchSideNormal, matchBounds.inner));
          const outer = add(location.p, scale(matchSideNormal, matchBounds.outer));
          return <line key={`width-snap-${dir}-${laneIndex}`} x1={inner.x} y1={inner.y} x2={outer.x} y2={outer.y} stroke="#f59e0b" strokeWidth={2.5 * zoom} strokeLinecap="round" pointerEvents="none" />;
        });
      })()}
      {selectedPoint && (() => {
        const location = atDistance(geometry, selectedPoint.distance);
        const controls: React.ReactNode[] = [];
        for (const dir of ['in', 'out'] as const) {
          const sign = directionSign(config, dir);
          const travel = scale(location.tangent, dir === 'out' ? 1 : -1);
          const sideNormal = scale(location.normal, sign);
          const lanes = dir === 'in' ? selectedPoint.lanesIn : selectedPoint.lanesOut;
          lanes.forEach((lane, laneIndex) => {
            if (!isProfileLanePresent(lane)) return;
            const bounds = laneBounds(selectedPoint, dir, laneIndex);
            const shiftCenter = add(location.p, scale(sideNormal, bounds.inner + lane.width / 2));
            const widthCenter = add(location.p, scale(sideNormal, bounds.outer));
            const color = CONTROL_COLORS[laneIndex % CONTROL_COLORS.length];
            const widthTooltip = 'Adjust width.';
            controls.push(
              <g key={`${dir}-${laneIndex}-gap`} cursor="grab" onPointerDown={event => startControlDrag(event, selectedPoint, dir, 'gap', laneIndex)} onPointerMove={moveDrag} onPointerUp={finishDrag} onPointerCancel={finishDrag}>
                <circle cx={shiftCenter.x} cy={shiftCenter.y} r={9 * zoom} fill="transparent" data-handle="true" data-tooltip="Shift lane." />
                <path d={MOVEMENT_POINTER_PATH} transform={pointerTransform(shiftCenter, travel, sideNormal, zoom, 4, 4)} fill="#fff" stroke={color} strokeWidth={.8} pointerEvents="none" />
              </g>,
              <g key={`${dir}-${laneIndex}-width`} cursor="grab" onPointerDown={event => startControlDrag(event, selectedPoint, dir, 'width', laneIndex)} onPointerMove={moveDrag} onPointerUp={finishDrag} onPointerCancel={finishDrag}>
                <circle cx={widthCenter.x} cy={widthCenter.y} r={9 * zoom} fill="transparent" data-handle="true" data-tooltip={widthTooltip} />
                <path d={WIDTH_POINTER_PATH} transform={pointerTransform(widthCenter, travel, sideNormal, zoom, 4, 0, true)} fill="#fff" stroke={color} strokeWidth={.8} pointerEvents="none" />
              </g>
            );
          });
          const visibleLaneIndices = lanes.flatMap((lane, laneIndex) => isProfileLanePresent(lane) ? [laneIndex] : []);
          const insertIndices = visibleLaneIndices.length ? [...visibleLaneIndices, visibleLaneIndices[visibleLaneIndices.length - 1] + 1] : [0];
          for (const insertIndex of insertIndices) {
            const offset = insertIndex === 0 ? selectedPoint.medianWidth / 2 : laneBounds(selectedPoint, dir, insertIndex - 1).outer;
            const boundary = add(location.p, scale(sideNormal, offset));
            const center = add(boundary, scale(travel, -22 * zoom));
            const color = CONTROL_COLORS[Math.min(insertIndex, Math.max(0, lanes.length - 1)) % CONTROL_COLORS.length];
            controls.push(
              <g key={`${dir}-add-${insertIndex}`} transform={`translate(${center.x} ${center.y})`} cursor="pointer" onPointerDown={event => { event.preventDefault(); event.stopPropagation(); setCommittedConfig(addProfileLane(committedConfig, arm.id, selectedPoint.id, dir, insertIndex)); }}>
                <circle r={9 * zoom} fill="transparent" data-handle="true" data-tooltip="Add lane." />
                <circle r={6 * zoom} fill={color} pointerEvents="none" />
                <path d={`M ${-2.7 * zoom} 0 H ${2.7 * zoom} M 0 ${-2.7 * zoom} V ${2.7 * zoom}`} fill="none" stroke="#fff" strokeWidth={1.7 * zoom} strokeLinecap="round" pointerEvents="none" />
              </g>
            );
          }
        }
        return controls;
      })()}
    </g>
  );
};
