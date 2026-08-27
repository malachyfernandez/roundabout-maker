import { type RingConfig } from '../../config/types';
import { len, sub, type Vec2 } from '../../math/vector';

export function ringOuterEdgePathIndex(points: Vec2[], ring: RingConfig) {
  const outerRadius = ring.radius + ring.width / 2;
  let lastInside = 0;
  for (let index = 0; index < points.length; index++) {
    if (len(sub(points[index], ring.center)) <= outerRadius) lastInside = index;
  }
  return lastInside;
}
