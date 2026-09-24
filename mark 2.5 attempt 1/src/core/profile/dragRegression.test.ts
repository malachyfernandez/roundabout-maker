import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { type RoundaboutConfig } from '../../config/types';
import { normalizeProfileAnchors } from './anchors';
import { estimateArmLength, getRoadProfile, interpolateProfile, isProfileLaneNodeAffected, laneBounds, authoredLaneNodeVisible, profileLaneTransitions } from './model';
import { deriveRoadProfile, migrateRoadProfile, laneNodeId } from './authored';
import { pinProfileLaneNodes, setProfileControl } from './mutations';

const fixture = JSON.parse(readFileSync(new URL('../../../../../example-files/big bugged state its all not working/roundabout-export(2).json', import.meta.url), 'utf8')) as Record<string, string>;
const brokenConfig = JSON.parse(fixture.roundabout_config) as RoundaboutConfig;
const newFixture = JSON.parse(readFileSync(new URL('../../../../../example-files/big bugged state its all not working/NEW.json', import.meta.url), 'utf8')) as Record<string, string>;
const newBrokenConfig = JSON.parse(newFixture.roundabout_config) as RoundaboutConfig;
const taperFixture = JSON.parse(readFileSync(new URL('../../../../../example-files/rendering bugs/here.json', import.meta.url), 'utf8')) as Record<string, string>;
const taperBugConfig = JSON.parse(taperFixture.roundabout_config) as RoundaboutConfig;
const endNodeFixture = JSON.parse(readFileSync(new URL('../../../../../example-files/everylane moved/original.json', import.meta.url), 'utf8')) as Record<string, string>;
const endNodeConfig = JSON.parse(endNodeFixture.roundabout_config) as RoundaboutConfig;

const orphanStations = (config: RoundaboutConfig) => config.arms.flatMap(arm => arm.profile ?? [])
  .filter(point => point.id.includes('_station_') && ![...point.lanesIn, ...point.lanesOut].some(lane => lane.node === true));

describe('lane-node drag regression', () => {
  it('preserves sampled lane widths and gaps when migrating saved profiles', () => {
    for (const fixture of [brokenConfig, newBrokenConfig]) {
      const normalized = normalizeProfileAnchors(fixture);
      for (const arm of normalized.arms) {
        const original = getRoadProfile(arm, estimateArmLength(arm));
        const migrated = deriveRoadProfile(migrateRoadProfile(original));
        for (let index = 0; index <= 100; index++) {
          const distance = original[0].distance + (original.at(-1)!.distance - original[0].distance) * index / 100;
          const before = interpolateProfile(original, distance);
          const after = interpolateProfile(migrated, distance);
          for (const side of ['lanesIn', 'lanesOut'] as const) for (let lane = 0; lane < before[side].length; lane++) {
            expect(after[side][lane]?.width ?? 0).toBeCloseTo(before[side][lane]?.width ?? 0, 2);
            expect(after[side][lane]?.gap ?? 0).toBeCloseTo(before[side][lane]?.gap ?? 0, 2);
          }
        }
      }
    }
  });
  it('repairs orphan stations from the supplied repeatedly-dragged state', () => {
    expect(orphanStations(brokenConfig).length).toBeGreaterThan(0);
    expect(orphanStations(normalizeProfileAnchors(brokenConfig))).toHaveLength(0);
  });

  it('drops authored keys swallowed by a taper in the supplied short-taper state', () => {
    const east = taperBugConfig.arms.find(arm => arm.id === 'east')!;
    const shape = east.authoredProfile!.in[1];
    const terminal = shape.spans[0].low;
    expect(terminal).toMatchObject({ kind: 'free' });
    expect(shape.keys.length).toBeGreaterThan(2);

    const normalized = normalizeProfileAnchors(taperBugConfig);
    const fixed = normalized.arms.find(arm => arm.id === 'east')!.authoredProfile!.in[1];
    const fixedTerminal = fixed.spans[0].low;
    expect(fixedTerminal).toMatchObject({ kind: 'free' });
    if (fixedTerminal.kind !== 'free') return;
    const lo = Math.min(fixedTerminal.tip, fixedTerminal.attach);
    const hi = Math.max(fixedTerminal.tip, fixedTerminal.attach);
    for (const key of fixed.keys) expect(key.distance <= lo || key.distance >= hi).toBe(true);
    // The tip key pins the taper tip's editable offset at its station.
    expect(fixed.keys.some(key => Math.abs(key.distance - fixedTerminal.tip) < 1e-6)).toBe(true);
    expect(fixed.keys.length).toBeLessThanOrEqual(shape.keys.length);
  });

  it('repairs no-op nodes and terminal points from NEW.json', () => {
    const brokenEast = newBrokenConfig.arms.find(arm => arm.id === 'east')!;
    expect(brokenEast.profile!.filter(point => point.lanesIn.some(lane => lane.node)).length).toBeGreaterThan(5);

    const repaired = normalizeProfileAnchors(newBrokenConfig);
    const east = repaired.arms.find(arm => arm.id === 'east')!;
    east.authoredProfile = migrateRoadProfile(east.profile!);
    delete east.profile;
    const profile = getRoadProfile(east, estimateArmLength(east));
    const visibleNodes = profile.filter((_, pointIndex) => isProfileLaneNodeAffected(profile, pointIndex, 'in', 1));
    expect(visibleNodes).toHaveLength(0);
    expect(profile).toHaveLength(2);
    expect(profileLaneTransitions(profile, 'in').filter(transition => transition.laneIndex === 1)).toHaveLength(2);
    for (const distance of [profile[0].distance, (profile[0].distance + profile[1].distance) / 2, profile[1].distance]) {
      expect(interpolateProfile(profile, distance).lanesIn[1]).toMatchObject({ width: 10, gap: 0 });
    }
  });

  it('moves only the dragged road-end node sideways in the supplied lane state', () => {
    // east out[2] spans the road capped at both ends; the exit lane inside it
    // tapers in, kinking its centerline at ~72.95 and ~106.74. Those kinks
    // render as nodes, so shifting the end node's gap used to drag them all.
    const arm = endNodeConfig.arms.find(candidate => candidate.id === 'east')!;
    const profile = getRoadProfile(arm, estimateArmLength(arm));
    const centerline = (cfg: RoundaboutConfig, distance: number) => {
      const derived = getRoadProfile(cfg.arms.find(candidate => candidate.id === 'east')!, estimateArmLength(arm));
      const bounds = laneBounds(interpolateProfile(derived, distance), 'out', 2);
      return (bounds.inner + bounds.outer) / 2;
    };
    const visible = profile.map((_, index) => authoredLaneNodeVisible(profile, index, 'out', 2));
    expect(visible).toEqual([false, true, true, false]);
    const neighbor = profile[2];
    const neighborId = laneNodeId(arm, neighbor, 'out', 2);
    const pinned = pinProfileLaneNodes(endNodeConfig, [
      { armId: 'east', dir: 'out', laneIndex: 2, pointId: neighborId, distance: neighbor.distance }
    ]);
    const endKey = arm.authoredProfile!.out[2].keys.find(key => key.distance === 150)!;
    const edited = setProfileControl(pinned, 'east', endKey.id, 'out', 'gap', 12.98, 2, true);
    for (const point of profile.slice(0, -1)) {
      expect(centerline(edited, point.distance)).toBeCloseTo(centerline(endNodeConfig, point.distance));
      expect(centerline(edited, (point.distance + 106.74165001511574) / 2)).toBeCloseTo(centerline(endNodeConfig, (point.distance + 106.74165001511574) / 2));
    }
    expect(centerline(edited, 150)).toBeCloseTo(centerline(endNodeConfig, 150) + 12.98);
  });
});
