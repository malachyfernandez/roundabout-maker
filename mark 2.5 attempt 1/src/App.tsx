import { useEditorStore } from './editor/editorStore';
import { useSolvedGeometry } from './solver/useSolvedGeometry';
import { Sidebar } from './ui/Sidebar';
import { Viewport } from './viewport/Viewport';
import { TopBar } from './ui/TopBar';
import { ActionTooltip } from './ui/ActionTooltip';
import { ToolPalette } from './ui/ToolPalette';
import { UndoBar } from './ui/UndoBar';
import { ToastLayer } from './ui/ToastLayer';
import './index.css';

function App() {
  const committedConfig = useEditorStore(state => state.committedConfig);
  const draftConfig = useEditorStore(state => state.draftConfig);
  const setCommittedConfig = useEditorStore(state => state.setCommittedConfig);

  const activeConfig = draftConfig || committedConfig;
  const { segments, errors } = useSolvedGeometry(activeConfig, {
    profileEnabled: true,
    bypassEnabled: true
  });

  return (
    <div className="app-shell">
      <TopBar />
      <div className="app-workspace">
        <Sidebar config={activeConfig} onChange={setCommittedConfig} errors={errors} />
        <main className="canvas-shell">
          <UndoBar />
          <Viewport segments={segments} />
          <ToolPalette />
        </main>
      </div>
      <ActionTooltip />
      <ToastLayer />
    </div>
  );
}

export default App;
