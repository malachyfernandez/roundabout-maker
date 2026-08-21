import { useEditorStore } from './editor/editorStore';
import { useSolvedGeometry } from './solver/useSolvedGeometry';
import { Sidebar } from './ui/Sidebar';
import { Viewport } from './viewport/Viewport';
import './index.css';

function App() {
  const committedConfig = useEditorStore(state => state.committedConfig);
  const draftConfig = useEditorStore(state => state.draftConfig);
  const setCommittedConfig = useEditorStore(state => state.setCommittedConfig);
  
  const activeConfig = draftConfig || committedConfig;
  const { segments, errors } = useSolvedGeometry(activeConfig);

  return (
    <div style={{ display: 'flex', height: '100vh', width: '100vw', overflow: 'hidden' }}>
      <Sidebar config={activeConfig} onChange={setCommittedConfig} errors={errors} />
      <div style={{ flex: 1, position: 'relative' }}>
        <Viewport segments={segments} />
      </div>
    </div>
  );
}

export default App;
