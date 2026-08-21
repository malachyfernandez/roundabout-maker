import React from 'react';
import { isFeatureEnabled, type ActiveTool, useEditorStore } from '../editor/editorStore';

const TOOLS: { id: ActiveTool; label: string; key: string; tooltip: string; icon: React.ReactNode }[] = [
  { id: 'select', label: 'Select', key: 'V', tooltip: 'Select roads, lanes, rings, and gizmos. Drag empty space to pan.', icon: <path d="M5 3l10 9-5 .7 2.8 5.2-2.4 1.2-2.7-5.2L4 17z" /> },
  { id: 'add-road', label: 'Road', key: 'R', tooltip: 'Draw a road with two clicks: first the roundabout end, then the outer end.', icon: <><path d="M7 20l3-16M17 20L14 4" /><path d="M12 6v3m0 3v3m0 3v2" /></> },
  { id: 'add-ring', label: 'Ring', key: 'O', tooltip: 'Click the canvas to add a new circulatory ring centered at that point.', icon: <><circle cx="12" cy="12" r="7" /><circle cx="12" cy="12" r="3" /></> }
];

export const ToolPalette: React.FC = () => {
  const flags = useEditorStore(state => state.featureFlags);
  const activeTool = useEditorStore(state => state.activeTool);
  const setActiveTool = useEditorStore(state => state.setActiveTool);
  const pendingRoadStart = useEditorStore(state => state.pendingRoadStart);
  const pendingBypassSource = useEditorStore(state => state.pendingBypassSource);
  const enabled = isFeatureEnabled(flags, 'creationTools');

  React.useEffect(() => {
    if (!enabled) return;
    const keydown = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return;
      const tool = TOOLS.find(item => item.key.toLowerCase() === event.key.toLowerCase());
      if (tool) setActiveTool(tool.id);
      if (event.key === 'Escape') setActiveTool('select');
    };
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  }, [enabled, setActiveTool]);

  if (!enabled) return null;
  return (
    <div className="tool-palette" aria-label="Canvas tools">
      {TOOLS.map(tool => (
        <button
          key={tool.id}
          className={activeTool === tool.id ? 'active' : ''}
          onClick={() => setActiveTool(tool.id)}
          data-tooltip={tool.tooltip}
          aria-label={`${tool.label} tool`}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">{tool.icon}</svg>
          <span>{tool.label}</span>
          <kbd>{tool.key}</kbd>
        </button>
      ))}
      {activeTool === 'add-road' && pendingRoadStart && <div className="tool-hint">Click the outer road endpoint</div>}
      {activeTool === 'connect-bypass' && pendingBypassSource && <div className="tool-hint">Choose a green exit lane on another road · Esc to cancel</div>}
    </div>
  );
};
