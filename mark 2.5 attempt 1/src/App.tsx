import { useEditorStore } from './editor/editorStore';
import { useSolvedGeometry } from './solver/useSolvedGeometry';
import { Sidebar } from './ui/Sidebar';
import { Viewport } from './viewport/Viewport';
import { TopBar } from './ui/TopBar';
import { ActionTooltip } from './ui/ActionTooltip';
import { ToolPalette } from './ui/ToolPalette';
import { UndoBar } from './ui/UndoBar';
import { ToastLayer } from './ui/ToastLayer';
import { performancePolicy } from './editor/performance';
import './index.css';

const EMPTY_ERRORS: string[] = [];

function App() {
  const committedConfig = useEditorStore(state => state.committedConfig);
  const draftConfig = useEditorStore(state => state.draftConfig);
  const setCommittedConfig = useEditorStore(state => state.setCommittedConfig);
  const dragActive = useEditorStore(state => Boolean(state.drag?.active));
  const performancePreset = useEditorStore(state => state.settings.performancePreset);

  const activeConfig = draftConfig || committedConfig;
  const policy = performancePolicy(performancePreset);
  const solverConfig = dragActive && !policy.solveDuringDrag ? committedConfig : activeConfig;
  const { config: renderConfig, segments, errors } = useSolvedGeometry(solverConfig, {
    profileEnabled: true,
    bypassEnabled: true,
    sampleCount: dragActive ? policy.dragSampleCount : 90
  });

  return (
    <div className="app-shell">
      <TopBar />
      <div className="app-workspace">
        <Sidebar config={dragActive ? committedConfig : activeConfig} onChange={setCommittedConfig} errors={dragActive ? EMPTY_ERRORS : errors} />
        <main className="canvas-shell">
          <UndoBar />
          <Viewport renderConfig={renderConfig} segments={segments} />
          <ToolPalette />
        </main>
      </div>
      <ActionTooltip />
      <ToastLayer />
    </div>
  );
}

export default App;
