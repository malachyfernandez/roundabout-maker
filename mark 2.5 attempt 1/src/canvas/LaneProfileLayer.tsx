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
  setProfileControl
} from '../core/profile';
import { convertAnchorToCopy } from '../core/profile/anchors';
import { useEditorStore } from '../editor/editorStore';
import { add, dot, len, scale, sub, type Vec2 } from '../math/vector';
import { screenToWorld } from '../viewport/transform';
import { ProfileAddLaneMarker } from '../profile/ProfileAddLaneMarker';
import { ProfileControlIcon } from '../profile/ProfileControlIcon';
import { ProfileTransitionMarker } from '../profile/ProfileTransitionMarker';
import { profileControlColor } from '../profile/controlAppearance';
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
import {
  atProfileDistance,
  profileDirectionSign,
  profileGeometry,
  profilePointerTransform,
  profilePointsPath,
  projectProfileDistance
} from '../profile/worldGeometry';

type Props = { zoom: number; onSmartZoom: (points: Vec2[], mode: 'focus' | 'fit') => void };
type Direction = ProfileDirection;
type DragState =
  | { kind: 'distance'; armId: string; pointId: string; startDistance: number; moved: boolean; original: RoundaboutConfig }
  | { kind: 'control'; armId: string; pointId: string; dir: Direction; control: 'gap' | 'width'; laneIndex: number; base: Vec2; normal: Vec2; sign: number; original: RoundaboutConfig }
  | { kind: 'transition'; armId: string; dir: Direction; laneIndex: number; boundaryIndex: number; original: RoundaboutConfig };

type TransitionDrag = { sourceBoundary: number; targetBoundary: number | null; point: Vec2 };

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
  const rootRef = React.useRef<SVGGElement | null>(null);
  const [ghost, setGhost] = React.useState<{ armId: string; distance: number } | null>(null);
  const [transitionDrag, setTransitionDrag] = React.useState<TransitionDrag | null>(null);
  const [widthSnapMatches, setWidthSnapMatches] = React.useState<{ dir: Direction; laneIndex: number }[]>([]);
  const [gapSnapMatches, setGapSnapMatches] = React.useState<GapSnapMatch[]>([]);
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
    setGapSnapMatches([]);
    transitionMagnetRef.current = null;
  }, [armId]);

  React.useEffect(() => {
    if (activeDrag || !selectedPoint || !geometry) return;
    const location = atProfileDistance(geometry, selectedPoint.distance);
    const inEnd = add(location.p, scale(location.normal, profileDirectionSign(config, 'in') * (profileSideOuter(selectedPoint, 'in') + 10)));
    const outEnd = add(location.p, scale(location.normal, profileDirectionSign(config, 'out') * (profileSideOuter(selectedPoint, 'out') + 10)));
    onSmartZoom([inEnd, outEnd], 'focus');
  }, [activeDrag, config, geometry, onSmartZoom, selectedPoint]);

  if (viewMode === 'rendered' || !arm || !geometry || !selection || !['arm', 'lane', 'profile-point'].includes(selection.kind)) return null;

  const localPointer = (event: React.PointerEvent<SVGElement>) => {
    const svg = event.currentTarget.closest('svg');
    return svg ? screenToWorld(event, svg) : null;
  };

  const transitionPosition = (dir: Direction, laneIndex: number, boundaryIndex: number, sourceBoundary?: number) => {
    const section = profileTransitionSection(profile, dir, laneIndex, boundaryIndex, sourceBoundary);
    const location = atProfileDistance(geometry, section.distance);
    const sideNormal = scale(location.normal, profileDirectionSign(config, dir));
    const bounds = laneBounds(section, dir, laneIndex);
    return add(location.p, scale(sideNormal, bounds.inner + (bounds.outer - bounds.inner) / 2));
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
    setGapSnapMatches([]);
    setDrag(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    rootRef.current?.releasePointerCapture(event.pointerId);
  };

  const moveDrag = (event: React.PointerEvent<SVGElement>) => {
    const state = dragRef.current;
    const pointer = localPointer(event);
    if (!state || !pointer) return;
    if (state.kind === 'distance') {
      const distance = projectProfileDistance(geometry, pointer);
      if (Math.abs(distance - state.startDistance) > .75) state.moved = true;
      setDraftConfig(moveProfilePoint(state.original, state.armId, state.pointId, distance));
      return;
    }
    if (state.kind === 'transition') {
      const targets = profileTransitionTargets(profile, state.dir, state.laneIndex, state.boundaryIndex);
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
    let value = profileControlValue(sourcePoint, state.dir, state.laneIndex, state.control, offset);
    if (state.control === 'width') {
      const snapped = snapProfileLaneWidth(sourcePoint, state.dir, state.laneIndex, value);
      value = snapped.value;
      setWidthSnapMatches(snapped.matches);
      setGapSnapMatches([]);
    } else {
      const sourceProfile = getRoadProfile(sourceArm, estimateArmLength(sourceArm));
      const originalLane = (state.dir === 'in' ? sourcePoint.lanesIn : sourcePoint.lanesOut)[state.laneIndex];
      const originalOffset = profileLaneTotalOffset(sourcePoint, state.dir, state.laneIndex);
      const currentOffset = originalOffset - (originalLane?.gap ?? 0) + value;
      const snapped = snapProfileLaneGap(sourceProfile, state.pointId, state.dir, state.laneIndex, currentOffset);
      if (snapped.matches.length) value = (originalLane?.gap ?? 0) + (snapped.totalOffset - originalOffset);
      setGapSnapMatches(snapped.matches);
      setWidthSnapMatches([]);
    }
    setDraftConfig(setProfileControl(state.original, state.armId, state.pointId, state.dir, state.control, Math.max(0, value), state.laneIndex));
  };

  const startDistanceDrag = (event: React.PointerEvent<SVGElement>, pointId: string) => {
    event.preventDefault();
    event.stopPropagation();
    setSelection({ kind: 'profile-point', armId: arm.id, pointId });
    const point = profile.find(candidate => candidate.id === pointId);
    let original = structuredClone(committedConfig);
    if (point?.endAnchor) {
      original = convertAnchorToCopy(original, arm.id, pointId);
      setCommittedConfig(original);
    }
    dragRef.current = { kind: 'distance', armId: arm.id, pointId, startDistance: point?.distance ?? 0, moved: false, original };
    setDrag({ active: true, type: 'profile-distance' });
    rootRef.current?.setPointerCapture(event.pointerId);
  };

  const startControlDrag = (event: React.PointerEvent<SVGElement>, point: RoadProfilePoint, dir: Direction, control: 'gap' | 'width', laneIndex: number) => {
    event.preventDefault();
    event.stopPropagation();
    const location = atProfileDistance(geometry, point.distance);
    dragRef.current = {
      kind: 'control', armId: arm.id, pointId: point.id, dir, control, laneIndex,
      base: location.p, normal: location.normal, sign: profileDirectionSign(committedConfig, dir), original: structuredClone(committedConfig)
    };
    setDrag({ active: true, type: `profile-${control}` });
    rootRef.current?.setPointerCapture(event.pointerId);
  };

  const startTransitionDrag = (event: React.PointerEvent<SVGElement>, dir: Direction, laneIndex: number, boundaryIndex: number) => {
    event.preventDefault();
    event.stopPropagation();
    const point = transitionPosition(dir, laneIndex, boundaryIndex);
    const targets = profileTransitionTargets(profile, dir, laneIndex, boundaryIndex).map(target => transitionPosition(dir, laneIndex, target, boundaryIndex));
    onSmartZoom([point, ...targets], 'fit');
    dragRef.current = { kind: 'transition', armId: arm.id, dir, laneIndex, boundaryIndex, original: structuredClone(committedConfig) };
    transitionMagnetRef.current = null;
    setTransitionDrag({ sourceBoundary: boundaryIndex, targetBoundary: null, point });
    setDrag({ active: true, type: 'profile-lane-transition' });
    rootRef.current?.setPointerCapture(event.pointerId);
  };

  const ghostLine = ghost && ghost.armId === arm.id ? (() => {
    const section = interpolateProfile(profile, ghost.distance);
    const location = atProfileDistance(geometry, ghost.distance);
    const inPoint = add(location.p, scale(location.normal, profileDirectionSign(config, 'in') * (profileSideOuter(section as RoadProfilePoint, 'in') + 16 * zoom)));
    const outPoint = add(location.p, scale(location.normal, profileDirectionSign(config, 'out') * (profileSideOuter(section as RoadProfilePoint, 'out') + 16 * zoom)));
    return <line x1={inPoint.x} y1={inPoint.y} x2={outPoint.x} y2={outPoint.y} stroke="#2563eb" strokeWidth={1.5 * zoom} strokeDasharray={`${4 * zoom} ${3 * zoom}`} opacity=".55" pointerEvents="none" />;
  })() : null;

  const bands = (['in', 'out'] as const).map(dir => {
    const sign = profileDirectionSign(config, dir);
    const points = geometry.samples.map(sample => {
      const section = interpolateProfile(profile, sample.distance);
      return add(sample.p, scale(sample.normal, sign * (profileSideOuter(section as RoadProfilePoint, dir) + 13 * zoom)));
    });
    return (
      <path
        key={`ghost-band-${dir}`}
        d={profilePointsPath(points)}
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
          if (pointer) setGhost({ armId: arm.id, distance: projectProfileDistance(geometry, pointer) });
        }}
        onPointerLeave={() => { if (!dragRef.current) setGhost(null); }}
        onPointerDown={event => {
          event.preventDefault();
          event.stopPropagation();
          const pointer = localPointer(event);
          if (!pointer) return;
          const added = addProfilePoint(committedConfig, arm.id, projectProfileDistance(geometry, pointer));
          setCommittedConfig(added.config);
          if (added.pointId) setSelection({ kind: 'profile-point', armId: arm.id, pointId: added.pointId });
          setGhost(null);
        }}
      />
    );
  });

  return (
    <g ref={rootRef} onPointerMove={moveDrag} onPointerUp={finishDrag} onPointerCancel={finishDrag}>
      {bands}
      {ghostLine}
      {profile.map((point, pointIndex) => {
        const location = atProfileDistance(geometry, point.distance);
        const selected = selectedPoint?.id === point.id;
        const internal = pointIndex > 0 && pointIndex < profile.length - 1;
        const lineTooltip = selected ? 'Move point.' : 'Select point.';
        const endpointTooltip = !selected ? 'Select point.' : internal ? 'Drag to move.' : 'Move point.';
        const inEnd = add(location.p, scale(location.normal, profileDirectionSign(config, 'in') * (profileSideOuter(point, 'in') + 14 * zoom)));
        const outEnd = add(location.p, scale(location.normal, profileDirectionSign(config, 'out') * (profileSideOuter(point, 'out') + 14 * zoom)));
        return (
          <g key={point.id}>
            <line x1={inEnd.x} y1={inEnd.y} x2={outEnd.x} y2={outEnd.y} stroke={selected ? '#2563eb' : '#64748b'} strokeWidth={(selected ? 1.8 : 1) * zoom} opacity={selected ? .88 : .42} pointerEvents="none" />
            <line x1={inEnd.x} y1={inEnd.y} x2={outEnd.x} y2={outEnd.y} stroke="transparent" strokeWidth="9" vectorEffect="non-scaling-stroke" cursor="move" data-handle="true" data-tooltip={lineTooltip} onPointerDown={event => startDistanceDrag(event, point.id)} />
            {[inEnd, outEnd].map((end, index) => (
              <circle key={index} cx={end.x} cy={end.y} r={(selected ? 5 : 4) * zoom} fill="#fff" stroke={selected ? '#2563eb' : '#64748b'} strokeWidth={2 * zoom} cursor="move" data-handle="true" data-tooltip={endpointTooltip} onPointerDown={event => startDistanceDrag(event, point.id)} />
            ))}
          </g>
        );
      })}
      {(!activeDrag || transitionDrag) && (['in', 'out'] as const).flatMap(dir => profileLaneTransitions(profile, dir).map(transition => {
        const home = transitionPosition(dir, transition.laneIndex, transition.boundaryIndex);
        const state = dragRef.current;
        const dragging = state?.kind === 'transition' && state.dir === dir && state.laneIndex === transition.laneIndex && state.boundaryIndex === transition.boundaryIndex;
        const center = dragging && transitionDrag ? transitionDrag.point : home;
        const added = dir === 'out' ? transition.toPresent : transition.fromPresent;
        const targets = dragging ? profileTransitionTargets(profile, dir, transition.laneIndex, transition.boundaryIndex) : [];
        const isSnapped = transitionDrag?.targetBoundary !== null && transitionDrag?.targetBoundary !== undefined;
        return (
          <g key={`${dir}-${transition.laneIndex}-transition-${transition.boundaryIndex}`}>
            {targets.map(boundaryIndex => {
              const point = transitionPosition(dir, transition.laneIndex, boundaryIndex, transition.boundaryIndex);
              const active = transitionDrag?.targetBoundary === boundaryIndex;
              return <circle key={boundaryIndex} cx={point.x} cy={point.y} r={(active ? 10 : 8) * zoom} fill={active ? '#dcfce7' : '#fff'} stroke="#22c55e" strokeWidth={(active ? 3 : 2) * zoom} strokeDasharray={active ? undefined : `${4 * zoom} ${3 * zoom}`} pointerEvents="none" />;
            })}
            {dragging && transitionDrag && len(sub(center, home)) > zoom && <line x1={home.x} y1={home.y} x2={center.x} y2={center.y} stroke="#22c55e" strokeWidth={2 * zoom} strokeDasharray={`${5 * zoom} ${4 * zoom}`} strokeLinecap="round" opacity={isSnapped ? 0.9 : 0.55} pointerEvents="none" />}
            <g transform={`translate(${center.x} ${center.y})`} cursor="grab" style={dragging && isSnapped ? { transition: 'transform 110ms cubic-bezier(0.2, 1.45, 0.4, 1)' } : undefined} onPointerDown={event => startTransitionDrag(event, dir, transition.laneIndex, transition.boundaryIndex)}>
              <ProfileTransitionMarker added={added} tooltip={added ? 'Move lane start.' : 'Move lane end.'} scale={zoom} color={profileControlColor(transition.laneIndex)} dragging={dragging} snapped={isSnapped} />
            </g>
          </g>
        );
      }))}
      {widthSnapMatches.length > 0 && selectedPoint && (() => {
        const location = atProfileDistance(geometry, selectedPoint.distance);
        return widthSnapMatches.map(({ dir, laneIndex }) => {
          const matchSign = profileDirectionSign(config, dir);
          const matchSideNormal = scale(location.normal, matchSign);
          const matchBounds = laneBounds(selectedPoint, dir, laneIndex);
          const inner = add(location.p, scale(matchSideNormal, matchBounds.inner));
          const outer = add(location.p, scale(matchSideNormal, matchBounds.outer));
          return <line key={`width-snap-${dir}-${laneIndex}`} x1={inner.x} y1={inner.y} x2={outer.x} y2={outer.y} stroke="#f59e0b" strokeWidth={2.5 * zoom} strokeLinecap="round" pointerEvents="none" />;
        });
      })()}
      {gapSnapMatches.length > 0 && gapSnapMatches.flatMap(({ pointId, dir, laneIndex }) => {
        const matchPoint = profile.find(candidate => candidate.id === pointId);
        if (!matchPoint) return [];
        const location = atProfileDistance(geometry, matchPoint.distance);
        const matchSign = profileDirectionSign(config, dir);
        const matchSideNormal = scale(location.normal, matchSign);
        const matchBounds = laneBounds(matchPoint, dir, laneIndex);
        const inner = add(location.p, scale(matchSideNormal, matchBounds.inner));
        const outer = add(location.p, scale(matchSideNormal, matchBounds.outer));
        return [<line key={`gap-snap-${pointId}-${dir}-${laneIndex}`} x1={inner.x} y1={inner.y} x2={outer.x} y2={outer.y} stroke="#f59e0b" strokeWidth={2.5 * zoom} strokeLinecap="round" pointerEvents="none" />];
      })}
      {!activeDrag && selectedPoint && (() => {
        const location = atProfileDistance(geometry, selectedPoint.distance);
        const selectedIndex = profile.findIndex(point => point.id === selectedPoint.id);
        const controls: React.ReactNode[] = [];
        for (const dir of ['in', 'out'] as const) {
          const sign = profileDirectionSign(config, dir);
          const travel = scale(location.tangent, dir === 'out' ? 1 : -1);
          const sideNormal = scale(location.normal, sign);
          const lanes = dir === 'in' ? selectedPoint.lanesIn : selectedPoint.lanesOut;
          lanes.forEach((lane, laneIndex) => {
            if (!isProfileLanePresent(lane)) return;
            const bounds = laneBounds(selectedPoint, dir, laneIndex);
            const shiftCenter = add(location.p, scale(sideNormal, bounds.inner + lane.width / 2));
            const widthCenter = add(location.p, scale(sideNormal, bounds.outer));
            const color = profileControlColor(laneIndex);
            const widthTooltip = 'Adjust width.';
            controls.push(
              <g key={`${dir}-${laneIndex}-gap`} cursor="grab" onPointerDown={event => startControlDrag(event, selectedPoint, dir, 'gap', laneIndex)}>
                <circle cx={shiftCenter.x} cy={shiftCenter.y} r={9 * zoom} fill="transparent" data-handle="true" data-tooltip="Shift lane." />
                <ProfileControlIcon kind="gap" color={color} transform={profilePointerTransform(shiftCenter, travel, sideNormal, zoom, 4, 4)} />
              </g>,
              <g key={`${dir}-${laneIndex}-width`} cursor="grab" onPointerDown={event => startControlDrag(event, selectedPoint, dir, 'width', laneIndex)}>
                <circle cx={widthCenter.x} cy={widthCenter.y} r={9 * zoom} fill="transparent" data-handle="true" data-tooltip={widthTooltip} />
                <ProfileControlIcon kind="width" color={color} transform={profilePointerTransform(widthCenter, travel, sideNormal, zoom, 4, 0, true)} />
              </g>
            );
            for (const mover of profileLaneStartEndMovers(profile, dir, laneIndex, selectedIndex)) {
              const moverPoint = profile.find(candidate => candidate.id === mover.pointId);
              const moverLane = moverPoint && (dir === 'in' ? moverPoint.lanesIn : moverPoint.lanesOut)[laneIndex];
              if (!moverPoint || !moverLane) continue;
              const moverLocation = atProfileDistance(geometry, moverPoint.distance);
              const moverSign = profileDirectionSign(config, dir);
              const moverSideNormal = scale(moverLocation.normal, moverSign);
              const moverTravel = scale(moverLocation.tangent, dir === 'out' ? 1 : -1);
              const moverBounds = laneBounds(moverPoint, dir, laneIndex);
              const lateral = add(moverLocation.p, scale(moverSideNormal, moverBounds.inner + moverLane.width / 2));
              const center = add(lateral, scale(moverTravel, (mover.kind === 'start' ? 22 : -22) * zoom));
              const tooltip = mover.kind === 'start' ? 'Shift lane start.' : 'Shift lane end.';
              controls.push(
                <g key={`${dir}-${laneIndex}-${mover.kind}-mover-${mover.pointId}`} cursor="grab" onPointerDown={event => startControlDrag(event, moverPoint, dir, 'gap', laneIndex)}>
                  <circle cx={center.x} cy={center.y} r={9 * zoom} fill="transparent" data-handle="true" data-tooltip={tooltip} />
                  <ProfileControlIcon kind="gap" color={color} transform={profilePointerTransform(center, moverTravel, moverSideNormal, zoom, 4, 4)} />
                </g>
              );
            }
          });
          const insertIndices = profileLaneInsertIndices(selectedPoint, dir);
          for (const insertIndex of insertIndices) {
            const offset = insertIndex === 0 ? selectedPoint.medianWidth / 2 : laneBounds(selectedPoint, dir, insertIndex - 1).outer;
            const boundary = add(location.p, scale(sideNormal, offset));
            const center = add(boundary, scale(travel, -22 * zoom));
            const color = profileControlColor(Math.min(insertIndex, Math.max(0, lanes.length - 1)));
            controls.push(
              <g key={`${dir}-add-${insertIndex}`} transform={`translate(${center.x} ${center.y})`} cursor="pointer" onPointerDown={event => { event.preventDefault(); event.stopPropagation(); setCommittedConfig(addProfileLane(committedConfig, arm.id, selectedPoint.id, dir, insertIndex)); }}>
                <circle r={9 * zoom} fill="transparent" data-handle="true" data-tooltip="Add lane." />
                <ProfileAddLaneMarker color={color} scale={zoom} />
              </g>
            );
          }
        }
        return controls;
      })()}
    </g>
  );
};
