import React from 'react';
import { type ArmConfig, type RoadProfilePoint, type RoundaboutConfig, type SelectionTarget } from '../config/types';
import {
  addProfileLane,
  addProfilePoint,
  adjustProfileControls,
  estimateArmLength,
  getRoadProfile,
  interpolateProfile,
  isProfileLaneNodeAffected,
  isProfileLanePresent,
  laneBounds,
  moveProfileLanePoint,
  moveProfileLanePoints,
  moveProfileLaneTerminal,
  pinProfileLaneNodes,
  profileLaneTransitions,
  setProfileControl
} from '../core/profile';
import { useEditorStore } from '../editor/editorStore';
import { add, dot, len, scale, sub, type Vec2 } from '../math/vector';
import { miterOffsetEdges } from '../math/polyline';
import { screenToWorld } from '../viewport/transform';
import { ProfileLaneAddButton } from '../profile/ProfileLaneAddButton';
import { ProfileControlIcon } from '../profile/ProfileControlIcon';
import { ProfileTransitionMarker } from '../profile/ProfileTransitionMarker';
import { profileControlColor } from '../profile/controlAppearance';
import {
  profileControlValue,
  profileLaneTotalOffset,
  profileSideOuter,
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
  projectProfileDistance,
  type ProfileGeometry
} from '../profile/worldGeometry';
import { dataKeys, dragModifiers, HINT } from '../ui/keyHints';
import { duplicateSelectionOwners } from '../editor/duplicate';
import { sameSelectionTarget, selectionKey } from '../editor/selection';
import { authoredLaneNodeVisible, type ProfileSection } from '../core/profile/model';
import { findLanePoint, laneAttachmentIndex, laneNodeId } from '../core/profile/authored';

type Props = { zoom: number; onSmartZoom: (points: Vec2[], mode: 'focus' | 'fit') => void };
type Direction = ProfileDirection;
type LaneNodeTarget = Extract<SelectionTarget, { kind: 'lane-node' }>;

type DragState =
  | { kind: 'node'; armId: string; pointId: string; segmentPointIds?: string[]; dir: Direction; laneIndex: number; startPointer: Vec2; startDistance: number; clientStart: Vec2; moved: boolean; clickTarget?: SelectionTarget; duplicated?: boolean; original: RoundaboutConfig }
  | { kind: 'control'; armId: string; pointId: string; dir: Direction; control: 'gap' | 'width'; laneIndex: number; base: Vec2; normal: Vec2; sign: number; clientStart: Vec2; moved?: boolean; clickTarget?: SelectionTarget; duplicated?: boolean; linkedPointId?: string; original: RoundaboutConfig }
  | { kind: 'terminal'; armId: string; dir: Direction; laneIndex: number; boundaryIndex: number; ordinal: number; spanId?: string; side?: 'low' | 'high'; tipPointId?: string; attachPointId?: string; startPointer?: Vec2; clientStart?: Vec2; moved?: boolean; clickTarget?: SelectionTarget; original: RoundaboutConfig };

// A taper tip renders as a lane node — the START/END marker is its handle. It
// has an offset but no width, and `attachId` keeps its offset linked to the
// attachment node's offset when the tip itself is dragged.
type LaneNodeView = { id: string; index: number; point: RoadProfilePoint; pos: Vec2; end?: boolean; tip?: { ordinal: number; boundaryIndex: number; side: 'low' | 'high'; attachId: string } };
type LaneSegmentView = { from: LaneNodeView; to: LaneNodeView; path: string; regionPath: string; target: SelectionTarget; taper?: boolean };
type LaneTerminalView = {
  ordinal: number;
  boundaryIndex: number;
  tipIndex: number | null;
  linkedIndex: number | null;
  side: 'low' | 'high';
  added: boolean;
  pos: Vec2;
  angle: number;
  capPos: Vec2;
};
type LaneModel = {
  dir: Direction;
  laneIndex: number;
  color: string;
  paths: string[];
  nodes: LaneNodeView[];
  segments: LaneSegmentView[];
  terminals: LaneTerminalView[];
};

const lanesOf = (point: ProfileSection, dir: Direction) => dir === 'in' ? point.lanesIn : point.lanesOut;

// The editable primitive a lane has at a distance: an authored key, a taper
// attachment, or a taper tip — the things moveProfileLanePoint can move. Nodes
// that only bend because a neighbor lane changes have no primitive of their
// own; they follow their cause geometrically instead.
const lanePrimitiveId = (arm: ArmConfig, dir: Direction, laneIndex: number, distance: number): string | null => {
  const shape = arm.authoredProfile?.[dir][laneIndex];
  const key = shape?.keys.find(candidate => Math.abs(candidate.distance - distance) < 1e-6);
  if (key) return key.id;
  for (const span of shape?.spans ?? []) for (const side of ['low', 'high'] as const) {
    const terminal = span[side];
    if (terminal.kind === 'free' && Math.abs(terminal.attach - distance) < 1e-6) return `${span.id}_${side}_attach`;
    if (terminal.kind === 'free' && Math.abs(terminal.tip - distance) < 1e-6) return `${span.id}_${side}_tip`;
  }
  return null;
};

// When a distance is a taper tip's station, the attachment node linked to it.
const laneTipAttachmentId = (arm: ArmConfig, profile: RoadProfilePoint[], dir: Direction, laneIndex: number, tipDistance: number): string | null => {
  const shape = arm.authoredProfile?.[dir][laneIndex];
  for (const span of shape?.spans ?? []) for (const side of ['low', 'high'] as const) {
    const terminal = span[side];
    if (terminal.kind !== 'free' || Math.abs(terminal.tip - tipDistance) >= 1e-6) continue;
    const attachPoint = profile.find(point => Math.abs(point.distance - terminal.attach) < 1e-6);
    return attachPoint ? laneNodeId(arm, attachPoint, dir, laneIndex) : null;
  }
  return null;
};

function buildLaneModel(config: RoundaboutConfig, arm: ArmConfig, geometry: ProfileGeometry, profile: RoadProfilePoint[], dir: Direction, laneIndex: number, zoom: number): LaneModel {
  const n = profile.length;
  const sign = profileDirectionSign(config, dir);
  const centerOffsetOf = (section: ProfileSection) => {
    const bounds = laneBounds(section, dir, laneIndex);
    return bounds.inner + (bounds.outer - bounds.inner) / 2;
  };
  const posAtDistance = (distance: number, lateral: number) => {
    const location = atProfileDistance(geometry, distance);
    return add(location.p, scale(location.normal, sign * lateral));
  };

  const present = profile.map(point => isProfileLanePresent(lanesOf(point, dir)[laneIndex]));
  const runs: { first: number; last: number }[] = [];
  for (let index = 0; index < n; index++) {
    if (!present[index]) continue;
    const first = index;
    while (index + 1 < n && present[index + 1]) index++;
    runs.push({ first, last: index });
  }

  // The dashed editing path spans each present run plus its tapers — the tip
  // sections where the lane shrinks to nothing are part of the drawn lane.
  const roadStart = profile.find(point => point.endAnchor === 'start')?.distance ?? profile[0]?.distance ?? 0;
  const roadEnd = profile.find(point => point.endAnchor === 'end')?.distance ?? profile.at(-1)?.distance ?? roadStart;
  const paths = runs.map(({ first, last }) => {
    const lo = Math.max(roadStart, first > 0 ? profile[first - 1].distance : roadStart);
    const hi = Math.min(roadEnd, last < n - 1 ? profile[last + 1].distance : roadEnd);
    const distances = [
      lo,
      ...geometry.samples.map(sample => sample.distance).filter(distance => distance > lo && distance < hi),
      hi
    ];
    return profilePointsPath(distances.map(distance => posAtDistance(distance, centerOffsetOf(interpolateProfile(profile, distance)))));
  });

  const terminals = profileLaneTransitions(profile, dir)
    .filter(transition => transition.laneIndex === laneIndex)
    .map((transition, ordinal): LaneTerminalView => {
      const added = dir === 'out' ? transition.toPresent : transition.fromPresent;
      let tipIndex: number | null;
      let linkedIndex: number | null;
      let side: 'low' | 'high';
      let distance: number;
      let pos: Vec2;
      if (transition.boundaryIndex < 0) {
        side = 'low';
        tipIndex = null;
        linkedIndex = null;
        distance = profile[0].distance;
        const location = atProfileDistance(geometry, distance);
        pos = add(posAtDistance(distance, centerOffsetOf(profile[0])), scale(location.tangent, -16 * zoom));
      } else if (transition.boundaryIndex >= n - 1) {
        side = 'high';
        tipIndex = null;
        linkedIndex = null;
        distance = profile[n - 1].distance;
        const location = atProfileDistance(geometry, distance);
        pos = add(posAtDistance(distance, centerOffsetOf(profile[n - 1])), scale(location.tangent, 16 * zoom));
      } else {
        side = transition.fromPresent ? 'high' : 'low';
        tipIndex = transition.fromPresent ? transition.boundaryIndex + 1 : transition.boundaryIndex;
        linkedIndex = transition.fromPresent ? transition.boundaryIndex : transition.boundaryIndex + 1;
        distance = profile[tipIndex].distance;
        pos = posAtDistance(distance, centerOffsetOf(profile[tipIndex]));
      }
      const authored = arm.authoredProfile?.[dir][laneIndex];
      if (tipIndex !== null && authored) linkedIndex = laneAttachmentIndex(profile, authored, side, distance);
      const capDistance = side === 'high' ? profile[n - 1].distance : profile[0].distance;
      const capLocation = atProfileDistance(geometry, capDistance);
      const capPos = add(capLocation.p, scale(capLocation.normal, sign * centerOffsetOf(interpolateProfile(profile, capDistance))));
      const tipLocation = atProfileDistance(geometry, distance);
      const rawTip = Math.atan2(tipLocation.tangent.y, tipLocation.tangent.x) * 180 / Math.PI;
      const angle = rawTip > 90 ? rawTip - 180 : rawTip <= -90 ? rawTip + 180 : rawTip;
      return { ordinal, boundaryIndex: transition.boundaryIndex, tipIndex, linkedIndex, side, added, pos, angle, capPos };
    });

  // A lane that reaches a road-end cross-section gets a node pinned there —
  // it drags sideways like any other node but never along the road.
  const startCapIndex = Math.max(0, profile.findIndex(point => point.endAnchor === 'start'));
  const endCapIndex = profile.findIndex(point => point.endAnchor === 'end');
  const highCapIndex = endCapIndex < 0 ? n - 1 : endCapIndex;
  const nodes: LaneNodeView[] = runs.flatMap(({ first, last }) => {
    const endNode = (index: number): LaneNodeView => ({
      id: laneNodeId(arm, profile[index], dir, laneIndex),
      index,
      point: profile[index],
      pos: posAtDistance(profile[index].distance, centerOffsetOf(profile[index])),
      end: true
    });
    return [
      ...(first <= startCapIndex ? [endNode(startCapIndex)] : []),
      ...Array.from({ length: last - first + 1 }, (_, offset) => first + offset)
        .filter(index => arm.authoredProfile ? authoredLaneNodeVisible(profile, index, dir, laneIndex) : isProfileLaneNodeAffected(profile, index, dir, laneIndex))
        .map(index => ({
          id: laneNodeId(arm, profile[index], dir, laneIndex),
          index,
          point: profile[index],
          pos: posAtDistance(profile[index].distance, centerOffsetOf(profile[index]))
        })),
      ...(last >= highCapIndex ? [endNode(highCapIndex)] : [])
    ];
  });
  // Free taper tips are nodes too — the START/END marker is the tip's handle.
  // It owns an offset (a key pinned at the tip distance) but no width, and its
  // link to the attachment is what the terminal drag moves.
  for (const terminal of terminals) {
    if (!arm.authoredProfile || terminal.tipIndex === null || terminal.linkedIndex === null) continue;
    const attachNode = nodes.find(node => node.index === terminal.linkedIndex);
    if (!attachNode) continue;
    nodes.push({
      id: laneNodeId(arm, profile[terminal.tipIndex], dir, laneIndex),
      index: terminal.tipIndex,
      point: profile[terminal.tipIndex],
      pos: terminal.pos,
      tip: { ordinal: terminal.ordinal, boundaryIndex: terminal.boundaryIndex, side: terminal.side, attachId: attachNode.id }
    });
  }
  nodes.sort((a, b) => a.index - b.index);

  const segmentFor = (from: LaneNodeView, to: LaneNodeView, taper?: boolean): LaneSegmentView => {
    const distances = [
      Math.min(from.point.distance, to.point.distance),
      ...geometry.samples.map(sample => sample.distance).filter(distance => distance > Math.min(from.point.distance, to.point.distance) && distance < Math.max(from.point.distance, to.point.distance)),
      Math.max(from.point.distance, to.point.distance)
    ];
    const centers = distances.map(distance => posAtDistance(distance, centerOffsetOf(interpolateProfile(profile, distance))));
    const halfWidths = distances.map(distance => {
      const bounds = laneBounds(interpolateProfile(profile, distance), dir, laneIndex);
      return (bounds.outer - bounds.inner) / 2;
    });
    // Edges offset perpendicular to the lane's own direction — matching the
    // rendered strip — so a shifted lane keeps its width instead of shearing.
    const edges = miterOffsetEdges(centers, halfWidths, index => atProfileDistance(geometry, distances[index]).normal);
    const inner = sign > 0 ? edges.right : edges.left;
    const outer = sign > 0 ? edges.left : edges.right;
    const target: SelectionTarget = { kind: 'lane-segment', armId: arm.id, fromPointId: from.id, toPointId: to.id, dir, laneIndex };
    return {
      from,
      to,
      path: profilePointsPath(centers),
      regionPath: `${profilePointsPath([...inner, ...outer.reverse()])} Z`,
      target,
      taper
    };
  };
  const segments = nodes.slice(0, -1).flatMap((from, index) => {
    const to = nodes[index + 1];
    if (present.slice(Math.min(from.index, to.index), Math.max(from.index, to.index) + 1).some(value => !value)) return [];
    return [segmentFor(from, to)];
  });
  // The wedge between a taper's tip and its attachment is a segment like any
  // other — selecting it moves both endpoint nodes as one.
  for (const terminal of terminals) {
    if (terminal.tipIndex === null || terminal.linkedIndex === null) continue;
    const tipNode = nodes.find(node => node.tip?.ordinal === terminal.ordinal);
    const attachNode = nodes.find(node => node.index === terminal.linkedIndex);
    if (!tipNode || !attachNode) continue;
    segments.push(segmentFor(tipNode, attachNode, true));
  }

  return { dir, laneIndex, color: profileControlColor(laneIndex), paths, nodes, segments, terminals };
}

export const LaneProfileLayer: React.FC<Props> = React.memo(({ zoom, onSmartZoom }) => {
  const committedConfig = useEditorStore(state => state.committedConfig);
  const draftConfig = useEditorStore(state => state.draftConfig);
  const selection = useEditorStore(state => state.selection);
  const selections = useEditorStore(state => state.selections);
  const viewMode = useEditorStore(state => state.viewMode);
  const profileDrag = useEditorStore(state => state.drag?.type.startsWith('profile-') ? state.drag : null);
  const setSelection = useEditorStore(state => state.setSelection);
  const selectTarget = useEditorStore(state => state.selectTarget);
  const setSelections = useEditorStore(state => state.setSelections);
  const setCommittedConfig = useEditorStore(state => state.setCommittedConfig);
  const setDraftConfig = useEditorStore(state => state.setDraftConfig);
  const commitDraft = useEditorStore(state => state.commitDraft);
  const setDrag = useEditorStore(state => state.setDrag);
  const dragRef = React.useRef<DragState | null>(null);
  const rootRef = React.useRef<SVGGElement | null>(null);
  const [hoveredSegment, setHoveredSegment] = React.useState<string | null>(null);
  const [widthSnapMatches, setWidthSnapMatches] = React.useState<{ dir: Direction; laneIndex: number }[]>([]);
  const [gapSnapMatches, setGapSnapMatches] = React.useState<GapSnapMatch[]>([]);
  const config = draftConfig ?? committedConfig;
  const armId = selection && 'armId' in selection ? selection.armId : null;
  const arm = armId ? config.arms.find(candidate => candidate.id === armId) : null;
  const geometry = React.useMemo(() => arm ? profileGeometry(arm) : null, [arm]);
  const profile = React.useMemo(() => arm && geometry ? getRoadProfile(arm, geometry.totalLength) : [], [arm, geometry]);
  const focusedLane = selection?.kind === 'lane' ? { dir: selection.dir, laneIndex: selection.laneIndex }
    : selection?.kind === 'lane-node' ? { dir: selection.dir, laneIndex: selection.laneIndex }
    : selection?.kind === 'profile-control' || selection?.kind === 'lane-segment' ? { dir: selection.dir, laneIndex: selection.laneIndex }
    : null;
  const laneModels = React.useMemo(() => {
    if (!arm || !geometry || !profile.length) return [] as LaneModel[];
    const models: LaneModel[] = [];
    for (const dir of ['in', 'out'] as const) {
      const count = dir === 'in' ? arm.lanesIn.length : arm.lanesOut.length;
      for (let laneIndex = 0; laneIndex < count; laneIndex++) models.push(buildLaneModel(config, arm, geometry, profile, dir, laneIndex, zoom));
    }
    return models;
  }, [arm, config, geometry, profile, zoom]);
  const selectedNode = selection?.kind === 'lane-node' ? selection
    : selection?.kind === 'profile-control' ? { kind: 'lane-node' as const, armId: selection.armId, pointId: selection.pointId, dir: selection.dir, laneIndex: selection.laneIndex }
    : null;
  const selectedNodeView = (() => {
    if (!selectedNode) return null;
    const model = laneModels.find(model => model.dir === selectedNode.dir && model.laneIndex === selectedNode.laneIndex);
    const node = model?.nodes.find(node => node.id === selectedNode.pointId);
    return model && node ? { model, node } : null;
  })();
  React.useEffect(() => {
    setHoveredSegment(null);
    setWidthSnapMatches([]);
    setGapSnapMatches([]);
  }, [armId, focusedLane?.dir, focusedLane?.laneIndex]);

  const lastFocusKey = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (profileDrag || !geometry) return;
    const key = selection ? selectionKey(selection) : null;
    if (key === lastFocusKey.current) return;
    lastFocusKey.current = key;
    if (!selection) return;
    if (selection.kind === 'lane-node' && selectedNodeView) onSmartZoom([selectedNodeView.node.pos], 'focus');
  }, [profileDrag, geometry, laneModels, onSmartZoom, selectedNodeView, selection]);

  if (viewMode === 'rendered') return null;

  if (!arm || !geometry || !selection || !['arm', 'arm-node', 'lane', 'lane-node', 'lane-segment', 'profile-point', 'profile-control'].includes(selection.kind)) return null;

  // The "propper road" runs between the two ending cross-sections; nothing
  // outside it can host lane nodes.
  const roadStart = (profile.find(point => point.endAnchor === 'start') ?? profile[0])?.distance ?? 0;
  const roadEnd = (profile.find(point => point.endAnchor === 'end') ?? profile[profile.length - 1])?.distance ?? geometry.totalLength;

  const localPointer = (event: React.MouseEvent<SVGElement>) => {
    const svg = event.currentTarget.closest('svg');
    return svg ? screenToWorld(event, svg) : null;
  };

  const finishDrag = (event: React.PointerEvent<SVGElement>) => {
    const state = dragRef.current;
    if (!state) return;
    commitDraft();
    if (!state.moved && state.clickTarget) setSelection(state.clickTarget);
    dragRef.current = null;
    setWidthSnapMatches([]);
    setGapSnapMatches([]);
    setDrag(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    rootRef.current?.releasePointerCapture(event.pointerId);
  };

  const cancelDrag = (event: React.PointerEvent<SVGElement>) => {
    if (!dragRef.current) return;
    setDraftConfig(null);
    dragRef.current = null;
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
    const modifiers = dragModifiers(event);
    if (state.kind === 'terminal') {
      const distance = projectProfileDistance(geometry, pointer);
      if (!state.moved && state.clientStart && Math.hypot(event.clientX - state.clientStart.x, event.clientY - state.clientStart.y) > 4) state.moved = true;
      const threshold = modifiers.mod ? 0 : 10 * zoom;
      let next = moveProfileLaneTerminal(state.original, state.armId, state.dir, state.laneIndex, state.boundaryIndex, distance, threshold);
      const sourceArm = state.original.arms.find(candidate => candidate.id === state.armId);
      const sourceDoc = sourceArm?.authoredProfile;
      if (sourceArm && sourceDoc && state.spanId && state.side) {
        const sourceProfile = getRoadProfile(sourceArm, estimateArmLength(sourceArm));
        const before = sourceDoc[state.dir][state.laneIndex]?.spans.find(span => span.id === state.spanId)?.[state.side];
        const after = next.arms.find(candidate => candidate.id === state.armId)?.authoredProfile?.[state.dir][state.laneIndex]?.spans.find(span => span.id === state.spanId)?.[state.side];
        // The carried attachment keeps its vertical group — every sibling lane
        // node stacked at the old tip/attach stations moves along with them.
        if (before?.kind === 'free' && after?.kind === 'free') {
          for (const [fromDistance, toDistance] of [[before.tip, after.tip], [before.attach, after.attach]] as const) {
            const delta = toDistance - fromDistance;
            if (Math.abs(delta) < 1e-6) continue;
            const laneCount = (state.dir === 'in' ? sourceArm.lanesIn : sourceArm.lanesOut).length;
            for (let laneIndex = 0; laneIndex < laneCount; laneIndex++) {
              if (laneIndex === state.laneIndex) continue;
              const member = lanePrimitiveId(sourceArm, state.dir, laneIndex, fromDistance);
              if (member) next = moveProfileLanePoint(next, state.armId, member, state.dir, laneIndex, fromDistance + delta);
            }
          }
        }
        // Sideways shifts the tip's offset — and, linked like the along-road
        // drag, the attachment's offset rides the same delta.
        if (state.tipPointId && state.startPointer) {
          const tipPoint = findLanePoint(sourceArm, sourceProfile, state.dir, state.laneIndex, state.tipPointId);
          const tipLane = tipPoint && lanesOf(tipPoint, state.dir)[state.laneIndex];
          if (tipPoint && tipLane) {
            const location = atProfileDistance(geometry, tipPoint.distance);
            const sideNormal = scale(location.normal, profileDirectionSign(state.original, state.dir));
            let deltaOffset = dot(sub(pointer, state.startPointer), sideNormal);
            if (!modifiers.mod) {
              const originalOffset = profileLaneTotalOffset(tipPoint, state.dir, state.laneIndex);
              const snapped = snapProfileLaneGap(sourceProfile, tipPoint.id, state.dir, state.laneIndex, originalOffset + deltaOffset);
              if (snapped.matches.length) deltaOffset = snapped.totalOffset - originalOffset;
              setGapSnapMatches(snapped.matches);
            }
            for (const pointId of [state.tipPointId, state.attachPointId]) {
              if (!pointId) continue;
              const linkPoint = findLanePoint(sourceArm, sourceProfile, state.dir, state.laneIndex, pointId);
              const linkLane = linkPoint && lanesOf(linkPoint, state.dir)[state.laneIndex];
              if (linkPoint && linkLane) next = setProfileControl(next, state.armId, pointId, state.dir, 'gap', Math.max(0, linkLane.gap + deltaOffset), state.laneIndex, true);
            }
          }
        }
      }
      setDraftConfig(next);
      return;
    }
    if (!state.moved && Math.hypot(event.clientX - state.clientStart.x, event.clientY - state.clientStart.y) > 4) state.moved = true;
    if (state.kind === 'node') {
      const distance = projectProfileDistance(geometry, pointer);
      const deltaDistance = distance - state.startDistance;
      const deltaWorld = sub(pointer, state.startPointer);
      if (modifiers.alt && !state.duplicated && state.moved) {
        const activeTarget: LaneNodeTarget = { kind: 'lane-node', armId: state.armId, pointId: state.pointId, dir: state.dir, laneIndex: state.laneIndex };
        const duplicated = duplicateSelectionOwners(state.original, useEditorStore.getState().selections);
        const mapped = duplicated.targetMap.get(selectionKey(activeTarget));
        if (mapped?.kind === 'lane-node') {
          state.armId = mapped.armId;
          state.pointId = mapped.pointId;
          state.original = duplicated.config;
          state.duplicated = true;
          setSelections(duplicated.selections, mapped);
        }
      }
      if (state.moved) {
        const originalTargets = state.segmentPointIds
          ? state.segmentPointIds.map(pointId => ({ kind: 'lane-node' as const, armId: state.armId, pointId, dir: state.dir, laneIndex: state.laneIndex }))
          : useEditorStore.getState().selections.filter((target): target is LaneNodeTarget => target.kind === 'lane-node');
        const mapped = originalTargets.map(target => {
          const sourceArm = state.original.arms.find(candidate => candidate.id === target.armId);
          const shape = sourceArm?.authoredProfile?.[target.dir][target.laneIndex];
          const point = sourceArm && findLanePoint(sourceArm, getRoadProfile(sourceArm, estimateArmLength(sourceArm)), target.dir, target.laneIndex, target.pointId);
          if (!shape || !point) return target;
          // The lane owns this node when a key or a free terminal sits at its
          // station — matching by distance, since a borrowed point id can name
          // a key at a different station (or another lane's primitive).
          const ownsPrimitive = shape.keys.some(key => Math.abs(key.distance - point.distance) < 1e-6)
            || shape.spans.some(span => (['low', 'high'] as const).some(side => {
              const terminal = span[side];
              return terminal.kind === 'free'
                && (Math.abs(terminal.attach - point.distance) < 1e-6 || Math.abs(terminal.tip - point.distance) < 1e-6);
            }));
          if (ownsPrimitive) return target;
          const added = addProfilePoint(state.original, target.armId, point.distance, target.dir, target.laneIndex);
          if (!added.pointId) return target;
          state.original = added.config;
          if (target.armId === state.armId && target.pointId === state.pointId && target.dir === state.dir && target.laneIndex === state.laneIndex) state.pointId = added.pointId;
          return { ...target, pointId: added.pointId };
        });
        if (mapped.some((target, index) => !sameSelectionTarget(target, originalTargets[index]))) {
          const primary = mapped.find(target => target.armId === state.armId && target.pointId === state.pointId && target.dir === state.dir && target.laneIndex === state.laneIndex);
          setSelections(mapped, primary ?? mapped[0]);
        }
      }
      const activeTarget: LaneNodeTarget = { kind: 'lane-node', armId: state.armId, pointId: state.pointId, dir: state.dir, laneIndex: state.laneIndex };
      const selectedTargets = state.segmentPointIds
        ? state.segmentPointIds.map(pointId => ({ kind: 'lane-node' as const, armId: state.armId, pointId, dir: state.dir, laneIndex: state.laneIndex }))
        : useEditorStore.getState().selections.filter((target): target is LaneNodeTarget => target.kind === 'lane-node');
      const targets = selectedTargets.some(target => sameSelectionTarget(target, activeTarget)) ? selectedTargets : [activeTarget];
      // Lane-owned nodes move independently even when several lanes happen to
      // have keys at the same distance. Anchored cap sections stay computed.
      const seenPoints = new Set<string>();
      const pointTargets: { armId: string; pointId: string; dir: Direction; laneIndex: number }[] = [];
      const sourceProfiles = new Map<string, RoadProfilePoint[]>();
      const sourceProfile = (armIdKey: string) => {
        let cached = sourceProfiles.get(armIdKey);
        if (!cached) {
          const sourceArm = state.original.arms.find(candidate => candidate.id === armIdKey);
          cached = sourceArm ? getRoadProfile(sourceArm, estimateArmLength(sourceArm)) : [];
          sourceProfiles.set(armIdKey, cached);
        }
        return cached;
      };
      for (const target of targets) {
        const key = `${target.armId}:${target.pointId}:${target.dir}:${target.laneIndex}`;
        if (seenPoints.has(key)) continue;
        seenPoints.add(key);
        const sourceArm = state.original.arms.find(candidate => candidate.id === target.armId);
        const point = sourceArm && findLanePoint(sourceArm, sourceProfile(target.armId), target.dir, target.laneIndex, target.pointId);
        // Road-end nodes are pinned to their cross-section — only the
        // sideways component of a drag applies to them.
        const pinned = laneModels.some(model => model.dir === target.dir && model.laneIndex === target.laneIndex && model.nodes.some(node => node.end && node.id === target.pointId));
        if (point && !point.endAnchor && !pinned) pointTargets.push({ armId: target.armId, pointId: target.pointId, dir: target.dir, laneIndex: target.laneIndex });
      }
      // Nodes stacked at the same station on sibling lanes of the same
      // direction are linked along the road: dragging any member moves the
      // whole group — a taper attachment drags the nodes its width bends. A
      // dragged tip also carries its attachment, so the group expands over
      // the attachment's station as well — iterating the live array lets a
      // carried tip expand its own attachment's siblings in turn.
      for (const target of pointTargets) {
        const sourceArm = state.original.arms.find(candidate => candidate.id === target.armId);
        const profile = sourceProfile(target.armId);
        const point = sourceArm?.authoredProfile && findLanePoint(sourceArm, profile, target.dir, target.laneIndex, target.pointId);
        if (!sourceArm?.authoredProfile || !point) continue;
        const distances = [point.distance];
        const attachId = laneTipAttachmentId(sourceArm, profile, target.dir, target.laneIndex, point.distance);
        const attachPoint = attachId && findLanePoint(sourceArm, profile, target.dir, target.laneIndex, attachId);
        if (attachPoint) distances.push(attachPoint.distance);
        const laneCount = (target.dir === 'in' ? sourceArm.lanesIn : sourceArm.lanesOut).length;
        for (const distance of distances) for (let laneIndex = 0; laneIndex < laneCount; laneIndex++) {
          if (laneIndex === target.laneIndex) continue;
          const member = lanePrimitiveId(sourceArm, target.dir, laneIndex, distance);
          if (!member) continue;
          const key = `${target.armId}:${member}:${target.dir}:${laneIndex}`;
          if (seenPoints.has(key)) continue;
          seenPoints.add(key);
          pointTargets.push({ armId: target.armId, pointId: member, dir: target.dir, laneIndex });
        }
      }
      // Anchor the rendered nodes flanking each dragged node — a visible node
      // that isn't an authored key rides the key interpolation and would slide
      // with this edit, so the drag would move more than just its node.
      const moving = new Set(pointTargets.map(target => `${target.armId}:${target.dir}:${target.laneIndex}:${target.pointId}`));
      const anchors: { armId: string; dir: Direction; laneIndex: number; pointId: string; distance: number }[] = [];
      if (state.moved) for (const target of pointTargets) {
        const model = laneModels.find(candidate => candidate.dir === target.dir && candidate.laneIndex === target.laneIndex);
        const nodeIndex = model?.nodes.findIndex(node => node.id === target.pointId) ?? -1;
        if (!model || nodeIndex < 0) continue;
        for (const neighbor of [model.nodes[nodeIndex - 1], model.nodes[nodeIndex + 1]]) {
          if (!neighbor || moving.has(`${target.armId}:${target.dir}:${target.laneIndex}:${neighbor.id}`)) continue;
          if (anchors.some(anchor => anchor.armId === target.armId && anchor.dir === target.dir && anchor.laneIndex === target.laneIndex && anchor.pointId === neighbor.id)) continue;
          anchors.push({ armId: target.armId, dir: target.dir, laneIndex: target.laneIndex, pointId: neighbor.id, distance: neighbor.point.distance });
        }
      }
      let next = anchors.length ? pinProfileLaneNodes(state.original, anchors) : state.original;
      if (pointTargets.length) next = moveProfileLanePoints(next, pointTargets, deltaDistance);
      // The sideways component shifts each node's lane relative to the road.
      // Node edits stay local to the dragged node(s) — relocating a whole
      // stretch of lane is the lane-segment gesture's job.
      const sidewaysIds = new Set(targets.map(target => `${target.armId}:${target.pointId}:${target.dir}:${target.laneIndex}`));
      let snapCleared = false;
      for (const target of targets) {
        const sourceArm = state.original.arms.find(candidate => candidate.id === target.armId);
        const sourcePoint = sourceArm && findLanePoint(sourceArm, sourceProfile(target.armId), target.dir, target.laneIndex, target.pointId);
        const sourceLane = sourcePoint && lanesOf(sourcePoint, target.dir)[target.laneIndex];
        if (!sourceArm || !sourcePoint || !sourceLane) continue;
        const targetGeometry = target.armId === arm.id ? geometry : profileGeometry(sourceArm);
        const location = atProfileDistance(targetGeometry, sourcePoint.distance);
        const sideNormal = scale(location.normal, profileDirectionSign(state.original, target.dir));
        const deltaOffset = dot(deltaWorld, sideNormal);
        let value = sourceLane.gap + deltaOffset;
        if (targets.length === 1 && !modifiers.mod) {
          const originalOffset = profileLaneTotalOffset(sourcePoint, target.dir, target.laneIndex);
          const snapped = snapProfileLaneGap(sourceProfile(target.armId), sourcePoint.id, target.dir, target.laneIndex, originalOffset + deltaOffset);
          if (snapped.matches.length) value = sourceLane.gap + (snapped.totalOffset - originalOffset);
          setGapSnapMatches(snapped.matches);
          snapCleared = true;
        }
        next = setProfileControl(next, target.armId, target.pointId, target.dir, 'gap', Math.max(0, value), target.laneIndex, true);
        // A taper tip drags its attachment's offset by the same delta — the
        // sideways half of the tip↔attach link — while the attachment itself
        // stays free to be offset independently. An attachment that is itself
        // a drag target takes its own delta instead of being shifted twice.
        const attachId = laneTipAttachmentId(sourceArm, sourceProfile(target.armId), target.dir, target.laneIndex, sourcePoint.distance);
        if (attachId && !sidewaysIds.has(`${target.armId}:${attachId}:${target.dir}:${target.laneIndex}`)) {
          const attachPoint = findLanePoint(sourceArm, sourceProfile(target.armId), target.dir, target.laneIndex, attachId);
          const attachLane = attachPoint && lanesOf(attachPoint, target.dir)[target.laneIndex];
          if (attachLane) next = setProfileControl(next, target.armId, attachId, target.dir, 'gap', Math.max(0, attachLane.gap + value - sourceLane.gap), target.laneIndex, true);
        }
      }
      if (!snapCleared && gapSnapMatches.length) setGapSnapMatches([]);
      setDraftConfig(next);
      return;
    }
    const offset = dot(sub(pointer, state.base), state.normal) * state.sign;
    if (modifiers.alt && !state.duplicated && len(sub(pointer, state.base)) > .75) {
      const activeTarget = { kind: 'profile-control' as const, armId: state.armId, pointId: state.pointId, dir: state.dir, control: state.control, laneIndex: state.laneIndex };
      const duplicated = duplicateSelectionOwners(state.original, useEditorStore.getState().selections);
      const mapped = duplicated.targetMap.get(selectionKey(activeTarget));
      if (mapped?.kind === 'profile-control') {
        state.armId = mapped.armId;
        state.pointId = mapped.pointId;
        state.original = duplicated.config;
        state.duplicated = true;
        setSelections(duplicated.selections, mapped);
      }
    }
    const sourceArm = state.original.arms.find(candidate => candidate.id === state.armId);
    if (!sourceArm) return;
    const sourcePoint = findLanePoint(sourceArm, getRoadProfile(sourceArm, estimateArmLength(sourceArm)), state.dir, state.laneIndex, state.pointId);
    if (!sourcePoint) return;
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
      const snapped = modifiers.mod ? { totalOffset: currentOffset, matches: [] } : snapProfileLaneGap(sourceProfile, sourcePoint.id, state.dir, state.laneIndex, currentOffset);
      if (snapped.matches.length) value = (originalLane?.gap ?? 0) + (snapped.totalOffset - originalOffset);
      setGapSnapMatches(snapped.matches);
      setWidthSnapMatches([]);
    }
    const activeTarget = { kind: 'profile-control' as const, armId: state.armId, pointId: state.pointId, dir: state.dir, control: state.control, laneIndex: state.laneIndex };
    const selectedTargets = useEditorStore.getState().selections.filter((target): target is typeof activeTarget => target.kind === 'profile-control' && target.control === state.control);
    const targets = selectedTargets.some(target => target.armId === state.armId && target.pointId === state.pointId && target.dir === state.dir && target.laneIndex === state.laneIndex) ? selectedTargets : [activeTarget];
    // A taper tip's shift control carries its attachment's offset with it.
    if (state.linkedPointId && !targets.some(target => target.pointId === state.linkedPointId && target.armId === state.armId)) {
      targets.push({ ...activeTarget, pointId: state.linkedPointId });
    }
    setDraftConfig(adjustProfileControls(state.original, targets, value - sourcePoint[state.dir === 'in' ? 'lanesIn' : 'lanesOut'][state.laneIndex][state.control], modifiers.shift));
  };

  const startNodeDrag = (event: React.PointerEvent<SVGElement>, model: LaneModel, node: LaneNodeView) => {
    event.preventDefault();
    event.stopPropagation();
    const target: LaneNodeTarget = { kind: 'lane-node', armId: arm.id, pointId: node.id, dir: model.dir, laneIndex: model.laneIndex };
    const alreadySelected = selections.some(candidate => sameSelectionTarget(candidate, target));
    if (!alreadySelected || event.shiftKey) selectTarget(target, event.shiftKey);
    const pointer = localPointer(event);
    dragRef.current = {
      kind: 'node', armId: arm.id, pointId: node.id, dir: model.dir, laneIndex: model.laneIndex,
      startPointer: pointer ?? node.pos, startDistance: node.point.distance, clientStart: { x: event.clientX, y: event.clientY },
      moved: false, clickTarget: event.shiftKey ? undefined : target, original: structuredClone(committedConfig)
    };
    setDrag({ active: true, type: 'profile-node' });
    rootRef.current?.setPointerCapture(event.pointerId);
  };

  const startSegmentDrag = (event: React.PointerEvent<SVGElement>, model: LaneModel, segment: LaneSegmentView) => {
    event.preventDefault();
    event.stopPropagation();
    setSelections([segment.target], segment.target);
    const pointer = localPointer(event);
    setHoveredSegment(null);
    // A taper segment's endpoints ride one primitive: moving the tip carries
    // the attachment (and its offset), so the tip alone is the drag target.
    const driver = segment.taper ? (segment.from.tip ? segment.from : segment.to) : segment.from;
    dragRef.current = {
      kind: 'node', armId: arm.id, pointId: driver.id, segmentPointIds: segment.taper ? [driver.id] : [segment.from.id, segment.to.id], dir: model.dir, laneIndex: model.laneIndex,
      startPointer: pointer ?? driver.pos, startDistance: pointer ? projectProfileDistance(geometry, pointer) : driver.point.distance, clientStart: { x: event.clientX, y: event.clientY },
      moved: false, original: structuredClone(committedConfig)
    };
    setDrag({ active: true, type: 'profile-node' });
    rootRef.current?.setPointerCapture(event.pointerId);
  };

  const startControlDrag = (event: React.PointerEvent<SVGElement>, point: RoadProfilePoint, dir: Direction, control: 'gap' | 'width', laneIndex: number, linkedPointId?: string) => {
    event.preventDefault();
    event.stopPropagation();
    selectTarget({ kind: 'profile-control', armId: arm.id, pointId: point.id, dir, control, laneIndex }, event.shiftKey);
    const location = atProfileDistance(geometry, point.distance);
    dragRef.current = {
      kind: 'control', armId: arm.id, pointId: point.id, dir, control, laneIndex,
      base: location.p, normal: location.normal, sign: profileDirectionSign(committedConfig, dir), clientStart: { x: event.clientX, y: event.clientY },
      moved: false, clickTarget: event.shiftKey ? undefined : { kind: 'profile-control', armId: arm.id, pointId: point.id, dir, control, laneIndex }, linkedPointId, original: structuredClone(committedConfig)
    };
    setDrag({ active: true, type: `profile-${control}` });
    rootRef.current?.setPointerCapture(event.pointerId);
  };

  const startTerminalDrag = (event: React.PointerEvent<SVGElement>, model: LaneModel, terminal: LaneTerminalView) => {
    event.preventDefault();
    event.stopPropagation();
    // The marker keeps its identity while it hops boundaries — track its
    // ordinal among the lane's transitions rather than the boundary index.
    const boundaries = model.terminals.map(terminal => terminal.boundaryIndex);
    const isOuter = terminal.side === 'high'
      ? terminal.boundaryIndex === Math.max(...boundaries)
      : terminal.boundaryIndex === Math.min(...boundaries);
    if (isOuter) onSmartZoom([terminal.pos, terminal.capPos], 'fit');
    const pointer = localPointer(event);
    // A free tip is the start/end node: it selects like one, shifts sideways
    // like one, and keeps the attachment linked to it in both directions.
    const tipPoint = terminal.tipIndex !== null ? profile[terminal.tipIndex] : null;
    const tipPointId = tipPoint ? laneNodeId(arm, tipPoint, model.dir, model.laneIndex) : undefined;
    const attachPointId = terminal.linkedIndex !== null ? model.nodes.find(node => node.index === terminal.linkedIndex)?.id : undefined;
    const spanId = (() => {
      if (!tipPoint) return undefined;
      const shape = committedConfig.arms.find(candidate => candidate.id === arm.id)?.authoredProfile?.[model.dir][model.laneIndex];
      return shape?.spans.find(span => {
        const candidate = span[terminal.side];
        return candidate.kind === 'free' && Math.abs(candidate.tip - tipPoint.distance) < 1e-6;
      })?.id;
    })();
    const clickTarget: LaneNodeTarget | undefined = tipPointId ? { kind: 'lane-node', armId: arm.id, pointId: tipPointId, dir: model.dir, laneIndex: model.laneIndex } : undefined;
    if (clickTarget) {
      const alreadySelected = selections.some(candidate => sameSelectionTarget(candidate, clickTarget));
      if (!alreadySelected || event.shiftKey) selectTarget(clickTarget, event.shiftKey);
    }
    dragRef.current = {
      kind: 'terminal', armId: arm.id, dir: model.dir, laneIndex: model.laneIndex, boundaryIndex: terminal.boundaryIndex, ordinal: terminal.ordinal,
      spanId, side: terminal.side, tipPointId, attachPointId,
      startPointer: pointer ?? terminal.pos, clientStart: { x: event.clientX, y: event.clientY }, moved: false,
      clickTarget: event.shiftKey ? undefined : clickTarget, original: structuredClone(committedConfig)
    };
    setDrag({ active: true, type: 'profile-lane-terminal' });
    rootRef.current?.setPointerCapture(event.pointerId);
  };

  const addLaneNode = (event: React.MouseEvent<SVGElement>, model: LaneModel) => {
    event.preventDefault();
    event.stopPropagation();
    const pointer = localPointer(event);
    if (!pointer) return;
    const added = addProfilePoint(committedConfig, arm.id, projectProfileDistance(geometry, pointer), model.dir, model.laneIndex);
    if (!added.pointId) return;
    setCommittedConfig(added.config);
    setSelection({ kind: 'lane-node', armId: arm.id, pointId: added.pointId, dir: model.dir, laneIndex: model.laneIndex });
  };

  const isModelFocused = (model: LaneModel) => Boolean(focusedLane && focusedLane.dir === model.dir && focusedLane.laneIndex === model.laneIndex);

  return (
    <g ref={rootRef} onPointerMove={moveDrag} onPointerUp={finishDrag} onPointerCancel={cancelDrag}>
      <g key={arm.id} className="focus-fade-in">
      {laneModels.map(model => {
        const focused = isModelFocused(model);
        return model.paths.map((d, index) => (
          <path
            key={`path-${model.dir}-${model.laneIndex}-${index}`}
            d={d}
            fill="none"
            stroke={model.color}
            strokeWidth={2 * zoom}
            strokeDasharray={`${5 * zoom} ${3.5 * zoom}`}
            strokeLinecap="butt"
            opacity={focusedLane ? (focused ? 0.9 : 0.28) : 0.72}
            pointerEvents="none"
          />
        ));
      })}
      {laneModels.map(model => model.paths.map((d, index) => (
        <path
          key={`hit-${model.dir}-${model.laneIndex}-${index}`}
          d={d}
          fill="none"
          stroke="transparent"
          strokeWidth={16}
          vectorEffect="non-scaling-stroke"
          pointerEvents="stroke"
          cursor="pointer"
          data-target={JSON.stringify({ kind: 'lane', armId: arm.id, dir: model.dir, laneIndex: model.laneIndex })}
          data-tooltip={isModelFocused(model) ? 'Double-click to add a lane node.' : `Select ${model.dir === 'in' ? 'entry' : 'exit'} lane ${model.laneIndex + 1}.`}
        />
      )))}
      {laneModels.map(model => {
        if (!isModelFocused(model)) return null;
        return model.segments.map(segment => {
          const key = `${model.dir}-${model.laneIndex}-${segment.from.id}-${segment.to.id}`;
          const hovered = hoveredSegment === key;
          const selected = selections.some(candidate => sameSelectionTarget(candidate, segment.target));
          return (
            <g key={`segment-${key}`}>
              {(hovered || selected) && <path d={segment.regionPath} fill="#fff" opacity={selected ? (hovered ? .36 : .28) : .18} pointerEvents="none" />}
              {(hovered || selected) && <path d={segment.path} fill="none" stroke={selected ? '#fff' : model.color} strokeWidth={(selected ? 4 : 6) * zoom} strokeLinecap="round" opacity={selected ? .7 : .35} pointerEvents="none" />}
              <path d={segment.regionPath} fill="transparent" pointerEvents="all" cursor="grab" data-handle="true" data-target={JSON.stringify(segment.target)} data-tooltip="Lane segment — click to select; drag to move both endpoint nodes; double-click to add a node." onPointerEnter={() => setHoveredSegment(key)} onPointerLeave={() => setHoveredSegment(null)} onPointerDown={event => startSegmentDrag(event, model, segment)} onDoubleClick={event => addLaneNode(event, model)} />
            </g>
          );
        });
      })}
      {laneModels.map(model => {
        if (!isModelFocused(model)) return null;
        return model.terminals.map(terminal => {
          const state = dragRef.current;
          const dragging = state?.kind === 'terminal' && state.dir === model.dir && state.laneIndex === model.laneIndex && state.ordinal === terminal.ordinal;
          const snapped = terminal.tipIndex === null;
          const linked = terminal.linkedIndex !== null ? model.nodes.find(node => node.index === terminal.linkedIndex) : null;
          const boundaries = model.terminals.map(candidate => candidate.boundaryIndex);
          const isOuter = terminal.side === 'high' ? terminal.boundaryIndex === Math.max(...boundaries) : terminal.boundaryIndex === Math.min(...boundaries);
          const tipTarget: LaneNodeTarget | null = terminal.tipIndex !== null
            ? { kind: 'lane-node', armId: arm.id, pointId: laneNodeId(arm, profile[terminal.tipIndex], model.dir, model.laneIndex), dir: model.dir, laneIndex: model.laneIndex }
            : null;
          const selected = tipTarget ? selections.some(candidate => sameSelectionTarget(candidate, tipTarget)) : false;
          return (
            <g key={`terminal-${model.dir}-${model.laneIndex}-${terminal.ordinal}`}>
              {linked && <line x1={terminal.pos.x} y1={terminal.pos.y} x2={linked.pos.x} y2={linked.pos.y} stroke="#fff" strokeWidth={5 * zoom} opacity={0.9} pointerEvents="none" />}
              {linked && <line x1={terminal.pos.x} y1={terminal.pos.y} x2={linked.pos.x} y2={linked.pos.y} stroke={model.color} strokeWidth={2.25 * zoom} strokeLinecap="round" pointerEvents="none" />}
              {linked && <circle cx={linked.pos.x} cy={linked.pos.y} r={7 * zoom} fill="#fff" stroke={model.color} strokeWidth={2.25 * zoom} pointerEvents="none" />}
              {linked && dragging && <circle cx={linked.pos.x} cy={linked.pos.y} r={9 * zoom} fill="none" stroke={model.color} strokeWidth={2 * zoom} opacity={0.8} pointerEvents="none" />}
              {dragging && isOuter && <circle cx={terminal.capPos.x} cy={terminal.capPos.y} r={(snapped ? 9 : 7) * zoom} fill={snapped ? '#dcfce7' : '#fff'} stroke="#22c55e" strokeWidth={(snapped ? 3 : 2) * zoom} strokeDasharray={snapped ? undefined : `${4 * zoom} ${3 * zoom}`} opacity={snapped ? 1 : 0.6} pointerEvents="none" />}
              <g transform={`translate(${terminal.pos.x} ${terminal.pos.y}) rotate(${terminal.angle})`} cursor="grab" onPointerDown={event => startTerminalDrag(event, model, terminal)}>
                <ProfileTransitionMarker
                  added={terminal.added}
                  tooltip={terminal.tipIndex !== null ? `${terminal.added ? 'Lane start' : 'Lane end'} — drag along the road to move it with its taper, sideways to shift both.` : `${terminal.added ? 'Lane start' : 'Lane end'} — drag along the road.`}
                  keyHints={dataKeys(HINT.noSnap)}
                  scale={zoom}
                  color={model.color}
                  snapped={dragging && snapped}
                  selected={selected}
                />
              </g>
            </g>
          );
        });
      })}
      {laneModels.map(model => {
        if (!isModelFocused(model)) return null;
        return model.nodes.map(node => {
          if (node.tip) return null; // the START/END marker is the tip's handle
          const target: LaneNodeTarget = { kind: 'lane-node', armId: arm.id, pointId: node.id, dir: model.dir, laneIndex: model.laneIndex };
          const isSelected = selections.some(candidate => sameSelectionTarget(candidate, target))
            || selections.some(candidate => candidate.kind === 'profile-point' && candidate.armId === arm.id && candidate.pointId === node.id)
            || selections.some(candidate => candidate.kind === 'profile-control' && candidate.armId === arm.id && candidate.pointId === node.id && candidate.dir === model.dir && candidate.laneIndex === model.laneIndex);
          const isTerminalAttachment = model.terminals.some(terminal => terminal.linkedIndex === node.index);
          return (
            <g key={`node-${model.dir}-${model.laneIndex}-${node.id}`}>
              <circle cx={node.pos.x} cy={node.pos.y} r={10 * zoom} fill="transparent" cursor="grab" data-handle="true" data-tooltip={node.end ? 'Lane end — locked to the end of the road; drag sideways to shift the lane.' : isTerminalAttachment ? 'Taper attachment — drag along the road to adjust the fall-off length, sideways to shift the lane.' : 'Lane node — drag along the road to move it, sideways to shift the lane.'} data-keys={dataKeys(HINT.multiSelect, HINT.duplicate, HINT.noSnap)} onPointerDown={event => startNodeDrag(event, model, node)} />
              <circle cx={node.pos.x} cy={node.pos.y} r={(isSelected ? 6 : isTerminalAttachment ? 5.5 : 4.5) * zoom} fill={isSelected ? '#2563eb' : isTerminalAttachment ? model.color : '#fff'} stroke={isSelected ? '#2563eb' : model.color} strokeWidth={2 * zoom} pointerEvents="none" />
              {isTerminalAttachment && <circle cx={node.pos.x} cy={node.pos.y} r={8 * zoom} fill="none" stroke={model.color} strokeWidth={1.25 * zoom} opacity={0.7} pointerEvents="none" />}
            </g>
          );
        });
      })}
      {profileDrag && (() => {
        const state = dragRef.current;
        // Nodes stacked at one station across sibling lanes are linked along
        // the road — draw the connection to each member while a drag moves it.
        const sources: { model: LaneModel; node: LaneNodeView }[] = [];
        if (state?.kind === 'node') {
          const targets = state.segmentPointIds
            ? state.segmentPointIds.map(pointId => ({ armId: state.armId, pointId, dir: state.dir, laneIndex: state.laneIndex }))
            : useEditorStore.getState().selections.filter((target): target is LaneNodeTarget => target.kind === 'lane-node');
          for (const target of targets) {
            const model = laneModels.find(candidate => candidate.dir === target.dir && candidate.laneIndex === target.laneIndex);
            const node = model?.nodes.find(candidate => candidate.id === target.pointId);
            if (model && node && !sources.some(source => source.node === node)) sources.push({ model, node });
          }
        } else if (state?.kind === 'terminal') {
          const model = laneModels.find(candidate => candidate.dir === state.dir && candidate.laneIndex === state.laneIndex);
          for (const pointId of [state.tipPointId, state.attachPointId]) {
            const node = model?.nodes.find(candidate => candidate.id === pointId);
            if (model && node) sources.push({ model, node });
          }
        }
        return sources.flatMap(({ model: sourceModel, node }) =>
          laneModels.flatMap(model => {
            if (model.dir !== sourceModel.dir || model.laneIndex === sourceModel.laneIndex) return [];
            return model.nodes
              .filter(linkedNode => Math.abs(linkedNode.point.distance - node.point.distance) < 1e-6)
              .flatMap(linkedNode => [
                <line key={`shared-line-${sourceModel.dir}-${sourceModel.laneIndex}-${model.laneIndex}-${node.id}`} x1={node.pos.x} y1={node.pos.y} x2={linkedNode.pos.x} y2={linkedNode.pos.y} stroke={model.color} strokeWidth={1.5 * zoom} strokeDasharray={`${2.5 * zoom} ${2.5 * zoom}`} opacity={0.65} pointerEvents="none" />,
                <circle key={`shared-node-${sourceModel.dir}-${sourceModel.laneIndex}-${model.laneIndex}-${node.id}`} cx={linkedNode.pos.x} cy={linkedNode.pos.y} r={4 * zoom} fill={model.color} stroke="#fff" strokeWidth={1.5 * zoom} opacity={0.9} pointerEvents="none" />
              ]);
          }));
      })()}
      {widthSnapMatches.length > 0 && selectedNodeView && (() => {
        const location = atProfileDistance(geometry, selectedNodeView.node.point.distance);
        return widthSnapMatches.map(({ dir, laneIndex }) => {
          const matchSign = profileDirectionSign(config, dir);
          const matchSideNormal = scale(location.normal, matchSign);
          const matchBounds = laneBounds(selectedNodeView.node.point, dir, laneIndex);
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
      {!profileDrag && selectedNodeView && (() => {
        const { model, node } = selectedNodeView;
        const point = node.point;
        const location = atProfileDistance(geometry, point.distance);
        const sign = profileDirectionSign(config, model.dir);
        const travel = scale(location.tangent, model.dir === 'out' ? 1 : -1);
        const sideNormal = scale(location.normal, sign);
        const lane = lanesOf(point, model.dir)[model.laneIndex];
        // A taper tip is a node with an offset but no width — only the shift
        // control applies to it.
        const isTip = Boolean(node.tip);
        if (!lane || (!isTip && !isProfileLanePresent(lane))) return null;
        const bounds = laneBounds(point, model.dir, model.laneIndex);
        const widthCenter = add(location.p, scale(sideNormal, bounds.outer));
        const shiftCenter = add(node.pos, scale(travel, 18 * zoom));
        return [
          <g key="shift" cursor="grab" onPointerDown={event => startControlDrag(event, point, model.dir, 'gap', model.laneIndex, node.tip?.attachId)}>
            <circle cx={shiftCenter.x} cy={shiftCenter.y} r={9 * zoom} fill="transparent" data-handle="true" data-tooltip={isTip ? 'Shift lane — its taper attachment follows.' : 'Shift lane.'} data-keys={dataKeys(HINT.multiSelect, HINT.isolateSection, HINT.duplicate, HINT.noSnap)} />
            <ProfileControlIcon kind="gap" color={model.color} transform={profilePointerTransform(shiftCenter, travel, sideNormal, zoom, 4, 4)} />
          </g>,
          ...(isTip ? [] : [
            <g key="width" cursor="grab" onPointerDown={event => startControlDrag(event, point, model.dir, 'width', model.laneIndex)}>
              <circle cx={widthCenter.x} cy={widthCenter.y} r={9 * zoom} fill="transparent" data-handle="true" data-tooltip="Adjust width." data-keys={dataKeys(HINT.multiSelect, HINT.isolateSection, HINT.duplicate, HINT.noSnap)} />
              <ProfileControlIcon kind="width" color={model.color} transform={profilePointerTransform(widthCenter, travel, sideNormal, zoom, 4, 0, true)} />
            </g>
          ])
        ];
      })()}
      {profile.length > 0 && roadEnd > roadStart && (() => {
        const midDistance = (roadStart + roadEnd) / 2;
        const location = atProfileDistance(geometry, midDistance);
        const section = interpolateProfile(profile, midDistance);
        const angle = Math.atan2(location.tangent.y, location.tangent.x) * 180 / Math.PI;
        const upright = ((angle % 360) + 360) % 360;
        const labelAngle = upright > 90 && upright <= 270 ? upright - 180 : upright > 270 ? upright - 360 : upright;
        const contexts = focusedLane ? (() => {
          const bounds = laneBounds(section, focusedLane.dir, focusedLane.laneIndex);
          return [
            { key: 'inner', dir: focusedLane.dir, insertIndex: focusedLane.laneIndex, offset: bounds.inner - 10 * zoom },
            { key: 'outer', dir: focusedLane.dir, insertIndex: focusedLane.laneIndex + 1, offset: bounds.outer + 10 * zoom }
          ];
        })() : (['in', 'out'] as const).map(dir => ({
          key: dir,
          dir,
          insertIndex: (dir === 'in' ? arm.lanesIn : arm.lanesOut).length,
          offset: profileSideOuter(section, dir) + 10 * zoom
        }));
        return contexts.map(context => {
          const sign = profileDirectionSign(config, context.dir);
          const center = add(location.p, scale(location.normal, sign * context.offset));
          return (
            <g
              key={`add-lane-${context.key}`}
              transform={`translate(${center.x} ${center.y}) rotate(${labelAngle})`}
              cursor="pointer"
              onPointerDown={event => {
                event.preventDefault();
                event.stopPropagation();
                setCommittedConfig(addProfileLane(committedConfig, arm.id, profile[0].id, context.dir, context.insertIndex));
                setSelection({ kind: 'lane', armId: arm.id, dir: context.dir, laneIndex: context.insertIndex });
              }}
            >
              <ProfileLaneAddButton color={profileControlColor(context.insertIndex)} scale={zoom} collapsed={false} tooltip="Add lane." />
            </g>
          );
        });
      })()}
      </g>
    </g>
  );
});
