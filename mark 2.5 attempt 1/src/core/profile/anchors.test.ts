import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../config';
import { convertAnchorToCopy, normalizeProfileAnchors } from './anchors';
import { addProfileLane, moveProfilePoint } from './mutations';
import { estimateArmLength, getRoadProfile } from './model';

const profileOf = (config: typeof DEFAULT_CONFIG, armIndex: number) =>
  getRoadProfile(config.arms[armIndex], estimateArmLength(config.arms[armIndex]));

describe('normalizeProfileAnchors', () => {
  it('moves the existing roundabout anchor instead of adding a new cross-section when lanes change', () => {
    const base = normalizeProfileAnchors(structuredClone(DEFAULT_CONFIG));
    const before = profileOf(base, 0);
    const next = normalizeProfileAnchors(addProfileLane(base, base.arms[0].id, before[before.length - 1].id, 'in', 0));
    const after = profileOf(next, 0);
    expect(after).toHaveLength(before.length);
    expect(after.filter(point => point.endAnchor === 'start')).toHaveLength(1);
    expect(after.filter(point => point.endAnchor === 'end')).toHaveLength(1);
  });

  it('collapses duplicate marked anchors for the same endpoint', () => {
    const base = normalizeProfileAnchors(structuredClone(DEFAULT_CONFIG));
    const arm = base.arms[0];
    arm.profile = profileOf(base, 0);
    const anchor = arm.profile.find(point => point.endAnchor === 'start');
    expect(anchor).toBeTruthy();
    arm.profile.push({ ...structuredClone(anchor!), id: 'stale_anchor_copy' });
    const after = profileOf(normalizeProfileAnchors(base), 0);
    expect(after.filter(point => point.endAnchor === 'start')).toHaveLength(1);
  });

  it('keeps the ending cross-section at the divergence instead of clamping behind a stranded section', () => {
    const base = normalizeProfileAnchors(structuredClone(DEFAULT_CONFIG));
    const arm = base.arms[0];
    const profile = profileOf(base, 0);
    const startCap = profile.find(point => point.endAnchor === 'start')!;
    arm.profile = [...profile, { ...structuredClone(profile[0]), id: 'in_the_way', distance: startCap.distance - 10, endAnchor: undefined }];
    const after = profileOf(normalizeProfileAnchors(base), 0);
    expect(after.find(point => point.endAnchor === 'start')!.distance).toBeCloseTo(startCap.distance);
    expect(after.map(point => point.id)).not.toContain('in_the_way');
  });

  it('deletes cross-sections stranded outside the propper road but keeps interior ones', () => {
    const base = normalizeProfileAnchors(structuredClone(DEFAULT_CONFIG));
    const arm = base.arms[0];
    const profile = profileOf(base, 0);
    const startCap = profile.find(point => point.endAnchor === 'start')!;
    const endCap = profile.find(point => point.endAnchor === 'end')!;
    arm.profile = [
      ...profile,
      { ...structuredClone(profile[0]), id: 'stranded_start', distance: startCap.distance - 5, endAnchor: undefined },
      { ...structuredClone(profile[0]), id: 'interior', distance: (startCap.distance + endCap.distance) / 2, endAnchor: undefined },
      { ...structuredClone(profile[0]), id: 'stranded_end', distance: endCap.distance + 5, endAnchor: undefined }
    ];
    const ids = profileOf(normalizeProfileAnchors(base), 0).map(point => point.id);
    expect(ids).toContain('interior');
    expect(ids).not.toContain('stranded_start');
    expect(ids).not.toContain('stranded_end');
  });

  it('adopts an unmarked section sitting at the anchor position instead of duplicating it', () => {
    const base = normalizeProfileAnchors(structuredClone(DEFAULT_CONFIG));
    const arm = base.arms[0];
    const profile = profileOf(base, 0);
    const endCap = profile.find(point => point.endAnchor === 'end')!;
    arm.profile = [
      ...profile.filter(point => point.id !== endCap.id),
      { ...structuredClone(endCap), id: 'legacy_edge', endAnchor: undefined }
    ];
    const after = profileOf(normalizeProfileAnchors(base), 0);
    expect(after.find(point => point.id === 'legacy_edge')?.endAnchor).toBe('end');
    expect(after.filter(point => point.endAnchor === 'end')).toHaveLength(1);
  });

  it('confines a dragged anchor copy to the propper road', () => {
    const base = normalizeProfileAnchors(structuredClone(DEFAULT_CONFIG));
    const arm = base.arms[0];
    const anchor = profileOf(base, 0).find(point => point.endAnchor === 'start')!;
    const converted = convertAnchorToCopy(base, arm.id, anchor.id);
    const freshAnchor = converted.arms[0].profile!.find(point => point.endAnchor === 'start')!;
    const dragged = moveProfilePoint(converted, arm.id, anchor.id, freshAnchor.distance - 50);
    const copy = dragged.arms[0].profile!.find(point => point.id === anchor.id)!;
    expect(copy.distance).toBeGreaterThan(freshAnchor.distance);
  });
});
