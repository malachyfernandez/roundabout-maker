import React, { useRef } from 'react';
import { type Vec2, sub } from '../math/vector';
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
  onDrag: (deltaWorld: Vec2, originalConfig: RoundaboutConfig) => RoundaboutConfig;
};

export const Handle: React.FC<Props> = ({ x, y, zoom, cursor = 'grab', radius = 6, fill = '#fff', stroke = '#000', onDrag }) => {
  const setDraftConfig = useEditorStore(state => state.setDraftConfig);
  const commitDraft = useEditorStore(state => state.commitDraft);
  const committedConfig = useEditorStore(state => state.committedConfig);
  const setDrag = useEditorStore(state => state.setDrag);

  const startPt = useRef<Vec2 | null>(null);
  const startConfig = useRef<RoundaboutConfig | null>(null);

  const handlePointerDown = (e: React.PointerEvent) => {
    e.stopPropagation(); // prevent Viewport from capturing
    e.currentTarget.setPointerCapture(e.pointerId);
    
    const svgEl = (e.currentTarget as Element).closest('svg');
    if (!svgEl) return;

    startPt.current = screenToWorld(e, svgEl);
    startConfig.current = JSON.parse(JSON.stringify(committedConfig));
    setDrag({ active: true, type: 'handle' });
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!startPt.current || !startConfig.current) return;
    
    const svgEl = (e.currentTarget as Element).closest('svg');
    if (!svgEl) return;

    const currentPt = screenToWorld(e, svgEl);
    const delta = sub(currentPt, startPt.current);
    
    const newConfig = onDrag(delta, startConfig.current);
    setDraftConfig(newConfig);
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (startPt.current) {
      commitDraft();
      startPt.current = null;
      startConfig.current = null;
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  };

  const r = radius * zoom;
  return (
    <circle
      cx={x}
      cy={y}
      r={r}
      fill={fill}
      stroke={stroke}
      strokeWidth={2 * zoom}
      cursor={startPt.current ? 'grabbing' : cursor}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      data-handle="true"
    />
  );
};
