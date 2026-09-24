import { create } from 'zustand';
import { type RoundaboutConfig, type SelectionTarget } from '../config/types';
import { type Vec2 } from '../math/vector';
import { DEFAULT_CONFIG } from '../core/config';
import { normalizeProfileAnchors } from '../core/profile/anchors';
import { evaluateLane, migrateRoadProfile } from '../core/profile/authored';
import { type PerformancePreset } from './performance';
import { oneSelectionClass, repairSelections, sameSelectionClass, sameSelectionTarget } from './selection';

type DragState = {
  active: boolean;
  type: string;
};

export type ActiveTool = 'select' | 'add-road' | 'add-ring' | 'connect-bypass' | 'calibrate-bg';

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
  roadMarkingLineWidth: number;
  shortDashLength: number;
  shortDashGap: number;
  longDashLength: number;
  longDashGap: number;
  dividerSolidLength: number;
  dividerDottedLength: number;
  yieldSetback: number;
};

export const DEFAULT_SETTINGS: Settings = {
  performancePreset: 'live',
  zoomSensitivity: 0.83,
  panSensitivity: 1.0,
  smartZoom: true,
  roadGuideLightness: 72,
  roadGuideShadowStrength: 0.7,
  roadGuideShadowBlur: 2,
  roadGuideShadowOffsetY: 0,
  ringLaneCollisionBuffer: 0,
  roadMarkingWidthScale: 1,
  roadMarkingLineWidth: .5,
  shortDashLength: 2,
  shortDashGap: 4,
  longDashLength: 10,
  longDashGap: 30,
  dividerSolidLength: 20,
  dividerDottedLength: 24,
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
  selections: SelectionTarget[];
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
  selectTarget: (sel: SelectionTarget, additive?: boolean) => void;
  setSelections: (selections: SelectionTarget[], primary?: SelectionTarget | null) => void;
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
      if (parsed.arms.some(arm => !arm.authoredProfile) && !localStorage.getItem('roundabout_config_legacy_backup')) {
        localStorage.setItem('roundabout_config_legacy_backup', saved);
      }
      return parsed;
    }
  } catch {}
  return structuredClone(DEFAULT_CONFIG);
};

const normalizeEditorConfig = (config: RoundaboutConfig): RoundaboutConfig => {
  const normalized = normalizeProfileAnchors(config);
  for (const arm of normalized.arms) {
    if (arm.authoredProfile || !arm.profile?.length) continue;
    arm.authoredProfile = migrateRoadProfile(arm.profile);
    delete arm.profile;
  }
  return normalized;
};

type LaneScope = { armId: string; dir: 'in' | 'out'; laneIndex: number };

const laneScope = (target: SelectionTarget | null): LaneScope | null => {
  switch (target?.kind) {
    case 'lane':
    case 'lane-node':
    case 'lane-segment':
    case 'profile-control':
      return { armId: target.armId, dir: target.dir, laneIndex: target.laneIndex };
    default:
      return null;
  }
};

const laneScopeKey = (scope: LaneScope) => `${scope.armId}:${scope.dir}:${scope.laneIndex}`;

const releaseNeutralNode = (config: RoundaboutConfig, scope: LaneScope, pointId: string) => {
  const arm = config.arms.find(candidate => candidate.id === scope.armId);
  const document = arm?.authoredProfile;
  const shape = document?.[scope.dir][scope.laneIndex];
  const index = shape?.keys.findIndex(key => key.id === pointId) ?? -1;
  if (!document || !shape || index < 0 || shape.keys.length <= 1) return config;
  const key = shape.keys[index];
  if (document.median.some(candidate => candidate.endAnchor && Math.abs(candidate.distance - key.distance) < 1e-6)) return config;
  if (shape.spans.some(span => (['low', 'high'] as const).some(side => {
    const terminal = span[side];
    return terminal.kind === 'free' && Math.abs(terminal.attach - key.distance) < 1e-6;
  }))) return config;
  const without = { ...shape, keys: shape.keys.filter(candidate => candidate.id !== key.id) };
  const value = evaluateLane(document, without, key.distance);
  if (Math.abs(value.width - key.width) > .01 || Math.abs(value.gap - key.gap) > .01) return config;
  const updated = structuredClone(config);
  updated.arms.find(candidate => candidate.id === scope.armId)!.authoredProfile![scope.dir][scope.laneIndex].keys.splice(index, 1);
  return updated;
};

const MAX_HISTORY = 50;

const repairedSelectionState = (config: RoundaboutConfig, selections: SelectionTarget[], primary: SelectionTarget | null) => {
  const repaired = oneSelectionClass(repairSelections(config, selections), primary);
  const selection = (primary && repaired.find(target => sameSelectionTarget(target, primary))) ?? repaired[repaired.length - 1] ?? null;
  return { selections: repaired, selection };
};

export const useEditorStore = create<EditorState>((set, get) => {
  let pendingDraft: RoundaboutConfig | null | undefined;
  let draftFrame: number | null = null;
  const pendingNodeRelease = new Map<string, { scope: LaneScope; pointIds: Set<string> }>();
  const cancelDraftFrame = () => {
    if (draftFrame !== null) cancelAnimationFrame(draftFrame);
    draftFrame = null;
  };
  const updateSelection = (selection: SelectionTarget | null, selections: SelectionTarget[]) => {
    const current = get();
    const occupied = new Set(selections.flatMap(target => {
      const scope = laneScope(target);
      return scope ? [laneScopeKey(scope)] : [];
    }));
    for (const target of current.selections) {
      if (target.kind !== 'lane-node' && target.kind !== 'profile-control') continue;
      const scope = laneScope(target)!;
      const key = laneScopeKey(scope);
      const entry = pendingNodeRelease.get(key) ?? { scope, pointIds: new Set<string>() };
      entry.pointIds.add(target.pointId);
      pendingNodeRelease.set(key, entry);
    }
    let committedConfig = current.committedConfig;
    for (const [key, entry] of pendingNodeRelease) {
      if (occupied.has(key)) continue;
      pendingNodeRelease.delete(key);
      for (const pointId of entry.pointIds) committedConfig = releaseNeutralNode(committedConfig, entry.scope, pointId);
    }
    if (committedConfig !== current.committedConfig) localStorage.setItem('roundabout_config', JSON.stringify(committedConfig));
    set({ selection, selections, committedConfig });
  };
  const flushDraft = () => {
    if (pendingDraft === undefined) return;
    const draftConfig = pendingDraft && normalizeEditorConfig(pendingDraft);
    pendingDraft = undefined;
    cancelDraftFrame();
    set({ draftConfig });
  };

  return {
  committedConfig: normalizeEditorConfig(getStoredConfig()),
  draftConfig: null,
  selection: null,
  selections: [],
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
    const { committedConfig, undoStack, selection, selections, hovered } = get();
    const normalized = normalizeEditorConfig(config);
    const newUndoStack = [...undoStack, structuredClone(committedConfig)].slice(-MAX_HISTORY);
    localStorage.setItem('roundabout_config', JSON.stringify(normalized));
    set({ committedConfig: normalized, undoStack: newUndoStack, redoStack: [], ...repairedSelectionState(normalized, selections, selection), hovered: (hovered && repairSelections(normalized, [hovered])[0]) ?? null });
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
    const current = get();
    if (selection === null) {
      if (current.selection || current.selections.length) updateSelection(null, []);
    } else if (!sameSelectionTarget(current.selection, selection) || current.selections.length !== 1) {
      updateSelection(selection, [selection]);
    }
  },
  selectTarget: (target, additive = false) => {
    const current = get();
    const index = current.selections.findIndex(selection => sameSelectionTarget(selection, target));
    if (!additive) {
      if (index >= 0) updateSelection(target, current.selections);
      else updateSelection(target, [target]);
      return;
    }
    if (current.selections.some(selection => !sameSelectionClass(selection, target))) {
      updateSelection(target, [target]);
      return;
    }
    if (index >= 0) {
      const selections = current.selections.filter((_, selectionIndex) => selectionIndex !== index);
      updateSelection(selections[selections.length - 1] ?? null, selections);
    } else {
      updateSelection(target, [...current.selections, target]);
    }
  },
  setSelections: (selections, primary) => {
    const unique = selections.filter((target, index) => selections.findIndex(candidate => sameSelectionTarget(candidate, target)) === index);
    const classified = oneSelectionClass(unique, primary);
    const selection = primary === null ? null : (primary && classified.find(target => sameSelectionTarget(target, primary))) ?? classified[classified.length - 1] ?? null;
    updateSelection(selection, classified);
  },
  setHovered: (hovered) => {
    if (!sameSelectionTarget(get().hovered, hovered)) set({ hovered });
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
    const { draftConfig, committedConfig, undoStack, selection, selections, hovered } = get();
    if (draftConfig) {
      const normalized = normalizeEditorConfig(draftConfig);
      const newUndoStack = [...undoStack, structuredClone(committedConfig)].slice(-MAX_HISTORY);
      localStorage.setItem('roundabout_config', JSON.stringify(normalized));
      set({ committedConfig: normalized, draftConfig: null, drag: null, undoStack: newUndoStack, redoStack: [], ...repairedSelectionState(normalized, selections, selection), hovered: (hovered && repairSelections(normalized, [hovered])[0]) ?? null });
    }
  },

  resetToDefault: () => {
    pendingDraft = undefined;
    cancelDraftFrame();
    const { committedConfig, undoStack } = get();
    const config = normalizeEditorConfig(structuredClone(DEFAULT_CONFIG));
    const newUndoStack = [...undoStack, structuredClone(committedConfig)].slice(-MAX_HISTORY);
    localStorage.setItem('roundabout_config', JSON.stringify(config));
    for (const key of ['roundabout_bg', 'roundabout_bgOp', 'roundabout_bgSize', 'roundabout_bgRect', 'roundabout_pan', 'roundabout_zoom']) {
      localStorage.removeItem(key);
    }
    set({ committedConfig: config, draftConfig: null, selection: null, selections: [], hovered: null, drag: null, viewMode: 'editor', activeTool: 'select', pendingRoadStart: null, pendingBypassSource: null, undoStack: newUndoStack, redoStack: [] });
    window.dispatchEvent(new Event('roundabout-reset'));
  },

  undo: () => {
    pendingDraft = undefined;
    cancelDraftFrame();
    const { undoStack, committedConfig, redoStack, selection, selections, hovered } = get();
    if (undoStack.length === 0) return;
    const previous = undoStack[undoStack.length - 1];
    const newRedoStack = [...redoStack, structuredClone(committedConfig)].slice(-MAX_HISTORY);
    localStorage.setItem('roundabout_config', JSON.stringify(previous));
    set({ committedConfig: previous, undoStack: undoStack.slice(0, -1), redoStack: newRedoStack, draftConfig: null, drag: null, ...repairedSelectionState(previous, selections, selection), hovered: (hovered && repairSelections(previous, [hovered])[0]) ?? null });
  },

  redo: () => {
    pendingDraft = undefined;
    cancelDraftFrame();
    const { redoStack, committedConfig, undoStack, selection, selections, hovered } = get();
    if (redoStack.length === 0) return;
    const next = redoStack[redoStack.length - 1];
    const newUndoStack = [...undoStack, structuredClone(committedConfig)].slice(-MAX_HISTORY);
    localStorage.setItem('roundabout_config', JSON.stringify(next));
    set({ committedConfig: next, redoStack: redoStack.slice(0, -1), undoStack: newUndoStack, draftConfig: null, drag: null, ...repairedSelectionState(next, selections, selection), hovered: (hovered && repairSelections(next, [hovered])[0]) ?? null });
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
