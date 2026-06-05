import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
} from 'react';

const DEFAULT_STATE = {
  isCineEnabled: false,
  cines: {
    /*
     * viewportId: { isPlaying: false, frameRate: 24 };
     */
  },
};

const DEFAULT_CINE = {
  isPlaying: false,
  frameRate: 24,
  cinePlayMode: 'step' as 'fps' | 'step',
  frameStep: 4,
};

export const CineContext = createContext(null);

function safeGetSyncedViewports(service, viewportId) {
  try {
    if (typeof service?.getSyncedViewports !== 'function') {
      return [];
    }

    return service.getSyncedViewports(viewportId) ?? [];
  } catch (error) {
    if (
      typeof window !== 'undefined' &&
      (window as Window & { OHIF_DEBUG_CINE?: boolean }).OHIF_DEBUG_CINE
    ) {
      console.warn('[OHIF Cine][CineProvider] getSyncedViewports failed', { viewportId, error });
    }

    return [];
  }
}

export default function CineProvider({ children, service }) {
  const reducer = (state, action) => {
    switch (action.type) {
      case 'SET_CINE': {
        const {
          id,
          frameRate,
          isPlaying = undefined,
          cinePlayMode = undefined,
          frameStep = undefined,
        } = action.payload;
        const cines = { ...state.cines };

        const syncedCineIds = safeGetSyncedViewports(service, id).map(
          ({ viewportId }) => viewportId
        );
        const cineIdsToUpdate = [id, ...syncedCineIds].filter(curId => {
          const currentCine = cines[curId] ?? {};
          const nextFrameRate = frameRate ?? currentCine.frameRate;
          const nextIsPlaying = isPlaying ?? currentCine.isPlaying;
          const nextCinePlayMode = cinePlayMode ?? currentCine.cinePlayMode;
          const nextFrameStep = frameStep ?? currentCine.frameStep;
          const shouldUpdateFrameRate = currentCine.frameRate !== nextFrameRate;
          const shouldUpdateIsPlaying = currentCine.isPlaying !== nextIsPlaying;
          const shouldUpdatePlayMode = currentCine.cinePlayMode !== nextCinePlayMode;
          const shouldUpdateFrameStep = currentCine.frameStep !== nextFrameStep;

          return (
            shouldUpdateFrameRate ||
            shouldUpdateIsPlaying ||
            shouldUpdatePlayMode ||
            shouldUpdateFrameStep
          );
        });

        if (
          typeof window !== 'undefined' &&
          (window as Window & { OHIF_DEBUG_CINE?: boolean }).OHIF_DEBUG_CINE
        ) {
          console.log('[OHIF Cine][CineProvider] SET_CINE', {
            id,
            frameRate,
            isPlaying,
            syncedCineIds,
            cineIdsToUpdate,
          });
        }

        if (!cineIdsToUpdate.length) {
          return state;
        }

        cineIdsToUpdate.forEach(currId => {
          const currentCine = cines[currId] ?? { ...DEFAULT_CINE };

          cines[currId] = {
            ...currentCine,
            frameRate: frameRate ?? currentCine.frameRate,
            isPlaying: isPlaying ?? currentCine.isPlaying,
            cinePlayMode: cinePlayMode ?? currentCine.cinePlayMode,
            frameStep: frameStep ?? currentCine.frameStep,
          };
        });

        return { ...state, cines };
      }
      case 'SET_IS_CINE_ENABLED': {
        if (
          typeof window !== 'undefined' &&
          (window as Window & { OHIF_DEBUG_CINE?: boolean }).OHIF_DEBUG_CINE
        ) {
          console.log('[OHIF Cine][CineProvider] SET_IS_CINE_ENABLED', action.payload);
        }

        return { ...state, isCineEnabled: action.payload };
      }
      default:
        return action.payload;
    }
  };

  const [state, dispatch] = useReducer(reducer, DEFAULT_STATE);
  const stateRef = useRef(state);
  stateRef.current = state;

  const getState = useCallback(() => stateRef.current, []);

  const setIsCineEnabled = useCallback(
    isCineEnabled => dispatch({ type: 'SET_IS_CINE_ENABLED', payload: isCineEnabled }),
    [dispatch]
  );

  const setCine = useCallback(
    ({ id, frameRate, isPlaying, cinePlayMode, frameStep }) =>
      dispatch({
        type: 'SET_CINE',
        payload: {
          id,
          frameRate,
          isPlaying,
          cinePlayMode,
          frameStep,
        },
      }),
    [dispatch]
  );

  useEffect(() => {
    if (service) {
      service.setServiceImplementation({ getState, setIsCineEnabled, setCine });
    }
  }, [getState, service, setCine, setIsCineEnabled]);

  const api = useMemo(
    () => ({
      getState,
      setCine,
      setIsCineEnabled: isCineEnabled => service.setIsCineEnabled(isCineEnabled),
      playClip: (element, playClipOptions) => service.playClip(element, playClipOptions),
      stopClip: (element, stopClipOptions) => service.stopClip(element, stopClipOptions),
      setViewportCineClosed: viewportId => service.setViewportCineClosed(viewportId),
      clearViewportCineClosed: viewportId => service.clearViewportCineClosed(viewportId),
      isViewportCineClosed: viewportId => service.isViewportCineClosed(viewportId),
    }),
    [service, setCine]
  );

  return <CineContext.Provider value={[state, api]}>{children}</CineContext.Provider>;
}

export const useCine = () => useContext(CineContext);
