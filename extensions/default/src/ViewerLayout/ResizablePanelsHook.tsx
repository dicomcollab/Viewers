import { useState, useCallback, useLayoutEffect, useRef } from 'react';
import { getPanelElement, getPanelGroupElement } from 'react-resizable-panels';
import { getPanelGroupDefinition } from './constants/panels';

/**
 * Set the minimum and maximum css style width attributes for the given element.
 * The two style attributes are cleared whenever the width
 * argument is undefined.
 * <p>
 * This utility is used as part of a HACK throughout the ViewerLayout component as
 * the means of restricting the side panel widths during the resizing of the
 * browser window. In general, the widths are always set unless the resize
 * handle for either side panel is being dragged (i.e. a side panel is being resized).
 *
 * @param elem the element
 * @param width the max and min width to set on the element
 */
const setMinMaxWidth = (elem, width?) => {
  if (!elem) {
    return;
  }

  elem.style.minWidth = width === undefined ? '' : `${width}px`;
  elem.style.maxWidth = elem.style.minWidth;
};

const useResizablePanels = (
  leftPanelClosed,
  setLeftPanelClosed,
  rightPanelClosed,
  setRightPanelClosed,
  hasLeftPanels,
  hasRightPanels,
  leftPanelInitialExpandedWidth,
  rightPanelInitialExpandedWidth,
  leftPanelMinimumExpandedWidth,
  rightPanelMinimumExpandedWidth
) => {
  const [panelGroupDefinition] = useState(
    getPanelGroupDefinition({
      leftPanelInitialExpandedWidth,
      rightPanelInitialExpandedWidth,
      leftPanelMinimumExpandedWidth,
      rightPanelMinimumExpandedWidth,
    })
  );

  const [leftPanelExpandedWidth, setLeftPanelExpandedWidth] = useState(
    panelGroupDefinition.left.initialExpandedWidth
  );
  const [rightPanelExpandedWidth, setRightPanelExpandedWidth] = useState(
    panelGroupDefinition.right.initialExpandedWidth
  );
  const [leftResizablePanelMinimumSize, setLeftResizablePanelMinimumSize] = useState(0);
  const [rightResizablePanelMinimumSize, setRightResizablePanelMinimumSize] = useState(0);
  const [leftResizablePanelCollapsedSize, setLeftResizePanelCollapsedSize] = useState(0);
  const [rightResizePanelCollapsedSize, setRightResizePanelCollapsedSize] = useState(0);

  const resizablePanelGroupElemRef = useRef(null);
  const resizableLeftPanelElemRef = useRef(null);
  const resizableRightPanelElemRef = useRef(null);
  const resizableLeftPanelAPIRef = useRef(null);
  const resizableRightPanelAPIRef = useRef(null);
  const isResizableHandleDraggingRef = useRef(false);
  const isLeftPanelCollapsingRef = useRef(false);
  const isRightPanelCollapsingRef = useRef(false);
  const lastValidLeftPanelExpandedWidthRef = useRef(panelGroupDefinition.left.initialExpandedWidth);
  const lastValidRightPanelExpandedWidthRef = useRef(panelGroupDefinition.right.initialExpandedWidth);

  // The total width of both handles.
  const resizableHandlesWidth = useRef(null);

  const getMinimumExpandedPixelWidth = sideDef =>
    sideDef.minimumExpandedOffsetWidth - panelGroupDefinition.shared.expandedInsideBorderSize;

  const getCollapsedWidthThreshold = () =>
    panelGroupDefinition.shared.collapsedWidth +
    panelGroupDefinition.shared.collapsedInsideBorderSize +
    panelGroupDefinition.shared.collapsedOutsideBorderSize +
    16;

  const resolveExpandedPixelWidth = (side, widthPx) => {
    const def = side === 'left' ? panelGroupDefinition.left : panelGroupDefinition.right;
    const lastValidRef =
      side === 'left' ? lastValidLeftPanelExpandedWidthRef : lastValidRightPanelExpandedWidthRef;
    const parsed = Number(widthPx);
    const collapsedThreshold = getCollapsedWidthThreshold();
    if (Number.isFinite(parsed) && parsed > collapsedThreshold) {
      return parsed;
    }
    return lastValidRef.current ?? def.initialExpandedWidth;
  };

  const rememberExpandedPixelWidth = (side, widthPx) => {
    if (!Number.isFinite(widthPx) || widthPx <= getCollapsedWidthThreshold()) {
      return;
    }
    if (side === 'left') {
      lastValidLeftPanelExpandedWidthRef.current = widthPx;
      setLeftPanelExpandedWidth(widthPx);
    } else {
      lastValidRightPanelExpandedWidthRef.current = widthPx;
      setRightPanelExpandedWidth(widthPx);
    }
  };

  const refreshPanelSizeConstraints = () => {
    if (!resizablePanelGroupElemRef.current) {
      return;
    }

    const minimumLeftSize = getPercentageSize(panelGroupDefinition.left.minimumExpandedOffsetWidth);
    const minimumRightSize = getPercentageSize(panelGroupDefinition.right.minimumExpandedOffsetWidth);
    const leftCollapsedSize = getPercentageSize(panelGroupDefinition.left.collapsedOffsetWidth);
    const rightCollapsedSize = getPercentageSize(panelGroupDefinition.right.collapsedOffsetWidth);

    if (Number.isFinite(minimumLeftSize)) {
      setLeftResizablePanelMinimumSize(minimumLeftSize);
    }
    if (Number.isFinite(minimumRightSize)) {
      setRightResizablePanelMinimumSize(minimumRightSize);
    }
    if (Number.isFinite(leftCollapsedSize)) {
      setLeftResizePanelCollapsedSize(leftCollapsedSize);
    }
    if (Number.isFinite(rightCollapsedSize)) {
      setRightResizePanelCollapsedSize(rightCollapsedSize);
    }
  };

  const applyExpandedPanelLayout = (side, widthPx) => {
    const api = side === 'left' ? resizableLeftPanelAPIRef.current : resizableRightPanelAPIRef.current;
    const elem = side === 'left' ? resizableLeftPanelElemRef.current : resizableRightPanelElemRef.current;
    if (!api || !elem) {
      return false;
    }

    const expandedWidth = resolveExpandedPixelWidth(side, widthPx);
    rememberExpandedPixelWidth(side, expandedWidth);
    const offsetWidth = expandedWidth + panelGroupDefinition.shared.expandedInsideBorderSize;
    const pct = getPercentageSize(offsetWidth);
    if (!Number.isFinite(pct) || pct <= 0) {
      return false;
    }

    const bounded = Math.min(pct, 90);
    try {
      if (api.isCollapsed?.()) {
        api.expand?.(bounded);
      }
      api.resize?.(bounded);
      setMinMaxWidth(elem, offsetWidth);
      return !api.isCollapsed?.();
    } catch {
      return false;
    }
  };

  const ensureExpandedPanelWidth = side => {
    if (isResizableHandleDraggingRef.current) {
      return;
    }
    const collapsingRef = side === 'left' ? isLeftPanelCollapsingRef : isRightPanelCollapsingRef;
    if (collapsingRef.current) {
      return;
    }

    const api = side === 'left' ? resizableLeftPanelAPIRef.current : resizableRightPanelAPIRef.current;
    const elem = side === 'left' ? resizableLeftPanelElemRef.current : resizableRightPanelElemRef.current;
    if (!api || !elem || api.isCollapsed?.()) {
      return;
    }

    const actualWidth = elem.getBoundingClientRect?.()?.width ?? 0;
    if (actualWidth > getCollapsedWidthThreshold() + 24) {
      return;
    }

    const lastValidRef =
      side === 'left' ? lastValidLeftPanelExpandedWidthRef : lastValidRightPanelExpandedWidthRef;
    applyExpandedPanelLayout(side, lastValidRef.current);
  };

  // This useLayoutEffect is used to...
  // - Grab a reference to the various resizable panel elements needed for
  //   converting between percentages and pixels in various callbacks.
  // - Expand those panels that are initially expanded.
  useLayoutEffect(() => {
    const panelGroupElem = getPanelGroupElement(panelGroupDefinition.groupId);
    resizablePanelGroupElemRef.current = panelGroupElem;

    const leftPanelElem = getPanelElement(panelGroupDefinition.left.panelId);
    resizableLeftPanelElemRef.current = leftPanelElem;

    const rightPanelElem = getPanelElement(panelGroupDefinition.right.panelId);
    resizableRightPanelElemRef.current = rightPanelElem;

    // Calculate and set the width of both handles combined.
    const resizeHandles = document.querySelectorAll('[data-panel-resize-handle-id]');
    resizableHandlesWidth.current = 0;
    resizeHandles.forEach(resizeHandle => {
      resizableHandlesWidth.current += resizeHandle.offsetWidth;
    });

    // Since both resizable panels are collapsed by default (i.e. their default size is zero),
    // on the very first render check if either/both side panels should be expanded.
    // we use the initialExpandedOffsetWidth on the first render incase the panel has min width but we want the initial state to be larger than that

    if (!leftPanelClosed) {
      const leftResizablePanelExpandedSize = getPercentageSize(
        panelGroupDefinition.left.initialExpandedOffsetWidth
      );
      if (Number.isFinite(leftResizablePanelExpandedSize)) {
        resizableLeftPanelAPIRef?.current?.expand(leftResizablePanelExpandedSize);
        setMinMaxWidth(leftPanelElem, panelGroupDefinition.left.initialExpandedOffsetWidth);
      }
    }

    if (!rightPanelClosed) {
      const rightResizablePanelExpandedSize = getPercentageSize(
        panelGroupDefinition.right.initialExpandedOffsetWidth
      );
      if (Number.isFinite(rightResizablePanelExpandedSize)) {
        resizableRightPanelAPIRef?.current?.expand(rightResizablePanelExpandedSize);
        setMinMaxWidth(rightPanelElem, panelGroupDefinition.right.initialExpandedOffsetWidth);
      }
    }

    refreshPanelSizeConstraints();
  }, []); // no dependencies because this useLayoutEffect is only needed on the very first render

  // This useLayoutEffect follows the pattern prescribed by the react-resizable-panels
  // readme for converting between pixel values and percentages. An example of
  // the pattern can be found here:
  // https://github.com/bvaughn/react-resizable-panels/issues/46#issuecomment-1368108416
  // This useLayoutEffect is used to...
  // - Ensure that the percentage size is up-to-date with the pixel sizes
  // - Add a resize observer to the resizable panel group to reset various state
  //   values whenever the resizable panel group is resized (e.g. whenever the
  //   browser window is resized).
  useLayoutEffect(() => {
    // Ensure the side panels' percentage size is in synch with the pixel width of the
    // expanded side panels. In general the two get out-of-sync during a browser
    // window resize. Note that this code is here and NOT in the ResizeObserver
    // because it has to be done AFTER the minimum percentage size for a panel is
    // updated which occurs only AFTER the render following a browser window resize.
    // And by virtue of the dependency on the minimum size state variables, this code
    // is executed on the render following an update of the minimum percentage sizes
    // for a panel.
    if (
      !isResizableHandleDraggingRef.current &&
      !isLeftPanelCollapsingRef.current &&
      !resizableLeftPanelAPIRef.current?.isCollapsed()
    ) {
      const leftSize = getPercentageSize(
        leftPanelExpandedWidth + panelGroupDefinition.shared.expandedInsideBorderSize
      );
      if (Number.isFinite(leftSize) && leftSize > 0) {
        resizableLeftPanelAPIRef.current?.resize(leftSize);
      }
      ensureExpandedPanelWidth('left');
    }

    if (
      !isResizableHandleDraggingRef.current &&
      !isRightPanelCollapsingRef.current &&
      !resizableRightPanelAPIRef?.current?.isCollapsed()
    ) {
      const rightSize = getPercentageSize(
        rightPanelExpandedWidth + panelGroupDefinition.shared.expandedInsideBorderSize
      );
      if (Number.isFinite(rightSize) && rightSize > 0) {
        resizableRightPanelAPIRef?.current?.resize(rightSize);
      }
      ensureExpandedPanelWidth('right');
    }

    // This observer kicks in when the ViewportLayout resizable panel group
    // component is resized. This typically occurs when the browser window resizes.
    const observer = new ResizeObserver(() => {
      refreshPanelSizeConstraints();
    });

    observer.observe(resizablePanelGroupElemRef.current);

    return () => {
      observer.disconnect();
    };
  }, [
    leftPanelExpandedWidth,
    rightPanelExpandedWidth,
    leftResizablePanelMinimumSize,
    rightResizablePanelMinimumSize,
    hasLeftPanels,
    hasRightPanels,
  ]);

  /**
   * Handles dragging of either side panel resize handle.
   */
  const onHandleDragging = useCallback(
    isStartDrag => {
      if (isStartDrag) {
        isResizableHandleDraggingRef.current = true;

        setMinMaxWidth(resizableLeftPanelElemRef.current);
        setMinMaxWidth(resizableRightPanelElemRef.current);
      } else {
        isResizableHandleDraggingRef.current = false;

        if (resizableLeftPanelAPIRef?.current?.isExpanded()) {
          const width = resolveExpandedPixelWidth('left', leftPanelExpandedWidth);
          setMinMaxWidth(
            resizableLeftPanelElemRef.current,
            width + panelGroupDefinition.shared.expandedInsideBorderSize
          );
          ensureExpandedPanelWidth('left');
        }

        if (resizableRightPanelAPIRef?.current?.isExpanded()) {
          const width = resolveExpandedPixelWidth('right', rightPanelExpandedWidth);
          setMinMaxWidth(
            resizableRightPanelElemRef.current,
            width + panelGroupDefinition.shared.expandedInsideBorderSize
          );
          ensureExpandedPanelWidth('right');
        }
      }
    },
    [leftPanelExpandedWidth, rightPanelExpandedWidth]
  );

  const onLeftPanelClose = useCallback(() => {
    isResizableHandleDraggingRef.current = false;
    isLeftPanelCollapsingRef.current = true;
    setLeftPanelExpandedWidth(lastValidLeftPanelExpandedWidthRef.current);
    setLeftPanelClosed(true);
    setMinMaxWidth(resizableLeftPanelElemRef.current);
    resizableLeftPanelAPIRef?.current?.collapse();
  }, [setLeftPanelClosed]);

  const onLeftPanelOpen = useCallback(() => {
    isLeftPanelCollapsingRef.current = false;
    if (applyExpandedPanelLayout('left', leftPanelExpandedWidth)) {
      setLeftPanelClosed(false);
      return;
    }
    window.requestAnimationFrame(() => {
      if (applyExpandedPanelLayout('left', leftPanelExpandedWidth)) {
        setLeftPanelClosed(false);
      }
    });
  }, [setLeftPanelClosed, leftPanelExpandedWidth]);

  const onLeftPanelResize = useCallback(size => {
    if (
      !resizablePanelGroupElemRef?.current ||
      resizableLeftPanelAPIRef.current?.isCollapsed() ||
      isLeftPanelCollapsingRef.current
    ) {
      return;
    }

    const newExpandedWidth = getExpandedPixelWidth(size);
    if (newExpandedWidth <= getCollapsedWidthThreshold()) {
      return;
    }
    if (
      !isResizableHandleDraggingRef.current &&
      newExpandedWidth < getMinimumExpandedPixelWidth(panelGroupDefinition.left)
    ) {
      return;
    }

    rememberExpandedPixelWidth('left', newExpandedWidth);

    if (!isResizableHandleDraggingRef.current) {
      // This typically gets executed when the left panel is expanded via one of the UI
      // buttons. It is done here instead of in the onLeftPanelOpen method
      // because here we know the size of the expanded panel.
      setMinMaxWidth(resizableLeftPanelElemRef.current, newExpandedWidth);
    }
  }, []);

  const onRightPanelClose = useCallback(() => {
    isResizableHandleDraggingRef.current = false;
    isRightPanelCollapsingRef.current = true;
    setRightPanelExpandedWidth(lastValidRightPanelExpandedWidthRef.current);
    setRightPanelClosed(true);
    setMinMaxWidth(resizableRightPanelElemRef.current);
    resizableRightPanelAPIRef?.current?.collapse();
  }, [setRightPanelClosed]);

  const onRightPanelOpen = useCallback(() => {
    isRightPanelCollapsingRef.current = false;
    if (applyExpandedPanelLayout('right', rightPanelExpandedWidth)) {
      setRightPanelClosed(false);
      return;
    }
    window.requestAnimationFrame(() => {
      if (applyExpandedPanelLayout('right', rightPanelExpandedWidth)) {
        setRightPanelClosed(false);
      }
    });
  }, [setRightPanelClosed, rightPanelExpandedWidth]);

  const onRightPanelResize = useCallback(size => {
    if (
      !resizablePanelGroupElemRef?.current ||
      resizableRightPanelAPIRef?.current?.isCollapsed() ||
      isRightPanelCollapsingRef.current
    ) {
      return;
    }

    const newExpandedWidth = getExpandedPixelWidth(size);
    if (newExpandedWidth <= getCollapsedWidthThreshold()) {
      return;
    }
    if (
      !isResizableHandleDraggingRef.current &&
      newExpandedWidth < getMinimumExpandedPixelWidth(panelGroupDefinition.right)
    ) {
      return;
    }

    rememberExpandedPixelWidth('right', newExpandedWidth);

    if (!isResizableHandleDraggingRef.current) {
      // This typically gets executed when the right panel is expanded via one of the UI
      // buttons. It is done here instead of in the onRightPanelOpen method
      // because here we know the size of the expanded panel.
      setMinMaxWidth(resizableRightPanelElemRef.current, newExpandedWidth);
    }
  }, []);

  /**
   * Gets the percentage size corresponding to the given pixel size.
   * Note that the width attributed to the handles must be taken into account.
   */
  const getPercentageSize = pixelSize => {
    const panelGroupWidth = resizablePanelGroupElemRef.current?.getBoundingClientRect?.()?.width;
    const handles = resizableHandlesWidth.current || 0;
    if (!panelGroupWidth || panelGroupWidth <= handles) {
      return NaN;
    }
    return (pixelSize / (panelGroupWidth - handles)) * 100;
  };

  const syncPanelClosed = useCallback((side, closed, widthPx) => {
    const api = side === 'left' ? resizableLeftPanelAPIRef.current : resizableRightPanelAPIRef.current;
    const elem = side === 'left' ? resizableLeftPanelElemRef.current : resizableRightPanelElemRef.current;
    if (!api) {
      return false;
    }
    const targetWidth = resolveExpandedPixelWidth(side, widthPx);
    rememberExpandedPixelWidth(side, targetWidth);
    try {
      if (closed) {
        if (side === 'left') {
          isLeftPanelCollapsingRef.current = true;
        } else {
          isRightPanelCollapsingRef.current = true;
        }
        isResizableHandleDraggingRef.current = false;
        setMinMaxWidth(elem);
        api.collapse?.();
      } else {
        if (side === 'left') {
          isLeftPanelCollapsingRef.current = false;
        } else {
          isRightPanelCollapsingRef.current = false;
        }
        if (!applyExpandedPanelLayout(side, targetWidth)) {
          return false;
        }
      }
      const collapsed = api.isCollapsed?.();
      if (typeof collapsed === 'boolean') {
        return closed ? collapsed : !collapsed;
      }
      return true;
    } catch {
      return false;
    }
  }, []);

  /**
   * Gets the width in pixels for an expanded panel given its percentage size/width.
   * Note that the width attributed to the handles must be taken into account.
   */
  const getExpandedPixelWidth = percentageSize => {
    const { width: panelGroupWidth } = resizablePanelGroupElemRef.current?.getBoundingClientRect();
    const expandedWidth =
      (percentageSize / 100) * (panelGroupWidth - resizableHandlesWidth.current) -
      panelGroupDefinition.shared.expandedInsideBorderSize;
    return expandedWidth;
  };

  return [
    {
      expandedWidth: leftPanelExpandedWidth,
      collapsedWidth: panelGroupDefinition.shared.collapsedWidth,
      collapsedInsideBorderSize: panelGroupDefinition.shared.collapsedInsideBorderSize,
      collapsedOutsideBorderSize: panelGroupDefinition.shared.collapsedOutsideBorderSize,
      expandedInsideBorderSize: panelGroupDefinition.shared.expandedInsideBorderSize,
      onClose: onLeftPanelClose,
      onOpen: onLeftPanelOpen,
    },
    {
      expandedWidth: rightPanelExpandedWidth,
      collapsedWidth: panelGroupDefinition.shared.collapsedWidth,
      collapsedInsideBorderSize: panelGroupDefinition.shared.collapsedInsideBorderSize,
      collapsedOutsideBorderSize: panelGroupDefinition.shared.collapsedOutsideBorderSize,
      expandedInsideBorderSize: panelGroupDefinition.shared.expandedInsideBorderSize,
      onClose: onRightPanelClose,
      onOpen: onRightPanelOpen,
    },
    { direction: 'horizontal', id: panelGroupDefinition.groupId },
    {
      defaultSize: leftResizablePanelMinimumSize,
      minSize: leftResizablePanelMinimumSize,
      onResize: onLeftPanelResize,
      collapsible: true,
      collapsedSize: leftResizablePanelCollapsedSize,
      onCollapse: () => {
        isLeftPanelCollapsingRef.current = false;
        setLeftPanelExpandedWidth(lastValidLeftPanelExpandedWidthRef.current);
        setLeftPanelClosed(true, { persist: false });
      },
      onExpand: () => setLeftPanelClosed(false, { persist: false }),
      ref: resizableLeftPanelAPIRef,
      order: 0,
      id: panelGroupDefinition.left.panelId,
    },
    { order: 1, id: 'viewerLayoutResizableViewportGridPanel' },
    {
      defaultSize: rightResizablePanelMinimumSize,
      minSize: rightResizablePanelMinimumSize,
      onResize: onRightPanelResize,
      collapsible: true,
      collapsedSize: rightResizePanelCollapsedSize,
      onCollapse: () => {
        isRightPanelCollapsingRef.current = false;
        setRightPanelExpandedWidth(lastValidRightPanelExpandedWidthRef.current);
        setRightPanelClosed(true, { persist: false });
      },
      onExpand: () => setRightPanelClosed(false, { persist: false }),
      ref: resizableRightPanelAPIRef,
      order: 2,
      id: panelGroupDefinition.right.panelId,
    },
    onHandleDragging,
    syncPanelClosed,
  ];
};

export default useResizablePanels;
