import { useCallback, useEffect, useState } from 'react';
import {
  getCineSyncMode,
  setCineSyncMode,
  subscribeCineSyncMode,
  type CineSyncMode,
} from '../utils/cineSyncModeStore';

/**
 * Read/write the study-level cine sync mode and re-render when it changes.
 */
export function useCineSyncMode(): [CineSyncMode, (mode: CineSyncMode) => void] {
  const [mode, setMode] = useState<CineSyncMode>(() => getCineSyncMode());

  useEffect(() => {
    setMode(getCineSyncMode());

    return subscribeCineSyncMode(setMode);
  }, []);

  const updateMode = useCallback((next: CineSyncMode) => setCineSyncMode(next), []);

  return [mode, updateMode];
}
