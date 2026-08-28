export type PerformancePreset = 'live' | 'balanced' | 'release';

export type PerformancePolicy = {
  solveDuringDrag: boolean;
  markingsDuringDrag: boolean;
  effectsDuringInteraction: boolean;
  dragSampleCount: number;
};

export const PERFORMANCE_PRESETS: Record<PerformancePreset, { label: string; description: string; policy: PerformancePolicy }> = {
  live: {
    label: 'Live updates',
    description: 'Rebuild all geometry, markings, and effects while editing.',
    policy: { solveDuringDrag: true, markingsDuringDrag: true, effectsDuringInteraction: true, dragSampleCount: 90 }
  },
  balanced: {
    label: 'Mostly live with really good performance',
    description: 'Keep pavement and controls live; defer markings and visual effects until interaction stops.',
    policy: { solveDuringDrag: true, markingsDuringDrag: false, effectsDuringInteraction: false, dragSampleCount: 60 }
  },
  release: {
    label: 'Render on release',
    description: 'Move controls live and rebuild detailed geometry only when released.',
    policy: { solveDuringDrag: false, markingsDuringDrag: false, effectsDuringInteraction: false, dragSampleCount: 90 }
  }
};

export const performancePolicy = (preset: PerformancePreset) => PERFORMANCE_PRESETS[preset].policy;
