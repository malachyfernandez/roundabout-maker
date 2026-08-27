import React from 'react';
import startIcon from '../assets/iconstartend/start.svg';
import endIcon from '../assets/iconstartend/end.svg';

const REFERENCE_SCALE = 15 / 35;
const ICON_WIDTH = 96 * REFERENCE_SCALE;
const ICON_HEIGHT = 37 * REFERENCE_SCALE;

export const ProfileTransitionMarker: React.FC<{ added: boolean; tooltip: string; scale?: number }> = ({ added, tooltip, scale = 1 }) => (
  <>
    <rect x={-ICON_WIDTH * scale / 2} y={-9 * scale} width={ICON_WIDTH * scale} height={18 * scale} fill="transparent" data-handle="true" data-tooltip={tooltip} />
    <image href={added ? startIcon : endIcon} x={-ICON_WIDTH * scale / 2} y={-ICON_HEIGHT * scale / 2} width={ICON_WIDTH * scale} height={ICON_HEIGHT * scale} pointerEvents="none" />
  </>
);
