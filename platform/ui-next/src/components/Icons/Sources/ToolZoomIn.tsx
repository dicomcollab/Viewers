import React from 'react';
import type { IconProps } from '../types';

export const ToolZoomIn = (props: IconProps) => (
  <svg
    width="24px"
    height="24px"
    viewBox="0 0 24 24"
    xmlns="http://www.w3.org/2000/svg"
    {...props}
  >
    <g
      id="ZoomIn"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      fill="none"
    >
      <circle
        cx="10.5"
        cy="10.5"
        r="6.5"
      ></circle>
      <path d="M20 20l-4.6-4.6M10.5 8v5M8 10.5h5"></path>
    </g>
  </svg>
);

export default ToolZoomIn;
