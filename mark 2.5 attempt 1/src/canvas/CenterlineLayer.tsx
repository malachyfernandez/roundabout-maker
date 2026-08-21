import React, { useRef } from 'react';
import { type ArmConfig, type RoundaboutConfig } from '../config/types';
import { dragArmNode, insertArmNode } from '../editor/constraints';
import { useEditorStore } from '../editor/editorStore';
import { evaluateSpline, splineToSvgPath, type CatmullRomSpline } from '../math/spline';
import { type Vec2, dot, len, sub } from '../math/vector';
import { screenToWorld } from '../viewport/transform';

type CenterlineProps = {
  arm: ArmConfig;
  zoom: number;
  selected: boolean;
};

function makeSpline(arm: ArmConfig): CatmullRomSpline {
  return { points: arm.nodes.map(node => node.point), nodes: arm.nodes, alpha: 0.5, tension: 0 };
}

function projectOntoSpline(spline: CatmullRomSpline, point: Vec2) {
  const steps = Math.max(64, (spline.nodes?.length ?? spline.points.length) * 64);
  let previous = evaluateSpline(spline, 0).p;
  let best = { t: 0, distance: len(sub(point, previous)) };
  for (let i = 1; i <= steps; i++) {
    const current = evaluateSpline(spline, i / steps).p;
    const edge = sub(current, previous);
    const edgeLengthSquared = dot(edge, edge);
    const local = edgeLengthSquared > 0 ? Math.max(0, Math.min(1, dot(sub(point, previous), edge) / edgeLengthSquared)) : 0;
    const projected = { x: previous.x + edge.x * local, y: previous.y + edge.y * local };
    const distance = len(sub(point, projected));
    if (distance < best.distance) best = { t: (i - 1 + local) / steps, distance };
    previous = current;
  }
  return best.t;
}

const ArmCenterline: React.FC<CenterlineProps> = ({ arm, zoom, selected }) => {
  const committedConfig = useEditorStore(state => state.committedConfig);
  const setDraftConfig = useEditorStore(state => state.setDraftConfig);
  const commitDraft = useEditorStore(state => state.commitDraft);
  const setDrag = useEditorStore(state => state.setDrag);
  const startPoint = useRef<Vec2 | null>(null);
  const insertedConfig = useRef<RoundaboutConfig | null>(null);
  const insertedNodeId = useRef<string | null>(null);
  const spline = makeSpline(arm);
  const d = splineToSvgPath(spline);

  const handlePointerDown = (event: React.PointerEvent<SVGPathElement>) => {
    if (!selected || arm.nodes.length < 2) return;
    event.stopPropagation();
    const svg = event.currentTarget.closest('svg');
    if (!svg) return;
    const pointer = screenToWorld(event, svg);
    const globalT = projectOntoSpline(spline, pointer);
    const segmentCount = arm.nodes.length - 1;
    const scaledT = globalT * segmentCount;
    const segmentIndex = Math.min(Math.floor(scaledT), segmentCount - 1);
    const localT = Math.max(0.001, Math.min(0.999, scaledT - segmentIndex));
    const nodeId = `node_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    const next = insertArmNode(committedConfig, arm.id, segmentIndex, localT, nodeId);
    startPoint.current = pointer;
    insertedConfig.current = next;
    insertedNodeId.current = nodeId;
    setDraftConfig(next);
    setDrag({ active: true, type: 'insert-node' });
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: React.PointerEvent<SVGPathElement>) => {
    if (!startPoint.current || !insertedConfig.current || !insertedNodeId.current) return;
    const svg = event.currentTarget.closest('svg');
    if (!svg) return;
    const pointer = screenToWorld(event, svg);
    setDraftConfig(dragArmNode(arm.id, insertedNodeId.current, sub(pointer, startPoint.current), insertedConfig.current));
  };

  const handlePointerUp = (event: React.PointerEvent<SVGPathElement>) => {
    if (!insertedNodeId.current) return;
    commitDraft();
    startPoint.current = null;
    insertedConfig.current = null;
    insertedNodeId.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
  };

  return (
    <g>
      <path
        d={d}
        fill="none"
        stroke={selected ? '#2563eb' : 'rgba(37, 99, 235, 0.42)'}
        strokeWidth={(selected ? 2 : 1.25) * zoom}
        strokeDasharray={selected ? undefined : `${5 * zoom} ${5 * zoom}`}
        pointerEvents="none"
      />
      <path
        d={d}
        fill="none"
        stroke="transparent"
        strokeWidth={14 * zoom}
        pointerEvents="stroke"
        cursor={selected ? 'copy' : 'pointer'}
        data-target={selected ? undefined : JSON.stringify({ kind: 'arm', armId: arm.id })}
        data-handle={selected ? 'true' : undefined}
        data-tooltip={selected ? 'Click to add a road point, or drag immediately to place it.' : `Select road ${arm.id}.`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      />
    </g>
  );
};

type Props = {
  config: RoundaboutConfig;
  zoom: number;
};

export const CenterlineLayer: React.FC<Props> = ({ config, zoom }) => {
  const selection = useEditorStore(state => state.selection);
  const viewMode = useEditorStore(state => state.viewMode);
  if (viewMode !== 'preview') return null;
  return (
    <g>
      {config.arms.map(arm => (
        <ArmCenterline
          key={arm.id}
          arm={arm}
          zoom={zoom}
          selected={selection?.kind === 'arm' && selection.armId === arm.id}
        />
      ))}
    </g>
  );
};
