import { type Vec2 } from '../math/vector';

export type RingConfig = {
  id: string;
  center: Vec2;
  radius: number;
  width: number;
};

export type LaneIn = {
  width: number;
  targetsRing: string;
  filletRadius?: number;
};

export type LaneOut = {
  width: number;
  sourceRing: string;
  filletRadius?: number;
  dropsRing: boolean;
};

export type ArmNode = {
  id: string;
  point: Vec2; // {x, y}
  tangentIn?: Vec2;
  tangentOut?: Vec2;
  medianWidth: number;
  // Per-lane widths at this node cross-section
  laneWidthsIn: number[];
  laneWidthsOut: number[];
};

export type ProfileLane = {
  width: number;
  gap: number;
};

export type RoadProfilePoint = {
  id: string;
  distance: number;
  medianWidth: number;
  lanesIn: ProfileLane[];
  lanesOut: ProfileLane[];
};

export type RightTurnBypass = {
  id: string;
  fromArmId: string;
  fromLaneIndex: number;
  toArmId: string;
  toLaneIndex: number;
  radius: number;
};

export type ArmConfig = {
  id: string;
  nodes: ArmNode[];
  profile?: RoadProfilePoint[];
  // Topology remains global to the arm
  lanesIn: { targetsRing: string; filletRadius?: number }[];
  lanesOut: { sourceRing: string; filletRadius?: number; dropsRing: boolean }[];
};

export type RoundaboutConfig = {
  island: { center: Vec2; radius: number };
  rings: RingConfig[];
  arms: ArmConfig[];
  bypasses?: RightTurnBypass[];
  circulation: "ccw" | "cw";
};

export type SelectionTarget =
  | { kind: "island" }
  | { kind: "ring"; ringId: string }
  | { kind: "arm"; armId: string }
  | { kind: "lane"; armId: string; dir: "in" | "out"; laneIndex: number };
