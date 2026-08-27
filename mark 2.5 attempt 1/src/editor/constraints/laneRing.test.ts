import { describe, expect, it } from 'vitest';
import { type RoundaboutConfig } from '../../config/types';
import { assignLaneRingTarget, getLaneRingSnapPoints } from './laneRing';

const config: RoundaboutConfig = {
  island: { center: { x: 0, y: 0 }, radius: 15 },
  rings: [
    { id: 'start-ring', center: { x: 0, y: 0 }, radius: 30, width: 10 },
    { id: 'end-ring', center: { x: 200, y: 0 }, radius: 30, width: 10 },
    { id: 'disconnected', center: { x: 0, y: 200 }, radius: 30, width: 10 }
  ],
  arms: [{
    id: 'road',
    nodes: [
      { id: 'start', point: { x: 0, y: 0 }, medianWidth: 4, laneWidthsIn: [10], laneWidthsOut: [10] },
      { id: 'end', point: { x: 200, y: 0 }, medianWidth: 4, laneWidthsIn: [10], laneWidthsOut: [10] }
    ],
    lanesIn: [{ targetsRing: 'start-ring', filletRadius: 15 }],
    lanesOut: [{ sourceRing: 'start-ring', filletRadius: 15, dropsRing: false }]
  }],
  circulation: 'ccw'
};

describe('lane ring endpoint constraints', () => {
  it('offers only rings intersected by the relevant half of the road', () => {
    expect(getLaneRingSnapPoints(config, 'road', 'out', 0, 'start').map(target => target.ringId)).toEqual(['start-ring']);
    expect(getLaneRingSnapPoints(config, 'road', 'out', 0, 'end').map(target => target.ringId)).toEqual(['end-ring']);
  });

  it('assigns source and target rings without coupling them to lane type', () => {
    const withEndTarget = assignLaneRingTarget('road', 'out', 0, 'end-ring', config, 'end');
    expect(withEndTarget.arms[0].lanesOut[0]).toMatchObject({ sourceRing: 'start-ring', targetsRing: 'end-ring' });

    const withEndSource = assignLaneRingTarget('road', 'in', 0, 'end-ring', config, 'end');
    expect(withEndSource.arms[0].lanesIn[0]).toMatchObject({ sourceRing: 'end-ring', targetsRing: 'start-ring' });
  });
});
