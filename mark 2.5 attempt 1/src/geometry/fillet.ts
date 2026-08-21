import { type Line, type Arc, normalizeAngle } from './primitives';
import { type Vec2, add, sub, scale, perpLeft, dot, len, angleOf, EPS } from '../math/vector';

export type FilletSolution = {
  tLine: number; // The t parameter on the straight line where the fillet starts/ends
  tangentPointLine: Vec2; // The point on the line
  tangentPointRing: Vec2; // The point on the ring
  cutAngleRing: number; // The angle on the ring
  arc: Arc; // The fillet arc segment
};

/**
 * Solves for a fillet between a line and a circular ring.
 * 
 * @param line The lane centerline (must be pointing in travel direction).
 * @param ringCenter Center of the roundabout ring.
 * @param ringRadius Centerline radius of the ring.
 * @param filletRadius The radius of the turning fillet.
 * @param turnDir +1 if the fillet center is to the 'left' of the lane (using perpLeft), -1 if 'right'.
 *                (Determines which side of the line the fillet arcs into).
 * @param isEntry true if the lane is entering the ring, false if exiting.
 * @param circDir The circulation direction of the ring (+1 for visually CW/increasing angle, -1 for CCW).
 */
export function solveFillet(
  line: Line,
  ringCenter: Vec2,
  ringRadius: number,
  filletRadius: number,
  turnDir: 1 | -1,
  isEntry: boolean,
  circDir: 1 | -1
): FilletSolution | null {
  // Fillet center F = line.p + t*line.u + turnDir * filletRadius * perpLeft(line.u)
  // We need |F - ringCenter| = ringRadius + filletRadius (External tangency)
  // Let n = perpLeft(line.u)
  const n = perpLeft(line.u);
  const offset = scale(n, turnDir * filletRadius);
  
  // A = line.p + offset - ringCenter
  const A = sub(add(line.p, offset), ringCenter);
  
  // Equation: |A + t*line.u|^2 = (ringRadius + filletRadius)^2
  // t^2 + 2*(A dot u)*t + |A|^2 - (R+r)^2 = 0
  const R_plus_r = ringRadius + filletRadius;
  const B = 2 * dot(A, line.u);
  const C = dot(A, A) - R_plus_r * R_plus_r;
  
  const D = B * B - 4 * C;
  if (D < -EPS) return null; // No real solution
  
  const sqrtD = Math.sqrt(Math.max(0, D));
  const t1 = (-B - sqrtD) / 2;
  const t2 = (-B + sqrtD) / 2;
  
  // For entry, the vehicle is traveling towards the ring, so we want the FIRST intersection 
  // with the offset circle that it encounters. Thus, we pick the smaller t.
  // For exit, the vehicle is traveling away from the ring, we want the intersection further along the exit lane.
  // Wait, actually, the line `p` could be anywhere. 
  // The correct tangent point on the ring must be such that the tangency direction matches travel.
  // Let's check both t's and find the one that yields a valid tangency match.
  
  let bestSolution: FilletSolution | null = null;
  
  let ts = [t1, t2];
  if (isEntry) {
    ts.sort((a, b) => a - b); // for entry, we want the first intersection encountered
  } else {
    ts.sort((a, b) => b - a); // for exit (starting at center), we want the intersection forward in time (t > 0)
  }
  
  for (const t of ts) {
    const F = add(add(line.p, scale(line.u, t)), offset);
    
    // Tangent point on line
    const pLine = add(line.p, scale(line.u, t));
    
    // Tangent point on ring
    // Since F is at distance R+r from ringCenter, the point on the ring is along the vector from ringCenter to F
    const vCenterToF = sub(F, ringCenter);
    const distF = len(vCenterToF);
    if (distF < EPS) continue;
    
    const pRing = add(ringCenter, scale(vCenterToF, ringRadius / distF));
    const cutAngle = angleOf(vCenterToF);
    
    // Determine fillet arc angles.
    // The fillet arc goes from pLine to pRing (for entry) or pRing to pLine (for exit).
    const angleAtLine = angleOf(sub(pLine, F));
    const angleAtRing = angleOf(sub(pRing, F));
    
    // The direction of the fillet arc depends on circDir, isEntry, and turnDir.
    // However, we can also deduce it geometrically by checking which direction 
    // makes the tangent at pLine match line.u (for entry) or tangent at pRing match ring tangent.
    // Let's just build both arcs and check tangency.
    for (const fDir of [1, -1] as const) {
      let a0, a1;
      if (isEntry) {
        a0 = angleAtLine;
        a1 = angleAtRing;
      } else {
        a0 = angleAtRing;
        a1 = angleAtLine;
      }
      
      // Unwrap a1 based on fDir
      a1 = normalizeAngle(a1);
      a0 = normalizeAngle(a0);
      
      let diff = a1 - a0;
      if (fDir === 1 && diff < 0) diff += 2 * Math.PI;
      if (fDir === -1 && diff > 0) diff -= 2 * Math.PI;
      
      // A fillet should take the short path (<= PI). If diff is > PI, this is a cloverleaf loop!
      if (Math.abs(diff) > Math.PI) continue;
      
      a1 = a0 + diff;
      
      const arc: Arc = {
        kind: "arc",
        c: F,
        r: filletRadius,
        a0,
        a1,
        dir: fDir
      };
      
      // Verify tangency at line
      // For entry, arc starts at a0 (which is angleAtLine). Tangent should match line.u
      // For exit, arc ends at a1 (which is angleAtLine). Tangent should match line.u
      const checkAngleLine = isEntry ? arc.a0 : arc.a1;
      const tanLine = getArcTangent(arc, checkAngleLine);
      if (dot(tanLine, line.u) < 0.99) continue;
      
      // Verify tangency at ring
      // For entry, arc ends at a1 (angleAtRing). Tangent should match ring tangent
      // For exit, arc starts at a0 (angleAtRing). Tangent should match ring tangent
      const checkAngleRing = isEntry ? arc.a1 : arc.a0;
      const tanRing = getArcTangent(arc, checkAngleRing);
      
      // Ring tangent at cutAngle
      // If ring circDir is +1 (increasing angle), tangent is perp to radius in +1 dir
      const rDirVec = { x: Math.cos(cutAngle), y: Math.sin(cutAngle) };
      const ringTan = { x: circDir * -rDirVec.y, y: circDir * rDirVec.x };
      
      if (dot(tanRing, ringTan) < 0.99) continue;
      
      bestSolution = {
        tLine: t,
        tangentPointLine: pLine,
        tangentPointRing: pRing,
        cutAngleRing: cutAngle,
        arc
      };
      break;
    }
    if (bestSolution) break;
  }
  
  return bestSolution;
}

function getArcTangent(a: Arc, angle: number): Vec2 {
  const s = Math.sin(angle);
  const c = Math.cos(angle);
  return { x: a.dir * -s, y: a.dir * c };
}
