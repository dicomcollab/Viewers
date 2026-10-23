import React from 'react';
import type { IconProps } from '../types';

export const ToolKeyImage = (props: IconProps) => (
  <svg
    width="24px"
    height="24px"
    viewBox="0 0 24 24"
    xmlns="http://www.w3.org/2000/svg"
    {...props}
  >
    <path
      d="M12 3.5l2.63 5.33 5.87.85-4.25 4.14 1 5.85L12 16.9l-5.25 2.77 1-5.85L3.5 9.68l5.87-.85L12 3.5z"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinejoin="round"
    ></path>
  </svg>
);

export default ToolKeyImage;
