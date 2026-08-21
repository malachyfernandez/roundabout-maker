import { type Vec2, add, sub, scale, perpLeft, magnitude, normalize } from './vector';

export type SplineNode = {
  point: Vec2;
  tangentIn?: Vec2;
  tangentOut?: Vec2;
};

export type CatmullRomSpline = {
  points: Vec2[];
  nodes?: SplineNode[];
  alpha: number; // 0.0 for uniform, 0.5 for centripetal, 1.0 for chordal
  tension: number; // 0.0 for standard Catmull-Rom
};

export type BezierSegment = {
  p0: Vec2;
  c1: Vec2;
  c2: Vec2;
  p1: Vec2;
};

function automaticHandle(nodes: SplineNode[], index: number): Vec2 {
  if (nodes.length < 2) return { x: 0, y: 0 };
  if (index === 0) return scale(sub(nodes[1].point, nodes[0].point), 1 / 3);
  if (index === nodes.length - 1) return scale(sub(nodes[index].point, nodes[index - 1].point), 1 / 3);
  return scale(sub(nodes[index + 1].point, nodes[index - 1].point), 1 / 6);
}

export function getBezierSegment(nodes: SplineNode[], index: number): BezierSegment {
  const start = nodes[index];
  const end = nodes[index + 1];
  const startHandle = start.tangentOut ?? automaticHandle(nodes, index);
  const endHandle = end.tangentIn ?? scale(automaticHandle(nodes, index + 1), -1);
  return {
    p0: start.point,
    c1: add(start.point, startHandle),
    c2: add(end.point, endHandle),
    p1: end.point
  };
}

function evaluateBezier(segment: BezierSegment, t: number): { p: Vec2, tangent: Vec2 } {
  const mt = 1 - t;
  const p = add(
    add(scale(segment.p0, mt * mt * mt), scale(segment.c1, 3 * mt * mt * t)),
    add(scale(segment.c2, 3 * mt * t * t), scale(segment.p1, t * t * t))
  );
  const derivative = add(
    scale(sub(segment.c1, segment.p0), 3 * mt * mt),
    add(scale(sub(segment.c2, segment.c1), 6 * mt * t), scale(sub(segment.p1, segment.c2), 3 * t * t))
  );
  return { p, tangent: normalize(derivative) };
}

export function splineToSvgPath(spline: CatmullRomSpline): string {
  if (!spline.nodes) return pointsToSvgPath(sampleSpline(spline, Math.max(20, spline.points.length * 20)).map(sample => sample.p));
  if (spline.nodes.length === 0) return "";
  let d = `M ${spline.nodes[0].point.x} ${spline.nodes[0].point.y}`;
  for (let i = 0; i < spline.nodes.length - 1; i++) {
    const segment = getBezierSegment(spline.nodes, i);
    d += ` C ${segment.c1.x} ${segment.c1.y} ${segment.c2.x} ${segment.c2.y} ${segment.p1.x} ${segment.p1.y}`;
  }
  return d;
}

/**
 * Calculates a point on a Catmull-Rom spline.
 * Assumes open spline (not looped). For edge segments, it artificially duplicates the endpoints.
 */
export function evaluateSpline(spline: CatmullRomSpline, t: number): { p: Vec2, tangent: Vec2 } {
  const { points, alpha } = spline;
  if (spline.nodes) {
    if (spline.nodes.length === 0) return { p: { x: 0, y: 0 }, tangent: { x: 1, y: 0 } };
    if (spline.nodes.length === 1) return { p: spline.nodes[0].point, tangent: { x: 1, y: 0 } };
    const segmentCount = spline.nodes.length - 1;
    const scaledT = Math.max(0, Math.min(1, t)) * segmentCount;
    const index = Math.min(Math.floor(scaledT), segmentCount - 1);
    return evaluateBezier(getBezierSegment(spline.nodes, index), scaledT - index);
  }
  if (points.length === 0) return { p: { x: 0, y: 0 }, tangent: { x: 1, y: 0 } };
  if (points.length === 1) return { p: points[0], tangent: { x: 1, y: 0 } };

  // For 2 points, just straight line
  if (points.length === 2) {
    const dir = sub(points[1], points[0]);
    return {
      p: add(points[0], scale(dir, t)),
      tangent: normalize(dir)
    };
  }

  // Find which segment t falls into
  const numSegments = points.length - 1;
  const scaledT = t * numSegments;
  const index = Math.min(Math.floor(scaledT), numSegments - 1);
  const localT = scaledT - index;

  // Get the 4 control points
  const p0 = points[Math.max(0, index - 1)];
  const p1 = points[index];
  const p2 = points[index + 1];
  const p3 = points[Math.min(points.length - 1, index + 2)];

  // Centripetal Catmull-Rom formula
  const getT = (t_i: number, p_i: Vec2, p_j: Vec2) => {
    const d = magnitude(sub(p_j, p_i));
    return t_i + Math.pow(d, alpha);
  };

  const t0 = 0.0;
  const t1 = getT(t0, p0, p1);
  const t2 = getT(t1, p1, p2);
  const t3 = getT(t2, p2, p3);

  // If t1 == t2, points are coincident
  if (Math.abs(t2 - t1) < 1e-6) {
    return { p: p1, tangent: normalize(sub(p2, p0)) };
  }

  // Remap localT to [t1, t2]
  const t_eval = t1 + localT * (t2 - t1);

  const A1 = (t_i: number, t_j: number, p_i: Vec2, p_j: Vec2, t_val: number) => {
    if (Math.abs(t_j - t_i) < 1e-6) return p_i;
    return add(scale(p_i, (t_j - t_val) / (t_j - t_i)), scale(p_j, (t_val - t_i) / (t_j - t_i)));
  };

  const a1 = A1(t0, t1, p0, p1, t_eval);
  const a2 = A1(t1, t2, p1, p2, t_eval);
  const a3 = A1(t2, t3, p2, p3, t_eval);

  const b1 = A1(t0, t2, a1, a2, t_eval);
  const b2 = A1(t1, t3, a2, a3, t_eval);

  const p = A1(t1, t2, b1, b2, t_eval);

  // Estimate tangent using central difference
  const dt = 0.001;
  const t_eval_plus = Math.min(t2, t_eval + dt);
  const t_eval_minus = Math.max(t1, t_eval - dt);
  
  const a1p = A1(t0, t1, p0, p1, t_eval_plus);
  const a2p = A1(t1, t2, p1, p2, t_eval_plus);
  const a3p = A1(t2, t3, p2, p3, t_eval_plus);
  const b1p = A1(t0, t2, a1p, a2p, t_eval_plus);
  const b2p = A1(t1, t3, a2p, a3p, t_eval_plus);
  const p_plus = A1(t1, t2, b1p, b2p, t_eval_plus);

  const a1m = A1(t0, t1, p0, p1, t_eval_minus);
  const a2m = A1(t1, t2, p1, p2, t_eval_minus);
  const a3m = A1(t2, t3, p2, p3, t_eval_minus);
  const b1m = A1(t0, t2, a1m, a2m, t_eval_minus);
  const b2m = A1(t1, t3, a2m, a3m, t_eval_minus);
  const p_minus = A1(t1, t2, b1m, b2m, t_eval_minus);

  const tangent = normalize(sub(p_plus, p_minus));

  return { p, tangent };
}

/**
 * Returns a list of discrete points sampling the spline, plus their normal vectors (offset direction).
 */
export function sampleSpline(spline: CatmullRomSpline, numSamples: number = 20) {
  const samples = [];
  for (let i = 0; i <= numSamples; i++) {
    const t = i / numSamples;
    const { p, tangent } = evaluateSpline(spline, t);
    samples.push({ p, tangent, normal: perpLeft(tangent) });
  }
  return samples;
}

/**
 * Creates an offset curve (polyline) from a base spline by interpolating offset distances.
 * @param offsets An array of offset values, one for each point in the base spline.
 */
export function offsetSpline(spline: CatmullRomSpline, offsets: number[], numSamples: number = 20) {
  const samples = sampleSpline(spline, numSamples);
  
  // Interpolate offset for each sample
  const offsetPoints = samples.map((sample, idx) => {
    const t = idx / numSamples;
    
    // Linearly interpolate between the provided offsets based on t
    const numSegments = offsets.length - 1;
    const scaledT = t * numSegments;
    const offsetIndex = Math.min(Math.floor(scaledT), numSegments - 1);
    const localT = scaledT - offsetIndex;
    
    let currentOffset = 0;
    if (offsets.length === 1) {
      currentOffset = offsets[0];
    } else if (offsets.length > 1) {
      currentOffset = offsets[offsetIndex] * (1 - localT) + offsets[offsetIndex + 1] * localT;
    }
    
    return add(sample.p, scale(sample.normal, currentOffset));
  });

  return offsetPoints;
}

/**
 * Converts an array of points into an SVG path data string (M ... L ... L ...)
 */
export function pointsToSvgPath(points: Vec2[]): string {
  if (points.length === 0) return "";
  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length; i++) {
    d += ` L ${points[i].x} ${points[i].y}`;
  }
  return d;
}
