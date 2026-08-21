import React from 'react';
import { type Vec2, add, sub, scale, norm, perpLeft } from '../math/vector';
import { type ResolvedSegment } from '../core/solver';
import { type Polyline, type Arc, type Line, arcPoint, linePoint, arcTangent } from '../geometry/primitives';
import { useEditorStore } from '../editor/editorStore';

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
    const w = seg.wStart + (seg.wEnd - seg.wStart) * t;
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
  zoom: number;
};

export const GeometryLayer: React.FC<Props> = React.memo(({ config, segments, zoom }) => {
  const island = config.island;
  const selection = useEditorStore(state => state.selection);
  const hovered = useEditorStore(state => state.hovered);
  const viewMode = useEditorStore(state => state.viewMode);

  const matches = (a: any, b: any) => JSON.stringify(a) === JSON.stringify(b);

  const renderSegment = (seg: ResolvedSegment) => {
    const d = generateVariableWidthPath(seg);
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
    let isHovered = false;
    
    if (seg.source.kind === 'lane') {
      isSelected = selection?.kind === 'lane' && selection.armId === seg.source.armId;
      isHovered = hovered?.kind === 'lane' && hovered.armId === seg.source.armId;
    } else if (seg.source.kind === 'ring') {
      isSelected = selection?.kind === 'ring' && selection.ringId === seg.source.ringId;
      isHovered = hovered?.kind === 'ring' && hovered.ringId === seg.source.ringId;
    }

    const isRendered = viewMode === 'rendered';
    let fillColor = seg.color;
    let strokeHighlight = isSelected ? '#ffeb3b' : isHovered ? '#ffffff' : undefined;
    let opacity = 0.8;

    if (isRendered) {
      fillColor = '#555';
      opacity = 1;
      strokeHighlight = undefined;
      // In rendered mode, we can show selection as a subtle overlay
    }
    
    return (
      <g key={`${seg.routeId}-${seg.segIndex}`}>
        <path
          d={d}
          fill={fillColor}
          stroke={strokeHighlight || "none"}
          strokeWidth={strokeHighlight ? 4 * zoom : 0}
          opacity={opacity}
          data-target={JSON.stringify(seg.source)}
        />
        <path
          d={d}
          fill="none"
          stroke="transparent"
          strokeWidth={12 * zoom}
          pointerEvents="stroke"
          data-target={JSON.stringify(seg.source)}
        />
        {isRendered && (
          <path
            d={dCenter}
            fill="none"
            stroke="rgba(255,255,255,0.7)"
            strokeWidth={1 * zoom}
            strokeDasharray="4, 4"
            strokeLinecap="butt"
            pointerEvents="none"
          />
        )}
        {!isRendered && (
          <path
            d={dCenter}
            fill="none"
            stroke="rgba(0,0,0,0.5)"
            strokeWidth={1 * zoom}
            strokeLinecap="butt"
            pointerEvents="none"
          />
        )}
        {/* Rendered Selection Overlay */}
        {isRendered && (isSelected || isHovered) && (
          <path
            d={d}
            fill="#fff"
            opacity={isSelected ? 0.3 : 0.15}
            pointerEvents="none"
          />
        )}
        
        {/* Yield Triangle Marking */}
        {isRendered && seg.kind === 'entry-fillet' && (
          <g>
            {(() => {
              const arc = seg.geom as Arc;
              // The yield line is at the end of the entry line, which is the start of the entry fillet arc?
              // Wait, the vehicle travels along the line, then along the fillet to the ring.
              // So the start of the fillet is where it leaves the lane.
              // We want the yield line where it enters the ring, which is the END of the fillet arc.
              // But actually, usually you yield BEFORE entering the roundabout ring, so somewhere near the end of the fillet.
              // Let's place it at the end of the fillet arc.
              const angle = arc.a1;
              const p = arcPoint(arc, angle);
              const tan = arcTangent(arc, angle);
              const forward = norm(tan);
              const right = perpLeft(forward); // perpLeft of forward is left. So -perpLeft is right.
              // Wait, perpLeft(x,y) = (-y, x). So if forward is (1,0), left is (0,1). Right is (0,-1).
              // Yield triangle pointing backward
              const back = scale(forward, -1);
              
              const size = 6;
              const p1 = add(p, scale(forward, size));
              const p2 = add(p, add(scale(back, size), scale(right, size)));
              const p3 = add(p, sub(scale(back, size), scale(right, size)));
              
              return (
                <polygon
                  points={`${p1.x},${p1.y} ${p2.x},${p2.y} ${p3.x},${p3.y}`}
                  fill="#fff"
                  pointerEvents="none"
                />
              );
            })()}
          </g>
        )}
      </g>
    );
  };

  const islandSelected = matches(selection, { kind: 'island' });
  const islandHovered = matches(hovered, { kind: 'island' });
  const islandHighlight = islandSelected ? '#ffeb3b' : islandHovered ? '#ffffff' : '#999';

  return (
    <g transform={`translate(${island.center.x || 0}, ${island.center.y || 0})`}>
      <circle 
        cx={0} 
        cy={0} 
        r={island.radius} 
        fill="#ccc" 
        stroke={islandHighlight}
        strokeWidth={islandSelected || islandHovered ? 4 * zoom : 0.5 * zoom} 
        data-target={JSON.stringify({ kind: 'island' })}
      />
      {segments.map(renderSegment)}
    </g>
  );
});
