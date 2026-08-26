import React from 'react';
import { Undo2, Redo2 } from 'lucide-react';
import { useEditorStore } from '../editor/editorStore';

export const UndoBar: React.FC = () => {
  const undo = useEditorStore(state => state.undo);
  const redo = useEditorStore(state => state.redo);
  const undoStack = useEditorStore(state => state.undoStack);
  const redoStack = useEditorStore(state => state.redoStack);

  React.useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement || event.target instanceof HTMLTextAreaElement) return;
      const mod = event.metaKey || event.ctrlKey;
      if (!mod) return;
      if (event.key === 'z' || event.key === 'Z') {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
      } else if (event.key === 'y' || event.key === 'Y') {
        event.preventDefault();
        redo();
      }
    };
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  }, [undo, redo]);

  const canUndo = undoStack.length > 0;
  const canRedo = redoStack.length > 0;

  return (
    <div className="undo-bar">
      <button
        className="undo-btn"
        disabled={!canUndo}
        data-tooltip={canUndo ? 'Undo last change (Ctrl+Z)' : 'Nothing to undo'}
        onClick={undo}
      >
        <Undo2 size={16} />
      </button>
      <button
        className="undo-btn"
        disabled={!canRedo}
        data-tooltip={canRedo ? 'Redo (Ctrl+Shift+Z)' : 'Nothing to redo'}
        onClick={redo}
      >
        <Redo2 size={16} />
      </button>
    </div>
  );
};
