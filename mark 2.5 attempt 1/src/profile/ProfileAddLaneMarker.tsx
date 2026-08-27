import React from 'react';

export const ProfileAddLaneMarker: React.FC<{ color: string; scale?: number }> = ({ color, scale = 1 }) => (
  <>
    <circle r={6 * scale} fill={color} pointerEvents="none" />
    <path d={`M ${-2.7 * scale} 0 H ${2.7 * scale} M 0 ${-2.7 * scale} V ${2.7 * scale}`} fill="none" stroke="#fff" strokeWidth={1.7 * scale} strokeLinecap="round" pointerEvents="none" />
  </>
);
