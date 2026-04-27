import React, { useState } from 'react';
import PropTypes from 'prop-types';
import classnames from 'classnames';
import { useDrag } from 'react-dnd';
import { Icons } from '../Icons';
import { DisplaySetMessageListTooltip } from '../DisplaySetMessageListTooltip';
import { TooltipTrigger, TooltipContent, Tooltip } from '../Tooltip';

/**
 * Display a thumbnail for a display set.
 */
const Thumbnail = ({
  displaySetInstanceUID,
  className,
  imageSrc,
  imageAltText,
  description,
  seriesNumber,
  numInstances,
  loadingProgress,
  /** When true, user chose "Preload series" — study panel may show instance download progress. */
  showStudyPanelProgress = false,
  isLayoutLoading = false,
  countIcon,
  messages,
  isActive,
  onClick,
  onDoubleClick,
  thumbnailType,
  modality,
  viewPreset = 'thumbnails',
  isHydratedForDerivedDisplaySet = false,
  isTracked = false,
  canReject = false,
  dragData = {},
  onReject = () => {},
  onClickUntrack = () => {},
  ThumbnailMenuItems = () => {},
  onPrefetchDisplaySet,
  showInstanceLoadProgressUi = true,
}: withAppTypes): React.ReactNode => {
  const normalizedLoadingProgress =
    typeof loadingProgress === 'object' && loadingProgress != null
      ? loadingProgress.loadingProgress
      : loadingProgress;

  const showLoading =
    showInstanceLoadProgressUi &&
    ((normalizedLoadingProgress != null && normalizedLoadingProgress < 1) || isLayoutLoading);

  // Instance count + bar: show only for user-triggered preload (download click).
  const showUserPreloadProgress =
    Boolean(showStudyPanelProgress) &&
    numInstances != null &&
    normalizedLoadingProgress != null &&
    normalizedLoadingProgress < 1;

  // Show preload button when series is not fully downloaded. Thumbnail (first instance) loaded
  // for display does not count as "downloaded" — only full series load does.
  const isFullyLoaded = normalizedLoadingProgress != null && normalizedLoadingProgress >= 1;
  const supportsPreload = modality !== 'SR';
  const showPrefetchButton =
    Boolean(onPrefetchDisplaySet) && supportsPreload && !isFullyLoaded;

  const handlePrefetchClick = e => {
    e.stopPropagation();
    e.preventDefault();
    onPrefetchDisplaySet?.(displaySetInstanceUID);
  };

  const loadedCount =
    numInstances != null && normalizedLoadingProgress != null && normalizedLoadingProgress < 1
      ? Math.round(normalizedLoadingProgress * numInstances) || 0
      : null;
  const loadingPercent =
    normalizedLoadingProgress != null ? Math.round(normalizedLoadingProgress * 100) : null;
  // TODO: We should wrap our thumbnail to create a "DraggableThumbnail", as
  // this will still allow for "drag", even if there is no drop target for the
  // specified item.
  const [collectedProps, drag, dragPreview] = useDrag({
    type: 'displayset',
    item: { ...dragData },
    canDrag: function (monitor) {
      return Object.keys(dragData).length !== 0;
    },
  });

  const [lastTap, setLastTap] = useState(0);

  const handleTouchEnd = e => {
    const currentTime = new Date().getTime();
    const tapLength = currentTime - lastTap;
    if (tapLength < 300 && tapLength > 0) {
      onDoubleClick(e);
    } else {
      onClick(e);
    }
    setLastTap(currentTime);
  };

  const renderThumbnailPreset = () => {
    return (
      <div
        className={classnames(
          'flex h-full w-full flex-col items-center justify-center gap-[2px] p-[4px]',
          isActive && 'bg-primary-light/30 rounded'
        )}
      >
        <div className="h-[114px] w-[128px]">
          <div className="relative bg-black">
            {imageSrc ? (
              <img
                src={imageSrc}
                alt={imageAltText}
                className="h-[114px] w-[128px] rounded object-contain"
                crossOrigin="anonymous"
              />
            ) : (
              <div className="bg-background h-[114px] w-[128px] rounded"></div>
            )}

            {/* bottom left */}
            <div className="absolute bottom-0 left-0 flex h-[14px] items-center gap-[4px] rounded-tr pt-[10px] pb-[10px] pr-[6px] pl-[5px]">
              <div
                className={classnames(
                  'h-[10px] w-[10px] rounded-[2px]',
                  isActive || isHydratedForDerivedDisplaySet ? 'bg-highlight' : 'bg-primary/65',
                  showLoading && 'bg-primary/25'
                )}
              ></div>
              <div className="text-[11px] font-semibold text-white">{modality}</div>
            </div>

            {/* top right */}
            <div className="absolute top-0 right-0 flex items-center gap-[4px]">
              <DisplaySetMessageListTooltip
                messages={messages}
                id={`display-set-tooltip-${displaySetInstanceUID}`}
              />
              {isTracked && (
                <Tooltip>
                  <TooltipTrigger>
                    <div className="group">
                      <Icons.StatusTracking className="text-white h-[15px] w-[15px] group-hover:hidden" />
                      <Icons.Cancel
                        className="text-white hidden h-[15px] w-[15px] group-hover:block"
                        onClick={onClickUntrack}
                      />
                    </div>
                  </TooltipTrigger>
                  <TooltipContent side="right">
                    <div className="flex flex-1 flex-row">
                      <div className="flex-2 flex items-center justify-center pr-4">
                        <Icons.InfoLink className="text-white" />
                      </div>
                      <div className="flex flex-1 flex-col">
                        <span>
                          <span className="text-white">
                            {isTracked ? 'Series is tracked' : 'Series is untracked'}
                          </span>
                        </span>
                      </div>
                    </div>
                  </TooltipContent>
                </Tooltip>
              )}
            </div>
            {/* bottom right */}
            <div className="absolute bottom-0 right-0 flex items-center gap-[4px] p-[4px]">
              <ThumbnailMenuItems
                displaySetInstanceUID={displaySetInstanceUID}
                canReject={canReject}
                onReject={onReject}
              />
            </div>
          </div>
        </div>
        {/* Instance load progress: user preload on the active series only */}
        {showUserPreloadProgress && (
          <div className="flex w-[128px] flex-col gap-[2px] px-1 pb-0.5">
            <div className="text-primary-light flex items-center gap-1 text-[10px] font-medium">
              {loadedCount != null ? (
                <span>
                  {loadedCount}/{numInstances} ({loadingPercent}%)
                </span>
              ) : (
                <span>Loading…</span>
              )}
            </div>
            <div className="bg-primary/20 h-1 w-full overflow-hidden rounded-full">
              <div
                className="bg-primary-light h-full rounded-full transition-[width] duration-200"
                style={{
                  width: `${(normalizedLoadingProgress != null ? normalizedLoadingProgress : 0) * 100}%`,
                }}
              />
            </div>
          </div>
        )}
        <div className="flex h-[52px] w-[128px] flex-col justify-start pt-px">
          <Tooltip>
            <TooltipContent>{description}</TooltipContent>
            <TooltipTrigger>
              <div className="min-h-[18px] w-[128px] overflow-hidden text-ellipsis whitespace-nowrap pb-0.5 pl-1 text-left text-[12px] font-normal leading-4 text-white">
                {description}
              </div>
            </TooltipTrigger>
          </Tooltip>
          <div className="flex h-[12px] items-center gap-[7px] overflow-hidden">
            <div className="text-white pl-1 text-[11px]"> S:{seriesNumber}</div>
            <div className="text-white text-[11px]">
              <div className="flex items-center gap-[4px]">
                {countIcon ? (
                  React.createElement(Icons[countIcon] || Icons.MissingIcon, { className: 'w-3' })
                ) : (
                  <Icons.InfoSeries className="w-3" />
                )}
                <div>{numInstances}</div>
                {showPrefetchButton && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        className="text-white hover:text-primary-light flex h-4 w-4 items-center justify-center rounded outline-none transition-colors hover:bg-primary/30"
                        onClick={handlePrefetchClick}
                        aria-label="Preload series"
                      >
                        <Icons.Download className="h-5 w-5" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="left">
                      <span className="text-white">Preload series</span>
                    </TooltipContent>
                  </Tooltip>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const renderListPreset = () => {
    return (
      <div
        className={classnames(
          'flex w-full flex-col',
          showUserPreloadProgress ? 'min-h-[40px]' : 'h-full'
        )}
      >
        <div
          className={classnames(
            'flex w-full items-center justify-between pr-[8px] pl-[8px] pt-[4px] pb-[4px]',
            !showUserPreloadProgress && 'h-full',
            isActive && 'bg-primary-light/30 rounded'
          )}
        >
        <div className="relative flex h-[32px] w-full items-center gap-[8px] overflow-hidden">
          <div
            className={classnames(
              'h-[32px] w-[4px] min-w-[4px] rounded',
              isActive || isHydratedForDerivedDisplaySet ? 'bg-highlight' : 'bg-primary/65',
              showLoading && 'bg-primary/25'
            )}
          ></div>
          <div className="flex h-full w-[calc(100%-12px)] flex-col justify-start">
            <div className="flex items-center gap-[7px]">
              <div className="text-[13px] font-semibold text-white">{modality}</div>
              <Tooltip>
                <TooltipContent>{description}</TooltipContent>
                <TooltipTrigger className="w-full overflow-hidden">
                  <div className="max-w-[160px] overflow-hidden overflow-ellipsis whitespace-nowrap text-left text-[13px] font-normal text-white">
                    {description}
                  </div>
                </TooltipTrigger>
              </Tooltip>
            </div>

            <div className="flex h-[12px] items-center gap-[7px] overflow-hidden">
              <div className="text-white text-[12px]"> S:{seriesNumber}</div>
              <div className="text-white text-[12px]">
                <div className="flex items-center gap-[4px]">
                  {' '}
                  {countIcon ? (
                    React.createElement(Icons[countIcon] || Icons.MissingIcon, { className: 'w-3' })
                  ) : (
                    <Icons.InfoSeries className="w-3" />
                  )}
                  <div>{numInstances}</div>
                  {showPrefetchButton && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          className="text-white hover:text-primary-light flex h-4 w-4 items-center justify-center rounded outline-none transition-colors hover:bg-primary/30"
                          onClick={handlePrefetchClick}
                          aria-label="Preload series"
                        >
                          <Icons.Download className="h-3 w-3" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="left">
                        <span className="text-white">Preload series</span>
                      </TooltipContent>
                    </Tooltip>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
        <div className="flex h-full items-center gap-[4px]">
          <DisplaySetMessageListTooltip
            messages={messages}
            id={`display-set-tooltip-${displaySetInstanceUID}`}
          />
          {isTracked && (
            <Tooltip>
              <TooltipTrigger>
                <div className="group">
                  <Icons.StatusTracking className="text-white h-[20px] w-[15px] group-hover:hidden" />
                  <Icons.Cancel
                    className="text-white hidden h-[15px] w-[15px] group-hover:block"
                    onClick={onClickUntrack}
                  />
                </div>
              </TooltipTrigger>
              <TooltipContent side="right">
                <div className="flex flex-1 flex-row">
                  <div className="flex-2 flex items-center justify-center pr-4">
                    <Icons.InfoLink className="text-white" />
                  </div>
                  <div className="flex flex-1 flex-col">
                    <span>
                      <span className="text-white">
                        {isTracked ? 'Series is tracked' : 'Series is untracked'}
                      </span>
                    </span>
                  </div>
                </div>
              </TooltipContent>
            </Tooltip>
          )}
          <ThumbnailMenuItems
            displaySetInstanceUID={displaySetInstanceUID}
            canReject={canReject}
            onReject={onReject}
          />
        </div>
        </div>
        {showUserPreloadProgress && (
          <div className="flex w-full flex-col gap-[2px] px-2 pb-1">
            <div className="text-primary-light flex items-center gap-1 text-[10px] font-medium">
              {loadedCount != null ? (
                <span>
                  {loadedCount}/{numInstances} ({loadingPercent}%)
                </span>
              ) : (
                <span>Loading…</span>
              )}
            </div>
            <div className="bg-primary/20 h-1 w-full overflow-hidden rounded-full">
              <div
                className="bg-primary-light h-full rounded-full transition-[width] duration-200"
                style={{
                  width: `${(normalizedLoadingProgress != null ? normalizedLoadingProgress : 0) * 100}%`,
                }}
              />
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div
      className={classnames(
        className,
        'bg-muted hover:bg-primary/30 group flex cursor-pointer select-none flex-col rounded outline-none',
        viewPreset === 'thumbnails' && 'h-[190px] w-[135px]',
        viewPreset === 'list' && 'min-h-[40px] w-full'
      )}
      id={`thumbnail-${displaySetInstanceUID}`}
      data-cy={
        thumbnailType === 'thumbnailNoImage'
          ? 'study-browser-thumbnail-no-image'
          : 'study-browser-thumbnail'
      }
      data-series={seriesNumber}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onTouchEnd={handleTouchEnd}
      role="button"
    >
      <div
        ref={drag}
        className="h-full w-full"
      >
        {viewPreset === 'thumbnails' && renderThumbnailPreset()}
        {viewPreset === 'list' && renderListPreset()}
      </div>
    </div>
  );
};

Thumbnail.propTypes = {
  displaySetInstanceUID: PropTypes.string.isRequired,
  className: PropTypes.string,
  imageSrc: PropTypes.string,
  /**
   * Data the thumbnail should expose to a receiving drop target. Use a matching
   * `dragData.type` to identify which targets can receive this draggable item.
   * If this is not set, drag-n-drop will be disabled for this thumbnail.
   *
   * Ref: https://react-dnd.github.io/react-dnd/docs/api/use-drag#specification-object-members
   */
  dragData: PropTypes.shape({
    /** Must match the "type" a dropTarget expects */
    type: PropTypes.string.isRequired,
  }),
  imageAltText: PropTypes.string,
  description: PropTypes.string.isRequired,
  seriesNumber: PropTypes.any,
  numInstances: PropTypes.number.isRequired,
  loadingProgress: PropTypes.number,
  showStudyPanelProgress: PropTypes.bool,
  /** True when this series is loading in the current advanced layout (e.g. MPR, 3D). */
  isLayoutLoading: PropTypes.bool,
  /** When false, hide the instance load progress bar (study browser still uses loadingProgress for preload state). */
  showInstanceLoadProgressUi: PropTypes.bool,
  messages: PropTypes.object,
  isActive: PropTypes.bool.isRequired,
  onClick: PropTypes.func.isRequired,
  onDoubleClick: PropTypes.func.isRequired,
  viewPreset: PropTypes.string,
  modality: PropTypes.string,
  isHydratedForDerivedDisplaySet: PropTypes.bool,
  isTracked: PropTypes.bool,
  onClickUntrack: PropTypes.func,
  countIcon: PropTypes.string,
  thumbnailType: PropTypes.oneOf(['thumbnail', 'thumbnailTracked', 'thumbnailNoImage']),
  onPrefetchDisplaySet: PropTypes.func,
};

export { Thumbnail };
