import { create } from 'zustand';
import { type RoundaboutConfig, type SelectionTarget } from '../config/types';
import { type Vec2 } from '../math/vector';
import { DEFAULT_CONFIG } from '../core/config';

type DragState = {
  active: boolean;
  type: string;
};

export type FeatureFlags = {
  enhancements: boolean;
  tooltips: boolean;
  creationTools: boolean;
  gizmos: boolean;
  roadProfiles: boolean;
  bypassLanes: boolean;
  renderedMarkings: boolean;
};

export type FeatureKey = Exclude<keyof FeatureFlags, 'enhancements'>;
export type ActiveTool = 'select' | 'add-road' | 'add-ring' | 'connect-bypass';

export const DEFAULT_FEATURE_FLAGS: FeatureFlags = {
  enhancements: true,
  tooltips: true,
  creationTools: true,
  gizmos: true,
  roadProfiles: true,
  bypassLanes: true,
  renderedMarkings: true
};

export function isFeatureEnabled(flags: FeatureFlags, key: FeatureKey) {
  return flags.enhancements && flags[key];
}

interface EditorState {
  committedConfig: RoundaboutConfig;
  draftConfig: RoundaboutConfig | null;
  selection: SelectionTarget | null;
  hovered: SelectionTarget | null;
  drag: DragState | null;
  viewMode: 'segment' | 'editor' | 'rendered';
  featureFlags: FeatureFlags;
  activeTool: ActiveTool;
  pendingRoadStart: Vec2 | null;
  pendingBypassSource: { armId: string; laneIndex: number } | null;

  setCommittedConfig: (config: RoundaboutConfig) => void;
  setDraftConfig: (config: RoundaboutConfig | null) => void;
  setSelection: (sel: SelectionTarget | null) => void;
  setHovered: (sel: SelectionTarget | null) => void;
  setDrag: (drag: DragState | null) => void;
  setViewMode: (mode: 'segment' | 'editor' | 'rendered') => void;
  setFeatureFlag: (key: keyof FeatureFlags, enabled: boolean) => void;
  setActiveTool: (tool: ActiveTool) => void;
  setPendingRoadStart: (point: Vec2 | null) => void;
  setPendingBypassSource: (source: { armId: string; laneIndex: number } | null) => void;
  commitDraft: () => void;
  resetToDefault: () => void;
}

const getStoredFeatureFlags = (): FeatureFlags => {
  try {
    const saved = localStorage.getItem('roundabout_feature_flags');
    if (saved) return { ...DEFAULT_FEATURE_FLAGS, ...JSON.parse(saved) };
  } catch {}
  return DEFAULT_FEATURE_FLAGS;
};

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
  viewMode: 'editor',
  featureFlags: getStoredFeatureFlags(),
  activeTool: 'select',
  pendingRoadStart: null,
  pendingBypassSource: null,

  setCommittedConfig: (config) => {
    localStorage.setItem('roundabout_config', JSON.stringify(config));
    set({ committedConfig: config });
  },
  
  setDraftConfig: (config) => set({ draftConfig: config }),
  setSelection: (sel) => set({ selection: sel }),
  setHovered: (sel) => set({ hovered: sel }),
  setDrag: (drag) => set({ drag }),
  setViewMode: (mode) => set({ viewMode: mode }),
  setFeatureFlag: (key, enabled) => set(state => {
    const featureFlags = { ...state.featureFlags, [key]: enabled };
    localStorage.setItem('roundabout_feature_flags', JSON.stringify(featureFlags));
    return {
      featureFlags,
      activeTool: featureFlags.enhancements ? state.activeTool : 'select',
      pendingRoadStart: null,
      pendingBypassSource: null,
      draftConfig: null,
      drag: null
    };
  }),
  setActiveTool: (activeTool) => set({ activeTool, pendingRoadStart: null, pendingBypassSource: activeTool === 'connect-bypass' ? get().pendingBypassSource : null }),
  setPendingRoadStart: (pendingRoadStart) => set({ pendingRoadStart }),
  setPendingBypassSource: (pendingBypassSource) => set({ pendingBypassSource }),
  
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
    set({ committedConfig: config, draftConfig: null, selection: null, hovered: null, drag: null, viewMode: 'editor', activeTool: 'select', pendingRoadStart: null, pendingBypassSource: null });
    window.dispatchEvent(new Event('roundabout-reset'));
  }
}));
