import React from 'react';
import { type RoundaboutConfig } from '../config/types';
import { type ResolvedSegment } from '../core/solver';
import { buildMarkings } from '../rendering/markings';
import { useEditorStore } from '../editor/editorStore';
import { boundsIntersect, markingBounds, offsetBounds, type Bounds } from '../rendering/bounds';

type Props = {
  config: RoundaboutConfig;
  segments: ResolvedSegment[];
  defer: boolean;
  visibleBounds: Bounds;
};

function pathData(points: { x: number; y: number }[], close = false) {
  if (points.length === 0) return '';
  return `M ${points.map(point => `${point.x} ${point.y}`).join(' L ')}${close ? ' Z' : ''}`;
}

export const MarkingsLayer: React.FC<Props> = React.memo(({ config, segments, defer, visibleBounds }) => {
  const collisionBuffer = useEditorStore(state => state.settings.ringLaneCollisionBuffer);
  const widthScale = useEditorStore(state => state.settings.roadMarkingWidthScale);
  const yieldSetback = useEditorStore(state => state.settings.yieldSetback);
  const settledInput = React.useRef({ config, segments });
  React.useEffect(() => {
    if (!defer) settledInput.current = { config, segments };
  }, [config, defer, segments]);
  const renderedConfig = defer ? settledInput.current.config : config;
  const renderedSegments = defer ? settledInput.current.segments : segments;
  const markings = React.useMemo(() => buildMarkings(renderedConfig, renderedSegments, { ringLaneCollisionBuffer: collisionBuffer, yieldSetback }), [collisionBuffer, renderedConfig, renderedSegments, yieldSetback]);
  const renderData = React.useMemo(() => markings.map(marking => ({
    marking,
    bounds: markingBounds(marking, widthScale),
    d: pathData(marking.points, marking.kind === 'fill')
  })), [markings, widthScale]);
  const localVisibleBounds = React.useMemo(() => offsetBounds(visibleBounds, { x: -renderedConfig.island.center.x, y: -renderedConfig.island.center.y }), [renderedConfig.island.center.x, renderedConfig.island.center.y, visibleBounds]);
  const visibleRenderData = React.useMemo(() => renderData.filter(item => boundsIntersect(item.bounds, localVisibleBounds)), [localVisibleBounds, renderData]);
  return (
    <g transform={`translate(${renderedConfig.island.center.x || 0}, ${renderedConfig.island.center.y || 0})`} pointerEvents="none" data-markings-layer="semantic">
      {visibleRenderData.map(({ marking, d }) => marking.kind === 'fill' ? (
        <path
          key={marking.id}
          d={d}
          fill={marking.color}
          stroke="none"
          data-marking-rule={marking.rule}
        />
      ) : (
        <path
          key={marking.id}
          d={d}
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
