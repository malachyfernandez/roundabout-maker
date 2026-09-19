import React from 'react';
import { type Vec2, add, sub, scale, norm, perpLeft } from '../math/vector';
import { type ResolvedSegment } from '../core/solver';
import { type Polyline, type Arc, type Line, arcPoint, linePoint, arcTangent } from '../geometry/primitives';
import { useEditorStore } from '../editor/editorStore';
import { isRightTurnPair, isValidBypassLanePair } from '../core/bypass';
import { boundsIntersect, offsetBounds, resolvedSegmentBounds, type Bounds } from '../rendering/bounds';

function generateVariableWidthPath(seg: ResolvedSegment): string {
  const pts: { p: Vec2, normal: Vec2 }[] = [];
  
  if (seg.geom.kind === 'line') {
    const line = seg.geom as Line;
    const p0 = linePoint(line, line.t0);
    const p1 = linePoint(line, line.t1);
    const normal = norm(perpLeft(line.u));
    pts.push({ p: p0, normal });
    pts.push({ p: p1, normal });
  } else if (seg.geom.kind === 'arc') {
    const arc = seg.geom as Arc;
    const diff = Math.abs(arc.a1 - arc.a0);
    const steps = Math.max(2, Math.ceil(diff / (5 * Math.PI / 180)));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const angle = arc.a0 + t * (arc.a1 - arc.a0);
      const p = arcPoint(arc, angle);
      const tangent = arcTangent(arc, angle);
      const normal = norm(perpLeft(tangent));
      pts.push({ p, normal });
    }
  } else if (seg.geom.kind === 'polyline') {
    const poly = seg.geom as Polyline;
    if (poly.points.length < 2) return "";
    // For a polyline, compute normals at each point using central difference
    for (let i = 0; i < poly.points.length; i++) {
      const p = poly.points[i];
      let dir: Vec2;
      if (i === 0) {
        dir = sub(poly.points[1], poly.points[0]);
      } else if (i === poly.points.length - 1) {
        dir = sub(poly.points[i], poly.points[i - 1]);
      } else {
        dir = sub(poly.points[i + 1], poly.points[i - 1]);
      }
      const normal = norm(perpLeft(dir));
      pts.push({ p, normal });
    }
  }

  if (pts.length < 2) return "";
  
  const leftOffset: Vec2[] = [];
  const rightOffset: Vec2[] = [];
  
  for (let i = 0; i < pts.length; i++) {
    const t = i / (pts.length - 1);
    const w = seg.widths?.[i] ?? (seg.wStart + (seg.wEnd - seg.wStart) * t);
    const { p, normal } = pts[i];
    leftOffset.push(add(p, scale(normal, w / 2)));
    rightOffset.push(sub(p, scale(normal, w / 2)));
  }
  
  let d = `M ${leftOffset[0].x} ${leftOffset[0].y}`;
  for (let i = 1; i < leftOffset.length; i++) {
    d += ` L ${leftOffset[i].x} ${leftOffset[i].y}`;
  }
  for (let i = rightOffset.length - 1; i >= 0; i--) {
    d += ` L ${rightOffset[i].x} ${rightOffset[i].y}`;
  }
  d += " Z";
  
  return d;
}

import { type RoundaboutConfig } from '../config/types';

type Props = {
  config: RoundaboutConfig;
  segments: ResolvedSegment[];
  effectsEnabled: boolean;
  visibleBounds: Bounds;
};

export const GeometryLayer: React.FC<Props> = React.memo(({ config, segments, effectsEnabled, visibleBounds }) => {
  const island = config.island;
  const selection = useEditorStore(state => state.selection);
  const hovered = useEditorStore(state => state.hovered);
  const viewMode = useEditorStore(state => state.viewMode);
  const activeTool = useEditorStore(state => state.activeTool);
  const pendingBypassSource = useEditorStore(state => state.pendingBypassSource);
  const drag = useEditorStore(state => state.drag);
  const segmentRenderData = React.useMemo(() => new Map(segments.map(segment => [segment, {
    d: generateVariableWidthPath(segment),
    bounds: resolvedSegmentBounds(segment)
  }])), [segments]);
  const localVisibleBounds = React.useMemo(() => offsetBounds(visibleBounds, { x: -island.center.x, y: -island.center.y }), [island.center.x, island.center.y, visibleBounds]);
  const visibleSegments = React.useMemo(() => segments.filter(segment => boundsIntersect(segmentRenderData.get(segment)!.bounds, localVisibleBounds)), [localVisibleBounds, segmentRenderData, segments]);

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
    
    let isSelected = false;
    let isRoadSelected = false;
    let isHovered = false;
    let isRoadHovered = false;
    
    if (seg.source.kind === 'lane') {
      isSelected = selection?.kind === 'lane'
        && selection.armId === seg.source.armId
        && selection.dir === seg.source.dir
        && selection.laneIndex === seg.source.laneIndex;
      isRoadSelected = (selection?.kind === 'lane' || selection?.kind === 'arm' || selection?.kind === 'arm-node' || selection?.kind === 'profile-point') && selection.armId === seg.source.armId;
      isHovered = hovered?.kind === 'lane'
        && hovered.armId === seg.source.armId
        && hovered.dir === seg.source.dir
        && hovered.laneIndex === seg.source.laneIndex;
      isRoadHovered = hovered?.kind === 'arm' && hovered.armId === seg.source.armId;
    } else if (seg.source.kind === 'ring') {
      isSelected = selection?.kind === 'ring' && selection.ringId === seg.source.ringId;
      isHovered = hovered?.kind === 'ring' && hovered.ringId === seg.source.ringId;
    }
    const bypass = seg.routeId.startsWith('bypass_')
      ? config.bypasses?.find(candidate => `bypass_${candidate.id}` === seg.routeId)
      : null;
    const bypassSelected = bypass && selection?.kind === 'lane' && (
      selection.dir === 'in'
        ? bypass.fromArmId === selection.armId && bypass.fromLaneIndex === selection.laneIndex
        : bypass.toArmId === selection.armId && bypass.toLaneIndex === selection.laneIndex
    );
    if (bypassSelected && (seg.kind === 'bypass-entry-connector' || seg.kind === 'bypass-lane' || seg.kind === 'bypass-exit-connector')) isSelected = true;

    const isRendered = viewMode !== 'segment';
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
    const isBypassCandidate = isToolBypassCandidate || isDragBypassCandidate;

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
      ? `Select ${seg.source.dir === 'in' ? 'entry' : 'exit'} lane ${seg.source.laneIndex + 1}.`
      : seg.source.kind === 'ring'
        ? `Select ring ${seg.source.ringId}.`
        : 'Select this geometry.';
    
    return (
      <g key={`${seg.routeId}-${seg.segIndex}`}>
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
          fill="none"
          stroke="transparent"
          strokeWidth={8}
          vectorEffect="non-scaling-stroke"
          pointerEvents="stroke"
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

  const islandSelected = selection?.kind === 'island';
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
        data-target={JSON.stringify({ kind: 'island' })}
      />
      {visibleSegments.map(renderSegment)}
    </g>
  );
});
