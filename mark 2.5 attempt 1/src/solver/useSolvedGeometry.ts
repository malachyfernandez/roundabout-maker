import { useState, useEffect } from 'react';
import { type RoundaboutConfig } from '../config/types';
import { validateConfig } from '../core/config';
import { compileRoutes } from '../core/routes';
import { solveGeometry, type ResolvedSegment } from '../core/solver';

type SolverOptions = {
  profileEnabled?: boolean;
  bypassEnabled?: boolean;
  sampleCount?: number;
};

type SolvedGeometry = {
  optionsKey: string;
  config: RoundaboutConfig;
  segments: ResolvedSegment[];
  errors: string[];
};

const solutionCache = new WeakMap<RoundaboutConfig, Map<string, SolvedGeometry>>();

function solve(config: RoundaboutConfig, profileEnabled: boolean, bypassEnabled: boolean, sampleCount: number): SolvedGeometry {
  const key = `${profileEnabled}:${bypassEnabled}:${sampleCount}`;
  const cached = solutionCache.get(config)?.get(key);
  if (cached) return cached;
  const errors = validateConfig(config);
  let segments: ResolvedSegment[] = [];
  try {
    const routes = compileRoutes(config, { profileEnabled, bypassEnabled, sampleCount });
    segments = solveGeometry(config, routes);
  } catch (error) {
    errors.push(String(error));
  }
  const result = { optionsKey: key, config, segments, errors };
  const entries = solutionCache.get(config) ?? new Map<string, SolvedGeometry>();
  entries.set(key, result);
  solutionCache.set(config, entries);
  return result;
}

export function useSolvedGeometry(config: RoundaboutConfig, options: SolverOptions = {}) {
  const profileEnabled = options.profileEnabled ?? false;
  const bypassEnabled = options.bypassEnabled ?? false;
  const sampleCount = options.sampleCount ?? 90;
  const [result, setResult] = useState(() => solve(config, profileEnabled, bypassEnabled, sampleCount));

  useEffect(() => {
    const optionsKey = `${profileEnabled}:${bypassEnabled}:${sampleCount}`;
    if (result.config === config && result.optionsKey === optionsKey) return;
    const rafId = requestAnimationFrame(() => setResult(solve(config, profileEnabled, bypassEnabled, sampleCount)));
    return () => cancelAnimationFrame(rafId);
  }, [config, profileEnabled, bypassEnabled, sampleCount, result]);

  return result;
}
