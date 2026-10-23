import React, { ReactNode, useState } from 'react';
import classNames from 'classnames';
import { ArrowLeft } from 'lucide-react';
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
  /** Phone/tablet PWA layout: compact chrome, no center toolbar, panel toggles. */
  isMobileLayout?: boolean;
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
  isSticky = false,
  WhiteLabeling,
  UndoRedo,
  Secondary,
  isIframeMode = false,
  isMobileLayout = false,
  reportNavigationHref,
  onReportNavigation,
  HeaderActions,
  // Kept for API compatibility; logo no longer navigates on click.
  isReturnEnabled: _isReturnEnabled = true,
  onClickReturnButton: _onClickReturnButton,
  ...props
}: HeaderProps): ReactNode {
  const [reportBusy, setReportBusy] = useState(false);
  const compactChrome = isIframeMode || isMobileLayout;

  return (
    <IconPresentationProvider
      size={compactChrome ? 24 : 'large'}
      IconContainer={ToolButton}
    >
      <NavBar
        isSticky={isSticky}
        className={isMobileLayout ? 'ohif-mobile-header-navbar' : undefined}
        {...props}
      >
        <div
          className={classNames(
            'relative flex items-center overflow-hidden',
            compactChrome ? 'iframe-toolbar-compact h-[44px]' : 'h-[48px]',
            isMobileLayout && 'ohif-mobile-header-bar'
          )}
        >
          {/* Left section: Logo and return button */}
          <div
            className={`bg-primary-main z-10 flex flex-shrink-0 items-center ${compactChrome ? 'gap-0 pr-0.5' : 'gap-1 pr-2'}`}
          >
            <div className={`flex items-center ${compactChrome ? 'gap-1' : 'gap-5'}`}>
              <div
                className="inline-flex items-center"
                data-cy="header-logo"
              >
                <div className={`flex-shrink-0 ${compactChrome ? 'ml-0' : 'ml-1'}`}>
                  {WhiteLabeling?.createLogoComponentFn?.(React, props) || (
                    <div className={compactChrome ? 'origin-left scale-[0.72]' : ''}>
                      <Icons.OHIFLogo />
                    </div>
                  )}
                </div>
              </div>
              {(reportNavigationHref || onReportNavigation) && !isMobileLayout ? (
                <Button
                  type="button"
                  variant="ghost"
                  disabled={reportBusy}
                  data-cy="header-report-ris"
                  className={classNames(
                    'inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-[10px] border border-[rgba(255,255,255,0.15)] bg-[rgba(255,255,255,0.06)] font-medium text-white hover:border-[rgba(255,255,255,0.28)] hover:bg-[rgba(255,255,255,0.12)] hover:text-white',
                    compactChrome ? 'h-8 px-2.5 text-xs' : 'h-9 px-3.5 text-sm'
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
                  <ArrowLeft
                    className="h-4 w-4 shrink-0"
                    strokeWidth={2}
                  />
                  <span>{reportBusy ? '…' : 'Report'}</span>
                </Button>
              ) : null}
            </div>
            {Secondary && (!compactChrome || isMobileLayout) && (
              <div
                className={`flex h-8 min-w-0 flex-shrink items-center ${isMobileLayout ? 'ml-1 max-w-[46vw]' : 'ml-4'}`}
              >
                {Secondary}
              </div>
            )}
          </div>

          {/* Center section: Toolbar with horizontal scroll (hidden on mobile — tools move to bottom bar) */}
          {!isMobileLayout ? (
            <div className="scrollbar-hide min-w-0 flex-1 overflow-x-auto overflow-y-hidden">
              <div
                className={`flex h-full w-full items-center ${compactChrome ? 'justify-center px-2' : 'justify-center px-2'}`}
              >
                <div
                  className={`flex items-center whitespace-nowrap ${compactChrome ? 'justify-center gap-2' : 'justify-center space-x-2'}`}
                >
                  {children}
                </div>
              </div>
            </div>
          ) : (
            <div className="min-w-0 flex-1" />
          )}

          {/* Right section: Undo/Redo, mobile panel toggles, Settings */}
          <div
            className={`bg-primary-main z-10 flex flex-shrink-0 select-none items-center ${compactChrome ? 'gap-0 pl-0.5' : 'pl-2'}`}
          >
            {UndoRedo && !compactChrome}
            {UndoRedo && !compactChrome && (
              <div className="border-primary-dark mx-1.5 h-[25px] border-r"></div>
            )}
            {HeaderActions ? (
              <div
                className={`flex min-w-0 shrink items-center ${
                  isMobileLayout ? 'mr-0.5 max-w-[calc(100vw-88px)]' : compactChrome ? 'mr-0.5' : 'mr-1'
                }`}
              >
                {HeaderActions}
              </div>
            ) : null}
            <div className="flex-shrink-0">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className={`iframe-header-settings-btn hover:bg-primary-active text-white ${compactChrome ? 'h-9 w-9' : 'h-full w-full'}`}
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
