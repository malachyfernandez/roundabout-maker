import { describe, expect, it } from 'vitest';
import { type RoundaboutConfig } from '../config/types';
import { DEFAULT_CONFIG } from './config';
import { compileRoutes, laneRoleAtEndpoint, resolveLaneRing } from './routes';
import { solveGeometry } from './solver';
import { dragLaneFilletRadius } from '../editor/constraints/laneBypass';
import { segmentPoints } from '../rendering/markings';

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

  it('never leaves connected lanes without pavement when a multi-lane road is shortened', () => {
    for (const length of [35, 45, 55, 70, 90]) {
      const shortened = structuredClone(DEFAULT_CONFIG);
      shortened.arms = [shortened.arms.find(arm => arm.id === 'north')!];
      shortened.arms[0].nodes[1].point = { x: 0, y: -length };
      const segments = solveGeometry(shortened, compileRoutes(shortened, { profileEnabled: true }));
      for (const dir of ['in', 'out'] as const) {
        for (let laneIndex = 0; laneIndex < 2; laneIndex++) {
          const lines = segments.filter(segment => segment.source.kind === 'lane'
            && segment.source.armId === 'north'
            && segment.source.dir === dir
            && segment.source.laneIndex === laneIndex
            && (segment.kind === 'entry-line' || segment.kind === 'exit-line'));
          expect(lines.length).toBeGreaterThan(0);
          expect(lines.some(segment => {
            const points = segmentPoints(segment);
            return points.length >= 2 && points.some((point, index) => index > 0 && Math.hypot(point.x - points[index - 1].x, point.y - points[index - 1].y) > .1);
          })).toBe(true);
        }
      }
    }
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
