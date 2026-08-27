import React from 'react';
import { Undo2, Redo2 } from 'lucide-react';
import { useEditorStore } from '../editor/editorStore';
import { matchesShortcut, shortcutLabel, type KeyboardShortcut } from './keyboard';

const UNDO_SHORTCUT: KeyboardShortcut = { key: 'Z', mod: true };
const REDO_SHORTCUT: KeyboardShortcut = { key: 'Z', mod: true, shift: true };
const ALTERNATE_REDO_SHORTCUT: KeyboardShortcut = { key: 'Y', mod: true };

export const UndoBar: React.FC = () => {
  const undo = useEditorStore(state => state.undo);
  const redo = useEditorStore(state => state.redo);
  const undoStack = useEditorStore(state => state.undoStack);
  const redoStack = useEditorStore(state => state.redoStack);

  React.useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (matchesShortcut(event, UNDO_SHORTCUT)) {
        event.preventDefault();
        undo();
      } else if (matchesShortcut(event, REDO_SHORTCUT) || matchesShortcut(event, ALTERNATE_REDO_SHORTCUT)) {
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
        data-tooltip={canUndo ? `Undo last change (${shortcutLabel(UNDO_SHORTCUT)})` : 'Nothing to undo'}
        onClick={undo}
      >
        <Undo2 size={16} />
      </button>
      <button
        className="undo-btn"
        disabled={!canRedo}
        data-tooltip={canRedo ? `Redo (${shortcutLabel(REDO_SHORTCUT)})` : 'Nothing to redo'}
        onClick={redo}
      >
        <Redo2 size={16} />
      </button>
    </div>
  );
};
