import { describe, expect, it } from 'vitest';
import { type RoadProfilePoint } from '../config/types';
import {
  profileControlValue,
  profileLaneInsertIndices,
  profileLaneStartEndMovers,
  profileLaneTotalOffset,
  profileSideOuter,
  profileTransitionSection,
  profileTransitionTargets,
  snapProfileLaneGap,
  snapProfileLaneWidth
} from './editorMath';

const point = (id: string, distance: number, widthsIn: number[], widthsOut: number[], gapsIn: number[] = []): RoadProfilePoint => ({
  id,
  distance,
  medianWidth: 4,
  lanesIn: widthsIn.map((width, index) => ({ width, gap: gapsIn[index] ?? 0 })),
  lanesOut: widthsOut.map(width => ({ width, gap: 0 }))
});

describe('profile editor math', () => {
  it('uses only visible lanes when calculating the outer edge and insertion positions', () => {
    const section = point('a', 0, [10, 0, 12], [9]);
    expect(profileSideOuter(section, 'in')).toBe(24);
    expect(profileLaneInsertIndices(section, 'in')).toEqual([0, 2, 3]);
  });

  it('calculates gap and width values from a pointer offset', () => {
    const section = point('a', 0, [10, 12], [], [2, 3]);
    expect(profileControlValue(section, 'in', 1, 'gap', 24)).toBe(4);
    expect(profileControlValue(section, 'in', 1, 'width', 22)).toBe(5);
  });

  it('snaps to the nearest visible width on either road side and reports every match', () => {
    const section = point('a', 0, [10, 8], [10, 12]);
    expect(snapProfileLaneWidth(section, 'in', 1, 9.7)).toEqual({
      value: 10,
      matches: [{ dir: 'in', laneIndex: 0 }, { dir: 'out', laneIndex: 0 }]
    });
    expect(snapProfileLaneWidth(section, 'in', 1, 9.5)).toEqual({ value: 9.5, matches: [] });
  });

  it('limits transition targets so they cannot cross another transition', () => {
    const profile = [
      point('a', 0, [0], []),
      point('b', 10, [10], []),
      point('c', 20, [10], []),
      point('d', 30, [0], [])
    ];
    expect(profileTransitionTargets(profile, 'in', 0, 0)).toEqual([-1, 1]);
    expect(profileTransitionTargets(profile, 'in', 0, 2)).toEqual([1, 3]);
  });

  it('places cap-end transitions on the first and last cross-sections', () => {
    const profile = [
      point('a', 0, [10], []),
      point('b', 10, [10], []),
      point('c', 20, [0], [])
    ];
    expect(profileTransitionSection(profile, 'in', 0, -1).distance).toBe(0);
    expect(profileTransitionSection(profile, 'in', 0, 2).distance).toBe(20);
  });

  it('uses half of the source lane as a transition drag preview at another boundary', () => {
    const profile = [
      point('a', 0, [0], []),
      point('b', 10, [10], [], [4]),
      point('c', 20, [10], [], [4]),
      point('d', 30, [0], [])
    ];
    const section = profileTransitionSection(profile, 'in', 0, 1, 0);
    expect(section.distance).toBe(15);
    expect(section.lanesIn[0]).toEqual({ width: 5, gap: 2 });
  });

  it('computes the lane total offset as the inner edge relative to the median', () => {
    const section: RoadProfilePoint = { id: 'a', distance: 0, medianWidth: 4, lanesIn: [], lanesOut: [{ width: 10, gap: 0 }, { width: 10, gap: 10 }] };
    expect(profileLaneTotalOffset(section, 'out', 0)).toBe(0);
    expect(profileLaneTotalOffset(section, 'out', 1)).toBe(20);
  });

  it('snaps a gap drag to the immediate neighbor total offsets and reports the matched neighbor', () => {
    const profile: RoadProfilePoint[] = [
      { id: 'a', distance: 0, medianWidth: 4, lanesIn: [], lanesOut: [{ width: 10, gap: 2 }] },
      { id: 'b', distance: 10, medianWidth: 4, lanesIn: [], lanesOut: [{ width: 10, gap: 5 }] },
      { id: 'c', distance: 20, medianWidth: 4, lanesIn: [], lanesOut: [{ width: 10, gap: 8 }] }
    ];
    expect(snapProfileLaneGap(profile, 'b', 'out', 0, 2.2)).toEqual({
      totalOffset: 2,
      matches: [{ pointId: 'a', dir: 'out', laneIndex: 0 }]
    });
    expect(snapProfileLaneGap(profile, 'b', 'out', 0, 5.1)).toEqual({ totalOffset: 5.1, matches: [] });
  });

  it('reports a start mover on the 0-width point before a present out-lane and an end mover on the 0-width point after', () => {
    const profile = [
      point('a', 0, [], [0]),
      point('b', 10, [], [10]),
      point('c', 20, [], [10]),
      point('d', 30, [], [0])
    ];
    expect(profileLaneStartEndMovers(profile, 'out', 0, 1)).toEqual([{ pointId: 'a', kind: 'start' }]);
    expect(profileLaneStartEndMovers(profile, 'out', 0, 2)).toEqual([{ pointId: 'd', kind: 'end' }]);
  });

  it('swaps start/end roles for in-lanes since travel runs toward decreasing distance', () => {
    const profile = [
      point('a', 0, [0], []),
      point('b', 10, [10], []),
      point('c', 20, [10], []),
      point('d', 30, [0], [])
    ];
    expect(profileLaneStartEndMovers(profile, 'in', 0, 1)).toEqual([{ pointId: 'a', kind: 'end' }]);
    expect(profileLaneStartEndMovers(profile, 'in', 0, 2)).toEqual([{ pointId: 'd', kind: 'start' }]);
  });
});
