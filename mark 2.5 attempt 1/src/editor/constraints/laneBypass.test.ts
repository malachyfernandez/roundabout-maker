import { describe, expect, it } from 'vitest';
import { type RoundaboutConfig } from '../../config/types';
import { dragBypassLanePoint, nearestRingOuterEdge } from './laneBypass';

const config: RoundaboutConfig = {
  island: { center: { x: 0, y: 0 }, radius: 20 },
  rings: [
    { id: 'left', center: { x: -8, y: 0 }, radius: 35, width: 12 },
    { id: 'right', center: { x: 8, y: 0 }, radius: 35, width: 12 }
  ],
  arms: [],
  bypasses: [{ id: 'bypass', fromArmId: 'a', fromLaneIndex: 0, toArmId: 'b', toLaneIndex: 0, entryRadius: 20, exitRadius: 20, lanePoint: { x: 8, y: 50 }, laneAngle: 0 }],
  circulation: 'ccw'
};

describe('bypass lane placement', () => {
  it('checks every offset ring and associates the bypass with the nearest outer edge', () => {
    expect(nearestRingOuterEdge(config.rings, { x: 8, y: 50 })?.id).toBe('right');
  });

  it('selects the nearby ring when a point is inside one offset ring and outside another', () => {
    expect(nearestRingOuterEdge(config.rings, { x: 45, y: 0 })?.id).toBe('right');
  });

  it('drags radially from the associated ring instead of a global largest ring', () => {
    const next = dragBypassLanePoint('bypass', { x: 0, y: 10 }, config);
    expect(next.bypasses?.[0].lanePoint).toEqual({ x: 8, y: 60 });
    expect(config.bypasses?.[0].lanePoint).toEqual({ x: 8, y: 50 });
  });
});
