import React from 'react';
import PropTypes from 'prop-types';
import classnames from 'classnames';
import { ThumbnailList } from '../ThumbnailList';

import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '../Accordion';
import { Tooltip, TooltipContent, TooltipTrigger } from '../Tooltip';
import { Icons } from '../Icons';

type StudyDownloadProgress = {
  downloaded: number;
  total: number;
  isPrefetching: boolean;
  loadedFrames?: number;
  totalFrames?: number;
};

/** 0..1 share of the study downloaded, by frames when known, else by series. */
function getStudyDownloadFraction(progress?: StudyDownloadProgress): number {
  if (!progress) {
    return 0;
  }
  if (progress.totalFrames > 0) {
    return Math.min(1, (progress.loadedFrames ?? 0) / progress.totalFrames);
  }
  return progress.total > 0 ? Math.min(1, progress.downloaded / progress.total) : 0;
}

const ProgressRing = ({ fraction }: { fraction: number }) => {
  const radius = 7;
  const circumference = 2 * Math.PI * radius;
  return (
    <svg
      className="h-[18px] w-[18px] -rotate-90"
      viewBox="0 0 18 18"
      aria-hidden="true"
    >
      <circle
        cx="9"
        cy="9"
        r={radius}
        fill="none"
        strokeWidth="2.5"
        className="stroke-white/15"
      />
      <circle
        cx="9"
        cy="9"
        r={radius}
        fill="none"
        strokeWidth="2.5"
        strokeLinecap="round"
        className="stroke-primary-light transition-[stroke-dashoffset] duration-300 ease-out"
        strokeDasharray={circumference}
        strokeDashoffset={circumference * (1 - Math.max(0.03, fraction))}
      />
    </svg>
  );
};

const StudyDownloadStatus = ({ progress }: { progress: StudyDownloadProgress }) => {
  const fraction = getStudyDownloadFraction(progress);
  const percent = Math.floor(fraction * 100);
  const detail =
    progress.totalFrames > 0
      ? `${progress.loadedFrames ?? 0}/${progress.totalFrames} frames`
      : `${progress.downloaded}/${progress.total} series`;

  return (
    <div
      className="px-2 pb-1.5 pt-1"
      role="progressbar"
      aria-label="Study download progress"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
    >
      <div className="mb-1 flex items-center justify-between gap-2 text-[11px] leading-none">
        <span className="text-primary-light flex min-w-0 items-center gap-1 truncate">
          <Icons.Download className="h-3.5 w-3.5 shrink-0" />
          Downloading study
        </span>
        <span className="shrink-0 tabular-nums text-white">
          <span className="font-semibold">{percent}%</span>
          <span className="text-white/60"> · {detail}</span>
        </span>
      </div>
      <div className="h-1 overflow-hidden rounded-full bg-white/10">
        <div
          className="from-primary-main to-primary-light h-full rounded-full bg-gradient-to-r transition-[width] duration-300 ease-out"
          style={{ width: `${Math.max(2, fraction * 100)}%` }}
        />
      </div>
    </div>
  );
};

/**
 * Study-level "download all instances" control. A span, not a button: it sits
 * inside the accordion trigger, which is already a <button>.
 */
const StudyPrefetchControl = ({
  progress,
  onPrefetch,
}: {
  progress?: StudyDownloadProgress;
  onPrefetch: () => void;
}) => {
  const total = progress?.total ?? 0;
  const downloaded = progress?.downloaded ?? 0;
  const isComplete = total > 0 && downloaded >= total;
  const isPrefetching = Boolean(progress?.isPrefetching) && !isComplete;

  const handleActivate = (event: React.SyntheticEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (!isComplete && !isPrefetching) {
      onPrefetch();
    }
  };

  const fraction = getStudyDownloadFraction(progress);
  const percent = Math.floor(fraction * 100);
  const label = isComplete
    ? 'All instances downloaded'
    : isPrefetching
      ? `Downloading instances in background (${downloaded}/${total} series, ${percent}%)`
      : 'Download all instances in background';

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          role="button"
          tabIndex={0}
          aria-label={label}
          aria-disabled={isComplete || isPrefetching}
          onClick={handleActivate}
          onPointerDown={event => event.stopPropagation()}
          onKeyDown={event => {
            if (event.key === 'Enter' || event.key === ' ') {
              handleActivate(event);
            }
          }}
          className={classnames(
            'flex h-6 shrink-0 items-center gap-1 rounded px-1 text-[11px] text-white outline-none transition-colors',
            !isComplete &&
              !isPrefetching &&
              'hover:bg-primary/30 hover:text-primary-light cursor-pointer',
            (isComplete || isPrefetching) && 'cursor-default'
          )}
        >
          {isComplete ? (
            <Icons.StatusSuccess className="h-4 w-4" />
          ) : isPrefetching ? (
            <ProgressRing fraction={fraction} />
          ) : (
            <Icons.Download className="h-5 w-5" />
          )}
        </span>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        <span className="text-white">{label}</span>
      </TooltipContent>
    </Tooltip>
  );
};

const StudyItem = ({
  date,
  description,
  numInstances,
  modalities,
  isActive,
  onClick,
  isExpanded,
  displaySets,
  activeDisplaySetInstanceUIDs,
  onClickThumbnail,
  onDoubleClickThumbnail,
  onClickUntrack,
  viewPreset = 'thumbnails',
  ThumbnailMenuItems,
  StudyMenuItems,
  onPrefetchDisplaySet,
  onPrefetchStudy,
  downloadProgress,
  StudyInstanceUID,
}: withAppTypes) => {
  const studyProgress = downloadProgress as StudyDownloadProgress | undefined;
  const itemRef = React.useRef<HTMLDivElement>(null);
  const stickyHeaderRef = React.useRef<HTMLDivElement>(null);

  // Thumbnails read --study-sticky-h as their scroll margin, so scrollIntoView
  // lands a row exactly below the pinned header (its height changes with the progress row).
  React.useLayoutEffect(() => {
    const item = itemRef.current;
    const header = stickyHeaderRef.current;
    if (!item || !header) {
      return;
    }
    const applyHeight = () => {
      item.style.setProperty('--study-sticky-h', `${header.offsetHeight}px`);
    };
    applyHeight();
    if (typeof ResizeObserver === 'undefined') {
      return;
    }
    const observer = new ResizeObserver(applyHeight);
    observer.observe(header);
    return () => observer.disconnect();
  }, []);

  const showStudyDownloadBar =
    Boolean(studyProgress?.isPrefetching) &&
    studyProgress.total > 0 &&
    studyProgress.downloaded < studyProgress.total;

  return (
    <Accordion
      type="single"
      collapsible
      value={isExpanded ? 'study-item' : ''}
      onValueChange={nextValue => {
        if (nextValue === 'study-item' && !isExpanded) {
          onClick();
        }
      }}
    >
      <AccordionItem
        ref={itemRef}
        value="study-item"
        className="min-w-0"
      >
        {/* Pinned while this study's thumbnails scroll, so download progress stays visible. */}
        <div
          ref={stickyHeaderRef}
          className={classnames(
            'bg-bkg-low sticky top-0 z-20',
            showStudyDownloadBar && 'shadow-[0_4px_8px_-4px_rgba(0,0,0,0.6)]'
          )}
        >
          <AccordionTrigger
            className={classnames(
              'hover:bg-primary-active bg-primary-main group w-full min-w-0 overflow-hidden rounded',
              isActive && 'bg-primary-main'
            )}
          >
            <div className="flex h-[40px] w-full min-w-0 flex-row overflow-hidden">
              <div className="flex w-full min-w-0 flex-row items-center justify-between gap-1">
                <div className="flex min-w-0 flex-1 flex-col items-start text-[13px]">
                  <Tooltip>
                    <TooltipContent>{date}</TooltipContent>
                    <TooltipTrigger
                      className="w-full min-w-0"
                      asChild
                    >
                      <div className="h-[18px] w-full min-w-0 overflow-hidden truncate whitespace-nowrap text-left text-white">
                        {date}
                      </div>
                    </TooltipTrigger>
                  </Tooltip>
                  <Tooltip>
                    <TooltipContent>{description}</TooltipContent>
                    <TooltipTrigger
                      className="w-full min-w-0"
                      asChild
                    >
                      <div className="h-[18px] w-full min-w-0 overflow-hidden truncate whitespace-nowrap text-left text-white">
                        {description}
                      </div>
                    </TooltipTrigger>
                  </Tooltip>
                </div>
                <div className="flex max-w-[42%] shrink-0 flex-col items-end pl-1 text-[12px] text-white">
                  <div className="max-w-full overflow-hidden truncate">{modalities}</div>
                  <div>{numInstances}</div>
                </div>
                {onPrefetchStudy && (
                  <StudyPrefetchControl
                    progress={studyProgress}
                    onPrefetch={() => onPrefetchStudy(StudyInstanceUID)}
                  />
                )}
                {StudyMenuItems && (
                  <div className="ml-1 flex shrink-0 items-center">
                    <StudyMenuItems StudyInstanceUID={StudyInstanceUID} />
                  </div>
                )}
              </div>
            </div>
          </AccordionTrigger>
          {showStudyDownloadBar && <StudyDownloadStatus progress={studyProgress} />}
        </div>
        <AccordionContent
          onClick={event => {
            event.stopPropagation();
          }}
        >
          {isExpanded && displaySets && (
            <ThumbnailList
              thumbnails={displaySets}
              activeDisplaySetInstanceUIDs={activeDisplaySetInstanceUIDs}
              onThumbnailClick={onClickThumbnail}
              onThumbnailDoubleClick={onDoubleClickThumbnail}
              onClickUntrack={onClickUntrack}
              viewPreset={viewPreset}
              ThumbnailMenuItems={ThumbnailMenuItems}
              onPrefetchDisplaySet={onPrefetchDisplaySet}
            />
          )}
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
};

StudyItem.propTypes = {
  date: PropTypes.string.isRequired,
  description: PropTypes.string,
  modalities: PropTypes.string.isRequired,
  numInstances: PropTypes.number.isRequired,
  isActive: PropTypes.bool,
  onClick: PropTypes.func.isRequired,
  isExpanded: PropTypes.bool,
  displaySets: PropTypes.array,
  activeDisplaySetInstanceUIDs: PropTypes.array,
  onClickThumbnail: PropTypes.func,
  onDoubleClickThumbnail: PropTypes.func,
  onClickUntrack: PropTypes.func,
  viewPreset: PropTypes.string,
  StudyMenuItems: PropTypes.func,
  onPrefetchDisplaySet: PropTypes.func,
  onPrefetchStudy: PropTypes.func,
  downloadProgress: PropTypes.shape({
    downloaded: PropTypes.number,
    total: PropTypes.number,
    isPrefetching: PropTypes.bool,
  }),
  StudyInstanceUID: PropTypes.string,
};

export { StudyItem };
