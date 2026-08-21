import React, { useState, useRef } from 'react';
import { type ResolvedSegment } from '../core/solver';
import { useEditorStore } from '../editor/editorStore';
import { GeometryLayer } from '../canvas/GeometryLayer';
import { HandlesLayer } from '../canvas/HandlesLayer';
import { CenterlineLayer } from '../canvas/CenterlineLayer';

type Props = {
  segments: ResolvedSegment[];
};

const DEFAULT_BACKGROUND = '/default-background.png';

export const Viewport: React.FC<Props> = ({ segments }) => {
  const getStored = <T,>(key: string, fallback: T): T => {
    const saved = localStorage.getItem(key);
    if (saved) try { return JSON.parse(saved) as T; } catch {}
    return fallback;
  };

  const [bgImage, setBgImage] = useState<string | null>(() => localStorage.getItem('roundabout_bg') || DEFAULT_BACKGROUND);
  const [bgOpacity, setBgOpacity] = useState(() => getStored('roundabout_bgOp', 0.5));
  const [bgSize, setBgSize] = useState(() => getStored('roundabout_bgSize', 400));
  const [pan, setPan] = useState(() => getStored('roundabout_pan', { x: 0, y: 0 }));
  const [zoom, setZoom] = useState(() => getStored('roundabout_zoom', 1));

  React.useEffect(() => {
    const reset = () => {
      setBgImage(DEFAULT_BACKGROUND);
      setBgOpacity(0.5);
      setBgSize(400);
      setPan({ x: 0, y: 0 });
      setZoom(1);
    };
    window.addEventListener('roundabout-reset', reset);
    return () => window.removeEventListener('roundabout-reset', reset);
  }, []);

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
  const setSelection = useEditorStore(state => state.setSelection);
  const setHovered = useEditorStore(state => state.setHovered);
  const activeDrag = useEditorStore(state => state.drag);
  const committedConfig = useEditorStore(state => state.committedConfig);
  const draftConfig = useEditorStore(state => state.draftConfig);

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
    // If we clicked a handle, let the handle capture it.
    if ((e.target as Element).closest('[data-handle]')) return;
    
    // Otherwise, check if we hit a geometry element
    const targetEl = (e.target as Element).closest('[data-target]');
    if (targetEl) {
      try {
        const source = JSON.parse(targetEl.getAttribute('data-target')!);
        setSelection(source);
      } catch {}
    } else {
      setSelection(null);
    }

    setIsDragging(true);
    setLastMouse({ x: e.clientX, y: e.clientY });
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  
  const handlePointerMove = (e: React.PointerEvent) => {
    // Hover logic
    if (!isDragging && !activeDrag) {
      const targetEl = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-target]');
      if (targetEl) {
        try { setHovered(JSON.parse(targetEl.getAttribute('data-target')!)); } catch {}
      } else {
        setHovered(null);
      }
    }

    if (!isDragging) return;
    const dx = e.clientX - lastMouse.x;
    const dy = e.clientY - lastMouse.y;
    
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
      reader.onload = (ev) => setBgImage(ev.target?.result as string);
      reader.readAsDataURL(file);
    }
  };

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', backgroundColor: '#f0f0f0' }}>
      
      <div style={{ position: 'absolute', top: 16, right: 16, background: 'white', padding: 12, borderRadius: 8, boxShadow: '0 2px 10px rgba(0,0,0,0.1)', zIndex: 10 }}>
        <h4 style={{ margin: '0 0 8px 0' }}>Viewport</h4>
        <div style={{ marginBottom: 8 }}>
          <button onClick={() => { setZoom(1); setPan({x:0, y:0}); }} style={{ padding: '4px 8px' }}>Reset View</button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
          <label>
            Load Background:<br/>
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
        style={{ width: '100%', height: '100%', cursor: isDragging ? 'grabbing' : 'crosshair', touchAction: 'none' }}
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
            pointerEvents="none"
          />
        )}
        <GeometryLayer config={draftConfig || committedConfig} segments={segments} zoom={zoom} />
        <CenterlineLayer config={draftConfig || committedConfig} zoom={zoom} />
        <HandlesLayer zoom={zoom} />
      </svg>
    </div>
  );
};
