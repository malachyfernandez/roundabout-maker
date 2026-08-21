import { create } from 'zustand';
import { type RoundaboutConfig, type SelectionTarget } from '../config/types';
import { DEFAULT_CONFIG } from '../core/config';

type DragState = {
  active: boolean;
  type: string;
};

interface EditorState {
  committedConfig: RoundaboutConfig;
  draftConfig: RoundaboutConfig | null;
  selection: SelectionTarget | null;
  hovered: SelectionTarget | null;
  drag: DragState | null;
  viewMode: 'preview' | 'rendered';

  setCommittedConfig: (config: RoundaboutConfig) => void;
  setDraftConfig: (config: RoundaboutConfig | null) => void;
  setSelection: (sel: SelectionTarget | null) => void;
  setHovered: (sel: SelectionTarget | null) => void;
  setDrag: (drag: DragState | null) => void;
  setViewMode: (mode: 'preview' | 'rendered') => void;
  commitDraft: () => void;
  resetToDefault: () => void;
}

const getStoredConfig = () => {
  try {
    const saved = localStorage.getItem('roundabout_config');
    if (saved) {
      const parsed = JSON.parse(saved) as RoundaboutConfig;
      // Schema validation: if old format (missing nodes), discard it
      if (parsed.arms && parsed.arms.length > 0 && !parsed.arms[0].nodes) {
        return structuredClone(DEFAULT_CONFIG);
      }
      return parsed;
    }
  } catch {}
  return structuredClone(DEFAULT_CONFIG);
};

export const useEditorStore = create<EditorState>((set, get) => ({
  committedConfig: getStoredConfig(),
  draftConfig: null,
  selection: null,
  hovered: null,
  drag: null,
  viewMode: 'preview',

  setCommittedConfig: (config) => {
    localStorage.setItem('roundabout_config', JSON.stringify(config));
    set({ committedConfig: config });
  },
  
  setDraftConfig: (config) => set({ draftConfig: config }),
  setSelection: (sel) => set({ selection: sel }),
  setHovered: (sel) => set({ hovered: sel }),
  setDrag: (drag) => set({ drag }),
  setViewMode: (mode) => set({ viewMode: mode }),
  
  commitDraft: () => {
    const { draftConfig } = get();
    if (draftConfig) {
      localStorage.setItem('roundabout_config', JSON.stringify(draftConfig));
      set({ committedConfig: draftConfig, draftConfig: null, drag: null });
    }
  },

  resetToDefault: () => {
    const config = structuredClone(DEFAULT_CONFIG);
    localStorage.setItem('roundabout_config', JSON.stringify(config));
    for (const key of ['roundabout_bg', 'roundabout_bgOp', 'roundabout_bgSize', 'roundabout_pan', 'roundabout_zoom']) {
      localStorage.removeItem(key);
    }
    set({ committedConfig: config, draftConfig: null, selection: null, hovered: null, drag: null, viewMode: 'preview' });
    window.dispatchEvent(new Event('roundabout-reset'));
  }
}));
