import React from 'react';
import { type Vec2 } from '../math/vector';
import { type RoundaboutConfig, type SelectionTarget } from '../config/types';
import { dataKeys, type DragModifiers, type KeyHint } from '../ui/keyHints';
import { useHandleDrag } from './useHandleDrag';

type Props = {
  x: number;
  y: number;
  zoom: number;
  cursor?: string;
  radius?: number;
  fill?: string;
  stroke?: string;
  shape?: 'circle' | 'square';
  icon?: React.ReactNode;
  tooltip?: string;
  errorTooltip?: string;
  keyHints?: KeyHint[];
  dragType?: string;
  dragTarget?: SelectionTarget;
  duplicateOwner?: boolean;
  followPointer?: boolean;
  springDrag?: boolean;
  resolveDragPosition?: (rawPosition: Vec2, originalConfig: RoundaboutConfig, modifiers: DragModifiers) => Vec2;
  onDragStart?: (modifiers: DragModifiers, originalConfig: RoundaboutConfig, startPoint: Vec2) => void;
  onDrag: (deltaWorld: Vec2, originalConfig: RoundaboutConfig, modifiers: DragModifiers, dragTarget?: SelectionTarget) => RoundaboutConfig;
  onDragEnd?: (deltaWorld: Vec2, originalConfig: RoundaboutConfig, clientPoint: Vec2, modifiers: DragModifiers, dragTarget?: SelectionTarget) => RoundaboutConfig | null;
  onDragCancel?: () => void;
  onClick?: (originalConfig: RoundaboutConfig) => RoundaboutConfig;
};

export const Handle: React.FC<Props> = ({ x, y, zoom, cursor = 'grab', radius = 6, fill = '#fff', stroke = '#000', shape = 'circle', icon, tooltip, errorTooltip, keyHints, dragType, dragTarget, duplicateOwner = false, followPointer = false, springDrag = false, resolveDragPosition, onDragStart, onDrag, onDragEnd, onDragCancel, onClick }) => {
  const { active, dragOffset, handlers } = useHandleDrag({
    zoom,
    position: { x, y },
    dragType,
    dragTarget,
    duplicateOwner,
    followPointer,
    resolveDragPosition,
    onDragStart,
    onDrag,
    onDragEnd,
    onDragCancel,
    onClick,
  });

  const r = radius * zoom;
  const commonProps = {
    fill,
    stroke,
    strokeWidth: 2 * zoom,
    cursor: active ? 'grabbing' : cursor,
    ...handlers,
    'data-handle': 'true' as const,
    'data-tooltip': tooltip,
    'data-tooltip-error': errorTooltip,
    'data-keys': keyHints?.length ? dataKeys(...keyHints) : undefined,
  };
  const dragFx = {
    transform: followPointer ? `translate(${dragOffset.x} ${dragOffset.y})` : undefined,
    style: springDrag ? { transition: 'transform 110ms cubic-bezier(0.2, 1.45, 0.4, 1)' } : undefined,
  };
  const shapeEl = shape === 'square' ? (
    <rect
      x={x - r}
      y={y - r}
      width={r * 2}
      height={r * 2}
      rx={r * 0.2}
      {...commonProps}
      {...(icon ? {} : dragFx)}
    />
  ) : (
    <circle
      cx={x}
      cy={y}
      r={r}
      {...commonProps}
      {...(icon ? {} : dragFx)}
    />
  );
  if (!icon) return shapeEl;
  return (
    <g {...dragFx}>
      {shapeEl}
      <g transform={`translate(${x} ${y}) scale(${(r * 2) / 24}) translate(-12 -12)`} pointerEvents="none">
        {icon}
      </g>
    </g>
  );
};
