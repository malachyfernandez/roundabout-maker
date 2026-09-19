import { describe, expect, it } from 'vitest';
import { type RoundaboutConfig } from '../../config/types';
import { addProfileLane, addProfilePoint, moveProfileLaneTransition, moveProfilePoint, removeProfileLane, removeProfilePoint, setProfileControl } from './mutations';

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

  it('moves a lane transition while preserving the present lane template', () => {
    const next = moveProfileLaneTransition(config(), 'arm', 'in', 0, 0, 2);
    expect(next.arms[0].profile?.map(point => point.lanesIn[0].width)).toEqual([10, 10, 10, 0]);
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

  it('spans the whole road when a lane is added on a cap-end cross-section', () => {
    const atStart = addProfileLane(config(), 'arm', 'a', 'in', 1);
    expect(atStart.arms[0].profile?.map(point => point.lanesIn[1].width)).toEqual([10, 10, 10, 10]);
    const atEnd = addProfileLane(config(), 'arm', 'd', 'out', 1);
    expect(atEnd.arms[0].profile?.map(point => point.lanesOut[1].width)).toEqual([10, 10, 10, 10]);
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
});
