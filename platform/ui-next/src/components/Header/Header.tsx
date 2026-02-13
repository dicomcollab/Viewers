import React, { ReactNode } from 'react';
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
import { IconPresentationProvider } from '@ohif/ui-next';

import NavBar from '../NavBar';

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
  ...props
}: HeaderProps): ReactNode {
  const onClickReturn = () => {
    if (isReturnEnabled && onClickReturnButton) {
      onClickReturnButton();
    }
  };

  return (
    <IconPresentationProvider
      size="large"
      IconContainer={ToolButton}
    >
      <NavBar
        isSticky={isSticky}
        {...props}
      >
        <div className={`relative ${isIframeMode ? 'h-[36px]' : 'h-[48px]'} flex items-center overflow-hidden ${isIframeMode ? 'iframe-toolbar-compact' : ''}`}>
          {/* Left section: Logo and return button */}
          <div className={`flex-shrink-0 flex items-center z-10 bg-primary-main ${isIframeMode ? 'pr-1' : 'pr-2'}`}>
            <div
              className={classNames(
                'inline-flex items-center',
                isReturnEnabled && 'cursor-pointer'
              )}
              onClick={onClickReturn}
              data-cy="return-to-work-list"
            >
              {/* {isReturnEnabled && <Icons.ArrowLeft className={`text-white ml-1 flex-shrink-0 ${isIframeMode ? 'h-5 w-5' : 'h-7 w-7'}`} />} */}
              <div className={`flex-shrink-0 ${isIframeMode ? 'ml-0.5' : 'ml-1'}`}>
                {WhiteLabeling?.createLogoComponentFn?.(React, props) ||
                  <div className={isIframeMode ? 'scale-75 origin-left' : ''}>
                    <Icons.OHIFLogo />
                  </div>
                }
              </div>
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
            <div className="flex-shrink-0">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className={`text-white hover:bg-primary-active h-full w-full ${isIframeMode ? 'scale-90' : ''}`}
                  >
                    <Icons.GearSettings />
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
