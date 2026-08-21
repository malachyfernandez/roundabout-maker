import { useState, useEffect } from 'react';
import { type RoundaboutConfig } from '../config/types';
import { validateConfig } from '../core/config';
import { compileRoutes } from '../core/routes';
import { solveGeometry, type ResolvedSegment } from '../core/solver';

type SolverOptions = {
  profileEnabled?: boolean;
  bypassEnabled?: boolean;
};

export function useSolvedGeometry(config: RoundaboutConfig, options: SolverOptions = {}) {
  const profileEnabled = options.profileEnabled ?? false;
  const bypassEnabled = options.bypassEnabled ?? false;
  const [segments, setSegments] = useState<ResolvedSegment[]>([]);
  const [errors, setErrors] = useState<string[]>([]);

  useEffect(() => {
    let rafId: number;

    const solve = () => {
      const errs = validateConfig(config);
      let segs: ResolvedSegment[] = [];
      
      try {
        const routes = compileRoutes(config, { profileEnabled, bypassEnabled });
        segs = solveGeometry(config, routes);
      } catch (e) {
        console.error(e);
        errs.push(String(e));
      }
      
      setSegments(segs);
      setErrors(errs);
    };

    // Coalesce solves to animation frames
    rafId = requestAnimationFrame(() => {
      solve();
    });

    return () => cancelAnimationFrame(rafId);
  }, [config, profileEnabled, bypassEnabled]);

  return { segments, errors };
}
