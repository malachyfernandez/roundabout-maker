import React from 'react';
import { type RoundaboutConfig } from '../config/types';
import { type ResolvedSegment } from '../core/solver';
import { buildMarkings } from '../rendering/markings';
import { useEditorStore } from '../editor/editorStore';

type Props = {
  config: RoundaboutConfig;
  segments: ResolvedSegment[];
};

function pathData(points: { x: number; y: number }[], close = false) {
  if (points.length === 0) return '';
  return `M ${points.map(point => `${point.x} ${point.y}`).join(' L ')}${close ? ' Z' : ''}`;
}

export const MarkingsLayer: React.FC<Props> = React.memo(({ config, segments }) => {
  const collisionBuffer = useEditorStore(state => state.settings.ringLaneCollisionBuffer);
  const widthScale = useEditorStore(state => state.settings.roadMarkingWidthScale);
  const markings = React.useMemo(() => buildMarkings(config, segments, { ringLaneCollisionBuffer: collisionBuffer }), [collisionBuffer, config, segments]);
  return (
    <g transform={`translate(${config.island.center.x || 0}, ${config.island.center.y || 0})`} pointerEvents="none" data-markings-layer="semantic">
      {markings.map(marking => marking.kind === 'fill' ? (
        <path
          key={marking.id}
          d={pathData(marking.points, true)}
          fill={marking.color}
          stroke="none"
          data-marking-rule={marking.rule}
        />
      ) : (
        <path
          key={marking.id}
          d={pathData(marking.points)}
          fill="none"
          stroke={marking.color}
          strokeWidth={marking.width * widthScale}
          strokeDasharray={marking.dash}
          strokeLinecap="butt"
          strokeLinejoin="round"
          data-marking-rule={marking.rule}
        />
      ))}
    </g>
  );
});
