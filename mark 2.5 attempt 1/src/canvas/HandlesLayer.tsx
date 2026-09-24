import React from 'react';
import { useEditorStore } from '../editor/editorStore';
import { Handle } from './Handle';
import { TangentHandle } from './TangentHandle';
import { RadiusGizmo } from './RadiusGizmo';
import {
  dragArm,
  dragArmNode,
  dragArmNodes,
  dragArms,
  dragBypassConnectorRadius,
  dragBypassLaneAngle,
  dragBypassLanePoint,
  dragIslandCenter,
  dragIslandRadius,
  dragLaneFilletRadius,
  getLaneRingSnapPoints,
  assignLaneRingTarget,
  dragRingCenter,
  dragRingCenters,
  dragRingRadius,
  dragRingRadii,
  dragRingWidth,
  dragRingWidths,
  dragTangentHandle,
  rotateArm,
  rotateArms
} from '../editor/constraints';
import { getBezierSegment } from '../math/spline';
import { add, angleOf, fromAngle, len, scale, sub, type Vec2 } from '../math/vector';
import { type ResolvedSegment } from '../core/solver';
import { type Arc, type Line, arcPoint } from '../geometry/primitives';
import { type RoundaboutConfig, type SelectionTarget } from '../config/types';
import { connectBypassLanes, isValidBypassLanePair } from '../core/bypass';
import { laneRoleAtEndpoint, resolveLaneRing, solveBypassAttachmentPoints, solveLaneFillet, type RoadEndpoint } from '../core/routes';
import { HINT, type DragModifiers } from '../ui/keyHints';

type Props = {
  zoom: number;
  segments: ResolvedSegment[];
};

type LaneTarget = Extract<SelectionTarget, { kind: 'lane' }>;
type ConnectionMagnet =
  | { kind: 'ring'; ringId: string; point: Vec2 }
  | { kind: 'lane'; lane: LaneTarget; point: Vec2 };

// Read the current multi-selection of one kind inside drag callbacks.
const selectionsOfKind = <K extends SelectionTarget['kind']>(kind: K) =>
  useEditorStore.getState().selections.filter((selected): selected is Extract<SelectionTarget, { kind: K }> => selected.kind === kind);

// Bottom-center anchor for the selected roads' move/rotate handles: centered on
// the combined node bounds and pushed just below the pavement's bottom edge.
const selectedArmsAnchor = (config: RoundaboutConfig, armIds: string[], zoom: number): Vec2 | null => {
  let minX = Infinity;
  let maxX = -Infinity;
  let bottom = -Infinity;
  let halfWidth = 0;
  let found = false;
  for (const arm of config.arms) {
    if (!armIds.includes(arm.id)) continue;
    found = true;
    for (const node of arm.nodes) {
      minX = Math.min(minX, node.point.x);
      maxX = Math.max(maxX, node.point.x);
      bottom = Math.max(bottom, node.point.y);
      const width = node.medianWidth + node.laneWidthsIn.reduce((sum, w) => sum + w, 0) + node.laneWidthsOut.reduce((sum, w) => sum + w, 0);
      halfWidth = Math.max(halfWidth, width / 2);
    }
  }
  return found ? { x: (minX + maxX) / 2, y: bottom + halfWidth + 16 * zoom } : null;
};

// Mean of all node points across the selected arms — the pivot for turning.
const selectedArmsCenter = (config: RoundaboutConfig, armIds: string[]): Vec2 | null => {
  const sum = { x: 0, y: 0 };
  let count = 0;
  for (const arm of config.arms) {
    if (!armIds.includes(arm.id)) continue;
    for (const node of arm.nodes) {
      sum.x += node.point.x;
      sum.y += node.point.y;
      count++;
    }
  }
  return count ? { x: sum.x / count, y: sum.y / count } : null;
};

const moveIcon = (
  <g fill="none" stroke="#475569" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
    <path d="M5 9L2 12L5 15" />
    <path d="M9 5L12 2L15 5" />
    <path d="M15 19L12 22L9 19" />
    <path d="M19 9L22 12L19 15" />
    <path d="M2 12H22" />
    <path d="M12 2V22" />
  </g>
);

const rotateIcon = (
  <g fill="none" stroke="#475569" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
    <path d="M21 3v5h-5" />
  </g>
);

export const HandlesLayer: React.FC<Props> = React.memo(({ zoom, segments }) => {
  const committedConfig = useEditorStore(state => state.committedConfig);
  const draftConfig = useEditorStore(state => state.draftConfig);
  const selection = useEditorStore(state => state.selection);
  const selections = useEditorStore(state => state.selections);
  const viewMode = useEditorStore(state => state.viewMode);
  const passThroughStack = useEditorStore(state => state.passThroughStack);
  const drag = useEditorStore(state => state.drag);
  const [dragVisualPoint, setDragVisualPoint] = React.useState<Vec2 | null>(null);
  const [activeMagnet, setActiveMagnet] = React.useState<ConnectionMagnet | null>(null);
  const [activeEndpoint, setActiveEndpoint] = React.useState<RoadEndpoint | null>(null);
  const magnetRef = React.useRef<ConnectionMagnet | null>(null);
  const setDrag = useEditorStore(state => state.setDrag);
  const selectTarget = useEditorStore(state => state.selectTarget);
  const commitDraft = useEditorStore(state => state.commitDraft);
  const setDraftConfig = useEditorStore(state => state.setDraftConfig);
  const config = draftConfig || committedConfig;

  // Safety net: when a Handle unmounts during a drag (because isDragging hides
  // all gizmos), its internal pointerup handler never fires. This window-level
  // listener ensures the drag is always cleaned up.
  React.useEffect(() => {
    if (!drag?.active) return;
    const handleUp = () => {
      commitDraft();
      setDrag(null);
      setDraftConfig(null);
    };
    window.addEventListener('pointerup', handleUp, { once: true });
    return () => window.removeEventListener('pointerup', handleUp);
  }, [drag?.active, commitDraft, setDrag, setDraftConfig]);
  const ringSnapPoints = React.useMemo(() => ({
    start: selection?.kind === 'lane' ? getLaneRingSnapPoints(committedConfig, selection.armId, selection.dir, selection.laneIndex, 'start') : [],
    end: selection?.kind === 'lane' ? getLaneRingSnapPoints(committedConfig, selection.armId, selection.dir, selection.laneIndex, 'end') : []
  }), [committedConfig, selection]);
  const showIslandCenter = selection?.kind === 'island';
  const islandCenter = config.island.center ?? { x: 0, y: 0 };
  const activeArm = selection?.kind === 'arm' || selection?.kind === 'arm-node' || selection?.kind === 'lane' || selection?.kind === 'lane-node' || selection?.kind === 'profile-point' || selection?.kind === 'profile-control'
    ? config.arms.find(arm => arm.id === selection.armId)
    : null;
  const armDirectlySelected = selection?.kind === 'arm';
  const selectedNodeId = selection?.kind === 'arm-node' ? selection.nodeId : null;
  const selectedRing = selection?.kind === 'ring' ? config.rings.find(ring => ring.id === selection.ringId) : null;
  const selectedLane = selection?.kind === 'lane' ? selection : null;
  const filletSegments = selectedLane ? Object.fromEntries((['start', 'end'] as const).map(endpoint => [endpoint,
    segments.find(segment => segment.source.kind === 'lane'
      && segment.source.armId === selectedLane.armId
      && segment.source.dir === selectedLane.dir
      && segment.source.laneIndex === selectedLane.laneIndex
      && segment.endpoint === endpoint
      && segment.kind === `${laneRoleAtEndpoint(selectedLane.dir, endpoint)}-fillet`)
  ])) as Record<RoadEndpoint, ResolvedSegment | undefined> : { start: undefined, end: undefined };
  const selectedBypass = selectedLane
    ? config.bypasses?.find(bypass => selectedLane.dir === 'in'
      ? bypass.fromArmId === selectedLane.armId && bypass.fromLaneIndex === selectedLane.laneIndex
      : bypass.toArmId === selectedLane.armId && bypass.toLaneIndex === selectedLane.laneIndex)
    : null;
  const selectionPassedThrough = selection ? passThroughStack.includes(JSON.stringify(selection)) : false;
  const bypassEntryConnector = selectedBypass
    ? segments.find(segment => segment.routeId === `bypass_${selectedBypass.id}` && segment.kind === 'bypass-entry-connector')
    : null;
  const bypassExitConnector = selectedBypass
    ? segments.find(segment => segment.routeId === `bypass_${selectedBypass.id}` && segment.kind === 'bypass-exit-connector')
    : null;
  const bypassLaneSegment = selectedBypass
    ? segments.find(segment => segment.routeId === `bypass_${selectedBypass.id}` && segment.kind === 'bypass-lane')
    : null;
  const bypassLane = bypassLaneSegment?.geom.kind === 'line'
    ? bypassLaneSegment.geom as Line
    : selectedBypass?.lanePoint
      ? { kind: 'line' as const, p: selectedBypass.lanePoint, u: fromAngle(selectedBypass.laneAngle ?? 0), t0: -1000, t1: 1000 }
      : null;
  const bypassTargetSegment = selectedBypass && selectedLane
    ? segments.find(segment => segment.routeId === `bypass_${selectedBypass.id}`
      && segment.kind === (selectedLane.dir === 'in' ? 'bypass-exit' : 'bypass-entry'))
    : null;
  const bypassTargetPoint = bypassTargetSegment?.geom.kind === 'polyline' ? bypassTargetSegment.geom.points[0] : null;
  const bypassSnapTargets = React.useMemo(() => {
    if (selection?.kind !== 'lane') return [];
    const existing = committedConfig.bypasses?.find(bypass => selection.dir === 'in'
      ? bypass.fromArmId === selection.armId && bypass.fromLaneIndex === selection.laneIndex
      : bypass.toArmId === selection.armId && bypass.toLaneIndex === selection.laneIndex);
    const radius = selection.dir === 'in'
      ? existing?.entryRadius ?? existing?.radius ?? 32
      : existing?.exitRadius ?? existing?.radius ?? 32;
    const targets: Extract<ConnectionMagnet, { kind: 'lane' }>[] = [];
    for (const arm of committedConfig.arms) {
      const laneCount = selection.dir === 'in' ? arm.lanesOut.length : arm.lanesIn.length;
      for (let laneIndex = 0; laneIndex < laneCount; laneIndex++) {
        const lane: LaneTarget = { kind: 'lane', armId: arm.id, dir: selection.dir === 'in' ? 'out' : 'in', laneIndex };
        if (!isValidBypassLanePair(committedConfig, selection, lane)) continue;
        const entry = selection.dir === 'in' ? selection : lane;
        const exit = selection.dir === 'out' ? selection : lane;
        const points = solveBypassAttachmentPoints(committedConfig, entry.armId, entry.laneIndex, exit.armId, exit.laneIndex, radius);
        const point = selection.dir === 'in' ? points?.exit : points?.entry;
        if (point) targets.push({ kind: 'lane', lane, point });
      }
    }
    return targets;
  }, [committedConfig, selection]);

  if (viewMode === 'rendered') return null;

  const laneRings = selectedLane && activeArm ? {
    start: resolveLaneRing(config, activeArm, selectedLane.dir, selectedLane.laneIndex, 'start'),
    end: resolveLaneRing(config, activeArm, selectedLane.dir, selectedLane.laneIndex, 'end')
  } : { start: undefined, end: undefined };
  const ringSnapPointsByEndpoint = Object.fromEntries((['start', 'end'] as const).map(endpoint => {
    const ring = laneRings[endpoint];
    const segment = filletSegments[endpoint];
    if (!ring || segment?.geom.kind !== 'arc') return [endpoint, null];
    const arc = segment.geom as Arc;
    const p0 = arcPoint(arc, arc.a0);
    const p1 = arcPoint(arc, arc.a1);
    return [endpoint, len(sub(p0, ring.center)) <= len(sub(p1, ring.center)) ? p0 : p1];
  })) as Record<RoadEndpoint, Vec2 | null>;
  const connectionHomes: Record<RoadEndpoint, Vec2 | null> = {
    start: bypassTargetPoint ?? ringSnapPointsByEndpoint.start,
    end: ringSnapPointsByEndpoint.end
  };
  const connectionHome = activeEndpoint ? connectionHomes[activeEndpoint] : null;
  const isRingSnapDragging = drag?.active && drag?.type === 'lane-ring-snap';
  const isDragging = Boolean(drag?.active);
  const sameLane = (a: LaneTarget, b: LaneTarget) => a.armId === b.armId && a.dir === b.dir && a.laneIndex === b.laneIndex;

  const clearDragFeedback = () => {
    magnetRef.current = null;
    setActiveMagnet(null);
    setDragVisualPoint(null);
  };

  const resolveConnectionDragPosition = (rawPosition: Vec2, _original: RoundaboutConfig, modifiers?: DragModifiers): Vec2 => {
    // Ctrl/Cmd disables snapping — the handle follows the pointer freely.
    if (modifiers?.mod) {
      magnetRef.current = null;
      setActiveMagnet(null);
      setDragVisualPoint(rawPosition);
      return rawPosition;
    }
    const captureRadius = 16 * zoom;

    // Exclude the current connection target so the handle starts free, not
    // snapping to where it already is.
    const isCurrentTarget = (candidate: ConnectionMagnet): boolean => {
      if (selectedBypass && candidate.kind === 'lane') {
        const otherDir = selectedLane!.dir === 'in' ? 'out' : 'in';
        const otherArmId = selectedLane!.dir === 'in' ? selectedBypass.toArmId : selectedBypass.fromArmId;
        const otherLaneIndex = selectedLane!.dir === 'in' ? selectedBypass.toLaneIndex : selectedBypass.fromLaneIndex;
        return candidate.lane.armId === otherArmId && candidate.lane.dir === otherDir && candidate.lane.laneIndex === otherLaneIndex;
      }
      const laneRingId = activeEndpoint ? laneRings[activeEndpoint]?.id : undefined;
      if (laneRingId && candidate.kind === 'ring') return candidate.ringId === laneRingId;
      return false;
    };

    const candidates: ConnectionMagnet[] = [
      ...(activeEndpoint ? ringSnapPoints[activeEndpoint] : []).map(({ ringId, point }) => ({ kind: 'ring' as const, ringId, point })),
      ...(activeEndpoint === 'start' ? bypassSnapTargets : []),
    ].filter(candidate => !isCurrentTarget(candidate));

    // Stay snapped to current target while within capture radius
    let magnet = magnetRef.current;
    if (magnet && len(sub(magnet.point, rawPosition)) <= captureRadius) {
      magnetRef.current = magnet;
      setActiveMagnet(magnet);
      setDragVisualPoint(magnet.point);
      return magnet.point;
    }

    // Otherwise find nearest target within capture radius
    magnet = null;
    let nearestDist = Infinity;
    for (const candidate of candidates) {
      const d = len(sub(candidate.point, rawPosition));
      if (d < nearestDist) { magnet = candidate; nearestDist = d; }
    }
    if (magnet && nearestDist <= captureRadius) {
      magnetRef.current = magnet;
      setActiveMagnet(magnet);
      setDragVisualPoint(magnet.point);
      return magnet.point;
    }

    // Free — follow mouse exactly
    magnetRef.current = null;
    setActiveMagnet(null);
    setDragVisualPoint(rawPosition);
    return rawPosition;
  };

  const finishLaneRingSnap = (_delta: Vec2, original: RoundaboutConfig, _clientPoint: Vec2, _modifiers: DragModifiers, dragTarget?: SelectionTarget): RoundaboutConfig | null => {
    const lane = dragTarget?.kind === 'lane' ? dragTarget : selectedLane;
    if (!lane || !activeEndpoint) return null;
    const endpoint = activeEndpoint;
    const magnet = magnetRef.current;
    clearDragFeedback();
    setActiveEndpoint(null);
    if (!magnet) return null;
    if (magnet.kind === 'ring') {
      return assignLaneRingTarget(lane.armId, lane.dir, lane.laneIndex, magnet.ringId, original, endpoint);
    }
    if (endpoint !== 'start') return null;
    const existing = original.bypasses?.find(bypass => lane.dir === 'in'
      ? bypass.fromArmId === lane.armId && bypass.fromLaneIndex === lane.laneIndex
      : bypass.toArmId === lane.armId && bypass.toLaneIndex === lane.laneIndex);
    const radius = lane.dir === 'in'
      ? existing?.entryRadius ?? existing?.radius ?? 32
      : existing?.exitRadius ?? existing?.radius ?? 32;
    return connectBypassLanes(original, lane, magnet.lane, radius);
  };

  return (
    <g pointerEvents={selectionPassedThrough ? 'none' : undefined}>
      {/* When dragging the ring-snap handle, hide all other gizmos and show snap targets */}
      {isRingSnapDragging && activeEndpoint && ringSnapPoints[activeEndpoint].map(({ ringId, point }) => {
        if (connectionHome && len(sub(point, connectionHome)) < zoom) return null;
        const isActive = activeMagnet?.kind === 'ring' && activeMagnet.ringId === ringId;
        return (
          <circle
            key={`snap-target-${ringId}`}
            cx={point.x}
            cy={point.y}
            r={(isActive ? 10 : 8) * zoom}
            fill={isActive ? '#dcfce7' : '#fff'}
            stroke="#22c55e"
            strokeWidth={(isActive ? 3 : 2) * zoom}
            strokeDasharray={isActive ? undefined : `${4 * zoom} ${3 * zoom}`}
            pointerEvents="none"
          />
        );
      })}
      {isRingSnapDragging && activeEndpoint === 'start' && bypassSnapTargets.map(target => {
        if (connectionHome && len(sub(target.point, connectionHome)) < zoom) return null;
        const isActive = activeMagnet?.kind === 'lane' && sameLane(activeMagnet.lane, target.lane);
        return (
          <circle
            key={`bypass-snap-${target.lane.armId}-${target.lane.dir}-${target.lane.laneIndex}`}
            cx={target.point.x}
            cy={target.point.y}
            r={(isActive ? 9 : 6) * zoom}
            fill={isActive ? '#dcfce7' : '#fff'}
            stroke="#22c55e"
            strokeWidth={(isActive ? 3 : 2) * zoom}
            pointerEvents="none"
          />
        );
      })}
      {isRingSnapDragging && connectionHome && dragVisualPoint && len(sub(dragVisualPoint, connectionHome)) > zoom && (
        <line
          x1={connectionHome.x}
          y1={connectionHome.y}
          x2={dragVisualPoint.x}
          y2={dragVisualPoint.y}
          stroke="#7c3aed"
          strokeWidth={2 * zoom}
          strokeDasharray={`${5 * zoom} ${4 * zoom}`}
          strokeLinecap="round"
          opacity={activeMagnet ? 0.9 : 0.55}
          pointerEvents="none"
        />
      )}

      {/* All gizmos below are kept mounted during drag so the dragged Handle
          retains its pointer capture and drag lifecycle. Non-dragged gizmos
          stay visible but don't capture pointer events while dragging. */}
      <g style={{ pointerEvents: isDragging ? 'none' : 'auto' }}>
        <>
          {showIslandCenter && (
            <>
              <Handle
                x={islandCenter.x}
                y={islandCenter.y}
                zoom={zoom}
                cursor="move"
                fill="#dbeafe"
                stroke="#2563eb"
                tooltip="Drag to move the center island."
                keyHints={[HINT.noSnap]}
                onDrag={(delta, original, modifiers) => dragIslandCenter(delta, original, !modifiers.mod)}
              />
              <RadiusGizmo
                center={islandCenter}
                radius={config.island.radius}
                zoom={zoom}
                color="#2563eb"
                tooltip="Drag to change the center island radius."
                keyHints={[HINT.noSnap]}
                onDrag={(direction, delta, original, modifiers) => dragIslandRadius(direction, delta, original, !modifiers.mod)}
              />
            </>
          )}

          {selectedRing && (
            <>
              <Handle
                x={selectedRing.center.x}
                y={selectedRing.center.y}
                zoom={zoom}
                fill="#ecfeff"
                stroke="#0891b2"
                tooltip={`Drag to move ring ${selectedRing.id}.`}
                keyHints={[HINT.multiSelect, HINT.duplicate, HINT.noSnap]}
                dragTarget={{ kind: 'ring', ringId: selectedRing.id }}
                duplicateOwner
                onDrag={(delta, original, modifiers, activeTarget) => {
                  const ringIds = selectionsOfKind('ring').map(selected => selected.ringId);
                  return activeTarget?.kind === 'ring' && ringIds.includes(activeTarget.ringId) ? dragRingCenters(ringIds, delta, original, !modifiers.mod) : dragRingCenter(selectedRing.id, delta, original, !modifiers.mod);
                }}
              />
              <RadiusGizmo
                center={selectedRing.center}
                radius={selectedRing.radius}
                zoom={zoom}
                color="#0891b2"
                tooltip={`Drag to change ring ${selectedRing.id}'s centerline radius.`}
                keyHints={[HINT.multiSelect, HINT.duplicate, HINT.noSnap]}
                dragTarget={{ kind: 'ring', ringId: selectedRing.id }}
                duplicateOwner
                onDrag={(direction, delta, original, modifiers, activeTarget) => {
                  const ringIds = selectionsOfKind('ring').map(selected => selected.ringId);
                  return activeTarget?.kind === 'ring' && ringIds.includes(activeTarget.ringId) ? dragRingRadii(ringIds, direction, delta, original, !modifiers.mod) : dragRingRadius(selectedRing.id, direction, delta, original, !modifiers.mod);
                }}
              />
              <RadiusGizmo
                center={selectedRing.center}
                radius={selectedRing.radius + selectedRing.width / 2}
                zoom={zoom}
                color="#16a34a"
                tooltip={`Drag to change ring ${selectedRing.id}'s pavement width.`}
                keyHints={[HINT.multiSelect, HINT.duplicate, HINT.noSnap]}
                dragTarget={{ kind: 'ring', ringId: selectedRing.id }}
                duplicateOwner
                onDrag={(direction, delta, original, modifiers, activeTarget) => {
                  const ringIds = selectionsOfKind('ring').map(selected => selected.ringId);
                  return activeTarget?.kind === 'ring' && ringIds.includes(activeTarget.ringId) ? dragRingWidths(ringIds, direction, delta, original, !modifiers.mod) : dragRingWidth(selectedRing.id, direction, delta, original, !modifiers.mod);
                }}
              />
            </>
          )}

          {selectedLane && (['start', 'end'] as const).map(endpoint => {
            const segment = filletSegments[endpoint];
            const ringId = laneRings[endpoint]?.id;
            if (segment?.geom.kind !== 'arc' || !ringId) return null;
            const arc = segment.geom as Arc;
            const angle = (arc.a0 + arc.a1) / 2;
            const baseFillet = solveLaneFillet(committedConfig, selectedLane.armId, selectedLane.dir, selectedLane.laneIndex, ringId, endpoint);
            const probe = structuredClone(committedConfig);
            const probeArm = probe.arms.find(arm => arm.id === selectedLane.armId);
            const probeLane = selectedLane.dir === 'in' ? probeArm?.lanesIn[selectedLane.laneIndex] : probeArm?.lanesOut[selectedLane.laneIndex];
            if (probeLane) {
              if (laneRoleAtEndpoint(selectedLane.dir, endpoint) === 'entry') probeLane.targetFilletRadius = (baseFillet?.arc.r ?? arc.r) + 1;
              else probeLane.sourceFilletRadius = (baseFillet?.arc.r ?? arc.r) + 1;
            }
            const probeFillet = solveLaneFillet(probe, selectedLane.armId, selectedLane.dir, selectedLane.laneIndex, ringId, endpoint);
            const centerRate = baseFillet && probeFillet ? sub(probeFillet.arc.c, baseFillet.arc.c) : fromAngle(angle);
            return (
              <RadiusGizmo
                key={`lane-fillet-${endpoint}`}
                center={arc.c}
                radius={arc.r}
                zoom={zoom}
                color="#f97316"
                arc={arc}
                dragVector={centerRate}
                tooltip="Drag the curve to increase or decrease this lane's connector radius."
                keyHints={[HINT.duplicate]}
                dragTarget={selectedLane}
                duplicateOwner
                onDrag={(direction, delta, original, _modifiers, activeTarget) => {
                  const lane = activeTarget?.kind === 'lane' ? activeTarget : selectedLane;
                  return dragLaneFilletRadius(lane.armId, lane.dir, lane.laneIndex, endpoint, direction, delta, original);
                }}
              />
            );
          })}

          {selectedBypass && bypassEntryConnector?.geom.kind === 'arc' && (() => {
            const arc = bypassEntryConnector.geom as Arc;
            const angle = (arc.a0 + arc.a1) / 2;
            const centerRate = bypassEntryConnector.radiusCenterRate ?? fromAngle(angle);
            return (
              <RadiusGizmo
                center={arc.c}
                radius={arc.r}
                zoom={zoom}
                color="#16a34a"
                arc={arc}
                dragVector={centerRate}
                tooltip="Drag the entry connector curve to change its radius."
                onDrag={(direction, delta, original) => dragBypassConnectorRadius(selectedBypass.id, 'entry', direction, delta, original)}
              />
            );
          })()}

          {selectedBypass && bypassExitConnector?.geom.kind === 'arc' && (() => {
            const arc = bypassExitConnector.geom as Arc;
            const angle = (arc.a0 + arc.a1) / 2;
            const centerRate = bypassExitConnector.radiusCenterRate ?? fromAngle(angle);
            return (
              <RadiusGizmo
                center={arc.c}
                radius={arc.r}
                zoom={zoom}
                color="#16a34a"
                arc={arc}
                dragVector={centerRate}
                tooltip="Drag the exit connector curve to change its radius."
                onDrag={(direction, delta, original) => dragBypassConnectorRadius(selectedBypass.id, 'exit', direction, delta, original)}
              />
            );
          })()}

          {selectedBypass && bypassLane && (() => {
            const line = bypassLane;
            const anchor = line.p;
            const rotationHandle = add(anchor, scale(line.u, 30));
            return (
              <>
                <line
                  x1={anchor.x}
                  y1={anchor.y}
                  x2={rotationHandle.x}
                  y2={rotationHandle.y}
                  stroke="#16a34a"
                  strokeWidth={1.5 * zoom}
                  pointerEvents="none"
                />
                <Handle
                  x={anchor.x}
                  y={anchor.y}
                  zoom={zoom}
                  radius={6}
                  fill="#f0fdf4"
                  stroke="#16a34a"
                  cursor="ns-resize"
                  tooltip="Drag toward or away from the roundabout to reposition the bypass lane."
                  onDrag={(delta, original) => dragBypassLanePoint(selectedBypass.id, delta, original)}
                />
                <Handle
                  x={rotationHandle.x}
                  y={rotationHandle.y}
                  zoom={zoom}
                  radius={5}
                  fill="#f0fdf4"
                  stroke="#16a34a"
                  cursor="crosshair"
                  tooltip="Drag to rotate the straight bypass lane around its placement point."
                  onDrag={(delta, original) => dragBypassLaneAngle(selectedBypass.id, delta, original)}
                />
              </>
            );
          })()}

          {activeArm && selectedNodeId !== null && (() => {
            const index = activeArm.nodes.findIndex(n => n.id === selectedNodeId);
            if (index < 0) return null;
            const node = activeArm.nodes[index];
            const handles = [];
            if (index > 0) {
              const segment = getBezierSegment(activeArm.nodes, index - 1);
              handles.push(
                <TangentHandle
                  key={`${node.id}-in`}
                  anchor={node.point}
                  offset={sub(segment.c2, node.point)}
                  zoom={zoom}
                  onDrag={(delta, original) => dragTangentHandle(activeArm.id, node.id, 'in', delta, original)}
                />
              );
            }
            if (index < activeArm.nodes.length - 1) {
              const segment = getBezierSegment(activeArm.nodes, index);
              handles.push(
                <TangentHandle
                  key={`${node.id}-out`}
                  anchor={node.point}
                  offset={sub(segment.c1, node.point)}
                  zoom={zoom}
                  onDrag={(delta, original) => dragTangentHandle(activeArm.id, node.id, 'out', delta, original)}
                />
              );
            }
            return handles;
          })()}

          {activeArm && armDirectlySelected && (() => {
            const armIds = selections.filter(selected => selected.kind === 'arm').map(selected => selected.armId);
            const anchor = selectedArmsAnchor(config, armIds.length ? armIds : [activeArm.id], zoom);
            if (!anchor) return null;
            const target = { kind: 'arm' as const, armId: activeArm.id };
            const spacing = 14 * zoom;
            return (
              <>
                <Handle
                  x={anchor.x - spacing}
                  y={anchor.y}
                  zoom={zoom}
                  radius={9}
                  cursor="move"
                  fill="#fff"
                  stroke="#475569"
                  tooltip="Drag to move the selected roads."
                  keyHints={[HINT.multiSelect, HINT.duplicate, HINT.noSnap]}
                  dragTarget={target}
                  duplicateOwner
                  icon={moveIcon}
                  onDrag={(delta, original, modifiers, activeTarget) => {
                    const selectedArmIds = selectionsOfKind('arm').map(selected => selected.armId);
                    return activeTarget?.kind === 'arm' && selectedArmIds.includes(activeTarget.armId) ? dragArms(selectedArmIds, delta, original, !modifiers.mod) : dragArm(activeArm.id, delta, original, !modifiers.mod);
                  }}
                />
                <Handle
                  x={anchor.x + spacing}
                  y={anchor.y}
                  zoom={zoom}
                  radius={9}
                  fill="#fff"
                  stroke="#475569"
                  tooltip="Drag to turn the selected roads."
                  keyHints={[HINT.duplicate]}
                  dragTarget={target}
                  duplicateOwner
                  icon={rotateIcon}
                  onDrag={(delta, original, _modifiers, activeTarget) => {
                    const selectedArmIds = selectionsOfKind('arm').map(selected => selected.armId);
                    const ids = selectedArmIds.length ? selectedArmIds : [activeArm.id];
                    const pivot = selectedArmsCenter(original, ids);
                    const startAnchor = selectedArmsAnchor(original, ids, zoom);
                    if (!pivot || !startAnchor) return original;
                    const startVec = sub(startAnchor, pivot);
                    const angle = angleOf(add(startVec, delta)) - angleOf(startVec);
                    return activeTarget?.kind === 'arm' && selectedArmIds.includes(activeTarget.armId) ? rotateArms(selectedArmIds, pivot, angle, original) : rotateArm(activeArm.id, pivot, angle, original);
                  }}
                />
              </>
            );
          })()}

          {activeArm && (armDirectlySelected || selectedNodeId !== null) && activeArm.nodes.map((node, nodeIndex) => {
            const target = { kind: 'arm-node' as const, armId: activeArm.id, nodeId: node.id };
            const isSelected = selections.some(selected => selected.kind === 'arm-node' && selected.armId === activeArm.id && selected.nodeId === node.id);
            return (
              <Handle
                key={nodeIndex}
                x={node.point.x}
                y={node.point.y}
                zoom={zoom}
                cursor="move"
                fill={isSelected ? '#2563eb' : '#fff'}
                stroke={isSelected ? '#fff' : '#2563eb'}
                tooltip={isSelected ? 'Drag to move the selected nodes.' : 'Click to select this node, or drag to move it.'}
                keyHints={[HINT.multiSelect, HINT.duplicate, HINT.noSnap]}
                dragTarget={target}
                duplicateOwner
                onDragStart={modifiers => selectTarget(target, modifiers.shift)}
                onDrag={(delta, original, modifiers, activeTarget) => {
                  const selectedNodes = selectionsOfKind('arm-node');
                  return activeTarget?.kind === 'arm-node' && selectedNodes.some(selected => selected.armId === activeTarget.armId && selected.nodeId === activeTarget.nodeId)
                    ? dragArmNodes(original, selectedNodes, delta, !modifiers.mod)
                    : dragArmNode(activeArm.id, node.id, delta, original, !modifiers.mod);
                }}
              />
            );
          })}
        </>
      </g>
      {(!isDragging || isRingSnapDragging) && selectedLane && (['start', 'end'] as const).map(endpoint => {
        const home = connectionHomes[endpoint];
        if (!home) return null;
        return (
          <Handle
            key={`lane-ring-snap-handle-${endpoint}`}
            x={home.x}
            y={home.y}
            zoom={zoom}
            radius={5}
            fill="#f3e8ff"
            stroke="#7c3aed"
            dragType="lane-ring-snap"
            dragTarget={selectedLane}
            duplicateOwner
            followPointer
            springDrag={Boolean(activeMagnet)}
            resolveDragPosition={resolveConnectionDragPosition}
            keyHints={[HINT.duplicate, HINT.noSnap]}
            onDragStart={() => {
              clearDragFeedback();
              setActiveEndpoint(endpoint);
              setDragVisualPoint(home);
            }}
            tooltip={`Drag this ${endpoint} connection to another intersected ring${endpoint === 'start' ? ' or compatible lane' : ''}.`}
            onDrag={(_, original) => original}
            onDragEnd={finishLaneRingSnap}
            onDragCancel={() => {
              clearDragFeedback();
              setActiveEndpoint(null);
            }}
          />
        );
      })}
    </g>
  );
});
