import { describe, expect, it } from 'vitest';
import { type RoundaboutConfig } from '../../config/types';
import { removeRing } from './ring';

const config: RoundaboutConfig = {
  island: { center: { x: 0, y: 0 }, radius: 15 },
  rings: [
    { id: 'inner', center: { x: -8, y: 0 }, radius: 35, width: 12 },
    { id: 'outer', center: { x: 8, y: 0 }, radius: 35, width: 12 }
  ],
  arms: [
    {
      id: 'north',
      nodes: [
        { id: 'n0', point: { x: 0, y: 0 }, medianWidth: 4, laneWidthsIn: [10], laneWidthsOut: [10] },
        { id: 'n1', point: { x: 0, y: -150 }, medianWidth: 4, laneWidthsIn: [10], laneWidthsOut: [10] }
      ],
      lanesIn: [{ targetsRing: 'outer', filletRadius: 40 }],
      lanesOut: [
        { sourceRing: 'outer', filletRadius: 40, dropsRing: true },
        { sourceRing: 'inner', filletRadius: 40, dropsRing: true }
      ]
    }
  ],
  circulation: 'ccw'
};

describe('removeRing', () => {
  it('removes the ring and clears lane references to it', () => {
    const next = removeRing(config, 'outer');
    expect(next.rings.map(r => r.id)).toEqual(['inner']);
    expect(next.arms[0].lanesIn[0].targetsRing).toBeUndefined();
    expect(next.arms[0].lanesOut[0].sourceRing).toBeUndefined();
  });

  it('clears dropsRing on lanes whose source ring was removed so the flag cannot transfer to an overlapping ring', () => {
    const next = removeRing(config, 'outer');
    expect(next.arms[0].lanesOut[0].dropsRing).toBe(false);
  });

  it('keeps dropsRing on lanes that source a surviving ring', () => {
    const next = removeRing(config, 'outer');
    expect(next.arms[0].lanesOut[1].sourceRing).toBe('inner');
    expect(next.arms[0].lanesOut[1].dropsRing).toBe(true);
  });

  it('does not mutate the original config', () => {
    removeRing(config, 'outer');
    expect(config.rings).toHaveLength(2);
    expect(config.arms[0].lanesOut[0].sourceRing).toBe('outer');
    expect(config.arms[0].lanesOut[0].dropsRing).toBe(true);
  });
});
