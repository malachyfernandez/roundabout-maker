import React from 'react';
import { useEditorStore } from '../editor/editorStore';
import { Handle } from './Handle';
import { TangentHandle } from './TangentHandle';
import { RadiusGizmo } from './RadiusGizmo';
import {
  dragArmNode,
  dragBypassRadius,
  dragIslandCenter,
  dragIslandRadius,
  dragLaneFilletRadius,
  dragLaneRingTarget,
  getLaneRingSnapPoints,
  dragRingCenter,
  dragRingRadius,
  dragRingWidth,
  dragTangentHandle,
  removeArmNode
} from '../editor/constraints';
import { getBezierSegment } from '../math/spline';
import { fromAngle, len, sub } from '../math/vector';
import { type ResolvedSegment } from '../core/solver';
import { type Arc, arcPoint } from '../geometry/primitives';

type Props = {
  zoom: number;
  segments: ResolvedSegment[];
};

export const HandlesLayer: React.FC<Props> = ({ zoom, segments }) => {
  const committedConfig = useEditorStore(state => state.committedConfig);
  const draftConfig = useEditorStore(state => state.draftConfig);
  const selection = useEditorStore(state => state.selection);
  const viewMode = useEditorStore(state => state.viewMode);
  const passThroughStack = useEditorStore(state => state.passThroughStack);
  const drag = useEditorStore(state => state.drag);
  const config = draftConfig || committedConfig;
  const ringSnapPoints = React.useMemo(() => selection?.kind === 'lane'
    ? getLaneRingSnapPoints(committedConfig, selection.armId, selection.dir, selection.laneIndex)
    : [], [committedConfig, selection]);
  const showIslandCenter = selection?.kind === 'island';
  const islandCenter = config.island.center ?? { x: 0, y: 0 };
  const activeArm = selection?.kind === 'arm' || selection?.kind === 'lane'
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
  const selectedBypass = selectedLane?.dir === 'in'
    ? config.bypasses?.find(bypass => bypass.fromArmId === selectedLane.armId && bypass.fromLaneIndex === selectedLane.laneIndex)
    : null;
  const selectionPassedThrough = selection ? passThroughStack.includes(JSON.stringify(selection)) : false;
  const bypassSegment = selectedBypass
    ? segments.find(segment => segment.routeId === `bypass_${selectedBypass.id}` && segment.kind === 'bypass-curve')
    : null;

  if (viewMode === 'rendered') return null;

  const laneRingId = selectedLane && activeArm
    ? selectedLane.dir === 'in'
      ? activeArm.lanesIn[selectedLane.laneIndex]?.targetsRing
      : activeArm.lanesOut[selectedLane.laneIndex]?.sourceRing
    : null;
  const laneRing = config.rings.find(ring => ring.id === laneRingId);

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

  const isRingSnapDragging = drag?.active && drag?.type === 'lane-ring-snap';

  return (
    <g pointerEvents={selectionPassedThrough ? 'none' : undefined}>
      {/* When dragging the ring-snap handle, hide all other gizmos and show snap targets */}
      {isRingSnapDragging && ringSnapPoints.map(({ ringId, point }) => {
        const isCurrent = ringId === laneRingId;
        return (
          <circle
            key={`snap-target-${ringId}`}
            cx={point.x}
            cy={point.y}
            r={(isCurrent ? 6 : 8) * zoom}
            fill={isCurrent ? '#f3e8ff' : '#fff'}
            stroke={isCurrent ? '#7c3aed' : '#22c55e'}
            strokeWidth={2 * zoom}
            strokeDasharray={isCurrent ? undefined : `${4 * zoom} ${3 * zoom}`}
            pointerEvents="none"
          />
        );
      })}

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

          {selectedLane && filletSegment?.geom.kind === 'arc' && (() => {
            const arc = filletSegment.geom as Arc;
            const angle = (arc.a0 + arc.a1) / 2;
            return (
              <RadiusGizmo
                center={arc.c}
                radius={arc.r}
                angle={angle}
                zoom={zoom}
                color="#f97316"
                tooltip="Drag to increase or decrease this lane's connector radius."
                onDrag={(delta, original) => dragLaneFilletRadius(selectedLane.armId, selectedLane.dir, selectedLane.laneIndex, fromAngle(angle), delta, original)}
              />
            );
          })()}

          {selectedBypass && bypassSegment?.geom.kind === 'polyline' && (() => {
            const points = bypassSegment.geom.points;
            const center = points[Math.floor(points.length / 2)];
            const direction = fromAngle(-Math.PI / 4);
            return (
              <RadiusGizmo
                center={center}
                radius={selectedBypass.radius}
                zoom={zoom}
                color="#16a34a"
                tooltip="Drag to change how broadly this direct right-turn lane curves."
                onDrag={(delta, original) => dragBypassRadius(selectedBypass.id, direction, delta, original)}
              />
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
                tooltip={activeArm.nodes.length > 2 ? 'Drag to move this road point. Click without dragging to delete it.' : 'Drag to move this road point. A road must keep at least two points.'}
                errorTooltip={errorTooltip}
                onDrag={(delta, original) => dragArmNode(activeArm.id, node.id, delta, original)}
                onClick={activeArm.nodes.length > 2 ? original => removeArmNode(original, activeArm.id, node.id) : undefined}
              />
            );
          })}
        </>
      )}
      {selectedLane && ringSnapPoint && (
        <Handle
          key="lane-ring-snap-handle"
          x={ringSnapPoint.x}
          y={ringSnapPoint.y}
          zoom={zoom}
          radius={5}
          fill="#f3e8ff"
          stroke="#7c3aed"
          dragType="lane-ring-snap"
          tooltip={`Drag to snap this lane's ${selectedLane.dir === 'in' ? 'target' : 'source'} to another ring.`}
          onDrag={(delta, original) => dragLaneRingTarget(selectedLane.armId, selectedLane.dir, selectedLane.laneIndex, ringSnapPoint, ringSnapPoints, delta, original)}
        />
      )}
    </g>
  );
};
