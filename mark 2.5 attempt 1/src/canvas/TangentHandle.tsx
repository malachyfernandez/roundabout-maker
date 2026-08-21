import React from 'react';
import { type Vec2, add } from '../math/vector';
import { type RoundaboutConfig } from '../config/types';
import { Handle } from './Handle';

type Props = {
  anchor: Vec2;
  offset: Vec2;
  zoom: number;
  onDrag: (deltaWorld: Vec2, originalConfig: RoundaboutConfig) => RoundaboutConfig;
};

export const TangentHandle: React.FC<Props> = ({ anchor, offset, zoom, onDrag }) => {
  const position = add(anchor, offset);
  return (
    <g>
      <line
        x1={anchor.x}
        y1={anchor.y}
        x2={position.x}
        y2={position.y}
        stroke="#2563eb"
        strokeWidth={1.25 * zoom}
        opacity={0.8}
        pointerEvents="none"
      />
      <Handle
        x={position.x}
        y={position.y}
        zoom={zoom}
        radius={4}
        fill="#dbeafe"
        stroke="#2563eb"
        cursor="crosshair"
        tooltip="Drag to change the road's curve angle and tension at this point."
        onDrag={onDrag}
      />
    </g>
  );
};
