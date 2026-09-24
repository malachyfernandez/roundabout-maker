import { afterEach, describe, expect, test, vi } from 'vitest';
import fixture from './utils/hard-roundabout.json';
import flickerFixture from './utils/flicker-unsteady.json';
import type { RoundaboutConfig } from './config/types';
import { compileRoutes } from './core/routes';
import { solveGeometry } from './core/solver';
import { buildMarkings } from './rendering/markings';
import { PERFORMANCE_PRESETS, performancePolicy } from './editor/performance';
import { useEditorStore } from './editor/editorStore';
import { getRoadProfile, estimateArmLength, interpolateProfile } from './core/profile/model';
import { migrateRoadProfile } from './core/profile/authored';
import { normalizeProfileAnchors } from './core/profile/anchors';

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
    expect(buildMarkings(hardConfig, fullSegments, { yieldSetback: 6 })).toHaveLength(196);
  });

  test('preserves sampled lane geometry when migrating the complex regression fixture', () => {
    const original = normalizeProfileAnchors(hardConfig);
    const migrated = structuredClone(original);
    for (const arm of migrated.arms) {
      arm.authoredProfile = migrateRoadProfile(arm.profile!);
      delete arm.profile;
    }
    for (let armIndex = 0; armIndex < original.arms.length; armIndex++) {
      const before = getRoadProfile(original.arms[armIndex], estimateArmLength(original.arms[armIndex]));
      const after = getRoadProfile(migrated.arms[armIndex], estimateArmLength(migrated.arms[armIndex]));
      for (let index = 0; index <= 100; index++) {
        const distance = before[0].distance + (before.at(-1)!.distance - before[0].distance) * index / 100;
        const from = interpolateProfile(before, distance);
        const to = interpolateProfile(after, distance);
        for (const dir of ['lanesIn', 'lanesOut'] as const) for (let lane = 0; lane < from[dir].length; lane++) {
          expect(to[dir][lane]?.width ?? 0).toBeCloseTo(from[dir][lane]?.width ?? 0, 2);
          expect(to[dir][lane]?.gap ?? 0).toBeCloseTo(from[dir][lane]?.gap ?? 0, 2);
        }
      }
    }
    expect(compileRoutes(migrated, { profileEnabled: true, bypassEnabled: true }).length).toBe(
      compileRoutes(original, { profileEnabled: true, bypassEnabled: true }).length
    );
  });

  test('defines live as the default policy', () => {
    expect(useEditorStore.getState().settings.performancePreset).toBe('live');
    expect(PERFORMANCE_PRESETS.balanced.label).toBe('Mostly live with really good performance');
    expect(performancePolicy('balanced')).toMatchObject({ solveDuringDrag: true, markingsDuringDrag: false, effectsDuringInteraction: false });
    expect(performancePolicy('live').markingsDuringDrag).toBe(true);
    expect(performancePolicy('release').solveDuringDrag).toBe(false);
  });

  test('updates automatic cross-sections in the live draft frame', () => {
    let callback: FrameRequestCallback | undefined;
    vi.stubGlobal('requestAnimationFrame', (next: FrameRequestCallback) => { callback = next; return 1; });
    vi.stubGlobal('cancelAnimationFrame', () => {});
    const config = structuredClone(flickerFixture) as RoundaboutConfig;
    config.arms[0].profile!.find(point => point.endAnchor === 'start')!.distance = 0;
    useEditorStore.getState().setDrag({ active: true, type: 'test' });
    useEditorStore.getState().setDraftConfig(config);
    if (!callback) throw new Error('Draft frame was not scheduled');
    callback(0);
    const arm = useEditorStore.getState().draftConfig?.arms[0];
    const anchor = arm && getRoadProfile(arm, estimateArmLength(arm)).find(point => point.endAnchor === 'start');
    expect(anchor?.distance).toBeGreaterThan(50);
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
