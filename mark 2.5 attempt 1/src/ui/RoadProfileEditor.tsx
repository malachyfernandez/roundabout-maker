import React from 'react';
import { type RoadProfilePoint, type RoundaboutConfig } from '../config/types';
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
  removeProfilePoint,
  setProfileControl
} from '../core/profile';
import { useEditorStore } from '../editor/editorStore';

type Props = {
  config: RoundaboutConfig;
  armId: string;
  onChange: (config: RoundaboutConfig) => void;
};

type Direction = 'in' | 'out';
type DragTarget =
  | { kind: 'distance'; pointId: string; startDistance: number; moved: boolean; original: RoundaboutConfig }
  | { kind: 'control'; pointId: string; dir: Direction; control: 'gap' | 'width'; laneIndex: number; original: RoundaboutConfig }
  | { kind: 'transition'; dir: Direction; laneIndex: number; boundaryIndex: number; original: RoundaboutConfig };

type TransitionDrag = { sourceBoundary: number; targetBoundary: number | null; x: number; y: number };

const WIDTH = 410;
const HEIGHT = 520;
const PAD_Y = 30;
const CENTER_X = 205;
const CONTROL_COLORS = ['#2563eb', '#7c3aed', '#0891b2', '#0d9488', '#4f46e5'];

function lanePaths(profile: RoadProfilePoint[], dir: Direction, laneIndex: number, xScale: number, yForDistance: (distance: number) => number) {
  const sign = dir === 'in' ? -1 : 1;
  const active = profile.map(point => isProfileLanePresent((dir === 'in' ? point.lanesIn : point.lanesOut)[laneIndex]));
  const ranges: { start: number; end: number }[] = [];
  for (let index = 0; index < active.length; index++) {
    if (!active[index]) continue;
    const start = index;
    while (index + 1 < active.length && active[index + 1]) index++;
    ranges.push({ start: Math.max(0, start - 1), end: Math.min(profile.length - 1, index + 1) });
  }
  return ranges.map(range => {
    const points = profile.slice(range.start, range.end + 1);
    const outer = points.map(point => `${CENTER_X + sign * laneBounds(point, dir, laneIndex).outer * xScale},${yForDistance(point.distance)}`);
    const inner = [...points].reverse().map(point => `${CENTER_X + sign * laneBounds(point, dir, laneIndex).inner * xScale},${yForDistance(point.distance)}`);
    return `M ${outer.join(' L ')} L ${inner.join(' L ')} Z`;
  });
}

const MOVEMENT_POINTER_PATH = 'M0.793044 3.29289L3.29304 0.792893C3.48058 0.605357 3.73493 0.5 4.00015 0.5H6.58594C7.13822 0.5 7.58594 0.947715 7.58594 1.5V6.5C7.58594 7.05228 7.13822 7.5 6.58594 7.5H4.00015C3.73493 7.5 3.48058 7.39464 3.29304 7.20711L0.793044 4.70711C0.40252 4.31658 0.402519 3.68342 0.793044 3.29289Z';
const WIDTH_POINTER_PATH = 'M6.5166 4.5H3.93081C3.6656 4.5 3.41125 4.39464 3.22371 4.20711L1.7666 2.75L0.891602 1.875L0.721389 1.70479C0.553128 1.53653 0.473907 1.29886 0.507559 1.0633L0.50889 1.05398C0.514022 1.01806 0.522177 0.982633 0.533269 0.948083C0.618894 0.681374 0.866945 0.500475 1.14706 0.500455L6.51653 0.500071C7.06884 0.500032 7.5166 0.947759 7.5166 1.50007V3.5C7.5166 4.05228 7.06889 4.5 6.5166 4.5Z';

function pointerTransform(x: number, y: number, travelY: number, sideSign: number, anchorX: number, anchorY: number, flipY = false) {
  const size = 1.6;
  const a = 0;
  const b = -travelY * size;
  const c = (flipY ? -1 : 1) * sideSign * size;
  const d = 0;
  return `matrix(${a} ${b} ${c} ${d} ${x - a * anchorX - c * anchorY} ${y - b * anchorX - d * anchorY})`;
}

export const RoadProfileEditor: React.FC<Props> = ({ config, armId, onChange }) => {
  const selection = useEditorStore(state => state.selection);
  const setSelection = useEditorStore(state => state.setSelection);
  const arm = config.arms.find(candidate => candidate.id === armId);
  const totalLength = arm ? Math.max(20, estimateArmLength(arm)) : 20;
  const profile = arm ? getRoadProfile(arm, totalLength) : [];
  const selectedId = selection?.kind === 'profile-point' && selection.armId === armId ? selection.pointId : profile[0]?.id ?? null;
  const selected = profile.find(point => point.id === selectedId) ?? profile[0];
  const drag = React.useRef<DragTarget | null>(null);
  const [ghostDistance, setGhostDistance] = React.useState<number | null>(null);
  const [transitionDrag, setTransitionDrag] = React.useState<TransitionDrag | null>(null);
  const [widthSnapMatches, setWidthSnapMatches] = React.useState<{ dir: Direction; laneIndex: number }[]>([]);
  const transitionMagnetRef = React.useRef<number | null>(null);
  if (!arm || !selected) return null;

  const maxOffset = Math.max(18, ...profile.flatMap(point => [sideOuter(point, 'in'), sideOuter(point, 'out')]));
  const xScale = Math.min(5, (CENTER_X - 24) / maxOffset);
  const yForDistance = (distance: number) => HEIGHT - PAD_Y - Math.max(0, Math.min(1, distance / totalLength)) * (HEIGHT - PAD_Y * 2);
  const distanceForY = (y: number) => Math.max(0, Math.min(totalLength, (HEIGHT - PAD_Y - y) / (HEIGHT - PAD_Y * 2) * totalLength));
  const localPoint = (event: React.PointerEvent<SVGSVGElement> | React.MouseEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: (event.clientX - rect.left) * WIDTH / rect.width, y: (event.clientY - rect.top) * HEIGHT / rect.height };
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
    const bounds = laneBounds(section, dir, laneIndex);
    const sign = dir === 'in' ? -1 : 1;
    return { x: CENTER_X + sign * (bounds.inner + (bounds.outer - bounds.inner) / 2) * xScale, y: yForDistance(distance) };
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

  const startDrag = (event: React.PointerEvent<SVGElement>, target: Omit<Extract<DragTarget, { kind: 'distance' }>, 'original'> | Omit<Extract<DragTarget, { kind: 'control' }>, 'original'> | Omit<Extract<DragTarget, { kind: 'transition' }>, 'original'>) => {
    event.preventDefault();
    event.stopPropagation();
    drag.current = { ...target, original: structuredClone(config) } as DragTarget;
    event.currentTarget.closest('svg')?.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: React.PointerEvent<SVGSVGElement>) => {
    const pointer = localPoint(event);
    const state = drag.current;
    if (!state) {
      const overSide = Math.abs(pointer.x - CENTER_X) > maxOffset * xScale + 8;
      setGhostDistance(overSide ? distanceForY(pointer.y) : null);
      return;
    }
    if (state.kind === 'distance') {
      const distance = distanceForY(pointer.y);
      if (Math.abs(distance - state.startDistance) > .75) state.moved = true;
      onChange(moveProfilePoint(state.original, armId, state.pointId, distance));
      return;
    }
    if (state.kind === 'transition') {
      const targets = transitionTargets(state.dir, state.laneIndex, state.boundaryIndex);
      let target = transitionMagnetRef.current;
      if (target === null || Math.hypot(transitionPosition(state.dir, state.laneIndex, target, state.boundaryIndex).x - pointer.x, transitionPosition(state.dir, state.laneIndex, target, state.boundaryIndex).y - pointer.y) > 18) {
        target = null;
        let nearestDistance = Infinity;
        for (const candidate of targets) {
          const point = transitionPosition(state.dir, state.laneIndex, candidate, state.boundaryIndex);
          const distance = Math.hypot(point.x - pointer.x, point.y - pointer.y);
          if (distance < nearestDistance) { target = candidate; nearestDistance = distance; }
        }
        if (nearestDistance > 18) target = null;
      }
      transitionMagnetRef.current = target;
      const point = target === null ? pointer : transitionPosition(state.dir, state.laneIndex, target, state.boundaryIndex);
      setTransitionDrag({ sourceBoundary: state.boundaryIndex, targetBoundary: target, ...point });
      return;
    }
    const sourceArm = state.original.arms.find(candidate => candidate.id === armId);
    const sourcePoint = sourceArm && getRoadProfile(sourceArm, estimateArmLength(sourceArm)).find(point => point.id === state.pointId);
    if (!sourcePoint) return;
    const sign = state.dir === 'in' ? -1 : 1;
    const offset = Math.max(0, (pointer.x - CENTER_X) * sign / xScale);
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
    onChange(setProfileControl(state.original, armId, state.pointId, state.dir, state.control, Math.max(0, value), state.laneIndex));
  };

  const handlePointerUp = (event: React.PointerEvent<SVGSVGElement>) => {
    const state = drag.current;
    if (state?.kind === 'transition' && transitionMagnetRef.current !== null) {
      onChange(moveProfileLaneTransition(state.original, armId, state.dir, state.laneIndex, state.boundaryIndex, transitionMagnetRef.current));
    }
    drag.current = null;
    transitionMagnetRef.current = null;
    setTransitionDrag(null);
    setWidthSnapMatches([]);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  return (
    <section className="road-profile" data-tooltip="Lane profile.">
      <div className="road-profile-heading">
        <div>
          <strong>Lane points</strong>
          <span>Roundabout at bottom · {Math.round(totalLength)} ft</span>
        </div>
        <span>Click beside the road to add</span>
      </div>
      <svg
        className="road-profile-canvas road-profile-canvas-vertical"
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onPointerLeave={() => { if (!drag.current) setGhostDistance(null); }}
        onPointerDown={event => {
          if (event.target !== event.currentTarget && (event.target as Element).tagName !== 'rect') return;
          const pointer = localPoint(event);
          if (Math.abs(pointer.x - CENTER_X) <= maxOffset * xScale + 8) return;
          const added = addProfilePoint(config, armId, distanceForY(pointer.y));
          onChange(added.config);
          if (added.pointId) setSelection({ kind: 'profile-point', armId, pointId: added.pointId });
          setGhostDistance(null);
        }}
        data-tooltip="Add point."
      >
        <rect x="0" y="0" width={WIDTH} height={HEIGHT} rx="9" fill="#f8fafc" />
        <rect x={CENTER_X - selected.medianWidth * xScale / 2} y={PAD_Y} width={selected.medianWidth * xScale} height={HEIGHT - PAD_Y * 2} fill="#cbd5e1" opacity=".75" pointerEvents="none" />
        {Array.from({ length: arm.lanesIn.length }, (_, laneIndex) => lanePaths(profile, 'in', laneIndex, xScale, yForDistance).map((path, pathIndex) => <path key={`in-${laneIndex}-${pathIndex}`} d={path} fill="#475569" stroke="#f8fafc" strokeWidth="1" pointerEvents="none" />))}
        {Array.from({ length: arm.lanesOut.length }, (_, laneIndex) => lanePaths(profile, 'out', laneIndex, xScale, yForDistance).map((path, pathIndex) => <path key={`out-${laneIndex}-${pathIndex}`} d={path} fill="#475569" stroke="#f8fafc" strokeWidth="1" pointerEvents="none" />))}
        <line x1={CENTER_X} y1={PAD_Y} x2={CENTER_X} y2={HEIGHT - PAD_Y} stroke="#facc15" strokeWidth="1.5" pointerEvents="none" />
        <text x={CENTER_X - 12} y={PAD_Y + 12} fill="#fff" fontSize="14">↓</text>
        <text x={CENTER_X + 5} y={PAD_Y + 12} fill="#fff" fontSize="14">↑</text>
        {ghostDistance !== null && <line x1="12" y1={yForDistance(ghostDistance)} x2={WIDTH - 12} y2={yForDistance(ghostDistance)} stroke="#2563eb" strokeWidth="1.5" strokeDasharray="5 4" opacity=".55" pointerEvents="none" />}
        {profile.map((point, pointIndex) => {
          const y = yForDistance(point.distance);
          const isSelected = point.id === selected.id;
          const internal = pointIndex > 0 && pointIndex < profile.length - 1;
          const lineTooltip = isSelected ? 'Move point.' : 'Select point.';
          const endpointTooltip = !isSelected ? 'Select point.' : internal ? 'Drag to move.' : 'Move point.';
          const startPointDrag = (event: React.PointerEvent<SVGElement>) => {
            setSelection({ kind: 'profile-point', armId, pointId: point.id });
            startDrag(event, { kind: 'distance', pointId: point.id, startDistance: point.distance, moved: false });
          };
          return (
            <g key={point.id}>
              <line x1="14" y1={y} x2={WIDTH - 14} y2={y} stroke={isSelected ? '#2563eb' : '#64748b'} strokeWidth={isSelected ? 2 : 1} opacity={isSelected ? .9 : .4} pointerEvents="none" />
              <line x1="14" y1={y} x2={WIDTH - 14} y2={y} stroke="transparent" strokeWidth="10" cursor="ns-resize" data-handle="true" data-tooltip={lineTooltip} onPointerDown={startPointDrag} />
              {[14, WIDTH - 14].map(x => <circle key={x} cx={x} cy={y} r={isSelected ? 5 : 4} fill="#fff" stroke={isSelected ? '#2563eb' : '#64748b'} strokeWidth="2" cursor="ns-resize" data-handle="true" data-tooltip={endpointTooltip} onPointerDown={startPointDrag} />)}
              <text x="18" y={y - 5} fill={isSelected ? '#1d4ed8' : '#64748b'} fontSize="8" pointerEvents="none">{Math.round(point.distance)}'</text>
            </g>
          );
        })}
        {(['in', 'out'] as const).flatMap(dir => profileLaneTransitions(profile, dir).map(transition => {
          const home = transitionPosition(dir, transition.laneIndex, transition.boundaryIndex);
          const state = drag.current;
          const dragging = state?.kind === 'transition' && state.dir === dir && state.laneIndex === transition.laneIndex && state.boundaryIndex === transition.boundaryIndex;
          const center = dragging && transitionDrag ? transitionDrag : { ...home, sourceBoundary: transition.boundaryIndex, targetBoundary: null };
          const added = dir === 'out' ? transition.toPresent : transition.fromPresent;
          const color = CONTROL_COLORS[transition.laneIndex % CONTROL_COLORS.length];
          const targets = dragging ? transitionTargets(dir, transition.laneIndex, transition.boundaryIndex) : [];
          return (
            <g key={`${dir}-${transition.laneIndex}-transition-${transition.boundaryIndex}`}>
              {targets.map(boundaryIndex => {
                const point = transitionPosition(dir, transition.laneIndex, boundaryIndex, transition.boundaryIndex);
                const active = transitionDrag?.targetBoundary === boundaryIndex;
                return <circle key={boundaryIndex} cx={point.x} cy={point.y} r={active ? 8 : 6} fill={active ? '#ede9fe' : '#fff'} stroke="#7c3aed" strokeWidth={active ? 3 : 2} strokeDasharray={active ? undefined : '3 2'} pointerEvents="none" />;
              })}
              {dragging && transitionDrag && Math.hypot(center.x - home.x, center.y - home.y) > 1 && <line x1={home.x} y1={home.y} x2={center.x} y2={center.y} stroke="#7c3aed" strokeWidth="2" strokeDasharray="5 4" strokeLinecap="round" opacity={transitionDrag.targetBoundary === null ? .55 : .9} pointerEvents="none" />}
              <g
                transform={`translate(${center.x} ${center.y})`}
                cursor="grab"
                onPointerDown={event => {
                  transitionMagnetRef.current = null;
                  setTransitionDrag({ sourceBoundary: transition.boundaryIndex, targetBoundary: null, ...home });
                  startDrag(event, { kind: 'transition', dir, laneIndex: transition.laneIndex, boundaryIndex: transition.boundaryIndex });
                }}
              >
                <circle r="9" fill="transparent" data-handle="true" data-tooltip={added ? 'Move lane start.' : 'Move lane end.'} />
                <path d="M 0 -7.5 L 7.5 0 L 0 7.5 L -7.5 0 Z" fill="#fff" stroke={color} strokeWidth="1.5" strokeLinejoin="round" pointerEvents="none" />
                <path d={added ? 'M -2 0 H 2 M 0 -2 V 2' : 'M -2 0 H 2'} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" pointerEvents="none" />
              </g>
            </g>
          );
        }))}
        {widthSnapMatches.length > 0 && (() => {
          const y = yForDistance(selected.distance);
          return widthSnapMatches.map(({ dir, laneIndex }) => {
            const sign = dir === 'in' ? -1 : 1;
            const bounds = laneBounds(selected, dir, laneIndex);
            const innerX = CENTER_X + sign * bounds.inner * xScale;
            const outerX = CENTER_X + sign * bounds.outer * xScale;
            return <line key={`width-snap-${dir}-${laneIndex}`} x1={innerX} y1={y} x2={outerX} y2={y} stroke="#f59e0b" strokeWidth="2.5" strokeLinecap="round" pointerEvents="none" />;
          });
        })()}
        {(() => {
          const y = yForDistance(selected.distance);
          const controls: React.ReactNode[] = [];
          for (const dir of ['in', 'out'] as const) {
            const sign = dir === 'in' ? -1 : 1;
            const travelY = dir === 'in' ? 1 : -1;
            const lanes = dir === 'in' ? selected.lanesIn : selected.lanesOut;
            lanes.forEach((lane, laneIndex) => {
              if (!isProfileLanePresent(lane)) return;
              const bounds = laneBounds(selected, dir, laneIndex);
              const shiftX = CENTER_X + sign * (bounds.inner + lane.width / 2) * xScale;
              const widthX = CENTER_X + sign * bounds.outer * xScale;
              const color = CONTROL_COLORS[laneIndex % CONTROL_COLORS.length];
              const widthTooltip = 'Adjust width.';
              controls.push(
                <g key={`${dir}-${laneIndex}-gap`} cursor="grab" onPointerDown={event => startDrag(event, { kind: 'control', pointId: selected.id, dir, control: 'gap', laneIndex })}>
                  <circle cx={shiftX} cy={y} r="9" fill="transparent" data-handle="true" data-tooltip="Shift lane." />
                  <path d={MOVEMENT_POINTER_PATH} transform={pointerTransform(shiftX, y, travelY, sign, 4, 4)} fill="#fff" stroke={color} strokeWidth=".8" pointerEvents="none" />
                </g>,
                <g key={`${dir}-${laneIndex}-width`} cursor="grab" onPointerDown={event => startDrag(event, { kind: 'control', pointId: selected.id, dir, control: 'width', laneIndex })}>
                  <circle cx={widthX} cy={y} r="9" fill="transparent" data-handle="true" data-tooltip={widthTooltip} />
                  <path d={WIDTH_POINTER_PATH} transform={pointerTransform(widthX, y, travelY, sign, 4, 0, true)} fill="#fff" stroke={color} strokeWidth=".8" pointerEvents="none" />
                </g>
              );
            });
            const visibleLaneIndices = lanes.flatMap((lane, laneIndex) => isProfileLanePresent(lane) ? [laneIndex] : []);
            const insertIndices = visibleLaneIndices.length ? [...visibleLaneIndices, visibleLaneIndices[visibleLaneIndices.length - 1] + 1] : [0];
            for (const insertIndex of insertIndices) {
              const offset = insertIndex === 0 ? selected.medianWidth / 2 : laneBounds(selected, dir, insertIndex - 1).outer;
              const x = CENTER_X + sign * offset * xScale;
              const color = CONTROL_COLORS[Math.min(insertIndex, Math.max(0, lanes.length - 1)) % CONTROL_COLORS.length];
              controls.push(
                <g key={`${dir}-add-${insertIndex}`} transform={`translate(${x} ${y - travelY * 26})`} cursor="pointer" onPointerDown={event => { event.preventDefault(); event.stopPropagation(); onChange(addProfileLane(config, armId, selected.id, dir, insertIndex)); }}>
                  <circle r="9" fill="transparent" data-handle="true" data-tooltip="Add lane." />
                  <circle r="6" fill={color} pointerEvents="none" />
                  <path d="M -2.7 0 H 2.7 M 0 -2.7 V 2.7" fill="none" stroke="#fff" strokeWidth="1.7" strokeLinecap="round" pointerEvents="none" />
                </g>
              );
            }
          }
          return controls;
        })()}
        <text x="8" y="16" fill="#64748b" fontSize="8">OUTER END</text>
        <text x="8" y={HEIGHT - 8} fill="#64748b" fontSize="8">ROUNDABOUT</text>
      </svg>
      <div className="profile-selection">
        <span><strong>{Math.round(selected.distance)} ft</strong> lane point</span>
        <span>Edits continue to the next downstream point</span>
        <button
          disabled={profile.length <= 2 || selected.id === profile[0].id || selected.id === profile[profile.length - 1].id}
          data-tooltip="Delete point."
          onClick={() => { onChange(removeProfilePoint(config, armId, selected.id)); setSelection({ kind: 'arm', armId }); }}
        >Delete point</button>
      </div>
    </section>
  );
};

function sideOuter(point: RoadProfilePoint, dir: Direction) {
  const lanes = dir === 'in' ? point.lanesIn : point.lanesOut;
  return lanes.reduce((outer, lane, laneIndex) => isProfileLanePresent(lane) ? Math.max(outer, laneBounds(point, dir, laneIndex).outer) : outer, point.medianWidth / 2);
}
