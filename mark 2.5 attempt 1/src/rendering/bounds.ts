import { type ResolvedSegment } from '../core/solver';
import { arcContainsAngle, arcPoint } from '../geometry/primitives';
import { type Marking } from './markings';

export type Bounds = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

export function boundsFromPoints(points: { x: number; y: number }[], padding = 0): Bounds {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  return { minX: minX - padding, minY: minY - padding, maxX: maxX + padding, maxY: maxY + padding };
}

export function boundsIntersect(a: Bounds, b: Bounds) {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
}

export function offsetBounds(bounds: Bounds, offset: { x: number; y: number }): Bounds {
  return {
    minX: bounds.minX + offset.x,
    minY: bounds.minY + offset.y,
    maxX: bounds.maxX + offset.x,
    maxY: bounds.maxY + offset.y
  };
}

export function resolvedSegmentBounds(segment: ResolvedSegment): Bounds {
  const halfWidth = Math.max(segment.wStart, segment.wEnd, ...(segment.widths ?? [])) / 2;
  if (segment.geom.kind === 'line') {
    const start = {
      x: segment.geom.p.x + segment.geom.u.x * segment.geom.t0,
      y: segment.geom.p.y + segment.geom.u.y * segment.geom.t0
    };
    const end = {
      x: segment.geom.p.x + segment.geom.u.x * segment.geom.t1,
      y: segment.geom.p.y + segment.geom.u.y * segment.geom.t1
    };
    return boundsFromPoints([start, end], halfWidth);
  }
  if (segment.geom.kind === 'polyline') return boundsFromPoints(segment.geom.points, halfWidth);
  const points = [arcPoint(segment.geom, segment.geom.a0), arcPoint(segment.geom, segment.geom.a1)];
  for (const angle of [0, Math.PI / 2, Math.PI, Math.PI * 3 / 2]) {
    if (arcContainsAngle(segment.geom, angle)) points.push(arcPoint(segment.geom, angle));
  }
  return boundsFromPoints(points, halfWidth);
}

export function markingBounds(marking: Marking, widthScale: number): Bounds {
  return boundsFromPoints(marking.points, marking.kind === 'stroke' ? marking.width * widthScale / 2 : 0);
}
