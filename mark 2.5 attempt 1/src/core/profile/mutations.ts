import { type RoundaboutConfig, type SelectionTarget } from '../../config/types';
import { estimateArmLength, getRoadProfile, insertProfilePoint, interpolateProfile, isProfileLanePresent, laneBounds, profileLaneTransitions } from './model';
import { DEFAULT_LANE_TAPER, ensureTaperTipKeys, evaluateLane, findLanePoint, insideLaneTaper, moveLaneAttachment, moveLaneTerminal, profileCap } from './authored';

export function setProfileControl(
  original: RoundaboutConfig,
  armId: string,
  pointId: string,
  dir: 'in' | 'out',
  kind: 'median' | 'gap' | 'width',
  value: number,
  laneIndex = 0,
  isolate = false
): RoundaboutConfig {
  const next = structuredClone(original);
  const arm = next.arms.find(candidate => candidate.id === armId);
  if (!arm) return next;
  if (arm.authoredProfile && kind === 'median') {
    const key = arm.authoredProfile.median.find(candidate => candidate.id === pointId);
    if (key) key.width = Math.max(0, value);
    return next;
  }
  if (arm.authoredProfile && kind !== 'median') {
    const shape = arm.authoredProfile[dir][laneIndex];
    const point = findLanePoint(arm, getRoadProfile(arm, estimateArmLength(arm)), dir, laneIndex, pointId);
    if (!shape || !point) return next;
    // The node's key is the one pinned at its station — pointId can name a
    // different station (or another lane's primitive, since an inherited bend
    // borrows that terminal's id), so resolve by distance. A materialized key
    // gets a lane-scoped id: reusing the borrowed pointId would stamp the same
    // id into two lanes' keys and make their nodes select and edit as one.
    let key = shape.keys.find(candidate => Math.abs(candidate.distance - point.distance) < 1e-6);
    if (!key) {
      const current = evaluateLane(arm.authoredProfile, shape, point.distance);
      if (Math.abs(current[kind] - value) < 1e-6) return next;
      key = { id: `${pointId}_${dir}${laneIndex}`, distance: point.distance, width: current.width, gap: current.gap };
      shape.keys.push(key);
      shape.keys.sort((a, b) => a.distance - b.distance);
    }
    const previous = key[kind];
    if (isolate) key[kind] = Math.max(0, value);
    else {
      const profile = getRoadProfile(arm, estimateArmLength(arm));
      const offsetAt = (distance: number) => {
        const section = interpolateProfile(profile, distance);
        return laneBounds(section, dir, laneIndex).inner - section.medianWidth / 2;
      };
      const originalOffset = kind === 'gap' ? offsetAt(key.distance) : 0;
      const index = shape.keys.indexOf(key);
      const step = dir === 'out' ? 1 : -1;
      for (let cursor = index; cursor >= 0 && cursor < shape.keys.length; cursor += step) {
        const candidate = shape.keys[cursor];
        if (cursor !== index && (kind === 'gap' ? Math.abs(offsetAt(candidate.distance) - originalOffset) > .01 : Math.abs(candidate.width - previous) > .01)) break;
        candidate[kind] = Math.max(0, candidate[kind] + value - previous);
      }
    }
    return next;
  }
  const totalLength = estimateArmLength(arm);
  arm.profile = getRoadProfile(arm, totalLength);
  const pointIndex = arm.profile.findIndex(point => point.id === pointId);
  if (pointIndex < 0) return next;
  const step = dir === 'out' ? 1 : -1;
  if (kind === 'median') {
    const downstreamIndex = pointIndex + step;
    for (const index of [pointIndex, downstreamIndex]) {
      const point = arm.profile[index];
      if (point) point.medianWidth = Math.max(0, value);
    }
    return next;
  }
  const selectedPoint = arm.profile[pointIndex];
  const selectedLane = (dir === 'in' ? selectedPoint.lanesIn : selectedPoint.lanesOut)[laneIndex];
  if (!selectedLane) return next;
  selectedLane.node = true;
  const laneAt = (point: typeof selectedPoint) => (dir === 'in' ? point.lanesIn : point.lanesOut)[laneIndex];
  const indices: number[] = [pointIndex];
  if (kind === 'width') {
    const originalWidth = selectedLane.width;
    let cursor = pointIndex + step;
    while (!isolate && cursor >= 0 && cursor < arm.profile.length) {
      const lane = laneAt(arm.profile[cursor]);
      if (!lane || !isProfileLanePresent(lane) || Math.abs(lane.width - originalWidth) > .01) break;
      indices.push(cursor);
      cursor += step;
    }
    for (const index of indices) {
      const lane = laneAt(arm.profile[index]);
      if (lane) lane.width = Math.max(0, value);
    }
    return next;
  }
  const selectedOriginalOffset = laneBounds(selectedPoint, dir, laneIndex).inner - selectedPoint.medianWidth / 2;
  const delta = value - selectedLane.gap;
  let cursor = pointIndex + step;
  while (!isolate && cursor >= 0 && cursor < arm.profile.length) {
    const point = arm.profile[cursor];
    const lane = laneAt(point);
    if (!lane || !isProfileLanePresent(lane)) break;
    const offset = laneBounds(point, dir, laneIndex).inner - point.medianWidth / 2;
    if (Math.abs(offset - selectedOriginalOffset) > .01) break;
    indices.push(cursor);
    cursor += step;
  }
  for (const index of indices) {
    const lane = laneAt(arm.profile[index]);
    if (lane) lane.gap = Math.max(0, lane.gap + delta);
  }
  return next;
}

export function adjustProfileControls(
  original: RoundaboutConfig,
  targets: Extract<SelectionTarget, { kind: 'profile-control' }>[],
  delta: number,
  isolate = false
): RoundaboutConfig {
  let next = original;
  const isolateTargets = isolate || targets.length > 1;
  for (const target of targets) {
    const arm = original.arms.find(candidate => candidate.id === target.armId);
    const point = arm && findLanePoint(arm, getRoadProfile(arm, estimateArmLength(arm)), target.dir, target.laneIndex, target.pointId);
    const lane = point && (target.dir === 'in' ? point.lanesIn : point.lanesOut)[target.laneIndex];
    if (!lane) continue;
    next = setProfileControl(next, target.armId, target.pointId, target.dir, target.control, Math.max(0, lane[target.control] + delta), target.laneIndex, isolateTargets);
  }
  return next;
}

export function moveProfilePoint(original: RoundaboutConfig, armId: string, pointId: string, distance: number): RoundaboutConfig {
  const next = structuredClone(original);
  const arm = next.arms.find(candidate => candidate.id === armId);
  if (!arm) return next;
  if (arm.authoredProfile) {
    const keys = arm.authoredProfile.median;
    const index = keys.findIndex(key => key.id === pointId);
    if (index <= 0 || index >= keys.length - 1 || keys[index].endAnchor) return next;
    keys[index].distance = Math.max(keys[index - 1].distance + 1, Math.min(keys[index + 1].distance - 1, distance));
    return next;
  }
  const totalLength = estimateArmLength(arm);
  arm.profile = getRoadProfile(arm, totalLength);
  const point = arm.profile.find(candidate => candidate.id === pointId);
  if (!point) return next;
  const sorted = [...arm.profile].sort((a, b) => a.distance - b.distance);
  const index = sorted.findIndex(candidate => candidate.id === pointId);
  const lower = index > 0 ? sorted[index - 1].distance + 1 : 0;
  const upper = index < sorted.length - 1 ? sorted[index + 1].distance - 1 : totalLength;
  point.distance = Math.max(lower, Math.min(upper, distance));
  arm.profile.sort((a, b) => a.distance - b.distance);
  return next;
}

export function moveProfilePoints(original: RoundaboutConfig, targets: { armId: string; pointId: string }[], delta: number): RoundaboutConfig {
  let next = original;
  const sourceDistances = new Map<string, number>();
  for (const target of targets) {
    const arm = original.arms.find(candidate => candidate.id === target.armId);
    const point = arm && getRoadProfile(arm, estimateArmLength(arm)).find(candidate => candidate.id === target.pointId);
    if (point) sourceDistances.set(`${target.armId}:${target.pointId}`, point.distance);
  }
  const ordered = [...targets].sort((a, b) => {
    const aDistance = sourceDistances.get(`${a.armId}:${a.pointId}`) ?? 0;
    const bDistance = sourceDistances.get(`${b.armId}:${b.pointId}`) ?? 0;
    return delta >= 0 ? bDistance - aDistance : aDistance - bDistance;
  });
  for (const target of ordered) {
    const distance = sourceDistances.get(`${target.armId}:${target.pointId}`);
    if (distance !== undefined) next = moveProfilePoint(next, target.armId, target.pointId, distance + delta);
  }
  return next;
}

export function moveProfileLanePoint(original: RoundaboutConfig, armId: string, pointId: string, dir: 'in' | 'out', laneIndex: number, distance: number): RoundaboutConfig {
  const next = structuredClone(original);
  const arm = next.arms.find(candidate => candidate.id === armId);
  if (!arm) return next;
  if (arm.authoredProfile) {
    const document = arm.authoredProfile;
    const shape = document[dir][laneIndex];
    const point = findLanePoint(arm, getRoadProfile(arm, estimateArmLength(arm)), dir, laneIndex, pointId);
    if (!shape || !point) return next;
    for (const span of shape.spans) for (const side of ['low', 'high'] as const) {
      if (span[side].kind === 'free' && Math.abs(span[side].attach - point.distance) < 1e-6) {
        arm.authoredProfile = moveLaneAttachment(document, dir, laneIndex, span.id, side, distance);
        return next;
      }
      // A node on a taper tip is the terminal itself — sliding it along the
      // road moves the tip and its attachment together, preserving the taper.
      if (span[side].kind === 'free' && Math.abs(span[side].tip - point.distance) < 1e-6) {
        arm.authoredProfile = moveLaneTerminal(document, dir, laneIndex, span.id, side, distance);
        return next;
      }
    }
    const key = shape.keys.find(candidate => Math.abs(candidate.distance - point.distance) < 1e-6);
    if (!key || document.median.some(candidate => candidate.endAnchor && Math.abs(candidate.distance - key.distance) < 1e-6)) return next;
    const ordered = [...shape.keys].sort((a, b) => a.distance - b.distance);
    const index = ordered.findIndex(candidate => candidate.id === key.id);
    const lower = (ordered[index - 1]?.distance ?? profileCap(document, 'low')) + 1;
    const upper = (ordered[index + 1]?.distance ?? profileCap(document, 'high')) - 1;
    key.distance = Math.max(lower, Math.min(upper, distance));
    // A key can't live inside a taper — push it out to the nearest band edge.
    for (const span of shape.spans) for (const side of ['low', 'high'] as const) {
      const terminal = span[side];
      if (terminal.kind !== 'free') continue;
      const lo = Math.min(terminal.tip, terminal.attach);
      const hi = Math.max(terminal.tip, terminal.attach);
      if (key.distance > lo && key.distance < hi) key.distance = key.distance - lo <= hi - key.distance ? lo : hi;
    }
    shape.keys.sort((a, b) => a.distance - b.distance);
    return next;
  }
  const totalLength = estimateArmLength(arm);
  const profile = getRoadProfile(arm, totalLength);
  const sourceIndex = profile.findIndex(point => point.id === pointId);
  const source = profile[sourceIndex];
  if (!source || source.endAnchor) return next;
  const selectedLane = structuredClone((dir === 'in' ? source.lanesIn : source.lanesOut)[laneIndex]);
  if (!selectedLane) return next;
  const laneNodeAt = (point: typeof source) => (dir === 'in' ? point.lanesIn : point.lanesOut)[laneIndex]?.node === true;
  const previousNode = profile.slice(0, sourceIndex).reverse().find(laneNodeAt);
  const nextNode = profile.slice(sourceIndex + 1).find(laneNodeAt);
  const startAnchor = profile.find(point => point.endAnchor === 'start')?.distance ?? 0;
  const endAnchor = profile.find(point => point.endAnchor === 'end')?.distance ?? totalLength;
  const lower = (previousNode?.distance ?? startAnchor) + 1;
  const upper = (nextNode?.distance ?? endAnchor) - 1;
  const targetDistance = Math.max(lower, Math.min(upper, distance));
  if (Math.abs(targetDistance - source.distance) < 1e-6) return next;

  const withoutSource = profile.filter(point => point.id !== pointId);
  const atTarget = interpolateProfile(withoutSource, targetDistance);
  const hasOtherOwner = [...source.lanesIn, ...source.lanesOut].some((lane, index) => {
    const selectedOffset = dir === 'in' ? laneIndex : source.lanesIn.length + laneIndex;
    return index !== selectedOffset && lane.node === true;
  });
  const stationary = hasOtherOwner ? structuredClone(source) : null;
  if (stationary) {
    stationary.id = `${source.id}_station_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`;
    delete stationary.endAnchor;
    const upstream = profile[dir === 'out' ? sourceIndex - 1 : sourceIndex + 1];
    const upstreamLane = upstream && (dir === 'in' ? upstream.lanesIn : upstream.lanesOut)[laneIndex];
    const stationaryLane = (dir === 'in' ? stationary.lanesIn : stationary.lanesOut)[laneIndex];
    if (stationaryLane) Object.assign(stationaryLane, structuredClone(upstreamLane ?? selectedLane), { node: false });
  }

  source.distance = targetDistance;
  source.medianWidth = atTarget.medianWidth;
  source.lanesIn = atTarget.lanesIn.map(lane => ({ ...lane, node: false }));
  source.lanesOut = atTarget.lanesOut.map(lane => ({ ...lane, node: false }));
  const movingLanes = dir === 'in' ? source.lanesIn : source.lanesOut;
  while (movingLanes.length <= laneIndex) movingLanes.push({ width: 0, gap: 0, node: false });
  movingLanes[laneIndex] = { ...selectedLane, node: true };
  arm.profile = [...withoutSource, ...(stationary ? [stationary] : []), source].sort((a, b) => a.distance - b.distance);
  return next;
}

export function moveProfileLanePoints(original: RoundaboutConfig, targets: { armId: string; pointId: string; dir: 'in' | 'out'; laneIndex: number }[], delta: number): RoundaboutConfig {
  let next = original;
  const sources = targets.map(target => {
    const arm = original.arms.find(candidate => candidate.id === target.armId);
    const point = arm && findLanePoint(arm, getRoadProfile(arm, estimateArmLength(arm)), target.dir, target.laneIndex, target.pointId);
    return { target, distance: point?.distance };
  }).filter((entry): entry is { target: (typeof targets)[number]; distance: number } => entry.distance !== undefined);
  sources.sort((a, b) => delta >= 0 ? b.distance - a.distance : a.distance - b.distance);
  for (const { target, distance } of sources) next = moveProfileLanePoint(next, target.armId, target.pointId, target.dir, target.laneIndex, distance + delta);
  return next;
}

// A rendered lane node that isn't an authored key — a bend inherited from a
// neighboring lane's taper, or a cap-end with no key — rides the key
// interpolation, so it slides whenever a drag edits a key on either side of
// it. Pinning materializes a key holding the currently evaluated values at
// its distance, so dragging one node leaves the lane's other nodes exactly
// where they were.
export function pinProfileLaneNodes(
  original: RoundaboutConfig,
  anchors: { armId: string; dir: 'in' | 'out'; laneIndex: number; pointId: string; distance: number }[]
): RoundaboutConfig {
  if (!anchors.length) return original;
  const next = structuredClone(original);
  for (const anchor of anchors) {
    const arm = next.arms.find(candidate => candidate.id === anchor.armId);
    const shape = arm?.authoredProfile?.[anchor.dir][anchor.laneIndex];
    if (!arm?.authoredProfile || !shape) continue;
    if (shape.keys.some(key => Math.abs(key.distance - anchor.distance) < 1e-6)) continue;
    if (insideLaneTaper(shape, anchor.distance)) continue;
    const value = evaluateLane(arm.authoredProfile, shape, anchor.distance);
    if (!isProfileLanePresent(value)) continue;
    // The pinned node borrows the shared cross-section's point id — which may
    // name another lane's taper terminal. Stamping it verbatim would give two
    // lanes a key with the same id; the lane-scoped suffix keeps it unique.
    const id = `${anchor.pointId}_${anchor.dir}${anchor.laneIndex}`;
    shape.keys.push({
      id: shape.keys.some(key => key.id === id)
        ? `${anchor.armId}_lane_${anchor.dir}_${anchor.laneIndex}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`
        : id,
      distance: anchor.distance,
      width: value.width,
      gap: value.gap
    });
    shape.keys.sort((a, b) => a.distance - b.distance);
  }
  return next;
}

export function addProfilePoint(original: RoundaboutConfig, armId: string, distance: number, dir?: 'in' | 'out', laneIndex?: number): { config: RoundaboutConfig; pointId: string | null } {
  const next = structuredClone(original);
  const arm = next.arms.find(candidate => candidate.id === armId);
  if (!arm) return { config: next, pointId: null };
  if (arm.authoredProfile && dir && laneIndex !== undefined) {
    const document = arm.authoredProfile;
    const shape = document[dir][laneIndex];
    const low = profileCap(document, 'low') + 1;
    const high = profileCap(document, 'high') - 1;
    if (!shape || distance < low || distance > high || insideLaneTaper(shape, distance) || shape.keys.some(key => Math.abs(key.distance - distance) < 1)) return { config: original, pointId: null };
    const lane = evaluateLane(document, shape, distance);
    if (!isProfileLanePresent(lane)) return { config: original, pointId: null };
    const pointId = `${armId}_lane_${dir}_${laneIndex}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    shape.keys.push({ id: pointId, distance, width: lane.width, gap: lane.gap });
    shape.keys.sort((a, b) => a.distance - b.distance);
    return { config: next, pointId };
  }
  const totalLength = estimateArmLength(arm);
  const profile = getRoadProfile(arm, totalLength);
  // Cross-sections only live inside the "propper road" between the two ending
  // cross-sections; clicks beyond them add nothing.
  const startCap = profile.find(p => p.endAnchor === 'start') ?? profile[0];
  const endCap = profile.find(p => p.endAnchor === 'end') ?? profile[profile.length - 1];
  const lower = (startCap?.distance ?? 0) + 1;
  const upper = (endCap?.distance ?? totalLength) - 1;
  if (distance < lower || distance > upper) return { config: original, pointId: null };
  arm.profile = insertProfilePoint(arm, distance, totalLength);
  const point = arm.profile.reduce((best, candidate) => Math.abs(candidate.distance - distance) < Math.abs(best.distance - distance) ? candidate : best);
  if (dir && laneIndex !== undefined) {
    const lane = (dir === 'in' ? point.lanesIn : point.lanesOut)[laneIndex];
    if (lane) Object.assign(lane, { node: true, fresh: true });
  }
  return { config: next, pointId: point.id };
}

export function removeProfileLanePoint(original: RoundaboutConfig, armId: string, pointId: string, dir: 'in' | 'out', laneIndex: number): RoundaboutConfig {
  const next = structuredClone(original);
  const arm = next.arms.find(candidate => candidate.id === armId);
  if (!arm) return next;
  if (arm.authoredProfile) {
    const shape = arm.authoredProfile[dir][laneIndex];
    const point = shape && findLanePoint(arm, getRoadProfile(arm, estimateArmLength(arm)), dir, laneIndex, pointId);
    const index = shape && point ? shape.keys.findIndex(key => Math.abs(key.distance - point.distance) < 1e-6) : -1;
    if (shape && index >= 0 && !arm.authoredProfile.median.some(candidate => candidate.endAnchor && Math.abs(candidate.distance - shape.keys[index].distance) < 1e-6)) shape.keys.splice(index, 1);
    return next;
  }
  arm.profile = getRoadProfile(arm, estimateArmLength(arm));
  const pointIndex = arm.profile.findIndex(point => point.id === pointId);
  const point = arm.profile[pointIndex];
  if (!point || point.endAnchor) return next;
  const lane = (dir === 'in' ? point.lanesIn : point.lanesOut)[laneIndex];
  if (!lane) return next;
  const upstream = arm.profile[dir === 'out' ? pointIndex - 1 : pointIndex + 1];
  const replacement = upstream && (dir === 'in' ? upstream.lanesIn : upstream.lanesOut)[laneIndex];
  Object.assign(lane, structuredClone(replacement ?? lane), { node: false });
  return next;
}

export function removeProfilePoint(original: RoundaboutConfig, armId: string, pointId: string): RoundaboutConfig {
  const next = structuredClone(original);
  const arm = next.arms.find(candidate => candidate.id === armId);
  if (!arm) return next;
  if (arm.authoredProfile) {
    const keys = arm.authoredProfile.median;
    const index = keys.findIndex(key => key.id === pointId);
    if (index > 0 && index < keys.length - 1 && !keys[index].endAnchor) keys.splice(index, 1);
    return next;
  }
  const profile = getRoadProfile(arm, estimateArmLength(arm));
  const target = profile.find(point => point.id === pointId);
  if (!target || target.endAnchor) return next;
  if (profile.length <= 2) return next;
  arm.profile = profile.filter(point => point.id !== pointId);
  return next;
}

export function moveProfileLaneTransition(
  original: RoundaboutConfig,
  armId: string,
  dir: 'in' | 'out',
  laneIndex: number,
  boundaryIndex: number,
  targetBoundaryIndex: number
): RoundaboutConfig {
  const next = structuredClone(original);
  const arm = next.arms.find(candidate => candidate.id === armId);
  if (!arm) return next;
  const profile = arm.profile = getRoadProfile(arm, estimateArmLength(arm));
  // Boundaries run from -1 (the start cap-end) to length - 1 (the end cap-end)
  // so lane starts and ends can sit on either end of the road.
  const source = Math.max(-1, Math.min(profile.length - 1, boundaryIndex));
  const target = Math.max(-1, Math.min(profile.length - 1, targetBoundaryIndex));
  if (source === target) return next;
  const laneAt = (index: number) => index >= 0 && index < profile.length
    ? (dir === 'in' ? profile[index].lanesIn : profile[index].lanesOut)[laneIndex]
    : undefined;
  if (isProfileLanePresent(laneAt(source)) === isProfileLanePresent(laneAt(source + 1))) return next;
  const template = { ...structuredClone(laneAt(target > source ? source : source + 1) ?? { width: 0, gap: 0 }), node: false };
  delete template.fresh;
  const first = Math.min(source, target) + 1;
  const last = Math.max(source, target);
  for (let index = first; index <= last; index++) {
    const lanes = dir === 'in' ? arm.profile[index].lanesIn : arm.profile[index].lanesOut;
    while (lanes.length <= laneIndex) lanes.push({ width: 0, gap: 0 });
    lanes[laneIndex] = structuredClone(template);
  }
  return next;
}

// A lane terminal (the START/END marker) lives on the "tip" cross-section —
// the section where the lane is absent and its taper physically ends. The
// section on the other side of the boundary, where the lane is still present,
// is the linked lane node; the gap between them is the taper length. Dragging
// the terminal slides tip and linked node together, hopping across other
// cross-sections as it goes; pushing it past the road's cap-end snaps the lane
// to that terminus instead.
export function moveProfileLaneTerminal(
  original: RoundaboutConfig,
  armId: string,
  dir: 'in' | 'out',
  laneIndex: number,
  boundaryIndex: number,
  targetDistance: number,
  snapThreshold = 0
): RoundaboutConfig {
  const sourceArm = original.arms.find(candidate => candidate.id === armId);
  if (!sourceArm) return original;
  if (sourceArm.authoredProfile) {
    const profile = getRoadProfile(sourceArm, estimateArmLength(sourceArm));
    const transition = profileLaneTransitions(profile, dir).filter(item => item.laneIndex === laneIndex)
      .find(item => item.boundaryIndex === boundaryIndex);
    if (!transition) return original;
    const side = transition.fromPresent ? 'high' : 'low';
    const shape = sourceArm.authoredProfile[dir][laneIndex];
    const span = shape?.spans.find(run => {
      const terminal = run[side];
      const position = terminal.kind === 'cap'
        ? profileCap(sourceArm.authoredProfile!, side)
        : terminal.tip;
      const boundaryDistance = transition.boundaryIndex < 0 ? profile[0].distance
        : transition.boundaryIndex >= profile.length - 1 ? profile.at(-1)!.distance
          : profile[transition.fromPresent ? transition.boundaryIndex + 1 : transition.boundaryIndex].distance;
      return Math.abs(position - boundaryDistance) < 1e-6;
    });
    if (!span) return original;
    const next = structuredClone(original);
    const arm = next.arms.find(candidate => candidate.id === armId)!;
    arm.authoredProfile = moveLaneTerminal(arm.authoredProfile!, dir, laneIndex, span.id, side, targetDistance, snapThreshold);
    return next;
  }
  const profile = getRoadProfile(sourceArm, estimateArmLength(sourceArm));
  const n = profile.length;
  if (n < 2) return original;
  const laneAt = (index: number) => index >= 0 && index < n
    ? (dir === 'in' ? profile[index].lanesIn : profile[index].lanesOut)[laneIndex]
    : undefined;
  const present = (index: number) => isProfileLanePresent(laneAt(index));
  const distance = (index: number) => profile[Math.max(0, Math.min(n - 1, index))].distance;

  if (boundaryIndex > -1 && boundaryIndex < n - 1 && present(boundaryIndex) === present(boundaryIndex + 1)) return original;

  // The tip sits on the absent side of the boundary: high when the lane goes
  // present → absent with distance, low when it goes absent → present.
  const tipSide: 'low' | 'high' = boundaryIndex <= -1 ? 'low'
    : boundaryIndex >= n - 1 ? 'high'
    : present(boundaryIndex) ? 'high' : 'low';

  // Sibling transitions of the same lane constrain the slide — a terminal may
  // not cross them. Only the outermost transition on each side can snap to
  // that cap.
  const boundaries = profileLaneTransitions(profile, dir)
    .filter(transition => transition.laneIndex === laneIndex)
    .map(transition => transition.boundaryIndex)
    .sort((a, b) => a - b);
  const selfIndex = boundaries.indexOf(boundaryIndex);
  const lowerBound = selfIndex > 0 ? boundaries[selfIndex - 1] : -1;
  const upperBound = selfIndex >= 0 && selfIndex < boundaries.length - 1 ? boundaries[selfIndex + 1] : n - 1;

  const capLow = distance(0);
  const capHigh = distance(n - 1);
  if (tipSide === 'high' && selfIndex === boundaries.length - 1 && targetDistance >= capHigh - snapThreshold) {
    return boundaryIndex === n - 1 ? original : moveProfileLaneTransition(original, armId, dir, laneIndex, boundaryIndex, n - 1);
  }
  if (tipSide === 'low' && selfIndex === 0 && targetDistance <= capLow + snapThreshold) {
    return boundaryIndex === -1 ? original : moveProfileLaneTransition(original, armId, dir, laneIndex, boundaryIndex, -1);
  }

  if (boundaryIndex <= -1 || boundaryIndex >= n - 1) {
    const next = structuredClone(original);
    const arm = next.arms.find(candidate => candidate.id === armId);
    if (!arm) return original;
    arm.profile = getRoadProfile(arm, estimateArmLength(arm));
    const sourceLane = structuredClone(laneAt(boundaryIndex <= -1 ? 0 : n - 1));
    if (!sourceLane) return original;
    const tipDistance = tipSide === 'high'
      ? Math.max(capLow + 2, Math.min(capHigh - 1, targetDistance))
      : Math.max(capLow + 1, Math.min(capHigh - 2, targetDistance));
    // The wedge is the gap between the tip and the nearest section on its
    // inward side — planting the attachment beyond it would leave a floating
    // node mid-lane while the real taper collapsed to that section.
    const nearestInward = tipSide === 'high'
      ? [...profile].reverse().find(point => point.distance < tipDistance)?.distance ?? capLow
      : profile.find(point => point.distance > tipDistance)?.distance ?? capHigh;
    const attachmentDistance = tipSide === 'high'
      ? Math.min(tipDistance - 1, Math.max(capLow + 1, nearestInward + 1, tipDistance - DEFAULT_LANE_TAPER))
      : Math.max(tipDistance + 1, Math.min(capHigh - 1, nearestInward - 1, tipDistance + DEFAULT_LANE_TAPER));
    const makePoint = (distanceValue: number, laneValue: typeof sourceLane, node: boolean) => {
      const section = interpolateProfile(profile, distanceValue);
      const point = {
        id: `${arm.id}_profile_terminal_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
        distance: distanceValue,
        medianWidth: section.medianWidth,
        lanesIn: section.lanesIn.map(lane => ({ ...lane, node: false })),
        lanesOut: section.lanesOut.map(lane => ({ ...lane, node: false }))
      };
      const lanes = dir === 'in' ? point.lanesIn : point.lanesOut;
      while (lanes.length <= laneIndex) lanes.push({ width: 0, gap: 0, node: false });
      lanes[laneIndex] = { ...laneValue, node };
      return point;
    };
    for (const point of arm.profile) {
      const lane = (dir === 'in' ? point.lanesIn : point.lanesOut)[laneIndex];
      if (!lane) continue;
      const absent = tipSide === 'high' ? point.distance >= tipDistance : point.distance <= tipDistance;
      if (absent) Object.assign(lane, { width: 0, node: false });
    }
    arm.profile.push(
      makePoint(attachmentDistance, sourceLane, true),
      makePoint(tipDistance, { ...sourceLane, width: 0 }, false)
    );
    arm.profile.sort((a, b) => a.distance - b.distance);
    return next;
  }

  // The tip lands on the first section strictly beyond the target distance.
  let tipIndex: number;
  if (tipSide === 'high') {
    tipIndex = profile.findIndex(point => point.distance > targetDistance);
    if (tipIndex < 0) tipIndex = n - 1;
    tipIndex = Math.max(lowerBound + 2, Math.min(Math.min(upperBound, n - 1), tipIndex));
  } else {
    tipIndex = -1;
    for (let index = n - 1; index >= 0; index--) {
      if (profile[index].distance < targetDistance) { tipIndex = index; break; }
    }
    if (tipIndex < 0) tipIndex = 0;
    tipIndex = Math.min(upperBound - 1, Math.max(Math.max(lowerBound + 1, 0), tipIndex));
  }
  // Anchored cap sections can't move — an unsnapped tip steps one section
  // inward so the marker can still follow the cursor.
  while (tipSide === 'high' && tipIndex > lowerBound + 2 && profile[tipIndex]?.endAnchor) tipIndex--;
  while (tipSide === 'low' && tipIndex < upperBound - 1 && profile[tipIndex]?.endAnchor) tipIndex++;
  const newBoundary = tipSide === 'high' ? tipIndex - 1 : tipIndex;

  // Preserve the free pair's existing taper while moving it.
  const taper = distance(boundaryIndex + 1) - distance(boundaryIndex);

  let next = original;
  if (newBoundary !== boundaryIndex) {
    next = moveProfileLaneTransition(next, armId, dir, laneIndex, boundaryIndex, newBoundary);
  }

  const moved = structuredClone(next);
  const arm = moved.arms.find(candidate => candidate.id === armId);
  if (!arm) return next;
  arm.profile = getRoadProfile(arm, estimateArmLength(arm));
  const clampDistance = (index: number, value: number) => {
    const lo = index > 0 ? arm.profile![index - 1].distance + 1 : 0;
    const hi = index < arm.profile!.length - 1 ? arm.profile![index + 1].distance - 1 : estimateArmLength(arm);
    return Math.max(lo, Math.min(hi, value));
  };
  const setDistance = (index: number, value: number) => {
    const point = arm.profile![index];
    if (!point || point.endAnchor) return;
    point.distance = clampDistance(index, value);
  };
  // Move the tip first so the linked node's clamp sees the final tip distance.
  const tipDistance = clampDistance(tipIndex, targetDistance);
  setDistance(tipIndex, tipDistance);
  const linkedIndex = tipSide === 'high' ? tipIndex - 1 : tipIndex + 1;
  setDistance(linkedIndex, tipSide === 'high' ? tipDistance - taper : tipDistance + taper);
  arm.profile.sort((a, b) => a.distance - b.distance);
  return moved;
}

export function addProfileLane(original: RoundaboutConfig, armId: string, pointId: string, dir: 'in' | 'out', insertIndex: number): RoundaboutConfig {
  const next = structuredClone(original);
  const arm = next.arms.find(candidate => candidate.id === armId);
  if (!arm) return next;
  const totalLength = estimateArmLength(arm);
  const profile = getRoadProfile(arm, totalLength);
  if (!arm.authoredProfile) arm.profile = profile;
  const startIndex = profile.findIndex(point => point.id === pointId);
  const start = profile[startIndex];
  if (!start) return next;
  // A lane added on a cap-end behaves as if added from the beginning of the
  // road: it spans every cross-section instead of stopping at the cap-end.
  const atCapEnd = startIndex === 0 || startIndex === profile.length - 1;
  const topology = dir === 'in' ? arm.lanesIn : arm.lanesOut;
  const index = Math.max(0, Math.min(topology.length, insertIndex));
  if (dir === 'in') {
    const template = arm.lanesIn[Math.min(index, arm.lanesIn.length - 1)];
    arm.lanesIn.splice(index, 0, { sourceRing: template?.sourceRing, targetsRing: template?.targetsRing, filletRadius: template?.filletRadius ?? 40, sourceFilletRadius: template?.sourceFilletRadius, targetFilletRadius: template?.targetFilletRadius, dropsRing: false });
  } else {
    const template = arm.lanesOut[Math.min(index, arm.lanesOut.length - 1)];
    arm.lanesOut.splice(index, 0, { sourceRing: template?.sourceRing, targetsRing: template?.targetsRing, filletRadius: template?.filletRadius ?? 40, sourceFilletRadius: template?.sourceFilletRadius, targetFilletRadius: template?.targetFilletRadius, dropsRing: false });
  }
  if (arm.authoredProfile) {
    const document = arm.authoredProfile;
    const low = profileCap(document, 'low');
    const high = profileCap(document, 'high');
    const free = !atCapEnd && start.distance > low + DEFAULT_LANE_TAPER + 1 && start.distance < high - DEFAULT_LANE_TAPER - 1;
    const id = `${arm.id}_${dir}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    const width = 10;
    const shape = {
      keys: [{ id: `${id}_start`, distance: low, width, gap: 0 }, { id: `${id}_end`, distance: high, width, gap: 0 }],
      spans: [{ id: `${id}_span`, low: free && dir === 'out' ? { kind: 'free' as const, tip: start.distance - DEFAULT_LANE_TAPER, attach: start.distance } : { kind: 'cap' as const }, high: free && dir === 'in' ? { kind: 'free' as const, tip: start.distance + DEFAULT_LANE_TAPER, attach: start.distance } : { kind: 'cap' as const } }]
    };
    ensureTaperTipKeys(shape);
    for (const span of shape.spans) for (const side of ['low', 'high'] as const) {
      const terminal = span[side];
      if (terminal.kind !== 'free') continue;
      if (!shape.keys.some(key => Math.abs(key.distance - terminal.attach) < 1e-6)) shape.keys.push({ id: `${span.id}_${side}_attach`, distance: terminal.attach, width, gap: 0 });
    }
    shape.keys.sort((a, b) => a.distance - b.distance);
    // A lane inserted inside an existing lane consumes the displaced lane's
    // offset strip first — its width is subtracted from the gap — so where it
    // fits nothing else moves; whatever doesn't fit pushes the displaced lane
    // outward while the two stay adjacent.
    const displaced = document[dir][index];
    for (const key of shape.keys) {
      const offset = displaced ? evaluateLane(document, displaced, key.distance).gap : 0;
      key.gap = Math.max(0, offset - evaluateLane(document, shape, key.distance).width);
    }
    document[dir].splice(index, 0, shape);
    if (displaced) for (const key of displaced.keys) key.gap = 0;
  } else for (const point of arm.profile!) {
    const lanes = dir === 'in' ? point.lanesIn : point.lanesOut;
    const displaced = lanes[index];
    const downstream = atCapEnd || (dir === 'in' ? point.distance <= start.distance : point.distance >= start.distance);
    const width = downstream ? 10 : 0;
    lanes.splice(index, 0, { width, gap: Math.max(0, (displaced?.gap ?? 0) - width) });
    if (displaced) displaced.gap = 0;
  }
  for (const node of arm.nodes) (dir === 'in' ? node.laneWidthsIn : node.laneWidthsOut).splice(index, 0, 10);
  for (const bypass of next.bypasses ?? []) {
    if (dir === 'in' && bypass.fromArmId === armId && bypass.fromLaneIndex >= index) bypass.fromLaneIndex++;
    if (dir === 'out' && bypass.toArmId === armId && bypass.toLaneIndex >= index) bypass.toLaneIndex++;
  }
  return next;
}

// Deleting a lane segment removes its endpoint nodes. The two end nodes of a
// lane run are structural — a cap-pinned end or a taper attachment — so the
// delete skips them; when the segment already reaches from one end to the
// other (nothing but the ends remain), deleting removes the whole lane.
export function removeProfileLaneSegment(
  original: RoundaboutConfig,
  armId: string,
  fromPointId: string,
  toPointId: string,
  dir: 'in' | 'out',
  laneIndex: number
): RoundaboutConfig {
  const arm = original.arms.find(candidate => candidate.id === armId);
  if (!arm) return original;
  const profile = getRoadProfile(arm, estimateArmLength(arm));
  const isLaneEnd = (pointId: string) => {
    const point = findLanePoint(arm, profile, dir, laneIndex, pointId);
    if (!point) return false;
    if (point.endAnchor) return true;
    return Boolean(arm.authoredProfile?.[dir][laneIndex]?.spans.some(span =>
      (['low', 'high'] as const).some(side => {
        const terminal = span[side];
        return terminal.kind === 'free' && Math.abs(terminal.attach - point.distance) < 1e-6;
      })
    ));
  };
  const fromEnd = isLaneEnd(fromPointId);
  const toEnd = isLaneEnd(toPointId);
  if (fromEnd && toEnd) return removeProfileLane(original, armId, dir, laneIndex);
  let next = original;
  if (!fromEnd) next = removeProfileLanePoint(next, armId, fromPointId, dir, laneIndex);
  if (!toEnd) next = removeProfileLanePoint(next, armId, toPointId, dir, laneIndex);
  return next;
}

export function removeProfileLane(original: RoundaboutConfig, armId: string, dir: 'in' | 'out', laneIndex: number): RoundaboutConfig {
  const next = structuredClone(original);
  const arm = next.arms.find(candidate => candidate.id === armId);
  if (!arm) return next;
  // The removed lane's offset transfers to the next lane outward (if one
  // exists) so the strip is preserved — deleting the lane only removes its
  // width.
  const authored = arm.authoredProfile?.[dir];
  if (authored) {
    const removed = authored[laneIndex];
    const outer = authored[laneIndex + 1];
    if (removed && outer) {
      for (const key of removed.keys) {
        if (outer.keys.some(candidate => Math.abs(candidate.distance - key.distance) < 1e-6)) continue;
        const value = evaluateLane(arm.authoredProfile!, outer, key.distance);
        outer.keys.push({ id: `${key.id}_out`, distance: key.distance, width: value.width, gap: value.gap });
      }
      for (const key of outer.keys) key.gap += evaluateLane(arm.authoredProfile!, removed, key.distance).gap;
      outer.keys.sort((a, b) => a.distance - b.distance);
    }
  }
  (dir === 'in' ? arm.lanesIn : arm.lanesOut).splice(laneIndex, 1);
  authored?.splice(laneIndex, 1);
  for (const node of arm.nodes) (dir === 'in' ? node.laneWidthsIn : node.laneWidthsOut).splice(laneIndex, 1);
  for (const point of arm.profile ?? []) {
    const lanes = dir === 'in' ? point.lanesIn : point.lanesOut;
    if (lanes[laneIndex] && lanes[laneIndex + 1]) lanes[laneIndex + 1].gap += lanes[laneIndex].gap;
    lanes.splice(laneIndex, 1);
  }
  next.bypasses = (next.bypasses ?? []).filter(bypass => dir === 'in'
    ? bypass.fromArmId !== armId || bypass.fromLaneIndex !== laneIndex
    : bypass.toArmId !== armId || bypass.toLaneIndex !== laneIndex);
  for (const bypass of next.bypasses) {
    if (dir === 'in' && bypass.fromArmId === armId && bypass.fromLaneIndex > laneIndex) bypass.fromLaneIndex--;
    if (dir === 'out' && bypass.toArmId === armId && bypass.toLaneIndex > laneIndex) bypass.toLaneIndex--;
  }
  return next;
}
