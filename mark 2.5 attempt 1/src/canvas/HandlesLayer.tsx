import React from 'react';
import { isFeatureEnabled, useEditorStore } from '../editor/editorStore';
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
  dragRingCenter,
  dragRingRadius,
  dragRingWidth,
  dragTangentHandle,
  removeArmNode
} from '../editor/constraints';
import { getBezierSegment } from '../math/spline';
import { fromAngle, sub } from '../math/vector';
import { type ResolvedSegment } from '../core/solver';
import { type Arc } from '../geometry/primitives';

type Props = {
  zoom: number;
  segments: ResolvedSegment[];
};

export const HandlesLayer: React.FC<Props> = ({ zoom, segments }) => {
  const committedConfig = useEditorStore(state => state.committedConfig);
  const draftConfig = useEditorStore(state => state.draftConfig);
  const selection = useEditorStore(state => state.selection);
  const viewMode = useEditorStore(state => state.viewMode);
  const featureFlags = useEditorStore(state => state.featureFlags);
  const config = draftConfig || committedConfig;
  const gizmosEnabled = isFeatureEnabled(featureFlags, 'gizmos');
  const showIslandCenter = selection?.kind === 'island';
  const islandCenter = config.island.center ?? { x: 0, y: 0 };
  const activeArm = selection?.kind === 'arm' || (gizmosEnabled && selection?.kind === 'lane')
    ? config.arms.find(arm => arm.id === selection.armId)
    : null;
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

  return (
    <g>
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
          {gizmosEnabled && (
            <RadiusGizmo
              center={islandCenter}
              radius={config.island.radius}
              zoom={zoom}
              color="#2563eb"
              tooltip="Drag to change the center island radius."
              onDrag={(delta, original) => dragIslandRadius(fromAngle(-Math.PI / 4), delta, original)}
            />
          )}
        </>
      )}

      {gizmosEnabled && selectedRing && (
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

      {gizmosEnabled && selectedLane && laneRing && (
        <>
          <line
            x1={laneRing.center.x}
            y1={laneRing.center.y}
            x2={laneRing.center.x + 18 * zoom}
            y2={laneRing.center.y - 18 * zoom}
            stroke="#7c3aed"
            strokeWidth={1.5 * zoom}
            strokeDasharray={`${3 * zoom} ${3 * zoom}`}
            pointerEvents="none"
          />
          <Handle
            x={laneRing.center.x}
            y={laneRing.center.y}
            zoom={zoom}
            radius={5}
            fill="#f3e8ff"
            stroke="#7c3aed"
            tooltip={`Drag to snap this lane's ${selectedLane.dir === 'in' ? 'target' : 'source'} to another ring.`}
            onDrag={(delta, original) => dragLaneRingTarget(selectedLane.armId, selectedLane.dir, selectedLane.laneIndex, delta, original)}
          />
          {selectedLane.dir === 'out' && (
            <Handle
              x={laneRing.center.x + 18 * zoom}
              y={laneRing.center.y - 18 * zoom}
              zoom={zoom}
              radius={4.5}
              fill={activeArm?.lanesOut[selectedLane.laneIndex]?.dropsRing ? '#fef3c7' : '#fff'}
              stroke="#d97706"
              cursor="pointer"
              tooltip="Click to toggle whether this exit drops the remainder of its source ring."
              onDrag={(_delta, original) => original}
              onClick={original => {
                const next = structuredClone(original);
                const arm = next.arms.find(candidate => candidate.id === selectedLane.armId);
                if (arm?.lanesOut[selectedLane.laneIndex]) arm.lanesOut[selectedLane.laneIndex].dropsRing = !arm.lanesOut[selectedLane.laneIndex].dropsRing;
                return next;
              }}
            />
          )}
        </>
      )}

      {gizmosEnabled && selectedLane && filletSegment?.geom.kind === 'arc' && (() => {
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

      {gizmosEnabled && selectedBypass && bypassSegment?.geom.kind === 'polyline' && (() => {
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

      {activeArm && activeArm.nodes.flatMap((node, index) => {
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

      {activeArm && activeArm.nodes.map(node => (
        <Handle
          key={node.id}
          x={node.point.x}
          y={node.point.y}
          zoom={zoom}
          cursor="move"
          fill="#fff"
          stroke="#2563eb"
          tooltip={gizmosEnabled && activeArm.nodes.length > 2 ? 'Drag to move this road point. Click without dragging to delete it.' : 'Drag to move this road point. A road must keep at least two points.'}
          onDrag={(delta, original) => dragArmNode(activeArm.id, node.id, delta, original)}
          onClick={gizmosEnabled && activeArm.nodes.length > 2 ? original => removeArmNode(original, activeArm.id, node.id) : undefined}
        />
      ))}
    </g>
  );
};
