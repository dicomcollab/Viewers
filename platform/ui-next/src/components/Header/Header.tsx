import React, { ReactNode, useState } from 'react';
import classNames from 'classnames';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  Icons,
  Button,
  ToolButton,
} from '../';
import { IconPresentationProvider, useIconPresentation } from '../../contextProviders';

import NavBar from '../NavBar';

/** Settings gear must read icon size from IconPresentationProvider (same as toolbar ToolButtons). */
function HeaderSettingsGearIcon() {
  const { className } = useIconPresentation();
  return <Icons.GearSettings className={className} />;
}

// Todo: we should move this component to composition and remove props base

interface HeaderProps {
  children?: ReactNode;
  menuOptions: Array<{
    title: string;
    icon?: string;
    onClick: () => void;
  }>;
  isReturnEnabled?: boolean;
  onClickReturnButton?: () => void;
  isSticky?: boolean;
  WhiteLabeling?: {
    createLogoComponentFn?: (React: any, props: any) => ReactNode;
  };
  Secondary?: ReactNode;
  UndoRedo?: ReactNode;
  isIframeMode?: boolean;
  /** When set, shows “← Report” after the logo; full navigation to RIS/Synapse. */
  reportNavigationHref?: string;
  /** When set (e.g. RIS viewDicomImg), called on click instead of navigating to reportNavigationHref. */
  onReportNavigation?: () => void | Promise<void>;
  /** Optional controls rendered beside the settings menu (e.g. study cine transport). */
  HeaderActions?: ReactNode;
}

function Header({
  children,
  menuOptions,
  isReturnEnabled = true,
  onClickReturnButton,
  isSticky = false,
  WhiteLabeling,
  UndoRedo,
  Secondary,
  isIframeMode = false,
  reportNavigationHref,
  onReportNavigation,
  HeaderActions,
  ...props
}: HeaderProps): ReactNode {
  const [reportBusy, setReportBusy] = useState(false);

  const onClickReturn = () => {
    if (isReturnEnabled && onClickReturnButton) {
      onClickReturnButton();
    }
  };

  return (
    <IconPresentationProvider
      size={isIframeMode ? 30 : 'large'}
      IconContainer={ToolButton}
    >
      <NavBar
        isSticky={isSticky}
        {...props}
      >
        <div
          className={`relative flex items-center overflow-hidden ${isIframeMode ? 'h-[44px] iframe-toolbar-compact' : 'h-[48px]'}`}
        >
          {/* Left section: Logo and return button */}
          <div className={`flex-shrink-0 flex items-center gap-1 z-10 bg-primary-main ${isIframeMode ? 'pr-1' : 'pr-2'}`}>
            <div className="flex items-center gap-5">
              <div
                className={classNames(
                  'inline-flex items-center',
                  isReturnEnabled && 'cursor-pointer'
                )}
                onClick={onClickReturn}
                data-cy="return-to-work-list"
              >
                <div className={`flex-shrink-0 ${isIframeMode ? 'ml-0.5' : 'ml-1'}`}>
                  {WhiteLabeling?.createLogoComponentFn?.(React, props) ||
                    <div className={isIframeMode ? 'scale-[0.88] origin-left' : ''}>
                      <Icons.OHIFLogo />
                    </div>
                  }
                </div>
              </div>
              {reportNavigationHref || onReportNavigation ? (
                <Button
                  type="button"
                  variant="ghost"
                  disabled={reportBusy}
                  data-cy="header-report-ris"
                  className={classNames(
                    'shrink-0 whitespace-nowrap px-2 font-medium bg-[#00000080] rounded-md text-white',
                    isIframeMode ? 'h-8 text-xs' : 'h-9 text-sm'
                  )}
                  onClick={async () => {
                    if (onReportNavigation) {
                      try {
                        setReportBusy(true);
                        await onReportNavigation();
                      } finally {
                        setReportBusy(false);
                      }
                    } else if (reportNavigationHref) {
                      window.location.assign(reportNavigationHref);
                    }
                  }}
                >
                  {reportBusy ? '…' : '← Report'}
                </Button>
              ) : null}
            </div>
            {Secondary && !isIframeMode && (
              <div className="ml-4 h-8 flex items-center flex-shrink-0">{Secondary}</div>
            )}
          </div>

          {/* Center section: Toolbar with horizontal scroll */}
          <div className="flex-1 min-w-0 overflow-x-auto overflow-y-hidden scrollbar-hide">
            <div className={`flex items-center justify-center h-full ${isIframeMode ? 'px-1' : 'px-2'}`}>
              <div className={`flex items-center justify-center whitespace-nowrap ${isIframeMode ? 'space-x-1' : 'space-x-2'}`}>
                {children}
              </div>
            </div>
          </div>

          {/* Right section: Undo/Redo and Settings */}
          <div className={`flex-shrink-0 flex items-center select-none z-10 bg-primary-main ${isIframeMode ? 'pl-1' : 'pl-2'}`}>
            {UndoRedo && !isIframeMode}
            {UndoRedo && !isIframeMode && <div className="border-primary-dark mx-1.5 h-[25px] border-r"></div>}
            {HeaderActions && !isIframeMode ? (
              <div className="mr-1 flex shrink-0 items-center">{HeaderActions}</div>
            ) : null}
            <div className="flex-shrink-0">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className={`text-white hover:bg-primary-active h-full w-full ${isIframeMode ? 'scale-100' : ''}`}
                  >
                    <HeaderSettingsGearIcon />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {menuOptions.map((option, index) => {
                    const IconComponent = option.icon
                      ? Icons[option.icon as keyof typeof Icons]
                      : null;
                    return (
                      <DropdownMenuItem
                        key={index}
                        onSelect={option.onClick}
                        className="flex items-center gap-2 py-2"
                      >
                        {IconComponent && (
                          <span className="flex h-4 w-4 items-center justify-center">
                            <Icons.ByName name={option.icon} />
                          </span>
                        )}
                        <span className="flex-1">{option.title}</span>
                      </DropdownMenuItem>
                    );
                  })}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </div>
      </NavBar>
    </IconPresentationProvider>
  );
}

export default Header;
