import React from 'react';

export const ProfileTransitionMarker: React.FC<{ added: boolean; color: string; scale?: number }> = ({ added, color, scale = 1 }) => (
  <>
    <path d={`M 0 ${-7.5 * scale} L ${7.5 * scale} 0 L 0 ${7.5 * scale} L ${-7.5 * scale} 0 Z`} fill="#fff" stroke={color} strokeWidth={1.5 * scale} strokeLinejoin="round" pointerEvents="none" />
    <path d={added ? `M ${-2 * scale} 0 H ${2 * scale} M 0 ${-2 * scale} V ${2 * scale}` : `M ${-2 * scale} 0 H ${2 * scale}`} fill="none" stroke={color} strokeWidth={1.5 * scale} strokeLinecap="round" pointerEvents="none" />
  </>
);
