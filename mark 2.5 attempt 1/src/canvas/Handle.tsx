import React, { useRef, useState } from 'react';
import { type Vec2, add, len, sub } from '../math/vector';
import { screenToWorld } from '../viewport/transform';
import { useEditorStore } from '../editor/editorStore';
import { type RoundaboutConfig } from '../config/types';

type Props = {
  x: number;
  y: number;
  zoom: number;
  cursor?: string;
  radius?: number;
  fill?: string;
  stroke?: string;
  shape?: 'circle' | 'square';
  tooltip?: string;
  errorTooltip?: string;
  dragType?: string;
  followPointer?: boolean;
  springDrag?: boolean;
  resolveDragPosition?: (rawPosition: Vec2, originalConfig: RoundaboutConfig) => Vec2;
  onDragStart?: () => void;
  onDrag: (deltaWorld: Vec2, originalConfig: RoundaboutConfig) => RoundaboutConfig;
  onDragEnd?: (deltaWorld: Vec2, originalConfig: RoundaboutConfig, clientPoint: Vec2) => RoundaboutConfig | null;
  onDragCancel?: () => void;
  onClick?: (originalConfig: RoundaboutConfig) => RoundaboutConfig;
};

export const Handle: React.FC<Props> = ({ x, y, zoom, cursor = 'grab', radius = 6, fill = '#fff', stroke = '#000', shape = 'circle', tooltip, errorTooltip, dragType = 'handle', followPointer = false, springDrag = false, resolveDragPosition, onDragStart, onDrag, onDragEnd, onDragCancel, onClick }) => {
  const setDraftConfig = useEditorStore(state => state.setDraftConfig);
  const commitDraft = useEditorStore(state => state.commitDraft);
  const committedConfig = useEditorStore(state => state.committedConfig);
  const setCommittedConfig = useEditorStore(state => state.setCommittedConfig);
  const setDrag = useEditorStore(state => state.setDrag);

  const startPt = useRef<Vec2 | null>(null);
  const startConfig = useRef<RoundaboutConfig | null>(null);
  const moved = useRef(false);
  const latestDelta = useRef<Vec2>({ x: 0, y: 0 });
  const [dragOffset, setDragOffset] = useState<Vec2>({ x: 0, y: 0 });

  const handlePointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation(); // prevent Viewport from capturing
    e.currentTarget.setPointerCapture(e.pointerId);
    
    const svgEl = (e.currentTarget as Element).closest('svg');
    if (!svgEl) return;

    startPt.current = screenToWorld(e, svgEl);
    startConfig.current = JSON.parse(JSON.stringify(committedConfig));
    moved.current = false;
    latestDelta.current = { x: 0, y: 0 };
    setDragOffset({ x: 0, y: 0 });
    onDragStart?.();
    setDrag({ active: true, type: dragType });
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!startPt.current || !startConfig.current) return;
    
    const svgEl = (e.currentTarget as Element).closest('svg');
    if (!svgEl) return;

    const currentPt = screenToWorld(e, svgEl);
    const delta = sub(currentPt, startPt.current);
    latestDelta.current = delta;
    if (followPointer) {
      const rawPosition = add({ x, y }, delta);
      const resolvedPosition = resolveDragPosition?.(rawPosition, startConfig.current) ?? rawPosition;
      setDragOffset(sub(resolvedPosition, { x, y }));
    }
    if (len(delta) > 2 * zoom) moved.current = true;
    
    const newConfig = onDrag(delta, startConfig.current);
    setDraftConfig(newConfig);
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (startPt.current && startConfig.current) {
      if (!moved.current && onClick) {
        setDraftConfig(null);
        setCommittedConfig(onClick(startConfig.current));
        setDrag(null);
      } else if (moved.current && onDragEnd) {
        const result = onDragEnd(latestDelta.current, startConfig.current, { x: e.clientX, y: e.clientY });
        setDraftConfig(null);
        if (result) setCommittedConfig(result);
        setDrag(null);
      } else if (moved.current) {
        commitDraft();
      } else {
        setDraftConfig(null);
        setDrag(null);
      }
      startPt.current = null;
      startConfig.current = null;
      latestDelta.current = { x: 0, y: 0 };
      setDragOffset({ x: 0, y: 0 });
      if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    }
  };

  const handlePointerCancel = (e: React.PointerEvent) => {
    setDraftConfig(null);
    setDrag(null);
    startPt.current = null;
    startConfig.current = null;
    latestDelta.current = { x: 0, y: 0 };
    setDragOffset({ x: 0, y: 0 });
    onDragCancel?.();
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  };

  const handleLostPointerCapture = () => {
    if (!startPt.current) return;
    setDraftConfig(null);
    setDrag(null);
    startPt.current = null;
    startConfig.current = null;
    latestDelta.current = { x: 0, y: 0 };
    setDragOffset({ x: 0, y: 0 });
    onDragCancel?.();
  };

  const r = radius * zoom;
  const commonProps = {
    fill,
    stroke,
    strokeWidth: 2 * zoom,
    cursor: startPt.current ? 'grabbing' : cursor,
    onPointerDown: handlePointerDown,
    onPointerMove: handlePointerMove,
    onPointerUp: handlePointerUp,
    onPointerCancel: handlePointerCancel,
    onLostPointerCapture: handleLostPointerCapture,
    transform: followPointer ? `translate(${dragOffset.x} ${dragOffset.y})` : undefined,
    style: springDrag ? { transition: 'transform 110ms cubic-bezier(0.2, 1.45, 0.4, 1)' } : undefined,
    'data-handle': 'true' as const,
    'data-tooltip': tooltip,
    'data-tooltip-error': errorTooltip,
  };
  if (shape === 'square') {
    return (
      <rect
        x={x - r}
        y={y - r}
        width={r * 2}
        height={r * 2}
        rx={r * 0.2}
        {...commonProps}
      />
    );
  }
  return (
    <circle
      cx={x}
      cy={y}
      r={r}
      {...commonProps}
    />
  );
};
