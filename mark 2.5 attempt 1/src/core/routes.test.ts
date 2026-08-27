import { describe, expect, it } from 'vitest';
import { type RoundaboutConfig } from '../config/types';
import { compileRoutes, laneRoleAtEndpoint, resolveLaneRing } from './routes';
import { solveGeometry } from './solver';
import { dragLaneFilletRadius } from '../editor/constraints/laneBypass';

const config: RoundaboutConfig = {
  island: { center: { x: 0, y: 0 }, radius: 15 },
  rings: [
    { id: 'left', center: { x: 0, y: 0 }, radius: 30, width: 10 },
    { id: 'right', center: { x: 200, y: 0 }, radius: 30, width: 10 },
    { id: 'unrelated', center: { x: 100, y: 100 }, radius: 30, width: 10 }
  ],
  arms: [{
    id: 'bridge',
    nodes: [
      { id: 'start', point: { x: 0, y: 0 }, medianWidth: 4, laneWidthsIn: [10], laneWidthsOut: [10] },
      { id: 'end', point: { x: 200, y: 0 }, medianWidth: 4, laneWidthsIn: [10], laneWidthsOut: [10] }
    ],
    lanesIn: [{ sourceRing: 'right', targetsRing: 'left', filletRadius: 15, dropsRing: false }],
    lanesOut: [{ sourceRing: 'left', targetsRing: 'right', filletRadius: 15, dropsRing: false }]
  }],
  circulation: 'ccw'
};

describe('road endpoint ring attachments', () => {
  it('derives entry and exit roles independently at both physical endpoints', () => {
    expect(laneRoleAtEndpoint('in', 'start')).toBe('entry');
    expect(laneRoleAtEndpoint('in', 'end')).toBe('exit');
    expect(laneRoleAtEndpoint('out', 'start')).toBe('exit');
    expect(laneRoleAtEndpoint('out', 'end')).toBe('entry');
  });

  it('resolves separate rings at both ends without selecting a disconnected ring', () => {
    const arm = config.arms[0];
    expect(resolveLaneRing(config, arm, 'in', 0, 'start')?.id).toBe('left');
    expect(resolveLaneRing(config, arm, 'in', 0, 'end')?.id).toBe('right');
    expect(resolveLaneRing(config, arm, 'out', 0, 'start')?.id).toBe('left');
    expect(resolveLaneRing(config, arm, 'out', 0, 'end')?.id).toBe('right');
  });

  it('compiles entry and exit connectors for both travel directions at both ends', () => {
    const segments = solveGeometry(config, compileRoutes(config, { profileEnabled: true }));
    const has = (dir: 'in' | 'out', endpoint: 'start' | 'end', kind: 'entry-fillet' | 'exit-fillet') => segments.some(segment =>
      segment.source.kind === 'lane'
      && segment.source.armId === 'bridge'
      && segment.source.dir === dir
      && segment.endpoint === endpoint
      && segment.kind === kind
    );
    expect(has('in', 'start', 'entry-fillet')).toBe(true);
    expect(has('in', 'end', 'exit-fillet')).toBe(true);
    expect(has('out', 'start', 'exit-fillet')).toBe(true);
    expect(has('out', 'end', 'entry-fillet')).toBe(true);
  });

  it('edits connector radii independently at the source and target rings', () => {
    const sourceChanged = dragLaneFilletRadius('bridge', 'out', 0, 'start', { x: 1, y: 0 }, { x: 5, y: 0 }, config);
    expect(sourceChanged.arms[0].lanesOut[0].sourceFilletRadius).toBe(20);
    expect(sourceChanged.arms[0].lanesOut[0].targetFilletRadius).toBeUndefined();

    const targetChanged = dragLaneFilletRadius('bridge', 'out', 0, 'end', { x: 1, y: 0 }, { x: 8, y: 0 }, sourceChanged);
    expect(targetChanged.arms[0].lanesOut[0].sourceFilletRadius).toBe(20);
    expect(targetChanged.arms[0].lanesOut[0].targetFilletRadius).toBe(23);
  });
});
