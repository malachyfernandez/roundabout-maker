import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from './config';
import { solveBypassAttachmentPoints } from './routes';

function bypassPointsWithRing(center?: { x: number; y: number }) {
  const config = structuredClone(DEFAULT_CONFIG);
  if (center) config.rings.push({ id: 'unrelated', center, radius: 35, width: 12 });
  return solveBypassAttachmentPoints(config, 'east', 0, 'north', 0, 32);
}

describe('bypass preview placement', () => {
  it('is not displaced by a disconnected ring in the bypass quadrant', () => {
    const baseline = bypassPointsWithRing();
    const withUnrelatedRing = bypassPointsWithRing({ x: 120, y: -120 });
    expect(baseline).not.toBeNull();
    expect(withUnrelatedRing).not.toBeNull();
    expect(withUnrelatedRing?.entry.x).toBeCloseTo(baseline!.entry.x, 4);
    expect(withUnrelatedRing?.entry.y).toBeCloseTo(baseline!.entry.y, 4);
    expect(withUnrelatedRing?.exit.x).toBeCloseTo(baseline!.exit.x, 4);
    expect(withUnrelatedRing?.exit.y).toBeCloseTo(baseline!.exit.y, 4);
  });
});
