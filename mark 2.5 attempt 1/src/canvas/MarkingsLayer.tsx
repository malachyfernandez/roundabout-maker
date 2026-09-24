import React from 'react';
import { type RoundaboutConfig } from '../config/types';
import { type ResolvedSegment } from '../core/solver';
import { buildMarkings } from '../rendering/markings';
import { useEditorStore } from '../editor/editorStore';
import { focusedArmIds } from '../editor/selection';
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
  const selections = useEditorStore(state => state.selections);
  const selection = useEditorStore(state => state.selection);
  const collisionBuffer = useEditorStore(state => state.settings.ringLaneCollisionBuffer);
  const widthScale = useEditorStore(state => state.settings.roadMarkingWidthScale);
  const lineWidth = useEditorStore(state => state.settings.roadMarkingLineWidth);
  const shortDashLength = useEditorStore(state => state.settings.shortDashLength);
  const shortDashGap = useEditorStore(state => state.settings.shortDashGap);
  const longDashLength = useEditorStore(state => state.settings.longDashLength);
  const longDashGap = useEditorStore(state => state.settings.longDashGap);
  const dividerSolidLength = useEditorStore(state => state.settings.dividerSolidLength);
  const dividerDottedLength = useEditorStore(state => state.settings.dividerDottedLength);
  const yieldSetback = useEditorStore(state => state.settings.yieldSetback);
  const settledInput = React.useRef({ config, segments });
  React.useEffect(() => {
    if (!defer) settledInput.current = { config, segments };
  }, [config, defer, segments]);
  const renderedConfig = defer ? settledInput.current.config : config;
  const renderedSegments = defer ? settledInput.current.segments : segments;
  const markings = React.useMemo(() => buildMarkings(renderedConfig, renderedSegments, { ringLaneCollisionBuffer: collisionBuffer, yieldSetback, lineWidth, shortDashLength, shortDashGap, longDashLength, longDashGap, dividerSolidLength, dividerDottedLength }), [collisionBuffer, dividerDottedLength, dividerSolidLength, lineWidth, longDashGap, longDashLength, renderedConfig, renderedSegments, shortDashGap, shortDashLength, yieldSetback]);
  const renderData = React.useMemo(() => markings.map(marking => ({
    marking,
    bounds: markingBounds(marking, widthScale),
    d: pathData(marking.points, marking.kind === 'fill')
  })), [markings, widthScale]);
  const localVisibleBounds = React.useMemo(() => offsetBounds(visibleBounds, { x: -renderedConfig.island.center.x, y: -renderedConfig.island.center.y }), [renderedConfig.island.center.x, renderedConfig.island.center.y, visibleBounds]);
  const visibleRenderData = React.useMemo(() => renderData.filter(item => boundsIntersect(item.bounds, localVisibleBounds)), [localVisibleBounds, renderData]);
  // While a road holds the selection, markings belonging to anything else
  // (other roads, rings) fade so the focus stays on that road.
  const focused = React.useMemo(() => focusedArmIds(selections), [selections]);
  const focusActive = focused.size > 0;
  // Focused roads' markings render above the dimmed rest, and the primary
  // selection's road above other focused roads — matching GeometryLayer.
  const primaryArmId = selection && 'armId' in selection ? selection.armId : null;
  const orderedRenderData = React.useMemo(() => {
    const rank = (armId?: string) => focusActive && armId && focused.has(armId)
      ? armId === primaryArmId ? 2 : 1
      : 0;
    return [...visibleRenderData].sort((a, b) => rank(a.marking.armId) - rank(b.marking.armId));
  }, [focusActive, focused, primaryArmId, visibleRenderData]);
  return (
    <g transform={`translate(${renderedConfig.island.center.x || 0}, ${renderedConfig.island.center.y || 0})`} pointerEvents="none" data-markings-layer="semantic">
      {orderedRenderData.map(({ marking, d }) => {
        const dimmed = focusActive && (!marking.armId || !focused.has(marking.armId));
        const style = { opacity: dimmed ? 0.5 : 1, transition: 'opacity 160ms ease' };
        return marking.kind === 'fill' ? (
          <path
            key={marking.id}
            d={d}
            fill={marking.color}
            stroke="none"
            style={style}
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
            strokeDashoffset={marking.dashOffset}
            strokeLinecap="butt"
            strokeLinejoin="round"
            style={style}
            data-marking-rule={marking.rule}
          />
        );
      })}
    </g>
  );
});
