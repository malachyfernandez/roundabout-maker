import React from 'react';
import { type FeatureKey, useEditorStore } from '../editor/editorStore';

const FEATURES: { key: FeatureKey; label: string; description: string }[] = [
  { key: 'tooltips', label: 'Action tooltips', description: 'Explain every clickable and draggable control at the pointer.' },
  { key: 'creationTools', label: 'Drawing tools', description: 'Enable the Select, Add Road, and Add Ring tools.' },
  { key: 'gizmos', label: 'Direct gizmos', description: 'Show draggable center, radius, lane, and snapping controls.' },
  { key: 'roadProfiles', label: 'Road profiles', description: 'Enable the straightened distance-based road editor.' },
  { key: 'bypassLanes', label: 'Right-turn bypasses', description: 'Enable direct right-turn lane connections between roads.' },
  { key: 'renderedMarkings', label: 'Rendered markings', description: 'Use the semantic pavement-marking system in Rendered Mode.' }
];

export const FeatureBar: React.FC = () => {
  const flags = useEditorStore(state => state.featureFlags);
  const setFeatureFlag = useEditorStore(state => state.setFeatureFlag);
  const enabledCount = FEATURES.filter(feature => flags[feature.key]).length;

  return (
    <header className="feature-bar">
      <div className="feature-brand">
        <span className="feature-brand-mark">RM</span>
        <div>
          <strong>Roundabout Maker</strong>
          <span>Geometry workspace</span>
        </div>
      </div>
      <label className="baseline-switch" data-tooltip={flags.enhancements ? 'Disable every new feature and return to the preserved baseline editor.' : 'Enable the new feature systems without losing their saved data.'}>
        <input
          type="checkbox"
          checked={flags.enhancements}
          onChange={event => setFeatureFlag('enhancements', event.target.checked)}
        />
        <span className="switch-track"><span /></span>
        <span>{flags.enhancements ? 'Enhancements on' : 'Baseline mode'}</span>
      </label>
      <details className="feature-menu">
        <summary data-tooltip="Choose which enhancement systems are included. Disabled features keep their saved data.">
          Features <span>{flags.enhancements ? `${enabledCount}/${FEATURES.length}` : 'paused'}</span>
        </summary>
        <div className="feature-popover">
          <div className="feature-popover-title">
            <strong>Included systems</strong>
            <span>Changes save in this browser</span>
          </div>
          {FEATURES.map(feature => (
            <label key={feature.key} className="feature-row" data-tooltip={feature.description}>
              <span>
                <strong>{feature.label}</strong>
                <small>{feature.description}</small>
              </span>
              <input
                type="checkbox"
                checked={flags[feature.key]}
                disabled={!flags.enhancements}
                onChange={event => setFeatureFlag(feature.key, event.target.checked)}
              />
            </label>
          ))}
        </div>
      </details>
      <div className={`feature-status ${flags.enhancements ? '' : 'baseline'}`}>
        <span /> {flags.enhancements ? 'Modular build' : 'Preserved baseline'}
      </div>
    </header>
  );
};
