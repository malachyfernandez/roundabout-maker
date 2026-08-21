import { useState, useEffect } from 'react';
import { type RoundaboutConfig } from '../config/types';
import { validateConfig } from '../core/config';
import { compileRoutes } from '../core/routes';
import { solveGeometry, type ResolvedSegment } from '../core/solver';

export function useSolvedGeometry(config: RoundaboutConfig) {
  const [segments, setSegments] = useState<ResolvedSegment[]>([]);
  const [errors, setErrors] = useState<string[]>([]);

  useEffect(() => {
    let rafId: number;

    const solve = () => {
      const errs = validateConfig(config);
      let segs: ResolvedSegment[] = [];
      
      try {
        const routes = compileRoutes(config);
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
  }, [config]);

  return { segments, errors };
}
