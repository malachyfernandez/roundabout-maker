import { describe, expect, it } from 'vitest';
import { type RoadProfilePoint } from '../config/types';
import {
  profileControlValue,
  profileLaneInsertIndices,
  profileSideOuter,
  profileTransitionSection,
  profileTransitionTargets,
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
    expect(profileTransitionTargets(profile, 'in', 0, 0)).toEqual([1]);
    expect(profileTransitionTargets(profile, 'in', 0, 2)).toEqual([1]);
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
});
