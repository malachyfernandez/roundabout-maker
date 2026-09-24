import { type ArmConfig, type AuthoredRoadProfile, type LaneShape, type LaneShapeKey, type LaneSpan, type LaneTerminal, type ProfileLane, type RoadProfilePoint } from '../../config/types';

// Default distance from a lane terminal's tip to its attachment node when a
// free terminal is created (unsnapped from a cap or added with a new lane).
export const DEFAULT_LANE_TAPER = 16;

const present = (lane: ProfileLane | undefined) => (lane?.width ?? 0) > .05;
const close = (a: number, b: number) => Math.abs(a - b) < 1e-6;
export const profileCap = (profile: AuthoredRoadProfile, side: 'low' | 'high') =>
  (profile.median.find(key => key.endAnchor === (side === 'low' ? 'start' : 'end'))
    ?? (side === 'low' ? profile.median[0] : profile.median.at(-1)!)).distance;
const cap = profileCap;
const tip = (terminal: LaneTerminal, capDistance: number) => terminal.kind === 'cap' ? capDistance : terminal.tip;
const attach = (terminal: LaneTerminal, capDistance: number) => terminal.kind === 'cap' ? capDistance : terminal.attach;

function valueAt(keys: LaneShapeKey[], distance: number): ProfileLane {
  if (!keys.length) return { width: 0, gap: 0 };
  const upperIndex = keys.findIndex(key => key.distance >= distance);
  if (upperIndex <= 0) {
    const key = upperIndex === 0 ? keys[0] : keys.at(-1)!;
    return { width: key.width, gap: key.gap };
  }
  const a = keys[upperIndex - 1];
  const b = keys[upperIndex];
  const t = (distance - a.distance) / (b.distance - a.distance);
  return { width: a.width + (b.width - a.width) * t, gap: a.gap + (b.gap - a.gap) * t };
}

export function evaluateLane(profile: AuthoredRoadProfile, shape: LaneShape, distance: number): ProfileLane {
  const span = shape.spans.find(run => distance >= tip(run.low, cap(profile, 'low')) - 1e-6
    && distance <= tip(run.high, cap(profile, 'high')) + 1e-6);
  if (!span) return { width: 0, gap: valueAt(shape.keys, distance).gap };
  const loTip = tip(span.low, cap(profile, 'low'));
  const loAttach = attach(span.low, cap(profile, 'low'));
  const hiTip = tip(span.high, cap(profile, 'high'));
  const hiAttach = attach(span.high, cap(profile, 'high'));
  const lowFraction = loAttach > loTip ? Math.max(0, Math.min(1, (distance - loTip) / (loAttach - loTip))) : 1;
  const highFraction = hiTip > hiAttach ? Math.max(0, Math.min(1, (hiTip - distance) / (hiTip - hiAttach))) : 1;
  const fraction = Math.min(lowFraction, highFraction);
  // A key pinned at a taper tip is gap-only — the tip node has no width — so
  // it must not bend the width curve through the present region next to it.
  let widthKeys = shape.keys;
  for (const run of shape.spans) for (const side of ['low', 'high'] as const) {
    const terminal = run[side];
    if (terminal.kind === 'free' && widthKeys.some(key => close(key.distance, terminal.tip)))
      widthKeys = widthKeys.filter(key => !close(key.distance, terminal.tip));
  }
  // Inside a taper the lane's width fades from its cross-section at the
  // attachment; keys swallowed by the taper band can't bulge the wedge. The
  // gap still interpolates so migration matches legacy cross-sections.
  const value = valueAt(shape.keys, distance);
  const width = fraction < 1
    ? valueAt(widthKeys, lowFraction <= highFraction ? loAttach : hiAttach).width
    : valueAt(widthKeys, distance).width;
  return { width: width * fraction, gap: value.gap };
}

export function insideLaneTaper(shape: LaneShape, distance: number): boolean {
  return shape.spans.some(span => (['low', 'high'] as const).some(side => {
    const terminal = span[side];
    if (terminal.kind !== 'free') return false;
    const lo = Math.min(terminal.tip, terminal.attach);
    const hi = Math.max(terminal.tip, terminal.attach);
    return distance > lo + 1e-6 && distance < hi - 1e-6;
  }));
}

export function pruneTaperInteriorKeys(shape: LaneShape) {
  shape.keys = shape.keys.filter(key => !insideLaneTaper(shape, key.distance));
}

// A taper tip is an editable node with its own lateral offset, stored as a key
// pinned at the tip distance (the lane is zero-width there, so only the gap is
// meaningful). Materializing it at the interpolated value leaves the derived
// profile unchanged while letting the tip's offset be edited independently of
// the attachment's.
export function ensureTaperTipKeys(shape: LaneShape) {
  let changed = false;
  for (const span of shape.spans) for (const side of ['low', 'high'] as const) {
    const terminal = span[side];
    if (terminal.kind !== 'free') continue;
    if (shape.keys.some(key => close(key.distance, terminal.tip))) continue;
    shape.keys.push({ id: `${span.id}_${side}_tip`, distance: terminal.tip, width: 0, gap: valueAt(shape.keys, terminal.tip).gap });
    changed = true;
  }
  if (changed) shape.keys.sort((a, b) => a.distance - b.distance);
}

export function migrateRoadProfile(legacy: RoadProfilePoint[]): AuthoredRoadProfile {
  const points = [...legacy].sort((a, b) => a.distance - b.distance);
  const median = points.map(point => ({ id: point.id, distance: point.distance, width: point.medianWidth, endAnchor: point.endAnchor }));
  for (let index = median.length - 2; index > 0; index--) {
    const a = median[index - 1];
    const b = median[index + 1];
    const t = (median[index].distance - a.distance) / (b.distance - a.distance);
    if (!median[index].endAnchor && close(median[index].width, a.width + (b.width - a.width) * t)) median.splice(index, 1);
  }
  const convert = (dir: 'in' | 'out'): LaneShape[] => {
    const count = Math.max(0, ...points.map(point => (dir === 'in' ? point.lanesIn : point.lanesOut).length));
    return Array.from({ length: count }, (_, laneIndex) => {
      const lanes = points.map(point => (dir === 'in' ? point.lanesIn : point.lanesOut)[laneIndex] ?? { width: 0, gap: 0 });
      const spans: LaneSpan[] = [];
      for (let index = 0; index < points.length; index++) {
        if (!present(lanes[index])) continue;
        const first = index;
        while (index + 1 < points.length && present(lanes[index + 1])) index++;
        const last = index;
        spans.push({
          id: `${dir}_${laneIndex}_${points[first].id}`,
          low: first === 0 ? { kind: 'cap' } : { kind: 'free', tip: points[first - 1].distance, attach: points[first].distance },
          high: last === points.length - 1 ? { kind: 'cap' } : { kind: 'free', tip: points[last + 1].distance, attach: points[last].distance }
        });
      }
      const presentKeys: LaneShapeKey[] = points.flatMap((point, index) => present(lanes[index]) ? [{ id: `${dir}_${laneIndex}_${point.id}`, distance: point.distance, width: lanes[index].width, gap: lanes[index].gap }] : []);
      const keys: LaneShapeKey[] = points.map((point, index) => ({
        id: `${dir}_${laneIndex}_${point.id}`,
        distance: point.distance,
        width: present(lanes[index]) ? lanes[index].width : valueAt(presentKeys, point.distance).width,
        gap: lanes[index].gap
      }));
      for (let index = keys.length - 2; index > 0; index--) {
        const a = keys[index - 1];
        const b = keys[index + 1];
        const t = (keys[index].distance - a.distance) / (b.distance - a.distance);
        if (close(keys[index].width, a.width + (b.width - a.width) * t)
          && close(keys[index].gap, a.gap + (b.gap - a.gap) * t)) keys.splice(index, 1);
      }
      return { keys, spans };
    });
  };
  return { median, in: convert('in'), out: convert('out') };
}

export function deriveRoadProfile(profile: AuthoredRoadProfile): RoadProfilePoint[] {
  const distances = new Map<number, { id: string; endAnchor?: 'start' | 'end' }>();
  for (const key of profile.median) distances.set(key.distance, { id: key.id, endAnchor: key.endAnchor });
  for (const dir of ['in', 'out'] as const) for (const shape of profile[dir]) {
    for (const key of shape.keys) if (!distances.has(key.distance) && !insideLaneTaper(shape, key.distance)) distances.set(key.distance, { id: key.id });
    for (const span of shape.spans) for (const side of ['low', 'high'] as const) {
      const terminal = span[side];
      if (terminal.kind === 'cap') continue;
      if (!distances.has(terminal.tip)) distances.set(terminal.tip, { id: `${span.id}_${side}_tip` });
      if (!distances.has(terminal.attach)) distances.set(terminal.attach, { id: `${span.id}_${side}_attach` });
    }
  }
  const medianValue = (distance: number) => {
    const keys = profile.median;
    const upper = keys.findIndex(key => key.distance >= distance);
    if (upper <= 0) return (upper === 0 ? keys[0] : keys.at(-1)!).width;
    const a = keys[upper - 1];
    const b = keys[upper];
    return a.width + (b.width - a.width) * (distance - a.distance) / (b.distance - a.distance);
  };
  return [...distances].filter(([distance]) => distance >= cap(profile, 'low') && distance <= cap(profile, 'high'))
    .sort(([a], [b]) => a - b).map(([distance, meta]) => ({
    id: meta.id,
    distance,
    medianWidth: medianValue(distance),
    endAnchor: meta.endAnchor,
    lanesIn: profile.in.map(shape => ({ ...evaluateLane(profile, shape, distance), node: !meta.endAnchor && (shape.keys.some(key => close(key.distance, distance) && !insideLaneTaper(shape, key.distance)) || shape.spans.some(span => (['low', 'high'] as const).some(side => { const terminal = span[side]; return terminal.kind === 'free' && (close(terminal.attach, distance) || close(terminal.tip, distance)); }))) })),
    lanesOut: profile.out.map(shape => ({ ...evaluateLane(profile, shape, distance), node: !meta.endAnchor && (shape.keys.some(key => close(key.distance, distance) && !insideLaneTaper(shape, key.distance)) || shape.spans.some(span => (['low', 'high'] as const).some(side => { const terminal = span[side]; return terminal.kind === 'free' && (close(terminal.attach, distance) || close(terminal.tip, distance)); }))) }))
  }));
}

export function laneNodeId(arm: ArmConfig, point: RoadProfilePoint, dir: 'in' | 'out', laneIndex: number): string {
  const shape = arm.authoredProfile?.[dir][laneIndex];
  if (!shape) return point.id;
  const key = shape.keys.find(item => close(item.distance, point.distance));
  if (key) return key.id;
  if (point.endAnchor) return point.id;
  for (const span of shape.spans) for (const side of ['low', 'high'] as const) {
    const terminal = span[side];
    if (terminal.kind === 'free' && close(terminal.attach, point.distance)) return `${span.id}_${side}_attach`;
    if (terminal.kind === 'free' && close(terminal.tip, point.distance)) return `${span.id}_${side}_tip`;
  }
  return point.id;
}

export function findLanePoint(arm: ArmConfig, profile: RoadProfilePoint[], dir: 'in' | 'out', laneIndex: number, pointId: string): RoadProfilePoint | undefined {
  const shape = arm.authoredProfile?.[dir][laneIndex];
  const key = shape?.keys.find(candidate => candidate.id === pointId);
  if (key) return profile.find(point => close(point.distance, key.distance));
  for (const span of shape?.spans ?? []) for (const side of ['low', 'high'] as const) {
    const terminal = span[side];
    if (terminal.kind === 'free' && pointId === `${span.id}_${side}_attach`) return profile.find(point => close(point.distance, terminal.attach));
    if (terminal.kind === 'free' && pointId === `${span.id}_${side}_tip`) return profile.find(point => close(point.distance, terminal.tip));
  }
  return profile.find(point => point.id === pointId);
}

export function laneAttachmentIndex(profile: RoadProfilePoint[], shape: LaneShape | undefined, side: 'low' | 'high', tipDistance: number): number | null {
  const terminal = shape?.spans.map(span => span[side]).find(candidate =>
    candidate.kind === 'free' && close(candidate.tip, tipDistance));
  if (terminal?.kind !== 'free') return null;
  const index = profile.findIndex(point => close(point.distance, terminal.attach));
  return index >= 0 ? index : null;
}

// Moves the authored key pinned at a taper boundary to the boundary's new
// station, so a sideways-edited tip or attachment keeps its offset instead of
// leaving a stray bend behind. When the boundary merges into a cap, its
// authored values are written onto the existing cap key instead of stacking a
// second key at the same distance.
function relocateTerminalKey(shape: LaneShape, from: number, to: number, capLow: number, capHigh: number, endpoint?: number) {
  const index = shape.keys.findIndex(key => close(key.distance, from) && !close(key.distance, capLow) && !close(key.distance, capHigh));
  if (index < 0) return;
  const key = shape.keys[index];
  const capKey = endpoint !== undefined && shape.keys.find(candidate => candidate !== key && close(candidate.distance, endpoint));
  if (capKey) {
    capKey.width = key.width;
    capKey.gap = key.gap;
    shape.keys.splice(index, 1);
  } else key.distance = to;
  shape.keys.sort((a, b) => a.distance - b.distance);
}

export function moveLaneTerminal(profile: AuthoredRoadProfile, dir: 'in' | 'out', laneIndex: number, spanId: string, side: 'low' | 'high', distance: number, snapThreshold = 0): AuthoredRoadProfile {
  const next = structuredClone(profile);
  const shape = next[dir][laneIndex];
  const spanIndex = shape?.spans.findIndex(candidate => candidate.id === spanId) ?? -1;
  if (spanIndex < 0) return next;
  const span = shape.spans[spanIndex];
  const endpoint = cap(next, side);
  const adjacent = side === 'low' ? shape.spans[spanIndex - 1] : shape.spans[spanIndex + 1];
  const snap = !adjacent && (side === 'low' ? distance <= endpoint + snapThreshold : distance >= endpoint - snapThreshold);
  const old = span[side];
  if (snap) {
    if (old.kind === 'free') {
      relocateTerminalKey(shape, old.attach, endpoint, cap(next, 'low'), cap(next, 'high'), endpoint);
      // Snapping to the cap removes the tip — its authored offset goes with it
      // unless another taper boundary shares the station.
      const shared = shape.spans.some((candidate, index) => index !== spanIndex && (['low', 'high'] as const).some(other => {
        const terminal = candidate[other];
        return terminal.kind === 'free' && (close(terminal.tip, old.tip) || close(terminal.attach, old.tip));
      }));
      if (!shared) shape.keys = shape.keys.filter(key => !close(key.distance, old.tip));
    }
    span[side] = { kind: 'cap' };
    return next;
  }
  const opposite = span[side === 'low' ? 'high' : 'low'];
  const requestedTaper = old.kind === 'free' ? Math.abs(old.tip - old.attach) : DEFAULT_LANE_TAPER;
  // Shrink the taper to the room between the opposite terminal and the bound
  // on this side — a too-long default must not make the drag impossible.
  const room = (side === 'low'
    ? tip(opposite, cap(next, 'high')) - (adjacent ? tip(adjacent.high, cap(next, 'high')) : cap(next, 'low'))
    : (adjacent ? tip(adjacent.low, cap(next, 'low')) : cap(next, 'high')) - tip(opposite, cap(next, 'low'))) - 2;
  const taper = Math.max(1, Math.min(requestedTaper, room));
  const lower = side === 'low'
    ? (adjacent ? tip(adjacent.high, cap(next, 'high')) : cap(next, 'low')) + 1
    : tip(opposite, cap(next, 'low')) + taper + 1;
  const upper = side === 'high'
    ? (adjacent ? tip(adjacent.low, cap(next, 'low')) : cap(next, 'high')) - 1
    : tip(opposite, cap(next, 'high')) - taper - 1;
  if (lower > upper) return next;
  const position = Math.max(lower, Math.min(upper, distance));
  const attachment = side === 'low' ? position + taper : position - taper;
  if (old.kind === 'free') {
    relocateTerminalKey(shape, old.attach, attachment, cap(next, 'low'), cap(next, 'high'));
    relocateTerminalKey(shape, old.tip, position, cap(next, 'low'), cap(next, 'high'));
  }
  span[side] = { kind: 'free', tip: position, attach: attachment };
  ensureTaperTipKeys(shape);
  pruneTaperInteriorKeys(shape);
  return next;
}

export function moveLaneAttachment(profile: AuthoredRoadProfile, dir: 'in' | 'out', laneIndex: number, spanId: string, side: 'low' | 'high', distance: number): AuthoredRoadProfile {
  const next = structuredClone(profile);
  const shape = next[dir][laneIndex];
  const span = shape?.spans.find(candidate => candidate.id === spanId);
  const terminal = span?.[side];
  if (terminal?.kind !== 'free') return next;
  const other = span![side === 'low' ? 'high' : 'low'];
  const bound = tip(other, cap(next, side === 'low' ? 'high' : 'low'));
  const previous = terminal.attach;
  terminal.attach = side === 'low'
    ? Math.max(terminal.tip + 1, Math.min(bound - 1, distance))
    : Math.min(terminal.tip - 1, Math.max(bound + 1, distance));
  relocateTerminalKey(shape, previous, terminal.attach, cap(next, 'low'), cap(next, 'high'));
  pruneTaperInteriorKeys(shape);
  return next;
}
