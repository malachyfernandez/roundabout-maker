import React from 'react';
import { MOVEMENT_POINTER_PATH, WIDTH_POINTER_PATH } from './controlAppearance';

export const ProfileControlIcon: React.FC<{ kind: 'gap' | 'width'; color: string; transform: string }> = ({ kind, color, transform }) => (
  <path d={kind === 'gap' ? MOVEMENT_POINTER_PATH : WIDTH_POINTER_PATH} transform={transform} fill="#fff" stroke={color} strokeWidth=".8" pointerEvents="none" />
);
