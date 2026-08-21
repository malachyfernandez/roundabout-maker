import React, { useState, useRef } from 'react';
import { type ResolvedSegment } from '../core/solver';
import { type Arc, type Line, arcPoint, linePoint, arcTangent } from '../geometry/primitives';
import { type Vec2, add, sub, scale, perpLeft, norm } from '../math/vector';

type Props = {
  segments: ResolvedSegment[];
  island: { center: { x: number; y: number }; radius: number };
};

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

export const Renderer: React.FC<Props> = ({ segments, island }) => {
  const getStored = <T,>(key: string, fallback: T): T => {
    const saved = localStorage.getItem(key);
    if (saved) try { return JSON.parse(saved) as T; } catch {}
    return fallback;
  };

  const [bgImage, setBgImage] = useState<string | null>(() => localStorage.getItem('roundabout_bg'));
  const [bgOpacity, setBgOpacity] = useState(() => getStored('roundabout_bgOp', 0.5));
  const [bgSize, setBgSize] = useState(() => getStored('roundabout_bgSize', 400));

  const [pan, setPan] = useState(() => getStored('roundabout_pan', { x: 0, y: 0 }));
  const [zoom, setZoom] = useState(() => getStored('roundabout_zoom', 1));
  
  React.useEffect(() => {
    if (bgImage) localStorage.setItem('roundabout_bg', bgImage);
    else localStorage.removeItem('roundabout_bg');
  }, [bgImage]);
  React.useEffect(() => { localStorage.setItem('roundabout_bgOp', JSON.stringify(bgOpacity)); }, [bgOpacity]);
  React.useEffect(() => { localStorage.setItem('roundabout_bgSize', JSON.stringify(bgSize)); }, [bgSize]);
  React.useEffect(() => { localStorage.setItem('roundabout_pan', JSON.stringify(pan)); }, [pan]);
  React.useEffect(() => { localStorage.setItem('roundabout_zoom', JSON.stringify(zoom)); }, [zoom]);

  const [isDragging, setIsDragging] = useState(false);
  const [lastMouse, setLastMouse] = useState({ x: 0, y: 0 });
  
  const svgRef = useRef<SVGSVGElement>(null);

  const baseViewSize = 400;
  const width = baseViewSize * zoom;
  const height = baseViewSize * zoom;
  const vx = pan.x - width / 2;
  const vy = pan.y - height / 2;

  const handleWheel = (e: React.WheelEvent<SVGSVGElement>) => {
    e.preventDefault();
    const zoomFactor = e.deltaY > 0 ? 1.1 : 0.9;
    
    if (!svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const cursorX = e.clientX - rect.left;
    const cursorY = e.clientY - rect.top;
    
    const svgCursorX = vx + (cursorX / rect.width) * width;
    const svgCursorY = vy + (cursorY / rect.height) * height;

    const newZoom = zoom * zoomFactor;
    const newWidth = baseViewSize * newZoom;
    const newHeight = baseViewSize * newZoom;
    
    const newVx = svgCursorX - (cursorX / rect.width) * newWidth;
    const newVy = svgCursorY - (cursorY / rect.height) * newHeight;
    
    setZoom(newZoom);
    setPan({ x: newVx + newWidth / 2, y: newVy + newHeight / 2 });
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    setIsDragging(true);
    setLastMouse({ x: e.clientX, y: e.clientY });
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  
  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDragging) return;
    const dx = e.clientX - lastMouse.x;
    const dy = e.clientY - lastMouse.y;
    
    // Scale movement by zoom and physical dimensions to match exactly
    if (svgRef.current) {
      const rect = svgRef.current.getBoundingClientRect();
      const scaleX = width / rect.width;
      const scaleY = height / rect.height;
      setPan(prev => ({ x: prev.x - dx * scaleX, y: prev.y - dy * scaleY }));
    }
    setLastMouse({ x: e.clientX, y: e.clientY });
  };
  
  const handlePointerUp = (e: React.PointerEvent) => {
    setIsDragging(false);
    e.currentTarget.releasePointerCapture(e.pointerId);
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (ev) => {
        const base64 = ev.target?.result as string;
        setBgImage(base64);
      };
      reader.readAsDataURL(file);
    }
  };

  const renderSegment = (seg: ResolvedSegment) => {
    const d = generateVariableWidthPath(seg);
    let dCenter = "";
    if (seg.geom.kind === "line") {
      const line = seg.geom as Line;
      const p0 = linePoint(line, line.t0);
      const p1 = linePoint(line, line.t1);
      dCenter = `M ${p0.x} ${p0.y} L ${p1.x} ${p1.y}`;
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
    
    return (
      <g key={`${seg.routeId}-${seg.segIndex}`}>
        <path
          d={d}
          fill={seg.color}
          stroke="none"
          opacity={0.8}
          data-route={seg.routeId}
        />
        <path
          d={dCenter}
          fill="none"
          stroke="rgba(0,0,0,0.5)"
          strokeWidth={1}
          strokeLinecap="butt"
        />
      </g>
    );
  };

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', backgroundColor: '#f0f0f0' }}>
      
      {/* Overlay Toolbar */}
      <div style={{ position: 'absolute', top: 16, right: 16, background: 'white', padding: 12, borderRadius: 8, boxShadow: '0 2px 10px rgba(0,0,0,0.1)', zIndex: 10 }}>
        <h4 style={{ margin: '0 0 8px 0' }}>Viewport & Background</h4>
        <div style={{ marginBottom: 8 }}>
          <button onClick={() => { setZoom(1); setPan({x:0, y:0}); }} style={{ padding: '4px 8px' }}>Reset View</button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
          <label>
            Load Satellite Image:<br/>
            <input type="file" accept="image/*" onChange={handleImageUpload} style={{ width: 180, marginTop: 4 }} />
          </label>
          
          {bgImage && (
            <>
              <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 }}>
                Opacity:
                <input type="range" min="0" max="1" step="0.05" value={bgOpacity} onChange={e => setBgOpacity(Number(e.target.value))} style={{ width: 100 }} />
              </label>
              <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                Image Scale (ft):
                <input type="number" value={bgSize} onChange={e => setBgSize(Number(e.target.value))} style={{ width: 60 }} />
              </label>
            </>
          )}
        </div>
      </div>

      <svg 
        ref={svgRef}
        viewBox={`${vx} ${vy} ${width} ${height}`} 
        style={{ width: '100%', height: '100%', cursor: isDragging ? 'grabbing' : 'grab', touchAction: 'none' }}
        onWheel={handleWheel}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
      >
        {bgImage && (
          <image 
            href={bgImage} 
            x={-bgSize/2} 
            y={-bgSize/2} 
            width={bgSize} 
            height={bgSize} 
            opacity={bgOpacity} 
            preserveAspectRatio="none" 
          />
        )}
        
      <g transform={`translate(${island.center?.x || 0}, ${island.center?.y || 0})`}>
        <circle 
          cx={0} 
          cy={0} 
          r={island.radius} 
          fill="#ccc" 
          stroke="#999" 
          strokeWidth={0.5} 
        />
        {segments.map(renderSegment)}
      </g>
    </svg>
    </div>
  );
};
