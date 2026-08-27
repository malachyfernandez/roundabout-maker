import React from 'react';
import { Settings, X } from 'lucide-react';
import { useEditorStore } from '../editor/editorStore';

export const TopBar: React.FC = () => {
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const settings = useEditorStore(state => state.settings);
  const setSettings = useEditorStore(state => state.setSettings);

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
        data-tooltip="Adjust zoom and pan sensitivity."
        onClick={() => setSettingsOpen(true)}
      >
        <Settings size={16} />
        <span>Settings</span>
      </button>
      {settingsOpen && (
        <div className="settings-overlay" onClick={() => setSettingsOpen(false)}>
          <div className="settings-panel" onClick={e => e.stopPropagation()}>
            <div className="settings-header">
              <strong>Settings</strong>
              <button className="settings-close" onClick={() => setSettingsOpen(false)}>
                <X size={16} />
              </button>
            </div>
            <div className="settings-body">
              <label className="settings-row">
                <div className="settings-label">
                  <strong>Zoom sensitivity</strong>
                  <small>How fast pinch-to-zoom responds</small>
                </div>
                <div className="settings-control">
                  <input
                    type="range"
                    min="0.05"
                    max="1.5"
                    step="0.01"
                    value={settings.zoomSensitivity}
                    onChange={e => setSettings({ zoomSensitivity: Number(e.target.value) })}
                  />
                  <span className="settings-value">{settings.zoomSensitivity.toFixed(2)}</span>
                </div>
              </label>
              <label className="settings-row">
                <div className="settings-label">
                  <strong>Pan sensitivity</strong>
                  <small>How fast two-finger panning responds</small>
                </div>
                <div className="settings-control">
                  <input
                    type="range"
                    min="0.05"
                    max="2"
                    step="0.01"
                    value={settings.panSensitivity}
                    onChange={e => setSettings({ panSensitivity: Number(e.target.value) })}
                  />
                  <span className="settings-value">{settings.panSensitivity.toFixed(2)}</span>
                </div>
              </label>
              <label className="settings-row">
                <div className="settings-label">
                  <strong>Smart zoom</strong>
                  <small>Keep selected controls and drag targets in view</small>
                </div>
                <div className="settings-control">
                  <input type="checkbox" checked={settings.smartZoom} onChange={e => setSettings({ smartZoom: e.target.checked })} />
                </div>
              </label>
              <label className="settings-row">
                <div className="settings-label">
                  <strong>Road guide lightness</strong>
                  <small>How light the road guide lines appear</small>
                </div>
                <div className="settings-control">
                  <input
                    type="range"
                    min="40"
                    max="90"
                    step="1"
                    value={settings.roadGuideLightness}
                    onChange={e => setSettings({ roadGuideLightness: Number(e.target.value) })}
                  />
                  <span className="settings-value">{settings.roadGuideLightness}%</span>
                </div>
              </label>
              <label className="settings-row">
                <div className="settings-label">
                  <strong>Road guide shadow strength</strong>
                  <small>How strong the drop shadow behind road guides appears</small>
                </div>
                <div className="settings-control">
                  <input
                    type="range"
                    min="0"
                    max="1.5"
                    step="0.05"
                    value={settings.roadGuideShadowStrength}
                    onChange={e => setSettings({ roadGuideShadowStrength: Number(e.target.value) })}
                  />
                  <span className="settings-value">{settings.roadGuideShadowStrength.toFixed(2)}</span>
                </div>
              </label>
              <label className="settings-row">
                <div className="settings-label">
                  <strong>Road guide shadow blur</strong>
                  <small>How wide/spread out the drop shadow is</small>
                </div>
                <div className="settings-control">
                  <input
                    type="range"
                    min="0"
                    max="10"
                    step="0.5"
                    value={settings.roadGuideShadowBlur}
                    onChange={e => setSettings({ roadGuideShadowBlur: Number(e.target.value) })}
                  />
                  <span className="settings-value">{settings.roadGuideShadowBlur.toFixed(1)}</span>
                </div>
              </label>
              <label className="settings-row">
                <div className="settings-label">
                  <strong>Road guide shadow Y offset</strong>
                  <small>Shift the shadow up or down to center it</small>
                </div>
                <div className="settings-control">
                  <input
                    type="range"
                    min="-10"
                    max="10"
                    step="0.5"
                    value={settings.roadGuideShadowOffsetY}
                    onChange={e => setSettings({ roadGuideShadowOffsetY: Number(e.target.value) })}
                  />
                  <span className="settings-value">{settings.roadGuideShadowOffsetY.toFixed(1)}</span>
                </div>
              </label>
            </div>
          </div>
        </div>
      )}
    </header>
  );
};
