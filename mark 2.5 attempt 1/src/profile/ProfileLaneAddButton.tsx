import React from 'react';

const RADIUS = 6;
const PLUS = 2.7;
const HIT_RADIUS = 10;

export const ProfileLaneAddButton: React.FC<{ color: string; scale?: number; collapsed?: boolean; tooltip?: string }> = ({ color, scale = 1, collapsed = false, tooltip }) => {
  const [hovered, setHovered] = React.useState(false);

  // The button morphs into a dot while collapsed until hovered; the CSS
  // transition animates between the two forms.
  const shrunk = collapsed && !hovered;
  const r = shrunk ? RADIUS / 2 : RADIUS;

  return (
    <g transform={`scale(${scale})`}>
      <circle r={HIT_RADIUS} fill="transparent" data-handle="true" data-tooltip={tooltip} onPointerEnter={() => setHovered(true)} onPointerLeave={() => setHovered(false)} />
      <circle r={r} fill={color} pointerEvents="none" style={{ transition: 'all 160ms cubic-bezier(0.2, 1.45, 0.4, 1)' }} />
      <g pointerEvents="none" style={{ opacity: shrunk ? 0 : 1, transition: 'opacity 120ms ease-out' }}>
        <path d={`M ${-PLUS} 0 H ${PLUS} M 0 ${-PLUS} V ${PLUS}`} fill="none" stroke="#fff" strokeWidth={1.7} strokeLinecap="round" />
      </g>
    </g>
  );
};
