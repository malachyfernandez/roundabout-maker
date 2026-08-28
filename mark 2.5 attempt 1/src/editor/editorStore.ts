import { create } from 'zustand';
import { type RoundaboutConfig, type SelectionTarget } from '../config/types';
import { type Vec2 } from '../math/vector';
import { DEFAULT_CONFIG } from '../core/config';
import { normalizeProfileAnchors } from '../core/profile/anchors';
import { type PerformancePreset } from './performance';

type DragState = {
  active: boolean;
  type: string;
};

export type ActiveTool = 'select' | 'add-road' | 'add-ring' | 'connect-bypass';

export type Settings = {
  performancePreset: PerformancePreset;
  zoomSensitivity: number;
  panSensitivity: number;
  smartZoom: boolean;
  roadGuideLightness: number;
  roadGuideShadowStrength: number;
  roadGuideShadowBlur: number;
  roadGuideShadowOffsetY: number;
  ringLaneCollisionBuffer: number;
  roadMarkingWidthScale: number;
  yieldSetback: number;
};

export const DEFAULT_SETTINGS: Settings = {
  performancePreset: 'balanced',
  zoomSensitivity: 0.83,
  panSensitivity: 1.0,
  smartZoom: true,
  roadGuideLightness: 72,
  roadGuideShadowStrength: 0.7,
  roadGuideShadowBlur: 2,
  roadGuideShadowOffsetY: 0,
  ringLaneCollisionBuffer: 0,
  roadMarkingWidthScale: 1,
  yieldSetback: 6,
};

export type Toast = {
  id: number;
  title: string;
  subtitle?: string;
  dismissible?: boolean;
};

interface EditorState {
  committedConfig: RoundaboutConfig;
  draftConfig: RoundaboutConfig | null;
  selection: SelectionTarget | null;
  hovered: SelectionTarget | null;
  drag: DragState | null;
  viewMode: 'segment' | 'editor' | 'rendered';
  activeTool: ActiveTool;
  pendingRoadStart: Vec2 | null;
  pendingBypassSource: { armId: string; laneIndex: number } | null;
  undoStack: RoundaboutConfig[];
  redoStack: RoundaboutConfig[];
  settings: Settings;
  passThroughStack: string[];
  toasts: Toast[];

  setCommittedConfig: (config: RoundaboutConfig) => void;
  setDraftConfig: (config: RoundaboutConfig | null) => void;
  setSelection: (sel: SelectionTarget | null) => void;
  setHovered: (sel: SelectionTarget | null) => void;
  setDrag: (drag: DragState | null) => void;
  setViewMode: (mode: 'segment' | 'editor' | 'rendered') => void;
  setActiveTool: (tool: ActiveTool) => void;
  setPendingRoadStart: (point: Vec2 | null) => void;
  setPendingBypassSource: (source: { armId: string; laneIndex: number } | null) => void;
  setSettings: (settings: Partial<Settings>) => void;
  commitDraft: () => void;
  resetToDefault: () => void;
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
  addToast: (toast: Omit<Toast, 'id'>) => void;
  dismissToast: (id: number) => void;
  pushPassThrough: (target: string) => void;
  clearPassThrough: () => void;
  removePassThrough: (target: string) => void;
}

const getStoredSettings = (): Settings => {
  try {
    const saved = localStorage.getItem('roundabout_settings');
    if (saved) {
      const parsed = JSON.parse(saved) as Partial<Settings>;
      const performancePreset = parsed.performancePreset && ['live', 'balanced', 'release'].includes(parsed.performancePreset) ? parsed.performancePreset : DEFAULT_SETTINGS.performancePreset;
      return { ...DEFAULT_SETTINGS, ...parsed, performancePreset };
    }
  } catch {}
  return DEFAULT_SETTINGS;
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

const MAX_HISTORY = 50;

const sameTarget = (a: SelectionTarget | null, b: SelectionTarget | null) => {
  if (a === b) return true;
  if (!a || !b || a.kind !== b.kind) return false;
  if (a.kind === 'island' || b.kind === 'island') return true;
  if (a.kind === 'ring' && b.kind === 'ring') return a.ringId === b.ringId;
  if (a.kind === 'arm' && b.kind === 'arm') return a.armId === b.armId;
  if (a.kind === 'profile-point' && b.kind === 'profile-point') return a.armId === b.armId && a.pointId === b.pointId;
  return a.kind === 'lane' && b.kind === 'lane' && a.armId === b.armId && a.dir === b.dir && a.laneIndex === b.laneIndex;
};

export const useEditorStore = create<EditorState>((set, get) => {
  let pendingDraft: RoundaboutConfig | null | undefined;
  let draftFrame: number | null = null;
  const cancelDraftFrame = () => {
    if (draftFrame !== null) cancelAnimationFrame(draftFrame);
    draftFrame = null;
  };
  const flushDraft = () => {
    if (pendingDraft === undefined) return;
    const draftConfig = pendingDraft;
    pendingDraft = undefined;
    cancelDraftFrame();
    set({ draftConfig });
  };

  return {
  committedConfig: normalizeProfileAnchors(getStoredConfig()),
  draftConfig: null,
  selection: null,
  hovered: null,
  drag: null,
  viewMode: 'editor',
  activeTool: 'select',
  pendingRoadStart: null,
  pendingBypassSource: null,
  undoStack: [],
  redoStack: [],
  settings: getStoredSettings(),
  passThroughStack: [],
  toasts: [],

  setCommittedConfig: (config) => {
    pendingDraft = undefined;
    cancelDraftFrame();
    const { committedConfig, undoStack } = get();
    const normalized = normalizeProfileAnchors(config);
    const newUndoStack = [...undoStack, structuredClone(committedConfig)].slice(-MAX_HISTORY);
    localStorage.setItem('roundabout_config', JSON.stringify(normalized));
    set({ committedConfig: normalized, undoStack: newUndoStack, redoStack: [] });
  },

  setDraftConfig: (config) => {
    if (config === null || !get().drag?.active) {
      pendingDraft = undefined;
      cancelDraftFrame();
      set({ draftConfig: config });
      return;
    }
    pendingDraft = config;
    if (draftFrame === null) draftFrame = requestAnimationFrame(flushDraft);
  },
  setSelection: (selection) => {
    if (!sameTarget(get().selection, selection)) set({ selection });
  },
  setHovered: (hovered) => {
    if (!sameTarget(get().hovered, hovered)) set({ hovered });
  },
  setDrag: (drag) => set({ drag }),
  setViewMode: (mode) => set({ viewMode: mode }),
  setActiveTool: (activeTool) => set({ activeTool, pendingRoadStart: null, pendingBypassSource: activeTool === 'connect-bypass' ? get().pendingBypassSource : null }),
  setPendingRoadStart: (pendingRoadStart) => set({ pendingRoadStart }),
  setPendingBypassSource: (pendingBypassSource) => set({ pendingBypassSource }),
  setSettings: (partial) => {
    const settings = { ...get().settings, ...partial };
    localStorage.setItem('roundabout_settings', JSON.stringify(settings));
    set({ settings });
  },

  commitDraft: () => {
    flushDraft();
    const { draftConfig, committedConfig, undoStack } = get();
    if (draftConfig) {
      const normalized = normalizeProfileAnchors(draftConfig);
      const newUndoStack = [...undoStack, structuredClone(committedConfig)].slice(-MAX_HISTORY);
      localStorage.setItem('roundabout_config', JSON.stringify(normalized));
      set({ committedConfig: normalized, draftConfig: null, drag: null, undoStack: newUndoStack, redoStack: [] });
    }
  },

  resetToDefault: () => {
    pendingDraft = undefined;
    cancelDraftFrame();
    const { committedConfig, undoStack } = get();
    const config = normalizeProfileAnchors(structuredClone(DEFAULT_CONFIG));
    const newUndoStack = [...undoStack, structuredClone(committedConfig)].slice(-MAX_HISTORY);
    localStorage.setItem('roundabout_config', JSON.stringify(config));
    for (const key of ['roundabout_bg', 'roundabout_bgOp', 'roundabout_bgSize', 'roundabout_pan', 'roundabout_zoom']) {
      localStorage.removeItem(key);
    }
    set({ committedConfig: config, draftConfig: null, selection: null, hovered: null, drag: null, viewMode: 'editor', activeTool: 'select', pendingRoadStart: null, pendingBypassSource: null, undoStack: newUndoStack, redoStack: [] });
    window.dispatchEvent(new Event('roundabout-reset'));
  },

  undo: () => {
    pendingDraft = undefined;
    cancelDraftFrame();
    const { undoStack, committedConfig, redoStack } = get();
    if (undoStack.length === 0) return;
    const previous = undoStack[undoStack.length - 1];
    const newRedoStack = [...redoStack, structuredClone(committedConfig)].slice(-MAX_HISTORY);
    localStorage.setItem('roundabout_config', JSON.stringify(previous));
    set({ committedConfig: previous, undoStack: undoStack.slice(0, -1), redoStack: newRedoStack, draftConfig: null });
  },

  redo: () => {
    pendingDraft = undefined;
    cancelDraftFrame();
    const { redoStack, committedConfig, undoStack } = get();
    if (redoStack.length === 0) return;
    const next = redoStack[redoStack.length - 1];
    const newUndoStack = [...undoStack, structuredClone(committedConfig)].slice(-MAX_HISTORY);
    localStorage.setItem('roundabout_config', JSON.stringify(next));
    set({ committedConfig: next, redoStack: redoStack.slice(0, -1), undoStack: newUndoStack, draftConfig: null });
  },

  canUndo: () => get().undoStack.length > 0,
  canRedo: () => get().redoStack.length > 0,

  addToast: (toast) => {
    const id = Date.now() + Math.random();
    set(state => ({ toasts: [...state.toasts, { ...toast, id }] }));
  },

  dismissToast: (id) => set(state => ({ toasts: state.toasts.filter(t => t.id !== id) })),

  pushPassThrough: (target) => {
    const { passThroughStack, addToast } = get();
    if (passThroughStack.includes(target)) return;
    const newStack = [...passThroughStack, target];
    set({ passThroughStack: newStack });
    // Describe what's being passed through
    let label = target;
    try {
      const parsed = JSON.parse(target);
      if (parsed.kind === 'lane') label = `${parsed.dir === 'in' ? 'Entry' : 'Exit'} lane ${parsed.laneIndex + 1} on road ${parsed.armId}`;
      else if (parsed.kind === 'arm') label = `Road ${parsed.armId}`;
      else if (parsed.kind === 'ring') label = `Ring ${parsed.ringId}`;
      else if (parsed.kind === 'island') label = 'Center island';
    } catch {}
    addToast({
      title: `Passing through: ${label}`,
      subtitle: 'The item below is now transparent to your cursor. Move off all passed-through items to reset.',
      dismissible: true,
    });
    // Clear hovered so the next pointermove re-evaluates
    set({ hovered: null });
  },

  clearPassThrough: () => set({ passThroughStack: [] }),

  removePassThrough: (target) => set(state => ({
    passThroughStack: state.passThroughStack.filter(t => t !== target)
  }))
  };
});
