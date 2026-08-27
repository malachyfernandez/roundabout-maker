import React from 'react';
import { useEditorStore } from '../editor/editorStore';
import { Handle } from './Handle';
import { TangentHandle } from './TangentHandle';
import { RadiusGizmo } from './RadiusGizmo';
import {
  dragArmNode,
  dragBypassConnectorRadius,
  dragBypassLaneAngle,
  dragBypassLanePoint,
  dragIslandCenter,
  dragIslandRadius,
  dragLaneFilletRadius,
  getLaneRingSnapPoints,
  assignLaneRingTarget,
  dragRingCenter,
  dragRingRadius,
  dragRingWidth,
  dragTangentHandle,
  removeArmNode
} from '../editor/constraints';
import { getBezierSegment } from '../math/spline';
import { add, fromAngle, len, scale, sub, type Vec2 } from '../math/vector';
import { type ResolvedSegment } from '../core/solver';
import { type Arc, type Line, arcPoint } from '../geometry/primitives';
import { type RoundaboutConfig, type SelectionTarget } from '../config/types';
import { connectBypassLanes, isValidBypassLanePair } from '../core/bypass';
import { resolveLaneRing, solveBypassAttachmentPoints, solveLaneFillet } from '../core/routes';

type Props = {
  zoom: number;
  segments: ResolvedSegment[];
};

type LaneTarget = Extract<SelectionTarget, { kind: 'lane' }>;
type ConnectionMagnet =
  | { kind: 'ring'; ringId: string; point: Vec2 }
  | { kind: 'lane'; lane: LaneTarget; point: Vec2 };

export const HandlesLayer: React.FC<Props> = ({ zoom, segments }) => {
  const committedConfig = useEditorStore(state => state.committedConfig);
  const draftConfig = useEditorStore(state => state.draftConfig);
  const selection = useEditorStore(state => state.selection);
  const viewMode = useEditorStore(state => state.viewMode);
  const passThroughStack = useEditorStore(state => state.passThroughStack);
  const drag = useEditorStore(state => state.drag);
  const [dragVisualPoint, setDragVisualPoint] = React.useState<Vec2 | null>(null);
  const [activeMagnet, setActiveMagnet] = React.useState<ConnectionMagnet | null>(null);
  const magnetRef = React.useRef<ConnectionMagnet | null>(null);
  const config = draftConfig || committedConfig;
  const ringSnapPoints = React.useMemo(() => selection?.kind === 'lane'
    ? getLaneRingSnapPoints(committedConfig, selection.armId, selection.dir, selection.laneIndex)
    : [], [committedConfig, selection]);
  const showIslandCenter = selection?.kind === 'island';
  const islandCenter = config.island.center ?? { x: 0, y: 0 };
  const activeArm = selection?.kind === 'arm' || selection?.kind === 'lane' || selection?.kind === 'profile-point'
    ? config.arms.find(arm => arm.id === selection.armId)
    : null;
  const armDirectlySelected = selection?.kind === 'arm';
  const selectedRing = selection?.kind === 'ring' ? config.rings.find(ring => ring.id === selection.ringId) : null;
  const selectedLane = selection?.kind === 'lane' ? selection : null;
  const filletSegment = selectedLane
    ? segments.find(segment => segment.source.kind === 'lane'
      && segment.source.armId === selectedLane.armId
      && segment.source.dir === selectedLane.dir
      && segment.source.laneIndex === selectedLane.laneIndex
      && segment.kind === (selectedLane.dir === 'in' ? 'entry-fillet' : 'exit-fillet'))
    : null;
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

  const laneRing = selectedLane && activeArm
    ? resolveLaneRing(config, activeArm, selectedLane.dir, selectedLane.laneIndex)
    : undefined;
  const laneRingId = laneRing?.id;

  // Compute the fillet arc endpoint that sits on the ring edge.
  // This is where the lane connector meets the ring — the handle position.
  let ringSnapPoint: { x: number; y: number } | null = null;
  if (filletSegment?.geom.kind === 'arc' && laneRing) {
    const arc = filletSegment.geom as Arc;
    const p0 = arcPoint(arc, arc.a0);
    const p1 = arcPoint(arc, arc.a1);
    const d0 = len(sub(p0, laneRing.center));
    const d1 = len(sub(p1, laneRing.center));
    ringSnapPoint = d0 <= d1 ? p0 : p1;
  } else if (laneRing) {
    // Fallback: project the arm's near node onto the ring circumference
    const nearNode = activeArm?.nodes[0];
    if (nearNode) {
      const dir = sub(nearNode.point, laneRing.center);
      const d = len(dir);
      ringSnapPoint = d > 0
        ? { x: laneRing.center.x + dir.x / d * laneRing.radius, y: laneRing.center.y + dir.y / d * laneRing.radius }
        : { x: laneRing.center.x + laneRing.radius, y: laneRing.center.y };
    }
  }

  const connectionHome = bypassTargetPoint ?? ringSnapPoint;
  const isRingSnapDragging = drag?.active && drag?.type === 'lane-ring-snap';
  const sameLane = (a: LaneTarget, b: LaneTarget) => a.armId === b.armId && a.dir === b.dir && a.laneIndex === b.laneIndex;

  const clearDragFeedback = () => {
    magnetRef.current = null;
    setActiveMagnet(null);
    setDragVisualPoint(null);
  };

  const resolveConnectionDragPosition = (rawPosition: Vec2): Vec2 => {
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
      if (!selectedBypass && laneRingId && candidate.kind === 'ring') return candidate.ringId === laneRingId;
      return false;
    };

    const candidates: ConnectionMagnet[] = [
      ...ringSnapPoints.map(({ ringId, point }) => ({ kind: 'ring' as const, ringId, point })),
      ...bypassSnapTargets,
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

  const finishLaneRingSnap = (_delta: Vec2, original: RoundaboutConfig): RoundaboutConfig | null => {
    if (!selectedLane) return null;
    const magnet = magnetRef.current;
    clearDragFeedback();
    if (!magnet) return null;
    if (magnet.kind === 'ring') {
      return assignLaneRingTarget(selectedLane.armId, selectedLane.dir, selectedLane.laneIndex, magnet.ringId, original);
    }
    const existing = original.bypasses?.find(bypass => selectedLane.dir === 'in'
      ? bypass.fromArmId === selectedLane.armId && bypass.fromLaneIndex === selectedLane.laneIndex
      : bypass.toArmId === selectedLane.armId && bypass.toLaneIndex === selectedLane.laneIndex);
    const radius = selectedLane.dir === 'in'
      ? existing?.entryRadius ?? existing?.radius ?? 32
      : existing?.exitRadius ?? existing?.radius ?? 32;
    return connectBypassLanes(original, selectedLane, magnet.lane, radius);
  };

  return (
    <g pointerEvents={selectionPassedThrough ? 'none' : undefined}>
      {/* When dragging the ring-snap handle, hide all other gizmos and show snap targets */}
      {isRingSnapDragging && ringSnapPoints.map(({ ringId, point }) => {
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
      {isRingSnapDragging && bypassSnapTargets.map(target => {
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

      {/* All gizmos below are hidden while dragging the ring-snap handle */}
      {!isRingSnapDragging && (
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
                onDrag={dragIslandCenter}
              />
              <RadiusGizmo
                center={islandCenter}
                radius={config.island.radius}
                zoom={zoom}
                color="#2563eb"
                tooltip="Drag to change the center island radius."
                onDrag={(delta, original) => dragIslandRadius(fromAngle(-Math.PI / 4), delta, original)}
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
                onDrag={(delta, original) => dragRingCenter(selectedRing.id, delta, original)}
              />
              <RadiusGizmo
                center={selectedRing.center}
                radius={selectedRing.radius}
                zoom={zoom}
                color="#0891b2"
                tooltip={`Drag to change ring ${selectedRing.id}'s centerline radius.`}
                onDrag={(delta, original) => dragRingRadius(selectedRing.id, fromAngle(-Math.PI / 4), delta, original)}
              />
              <RadiusGizmo
                center={selectedRing.center}
                radius={selectedRing.radius + selectedRing.width / 2}
                angle={Math.PI / 4}
                zoom={zoom}
                color="#16a34a"
                tooltip={`Drag to change ring ${selectedRing.id}'s pavement width.`}
                onDrag={(delta, original) => dragRingWidth(selectedRing.id, fromAngle(Math.PI / 4), delta, original)}
              />
            </>
          )}

          {selectedLane && filletSegment?.geom.kind === 'arc' && laneRingId && (() => {
            const arc = filletSegment.geom as Arc;
            const angle = (arc.a0 + arc.a1) / 2;
            const baseFillet = solveLaneFillet(committedConfig, selectedLane.armId, selectedLane.dir, selectedLane.laneIndex, laneRingId);
            const probe = structuredClone(committedConfig);
            const probeArm = probe.arms.find(arm => arm.id === selectedLane.armId);
            const probeLane = selectedLane.dir === 'in' ? probeArm?.lanesIn[selectedLane.laneIndex] : probeArm?.lanesOut[selectedLane.laneIndex];
            if (probeLane) probeLane.filletRadius = (baseFillet?.arc.r ?? arc.r) + 1;
            const probeFillet = solveLaneFillet(probe, selectedLane.armId, selectedLane.dir, selectedLane.laneIndex, laneRingId);
            const centerRate = baseFillet && probeFillet ? sub(probeFillet.arc.c, baseFillet.arc.c) : fromAngle(angle);
            return (
              <RadiusGizmo
                center={arc.c}
                radius={arc.r}
                angle={angle}
                zoom={zoom}
                color="#f97316"
                handleAtCenter
                arc={arc}
                tooltip="Drag the curve center to increase or decrease this lane's connector radius."
                onDrag={(delta, original) => dragLaneFilletRadius(selectedLane.armId, selectedLane.dir, selectedLane.laneIndex, centerRate, delta, original)}
              />
            );
          })()}

          {selectedBypass && bypassEntryConnector?.geom.kind === 'arc' && (() => {
            const arc = bypassEntryConnector.geom as Arc;
            const angle = (arc.a0 + arc.a1) / 2;
            const centerRate = bypassEntryConnector.radiusCenterRate ?? fromAngle(angle);
            return (
              <RadiusGizmo
                center={arc.c}
                radius={arc.r}
                angle={angle}
                zoom={zoom}
                color="#16a34a"
                handleAtCenter
                arc={arc}
                tooltip="Drag the entry connector center to change its radius."
                onDrag={(delta, original) => dragBypassConnectorRadius(selectedBypass.id, 'entry', centerRate, delta, original)}
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
                angle={angle}
                zoom={zoom}
                color="#16a34a"
                handleAtCenter
                arc={arc}
                tooltip="Drag the exit connector center to change its radius."
                onDrag={(delta, original) => dragBypassConnectorRadius(selectedBypass.id, 'exit', centerRate, delta, original)}
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

          {armDirectlySelected && activeArm && activeArm.nodes.flatMap((node, index) => {
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
          })}

          {armDirectlySelected && activeArm && activeArm.nodes.map((node, index) => {
            // Detect wrong-end condition: the far end (nodes[last]) is inside a ring
            // while the near end (nodes[0]) is outside. This means the road direction
            // is backwards and should be swapped.
            const nearNode = activeArm.nodes[0];
            const farNode = activeArm.nodes[activeArm.nodes.length - 1];
            const isFarNode = index === activeArm.nodes.length - 1;
            let errorTooltip: string | undefined;
            if (isFarNode && activeArm.nodes.length >= 2 && config.rings.length > 0) {
              const nearInside = config.rings.some(ring =>
                len(sub(nearNode.point, ring.center)) <= ring.radius + ring.width / 2
              );
              const farInside = config.rings.some(ring =>
                len(sub(farNode.point, ring.center)) <= ring.radius + ring.width / 2
              );
              if (farInside && !nearInside) {
                errorTooltip = 'This end is inside the roundabout but it is the far end. Swap the road direction so this becomes the connecting end.';
              }
            }
            return (
              <Handle
                key={node.id}
                x={node.point.x}
                y={node.point.y}
                zoom={zoom}
                cursor="move"
                fill={errorTooltip ? '#fee2e2' : '#fff'}
                stroke={errorTooltip ? '#dc2626' : '#2563eb'}
                tooltip={activeArm.nodes.length > 2 ? 'Click to delete.' : 'Roads need at least two points.'}
                errorTooltip={errorTooltip}
                onDrag={(delta, original) => dragArmNode(activeArm.id, node.id, delta, original)}
                onClick={activeArm.nodes.length > 2 ? original => removeArmNode(original, activeArm.id, node.id) : undefined}
              />
            );
          })}
        </>
      )}
      {selectedLane && connectionHome && (
        <Handle
          key="lane-ring-snap-handle"
          x={connectionHome.x}
          y={connectionHome.y}
          zoom={zoom}
          radius={5}
          fill="#f3e8ff"
          stroke="#7c3aed"
          dragType="lane-ring-snap"
          followPointer
          springDrag={Boolean(activeMagnet)}
          resolveDragPosition={resolveConnectionDragPosition}
          onDragStart={() => {
            clearDragFeedback();
            setDragVisualPoint(connectionHome);
          }}
          tooltip={`Drag this connection endpoint to a green ${selectedLane.dir === 'in' ? 'exit' : 'entry'} lane or ring target.`}
          onDrag={(_, original) => original}
          onDragEnd={finishLaneRingSnap}
          onDragCancel={clearDragFeedback}
        />
      )}
    </g>
  );
};
