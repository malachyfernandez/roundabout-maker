import { type Vec2, GEOM_EPS, fromAngle, add, scale } from '../math/vector';

export type Line = {
  kind: "line";
  p: Vec2;   // start point
  u: Vec2;   // unit direction
  t0: number;
  t1: number; // t1 > t0; point = p + t*u
};

export type Arc = {
  kind: "arc";
  c: Vec2;
  r: number;   // > 0
  a0: number;  // start angle
  a1: number;  // unwrapped so dir*(a1-a0) > 0 and <= 2pi
  dir: 1 | -1; // +1 = increasing angle (visually CW in screen space)
};

export type Polyline = {
  kind: "polyline";
  points: Vec2[];
};

export type Segment = Line | Arc | Polyline;

export function linePoint(l: Line, t: number): Vec2 {
  return add(l.p, scale(l.u, t));
}

export function arcPoint(a: Arc, angle: number): Vec2 {
  return add(a.c, scale(fromAngle(angle), a.r));
}

export function arcTangent(a: Arc, angle: number): Vec2 {
  // Tangent at angle 'a' is a vector perpendicular to the radial vector.
  // Radial vector is (cos(a), sin(a)).
  // If dir == 1 (increasing angle), tanget points towards angle + pi/2.
  // In our coordinates, +pi/2 is visually clockwise.
  // fromAngle(angle + pi/2) = (-sin(a), cos(a)).
  const s = Math.sin(angle);
  const c = Math.cos(angle);
  return { x: a.dir * -s, y: a.dir * c };
}

// Normalize angle to [-PI, PI]
export function normalizeAngle(a: number): number {
  let ang = a % (2 * Math.PI);
  if (ang < -Math.PI) ang += 2 * Math.PI;
  if (ang > Math.PI) ang -= 2 * Math.PI;
  return ang;
}

// Check if an angle is within the arc span, carefully handling wrapping.
// 'a' is assumed to be an absolute angle.
export function arcContainsAngle(arc: Arc, a: number): boolean {
  // Normalize everything relative to a0
  let diff = normalizeAngle(a - arc.a0);
  let totalSpan = arc.a1 - arc.a0; // can be up to 2pi or down to -2pi
  
  if (arc.dir === 1) {
    if (diff < -GEOM_EPS) diff += 2 * Math.PI;
    return diff >= -GEOM_EPS && diff <= totalSpan + GEOM_EPS;
  } else {
    if (diff > GEOM_EPS) diff -= 2 * Math.PI;
    return diff <= GEOM_EPS && diff >= totalSpan - GEOM_EPS;
  }
}
