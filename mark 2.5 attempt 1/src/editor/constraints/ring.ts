import { type RoundaboutConfig } from '../../config/types';

export function removeRing(original: RoundaboutConfig, ringId: string): RoundaboutConfig {
  const next = structuredClone(original);
  next.rings = next.rings.filter(candidate => candidate.id !== ringId);
  for (const arm of next.arms) {
    for (const lane of [...arm.lanesIn, ...arm.lanesOut]) {
      if (lane.targetsRing === ringId) delete lane.targetsRing;
      if (lane.sourceRing === ringId) {
        delete lane.sourceRing;
        // dropsRing means "drop the remainder of this lane's source ring".
        // With the source ring gone the flag must not carry over to whatever
        // ring the lane geometrically re-resolves to next — that would cut a
        // dropped exit into an unrelated overlapping ring and erase its
        // full-circle pavement.
        lane.dropsRing = false;
      }
    }
  }
  return next;
}
