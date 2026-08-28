import React from 'react';
import { ToggleGroup, ToggleGroupItem } from '@ohif/ui-next';
import { Icons } from '@ohif/ui-next';
import { actionIcon, viewPreset } from './types';

function PanelStudyBrowserHeader({
  viewPresets,
  updateViewPresetValue,
  actionIcons,
  updateActionIconValue,
}: {
  viewPresets: viewPreset[];
  updateViewPresetValue: (viewPreset: viewPreset) => void;
  actionIcons: actionIcon[];
  updateActionIconValue: (actionIcon: actionIcon) => void;
}) {
  // Button order: Settings button then List view mode (thumbnails vs. list)
  return (
    <>
      <div className="bg-primary-main flex h-[40px] min-w-0 select-none overflow-hidden rounded-t p-2">
        <div className="flex h-[24px] w-full min-w-0 select-none items-center self-center text-[14px]">
          <div className="flex w-full min-w-0 items-center gap-[10px]">
            <div className="flex shrink-0 items-center justify-center">
              <div className="text-white flex items-center space-x-1">
                {actionIcons.map((icon: actionIcon, index) =>
                  React.createElement(Icons[icon.iconName] || Icons.MissingIcon, {
                    key: index,
                    onClick: () => updateActionIconValue(icon),
                    className: `cursor-pointer`,
                  })
                )}
              </div>
            </div>
            <div className="ml-auto flex h-full min-w-0 items-center justify-center overflow-hidden">
              <ToggleGroup
                type="single"
                value={viewPresets.filter(preset => preset.selected)[0].id}
                onValueChange={value => {
                  const selectedViewPreset = viewPresets.find(preset => preset.id === value);
                  updateViewPresetValue(selectedViewPreset);
                }}
                className="bg-black/30 border border-white/20"
              >
                {viewPresets.map((viewPreset: viewPreset, index) => (
                  <ToggleGroupItem
                    key={index}
                    aria-label={viewPreset.id}
                    value={viewPreset.id}
                    className="text-white hover:bg-white/20 hover:text-white data-[state=on]:bg-white/30 data-[state=on]:text-white"
                  >
                    {React.createElement(Icons[viewPreset.iconName] || Icons.MissingIcon)}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

export { PanelStudyBrowserHeader };
