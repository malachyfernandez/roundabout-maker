import React from 'react';
import { type RoadProfilePoint, type RoundaboutConfig } from '../config/types';
import {
  addProfileLane,
  addProfilePoint,
  estimateArmLength,
  getRoadProfile,
  isProfileLanePresent,
  laneBounds,
  moveProfileLaneTransition,
  moveProfilePoint,
  profileLaneTransitions,
  removeProfilePoint,
  setProfileControl
} from '../core/profile';
import { useEditorStore } from '../editor/editorStore';
import { ProfileAddLaneMarker } from '../profile/ProfileAddLaneMarker';
import { ProfileControlIcon } from '../profile/ProfileControlIcon';
import { ProfileTransitionMarker } from '../profile/ProfileTransitionMarker';
import { profileControlColor } from '../profile/controlAppearance';
import { convertAnchorToCopy } from '../core/profile/anchors';
import {
  profileControlValue,
  profileLaneInsertIndices,
  profileLaneStartEndMovers,
  profileLaneTotalOffset,
  profileSideOuter,
  profileTransitionSection,
  profileTransitionTargets,
  snapProfileLaneGap,
  snapProfileLaneWidth,
  type GapSnapMatch,
  type ProfileDirection
} from '../profile/editorMath';
import { dataKeys, dragModifiers, HINT } from './keyHints';

type Props = {
  config: RoundaboutConfig;
  armId: string;
  onChange: (config: RoundaboutConfig) => void;
};

type Direction = ProfileDirection;
type DragTarget =
  | { kind: 'distance'; pointId: string; startDistance: number; moved: boolean; original: RoundaboutConfig }
  | { kind: 'control'; pointId: string; dir: Direction; control: 'gap' | 'width'; laneIndex: number; original: RoundaboutConfig }
  | { kind: 'transition'; dir: Direction; laneIndex: number; boundaryIndex: number; original: RoundaboutConfig };

type TransitionDrag = { sourceBoundary: number; targetBoundary: number | null; x: number; y: number };

const WIDTH = 410;
const HEIGHT = 520;
const PAD_Y = 30;
const CENTER_X = 205;

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
  const [isDragging, setIsDragging] = React.useState(false);
  const [widthSnapMatches, setWidthSnapMatches] = React.useState<{ dir: Direction; laneIndex: number }[]>([]);
  const [gapSnapMatches, setGapSnapMatches] = React.useState<GapSnapMatch[]>([]);
  const transitionMagnetRef = React.useRef<number | null>(null);
  if (!arm || !selected) return null;

  // The "propper road" runs between the two ending cross-sections.
  const roadStart = (profile.find(point => point.endAnchor === 'start') ?? profile[0])?.distance ?? 0;
  const roadEnd = (profile.find(point => point.endAnchor === 'end') ?? profile[profile.length - 1])?.distance ?? totalLength;

  const maxOffset = Math.max(18, ...profile.flatMap(point => [profileSideOuter(point, 'in'), profileSideOuter(point, 'out')]));
  const xScale = Math.min(5, (CENTER_X - 24) / maxOffset);
  const yForDistance = (distance: number) => HEIGHT - PAD_Y - Math.max(0, Math.min(1, distance / totalLength)) * (HEIGHT - PAD_Y * 2);
  const distanceForY = (y: number) => Math.max(0, Math.min(totalLength, (HEIGHT - PAD_Y - y) / (HEIGHT - PAD_Y * 2) * totalLength));
  const localPoint = (event: React.PointerEvent<SVGSVGElement> | React.MouseEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: (event.clientX - rect.left) * WIDTH / rect.width, y: (event.clientY - rect.top) * HEIGHT / rect.height };
  };

  const transitionPosition = (dir: Direction, laneIndex: number, boundaryIndex: number, sourceBoundary?: number) => {
    const section = profileTransitionSection(profile, dir, laneIndex, boundaryIndex, sourceBoundary);
    const bounds = laneBounds(section, dir, laneIndex);
    const sign = dir === 'in' ? -1 : 1;
    const capOffsetY = boundaryIndex < 0 ? 26 : boundaryIndex >= profile.length - 1 ? -26 : 0;
    return { x: CENTER_X + sign * (bounds.inner + (bounds.outer - bounds.inner) / 2) * xScale, y: yForDistance(section.distance) + capOffsetY };
  };

  const startDrag = (event: React.PointerEvent<SVGElement>, target: Omit<Extract<DragTarget, { kind: 'distance' }>, 'original'> | Omit<Extract<DragTarget, { kind: 'control' }>, 'original'> | Omit<Extract<DragTarget, { kind: 'transition' }>, 'original'>) => {
    event.preventDefault();
    event.stopPropagation();
    drag.current = { ...target, original: structuredClone(config) } as DragTarget;
    setIsDragging(true);
    event.currentTarget.closest('svg')?.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: React.PointerEvent<SVGSVGElement>) => {
    const pointer = localPoint(event);
    const state = drag.current;
    const modifiers = dragModifiers(event);
    if (!state) {
      const overSide = Math.abs(pointer.x - CENTER_X) > maxOffset * xScale + 8;
      const distance = distanceForY(pointer.y);
      setGhostDistance(overSide && distance > roadStart && distance < roadEnd ? distance : null);
      return;
    }
    if (state.kind === 'distance') {
      const distance = distanceForY(pointer.y);
      if (Math.abs(distance - state.startDistance) > .75) {
        if (!state.moved) {
          const sourceArm = state.original.arms.find(candidate => candidate.id === armId);
          const sourcePoint = sourceArm && getRoadProfile(sourceArm, estimateArmLength(sourceArm)).find(point => point.id === state.pointId);
          if (sourcePoint?.endAnchor) state.original = convertAnchorToCopy(state.original, armId, state.pointId);
        }
        state.moved = true;
      }
      onChange(moveProfilePoint(state.original, armId, state.pointId, distance));
      return;
    }
    if (state.kind === 'transition') {
      const targets = profileTransitionTargets(profile, state.dir, state.laneIndex, state.boundaryIndex);
      let target = transitionMagnetRef.current;
      if (modifiers.mod) target = null;
      else if (target === null || Math.hypot(transitionPosition(state.dir, state.laneIndex, target, state.boundaryIndex).x - pointer.x, transitionPosition(state.dir, state.laneIndex, target, state.boundaryIndex).y - pointer.y) > 18) {
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
    let value = profileControlValue(sourcePoint, state.dir, state.laneIndex, state.control, offset);
    if (state.control === 'width') {
      const snapped = modifiers.mod ? { value, matches: [] } : snapProfileLaneWidth(sourcePoint, state.dir, state.laneIndex, value);
      value = snapped.value;
      setWidthSnapMatches(snapped.matches);
      setGapSnapMatches([]);
    } else {
      const sourceProfile = getRoadProfile(sourceArm, estimateArmLength(sourceArm));
      const originalLane = (state.dir === 'in' ? sourcePoint.lanesIn : sourcePoint.lanesOut)[state.laneIndex];
      const originalOffset = profileLaneTotalOffset(sourcePoint, state.dir, state.laneIndex);
      const currentOffset = originalOffset - (originalLane?.gap ?? 0) + value;
      const snapped = modifiers.mod ? { totalOffset: currentOffset, matches: [] } : snapProfileLaneGap(sourceProfile, state.pointId, state.dir, state.laneIndex, currentOffset);
      if (snapped.matches.length) value = (originalLane?.gap ?? 0) + (snapped.totalOffset - originalOffset);
      setGapSnapMatches(snapped.matches);
      setWidthSnapMatches([]);
    }
    onChange(setProfileControl(state.original, armId, state.pointId, state.dir, state.control, Math.max(0, value), state.laneIndex, modifiers.shift));
  };

  const handlePointerUp = (event: React.PointerEvent<SVGSVGElement>) => {
    const state = drag.current;
    if (state?.kind === 'transition' && transitionMagnetRef.current !== null) {
      onChange(moveProfileLaneTransition(state.original, armId, state.dir, state.laneIndex, state.boundaryIndex, transitionMagnetRef.current));
    }
    drag.current = null;
    transitionMagnetRef.current = null;
    setTransitionDrag(null);
    setIsDragging(false);
    setWidthSnapMatches([]);
    setGapSnapMatches([]);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  return (
    <section className="road-profile" data-tooltip="Lane profile.">
      <div className="road-profile-heading">
        <div>
          <strong>Cross-sections</strong>
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
        data-tooltip="Add cross-section."
      >
        <rect x="0" y="0" width={WIDTH} height={HEIGHT} rx="9" fill="#f8fafc" />
        <rect x={CENTER_X - selected.medianWidth * xScale / 2} y={PAD_Y} width={selected.medianWidth * xScale} height={HEIGHT - PAD_Y * 2} fill="#cbd5e1" opacity=".75" pointerEvents="none" />
        <rect x={8} y={PAD_Y} width={WIDTH - 16} height={Math.max(0, yForDistance(roadEnd) - PAD_Y)} fill="#e2e8f0" opacity=".55" pointerEvents="none" />
        <rect x={8} y={yForDistance(roadStart)} width={WIDTH - 16} height={Math.max(0, HEIGHT - PAD_Y - yForDistance(roadStart))} fill="#e2e8f0" opacity=".55" pointerEvents="none" />
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
          const lineTooltip = isSelected ? 'Move cross-section.' : 'Select cross-section.';
          const endpointTooltip = !isSelected ? 'Select cross-section.' : internal ? 'Drag to move.' : 'Move cross-section.';
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
        {(!isDragging || transitionDrag) && (['in', 'out'] as const).flatMap(dir => profileLaneTransitions(profile, dir).map(transition => {
          const home = transitionPosition(dir, transition.laneIndex, transition.boundaryIndex);
          const state = drag.current;
          const dragging = state?.kind === 'transition' && state.dir === dir && state.laneIndex === transition.laneIndex && state.boundaryIndex === transition.boundaryIndex;
          const center = dragging && transitionDrag ? transitionDrag : { ...home, sourceBoundary: transition.boundaryIndex, targetBoundary: null };
          const added = dir === 'out' ? transition.toPresent : transition.fromPresent;
          const targets = dragging ? profileTransitionTargets(profile, dir, transition.laneIndex, transition.boundaryIndex) : [];
          const isSnapped = transitionDrag?.targetBoundary !== null && transitionDrag?.targetBoundary !== undefined;
          return (
            <g key={`${dir}-${transition.laneIndex}-transition-${transition.boundaryIndex}`}>
              {targets.map(boundaryIndex => {
                const point = transitionPosition(dir, transition.laneIndex, boundaryIndex, transition.boundaryIndex);
                const active = transitionDrag?.targetBoundary === boundaryIndex;
                return <circle key={boundaryIndex} cx={point.x} cy={point.y} r={active ? 8 : 6} fill={active ? '#dcfce7' : '#fff'} stroke="#22c55e" strokeWidth={active ? 3 : 2} strokeDasharray={active ? undefined : '4 3'} pointerEvents="none" />;
              })}
              {dragging && transitionDrag && Math.hypot(center.x - home.x, center.y - home.y) > 1 && <line x1={home.x} y1={home.y} x2={center.x} y2={center.y} stroke="#22c55e" strokeWidth="2" strokeDasharray="5 4" strokeLinecap="round" opacity={isSnapped ? .9 : .55} pointerEvents="none" />}
              <g
                transform={`translate(${center.x} ${center.y})`}
                cursor="grab"
                style={dragging && isSnapped ? { transition: 'transform 110ms cubic-bezier(0.2, 1.45, 0.4, 1)' } : undefined}
                onPointerDown={event => {
                  transitionMagnetRef.current = null;
                  setTransitionDrag({ sourceBoundary: transition.boundaryIndex, targetBoundary: null, ...home });
                  startDrag(event, { kind: 'transition', dir, laneIndex: transition.laneIndex, boundaryIndex: transition.boundaryIndex });
                }}
              >
                <ProfileTransitionMarker added={added} tooltip={added ? 'Move lane start.' : 'Move lane end.'} keyHints={dataKeys(HINT.noSnap)} color={profileControlColor(transition.laneIndex)} dragging={dragging} snapped={isSnapped} />
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
        {gapSnapMatches.length > 0 && gapSnapMatches.flatMap(({ pointId, dir, laneIndex }) => {
          const matchPoint = profile.find(candidate => candidate.id === pointId);
          if (!matchPoint) return [];
          const y = yForDistance(matchPoint.distance);
          const sign = dir === 'in' ? -1 : 1;
          const bounds = laneBounds(matchPoint, dir, laneIndex);
          const innerX = CENTER_X + sign * bounds.inner * xScale;
          const outerX = CENTER_X + sign * bounds.outer * xScale;
          return [<line key={`gap-snap-${pointId}-${dir}-${laneIndex}`} x1={innerX} y1={y} x2={outerX} y2={y} stroke="#f59e0b" strokeWidth="2.5" strokeLinecap="round" pointerEvents="none" />];
        })}
        {!isDragging && (() => {
          const y = yForDistance(selected.distance);
          const selectedIndex = profile.findIndex(point => point.id === selected.id);
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
              const color = profileControlColor(laneIndex);
              const widthTooltip = 'Adjust width.';
              controls.push(
                <g key={`${dir}-${laneIndex}-gap`} cursor="grab" onPointerDown={event => startDrag(event, { kind: 'control', pointId: selected.id, dir, control: 'gap', laneIndex })}>
                  <circle cx={shiftX} cy={y} r="9" fill="transparent" data-handle="true" data-tooltip="Shift lane." data-keys={dataKeys(HINT.isolateSection, HINT.noSnap)} />
                  <ProfileControlIcon kind="gap" color={color} transform={pointerTransform(shiftX, y, travelY, sign, 4, 4)} />
                </g>,
                <g key={`${dir}-${laneIndex}-width`} cursor="grab" onPointerDown={event => startDrag(event, { kind: 'control', pointId: selected.id, dir, control: 'width', laneIndex })}>
                  <circle cx={widthX} cy={y} r="9" fill="transparent" data-handle="true" data-tooltip={widthTooltip} data-keys={dataKeys(HINT.isolateSection, HINT.noSnap)} />
                  <ProfileControlIcon kind="width" color={color} transform={pointerTransform(widthX, y, travelY, sign, 4, 0, true)} />
                </g>
              );
              for (const mover of profileLaneStartEndMovers(profile, dir, laneIndex, selectedIndex)) {
                const moverPoint = profile.find(candidate => candidate.id === mover.pointId);
                const moverLane = moverPoint && (dir === 'in' ? moverPoint.lanesIn : moverPoint.lanesOut)[laneIndex];
                if (!moverPoint || !moverLane) continue;
                const moverBounds = laneBounds(moverPoint, dir, laneIndex);
                const moverX = CENTER_X + sign * (moverBounds.inner + moverLane.width / 2) * xScale;
                const moverY = yForDistance(moverPoint.distance) + travelY * (mover.kind === 'start' ? 22 : -22);
                const tooltip = mover.kind === 'start' ? 'Shift lane start.' : 'Shift lane end.';
                controls.push(
                  <g key={`${dir}-${laneIndex}-${mover.kind}-mover-${mover.pointId}`} cursor="grab" onPointerDown={event => startDrag(event, { kind: 'control', pointId: moverPoint.id, dir, control: 'gap', laneIndex })}>
                    <circle cx={moverX} cy={moverY} r="9" fill="transparent" data-handle="true" data-tooltip={tooltip} data-keys={dataKeys(HINT.isolateSection, HINT.noSnap)} />
                    <ProfileControlIcon kind="gap" color={color} transform={pointerTransform(moverX, moverY, travelY, sign, 4, 4)} />
                  </g>
                );
              }
            });
            const insertIndices = profileLaneInsertIndices(selected, dir);
            for (const insertIndex of insertIndices) {
              const offset = insertIndex === 0 ? selected.medianWidth / 2 : laneBounds(selected, dir, insertIndex - 1).outer;
              const x = CENTER_X + sign * offset * xScale;
              const color = profileControlColor(Math.min(insertIndex, Math.max(0, lanes.length - 1)));
              controls.push(
                <g key={`${dir}-add-${insertIndex}`} transform={`translate(${x} ${y - travelY * 26})`} cursor="pointer" onPointerDown={event => { event.preventDefault(); event.stopPropagation(); onChange(addProfileLane(config, armId, selected.id, dir, insertIndex)); }}>
                  <circle r="9" fill="transparent" data-handle="true" data-tooltip="Add lane." />
                  <ProfileAddLaneMarker color={color} />
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
        <span><strong>{Math.round(selected.distance)} ft</strong> cross-section</span>
        <span>Edits continue to the next downstream cross-section</span>
        <button
          disabled={profile.length <= 2 || !!selected.endAnchor}
          data-tooltip="Delete cross-section."
          onClick={() => { onChange(removeProfilePoint(config, armId, selected.id)); setSelection({ kind: 'arm', armId }); }}
        >Delete cross-section</button>
      </div>
    </section>
  );
};
