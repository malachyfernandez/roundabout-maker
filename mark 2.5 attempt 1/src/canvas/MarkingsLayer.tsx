import React from 'react';
import { type RoundaboutConfig } from '../config/types';
import { type ResolvedSegment } from '../core/solver';
import { buildMarkings } from '../rendering/markings';

type Props = {
  config: RoundaboutConfig;
  segments: ResolvedSegment[];
  zoom: number;
};

function pathData(points: { x: number; y: number }[], close = false) {
  if (points.length === 0) return '';
  return `M ${points.map(point => `${point.x} ${point.y}`).join(' L ')}${close ? ' Z' : ''}`;
}

export const MarkingsLayer: React.FC<Props> = React.memo(({ config, segments, zoom }) => {
  const markings = React.useMemo(() => buildMarkings(config, segments), [config, segments]);
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
          strokeWidth={marking.width * zoom}
          strokeDasharray={marking.dash ? marking.dash.split(' ').map(value => Number(value) * zoom).join(' ') : undefined}
          strokeLinecap="butt"
          strokeLinejoin="round"
          data-marking-rule={marking.rule}
        />
      ))}
    </g>
  );
});
