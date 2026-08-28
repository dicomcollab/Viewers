import React from 'react';
import PropTypes from 'prop-types';
import classnames from 'classnames';
import { ThumbnailList } from '../ThumbnailList';

import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '../Accordion';
import { Tooltip, TooltipContent, TooltipTrigger } from '../Tooltip';

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
  StudyInstanceUID,
}: withAppTypes) => {
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
        value="study-item"
        className="min-w-0"
      >
        <AccordionTrigger className={classnames('hover:bg-primary-active bg-primary-main group w-full min-w-0 overflow-hidden rounded', isActive && 'bg-primary-main')}>
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
                    <div className="text-white h-[18px] w-full min-w-0 overflow-hidden truncate whitespace-nowrap text-left">
                      {description}
                    </div>
                  </TooltipTrigger>
                </Tooltip>
              </div>
              <div className="text-white flex max-w-[42%] shrink-0 flex-col items-end pl-1 text-[12px]">
                <div className="max-w-full overflow-hidden truncate">{modalities}</div>
                <div>{numInstances}</div>
              </div>
              {StudyMenuItems && (
                <div className="ml-1 flex shrink-0 items-center">
                  <StudyMenuItems StudyInstanceUID={StudyInstanceUID} />
                </div>
              )}
            </div>
          </div>
        </AccordionTrigger>
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
  StudyInstanceUID: PropTypes.string,
};

export { StudyItem };
