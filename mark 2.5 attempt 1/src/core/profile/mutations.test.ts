import { describe, expect, it } from 'vitest';
import { type RoundaboutConfig, type SelectionTarget } from '../../config/types';
import { addProfileLane, addProfilePoint, moveProfileLanePoint, moveProfileLaneTerminal, moveProfileLaneTransition, moveProfilePoint, pinProfileLaneNodes, removeProfileLane, removeProfileLanePoint, removeProfileLaneSegment, removeProfilePoint, setProfileControl } from './mutations';
import { authoredLaneNodeVisible, canonicalizeRoadProfile, estimateArmLength, getRoadProfile, interpolateProfile, isProfileLaneNodeAffected, laneBounds, profileLaneTransitions, sampleProfile } from './model';
import { deriveRoadProfile, ensureTaperTipKeys, evaluateLane, findLanePoint, laneAttachmentIndex, laneNodeId, migrateRoadProfile, moveLaneAttachment, moveLaneTerminal, pruneTaperInteriorKeys } from './authored';
import { selectionExists } from '../../editor/selection';
import { duplicateSelectionOwners } from '../../editor/duplicate';

const config = (): RoundaboutConfig => ({
  island: { center: { x: 0, y: 0 }, radius: 20 },
  rings: [],
  circulation: 'ccw',
  arms: [{
    id: 'arm',
    nodes: [
      { id: 'near', point: { x: 0, y: 0 }, medianWidth: 4, laneWidthsIn: [10], laneWidthsOut: [10] },
      { id: 'far', point: { x: 0, y: 30 }, medianWidth: 4, laneWidthsIn: [10], laneWidthsOut: [10] }
    ],
    lanesIn: [{ filletRadius: 40 }],
    lanesOut: [{ filletRadius: 40, dropsRing: false }],
    profile: [
      { id: 'a', distance: 0, medianWidth: 4, lanesIn: [{ width: 10, gap: 0 }], lanesOut: [{ width: 10, gap: 0 }], endAnchor: 'start' as const },
      { id: 'b', distance: 10, medianWidth: 4, lanesIn: [{ width: 0, gap: 0 }], lanesOut: [{ width: 10, gap: 0 }] },
      { id: 'c', distance: 20, medianWidth: 4, lanesIn: [{ width: 0, gap: 0 }], lanesOut: [{ width: 10, gap: 0 }] },
      { id: 'd', distance: 30, medianWidth: 4, lanesIn: [{ width: 0, gap: 0 }], lanesOut: [{ width: 10, gap: 0 }], endAnchor: 'end' as const }
    ]
  }],
  bypasses: [{ id: 'bypass', fromArmId: 'arm', fromLaneIndex: 0, toArmId: 'arm', toLaneIndex: 0, entryRadius: 20, exitRadius: 20, lanePoint: { x: 0, y: 0 }, laneAngle: 0 }]
});

const canonicalizeConfig = (source: RoundaboutConfig) => {
  const next = structuredClone(source);
  for (const arm of next.arms) arm.profile = canonicalizeRoadProfile(getRoadProfile(arm, estimateArmLength(arm)));
  return next;
};

// An authored arm whose out-lane ends in a free taper: tip at 25, attachment
// at 9 (the default 16 ft taper pulled back from the end cap).
const freeTipConfig = () => {
  const source = config();
  source.arms[0].authoredProfile = migrateRoadProfile(source.arms[0].profile!);
  delete source.arms[0].profile;
  const capBoundary = getRoadProfile(source.arms[0], estimateArmLength(source.arms[0])).length - 1;
  return moveProfileLaneTerminal(source, 'arm', 'out', 0, capBoundary, 25);
};

describe('profile mutations', () => {
  it('propagates a width change through consecutive downstream points sharing the original width', () => {
    const source = config();
    const next = setProfileControl(source, 'arm', 'b', 'out', 'width', 14);
    expect(next.arms[0].profile?.map(point => point.lanesOut[0].width)).toEqual([10, 14, 14, 14]);
    expect(source.arms[0].profile?.[1].lanesOut[0].width).toBe(10);
  });

  it('stops width propagation at the first downstream point whose original width differs', () => {
    const source = config();
    source.arms[0].profile![3].lanesOut[0].width = 8;
    const next = setProfileControl(source, 'arm', 'b', 'out', 'width', 14);
    expect(next.arms[0].profile?.map(point => point.lanesOut[0].width)).toEqual([10, 14, 14, 8]);
  });

  it('propagates a gap change through consecutive downstream points sharing the original total offset', () => {
    const source = config();
    const next = setProfileControl(source, 'arm', 'a', 'out', 'gap', 6);
    expect(next.arms[0].profile?.map(point => point.lanesOut[0].gap)).toEqual([6, 6, 6, 6]);
  });

  it('stops gap propagation at the first downstream point whose total offset differs', () => {
    const source = config();
    source.arms[0].profile![1].lanesOut[0].gap = 5;
    const next = setProfileControl(source, 'arm', 'a', 'out', 'gap', 6);
    expect(next.arms[0].profile?.map(point => point.lanesOut[0].gap)).toEqual([6, 5, 0, 0]);
  });

  it('limits gap and width changes to the dragged cross-section when isolated', () => {
    const source = config();
    expect(setProfileControl(source, 'arm', 'a', 'out', 'gap', 6, 0, true).arms[0].profile?.map(point => point.lanesOut[0].gap)).toEqual([6, 0, 0, 0]);
    expect(setProfileControl(source, 'arm', 'b', 'out', 'width', 14, 0, true).arms[0].profile?.map(point => point.lanesOut[0].width)).toEqual([10, 14, 10, 10]);
  });

  it('propagates a gap change across points whose total offset matches despite differing gap values', () => {
    const source = config();
    source.arms[0].lanesOut.push({ filletRadius: 40, dropsRing: false });
    source.arms[0].nodes.forEach(node => node.laneWidthsOut.push(10));
    for (const point of source.arms[0].profile!) {
      point.lanesOut.push({ width: 10, gap: 0 });
      point.lanesOut[0] = { width: 10, gap: 0 };
    }
    source.arms[0].profile![0].lanesOut[0] = { width: 0, gap: 0 };
    source.arms[0].profile![0].lanesOut[1] = { width: 10, gap: 10 };
    source.arms[0].profile![1].lanesOut[0] = { width: 10, gap: 0 };
    source.arms[0].profile![1].lanesOut[1] = { width: 10, gap: 0 };
    source.arms[0].profile![2].lanesOut[0] = { width: 0, gap: 0 };
    source.arms[0].profile![2].lanesOut[1] = { width: 10, gap: 0 };
    const next = setProfileControl(source, 'arm', 'a', 'out', 'gap', 14, 1);
    expect(next.arms[0].profile?.[0].lanesOut[1].gap).toBe(14);
    expect(next.arms[0].profile?.[1].lanesOut[1].gap).toBe(4);
    expect(next.arms[0].profile?.[2].lanesOut[1].gap).toBe(0);
    expect(next.arms[0].profile?.[3].lanesOut[1].gap).toBe(0);
  });

  it('moves a lane transition while preserving values without cloning node ownership', () => {
    const source = config();
    source.arms[0].profile![0].lanesIn[0].node = true;
    const next = moveProfileLaneTransition(source, 'arm', 'in', 0, 0, 2);
    expect(next.arms[0].profile?.map(point => point.lanesIn[0].width)).toEqual([10, 10, 10, 0]);
    expect(next.arms[0].profile?.map(point => point.lanesIn[0].node)).toEqual([true, false, false, false]);
  });

  it('pulls a lane start or end inward from a cap-end transition', () => {
    expect(moveProfileLaneTransition(config(), 'arm', 'out', 0, 3, 1).arms[0].profile?.map(point => point.lanesOut[0].width)).toEqual([10, 10, 0, 0]);
    expect(moveProfileLaneTransition(config(), 'arm', 'out', 0, -1, 1).arms[0].profile?.map(point => point.lanesOut[0].width)).toEqual([0, 0, 10, 10]);
  });

  it('extends a lane onto a cap-end when its transition is dragged there', () => {
    const source = config();
    source.arms[0].profile![0].lanesIn[0].width = 0;
    source.arms[0].profile![1].lanesIn[0].width = 10;
    const next = moveProfileLaneTransition(source, 'arm', 'in', 0, 0, -1);
    expect(next.arms[0].profile?.map(point => point.lanesIn[0].width)).toEqual([10, 10, 0, 0]);
  });

  it('slides a lane terminal and its linked node while keeping the taper distance', () => {
    // lanesIn [10, 0, 0, 0] → the in-lane START transition sits at boundary 0;
    // the tip is section b (absent) and the linked node is section a.
    const next = moveProfileLaneTerminal(config(), 'arm', 'in', 0, 0, 18);
    expect(next.arms[0].profile?.map(point => point.lanesIn[0].width)).toEqual([10, 10, 0, 0]);
    expect(next.arms[0].profile?.map(point => point.distance)).toEqual([0, 8, 18, 30]);
  });

  it('slides a lane start terminal and its linked node as a pair', () => {
    const source = config();
    source.arms[0].profile!.forEach((point, index) => point.lanesOut[0] = { width: index < 2 ? 0 : 10, gap: 0 });
    // lanesOut [0, 0, 10, 10] → START transition at boundary 1, tip at section b,
    // linked node at section c; sliding to 15 keeps the 10 ft taper.
    const next = moveProfileLaneTerminal(source, 'arm', 'out', 0, 1, 15);
    expect(next.arms[0].profile?.map(point => point.distance)).toEqual([0, 15, 25, 30]);
    expect(next.arms[0].profile?.map(point => point.lanesOut[0].width)).toEqual([0, 0, 10, 10]);
  });

  it('unsnaps a cap-end terminal into a synchronized free terminal pair', () => {
    // lanesOut spans the whole road; its END is snapped at boundary 3 (the far
    // cap). Pulling it free creates fresh tip and attachment stations with a
    // short 4 ft taper instead of consuming the existing 10 ft stations.
    const next = moveProfileLaneTerminal(config(), 'arm', 'out', 0, 3, 25);
    expect(next.arms[0].profile?.map(point => point.lanesOut[0].width)).toEqual([10, 10, 10, 10, 0, 0]);
    expect(next.arms[0].profile?.map(point => point.distance)).toEqual([0, 10, 20, 21, 25, 30]);
    expect(next.arms[0].profile?.filter(point => point.lanesOut[0].node).map(point => point.distance)).toEqual([21]);
  });

  it('snaps a terminal pushed past the road end onto the cap-end', () => {
    const source = config();
    source.arms[0].profile!.forEach((point, index) => point.lanesIn[0] = { width: index < 3 ? 10 : 0, gap: 0 });
    // lanesIn [10, 10, 10, 0] → END transition at boundary 2, the outermost on
    // the high side, so dragging past the cap-end snaps to boundary 3.
    const next = moveProfileLaneTerminal(source, 'arm', 'in', 0, 2, 35, 5);
    expect(next.arms[0].profile?.map(point => point.lanesIn[0].width)).toEqual([10, 10, 10, 10]);
  });

  it('keeps a terminal from crossing the lane’s next transition', () => {
    const source = config();
    source.arms[0].profile![2].lanesIn[0] = { width: 10, gap: 0 };
    // lanesIn [10, 0, 10, 0] → boundaries -1, 0, 1, 2; the boundary-0 terminal
    // cannot hop past boundary 1, so its tip stays on section b and just slides.
    const next = moveProfileLaneTerminal(source, 'arm', 'in', 0, 0, 28);
    expect(next.arms[0].profile?.map(point => point.lanesIn[0].width)).toEqual([10, 0, 10, 0]);
    expect(next.arms[0].profile?.[1].distance).toBe(19);
  });

  it('pulls a start-cap terminal inward with its new attachment', () => {
    // The out-lane START is snapped at boundary -1 (the near cap); dragging it
    // to 15 creates a fresh attachment only 4 ft farther along the road.
    const next = moveProfileLaneTerminal(config(), 'arm', 'out', 0, -1, 15);
    expect(next.arms[0].profile?.map(point => point.lanesOut[0].width)).toEqual([0, 0, 0, 10, 10, 10]);
    expect(next.arms[0].profile?.map(point => point.distance)).toEqual([0, 10, 15, 19, 20, 30]);
    expect(next.arms[0].profile?.filter(point => point.lanesOut[0].node).map(point => point.distance)).toEqual([19]);
  });

  it('does not accumulate nodes while a terminal moves back and forth and repeatedly re-snaps', () => {
    let current = canonicalizeConfig(config());
    const laneProfile = () => getRoadProfile(current.arms[0], estimateArmLength(current.arms[0]));
    const highTerminal = () => profileLaneTransitions(laneProfile(), 'out')
      .filter(transition => transition.laneIndex === 0 && transition.fromPresent && !transition.toPresent)
      .at(-1)!;

    for (let cycle = 0; cycle < 3; cycle++) {
      const snappedProfile = laneProfile();
      current = canonicalizeConfig(moveProfileLaneTerminal(current, 'arm', 'out', 0, snappedProfile.length - 1, 25));
      for (const target of [20, 27, 18]) {
        current = canonicalizeConfig(moveProfileLaneTerminal(current, 'arm', 'out', 0, highTerminal().boundaryIndex, target));
        const profile = laneProfile();
        expect(profile.filter((_, pointIndex) => isProfileLaneNodeAffected(profile, pointIndex, 'out', 0))).toHaveLength(1);
        expect(profileLaneTransitions(profile, 'out').filter(transition => transition.laneIndex === 0)).toHaveLength(2);
      }
      current = canonicalizeConfig(moveProfileLaneTerminal(current, 'arm', 'out', 0, highTerminal().boundaryIndex, 35, 5));
      const resnapped = laneProfile();
      expect(resnapped.filter(point => point.lanesOut[0].node)).toHaveLength(0);
      expect(resnapped.filter(point => point.id.includes('_profile_terminal_'))).toHaveLength(0);
      expect(resnapped).toHaveLength(4);
    }
  });

  it('keeps authored road and lane keys when a computed road cap moves inward and back', () => {
    const document = migrateRoadProfile(config().arms[0].profile!);
    document.median.splice(1, 0, { id: 'median-bend', distance: 5, width: 6 });
    document.out[0].keys.splice(1, 0, { id: 'lane-bend', distance: 5, width: 12, gap: 0 });
    document.median.find(key => key.endAnchor === 'start')!.distance = 10;
    document.median.sort((a, b) => a.distance - b.distance);
    expect(deriveRoadProfile(document).map(point => point.distance)).toEqual([10, 30]);
    document.median.find(key => key.endAnchor === 'start')!.distance = 0;
    document.median.sort((a, b) => a.distance - b.distance);
    expect(deriveRoadProfile(document).map(point => point.distance)).toEqual([0, 5, 10, 30]);
  });

  it('migrates legacy tapers without changing sampled widths', () => {
    const legacy = config().arms[0].profile!;
    const derived = deriveRoadProfile(migrateRoadProfile(legacy));
    for (const distance of [0, 2, 5, 8, 10, 15, 20, 25, 30]) {
      const actual = interpolateProfile(derived, distance);
      const expected = interpolateProfile(legacy, distance);
      expect(actual.lanesIn[0].width).toBeCloseTo(expected.lanesIn[0].width);
      expect(actual.lanesOut[0].width).toBeCloseTo(expected.lanesOut[0].width);
    }
  });

  it('shows inherited dots only where the evaluated lane actually bends', () => {
    const source = config();
    source.arms[0].lanesOut.push({ dropsRing: false });
    source.arms[0].nodes.forEach(node => node.laneWidthsOut.push(10));
    for (const point of source.arms[0].profile!) point.lanesOut.push({ width: 10, gap: 0 });
    const arm = source.arms[0];
    arm.authoredProfile = migrateRoadProfile(arm.profile!);
    delete arm.profile;
    const added = addProfilePoint(source, 'arm', 15, 'out', 0).config;
    const neutral = getRoadProfile(added.arms[0], estimateArmLength(added.arms[0]));
    const index = neutral.findIndex(point => point.distance === 15);
    expect(authoredLaneNodeVisible(neutral, index, 'out', 0)).toBe(true);
    expect(authoredLaneNodeVisible(neutral, index, 'out', 1)).toBe(false);
    const own = added.arms[0].authoredProfile!.out[0].keys.find(key => key.distance === 15)!;
    const changed = setProfileControl(added, 'arm', own.id, 'out', 'width', 14, 0, true);
    const derived = getRoadProfile(changed.arms[0], estimateArmLength(changed.arms[0]));
    expect(authoredLaneNodeVisible(derived, derived.findIndex(point => point.distance === 15), 'out', 1)).toBe(true);
  });

  it('selects independent lane keys at the same distance', () => {
    const source = config();
    source.arms[0].lanesOut.push({ dropsRing: false });
    source.arms[0].nodes.forEach(node => node.laneWidthsOut.push(10));
    for (const point of source.arms[0].profile!) point.lanesOut.push({ width: 10, gap: 0 });
    source.arms[0].profile![1].lanesOut[0].width = 12;
    source.arms[0].profile![1].lanesOut[1].width = 14;
    const arm = source.arms[0];
    arm.authoredProfile = migrateRoadProfile(arm.profile!);
    delete arm.profile;
    const point = getRoadProfile(arm, estimateArmLength(arm)).find(item => item.distance === 10)!;
    const first = laneNodeId(arm, point, 'out', 0);
    const second = laneNodeId(arm, point, 'out', 1);
    expect(first).not.toBe(second);
    for (const [laneIndex, pointId] of [[0, first], [1, second]] as const) {
      expect(selectionExists(source, { kind: 'lane-node', armId: 'arm', dir: 'out', laneIndex, pointId })).toBe(true);
    }
    const moved = moveProfileLanePoint(source, 'arm', second, 'out', 1, 15);
    expect(moved.arms[0].authoredProfile!.out[0].keys.find(key => key.id === first)?.distance).toBe(10);
    expect(moved.arms[0].authoredProfile!.out[1].keys.find(key => key.id === second)?.distance).toBe(15);
  });

  it('moves a taper attachment without silently adding a lane shape key', () => {
    const source = config();
    source.arms[0].authoredProfile = migrateRoadProfile(source.arms[0].profile!);
    delete source.arms[0].profile;
    const capBoundary = getRoadProfile(source.arms[0], estimateArmLength(source.arms[0])).length - 1;
    const free = moveProfileLaneTerminal(source, 'arm', 'out', 0, capBoundary, 25);
    const shape = free.arms[0].authoredProfile!.out[0];
    const attachment = getRoadProfile(free.arms[0], estimateArmLength(free.arms[0])).find(point => Math.abs(point.distance - 9) < 1e-6)!;
    const moved = moveProfileLanePoint(free, 'arm', attachment.id, 'out', 0, 20);
    const preview = setProfileControl(moved, 'arm', attachment.id, 'out', 'gap', 0, 0);
    expect(preview.arms[0].authoredProfile!.out[0].keys).toEqual(shape.keys);
    expect(preview.arms[0].authoredProfile!.out[0].spans[0].high).toMatchObject({ kind: 'free', tip: 25, attach: 20 });
  });

  it('keeps a sideways-edited attachment synchronized while moving and snapping its terminal', () => {
    const source = config();
    source.arms[0].authoredProfile = migrateRoadProfile(source.arms[0].profile!);
    delete source.arms[0].profile;
    const capBoundary = getRoadProfile(source.arms[0], estimateArmLength(source.arms[0])).length - 1;
    let current = moveProfileLaneTerminal(source, 'arm', 'out', 0, capBoundary, 25);
    const attachment = getRoadProfile(current.arms[0], estimateArmLength(current.arms[0])).find(point => point.distance === 9)!;
    current = setProfileControl(current, 'arm', attachment.id, 'out', 'gap', 6, 0, true);
    expect(current.arms[0].authoredProfile!.out[0].keys.find(key => key.distance === 9)?.gap).toBe(6);
    for (const target of [18, 22, 17]) {
      const profile = getRoadProfile(current.arms[0], estimateArmLength(current.arms[0]));
      const boundary = profileLaneTransitions(profile, 'out').find(item => item.laneIndex === 0 && item.fromPresent && !item.toPresent)!;
      current = moveProfileLaneTerminal(current, 'arm', 'out', 0, boundary.boundaryIndex, target);
      const end = current.arms[0].authoredProfile!.out[0].spans[0].high;
      expect(end.kind).toBe('free');
      if (end.kind === 'free') expect(current.arms[0].authoredProfile!.out[0].keys.find(key => key.gap === 6)?.distance).toBe(end.attach);
    }
    const profile = getRoadProfile(current.arms[0], estimateArmLength(current.arms[0]));
    const boundary = profileLaneTransitions(profile, 'out').find(item => item.laneIndex === 0 && item.fromPresent && !item.toPresent)!;
    current = moveProfileLaneTerminal(current, 'arm', 'out', 0, boundary.boundaryIndex, 35, 5);
    expect(current.arms[0].authoredProfile!.out[0].keys.filter(key => key.gap === 6)).toHaveLength(1);
    expect(current.arms[0].authoredProfile!.out[0].keys.find(key => key.gap === 6)?.distance).toBe(30);
  });

  it('edits and deletes a lane-owned key without changing another lane’s authored keys', () => {
    const source = config();
    source.arms[0].lanesOut.push({ dropsRing: false });
    source.arms[0].nodes.forEach(node => node.laneWidthsOut.push(10));
    for (const point of source.arms[0].profile!) point.lanesOut.push({ width: 10, gap: 0 });
    source.arms[0].authoredProfile = migrateRoadProfile(source.arms[0].profile!);
    delete source.arms[0].profile;
    const other = JSON.stringify(source.arms[0].authoredProfile!.out[1]);
    const { config: added, pointId } = addProfilePoint(source, 'arm', 12, 'out', 0);
    expect(pointId).not.toBeNull();
    const moved = moveProfileLanePoint(added, 'arm', pointId!, 'out', 0, 16);
    const edited = setProfileControl(moved, 'arm', pointId!, 'out', 'width', 13, 0, true);
    expect(edited.arms[0].authoredProfile!.out[0].keys.find(key => key.id === pointId)).toMatchObject({ distance: 16, width: 13 });
    expect(JSON.stringify(edited.arms[0].authoredProfile!.out[1])).toBe(other);
    const removed = removeProfileLanePoint(edited, 'arm', pointId!, 'out', 0);
    expect(removed.arms[0].authoredProfile!.out[0].keys.some(key => key.id === pointId)).toBe(false);
  });

  it('draws a terminal connector to its own attachment past another lane’s key', () => {
    const source = config();
    source.arms[0].lanesOut.push({ dropsRing: false });
    source.arms[0].nodes.forEach(node => node.laneWidthsOut.push(10));
    for (const point of source.arms[0].profile!) point.lanesOut.push({ width: 10, gap: 0 });
    source.arms[0].profile!.push({ id: 'other', distance: 23, medianWidth: 4, lanesIn: [{ width: 0, gap: 0 }], lanesOut: [{ width: 10, gap: 0 }, { width: 12, gap: 0, node: true }] });
    source.arms[0].profile!.sort((a, b) => a.distance - b.distance);
    source.arms[0].authoredProfile = migrateRoadProfile(source.arms[0].profile!);
    delete source.arms[0].profile;
    const capBoundary = getRoadProfile(source.arms[0], estimateArmLength(source.arms[0])).length - 1;
    const free = moveProfileLaneTerminal(source, 'arm', 'out', 0, capBoundary, 25);
    const arm = free.arms[0];
    const profile = getRoadProfile(arm, estimateArmLength(arm));
    const index = laneAttachmentIndex(profile, arm.authoredProfile!.out[0], 'high', 25);
    expect(profile[index!].distance).toBe(9);
    expect(arm.authoredProfile!.out[1].keys.find(key => key.id === 'out_1_other')?.distance).toBe(23);
  });

  it('keeps separate lane stretches from crossing when their terminals move', () => {
    const source = config();
    const doc = source.arms[0].authoredProfile = migrateRoadProfile(source.arms[0].profile!);
    delete source.arms[0].profile;
    doc.out[0].spans = [
      { id: 'first', low: { kind: 'cap' }, high: { kind: 'free', tip: 10, attach: 6 } },
      { id: 'second', low: { kind: 'free', tip: 20, attach: 24 }, high: { kind: 'cap' } }
    ];
    const movedFirst = moveLaneTerminal(doc, 'out', 0, 'first', 'high', 18);
    const movedSecond = moveLaneTerminal(movedFirst, 'out', 0, 'second', 'low', 12);
    const first = movedSecond.out[0].spans[0].high;
    const second = movedSecond.out[0].spans[1].low;
    expect(first.kind).toBe('free');
    expect(second.kind).toBe('free');
    if (first.kind === 'free' && second.kind === 'free') expect(first.tip).toBeLessThan(second.tip);
    expect(doc.out[0].spans[0].high).toMatchObject({ tip: 10, attach: 6 });
  });

  it('round-trips both ends through alternating drags without accumulating handles', () => {
    let current = config();
    current.arms[0].authoredProfile = migrateRoadProfile(current.arms[0].profile!);
    delete current.arms[0].profile;
    const initial = JSON.stringify(current.arms[0].authoredProfile);
    for (let cycle = 0; cycle < 12; cycle++) {
      for (const [side, targets] of [['low', [5, 9, 3, -5]], ['high', [25, 17, 27, 35]]] as const) {
        for (const target of targets) {
          const profile = getRoadProfile(current.arms[0], estimateArmLength(current.arms[0]));
          const boundary = profileLaneTransitions(profile, 'out').find(item => item.laneIndex === 0 && (side === 'low' ? item.toPresent : item.fromPresent))!;
          current = moveProfileLaneTerminal(current, 'arm', 'out', 0, boundary.boundaryIndex, target);
        }
      }
      expect(JSON.stringify(current.arms[0].authoredProfile)).toBe(initial);
      const profile = getRoadProfile(current.arms[0], estimateArmLength(current.arms[0]));
      expect(profile.filter((_, index) => authoredLaneNodeVisible(profile, index, 'out', 0))).toHaveLength(0);
    }
  });

  it('round-trips repeated free terminal gestures without growing the authored document', () => {
    let current = config();
    current.arms[0].authoredProfile = migrateRoadProfile(current.arms[0].profile!);
    delete current.arms[0].profile;
    const original = JSON.stringify(current.arms[0].authoredProfile);
    for (let cycle = 0; cycle < 8; cycle++) {
      for (const target of [25, 12, 21, 17, 27, 35]) {
        const profile = getRoadProfile(current.arms[0], estimateArmLength(current.arms[0]));
        const boundary = profileLaneTransitions(profile, 'out').find(item => item.laneIndex === 0 && item.fromPresent && !item.toPresent)!;
        current = moveProfileLaneTerminal(current, 'arm', 'out', 0, boundary.boundaryIndex, target, 5);
      }
      expect(JSON.stringify(current.arms[0].authoredProfile)).toBe(original);
      expect(current.arms[0].profile).toBeUndefined();
    }
  });

  it('never moves another lane’s authored node when a terminal passes it', () => {
    const source = config();
    source.arms[0].lanesOut.push({ dropsRing: false });
    source.arms[0].nodes.forEach(node => node.laneWidthsOut.push(10));
    for (const point of source.arms[0].profile!) point.lanesOut.push({ width: 10, gap: 0, node: false });
    source.arms[0].profile![2].lanesOut[1] = { width: 14, gap: 0, node: true };
    const before = source.arms[0].profile![2];
    source.arms[0].authoredProfile = migrateRoadProfile(source.arms[0].profile!);
    delete source.arms[0].profile;
    const free = moveProfileLaneTerminal(source, 'arm', 'out', 0, 3, 25);
    const transition = profileLaneTransitions(getRoadProfile(free.arms[0], estimateArmLength(free.arms[0])), 'out')
      .find(item => item.laneIndex === 0 && item.fromPresent && !item.toPresent)!;
    const moved = moveProfileLaneTerminal(free, 'arm', 'out', 0, transition.boundaryIndex, 17);
    const other = moved.arms[0].authoredProfile!.out[1].keys.find(key => key.id === `out_1_${before.id}`);
    expect(other?.distance).toBe(20);
    expect(other).toMatchObject({ width: 14, gap: 0 });
    expect(moved.arms[0].profile).toBeUndefined();
    const snapped = moveProfileLaneTerminal(moved, 'arm', 'out', 0,
      profileLaneTransitions(getRoadProfile(moved.arms[0], estimateArmLength(moved.arms[0])), 'out')
        .find(item => item.laneIndex === 0 && item.fromPresent && !item.toPresent)!.boundaryIndex, 35, 5);
    expect(snapped.arms[0].authoredProfile!.out[0]).toEqual(source.arms[0].authoredProfile!.out[0]);
    expect(snapped.arms[0].authoredProfile!.out[1]).toEqual(source.arms[0].authoredProfile!.out[1]);
  });

  it('removes lane keys swept over by a moving terminal taper', () => {
    const source = config();
    source.arms[0].authoredProfile = migrateRoadProfile(source.arms[0].profile!);
    delete source.arms[0].profile;
    const { config: added, pointId } = addProfilePoint(source, 'arm', 22, 'out', 0);
    expect(pointId).not.toBeNull();
    const capBoundary = getRoadProfile(added.arms[0], estimateArmLength(added.arms[0])).length - 1;
    const moved = moveProfileLaneTerminal(added, 'arm', 'out', 0, capBoundary, 25);
    const shape = moved.arms[0].authoredProfile!.out[0];
    expect(shape.spans[0].high).toMatchObject({ kind: 'free', tip: 25, attach: 9 });
    expect(shape.keys.some(key => Math.abs(key.distance - 22) < 1e-6)).toBe(false);
    const profile = getRoadProfile(moved.arms[0], estimateArmLength(moved.arms[0]));
    expect(profile.some(point => Math.abs(point.distance - 22) < 1e-6)).toBe(false);
  });

  it('removes lane keys swept over by a moving taper attachment', () => {
    const source = config();
    source.arms[0].authoredProfile = migrateRoadProfile(source.arms[0].profile!);
    delete source.arms[0].profile;
    const { config: added, pointId } = addProfilePoint(source, 'arm', 18, 'out', 0);
    expect(pointId).not.toBeNull();
    const document = added.arms[0].authoredProfile!;
    document.out[0].spans[0].high = { kind: 'free', tip: 25, attach: 21 };
    const moved = moveLaneAttachment(document, 'out', 0, document.out[0].spans[0].id, 'high', 17);
    expect(moved.out[0].spans[0].high).toMatchObject({ kind: 'free', tip: 25, attach: 17 });
    expect(moved.out[0].keys.some(key => Math.abs(key.distance - 18) < 1e-6)).toBe(false);
    expect(added.arms[0].authoredProfile!.out[0].keys.some(key => Math.abs(key.distance - 18) < 1e-6)).toBe(true);
  });

  it('fades a taper straight from the attachment cross-section without interior-key bulges', () => {
    const document = migrateRoadProfile(config().arms[0].profile!);
    const shape = document.out[0];
    shape.spans[0].high = { kind: 'free', tip: 26, attach: 20 };
    shape.keys.push({ id: 'stray', distance: 23, width: 20, gap: 0 });
    shape.keys.sort((a, b) => a.distance - b.distance);
    const attachWidth = evaluateLane(document, shape, 20).width;
    expect(evaluateLane(document, shape, 21).width).toBeCloseTo(attachWidth * 5 / 6);
    expect(evaluateLane(document, shape, 23).width).toBeCloseTo(attachWidth * 0.5);
    pruneTaperInteriorKeys(shape);
    expect(shape.keys.some(key => key.id === 'stray')).toBe(false);
    expect(evaluateLane(document, shape, 23).width).toBeCloseTo(evaluateLane(document, shape, 20).width * 0.5);
  });

  it('refuses to add a lane node inside a taper', () => {
    const source = config();
    source.arms[0].authoredProfile = migrateRoadProfile(source.arms[0].profile!);
    delete source.arms[0].profile;
    const capBoundary = getRoadProfile(source.arms[0], estimateArmLength(source.arms[0])).length - 1;
    const free = moveProfileLaneTerminal(source, 'arm', 'out', 0, capBoundary, 25);
    const added = addProfilePoint(free, 'arm', 23, 'out', 0);
    expect(added.pointId).toBeNull();
    expect(added.config).toBe(free);
  });

  it('pushes a dragged lane key out of a taper band', () => {
    const source = config();
    source.arms[0].authoredProfile = migrateRoadProfile(source.arms[0].profile!);
    delete source.arms[0].profile;
    const capBoundary = getRoadProfile(source.arms[0], estimateArmLength(source.arms[0])).length - 1;
    const free = moveProfileLaneTerminal(source, 'arm', 'out', 0, capBoundary, 25);
    const { config: added, pointId } = addProfilePoint(free, 'arm', 5, 'out', 0);
    expect(pointId).not.toBeNull();
    const moved = moveProfileLanePoint(added, 'arm', pointId!, 'out', 0, 12);
    expect(moved.arms[0].authoredProfile!.out[0].keys.find(key => key.id === pointId)?.distance).toBe(9);
  });

  it('lands geometry samples exactly on taper tip and attachment', () => {
    const source = config();
    source.arms[0].authoredProfile = migrateRoadProfile(source.arms[0].profile!);
    delete source.arms[0].profile;
    const capBoundary = getRoadProfile(source.arms[0], estimateArmLength(source.arms[0])).length - 1;
    const moved = moveProfileLaneTerminal(source, 'arm', 'out', 0, capBoundary, 25);
    const arm = moved.arms[0];
    const sampled = sampleProfile(arm, { points: arm.nodes.map(node => node.point), nodes: arm.nodes, alpha: 0.5, tension: 0 }, 90);
    const tip = sampled.sections.find(section => Math.abs(section.distance - 25) < 1e-6);
    const attach = sampled.sections.find(section => Math.abs(section.distance - 9) < 1e-6);
    expect(tip?.lanesOut[0].width).toBeCloseTo(0);
    expect(attach?.lanesOut[0].width).toBeCloseTo(10);
  });

  it('ignores terminal drags on boundaries that are not transitions', () => {
    const source = config();
    expect(moveProfileLaneTerminal(source, 'arm', 'out', 0, 0, 15)).toBe(source);
  });

  it('spans the whole road when a lane is added on a cap-end cross-section', () => {
    const atStart = addProfileLane(config(), 'arm', 'a', 'in', 1);
    expect(atStart.arms[0].profile?.map(point => point.lanesIn[1].width)).toEqual([10, 10, 10, 10]);
    const atEnd = addProfileLane(config(), 'arm', 'd', 'out', 1);
    expect(atEnd.arms[0].profile?.map(point => point.lanesOut[1].width)).toEqual([10, 10, 10, 10]);
  });

  it('transfers a displaced lane\'s gap to a lane inserted inside it', () => {
    const source = config();
    for (const point of source.arms[0].profile!) point.lanesOut[0].gap = 8;
    const next = addProfileLane(source, 'arm', 'a', 'out', 0);
    for (const point of next.arms[0].profile!) {
      expect(point.lanesOut[0].gap).toBe(8);
      expect(point.lanesOut[1].gap).toBe(0);
      expect(point.lanesOut[1].width).toBe(10);
    }
  });

  it('transfers a displaced lane\'s offset to an inserted lane in the authored profile', () => {
    const source = config();
    for (const point of source.arms[0].profile!) point.lanesOut[0].gap = 8;
    source.arms[0].authoredProfile = migrateRoadProfile(source.arms[0].profile!);
    const next = addProfileLane(source, 'arm', 'a', 'out', 0);
    const shapes = next.arms[0].authoredProfile!.out;
    expect(shapes).toHaveLength(2);
    expect(shapes[0].keys.map(key => key.gap)).toEqual([8, 8]);
    expect(shapes[1].keys.every(key => key.gap === 0)).toBe(true);
    const section = interpolateProfile(getRoadProfile(next.arms[0], estimateArmLength(next.arms[0])), 15);
    expect(laneBounds(section, 'out', 0).inner).toBeCloseTo(10);
    expect(laneBounds(section, 'out', 1).inner).toBeCloseTo(20);
  });

  it('moves the offset between two lanes onto a lane inserted between them', () => {
    const source = config();
    source.arms[0].lanesOut.push({ filletRadius: 40, dropsRing: false });
    source.arms[0].nodes.forEach(node => node.laneWidthsOut.push(10));
    for (const point of source.arms[0].profile!) point.lanesOut.push({ width: 10, gap: 8 });
    source.arms[0].authoredProfile = migrateRoadProfile(source.arms[0].profile!);
    const next = addProfileLane(source, 'arm', 'a', 'out', 1);
    const shapes = next.arms[0].authoredProfile!.out;
    expect(shapes).toHaveLength(3);
    expect(shapes[0].keys.every(key => key.gap === 0)).toBe(true);
    expect(shapes[1].keys.map(key => key.gap)).toEqual([8, 8]);
    expect(shapes[2].keys.every(key => key.gap === 0)).toBe(true);
  });

  it('leaves lane offsets untouched when a lane is appended outside all lanes', () => {
    const source = config();
    for (const point of source.arms[0].profile!) point.lanesOut[0].gap = 8;
    source.arms[0].authoredProfile = migrateRoadProfile(source.arms[0].profile!);
    const next = addProfileLane(source, 'arm', 'a', 'out', 1);
    const shapes = next.arms[0].authoredProfile!.out;
    expect(shapes[0].keys.every(key => key.gap === 8)).toBe(true);
    expect(shapes[1].keys.map(key => key.gap)).toEqual([0, 0]);
  });

  it('keeps a lane end taper in the longer segment when a point is inserted near the present neighbor', () => {
    const added = addProfilePoint(config(), 'arm', 3).config.arms[0].profile!;
    expect(added.map(point => point.distance)).toEqual([0, 3, 10, 20, 30]);
    expect(added.map(point => point.lanesIn[0].width)).toEqual([10, 10, 0, 0, 0]);
  });

  it('keeps a lane end taper in the longer segment when a point is inserted near the absent neighbor', () => {
    const added = addProfilePoint(config(), 'arm', 8).config.arms[0].profile!;
    expect(added.map(point => point.lanesIn[0].width)).toEqual([10, 0, 0, 0, 0]);
  });

  it('keeps a lane start taper in the longer segment on either side of the insertion', () => {
    const source = config();
    source.arms[0].profile![2].lanesIn[0] = { width: 10, gap: 0 };
    const nearAbsent = addProfilePoint(source, 'arm', 13).config.arms[0].profile!;
    expect(nearAbsent.map(point => point.lanesIn[0].width)).toEqual([10, 0, 0, 10, 0]);
    const nearPresent = addProfilePoint(source, 'arm', 18).config.arms[0].profile!;
    expect(nearPresent.map(point => point.lanesIn[0].width)).toEqual([10, 0, 10, 10, 0]);
  });

  it('rejects cross-sections outside the propper road between the ending cross-sections', () => {
    expect(addProfilePoint(config(), 'arm', -5).pointId).toBeNull();
    expect(addProfilePoint(config(), 'arm', 0).pointId).toBeNull();
    expect(addProfilePoint(config(), 'arm', 30).pointId).toBeNull();
    expect(addProfilePoint(config(), 'arm', 35).pointId).toBeNull();
    expect(addProfilePoint(config(), 'arm', 15).pointId).not.toBeNull();
  });

  it('still interpolates lanes whose presence does not change across the insertion', () => {
    const source = config();
    for (const point of source.arms[0].profile!.slice(1)) point.lanesOut[0] = { width: 20, gap: 0 };
    const added = addProfilePoint(source, 'arm', 4).config.arms[0].profile!;
    expect(added[1].lanesOut[0].width).toBe(14);
  });

  it('shows a lane-owned node only on that lane and outward lanes on the same side', () => {
    const source = config();
    source.arms[0].lanesOut.push({ filletRadius: 40, dropsRing: false });
    source.arms[0].nodes.forEach(node => node.laneWidthsOut.push(10));
    source.arms[0].profile!.forEach(point => point.lanesOut.push({ width: 10, gap: 0 }));
    source.arms[0].profile![1].lanesOut[0].gap = 4;
    const profile = getRoadProfile(source.arms[0], 30);
    expect(profile[1].lanesOut.map(lane => lane.node)).toEqual([true, false]);
    expect(isProfileLaneNodeAffected(profile, 1, 'out', 0)).toBe(true);
    expect(isProfileLaneNodeAffected(profile, 1, 'out', 1)).toBe(true);
    expect(isProfileLaneNodeAffected(profile, 1, 'in', 0)).toBe(false);
  });

  it('moves one lane-owned node without moving another lane key at the same station', () => {
    const source = config();
    source.arms[0].lanesOut.push({ filletRadius: 40, dropsRing: false });
    source.arms[0].nodes.forEach(node => node.laneWidthsOut.push(10));
    source.arms[0].profile!.forEach(point => point.lanesOut.push({ width: 10, gap: 0, node: false }));
    source.arms[0].profile![1].lanesOut[0].node = true;
    source.arms[0].profile![1].lanesOut[1].node = true;
    const next = moveProfileLanePoint(source, 'arm', 'b', 'out', 0, 25);
    const profile = next.arms[0].profile!;
    expect(profile.find(point => point.id === 'b')?.distance).toBe(25);
    expect(profile.find(point => point.distance === 10)?.lanesOut[1].node).toBe(true);
    expect(profile.find(point => point.distance === 10)?.lanesOut[0].node).toBe(false);
  });

  it('does not leave derived stations behind when one lane node is dragged repeatedly', () => {
    const added = addProfilePoint(config(), 'arm', 15, 'out', 0);
    expect(added.pointId).not.toBeNull();
    const pointId = added.pointId!;
    const firstMove = moveProfileLanePoint(added.config, 'arm', pointId, 'out', 0, 18);
    const firstDrag = setProfileControl(firstMove, 'arm', pointId, 'out', 'gap', 3, 0);
    const secondMove = moveProfileLanePoint(firstDrag, 'arm', pointId, 'out', 0, 22);
    const secondDrag = setProfileControl(secondMove, 'arm', pointId, 'out', 'gap', 6, 0);
    const profile = secondDrag.arms[0].profile!;
    expect(profile.filter(point => point.id === pointId)).toHaveLength(1);
    expect(profile.find(point => point.id === pointId)?.distance).toBe(22);
    expect(profile.some(point => point.id.includes('_station_'))).toBe(false);
    expect(profile.filter(point => point.lanesOut[0].node)).toHaveLength(1);
  });

  it('automatically removes a lane node after its edit returns to the derived lane shape', () => {
    const added = addProfilePoint(config(), 'arm', 15, 'out', 0);
    const pointId = added.pointId!;
    const firstCommit = canonicalizeConfig(added.config);
    expect(firstCommit.arms[0].profile?.some(point => point.id === pointId)).toBe(true);
    const changed = canonicalizeConfig(setProfileControl(firstCommit, 'arm', pointId, 'out', 'gap', 4, 0));
    expect(changed.arms[0].profile?.find(point => point.id === pointId)?.lanesOut[0].node).toBe(true);
    const restored = canonicalizeConfig(setProfileControl(changed, 'arm', pointId, 'out', 'gap', 0, 0));
    const profile = getRoadProfile(restored.arms[0], estimateArmLength(restored.arms[0]));
    expect(profile.some(point => point.id === pointId)).toBe(false);
    expect(profile.filter((_, pointIndex) => isProfileLaneNodeAffected(profile, pointIndex, 'out', 0))).toHaveLength(0);
  });

  it('pins a dragged lane node’s neighbors so the rest of the lane stays put', () => {
    // out[1]'s low taper kinks out[2]'s centerline at 8 and 12 — those
    // sections render as lane nodes without authored keys. A sideways edit to
    // out[2]'s end key would ramp the gap over the whole lane and drag every
    // rendered node with it; pinning the flanking node keeps them fixed.
    const source = config();
    const arm = source.arms[0];
    arm.lanesOut = [{ filletRadius: 40, dropsRing: false }, { filletRadius: 40, dropsRing: false }, { filletRadius: 40, dropsRing: false }];
    arm.nodes.forEach(node => (node.laneWidthsOut = [10, 10, 10]));
    arm.authoredProfile = {
      median: [
        { id: 'm0', distance: 0, width: 4, endAnchor: 'start' },
        { id: 'm1', distance: 30, width: 4, endAnchor: 'end' }
      ],
      in: [{ keys: [{ id: 'i0', distance: 0, width: 10, gap: 0 }, { id: 'i1', distance: 30, width: 10, gap: 0 }], spans: [{ id: 'is', low: { kind: 'cap' }, high: { kind: 'cap' } }] }],
      out: [
        { keys: [{ id: 'o0a', distance: 0, width: 10, gap: 0 }, { id: 'o0b', distance: 30, width: 10, gap: 0 }], spans: [{ id: 's0', low: { kind: 'cap' }, high: { kind: 'cap' } }] },
        { keys: [{ id: 'o1a', distance: 0, width: 10, gap: 0 }, { id: 'o1m', distance: 12, width: 10, gap: 0 }, { id: 'o1b', distance: 30, width: 10, gap: 0 }], spans: [{ id: 's1', low: { kind: 'free', tip: 8, attach: 12 }, high: { kind: 'cap' } }] },
        { keys: [{ id: 'o2a', distance: 0, width: 10, gap: 0 }, { id: 'o2b', distance: 30, width: 10, gap: 0 }], spans: [{ id: 's2', low: { kind: 'cap' }, high: { kind: 'cap' } }] }
      ]
    };
    delete arm.profile;
    const centerline = (cfg: RoundaboutConfig, distance: number) => {
      const derived = getRoadProfile(cfg.arms[0], estimateArmLength(cfg.arms[0]));
      const bounds = laneBounds(interpolateProfile(derived, distance), 'out', 2);
      return (bounds.inner + bounds.outer) / 2;
    };
    const profile = getRoadProfile(arm, estimateArmLength(arm));
    expect(profile.map(point => point.distance)).toEqual([0, 8, 12, 30]);
    expect(authoredLaneNodeVisible(profile, 1, 'out', 2)).toBe(true);
    expect(authoredLaneNodeVisible(profile, 2, 'out', 2)).toBe(true);
    // Without the pin, every rendered node between the cap keys slides.
    const unpinned = setProfileControl(source, 'arm', 'o2b', 'out', 'gap', 6, 2, true);
    expect(centerline(unpinned, 12)).not.toBeCloseTo(centerline(source, 12));
    const pinned = pinProfileLaneNodes(source, [{ armId: 'arm', dir: 'out', laneIndex: 2, pointId: profile[2].id, distance: 12 }]);
    expect(pinned.arms[0].authoredProfile!.out[2].keys.map(key => key.distance)).toEqual([0, 12, 30]);
    const edited = setProfileControl(pinned, 'arm', 'o2b', 'out', 'gap', 6, 2, true);
    for (const distance of [0, 8, 12]) expect(centerline(edited, distance)).toBeCloseTo(centerline(source, distance));
    expect(centerline(edited, 21)).toBeCloseTo(centerline(source, 21) + 3);
    expect(centerline(edited, 30)).toBeCloseTo(centerline(source, 30) + 6);
  });

  it('skips pinning where a key already exists or the lane tapers there', () => {
    const source = config();
    const arm = source.arms[0];
    arm.authoredProfile = migrateRoadProfile(arm.profile!);
    delete arm.profile;
    const keysBefore = arm.authoredProfile.out[0].keys.length;
    const pinned = pinProfileLaneNodes(source, [
      { armId: 'arm', dir: 'out', laneIndex: 0, pointId: 'existing', distance: 0 },
      { armId: 'arm', dir: 'out', laneIndex: 0, pointId: 'existing', distance: 30 }
    ]);
    expect(pinned.arms[0].authoredProfile!.out[0].keys.length).toBe(keysBefore);
    const capBoundary = getRoadProfile(source.arms[0], estimateArmLength(source.arms[0])).length - 1;
    const free = moveProfileLaneTerminal(source, 'arm', 'out', 0, capBoundary, 25);
    const inside = pinProfileLaneNodes(free, [{ armId: 'arm', dir: 'out', laneIndex: 0, pointId: 'p', distance: 22 }]);
    expect(inside.arms[0].authoredProfile!.out[0].keys.some(key => key.id === 'p')).toBe(false);
  });

  it('clamps point movement between neighboring profile stations', () => {
    const moved = moveProfilePoint(config(), 'arm', 'b', 30);
    expect(moved.arms[0].profile?.[1].distance).toBe(19);
  });

  it('removes internal points but preserves end anchors', () => {
    expect(removeProfilePoint(config(), 'arm', 'b').arms[0].profile?.map(point => point.id)).toEqual(['a', 'c', 'd']);
    expect(removeProfilePoint(config(), 'arm', 'a').arms[0].profile?.map(point => point.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(removeProfilePoint(config(), 'arm', 'd').arms[0].profile?.map(point => point.id)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('keeps bypass lane indices aligned when lanes are inserted and removed', () => {
    const added = addProfileLane(config(), 'arm', 'a', 'in', 0);
    expect(added.bypasses?.[0].fromLaneIndex).toBe(1);
    expect(added.arms[0].lanesIn).toHaveLength(2);
    const removed = removeProfileLane(added, 'arm', 'in', 0);
    expect(removed.bypasses?.[0].fromLaneIndex).toBe(0);
    expect(removed.arms[0].lanesIn).toHaveLength(1);
  });

  it('deletes a lane segment’s endpoint keys while keeping the lane', () => {
    const source = config();
    const arm = source.arms[0];
    arm.authoredProfile = migrateRoadProfile(arm.profile!);
    delete arm.profile;
    const first = addProfilePoint(source, 'arm', 12, 'out', 0);
    const second = addProfilePoint(first.config, 'arm', 18, 'out', 0);
    const next = removeProfileLaneSegment(second.config, 'arm', first.pointId!, second.pointId!, 'out', 0);
    const keys = next.arms[0].authoredProfile!.out[0].keys.map(key => key.id);
    expect(keys).not.toContain(first.pointId);
    expect(keys).not.toContain(second.pointId);
    expect(next.arms[0].lanesOut).toHaveLength(1);
    expect(next.arms[0].authoredProfile!.out).toHaveLength(1);
  });

  it('skips the lane-end node when a segment reaches a cap', () => {
    const source = config();
    const arm = source.arms[0];
    arm.authoredProfile = migrateRoadProfile(arm.profile!);
    delete arm.profile;
    const added = addProfilePoint(source, 'arm', 12, 'out', 0);
    const base = added.config;
    const startCap = getRoadProfile(base.arms[0], estimateArmLength(base.arms[0])).find(point => point.endAnchor === 'start')!;
    const endId = laneNodeId(base.arms[0], startCap, 'out', 0);
    const next = removeProfileLaneSegment(base, 'arm', endId, added.pointId!, 'out', 0);
    const shape = next.arms[0].authoredProfile!.out[0];
    expect(shape.keys.some(key => key.id === added.pointId)).toBe(false);
    expect(shape.keys.some(key => key.id === endId)).toBe(true);
    expect(next.arms[0].lanesOut).toHaveLength(1);
  });

  it('skips a taper attachment when a segment ends at it', () => {
    const source = config();
    source.arms[0].authoredProfile = migrateRoadProfile(source.arms[0].profile!);
    delete source.arms[0].profile;
    const capBoundary = getRoadProfile(source.arms[0], estimateArmLength(source.arms[0])).length - 1;
    const free = moveProfileLaneTerminal(source, 'arm', 'out', 0, capBoundary, 25);
    const added = addProfilePoint(free, 'arm', 5, 'out', 0);
    expect(added.pointId).not.toBeNull();
    const spanId = added.config.arms[0].authoredProfile!.out[0].spans[0].id;
    const next = removeProfileLaneSegment(added.config, 'arm', `${spanId}_high_attach`, added.pointId!, 'out', 0);
    const shape = next.arms[0].authoredProfile!.out[0];
    expect(shape.keys.some(key => key.id === added.pointId)).toBe(false);
    expect(shape.spans[0].high).toMatchObject({ kind: 'free', tip: 25, attach: 9 });
    expect(next.arms[0].lanesOut).toHaveLength(1);
  });

  it('deletes the whole lane when the selected segment already spans both ends', () => {
    const source = config();
    const arm = source.arms[0];
    arm.authoredProfile = migrateRoadProfile(arm.profile!);
    delete arm.profile;
    const profile = getRoadProfile(arm, estimateArmLength(arm));
    const startId = laneNodeId(arm, profile.find(point => point.endAnchor === 'start')!, 'out', 0);
    const endId = laneNodeId(arm, profile.find(point => point.endAnchor === 'end')!, 'out', 0);
    const next = removeProfileLaneSegment(source, 'arm', startId, endId, 'out', 0);
    expect(next.arms[0].lanesOut).toHaveLength(0);
    expect(next.arms[0].authoredProfile!.out).toHaveLength(0);
    expect(next.bypasses).toHaveLength(0);
  });

  it('deletes the lane when the segment spans a cap end and a taper attachment', () => {
    const source = config();
    source.arms[0].authoredProfile = migrateRoadProfile(source.arms[0].profile!);
    delete source.arms[0].profile;
    const capBoundary = getRoadProfile(source.arms[0], estimateArmLength(source.arms[0])).length - 1;
    const free = moveProfileLaneTerminal(source, 'arm', 'out', 0, capBoundary, 25);
    const arm = free.arms[0];
    const profile = getRoadProfile(arm, estimateArmLength(arm));
    const startId = laneNodeId(arm, profile.find(point => point.endAnchor === 'start')!, 'out', 0);
    const spanId = arm.authoredProfile!.out[0].spans[0].id;
    const next = removeProfileLaneSegment(free, 'arm', startId, `${spanId}_high_attach`, 'out', 0);
    expect(next.arms[0].lanesOut).toHaveLength(0);
    expect(next.arms[0].authoredProfile!.out).toHaveLength(0);
  });

  it('clears legacy lane segment endpoints and deletes the lane at both ends', () => {
    const interior = removeProfileLaneSegment(config(), 'arm', 'b', 'c', 'out', 0);
    expect(interior.arms[0].profile?.map(point => point.lanesOut[0].node)).toEqual([false, false, false, false]);
    expect(interior.arms[0].lanesOut).toHaveLength(1);
    const ends = removeProfileLaneSegment(config(), 'arm', 'a', 'd', 'out', 0);
    expect(ends.arms[0].lanesOut).toHaveLength(0);
  });

  it('pins a gap-only key at a taper tip when the terminal unsnaps', () => {
    const free = freeTipConfig();
    const shape = free.arms[0].authoredProfile!.out[0];
    expect(shape.spans[0].high).toMatchObject({ kind: 'free', tip: 25, attach: 9 });
    expect(shape.keys.find(key => key.id === 'out_0_a_high_tip')).toMatchObject({ distance: 25, width: 0 });
  });

  it('keeps lane width flat through the present region next to a tip key', () => {
    // The tip key is gap-only: its stored width must not bend the width curve
    // between the road start and the attachment.
    const free = freeTipConfig();
    const arm = free.arms[0];
    const profile = getRoadProfile(arm, estimateArmLength(arm));
    for (const distance of [0, 4, 9]) {
      expect(interpolateProfile(profile, distance).lanesOut[0].width).toBeCloseTo(10);
    }
    expect(evaluateLane(arm.authoredProfile!, arm.authoredProfile!.out[0], 25).width).toBe(0);
  });

  it('resolves a taper tip node id before any key is materialized', () => {
    const source = config();
    source.arms[0].authoredProfile = migrateRoadProfile(source.arms[0].profile!);
    delete source.arms[0].profile;
    source.arms[0].authoredProfile.out[0].spans[0].high = { kind: 'free', tip: 25, attach: 20 };
    const arm = source.arms[0];
    const profile = getRoadProfile(arm, estimateArmLength(arm));
    const tip = profile.find(point => Math.abs(point.distance - 25) < 1e-6)!;
    expect(laneNodeId(arm, tip, 'out', 0)).toBe('out_0_a_high_tip');
    expect(findLanePoint(arm, profile, 'out', 0, 'out_0_a_high_tip')).toBe(tip);
    expect(selectionExists(source, { kind: 'lane-node', armId: 'arm', dir: 'out', laneIndex: 0, pointId: 'out_0_a_high_tip' })).toBe(true);
    expect(selectionExists(source, {
      kind: 'lane-segment', armId: 'arm', dir: 'out', laneIndex: 0,
      fromPointId: 'out_0_a_high_tip', toPointId: 'out_0_a_high_attach'
    })).toBe(true);
  });

  it('materializes a missing tip key at the interpolated offset', () => {
    const document = migrateRoadProfile(config().arms[0].profile!);
    const shape = document.out[0];
    shape.spans[0].high = { kind: 'free', tip: 25, attach: 20 };
    const interpolatedGap = evaluateLane(document, shape, 25).gap;
    ensureTaperTipKeys(shape);
    const tipKey = shape.keys.find(key => key.id === 'out_0_a_high_tip');
    expect(tipKey).toMatchObject({ distance: 25, width: 0 });
    expect(tipKey?.gap).toBeCloseTo(interpolatedGap);
  });

  it('relocates the tip key when its terminal slides', () => {
    const free = freeTipConfig();
    const profile = getRoadProfile(free.arms[0], estimateArmLength(free.arms[0]));
    const boundary = profileLaneTransitions(profile, 'out').find(transition => transition.laneIndex === 0 && transition.fromPresent && !transition.toPresent)!;
    const moved = moveProfileLaneTerminal(free, 'arm', 'out', 0, boundary.boundaryIndex, 20);
    const shape = moved.arms[0].authoredProfile!.out[0];
    expect(shape.spans[0].high).toMatchObject({ kind: 'free', tip: 20, attach: 4 });
    expect(shape.keys.find(key => key.id === 'out_0_a_high_tip')?.distance).toBe(20);
    expect(shape.keys.some(key => Math.abs(key.distance - 25) < 1e-6)).toBe(false);
  });

  it('deletes the tip key when its terminal snaps to the cap', () => {
    const free = freeTipConfig();
    const profile = getRoadProfile(free.arms[0], estimateArmLength(free.arms[0]));
    const boundary = profileLaneTransitions(profile, 'out').find(transition => transition.laneIndex === 0 && transition.fromPresent && !transition.toPresent)!;
    const snapped = moveProfileLaneTerminal(free, 'arm', 'out', 0, boundary.boundaryIndex, 35, 5);
    const shape = snapped.arms[0].authoredProfile!.out[0];
    expect(shape.spans[0].high).toEqual({ kind: 'cap' });
    expect(shape.keys.some(key => key.id === 'out_0_a_high_tip')).toBe(false);
    expect(shape.keys.some(key => Math.abs(key.distance - 25) < 1e-6)).toBe(false);
  });

  it('slides a tip node along the road carrying its attachment', () => {
    const moved = moveProfileLanePoint(freeTipConfig(), 'arm', 'out_0_a_high_tip', 'out', 0, 20);
    expect(moved.arms[0].authoredProfile!.out[0].spans[0].high).toMatchObject({ kind: 'free', tip: 20, attach: 4 });
  });

  it('edits a tip offset independently of its attachment', () => {
    const edited = setProfileControl(freeTipConfig(), 'arm', 'out_0_a_high_tip', 'out', 'gap', 6, 0, true);
    const shape = edited.arms[0].authoredProfile!.out[0];
    expect(shape.keys.find(key => key.id === 'out_0_a_high_tip')?.gap).toBe(6);
    expect(shape.keys.every(key => Math.abs(key.distance - 9) > 1e-6 || key.gap === 0)).toBe(true);
  });

  it('edits an attachment offset independently of its tip', () => {
    const free = freeTipConfig();
    const edited = setProfileControl(free, 'arm', 'out_0_a_high_attach', 'out', 'gap', 5, 0, true);
    const shape = edited.arms[0].authoredProfile!.out[0];
    expect(shape.keys.find(key => Math.abs(key.distance - 9) < 1e-6)?.gap).toBe(5);
    expect(shape.keys.find(key => key.id === 'out_0_a_high_tip')?.gap).toBe(0);
  });

  it('remaps taper tip and attachment ids when an arm is duplicated', () => {
    const free = freeTipConfig();
    const { config: duplicated, selections } = duplicateSelectionOwners(free, [
      { kind: 'lane-node', armId: 'arm', dir: 'out', laneIndex: 0, pointId: 'out_0_a_high_tip' },
      { kind: 'lane-node', armId: 'arm', dir: 'out', laneIndex: 0, pointId: 'out_0_a_high_attach' }
    ]);
    const copy = duplicated.arms.find(candidate => candidate.id !== 'arm')!;
    const tipTarget = selections.find((target): target is Extract<SelectionTarget, { kind: 'lane-node' }> => target.kind === 'lane-node' && target.pointId.endsWith('_tip'))!;
    const attachTarget = selections.find((target): target is Extract<SelectionTarget, { kind: 'lane-node' }> => target.kind === 'lane-node' && target.pointId.endsWith('_attach'))!;
    expect(tipTarget.armId).toBe(copy.id);
    const copyProfile = getRoadProfile(copy, estimateArmLength(copy));
    expect(findLanePoint(copy, copyProfile, 'out', 0, tipTarget.pointId)?.distance).toBe(25);
    expect(findLanePoint(copy, copyProfile, 'out', 0, attachTarget.pointId)?.distance).toBe(9);
  });
});
