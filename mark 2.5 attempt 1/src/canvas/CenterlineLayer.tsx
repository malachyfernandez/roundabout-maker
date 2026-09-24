import React, { useRef, useState } from 'react';
import { type ArmConfig, type RoundaboutConfig } from '../config/types';
import { dragArmNodes, insertArmNode } from '../editor/constraints';
import { useEditorStore } from '../editor/editorStore';
import { focusedArmIds } from '../editor/selection';
import { getRoadProfile } from '../core/profile';
import { evaluateSpline, getBezierSegment, pointsToSvgPath, splineToSvgPath, type CatmullRomSpline } from '../math/spline';
import { type Vec2, dot, len, sub } from '../math/vector';
import { atProfileDistance, profileGeometry } from '../profile/worldGeometry';
import { screenToWorld } from '../viewport/transform';

type CenterlineProps = {
  arm: ArmConfig;
  zoom: number;
  selected: boolean;
  relatedSelected: boolean;
  anySelection: boolean;
  passedThrough: boolean;
  hovered: boolean;
  guideLightness: number;
  guideShadowStrength: number;
};

function makeSpline(arm: ArmConfig): CatmullRomSpline {
  return { points: arm.nodes.map(node => node.point), nodes: arm.nodes, alpha: 0.5, tension: 0 };
}

function projectOntoSpline(spline: CatmullRomSpline, point: Vec2) {
  const steps = Math.max(64, (spline.nodes?.length ?? spline.points.length) * 64);
  let previous = evaluateSpline(spline, 0).p;
  let best = { t: 0, distance: len(sub(point, previous)) };
  for (let i = 1; i <= steps; i++) {
    const current = evaluateSpline(spline, i / steps).p;
    const edge = sub(current, previous);
    const edgeLengthSquared = dot(edge, edge);
    const local = edgeLengthSquared > 0 ? Math.max(0, Math.min(1, dot(sub(point, previous), edge) / edgeLengthSquared)) : 0;
    const projected = { x: previous.x + edge.x * local, y: previous.y + edge.y * local };
    const distance = len(sub(point, projected));
    if (distance < best.distance) best = { t: (i - 1 + local) / steps, distance };
    previous = current;
  }
  return best.t;
}

const ArmCenterline: React.FC<CenterlineProps> = ({ arm, zoom, selected, relatedSelected, anySelection, passedThrough, hovered, guideLightness, guideShadowStrength }) => {
  const committedConfig = useEditorStore(state => state.committedConfig);
  const setCommittedConfig = useEditorStore(state => state.setCommittedConfig);
  const setDraftConfig = useEditorStore(state => state.setDraftConfig);
  const commitDraft = useEditorStore(state => state.commitDraft);
  const setDrag = useEditorStore(state => state.setDrag);
  const setSelection = useEditorStore(state => state.setSelection);
  const startPoint = useRef<Vec2 | null>(null);
  const dragOriginal = useRef<RoundaboutConfig | null>(null);
  const dragNodeIds = useRef<string[]>([]);
  const spline = makeSpline(arm);
  const d = splineToSvgPath(spline);

  // Ghost node preview — rAF-coalesced so high-frequency pointermove doesn't
  // trigger a React render per event.
  const [ghostPoint, setGhostPoint] = useState<Vec2 | null>(null);
  const [hoveredSegmentIndex, setHoveredSegmentIndex] = useState<number | null>(null);
  const pendingGhost = useRef<Vec2 | null>(null);
  const ghostFrame = useRef<number | null>(null);
  const flushGhost = () => {
    ghostFrame.current = null;
    setGhostPoint(pendingGhost.current);
  };
  const scheduleGhost = (point: Vec2 | null) => {
    pendingGhost.current = point;
    if (ghostFrame.current === null) ghostFrame.current = requestAnimationFrame(flushGhost);
  };
  React.useEffect(() => () => { if (ghostFrame.current !== null) cancelAnimationFrame(ghostFrame.current); }, []);

  const segmentAt = (point: Vec2) => {
    const globalT = projectOntoSpline(spline, point);
    const segmentCount = arm.nodes.length - 1;
    const scaledT = globalT * segmentCount;
    const segmentIndex = Math.min(Math.floor(scaledT), segmentCount - 1);
    return { globalT, segmentIndex, localT: Math.max(0.001, Math.min(0.999, scaledT - segmentIndex)) };
  };

  const handlePointerDown = (event: React.PointerEvent<SVGPathElement>) => {
    if (!selected || passedThrough || arm.nodes.length < 2) return;
    event.preventDefault();
    event.stopPropagation();
    scheduleGhost(null);
    const svg = event.currentTarget.closest('svg');
    if (!svg) return;
    const pointer = screenToWorld(event, svg);
    const { segmentIndex } = segmentAt(pointer);
    setHoveredSegmentIndex(segmentIndex);
    startPoint.current = pointer;
    dragOriginal.current = structuredClone(committedConfig);
    dragNodeIds.current = [arm.nodes[segmentIndex].id, arm.nodes[segmentIndex + 1].id];
    setDrag({ active: true, type: 'arm-segment' });
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: React.PointerEvent<SVGPathElement>) => {
    if (startPoint.current && dragOriginal.current && dragNodeIds.current.length === 2) {
      const svg = event.currentTarget.closest('svg');
      if (!svg) return;
      const pointer = screenToWorld(event, svg);
      const targets = dragNodeIds.current.map(nodeId => ({ kind: 'arm-node' as const, armId: arm.id, nodeId }));
      setDraftConfig(dragArmNodes(dragOriginal.current, targets, sub(pointer, startPoint.current), !(event.metaKey || event.ctrlKey)));
      return;
    }
    if (!selected || passedThrough) return;
    const svg = event.currentTarget.closest('svg');
    if (!svg) return;
    const pointer = screenToWorld(event, svg);
    const projected = segmentAt(pointer);
    const { p } = evaluateSpline(spline, projected.globalT);
    setHoveredSegmentIndex(projected.segmentIndex);
    scheduleGhost(p);
  };

  const handleDoubleClick = (event: React.MouseEvent<SVGPathElement>) => {
    if (!selected || passedThrough || arm.nodes.length < 2) return;
    event.preventDefault();
    event.stopPropagation();
    const svg = event.currentTarget.closest('svg');
    if (!svg) return;
    const { segmentIndex, localT } = segmentAt(screenToWorld(event, svg));
    const nodeId = `node_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    setCommittedConfig(insertArmNode(committedConfig, arm.id, segmentIndex, localT, nodeId));
    setSelection({ kind: 'arm-node', armId: arm.id, nodeId });
    scheduleGhost(null);
  };

  const handlePointerLeave = () => {
    scheduleGhost(null);
    setHoveredSegmentIndex(null);
  };

  const resetDrag = () => {
    startPoint.current = null;
    dragOriginal.current = null;
    dragNodeIds.current = [];
    setDrag(null);
  };

  const handlePointerUp = (event: React.PointerEvent<SVGPathElement>) => {
    if (!startPoint.current) return;
    commitDraft();
    resetDrag();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const handlePointerCancel = (event: React.PointerEvent<SVGPathElement>) => {
    setDraftConfig(null);
    resetDrag();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const showSpline = !anySelection || selected || relatedSelected || hovered;
  const guideColor = `hsl(221, 83%, ${guideLightness}%)`;
  const isHoverOnly = hovered && !selected && !relatedSelected;

  // The "propper road" runs between the two ending cross-sections. Unselected
  // arms only show and offer that span; while editing, the propper road is
  // solid and the tails beyond it are dotted.
  const { headPath, middlePath, tailPath } = React.useMemo(() => {
    if (arm.nodes.length < 2) return { headPath: null, middlePath: null, tailPath: null };
    const geometry = profileGeometry(arm);
    const profile = getRoadProfile(arm, geometry.totalLength);
    const startCap = profile.find(point => point.endAnchor === 'start') ?? profile[0];
    const endCap = profile.find(point => point.endAnchor === 'end') ?? profile[profile.length - 1];
    const startDistance = Math.max(0, Math.min(geometry.totalLength, startCap?.distance ?? 0));
    const endDistance = Math.max(startDistance, Math.min(geometry.totalLength, endCap?.distance ?? geometry.totalLength));
    const start = atProfileDistance(geometry, startDistance).p;
    const end = atProfileDistance(geometry, endDistance).p;
    const head = geometry.samples.filter(sample => sample.distance < startDistance).map(sample => sample.p);
    const middle = geometry.samples.filter(sample => sample.distance > startDistance && sample.distance < endDistance).map(sample => sample.p);
    const tail = geometry.samples.filter(sample => sample.distance > endDistance).map(sample => sample.p);
    return {
      headPath: head.length ? pointsToSvgPath([...head, start]) : null,
      middlePath: pointsToSvgPath([start, ...middle, end]),
      tailPath: tail.length ? pointsToSvgPath([end, ...tail]) : null
    };
  }, [arm]);
  const splitAtBoundaries = selected || relatedSelected;

  const activeStroke = selected ? '#2563eb' : '#3b82f6';
  const activeWidth = (selected ? 2 : 1.75) * zoom;
  const shadowFilter = guideShadowStrength > 0 ? `url(#road-guide-shadow)` : undefined;
  const hoveredSegmentPath = hoveredSegmentIndex !== null && hoveredSegmentIndex < arm.nodes.length - 1 ? (() => {
    const segment = getBezierSegment(arm.nodes, hoveredSegmentIndex);
    return `M ${segment.p0.x} ${segment.p0.y} C ${segment.c1.x} ${segment.c1.y} ${segment.c2.x} ${segment.c2.y} ${segment.p1.x} ${segment.p1.y}`;
  })() : null;

  return (
    <g>
      {showSpline && !splitAtBoundaries && (
        <path
          d={middlePath ?? d}
          fill="none"
          stroke={hovered ? '#3b82f6' : guideColor}
          strokeWidth={(hovered ? 1.75 : 1.25) * zoom}
          strokeDasharray={`${5 * zoom} ${5 * zoom}`}
          opacity={isHoverOnly ? 0.85 : undefined}
          filter={shadowFilter}
          pointerEvents="none"
        />
      )}
      {showSpline && splitAtBoundaries && (
        <>
          {[headPath, tailPath].map((tail, index) => tail && (
            <path
              key={index}
              d={tail}
              fill="none"
              stroke={activeStroke}
              strokeWidth={activeWidth}
              strokeDasharray={`0 ${4 * zoom}`}
              strokeLinecap="round"
              filter={shadowFilter}
              pointerEvents="none"
            />
          ))}
          {middlePath && (
            <path
              d={middlePath}
              fill="none"
              stroke={activeStroke}
              strokeWidth={activeWidth}
              filter={shadowFilter}
              pointerEvents="none"
            />
          )}
        </>
      )}
      {selected && hoveredSegmentPath && <path d={hoveredSegmentPath} fill="none" stroke="#2563eb" strokeWidth={6 * zoom} strokeLinecap="round" opacity={0.3} pointerEvents="none" />}
      <path
        d={selected && !passedThrough ? d : middlePath ?? d}
        fill="none"
        stroke="transparent"
        strokeWidth={20}
        vectorEffect="non-scaling-stroke"
        pointerEvents="stroke"
        cursor={selected ? 'grab' : 'pointer'}
        data-target={selected && !passedThrough ? undefined : JSON.stringify({ kind: 'arm', armId: arm.id })}
        data-handle={selected && !passedThrough ? 'true' : undefined}
        data-tooltip={selected ? 'Drag this road segment to move both endpoint nodes. Double-click to add a road node.' : `Select road ${arm.id}.`}
        onPointerDown={handlePointerDown}
        onDoubleClick={handleDoubleClick}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        onPointerLeave={handlePointerLeave}
      />
      {ghostPoint && (
        <circle
          cx={ghostPoint.x}
          cy={ghostPoint.y}
          r={6 * zoom}
          fill="#fff"
          stroke="#2563eb"
          strokeWidth={2 * zoom}
          opacity={0.4}
          pointerEvents="none"
        />
      )}
    </g>
  );
};

type Props = {
  config: RoundaboutConfig;
  zoom: number;
};

export const CenterlineLayer: React.FC<Props> = React.memo(({ config, zoom }) => {
  const selections = useEditorStore(state => state.selections);
  const selection = useEditorStore(state => state.selection);
  const hovered = useEditorStore(state => state.hovered);
  const viewMode = useEditorStore(state => state.viewMode);
  const passThroughStack = useEditorStore(state => state.passThroughStack);
  const guideLightness = useEditorStore(state => state.settings.roadGuideLightness);
  const guideShadowStrength = useEditorStore(state => state.settings.roadGuideShadowStrength);
  const guideShadowBlur = useEditorStore(state => state.settings.roadGuideShadowBlur);
  const guideShadowOffsetY = useEditorStore(state => state.settings.roadGuideShadowOffsetY);
  if (viewMode === 'rendered') return null;
  const anySelection = selections.length > 0;
  const focused = focusedArmIds(selections);
  const focusActive = focused.size > 0;
  // Focused roads' guides render above the dimmed rest, with the primary
  // selection's road on top — matching GeometryLayer's segment ordering.
  const primaryArmId = selection && 'armId' in selection ? selection.armId : null;
  const armRank = (armId: string) => focusActive && focused.has(armId)
    ? armId === primaryArmId ? 2 : 1
    : 0;
  const orderedArms = [...config.arms].sort((a, b) => armRank(a.id) - armRank(b.id));
  const guidePoints = config.arms.flatMap(arm => arm.nodes.flatMap(node => [
    node.point,
    node.tangentIn ? { x: node.point.x + node.tangentIn.x, y: node.point.y + node.tangentIn.y } : node.point,
    node.tangentOut ? { x: node.point.x + node.tangentOut.x, y: node.point.y + node.tangentOut.y } : node.point
  ]));
  const shadowMargin = (guideShadowBlur * guideShadowStrength * 4 + Math.abs(guideShadowOffsetY) + 4) * zoom;
  const guideXs = guidePoints.length ? guidePoints.map(point => point.x) : [0];
  const guideYs = guidePoints.length ? guidePoints.map(point => point.y) : [0];
  const minX = Math.min(...guideXs) - shadowMargin;
  const minY = Math.min(...guideYs) - shadowMargin;
  const maxX = Math.max(...guideXs) + shadowMargin;
  const maxY = Math.max(...guideYs) + shadowMargin;
  return (
    <g>
      <defs>
        <filter id="road-guide-shadow" filterUnits="userSpaceOnUse" x={minX} y={minY} width={maxX - minX} height={maxY - minY}>
          <feDropShadow dx={0} dy={guideShadowOffsetY * zoom} stdDeviation={guideShadowBlur * zoom * guideShadowStrength} floodColor="#000" floodOpacity={guideShadowStrength} />
        </filter>
      </defs>
      {orderedArms.map(arm => {
        const armSelected = selections.some(selected => selected.kind === 'arm' && selected.armId === arm.id);
        const armRelatedSelected = selections.some(selected => selected.kind !== 'arm' && 'armId' in selected && selected.armId === arm.id);
        // Before a road is in the selection scope, a click on any of its parts
        // selects the whole road — so hovering any part previews road hover.
        const armHovered = Boolean(hovered && 'armId' in hovered && hovered.armId === arm.id
          && (hovered.kind === 'arm' || (!armSelected && !armRelatedSelected)));
        return (
          <g key={arm.id} style={{ opacity: focusActive && !focused.has(arm.id) ? 0.5 : 1, transition: 'opacity 160ms ease' }}>
            <ArmCenterline
              arm={arm}
              zoom={zoom}
              selected={armSelected}
              relatedSelected={armRelatedSelected}
              anySelection={anySelection}
              passedThrough={passThroughStack.includes(JSON.stringify({ kind: 'arm', armId: arm.id }))}
              hovered={armHovered}
              guideLightness={guideLightness}
              guideShadowStrength={guideShadowStrength}
            />
          </g>
        );
      })}
    </g>
  );
});
