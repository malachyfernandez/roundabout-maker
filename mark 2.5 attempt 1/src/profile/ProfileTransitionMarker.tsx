import React from 'react';

const FONT_SIZE = 6;
const PAD_X = 4;
const PAD_Y = 2.5;
const STROKE_WIDTH = 1.1;
const CHAR_WIDTH = FONT_SIZE * 0.62;
const HIT_HEIGHT = 14;
const CIRCLE_RADIUS = 5;

function pillSize(label: string) {
  const width = label.length * CHAR_WIDTH + 2 * PAD_X;
  const height = FONT_SIZE + 2 * PAD_Y;
  return { width, height };
}

export const ProfileTransitionMarker: React.FC<{ added: boolean; tooltip: string; scale?: number; color?: string; dragging?: boolean; snapped?: boolean }> = ({ added, tooltip, scale = 1, color = '#9747FF', dragging = false, snapped = false }) => {
  const label = added ? 'START' : 'END';
  const { width, height } = pillSize(label);
  const w = width * scale;
  const h = height * scale;
  const cr = CIRCLE_RADIUS * scale;

  // When dragging, collapse the pill into a circle and hide the text.
  // Use CSS transitions on the rect for a smooth morph.
  const targetW = dragging ? cr * 2 : w;
  const targetH = dragging ? cr * 2 : h;
  const targetRx = dragging ? cr : h / 2;
  const textOpacity = dragging ? 0 : 1;

  return (
    <>
      <rect x={-Math.max(targetW, w) / 2} y={-(HIT_HEIGHT * scale) / 2} width={Math.max(targetW, w)} height={HIT_HEIGHT * scale} fill="transparent" data-handle="true" data-tooltip={tooltip} />
      <rect
        x={-targetW / 2}
        y={-targetH / 2}
        width={targetW}
        height={targetH}
        rx={targetRx}
        ry={targetRx}
        fill={snapped ? '#dcfce7' : '#fff'}
        stroke={color}
        strokeWidth={STROKE_WIDTH * scale}
        pointerEvents="none"
        style={{
          transition: 'all 160ms cubic-bezier(0.2, 1.45, 0.4, 1)',
        }}
      />
      <text
        x={0}
        y={0}
        fill={color}
        fontSize={FONT_SIZE * scale}
        fontWeight={800}
        fontFamily="Poppins, system-ui, sans-serif"
        textAnchor="middle"
        dominantBaseline="central"
        pointerEvents="none"
        style={{
          opacity: textOpacity,
          transition: 'opacity 120ms ease-out',
        }}
      >
        {label}
      </text>
    </>
  );
};
