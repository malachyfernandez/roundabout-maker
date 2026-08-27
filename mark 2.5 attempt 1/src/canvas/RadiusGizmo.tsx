import React from 'react';
import { type RoundaboutConfig } from '../config/types';
import { type Vec2, add, fromAngle, scale } from '../math/vector';
import { type Arc, arcPoint } from '../geometry/primitives';
import { Handle } from './Handle';
import { useEditorStore } from '../editor/editorStore';

type Props = {
  center: Vec2;
  radius: number;
  angle?: number;
  zoom: number;
  color?: string;
  tooltip: string;
  handleAtCenter?: boolean;
  arc?: Arc;
  onDrag: (deltaWorld: Vec2, originalConfig: RoundaboutConfig) => RoundaboutConfig;
};

function arcToPath(arc: Arc): string {
  const p0 = arcPoint(arc, arc.a0);
  const p1 = arcPoint(arc, arc.a1);
  const span = Math.abs(arc.a1 - arc.a0);
  const largeArc = span > Math.PI ? 1 : 0;
  const sweep = arc.dir === 1 ? 1 : 0;
  return `M ${p0.x} ${p0.y} A ${arc.r} ${arc.r} 0 ${largeArc} ${sweep} ${p1.x} ${p1.y}`;
}

export const RadiusGizmo: React.FC<Props> = ({ center, radius, angle = -Math.PI / 4, zoom, color = '#f97316', tooltip, handleAtCenter = false, arc, onDrag }) => {
  const drag = useEditorStore(state => state.drag);
  const isDragging = Boolean(drag?.active);
  const direction = fromAngle(angle);
  const endpoint = add(center, scale(direction, radius));
  const hasArc = Boolean(arc);
  const arcMidPoint = arc ? arcPoint(arc, (arc.a0 + arc.a1) / 2) : endpoint;
  const lineTarget = hasArc ? arcMidPoint : endpoint;
  return (
    <g data-gizmo="radius">
      {hasArc && isDragging && (
        <circle
          cx={center.x}
          cy={center.y}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={1.5 * zoom}
          strokeDasharray={`${5 * zoom} ${4 * zoom}`}
          opacity={0.3}
          pointerEvents="none"
        />
      )}
      {!hasArc && (
        <circle
          cx={center.x}
          cy={center.y}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={1.5 * zoom}
          strokeDasharray={`${5 * zoom} ${4 * zoom}`}
          opacity={0.8}
          pointerEvents="none"
        />
      )}
      {hasArc && arc && (
        <path
          d={arcToPath(arc)}
          fill="none"
          stroke={color}
          strokeWidth={1.5 * zoom}
          strokeDasharray={`${5 * zoom} ${4 * zoom}`}
          opacity={0.8}
          pointerEvents="none"
        />
      )}
      <line
        x1={center.x}
        y1={center.y}
        x2={lineTarget.x}
        y2={lineTarget.y}
        stroke={color}
        strokeWidth={1.5 * zoom}
        pointerEvents="none"
      />
      <Handle
        x={handleAtCenter ? center.x : endpoint.x}
        y={handleAtCenter ? center.y : endpoint.y}
        zoom={zoom}
        radius={5}
        fill="#fff7ed"
        stroke={color}
        cursor={handleAtCenter ? 'move' : 'ew-resize'}
        tooltip={tooltip}
        onDrag={onDrag}
      />
    </g>
  );
};
