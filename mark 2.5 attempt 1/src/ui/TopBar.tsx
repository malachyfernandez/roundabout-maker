import React from 'react';
import { RotateCcw, Settings } from 'lucide-react';
import { SettingsPanel } from './SettingsPanel';

export const TopBar: React.FC = React.memo(() => {
  const [settingsOpen, setSettingsOpen] = React.useState(false);

  return (
    <header className="feature-bar">
      <div className="feature-brand">
        <span className="feature-brand-mark">RM</span>
        <div>
          <strong>Roundabout Maker</strong>
          <span>Geometry workspace</span>
        </div>
      </div>
      <button
        className="settings-button"
        data-tooltip="Reset canvas pan and zoom without changing the design."
        onClick={() => window.dispatchEvent(new Event('roundabout-reset-view'))}
      >
        <RotateCcw size={16} />
        <span>Reset View</span>
      </button>
      <button
        className="settings-button"
        data-tooltip="Adjust interaction and road-marking settings."
        onClick={() => setSettingsOpen(true)}
      >
        <Settings size={16} />
        <span>Settings</span>
      </button>
      {settingsOpen && <SettingsPanel onClose={() => setSettingsOpen(false)} />}
    </header>
  );
});
