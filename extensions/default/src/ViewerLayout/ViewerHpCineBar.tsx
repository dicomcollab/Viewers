import React from 'react';
import { Toolbar } from '../Toolbar/Toolbar';

type ViewerHpCineBarProps = {
  servicesManager: AppTypes.ServicesManager;
  isIframeMode?: boolean;
};

/**
 * Secondary strip between the main header and the viewport canvas.
 * Holds hanging-protocol selection (left) and study cine transport (right).
 */
function ViewerHpCineBar({ servicesManager, isIframeMode = false }: ViewerHpCineBarProps) {
  const ViewerHeaderCineControls = servicesManager.services.customizationService.getCustomization(
    'ohif.viewerHeaderCineControls'
  ) as React.ComponentType<{ servicesManager: AppTypes.ServicesManager }> | undefined;

  return (
    <div
      className={`flex w-full shrink-0 items-center justify-between border-b border-white/20 bg-[#111111] ${
        isIframeMode ? 'h-7 px-1' : 'h-8 px-2'
      }`}
      data-cy="viewer-hp-cine-bar"
    >
      <div className="flex min-w-0 items-center gap-1">
        <Toolbar buttonSection="secondary" />
      </div>
      <div className="flex shrink-0 items-center">
        {ViewerHeaderCineControls ? (
          <ViewerHeaderCineControls servicesManager={servicesManager} />
        ) : null}
      </div>
    </div>
  );
}

export default ViewerHpCineBar;
