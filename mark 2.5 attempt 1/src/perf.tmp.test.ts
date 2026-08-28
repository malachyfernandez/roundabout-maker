import { afterEach, describe, expect, test, vi } from 'vitest';
import fixture from './utils/hard-roundabout.json';
import type { RoundaboutConfig } from './config/types';
import { compileRoutes } from './core/routes';
import { solveGeometry } from './core/solver';
import { buildMarkings } from './rendering/markings';
import { PERFORMANCE_PRESETS, performancePolicy } from './editor/performance';
import { useEditorStore } from './editor/editorStore';

const hardConfig = JSON.parse(fixture.roundabout_config) as RoundaboutConfig;

afterEach(() => {
  useEditorStore.setState({ draftConfig: null, drag: null });
  vi.unstubAllGlobals();
});

describe('performance pipeline', () => {
  test('renders the complex regression fixture at full and preview quality', () => {
    const fullSegments = solveGeometry(hardConfig, compileRoutes(hardConfig, { profileEnabled: true, bypassEnabled: true, sampleCount: 90 }));
    const previewSegments = solveGeometry(hardConfig, compileRoutes(hardConfig, { profileEnabled: true, bypassEnabled: true, sampleCount: 60 }));
    expect(fullSegments).toHaveLength(42);
    expect(previewSegments).toHaveLength(42);
    expect(buildMarkings(hardConfig, fullSegments, { yieldSetback: 6 })).toHaveLength(129);
  });

  test('defines balanced as the live-geometry default policy', () => {
    expect(PERFORMANCE_PRESETS.balanced.label).toBe('Mostly live with really good performance');
    expect(performancePolicy('balanced')).toMatchObject({ solveDuringDrag: true, markingsDuringDrag: false, effectsDuringInteraction: false });
    expect(performancePolicy('live').markingsDuringDrag).toBe(true);
    expect(performancePolicy('release').solveDuringDrag).toBe(false);
  });

  test('coalesces draft writes to the latest animation-frame update', () => {
    let nextFrameId = 1;
    const frames = new Map<number, FrameRequestCallback>();
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      const frameId = nextFrameId++;
      frames.set(frameId, callback);
      return frameId;
    });
    vi.stubGlobal('cancelAnimationFrame', (frameId: number) => { frames.delete(frameId); });
    const first = structuredClone(hardConfig);
    const latest = structuredClone(hardConfig);
    first.island.radius = 20;
    latest.island.radius = 25;
    useEditorStore.getState().setDrag({ active: true, type: 'test' });
    useEditorStore.getState().setDraftConfig(first);
    useEditorStore.getState().setDraftConfig(latest);
    expect(useEditorStore.getState().draftConfig).toBeNull();
    const callback = frames.values().next().value;
    if (!callback) throw new Error('Draft frame was not scheduled');
    callback(0);
    expect(useEditorStore.getState().draftConfig?.island.radius).toBe(25);
    useEditorStore.getState().setDraftConfig(null);
    useEditorStore.getState().setDrag(null);
  });
});
