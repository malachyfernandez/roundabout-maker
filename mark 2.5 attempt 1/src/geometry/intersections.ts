import { type Line } from './primitives';
import { type Vec2, sub, cross, dot, len, scale, add, perpLeft, EPS, norm } from '../math/vector';

export function intersectLineLine(a: Line, b: Line): { ta: number; tb: number } | null {
  const det = cross(a.u, b.u);
  if (Math.abs(det) < EPS) return null; // Parallel

  const dp = sub(b.p, a.p);
  const ta = cross(dp, b.u) / det;
  const tb = cross(dp, a.u) / det;

  return { ta, tb };
}

export function intersectLineCircle(l: Line, c: Vec2, r: number): number[] {
  const dp = sub(l.p, c);
  const B = 2 * dot(dp, l.u);
  const C = dot(dp, dp) - r * r;
  const D = B * B - 4 * C;

  if (D < -EPS) return [];
  if (D <= EPS) return [-B / 2];

  const sqrtD = Math.sqrt(D);
  return [(-B - sqrtD) / 2, (-B + sqrtD) / 2];
}

export function intersectCircleCircle(c1: Vec2, r1: number, c2: Vec2, r2: number): Vec2[] {
  const dVec = sub(c2, c1);
  const d = len(dVec);

  if (d > r1 + r2 + EPS) return []; // Too far apart
  if (d < Math.abs(r1 - r2) - EPS) return []; // One inside the other
  if (d < EPS && Math.abs(r1 - r2) < EPS) return []; // Coincident circles

  // a = (r1^2 - r2^2 + d^2) / (2*d)
  const a = (r1 * r1 - r2 * r2 + d * d) / (2 * d);
  const hSq = r1 * r1 - a * a;
  
  // Guard against float precision issues where hSq is slightly negative
  if (hSq < -EPS) return [];
  const h = Math.sqrt(Math.max(0, hSq));

  const uv = norm(dVec);
  const p2 = add(c1, scale(uv, a));

  if (h < EPS) {
    return [p2];
  }

  const perp = perpLeft(uv);
  return [
    add(p2, scale(perp, h)),
    sub(p2, scale(perp, h))
  ];
}
