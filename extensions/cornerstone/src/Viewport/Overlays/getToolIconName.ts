/**
 * Resolves the toolbar icon name for a given active Cornerstone tool.
 * Button id usually matches tool name; falls back to scanning registered buttons.
 */
export function getToolIconName(
  toolName: string | undefined,
  toolbarService: AppTypes.Services['toolbarService']
): string | undefined {
  if (!toolName) {
    return undefined;
  }

  const directButton = toolbarService.getButton(toolName);
  if (directButton?.props?.icon) {
    return directButton.props.icon as string;
  }

  const buttons = toolbarService.getButtons();
  for (const button of Object.values(buttons)) {
    if (!button) {
      continue;
    }

    const buttonToolName = toolbarService.getToolNameForButton(button);
    if (buttonToolName === toolName && button.props?.icon) {
      return button.props.icon as string;
    }
  }

  return undefined;
}
