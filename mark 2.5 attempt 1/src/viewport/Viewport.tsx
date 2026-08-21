import React, { useState, useRef } from 'react';
import { type ResolvedSegment } from '../core/solver';
import { isFeatureEnabled, useEditorStore } from '../editor/editorStore';
import { GeometryLayer } from '../canvas/GeometryLayer';
import { HandlesLayer } from '../canvas/HandlesLayer';
import { CenterlineLayer } from '../canvas/CenterlineLayer';
import { MarkingsLayer } from '../canvas/MarkingsLayer';
import { screenToWorld } from './transform';
import { type Vec2, len, sub } from '../math/vector';
import { isRightTurnPair } from '../core/bypass';

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
  const [bgSize, setBgSize] = useState(() => getStored('roundabout_bgSize', 200));
  const [pan, setPan] = useState(() => getStored('roundabout_pan', { x: 0, y: 0 }));
  const [zoom, setZoom] = useState(() => getStored('roundabout_zoom', 1));

  React.useEffect(() => {
    const reset = () => {
      setBgImage(DEFAULT_BACKGROUND);
      setBgOpacity(0.5);
      setBgSize(200);
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
  const setCommittedConfig = useEditorStore(state => state.setCommittedConfig);
  const featureFlags = useEditorStore(state => state.featureFlags);
  const viewMode = useEditorStore(state => state.viewMode);
  const activeTool = useEditorStore(state => state.activeTool);
  const setActiveTool = useEditorStore(state => state.setActiveTool);
  const pendingRoadStart = useEditorStore(state => state.pendingRoadStart);
  const setPendingRoadStart = useEditorStore(state => state.setPendingRoadStart);
  const pendingBypassSource = useEditorStore(state => state.pendingBypassSource);
  const setPendingBypassSource = useEditorStore(state => state.setPendingBypassSource);
  const [toolPointer, setToolPointer] = useState<Vec2 | null>(null);
  const creationToolsEnabled = isFeatureEnabled(featureFlags, 'creationTools');
  const bypassEnabled = isFeatureEnabled(featureFlags, 'bypassLanes');
  const renderedMarkingsEnabled = isFeatureEnabled(featureFlags, 'renderedMarkings');
  const modalToolActive = (creationToolsEnabled && (activeTool === 'add-road' || activeTool === 'add-ring')) || (bypassEnabled && activeTool === 'connect-bypass');

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

  const handlePointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    // If we clicked a handle, let the handle capture it.
    if ((e.target as Element).closest('[data-handle]')) return;

    if (modalToolActive) {
      const point = screenToWorld(e, e.currentTarget);
      const next = structuredClone(committedConfig);
      const id = Math.random().toString(36).slice(2, 7);
      if (activeTool === 'connect-bypass') {
        const targetElement = (e.target as Element).closest('[data-target]');
        if (!targetElement || !pendingBypassSource) return;
        try {
          const target = JSON.parse(targetElement.getAttribute('data-target')!);
          const sourceArm = next.arms.find(arm => arm.id === pendingBypassSource.armId);
          const targetArm = next.arms.find(arm => arm.id === target.armId);
          if (target.kind !== 'lane' || target.dir !== 'out' || !isRightTurnPair(sourceArm, targetArm)) return;
          next.bypasses = (next.bypasses ?? []).filter(connection => connection.fromArmId !== pendingBypassSource.armId || connection.fromLaneIndex !== pendingBypassSource.laneIndex);
          next.bypasses.push({
            id: `turn_${id}`,
            fromArmId: pendingBypassSource.armId,
            fromLaneIndex: pendingBypassSource.laneIndex,
            toArmId: target.armId,
            toLaneIndex: target.laneIndex,
            radius: 32
          });
          setCommittedConfig(next);
          setSelection({ kind: 'lane', armId: pendingBypassSource.armId, dir: 'in', laneIndex: pendingBypassSource.laneIndex });
          setPendingBypassSource(null);
          setActiveTool('select');
        } catch {}
        return;
      }
      if (activeTool === 'add-ring') {
        const ringId = `ring_${id}`;
        next.rings.push({ id: ringId, center: point, radius: 35, width: 12 });
        setCommittedConfig(next);
        setSelection({ kind: 'ring', ringId });
        setActiveTool('select');
        return;
      }
      if (activeTool === 'add-road') {
        if (!pendingRoadStart) {
          setPendingRoadStart(point);
          setToolPointer(point);
          return;
        }
        if (len(sub(point, pendingRoadStart)) < 20) return;
        const armId = `road_${id}`;
        const ringId = next.rings[0]?.id || '';
        next.arms.push({
          id: armId,
          nodes: [
            { id: `${armId}_0`, point: pendingRoadStart, medianWidth: 4, laneWidthsIn: [10], laneWidthsOut: [10] },
            { id: `${armId}_1`, point, medianWidth: 4, laneWidthsIn: [10], laneWidthsOut: [10] }
          ],
          lanesIn: ringId ? [{ targetsRing: ringId, filletRadius: 40 }] : [],
          lanesOut: ringId ? [{ sourceRing: ringId, filletRadius: 40, dropsRing: false }] : []
        });
        setCommittedConfig(next);
        setSelection({ kind: 'arm', armId });
        setActiveTool('select');
        return;
      }
    }
    
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
  
  const handlePointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (modalToolActive) {
      if (activeTool !== 'connect-bypass') setToolPointer(screenToWorld(e, e.currentTarget));
      return;
    }

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
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
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
          <button data-tooltip="Reset canvas pan and zoom without changing the design." onClick={() => { setZoom(1); setPan({x:0, y:0}); }} style={{ padding: '4px 8px' }}>Reset View</button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
          <label>
            Load Background:<br/>
            <input data-tooltip="Choose a reference image to place beneath the design." type="file" accept="image/*" onChange={handleImageUpload} style={{ width: 180, marginTop: 4 }} />
          </label>
          
          {bgImage && (
            <>
              <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 }}>
                Opacity:
                <input data-tooltip="Drag to change how strongly the reference image shows through." type="range" min="0" max="1" step="0.05" value={bgOpacity} onChange={e => setBgOpacity(Number(e.target.value))} style={{ width: 100 }} />
              </label>
              <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                Image Scale (ft):
                <input data-tooltip="Set the reference image width and height in feet." type="number" value={bgSize} onChange={e => setBgSize(Number(e.target.value))} style={{ width: 60 }} />
              </label>
            </>
          )}
        </div>
      </div>

      <svg 
        ref={svgRef}
        viewBox={`${vx} ${vy} ${width} ${height}`} 
        style={{ width: '100%', height: '100%', cursor: modalToolActive ? 'crosshair' : isDragging ? 'grabbing' : 'default', touchAction: 'none' }}
        data-tooltip={activeTool === 'connect-bypass' ? 'Click a highlighted exit lane on another road to complete the right-turn bypass.' : creationToolsEnabled && activeTool === 'add-road' ? (pendingRoadStart ? 'Click to place the outer endpoint of the new road.' : 'Click to place the roundabout end of the new road.') : creationToolsEnabled && activeTool === 'add-ring' ? 'Click to place a new ring center.' : undefined}
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
        {creationToolsEnabled && activeTool === 'add-road' && pendingRoadStart && toolPointer && (
          <g pointerEvents="none">
            <line x1={pendingRoadStart.x} y1={pendingRoadStart.y} x2={toolPointer.x} y2={toolPointer.y} stroke="#2563eb" strokeWidth={2 * zoom} strokeDasharray={`${6 * zoom} ${4 * zoom}`} />
            <circle cx={pendingRoadStart.x} cy={pendingRoadStart.y} r={5 * zoom} fill="#fff" stroke="#2563eb" strokeWidth={2 * zoom} />
            <circle cx={toolPointer.x} cy={toolPointer.y} r={5 * zoom} fill="#dbeafe" stroke="#2563eb" strokeWidth={2 * zoom} />
          </g>
        )}
        {creationToolsEnabled && activeTool === 'add-ring' && toolPointer && (
          <g pointerEvents="none">
            <circle cx={toolPointer.x} cy={toolPointer.y} r={35} fill="rgba(37,99,235,.08)" stroke="#2563eb" strokeWidth={2 * zoom} strokeDasharray={`${5 * zoom} ${4 * zoom}`} />
            <circle cx={toolPointer.x} cy={toolPointer.y} r={3.5 * zoom} fill="#2563eb" />
          </g>
        )}
        <GeometryLayer config={draftConfig || committedConfig} segments={segments} zoom={zoom} />
        {renderedMarkingsEnabled && viewMode !== 'segment' && (
          <MarkingsLayer config={draftConfig || committedConfig} segments={segments} zoom={zoom} />
        )}
        <CenterlineLayer config={draftConfig || committedConfig} zoom={zoom} />
        <HandlesLayer zoom={zoom} segments={segments} />
      </svg>
    </div>
  );
};
