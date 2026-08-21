import { type RoundaboutConfig } from '../config/types';

export * from '../config/types';

export function validateConfig(config: RoundaboutConfig): string[] {
  const errors: string[] = [];
  
  const ringIds = new Set(config.rings.map(r => r.id));
  
  if (config.rings.length === 0) {
    errors.push("Must have at least one ring.");
  }

  for (const arm of config.arms) {
    if (arm.nodes.length < 2) {
      errors.push(`Arm ${arm.id} must have at least 2 nodes.`);
    }
    
    for (const lane of arm.lanesIn) {
      if (!ringIds.has(lane.targetsRing)) {
        errors.push(`Arm ${arm.id} laneIn targets unknown ring ${lane.targetsRing}`);
      }
    }
    for (const lane of arm.lanesOut) {
      if (!ringIds.has(lane.sourceRing)) {
        errors.push(`Arm ${arm.id} laneOut sources unknown ring ${lane.sourceRing}`);
      }
    }
  }

  return errors;
}

export const DEFAULT_CONFIG: RoundaboutConfig = {
  island: { center: { x: 0, y: 0 }, radius: 15 },
  circulation: "ccw",
  rings: [
    { id: "inner", center: { x: -8, y: 0 }, radius: 35, width: 12 },
    { id: "outer", center: { x: 8, y: 0 }, radius: 35, width: 12 },
  ],
  arms: [
    {
      id: "north",
      nodes: [
        { id: "n_n0", point: { x: 0, y: 0 }, medianWidth: 4, laneWidthsIn: [10, 10], laneWidthsOut: [10, 10] },
        { id: "n_n1", point: { x: 0, y: -150 }, medianWidth: 4, laneWidthsIn: [10, 10], laneWidthsOut: [10, 10] }
      ],
      lanesIn: [
        { targetsRing: "outer", filletRadius: 40 },
        { targetsRing: "inner", filletRadius: 40 }
      ],
      lanesOut: [
        { sourceRing: "inner", filletRadius: 40, dropsRing: false },
        { sourceRing: "outer", filletRadius: 40, dropsRing: true }
      ]
    },
    {
      id: "east",
      nodes: [
        { id: "e_n0", point: { x: 0, y: 0 }, medianWidth: 4, laneWidthsIn: [10], laneWidthsOut: [10] },
        { id: "e_n1", point: { x: 150, y: 0 }, medianWidth: 4, laneWidthsIn: [10], laneWidthsOut: [10] }
      ],
      lanesIn: [
        { targetsRing: "inner", filletRadius: 40 }
      ],
      lanesOut: [
        { sourceRing: "outer", filletRadius: 40, dropsRing: false }
      ]
    },
    {
      id: "south",
      nodes: [
        { id: "s_n0", point: { x: 0, y: 0 }, medianWidth: 4, laneWidthsIn: [10, 10], laneWidthsOut: [10, 10] },
        { id: "s_n1", point: { x: 0, y: 150 }, medianWidth: 4, laneWidthsIn: [10, 10], laneWidthsOut: [10, 10] }
      ],
      lanesIn: [
        { targetsRing: "inner", filletRadius: 40 },
        { targetsRing: "outer", filletRadius: 40 }
      ],
      lanesOut: [
        { sourceRing: "outer", filletRadius: 40, dropsRing: false },
        { sourceRing: "inner", filletRadius: 40, dropsRing: true }
      ]
    },
    {
      id: "west",
      nodes: [
        { id: "w_n0", point: { x: 0, y: 0 }, medianWidth: 4, laneWidthsIn: [10], laneWidthsOut: [10] },
        { id: "w_n1", point: { x: -150, y: 0 }, medianWidth: 4, laneWidthsIn: [10], laneWidthsOut: [10] }
      ],
      lanesIn: [
        { targetsRing: "outer", filletRadius: 40 }
      ],
      lanesOut: [
        { sourceRing: "inner", filletRadius: 40, dropsRing: false }
      ]
    }
  ]
};
