import React from 'react';
import { type ResolvedSegment } from '../core/solver';
import { type Polyline, type Arc, type Line, arcPoint, linePoint } from '../geometry/primitives';
import { useEditorStore } from '../editor/editorStore';
import { isRightTurnPair, isValidBypassLanePair } from '../core/bypass';
import { boundsIntersect, offsetBounds, resolvedSegmentBounds, type Bounds } from '../rendering/bounds';
import { segmentSurface } from '../rendering/segmentPath';
import { focusedArmIds } from '../editor/selection';
import { type RoundaboutConfig } from '../config/types';

const FOCUS_DIM = { transition: 'opacity 160ms ease' } as const;

type Props = {
  config: RoundaboutConfig;
  segments: ResolvedSegment[];
  effectsEnabled: boolean;
  visibleBounds: Bounds;
};

export const GeometryLayer: React.FC<Props> = React.memo(({ config, segments, effectsEnabled, visibleBounds }) => {
  const island = config.island;
  const selection = useEditorStore(state => state.selection);
  const selections = useEditorStore(state => state.selections);
  const hovered = useEditorStore(state => state.hovered);
  const viewMode = useEditorStore(state => state.viewMode);
  const activeTool = useEditorStore(state => state.activeTool);
  const pendingBypassSource = useEditorStore(state => state.pendingBypassSource);
  const drag = useEditorStore(state => state.drag);
  const focused = React.useMemo(() => focusedArmIds(selections), [selections]);
  const focusActive = focused.size > 0;
  const segmentRenderData = React.useMemo(() => new Map(segments.map(segment => [segment, {
    d: segmentSurface(segment).d,
    bounds: resolvedSegmentBounds(segment)
  }])), [segments]);
  const pavementBasePath = React.useMemo(() => segments.map(segment => segmentSurface(segment).d).filter(Boolean).join(' '), [segments]);
  const localVisibleBounds = React.useMemo(() => offsetBounds(visibleBounds, { x: -island.center.x, y: -island.center.y }), [island.center.x, island.center.y, visibleBounds]);
  const visibleSegments = React.useMemo(() => segments.filter(segment => boundsIntersect(segmentRenderData.get(segment)!.bounds, localVisibleBounds)), [localVisibleBounds, segmentRenderData, segments]);

  const segmentFlags = React.useMemo(() => {
    const flags = new Map<ResolvedSegment, { isSelected: boolean; isRoadSelected: boolean; isHovered: boolean; isRoadHovered: boolean; isBypassCandidate: boolean; dimmed: boolean }>();
    for (const seg of visibleSegments) {
      let isSelected = false;
      let isRoadSelected = false;
      let isHovered = false;
      let isRoadHovered = false;

      if (seg.source.kind === 'lane') {
        const source = seg.source;
        isSelected = selections.some(selected => (selected.kind === 'lane' || selected.kind === 'lane-node' || selected.kind === 'lane-segment' || selected.kind === 'profile-control')
          && selected.armId === source.armId
          && selected.dir === source.dir
          && selected.laneIndex === source.laneIndex);
        isRoadSelected = selections.some(selected => 'armId' in selected && selected.armId === source.armId);
        // Per-lane hover only applies once the road is in the selection scope;
        // before that a click would select the whole road, so hovering any part
        // of it previews the whole-road highlight instead.
        isHovered = isRoadSelected
          && hovered?.kind === 'lane'
          && hovered.armId === seg.source.armId
          && hovered.dir === seg.source.dir
          && hovered.laneIndex === seg.source.laneIndex;
        isRoadHovered = Boolean(hovered && hovered.kind !== 'lane-segment' && 'armId' in hovered && hovered.armId === seg.source.armId
          && (hovered.kind === 'arm' || !isRoadSelected));
      } else if (seg.source.kind === 'ring') {
        const source = seg.source;
        isSelected = selections.some(selected => selected.kind === 'ring' && selected.ringId === source.ringId);
        isHovered = hovered?.kind === 'ring' && hovered.ringId === source.ringId;
      }
      const bypass = seg.routeId.startsWith('bypass_')
        ? config.bypasses?.find(candidate => `bypass_${candidate.id}` === seg.routeId)
        : null;
      const bypassSelected = bypass && selections.some(selected => (selected.kind === 'lane' || selected.kind === 'lane-node' || selected.kind === 'lane-segment' || selected.kind === 'profile-control') && (
        selected.dir === 'in'
          ? bypass.fromArmId === selected.armId && bypass.fromLaneIndex === selected.laneIndex
          : bypass.toArmId === selected.armId && bypass.toLaneIndex === selected.laneIndex
      ));
      if (bypassSelected && (seg.kind === 'bypass-entry-connector' || seg.kind === 'bypass-lane' || seg.kind === 'bypass-exit-connector')) isSelected = true;

      const laneSource = seg.source.kind === 'lane' ? seg.source : null;
      const isLaneConnectionSegment = laneSource?.dir === 'in'
        ? seg.kind === 'entry-line' || seg.kind === 'bypass-entry'
        : laneSource?.dir === 'out' && (seg.kind === 'exit-line' || seg.kind === 'bypass-exit');
      const isToolBypassCandidate = isLaneConnectionSegment
        && activeTool === 'connect-bypass'
        && pendingBypassSource
        && laneSource?.dir === 'out'
        && isRightTurnPair(
          config.arms.find(arm => arm.id === pendingBypassSource.armId),
          config.arms.find(arm => arm.id === laneSource.armId)
        );
      const ringSnapSource = drag?.active && drag.type === 'lane-ring-snap' && selection?.kind === 'lane' ? selection : null;
      const isDragBypassCandidate = isLaneConnectionSegment
        && laneSource?.kind === 'lane'
        && isValidBypassLanePair(config, ringSnapSource, laneSource);
      const isBypassCandidate = Boolean(isToolBypassCandidate || isDragBypassCandidate);
      const dimmed = focusActive && !(seg.source.kind === 'lane' && focused.has(seg.source.armId));
      flags.set(seg, { isSelected, isRoadSelected, isHovered, isRoadHovered, isBypassCandidate, dimmed });
    }
    return flags;
  }, [activeTool, config, drag, focusActive, focused, hovered, pendingBypassSource, selection, selections, visibleSegments]);

  // Selection raises pavement in three tiers: unrelated (dimmed) segments at
  // the bottom, then the rest of any road in the selection scope, then the
  // precisely selected lane/road — so what you select always reads on top.
  const primaryArmId = selection && 'armId' in selection ? selection.armId : null;
  const orderedSegments = React.useMemo(() => {
    const rank = (seg: ResolvedSegment) => {
      const flags = segmentFlags.get(seg);
      if (!flags) return 0;
      if (flags.isSelected || flags.isBypassCandidate) return 2;
      if (flags.isRoadSelected) return seg.source.kind === 'lane' && seg.source.armId === primaryArmId ? 2 : 1;
      return 0;
    };
    return [...visibleSegments].sort((a, b) => rank(a) - rank(b));
  }, [primaryArmId, segmentFlags, visibleSegments]);

  const renderSegment = (seg: ResolvedSegment) => {
    const d = segmentRenderData.get(seg)?.d ?? '';
    if (!d) return null;
    let dCenter = "";
    if (seg.geom.kind === "line") {
      const line = seg.geom as Line;
      const p0 = linePoint(line, line.t0);
      const p1 = linePoint(line, line.t1);
      dCenter = `M ${p0.x} ${p0.y} L ${p1.x} ${p1.y}`;
    } else if (seg.geom.kind === "polyline") {
      const poly = seg.geom as Polyline;
      dCenter = `M ${poly.points[0].x} ${poly.points[0].y}`;
      for (let i = 1; i < poly.points.length; i++) {
        dCenter += ` L ${poly.points[i].x} ${poly.points[i].y}`;
      }
    } else {
      const arc = seg.geom as Arc;
      const p0 = arcPoint(arc, arc.a0);
      const p1 = arcPoint(arc, arc.a1);
      const r = arc.r;
      const diff = Math.abs(arc.a1 - arc.a0);
      const isFullCircle = diff >= Math.PI * 2 - 1e-6;
      const sweep = arc.dir === 1 ? 1 : 0;
      
      if (isFullCircle) {
        const pMid = arcPoint(arc, arc.a0 + Math.PI * arc.dir);
        dCenter = `M ${p0.x} ${p0.y} 
             A ${r} ${r} 0 1 ${sweep} ${pMid.x} ${pMid.y}
             A ${r} ${r} 0 1 ${sweep} ${p0.x} ${p0.y}`;
      } else {
        const largeArc = diff > Math.PI ? 1 : 0;
        dCenter = `M ${p0.x} ${p0.y} A ${r} ${r} 0 ${largeArc} ${sweep} ${p1.x} ${p1.y}`;
      }
    }
    
    const { isSelected, isRoadSelected, isHovered, isRoadHovered, isBypassCandidate, dimmed } = segmentFlags.get(seg)!;

    const isRendered = viewMode !== 'segment';

    let fillColor = seg.color;
    // When a lane is hovered, suppress the road-selected blue tint so the
    // white hover overlay is the only highlight on that lane.
    const suppressRoadTint = isHovered;
    let strokeHighlight = isBypassCandidate ? '#22c55e' : isSelected ? '#facc15' : (isRoadSelected && !suppressRoadTint) ? '#60a5fa' : undefined;
    let opacity = isBypassCandidate || isSelected ? 1 : (isRoadSelected && !suppressRoadTint) || isRoadHovered ? 0.95 : 0.8;

    if (isRendered) {
      fillColor = '#555';
      opacity = 1;
      strokeHighlight = undefined;
      // In rendered mode, we can show selection as a subtle overlay
    }
    const sourceTooltip = isBypassCandidate
      ? `Drop to connect the right-turn bypass to ${seg.source.kind === 'lane' && seg.source.dir === 'in' ? 'entry' : 'exit'} lane ${seg.source.kind === 'lane' ? seg.source.laneIndex + 1 : ''}.`
      : seg.source.kind === 'lane'
      ? isRoadSelected
        ? `Select ${seg.source.dir === 'in' ? 'entry' : 'exit'} lane ${seg.source.laneIndex + 1}.`
        : `Select road ${seg.source.armId}.`
      : seg.source.kind === 'ring'
        ? `Select ring ${seg.source.ringId}.`
        : 'Select this geometry.';
    
    return (
      <g key={`${seg.routeId}-${seg.segIndex}`} style={{ ...FOCUS_DIM, opacity: dimmed ? 0.5 : 1 }}>
        <path
          d={d}
          fill={fillColor}
          stroke={strokeHighlight || "none"}
          strokeWidth={strokeHighlight ? (isSelected || isBypassCandidate ? 4 : 2) : 0}
          vectorEffect="non-scaling-stroke"
          opacity={opacity}
          filter={!isRendered && effectsEnabled ? 'url(#lane-shadow)' : undefined}
          data-target={JSON.stringify(seg.source)}
          data-bypass-candidate={isBypassCandidate ? 'true' : undefined}
          data-tooltip={sourceTooltip}
        />
        <path
          d={d}
          fill="transparent"
          stroke="transparent"
          strokeWidth={8}
          vectorEffect="non-scaling-stroke"
          pointerEvents="all"
          data-target={JSON.stringify(seg.source)}
          data-bypass-candidate={isBypassCandidate ? 'true' : undefined}
          data-tooltip={sourceTooltip}
        />
        {isBypassCandidate && (
          <path
            d={d}
            fill="#22c55e"
            stroke="#22c55e"
            strokeWidth={3}
            vectorEffect="non-scaling-stroke"
            opacity={0.24}
            pointerEvents="none"
          />
        )}
        {!isRendered && (
          <path
            d={dCenter}
            fill="none"
            stroke="rgba(0,0,0,0.5)"
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
            strokeLinecap="butt"
            pointerEvents="none"
          />
        )}
        {/* Hover overlay — white lightening, works in all view modes */}
        {(isHovered || isRoadHovered) && !isSelected && !isBypassCandidate && (
          <path
            d={d}
            fill="#ffffff"
            opacity={isHovered ? 0.22 : 0.08}
            pointerEvents="none"
          />
        )}
        {/* Selection/Road-selected overlay — suppressed on hovered lanes so white hover wins */}
        {isRendered && (isSelected || (isRoadSelected && !isHovered)) && (
          <path
            d={d}
            fill={isSelected ? '#facc15' : '#60a5fa'}
            opacity={isSelected ? 0.28 : 0.12}
            pointerEvents="none"
          />
        )}
        
      </g>
    );
  };

  const islandSelected = selections.some(selected => selected.kind === 'island');
  const islandHovered = hovered?.kind === 'island';
  const islandHighlight = islandSelected ? '#ffeb3b' : islandHovered ? '#ffffff' : '#999';

  return (
    <g transform={`translate(${island.center.x || 0}, ${island.center.y || 0})`}>
      <defs>
        <filter id="lane-shadow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx={0} dy={1.5} stdDeviation={1.5} floodColor="#000" floodOpacity={0.35} />
        </filter>
      </defs>
      <circle
        cx={0}
        cy={0}
        r={island.radius}
        fill="#ccc"
        stroke={islandHighlight}
        strokeWidth={islandSelected || islandHovered ? 4 : 0.5}
        vectorEffect="non-scaling-stroke"
        style={{ ...FOCUS_DIM, opacity: focusActive ? 0.5 : 1 }}
        data-target={JSON.stringify({ kind: 'island' })}
      />
      <path d={pavementBasePath} fill="#555" style={{ ...FOCUS_DIM, opacity: (viewMode === 'segment' ? .82 : 1) * (focusActive ? 0.5 : 1) }} pointerEvents="none" />
      {orderedSegments.map(renderSegment)}
    </g>
  );
});
