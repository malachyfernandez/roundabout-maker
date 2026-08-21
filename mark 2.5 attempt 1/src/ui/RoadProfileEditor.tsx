import React from 'react';
import { type ArmConfig, type RoadProfilePoint } from '../config/types';
import { estimateArmLength, getRoadProfile, insertProfilePoint } from '../core/profile';

type Props = {
  arm: ArmConfig;
  onChange: (arm: ArmConfig) => void;
};

type DragTarget =
  | { kind: 'distance'; pointId: string; startX: number; original: ArmConfig }
  | { kind: 'median'; pointId: string; dir: 'in' | 'out'; original: ArmConfig }
  | { kind: 'gap' | 'width'; pointId: string; dir: 'in' | 'out'; laneIndex: number; original: ArmConfig };

type DragInput =
  | { kind: 'distance'; pointId: string }
  | { kind: 'median'; pointId: string; dir: 'in' | 'out' }
  | { kind: 'gap' | 'width'; pointId: string; dir: 'in' | 'out'; laneIndex: number };

const WIDTH = 410;
const HEIGHT = 270;
const PAD_X = 22;
const CENTER_Y = 135;
const COLORS_IN = ['#2563eb', '#06b6d4', '#14b8a6', '#22c55e'];
const COLORS_OUT = ['#f97316', '#ef4444', '#e11d48', '#a855f7'];

function laneBounds(point: RoadProfilePoint, dir: 'in' | 'out', laneIndex: number) {
  const lanes = dir === 'in' ? point.lanesIn : point.lanesOut;
  let base = point.medianWidth / 2;
  for (let index = 0; index < laneIndex; index++) base += (lanes[index]?.gap ?? 0) + (lanes[index]?.width ?? 0);
  const lane = lanes[laneIndex] ?? { width: 0, gap: 0 };
  const inner = base + lane.gap;
  return { base, inner, outer: inner + lane.width };
}

export const RoadProfileEditor: React.FC<Props> = ({ arm, onChange }) => {
  const totalLength = Math.max(20, estimateArmLength(arm));
  const profile = getRoadProfile(arm, totalLength);
  const [selectedId, setSelectedId] = React.useState(profile[0]?.id ?? null);
  const drag = React.useRef<DragTarget | null>(null);
  const selected = profile.find(point => point.id === selectedId) ?? profile[0];
  const maxOffset = Math.max(18, ...profile.flatMap(point => {
    const inLast = laneBounds(point, 'in', Math.max(0, point.lanesIn.length - 1)).outer;
    const outLast = laneBounds(point, 'out', Math.max(0, point.lanesOut.length - 1)).outer;
    return [inLast, outLast];
  }));
  const yScale = Math.min(4.2, (CENTER_Y - 18) / maxOffset);
  const xForDistance = (distance: number) => PAD_X + Math.max(0, Math.min(1, distance / totalLength)) * (WIDTH - PAD_X * 2);
  const yForOffset = (offset: number, dir: 'in' | 'out') => CENTER_Y + (dir === 'in' ? -1 : 1) * offset * yScale;

  const commitArm = (updater: (next: ArmConfig) => void) => {
    const next = structuredClone(arm);
    next.profile = getRoadProfile(next, totalLength);
    updater(next);
    next.profile.sort((a, b) => a.distance - b.distance);
    onChange(next);
  };

  const pathForLane = (dir: 'in' | 'out', laneIndex: number) => {
    const outer = profile.map(point => `${xForDistance(point.distance)},${yForOffset(laneBounds(point, dir, laneIndex).outer, dir)}`);
    const inner = [...profile].reverse().map(point => `${xForDistance(point.distance)},${yForOffset(laneBounds(point, dir, laneIndex).inner, dir)}`);
    return `M ${outer.join(' L ')} L ${inner.join(' L ')} Z`;
  };

  const localPoint = (event: React.PointerEvent<SVGSVGElement> | React.MouseEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: (event.clientX - rect.left) * WIDTH / rect.width, y: (event.clientY - rect.top) * HEIGHT / rect.height };
  };

  const handlePointerMove = (event: React.PointerEvent<SVGSVGElement>) => {
    if (!drag.current) return;
    const pointer = localPoint(event);
    const state = drag.current;
    const next = structuredClone(state.original);
    next.profile = getRoadProfile(next, totalLength);
    const point = next.profile.find(candidate => candidate.id === state.pointId);
    if (!point) return;
    if (state.kind === 'distance') {
      point.distance = Math.max(0, Math.min(totalLength, (pointer.x - PAD_X) / (WIDTH - PAD_X * 2) * totalLength));
    } else {
      const sign = state.dir === 'in' ? -1 : 1;
      const offset = Math.max(0, (pointer.y - CENTER_Y) * sign / yScale);
      if (state.kind === 'median') {
        point.medianWidth = Math.max(0, offset * 2);
      } else {
        const lanes = state.dir === 'in' ? point.lanesIn : point.lanesOut;
        const lane = lanes[state.laneIndex];
        if (!lane) return;
        const bounds = laneBounds(point, state.dir, state.laneIndex);
        if (state.kind === 'gap') lane.gap = Math.max(0, offset - bounds.base);
        else lane.width = Math.max(0, offset - bounds.inner);
      }
    }
    next.profile.sort((a, b) => a.distance - b.distance);
    onChange(next);
  };

  const handlePointerUp = (event: React.PointerEvent<SVGSVGElement>) => {
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const beginDrag = (event: React.PointerEvent, target: DragInput) => {
    event.stopPropagation();
    const svg = event.currentTarget.closest('svg');
    if (!svg) return;
    drag.current = target.kind === 'distance'
      ? { ...target, startX: event.clientX, original: structuredClone(arm) }
      : { ...target, original: structuredClone(arm) } as DragTarget;
    svg.setPointerCapture(event.pointerId);
  };

  const addLane = (dir: 'in' | 'out') => {
    commitArm(next => {
      if (dir === 'in') next.lanesIn.push({ targetsRing: next.lanesIn.at(-1)?.targetsRing ?? '', filletRadius: 40 });
      else next.lanesOut.push({ sourceRing: next.lanesOut.at(-1)?.sourceRing ?? '', filletRadius: 40, dropsRing: false });
      const index = dir === 'in' ? next.lanesIn.length - 1 : next.lanesOut.length - 1;
      for (const point of next.profile!) {
        const lanes = dir === 'in' ? point.lanesIn : point.lanesOut;
        lanes[index] = { width: selected && point.distance >= selected.distance ? 10 : 0, gap: 0 };
      }
    });
  };

  return (
    <section className="road-profile" data-tooltip="A straightened view of the selected road. Distance runs from the roundabout at left to the outer endpoint at right.">
      <div className="road-profile-heading">
        <div>
          <strong>Road profile</strong>
          <span>{Math.round(totalLength)} ft from roundabout to endpoint</span>
        </div>
        <div>
          <button data-tooltip="Add an entry lane beginning at the selected change point." onClick={() => addLane('in')}>+ Entry lane</button>
          <button data-tooltip="Add an exit lane beginning at the selected change point." onClick={() => addLane('out')}>+ Exit lane</button>
        </div>
      </div>
      <svg
        className="road-profile-canvas"
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onDoubleClick={event => {
          const pointer = localPoint(event);
          const distance = Math.max(0, Math.min(totalLength, (pointer.x - PAD_X) / (WIDTH - PAD_X * 2) * totalLength));
          const next = structuredClone(arm);
          next.profile = insertProfilePoint(next, distance, totalLength);
          const added = next.profile.reduce((best, point) => Math.abs(point.distance - distance) < Math.abs(best.distance - distance) ? point : best);
          setSelectedId(added.id);
          onChange(next);
        }}
        data-tooltip="Double-click the road to add a cross-section change point. Click a vertical line to select it."
      >
        <rect x="0" y="0" width={WIDTH} height={HEIGHT} rx="9" fill="#f8fafc" />
        <rect x={PAD_X} y={CENTER_Y - profile[0].medianWidth * yScale / 2} width={WIDTH - PAD_X * 2} height={profile[0].medianWidth * yScale} fill="#cbd5e1" opacity=".65" />
        {Array.from({ length: arm.lanesIn.length }, (_, index) => (
          <path key={`in-${index}`} d={pathForLane('in', index)} fill={COLORS_IN[index % COLORS_IN.length]} opacity=".72" stroke="#fff" strokeWidth="1" />
        ))}
        {Array.from({ length: arm.lanesOut.length }, (_, index) => (
          <path key={`out-${index}`} d={pathForLane('out', index)} fill={COLORS_OUT[index % COLORS_OUT.length]} opacity=".72" stroke="#fff" strokeWidth="1" />
        ))}
        <line x1={PAD_X} y1={CENTER_Y} x2={WIDTH - PAD_X} y2={CENTER_Y} stroke="#475569" strokeWidth="1" strokeDasharray="5 4" />
        {profile.map(point => {
          const x = xForDistance(point.distance);
          const isSelected = point.id === selected?.id;
          return (
            <g key={point.id}>
              <line
                x1={x}
                y1="12"
                x2={x}
                y2={HEIGHT - 12}
                stroke={isSelected ? '#dc2626' : '#94a3b8'}
                strokeWidth={isSelected ? 2 : 1}
                opacity={isSelected ? 1 : .7}
                cursor="ew-resize"
                data-tooltip={`Change point at ${point.distance.toFixed(1)} ft. Click to select; drag to move along the road.`}
                onClick={event => { event.stopPropagation(); setSelectedId(point.id); }}
                onPointerDown={event => { setSelectedId(point.id); beginDrag(event, { kind: 'distance', pointId: point.id }); }}
              />
              <text x={x + 4} y="16" fill={isSelected ? '#b91c1c' : '#64748b'} fontSize="8">{Math.round(point.distance)}'</text>
            </g>
          );
        })}
        {selected && (() => {
          const x = xForDistance(selected.distance);
          const controls: React.ReactNode[] = [];
          for (const dir of ['in', 'out'] as const) {
            const lanes = dir === 'in' ? selected.lanesIn : selected.lanesOut;
            controls.push(
              <circle
                key={`${dir}-median`}
                cx={x}
                cy={yForOffset(selected.medianWidth / 2, dir)}
                r="4.5"
                fill="#fff"
                stroke="#334155"
                strokeWidth="1.5"
                data-tooltip="Drag to change the median width at this cross-section."
                onPointerDown={event => beginDrag(event, { kind: 'median', pointId: selected.id, dir })}
              />
            );
            lanes.forEach((_lane, laneIndex) => {
              const bounds = laneBounds(selected, dir, laneIndex);
              controls.push(
                <circle
                  key={`${dir}-${laneIndex}-gap`}
                  cx={x}
                  cy={yForOffset(bounds.inner, dir)}
                  r="3.5"
                  fill="#fff"
                  stroke="#7c3aed"
                  strokeWidth="1.5"
                  data-tooltip={`Drag to set the gap before ${dir === 'in' ? 'entry' : 'exit'} lane ${laneIndex + 1}.`}
                  onPointerDown={event => beginDrag(event, { kind: 'gap', pointId: selected.id, dir, laneIndex })}
                />,
                <circle
                  key={`${dir}-${laneIndex}-width`}
                  cx={x}
                  cy={yForOffset(bounds.outer, dir)}
                  r="4.5"
                  fill={dir === 'in' ? COLORS_IN[laneIndex % COLORS_IN.length] : COLORS_OUT[laneIndex % COLORS_OUT.length]}
                  stroke="#fff"
                  strokeWidth="1.5"
                  data-tooltip={`Drag to set the width of ${dir === 'in' ? 'entry' : 'exit'} lane ${laneIndex + 1}.`}
                  onPointerDown={event => beginDrag(event, { kind: 'width', pointId: selected.id, dir, laneIndex })}
                />
              );
            });
          }
          return controls;
        })()}
        <text x={PAD_X} y={HEIGHT - 5} fill="#64748b" fontSize="8">ROUNDABOUT · 0'</text>
        <text x={WIDTH - PAD_X} y={HEIGHT - 5} fill="#64748b" fontSize="8" textAnchor="end">OUTER END · {Math.round(totalLength)}'</text>
      </svg>
      {selected && (
        <div className="profile-selection">
          <span><strong>{Math.round(selected.distance)} ft</strong> change point</span>
          <span>{selected.lanesIn.filter(lane => lane.width > .1).length} entry · {selected.lanesOut.filter(lane => lane.width > .1).length} exit lanes</span>
          <button
            disabled={profile.length <= 2}
            data-tooltip={profile.length <= 2 ? 'A road profile must keep its start and end change points.' : 'Delete this cross-section change point.'}
            onClick={() => commitArm(next => { next.profile = next.profile!.filter(point => point.id !== selected.id); setSelectedId(next.profile[0]?.id ?? null); })}
          >Delete point</button>
        </div>
      )}
    </section>
  );
};
