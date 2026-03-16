import React, { useState } from 'react';
import { Switch } from '@ohif/ui-next';
import { useSystem } from '@ohif/core';

export default function SegmentationToolConfig() {
  const { commandsManager } = useSystem();

  // Get initial states based on current configuration
  const [previewEdits, setPreviewEdits] = useState(false);
  const [segmentLabelEnabled, setSegmentLabelEnabled] = useState(false);
  const [toggleSegmentEnabled, setToggleSegmentEnabled] = useState(false);
  const [useCenterAsSegmentIndex, setUseCenterAsSegmentIndex] = useState(false);

  const handlePreviewEditsChange = checked => {
    setPreviewEdits(checked);
    commandsManager.run('toggleSegmentPreviewEdit', { toggle: checked });
  };

  const handleToggleSegmentEnabledChange = checked => {
    setToggleSegmentEnabled(checked);
    commandsManager.run('toggleSegmentSelect', { toggle: checked });
  };

  const handleUseCenterAsSegmentIndexChange = checked => {
    setUseCenterAsSegmentIndex(checked);
    commandsManager.run('toggleUseCenterSegmentIndex', { toggle: checked });
  };

  const handleSegmentLabelEnabledChange = checked => {
    setSegmentLabelEnabled(checked);
    commandsManager.run('toggleSegmentLabel', { enabled: checked });
  };

  return (
    <div className="bg-primary-active/20 flex flex-col gap-2 border-b border-primary-active/40 px-2 py-3">
      <div className="flex items-center gap-2">
        <Switch
          checked={previewEdits}
          onCheckedChange={handlePreviewEditsChange}
        />
        <span className="text-white text-base">Preview edits before creating</span>
      </div>

      <div className="flex items-center gap-2">
        <Switch
          checked={useCenterAsSegmentIndex}
          onCheckedChange={handleUseCenterAsSegmentIndexChange}
        />
        <span className="text-white text-base">Use center as segment index</span>
      </div>

      <div className="flex items-center gap-2">
        <Switch
          checked={toggleSegmentEnabled}
          onCheckedChange={handleToggleSegmentEnabledChange}
        />
        <span className="text-white text-base">Hover on segment border to activate</span>
      </div>

      <div className="flex items-center gap-2">
        <Switch
          checked={segmentLabelEnabled}
          onCheckedChange={handleSegmentLabelEnabledChange}
        />
        <span className="text-white text-base">Show segment name on hover</span>
      </div>
    </div>
  );
}
