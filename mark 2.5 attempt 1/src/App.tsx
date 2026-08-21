import { isFeatureEnabled, useEditorStore } from './editor/editorStore';
import { useSolvedGeometry } from './solver/useSolvedGeometry';
import { Sidebar } from './ui/Sidebar';
import { Viewport } from './viewport/Viewport';
import { FeatureBar } from './ui/FeatureBar';
import { ActionTooltip } from './ui/ActionTooltip';
import { ToolPalette } from './ui/ToolPalette';
import './index.css';

function App() {
  const committedConfig = useEditorStore(state => state.committedConfig);
  const draftConfig = useEditorStore(state => state.draftConfig);
  const setCommittedConfig = useEditorStore(state => state.setCommittedConfig);
  const featureFlags = useEditorStore(state => state.featureFlags);
  
  const activeConfig = draftConfig || committedConfig;
  const { segments, errors } = useSolvedGeometry(activeConfig, {
    profileEnabled: isFeatureEnabled(featureFlags, 'roadProfiles'),
    bypassEnabled: isFeatureEnabled(featureFlags, 'bypassLanes')
  });

  return (
    <div className="app-shell">
      <FeatureBar />
      <div className="app-workspace">
        <Sidebar config={activeConfig} onChange={setCommittedConfig} errors={errors} />
        <main className="canvas-shell">
          <Viewport segments={segments} />
          <ToolPalette />
        </main>
      </div>
      <ActionTooltip />
    </div>
  );
}

export default App;
