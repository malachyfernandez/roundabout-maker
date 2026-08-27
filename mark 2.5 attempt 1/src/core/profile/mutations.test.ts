import { describe, expect, it } from 'vitest';
import { type RoundaboutConfig } from '../../config/types';
import { addProfileLane, moveProfileLaneTransition, moveProfilePoint, removeProfileLane, removeProfilePoint, setProfileControl } from './mutations';

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
      { id: 'a', distance: 0, medianWidth: 4, lanesIn: [{ width: 10, gap: 0 }], lanesOut: [{ width: 10, gap: 0 }] },
      { id: 'b', distance: 10, medianWidth: 4, lanesIn: [{ width: 0, gap: 0 }], lanesOut: [{ width: 10, gap: 0 }] },
      { id: 'c', distance: 20, medianWidth: 4, lanesIn: [{ width: 0, gap: 0 }], lanesOut: [{ width: 10, gap: 0 }] },
      { id: 'd', distance: 30, medianWidth: 4, lanesIn: [{ width: 0, gap: 0 }], lanesOut: [{ width: 10, gap: 0 }] }
    ]
  }],
  bypasses: [{ id: 'bypass', fromArmId: 'arm', fromLaneIndex: 0, toArmId: 'arm', toLaneIndex: 0, entryRadius: 20, exitRadius: 20, lanePoint: { x: 0, y: 0 }, laneAngle: 0 }]
});

describe('profile mutations', () => {
  it('applies controls through the next downstream point without mutating the source config', () => {
    const source = config();
    const next = setProfileControl(source, 'arm', 'b', 'out', 'width', 14);
    expect(next.arms[0].profile?.map(point => point.lanesOut[0].width)).toEqual([10, 14, 14, 10]);
    expect(source.arms[0].profile?.[1].lanesOut[0].width).toBe(10);
  });

  it('moves a lane transition while preserving the present lane template', () => {
    const next = moveProfileLaneTransition(config(), 'arm', 'in', 0, 0, 2);
    expect(next.arms[0].profile?.map(point => point.lanesIn[0].width)).toEqual([10, 10, 10, 0]);
  });

  it('clamps point movement between neighboring profile stations', () => {
    const moved = moveProfilePoint(config(), 'arm', 'b', 30);
    expect(moved.arms[0].profile?.[1].distance).toBe(19);
  });

  it('removes internal points but preserves profile endpoints', () => {
    expect(removeProfilePoint(config(), 'arm', 'b').arms[0].profile?.map(point => point.id)).toEqual(['a', 'c', 'd']);
    expect(removeProfilePoint(config(), 'arm', 'a').arms[0].profile?.map(point => point.id)).toEqual(['a', 'b', 'c', 'd']);
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
