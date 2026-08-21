export type Vec2 = { x: number; y: number };

export const EPS = 1e-9;
export const GEOM_EPS = 1e-6;

export function add(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x + b.x, y: a.y + b.y };
}

export function sub(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x - b.x, y: a.y - b.y };
}

export function scale(v: Vec2, s: number): Vec2 {
  return { x: v.x * s, y: v.y * s };
}

export function dot(a: Vec2, b: Vec2): number {
  return a.x * b.x + a.y * b.y;
}

export function cross(a: Vec2, b: Vec2): number {
  return a.x * b.y - a.y * b.x;
}

export function len(v: Vec2): number {
  return Math.hypot(v.x, v.y);
}

export function norm(v: Vec2): Vec2 {
  const l = len(v);
  if (l < EPS) return { x: 0, y: 0 };
  return { x: v.x / l, y: v.y / l };
}

// Aliases used by some modules
export const normalize = norm;
export const magnitude = len;

// In SVG screen space (+x right, +y down), 90 deg rotation clockwise is (-y, x).
// Wait, if vector is (1, 0) [right]. Left of it visually is UP (0, -1). 
// Let's verify: perpLeft(1, 0) -> (0, -1). Correct.
export function perpLeft(v: Vec2): Vec2 {
  return { x: v.y, y: -v.x };
}

export function lerp(a: Vec2, b: Vec2, t: number): Vec2 {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

export function angleOf(v: Vec2): number {
  return Math.atan2(v.y, v.x);
}

export function fromAngle(a: number): Vec2 {
  return { x: Math.cos(a), y: Math.sin(a) };
}

export function rot(v: Vec2, a: number): Vec2 {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return {
    x: v.x * c - v.y * s,
    y: v.x * s + v.y * c
  };
}
