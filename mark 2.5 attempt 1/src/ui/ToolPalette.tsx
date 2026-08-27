import React from 'react';
import { MousePointer2, Waypoints, CircleDot } from 'lucide-react';
import { type ActiveTool, useEditorStore } from '../editor/editorStore';
import { matchesShortcut } from './keyboard';

const TOOLS: { id: ActiveTool; label: string; key: string; tooltip: string; icon: React.ReactNode }[] = [
  { id: 'select', label: 'Select', key: 'V', tooltip: 'Select roads, lanes, rings, and gizmos. Drag empty space to pan.', icon: <MousePointer2 size={21} /> },
  { id: 'add-road', label: 'Road', key: 'R', tooltip: 'Draw a road with two clicks: first the roundabout end, then the outer end.', icon: <Waypoints size={21} /> },
  { id: 'add-ring', label: 'Ring', key: 'O', tooltip: 'Click the canvas to add a new circulatory ring centered at that point.', icon: <CircleDot size={21} /> }
];

export const ToolPalette: React.FC = () => {
  const activeTool = useEditorStore(state => state.activeTool);
  const setActiveTool = useEditorStore(state => state.setActiveTool);
  const pendingRoadStart = useEditorStore(state => state.pendingRoadStart);
  const pendingBypassSource = useEditorStore(state => state.pendingBypassSource);

  React.useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      const tool = TOOLS.find(item => matchesShortcut(event, { key: item.key }));
      if (tool) {
        event.preventDefault();
        setActiveTool(tool.id);
      } else if (matchesShortcut(event, { key: 'Escape' })) {
        event.preventDefault();
        setActiveTool('select');
      }
    };
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  }, [setActiveTool]);

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
          {tool.icon}
          <span>{tool.label}</span>
          <kbd>{tool.key}</kbd>
        </button>
      ))}
      {activeTool === 'add-road' && pendingRoadStart && <div className="tool-hint">Click the outer road endpoint</div>}
      {activeTool === 'connect-bypass' && pendingBypassSource && <div className="tool-hint">Choose a green exit lane on another road · Esc to cancel</div>}
    </div>
  );
};
