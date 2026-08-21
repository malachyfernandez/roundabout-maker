import { DEFAULT_CONFIG } from '../src/core/config';
import { compileRoutes } from '../src/core/routes';
import { solveGeometry } from '../src/core/solver';
import { Arc, Line, arcPoint, linePoint } from '../src/geometry/primitives';
import * as fs from 'fs';
import * as path from 'path';

const routes = compileRoutes(DEFAULT_CONFIG);
const segments = solveGeometry(DEFAULT_CONFIG, routes);

let out = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-100 -100 200 200" width="800" height="800" style="background-color:#f0f0f0;">\n`;
out += `  <circle cx="${DEFAULT_CONFIG.island.center.x}" cy="${DEFAULT_CONFIG.island.center.y}" r="${DEFAULT_CONFIG.island.radius}" fill="#ccc" stroke="#999" stroke-width="0.5" />\n`;

for (const seg of segments) {
  let d = "";
  if (seg.geom.kind === "line") {
    const line = seg.geom as Line;
    const p0 = linePoint(line, line.t0);
    const p1 = linePoint(line, line.t1);
    d = `M ${p0.x} ${p0.y} L ${p1.x} ${p1.y}`;
  } else {
    const arc = seg.geom as Arc;
    const p0 = arcPoint(arc, arc.a0);
    const p1 = arcPoint(arc, arc.a1);
    
    const r = arc.r;
    const diff = Math.abs(arc.a1 - arc.a0);
    const isFullCircle = diff >= Math.PI * 2 - 1e-6;
    const sweep = arc.dir === 1 ? 1 : 0;
    
    if (isFullCircle) {
      const pMid = arcPoint(arc, arc.a0 + Math.PI * arc.dir);
      d = `M ${p0.x} ${p0.y} A ${r} ${r} 0 1 ${sweep} ${pMid.x} ${pMid.y} A ${r} ${r} 0 1 ${sweep} ${p0.x} ${p0.y}`;
    } else {
      const largeArc = diff > Math.PI ? 1 : 0;
      d = `M ${p0.x} ${p0.y} A ${r} ${r} 0 ${largeArc} ${sweep} ${p1.x} ${p1.y}`;
    }
  }

  out += `  <path d="${d}" fill="none" stroke="${seg.color}" stroke-width="${seg.lineWidth}" stroke-linecap="butt" />\n`;
  out += `  <path d="${d}" fill="none" stroke="rgba(0,0,0,0.5)" stroke-width="1" stroke-linecap="butt" />\n`;
}
out += `</svg>`;

fs.writeFileSync(path.join(process.cwd(), 'scripts', 'out.svg'), out);
console.log("Wrote out.svg");
