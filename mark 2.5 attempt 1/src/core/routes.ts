import { type RoundaboutConfig } from './config';
import { solveFillet, type FilletSolution } from '../geometry/fillet';
import { type Line, normalizeAngle } from '../geometry/primitives';
import { sub, normalize, dot, len } from '../math/vector';
import { offsetSpline } from '../math/spline';

export type EntryLeg = {
  armId: string;
  laneIdx: number;
  line: Line;
  points: {x:number, y:number}[];
  fillet: FilletSolution;
};

export type ExitLeg = {
  armId: string;
  laneIdx: number;
  line: Line;
  points: {x:number, y:number}[];
  fillet: FilletSolution;
};

export type ThroughRoute = {
  kind: 'through';
  id: string;
  ringId: string;
  entry: EntryLeg;
  ringSpan: { a0: number; a1: number; dir: 1 | -1 };
  exit: ExitLeg;
};

export type StandaloneEntry = {
  kind: 'standalone-entry';
  id: string;
  ringId: string;
  entry: EntryLeg;
};

export type StandaloneExit = {
  kind: 'standalone-exit';
  id: string;
  ringId: string;
  exit: ExitLeg;
};

export type FullRingRoute = {
  kind: 'full-ring';
  id: string;
  ringId: string;
  center: { x: number; y: number };
  radius: number;
};

export type RouteSymbolic = ThroughRoute | StandaloneEntry | StandaloneExit | FullRingRoute;

// Map circulation string to geometric dir (1 = increasing angle, -1 = decreasing)
export function getCircDir(circ: 'ccw' | 'cw'): 1 | -1 {
  return circ === 'ccw' ? -1 : 1;
}

// Signed angular distance from `from` to `to` walking in `dir`. Result in [0, 2π).
function angularDistance(from: number, to: number, dir: 1 | -1): number {
  let diff = normalizeAngle(to - from);
  if (dir === 1 && diff < 0) diff += 2 * Math.PI;
  if (dir === -1 && diff > 0) diff -= 2 * Math.PI;
  return Math.abs(diff);
}

function solveFilletAlongPath(
  points: { x: number; y: number }[],
  ringCenter: { x: number; y: number },
  ringRadius: number,
  filletRadius: number,
  turnDir: 1 | -1,
  isEntry: boolean,
  circDir: 1 | -1
): { line: Line; fillet: FilletSolution } | null {
  let best: { line: Line; fillet: FilletSolution; distance: number } | null = null;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const outward = normalize(sub(b, a));
    if (len(outward) < 1e-9) continue;
    const line: Line = {
      kind: 'line',
      p: isEntry ? b : a,
      u: isEntry ? { x: -outward.x, y: -outward.y } : outward,
      t0: -1000,
      t1: 1000
    };
    const fillet = solveFillet(line, ringCenter, ringRadius, filletRadius, turnDir, isEntry, circDir);
    if (!fillet) continue;
    const edge = sub(b, a);
    const edgeLengthSquared = dot(edge, edge);
    const t = Math.max(0, Math.min(1, dot(sub(fillet.tangentPointLine, a), edge) / edgeLengthSquared));
    const projected = { x: a.x + edge.x * t, y: a.y + edge.y * t };
    const distance = len(sub(fillet.tangentPointLine, projected));
    if (!best || distance < best.distance) best = { line, fillet, distance };
  }
  return best ? { line: best.line, fillet: best.fillet } : null;
}

export function compileRoutes(config: RoundaboutConfig): RouteSymbolic[] {
  const circDir = getCircDir(config.circulation);
  const isRHD = config.circulation === 'ccw';

  // 1. Precompute lane centerlines for all arms
  const lanePaths = new Map<string, { points: {x:number, y:number}[], line: Line }>();

  for (const arm of config.arms) {
    if (arm.nodes.length < 2) continue;
    
    const baseSpline = {
      points: arm.nodes.map(n => n.point),
      nodes: arm.nodes,
      alpha: 0.5, // Centripetal
      tension: 0.0
    };

    // Helper to calculate cumulative widths at each node for offsetting
    const getOffsets = (getLaneWidths: (n: any) => number[], getMedian: (n: any) => number, laneIdx: number, isRHD: boolean, isEntry: boolean) => {
      return arm.nodes.map(node => {
        const laneWidths = getLaneWidths(node);
        const median = getMedian(node);
        let offset = median / 2;
        for (let i = 0; i <= laneIdx; i++) {
          if (i === laneIdx) {
            offset += (laneWidths[i] || 10) / 2;
          } else {
            offset += (laneWidths[i] || 10);
          }
        }
        // Base spline goes from center OUTWARDS. Tangent points outward.
        // perpLeft of outward = visual left when facing outward.
        // Positive offset = left of outward direction.
        //
        // RHD: you drive on the right side of the road.
        //   Entry (coming IN): right side when facing inward = LEFT side when facing outward = +offset
        //   Exit (going OUT):  right side when facing outward = -offset
        // LHD: mirror.
        //   Entry: -offset
        //   Exit:  +offset
        if (isRHD) {
          return isEntry ? offset : -offset;
        } else {
          return isEntry ? -offset : offset;
        }
      });
    };

    for (let i = 0; i < arm.lanesIn.length; i++) {
      const offsets = getOffsets(n => n.laneWidthsIn || [], n => n.medianWidth, i, isRHD, true);
      const lanePoints = offsetSpline(baseSpline, offsets, 90); // returns array of Vec2
      
      // Lane points go from center to out. The entry vector goes from out to center.
      // So tangent at [0] goes from center to out. We negate it for uIn.
      const pNear = lanePoints[0];
      const pNext = lanePoints[1];
      const uIn = normalize(sub(pNear, pNext)); // Points towards the roundabout center

      // The line used for fillet calculation starts far away and points towards pNear
      const pFar = lanePoints[lanePoints.length - 1];

      lanePaths.set(`${arm.id}_in_${i}`, {
        points: lanePoints,
        line: { kind: 'line', p: pFar, u: uIn, t0: 0, t1: 1000 }
      });
    }

    for (let i = 0; i < arm.lanesOut.length; i++) {
      const offsets = getOffsets(n => n.laneWidthsOut || [], n => n.medianWidth, i, isRHD, false);
      const lanePoints = offsetSpline(baseSpline, offsets, 90);
      
      // Exit vector goes from center to out.
      const pNear = lanePoints[0];
      const pNext = lanePoints[1];
      const uOut = normalize(sub(pNext, pNear)); // Points away from the roundabout center

      lanePaths.set(`${arm.id}_out_${i}`, {
        points: lanePoints,
        line: { kind: 'line', p: pNear, u: uOut, t0: 0, t1: 1000 }
      });
    }
  }

  // 2. Solve fillets for all entry and exit lanes
  type CutPoint = {
    type: 'entry' | 'exit';
    armId: string;
    laneIdx: number;
    angle: number;
    fillet: FilletSolution;
    line: Line;
    dropsRing: boolean; // only meaningful for exits
  };

  const ringCuts = new Map<string, CutPoint[]>();
  for (const ring of config.rings) ringCuts.set(ring.id, []);

  const getRing = (id: string) => config.rings.find((r) => r.id === id)!;
  const turnDir = isRHD ? -1 : 1;

  for (const arm of config.arms) {
    for (let i = 0; i < arm.lanesIn.length; i++) {
      const lane = arm.lanesIn[i];
      const ring = getRing(lane.targetsRing);
      const path = lanePaths.get(`${arm.id}_in_${i}`)!;
      const rFillet = lane.filletRadius || 15;
      const solved = solveFilletAlongPath(path.points, ring.center, ring.radius, rFillet, turnDir, true, circDir);
      if (solved) {
        ringCuts.get(ring.id)!.push({
          type: 'entry', armId: arm.id, laneIdx: i,
          angle: solved.fillet.cutAngleRing, fillet: solved.fillet, line: solved.line, dropsRing: false,
        });
      }
    }

    for (let i = 0; i < arm.lanesOut.length; i++) {
      const lane = arm.lanesOut[i];
      const ring = getRing(lane.sourceRing);
      const path = lanePaths.get(`${arm.id}_out_${i}`)!;
      const rFillet = lane.filletRadius || 15;
      const solved = solveFilletAlongPath(path.points, ring.center, ring.radius, rFillet, turnDir, false, circDir);
      if (solved) {
        ringCuts.get(ring.id)!.push({
          type: 'exit', armId: arm.id, laneIdx: i,
          angle: solved.fillet.cutAngleRing, fillet: solved.fillet, line: solved.line, dropsRing: lane.dropsRing,
        });
      }
    }
  }

  // 3. Compile routes per ring using dropsRing logic
  const routes: RouteSymbolic[] = [];

  for (const [ringId, cuts] of ringCuts.entries()) {
    const entries = cuts.filter((c) => c.type === 'entry');
    const exits = cuts.filter((c) => c.type === 'exit');
    const droppedExits = exits.filter((e) => e.dropsRing);

    if (droppedExits.length === 0) {
      // Full circle ring!
      if (entries.length > 0 || exits.length > 0) {
        const ring = getRing(ringId);
        routes.push({
          kind: 'full-ring',
          id: `ring_${ringId}_full`,
          ringId,
          center: ring.center,
          radius: ring.radius,
        });
      }
      for (const entry of entries) {
        routes.push({
          kind: 'standalone-entry',
          id: `entry_${entry.armId}-${entry.laneIdx}_${ringId}`,
          ringId,
          entry: { armId: entry.armId, laneIdx: entry.laneIdx, line: entry.line, fillet: entry.fillet, points: lanePaths.get(`${entry.armId}_in_${entry.laneIdx}`)!.points },
        });
      }
      for (const exit of exits) {
        routes.push({
          kind: 'standalone-exit',
          id: `exit_${exit.armId}-${exit.laneIdx}_${ringId}`,
          ringId,
          exit: { armId: exit.armId, laneIdx: exit.laneIdx, line: exit.line, fillet: exit.fillet, points: lanePaths.get(`${exit.armId}_out_${exit.laneIdx}`)!.points },
        });
      }
      continue;
    }

    // Determine the start for our perimeter walk. Use any dropped exit.
    const startDrop = droppedExits[0];

    // Sort cuts downstream from startDrop
    const sortedCuts = cuts.map(c => {
      let d = angularDistance(startDrop.angle, c.angle, circDir);
      if (d < 1e-5) {
        if (c === startDrop) d = 2 * Math.PI;
        else if (c.type === 'exit' && c.dropsRing) d = 2 * Math.PI;
        else d = 0; // Entries at the exact same angle start the lap
      }
      return { cut: c, dist: d };
    }).sort((a, b) => {
      if (Math.abs(a.dist - b.dist) > 1e-5) return a.dist - b.dist;
      if (a.cut.type === 'entry' && b.cut.type === 'exit') return -1;
      if (a.cut.type === 'exit' && b.cut.type === 'entry') return 1;
      return 0;
    }).map(x => x.cut);

    let currentThroughEntry: CutPoint | null = null;

    for (const cut of sortedCuts) {
      if (cut.type === 'entry') {
        if (!currentThroughEntry) {
          currentThroughEntry = cut;
        } else {
          routes.push({
            kind: 'standalone-entry',
            id: `entry_${cut.armId}-${cut.laneIdx}_${ringId}`,
            ringId,
            entry: { armId: cut.armId, laneIdx: cut.laneIdx, line: cut.line, fillet: cut.fillet, points: lanePaths.get(`${cut.armId}_in_${cut.laneIdx}`)!.points },
          });
        }
      } else if (cut.type === 'exit') {
        if (cut.dropsRing) {
          if (currentThroughEntry) {
            routes.push({
              kind: 'through',
              id: `route_${currentThroughEntry.armId}-${currentThroughEntry.laneIdx}_to_${cut.armId}-${cut.laneIdx}`,
              ringId,
              entry: { armId: currentThroughEntry.armId, laneIdx: currentThroughEntry.laneIdx, line: currentThroughEntry.line, fillet: currentThroughEntry.fillet, points: lanePaths.get(`${currentThroughEntry.armId}_in_${currentThroughEntry.laneIdx}`)!.points },
              ringSpan: { a0: currentThroughEntry.angle, a1: cut.angle, dir: circDir },
              exit: { armId: cut.armId, laneIdx: cut.laneIdx, line: cut.line, fillet: cut.fillet, points: lanePaths.get(`${cut.armId}_out_${cut.laneIdx}`)!.points },
            });
            currentThroughEntry = null;
          } else {
            routes.push({
              kind: 'standalone-exit',
              id: `exit_${cut.armId}-${cut.laneIdx}_${ringId}`,
              ringId,
              exit: { armId: cut.armId, laneIdx: cut.laneIdx, line: cut.line, fillet: cut.fillet, points: lanePaths.get(`${cut.armId}_out_${cut.laneIdx}`)!.points },
            });
          }
        } else {
          routes.push({
            kind: 'standalone-exit',
            id: `exit_${cut.armId}-${cut.laneIdx}_${ringId}`,
            ringId,
            exit: { armId: cut.armId, laneIdx: cut.laneIdx, line: cut.line, fillet: cut.fillet, points: lanePaths.get(`${cut.armId}_out_${cut.laneIdx}`)!.points },
          });
        }
      }
    }
  }

  return routes;
}
