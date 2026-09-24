import React from 'react';
import { type RoundaboutConfig, type SelectionTarget } from '../config/types';
import { type Vec2, add, angleOf, fromAngle, scale, sub } from '../math/vector';
import { type Arc, arcPoint } from '../geometry/primitives';
import { screenToWorld } from '../viewport/transform';
import { useEditorStore } from '../editor/editorStore';
import { useHandleDrag } from './useHandleDrag';
import { dataKeys, type DragModifiers, type KeyHint } from '../ui/keyHints';

type Props = {
  center: Vec2;
  radius: number;
  zoom: number;
  color?: string;
  tooltip: string;
  arc?: Arc;
  /** Sensitivity vector handed to onDrag instead of the radial grab direction —
      for arcs whose center shifts as the radius changes (fillets, bypass
      connectors), this is the solved center-rate. */
  dragVector?: Vec2;
  keyHints?: KeyHint[];
  dragTarget?: SelectionTarget;
  duplicateOwner?: boolean;
  onDrag: (direction: Vec2, deltaWorld: Vec2, originalConfig: RoundaboutConfig, modifiers: DragModifiers, dragTarget?: SelectionTarget) => RoundaboutConfig;
};

function arcToPath(arc: Arc): string {
  const p0 = arcPoint(arc, arc.a0);
  const p1 = arcPoint(arc, arc.a1);
  const span = Math.abs(arc.a1 - arc.a0);
  const largeArc = span > Math.PI ? 1 : 0;
  const sweep = arc.dir === 1 ? 1 : 0;
  return `M ${p0.x} ${p0.y} A ${arc.r} ${arc.r} 0 ${largeArc} ${sweep} ${p1.x} ${p1.y}`;
}

// Clamp an absolute angle into the arc's swept range so the grab point always
// lands on the drawn arc rather than just past an endpoint.
function clampToArc(arc: Arc, angle: number): number {
  const twoPi = Math.PI * 2;
  const span = arc.a1 - arc.a0;
  let rel = (angle - arc.a0) % twoPi;
  if (arc.dir === 1) {
    if (rel < 0) rel += twoPi;
    return arc.a0 + Math.min(Math.max(rel, 0), span);
  }
  if (rel > 0) rel -= twoPi;
  return arc.a0 + Math.max(Math.min(rel, 0), span);
}

// A radius control rendered as a bare dashed ring/arc. The connector arm and
// grab dot stay hidden until the ring is hovered, then track the hover point
// along the curve; pressing anywhere on the curve starts the radius drag.
export const RadiusGizmo: React.FC<Props> = ({ center, radius, zoom, color = '#f97316', tooltip, arc, dragVector, keyHints, dragTarget, duplicateOwner, onDrag }) => {
  const drag = useEditorStore(state => state.drag);
  const isDragging = Boolean(drag?.active);
  const [hoverAngle, setHoverAngle] = React.useState<number | null>(null);
  const grabAngle = React.useRef<number | null>(null);

  React.useEffect(() => {
    if (isDragging) setHoverAngle(null);
    else grabAngle.current = null;
  }, [isDragging]);

  const clampAngle = (angle: number) => (arc ? clampToArc(arc, angle) : angle);
  const pointerAngle = (e: React.PointerEvent): number | null => {
    const svgEl = (e.currentTarget as Element).closest('svg');
    return svgEl ? clampAngle(angleOf(sub(screenToWorld(e, svgEl), center))) : null;
  };

  const { active, handlers } = useHandleDrag({
    zoom,
    dragTarget,
    duplicateOwner,
    onDragStart: (_modifiers, _original, startPoint) => {
      grabAngle.current = clampAngle(angleOf(sub(startPoint, center)));
    },
    onDrag: (delta, original, modifiers, target) =>
      onDrag(dragVector ?? fromAngle(grabAngle.current ?? -Math.PI / 4), delta, original, modifiers, target),
  });

  const grabbing = isDragging && grabAngle.current !== null;
  const activeAngle = isDragging ? grabAngle.current : hoverAngle;
  const hand = activeAngle !== null ? add(center, scale(fromAngle(activeAngle), radius)) : null;
  const dash = `${5 * zoom} ${4 * zoom}`;
  const hitProps = {
    fill: 'none',
    stroke: 'transparent',
    strokeWidth: 12 * zoom,
    pointerEvents: 'stroke' as const,
    cursor: active ? 'grabbing' : 'grab',
    'data-handle': 'true' as const,
    'data-tooltip': tooltip,
    'data-keys': keyHints?.length ? dataKeys(...keyHints) : undefined,
    ...handlers,
  };
  return (
    <g
      data-gizmo="radius"
      onPointerMove={e => {
        const angle = pointerAngle(e);
        if (angle !== null) setHoverAngle(angle);
      }}
      onPointerLeave={() => setHoverAngle(null)}
    >
      {/* Invisible fat hit-band: hover surface and drag initiator */}
      {arc
        ? <path d={arcToPath(arc)} {...hitProps} />
        : <circle cx={center.x} cy={center.y} r={radius} {...hitProps} />}
      {arc && isDragging && (
        <circle
          cx={center.x}
          cy={center.y}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={1.5 * zoom}
          strokeDasharray={dash}
          opacity={0.3}
          pointerEvents="none"
        />
      )}
      {arc ? (
        <path
          d={arcToPath(arc)}
          fill="none"
          stroke={color}
          strokeWidth={1.5 * zoom}
          strokeDasharray={dash}
          opacity={0.8}
          pointerEvents="none"
        />
      ) : (
        <circle
          cx={center.x}
          cy={center.y}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={1.5 * zoom}
          strokeDasharray={dash}
          opacity={0.8}
          pointerEvents="none"
        />
      )}
      {hand && (
        <g opacity={grabbing ? 0.9 : 0.5} pointerEvents="none">
          <line
            x1={center.x}
            y1={center.y}
            x2={hand.x}
            y2={hand.y}
            stroke={color}
            strokeWidth={1.5 * zoom}
          />
          <circle
            cx={hand.x}
            cy={hand.y}
            r={5 * zoom}
            fill="#fff7ed"
            stroke={color}
            strokeWidth={2 * zoom}
          />
        </g>
      )}
    </g>
  );
};
