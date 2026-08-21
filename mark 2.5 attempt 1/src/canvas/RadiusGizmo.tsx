import React from 'react';
import { type RoundaboutConfig } from '../config/types';
import { type Vec2, add, fromAngle, scale } from '../math/vector';
import { Handle } from './Handle';

type Props = {
  center: Vec2;
  radius: number;
  angle?: number;
  zoom: number;
  color?: string;
  tooltip: string;
  onDrag: (deltaWorld: Vec2, originalConfig: RoundaboutConfig) => RoundaboutConfig;
};

export const RadiusGizmo: React.FC<Props> = ({ center, radius, angle = -Math.PI / 4, zoom, color = '#f97316', tooltip, onDrag }) => {
  const direction = fromAngle(angle);
  const endpoint = add(center, scale(direction, radius));
  return (
    <g data-gizmo="radius">
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
      <line
        x1={center.x}
        y1={center.y}
        x2={endpoint.x}
        y2={endpoint.y}
        stroke={color}
        strokeWidth={1.5 * zoom}
        pointerEvents="none"
      />
      <Handle
        x={endpoint.x}
        y={endpoint.y}
        zoom={zoom}
        radius={5}
        fill="#fff7ed"
        stroke={color}
        cursor="ew-resize"
        tooltip={tooltip}
        onDrag={onDrag}
      />
    </g>
  );
};
