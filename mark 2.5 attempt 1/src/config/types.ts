import { type Vec2 } from '../math/vector';

export type RingConfig = {
  id: string;
  center: Vec2;
  radius: number;
  width: number;
};

export type LaneIn = {
  sourceRing?: string;
  targetsRing?: string;
  filletRadius?: number;
  sourceFilletRadius?: number;
  targetFilletRadius?: number;
  dropsRing?: boolean;
};

export type LaneOut = {
  sourceRing?: string;
  targetsRing?: string;
  filletRadius?: number;
  sourceFilletRadius?: number;
  targetFilletRadius?: number;
  dropsRing: boolean;
};

export type ArmNode = {
  id: string;
  point: Vec2; // {x, y}
  tangentIn?: Vec2;
  tangentOut?: Vec2;
  splitRestore?: {
    previous: { nodeId: string; tangentIn?: Vec2; tangentOut?: Vec2 };
    next: { nodeId: string; tangentIn?: Vec2; tangentOut?: Vec2 };
  };
  medianWidth: number;
  // Per-lane widths at this node cross-section
  laneWidthsIn: number[];
  laneWidthsOut: number[];
};

export type ProfileLane = {
  width: number;
  gap: number;
  node?: boolean;
  fresh?: boolean;
};

export type RoadProfilePoint = {
  id: string;
  distance: number;
  medianWidth: number;
  lanesIn: ProfileLane[];
  lanesOut: ProfileLane[];
  endAnchor?: 'start' | 'end';
};

export type LaneShapeKey = { id: string; distance: number; width: number; gap: number };

export type LaneTerminal = { kind: 'cap' } | { kind: 'free'; tip: number; attach: number };

export type LaneSpan = { id: string; low: LaneTerminal; high: LaneTerminal };

export type LaneShape = { keys: LaneShapeKey[]; spans: LaneSpan[] };

export type AuthoredRoadProfile = {
  median: { id: string; distance: number; width: number; endAnchor?: 'start' | 'end' }[];
  in: LaneShape[];
  out: LaneShape[];
};

export type RightTurnBypass = {
  id: string;
  fromArmId: string;
  fromLaneIndex: number;
  toArmId: string;
  toLaneIndex: number;
  entryRadius: number;
  exitRadius: number;
  lanePoint: Vec2;
  laneAngle: number;
  radius?: number;
};

export type ArmConfig = {
  id: string;
  nodes: ArmNode[];
  profile?: RoadProfilePoint[];
  authoredProfile?: AuthoredRoadProfile;
  // Topology remains global to the arm
  lanesIn: LaneIn[];
  lanesOut: LaneOut[];
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
  | { kind: "arm-node"; armId: string; nodeId: string }
  | { kind: "lane"; armId: string; dir: "in" | "out"; laneIndex: number }
  | { kind: "profile-point"; armId: string; pointId: string }
  | { kind: "profile-control"; armId: string; pointId: string; dir: "in" | "out"; control: "gap" | "width"; laneIndex: number }
  | { kind: "lane-node"; armId: string; pointId: string; dir: "in" | "out"; laneIndex: number }
  | { kind: "lane-segment"; armId: string; fromPointId: string; toPointId: string; dir: "in" | "out"; laneIndex: number };
