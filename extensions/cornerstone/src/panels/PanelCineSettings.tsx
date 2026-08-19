import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Icons, Numeric, PanelSection, useCine } from '@ohif/ui-next';
import { getCineDisplaySetFromViewport } from '../utils/cineSyncUtils';
import { getUsCineCapableLayoutViewportIds } from '../utils/usGridViewportUtils';
import {
  applyCineFrameRate,
  applyCineSettingsToAllViewports,
} from '../utils/usCinePlaybackUtils';
import { getCinePreferences } from '../utils/cinePreferencesUtils';
import { DEFAULT_US_FRAME_STEP, US_CINE_DEFAULT_FPS } from '../utils/usStackCineUtils';

export const CINE_SETTINGS_PANEL_ID = '@ohif/extension-cornerstone.panelModule.panelCineSettings';

const FPS_MIN = 1;
const FPS_MAX = 90;
const FPS_PRESETS = [10, 15, 20, 25, 30, 60];
const STEP_MIN = 1;
const STEP_MAX = 99;

type CineViewportRow = {
  viewportId: string;
  position: number;
  label: string;
  numFrames: number;
};

function clampFps(value: number): number {
  return Math.max(FPS_MIN, Math.min(FPS_MAX, Math.round(value)));
}

function PanelCineSettings({ servicesManager }: withAppTypes) {
  const { viewportGridService, displaySetService } = servicesManager.services;
  const [{ cines }] = useCine();
  const [rows, setRows] = useState<CineViewportRow[]>([]);
  const [activeViewportId, setActiveViewportId] = useState<string | null>(
    () => viewportGridService.getState().activeViewportId ?? null
  );
  const cinePreferences = useMemo(() => getCinePreferences(), []);

  const refreshRows = useCallback(() => {
    const { viewports } = viewportGridService.getState();

    setRows(
      getUsCineCapableLayoutViewportIds(servicesManager).map((viewportId, index) => {
        const viewportState = viewports.get(viewportId);
        const displaySet = getCineDisplaySetFromViewport(displaySetService, viewportState);
        const seriesLabel =
          displaySet?.SeriesDescription ||
          (displaySet?.SeriesNumber != null ? `Series ${displaySet.SeriesNumber}` : null) ||
          displaySet?.Modality ||
          'Series';

        return {
          viewportId,
          position: index + 1,
          label: seriesLabel,
          numFrames: displaySet?.numImageFrames ?? 0,
        };
      })
    );
  }, [displaySetService, servicesManager, viewportGridService]);

  useEffect(() => {
    refreshRows();

    const gridSub = viewportGridService.subscribe(
      viewportGridService.EVENTS.GRID_STATE_CHANGED,
      refreshRows
    );
    const activeSub = viewportGridService.subscribe(
      viewportGridService.EVENTS.ACTIVE_VIEWPORT_ID_CHANGED,
      ({ viewportId }) => setActiveViewportId(viewportId)
    );
    const displaySetSub = displaySetService.subscribe(
      displaySetService.EVENTS.DISPLAY_SETS_CHANGED,
      refreshRows
    );

    return () => {
      gridSub.unsubscribe();
      activeSub.unsubscribe();
      displaySetSub.unsubscribe();
    };
  }, [displaySetService, refreshRows, viewportGridService]);

  const targetViewportId =
    activeViewportId && rows.some(row => row.viewportId === activeViewportId)
      ? activeViewportId
      : (rows[0]?.viewportId ?? null);
  const targetRow = rows.find(row => row.viewportId === targetViewportId) ?? null;
  const targetCine = targetViewportId ? cines?.[targetViewportId] : null;
  const frameRate = clampFps(targetCine?.frameRate ?? US_CINE_DEFAULT_FPS);
  const frameStep = targetCine?.frameStep ?? DEFAULT_US_FRAME_STEP;

  const handleFrameRateChange = useCallback(
    (nextFrameRate: number) => {
      if (!targetViewportId) {
        return;
      }

      applyCineFrameRate(servicesManager, targetViewportId, clampFps(nextFrameRate));
    },
    [servicesManager, targetViewportId]
  );

  if (!rows.length) {
    return (
      <PanelSection defaultOpen={true}>
        <PanelSection.Header>Frame Rate</PanelSection.Header>
        <PanelSection.Content className="bg-muted py-2">
          <div className="text-muted-foreground px-2 py-2 text-center text-sm">
            No multi-frame series in the current layout.
          </div>
        </PanelSection.Content>
      </PanelSection>
    );
  }

  return (
    <div
      className="flex flex-col"
      data-cy="panel-cine-settings"
    >
      <PanelSection defaultOpen={true}>
        <PanelSection.Header>Frame Rate</PanelSection.Header>
        <PanelSection.Content className="bg-muted space-y-2 px-2 py-2">
          <div className="text-muted-foreground flex items-center justify-between text-xs">
            <span className="truncate">
              {targetRow ? `${targetRow.position}. ${targetRow.label}` : 'Active viewport'}
            </span>
            <span className="text-foreground shrink-0 font-semibold tabular-nums">
              {frameRate} FPS
            </span>
          </div>

          <Numeric.Container
            mode="singleRange"
            min={FPS_MIN}
            max={FPS_MAX}
            step={1}
            value={frameRate}
            onChange={val => handleFrameRateChange(val as number)}
          >
            <Numeric.SingleRange
              showNumberInput={false}
              sliderClassName="w-full cursor-pointer"
            />
          </Numeric.Container>

          <div className="flex items-center justify-between gap-2">
            <div className="border-secondary-dark flex shrink-0 items-center gap-1 rounded border px-1 py-0.5">
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 shrink-0 p-0 [&_svg]:h-3 [&_svg]:w-3"
                onClick={() => handleFrameRateChange(frameRate - 1)}
                disabled={frameRate <= FPS_MIN}
                title="Decrease FPS"
                data-cy="cine-settings-fps-decrease"
              >
                <Icons.Minus />
              </Button>
              <span className="text-foreground w-8 text-center text-xs font-semibold tabular-nums">
                {frameRate}
              </span>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 shrink-0 p-0 [&_svg]:h-3 [&_svg]:w-3"
                onClick={() => handleFrameRateChange(frameRate + 1)}
                disabled={frameRate >= FPS_MAX}
                title="Increase FPS"
                data-cy="cine-settings-fps-increase"
              >
                <Icons.Plus />
              </Button>
              <span className="text-muted-foreground pr-0.5 text-[10px]">FPS</span>
            </div>

            <Button
              variant="secondary"
              size="sm"
              className="shrink-0 text-xs"
              onClick={() =>
                applyCineSettingsToAllViewports(servicesManager, {
                  frameRate,
                  cinePlayMode: 'fps',
                })
              }
              disabled={rows.length < 2}
              title="Use this frame rate in every cine viewport"
              data-cy="cine-settings-apply-fps-all"
            >
              Apply to all
            </Button>
          </div>

          <div className="flex flex-wrap gap-1">
            {FPS_PRESETS.map(preset => (
              <Button
                key={preset}
                variant={preset === frameRate ? 'default' : 'secondary'}
                size="sm"
                className="h-6 px-2 text-[11px]"
                onClick={() => handleFrameRateChange(preset)}
                data-cy={`cine-settings-fps-preset-${preset}`}
              >
                {preset}
              </Button>
            ))}
          </div>

          {cinePreferences.showFr ? (
            <div className="border-secondary-dark flex items-center justify-between gap-2 border-t pt-2">
              <span className="text-muted-foreground text-xs">Frame step</span>
              <Numeric.Container
                mode="stepper"
                min={STEP_MIN}
                max={STEP_MAX}
                step={1}
                value={frameStep}
                onChange={val =>
                  applyCineSettingsToAllViewports(servicesManager, {
                    frameStep: Math.max(STEP_MIN, Math.min(STEP_MAX, Math.round(val as number))),
                    cinePlayMode: 'step',
                  })
                }
              >
                <Numeric.NumberStepper
                  direction="horizontal"
                  inputWidth="min-w-12 w-12"
                >
                  <span className="text-muted-foreground text-[10px]">fr</span>
                </Numeric.NumberStepper>
              </Numeric.Container>
            </div>
          ) : null}
        </PanelSection.Content>
      </PanelSection>

      <PanelSection defaultOpen={true}>
        <PanelSection.Header>Viewports</PanelSection.Header>
        <PanelSection.Content className="bg-muted space-y-1 px-2 py-2">
          {rows.map(row => {
            const rowFrameRate = clampFps(cines?.[row.viewportId]?.frameRate ?? US_CINE_DEFAULT_FPS);
            const isTarget = row.viewportId === targetViewportId;

            return (
              <div
                key={row.viewportId}
                className={`flex items-center gap-1 rounded px-1.5 py-1 ${
                  isTarget ? 'bg-primary/20' : 'hover:bg-primary-dark'
                }`}
                data-cy={`cine-settings-viewport-${row.viewportId}`}
              >
                <button
                  type="button"
                  className="min-w-0 flex-1 text-left"
                  onClick={() => viewportGridService.setActiveViewportId(row.viewportId)}
                  title="Make this the active viewport"
                >
                  <span className="text-foreground block truncate text-xs">
                    {row.position}. {row.label}
                  </span>
                  <span className="text-muted-foreground block text-[10px]">
                    {row.numFrames > 0 ? `${row.numFrames} frames` : 'Multi-frame'} · {rowFrameRate}{' '}
                    FPS
                  </span>
                </button>

                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 shrink-0 p-0 [&_svg]:h-3 [&_svg]:w-3"
                  onClick={() =>
                    applyCineFrameRate(servicesManager, row.viewportId, clampFps(rowFrameRate - 1))
                  }
                  title="Decrease FPS"
                >
                  <Icons.Minus />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 shrink-0 p-0 [&_svg]:h-3 [&_svg]:w-3"
                  onClick={() =>
                    applyCineFrameRate(servicesManager, row.viewportId, clampFps(rowFrameRate + 1))
                  }
                  title="Increase FPS"
                >
                  <Icons.Plus />
                </Button>
              </div>
            );
          })}
        </PanelSection.Content>
      </PanelSection>
    </div>
  );
}

export default PanelCineSettings;
