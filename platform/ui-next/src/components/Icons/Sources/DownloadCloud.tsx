import React from 'react';
import type { IconProps } from '../types';

/** Cloud with a downward arrow — used for Download Study (ZIP), distinct from prefetch Download. */
export const DownloadCloud = (props: IconProps) => (
  <svg
    width="24px"
    height="24px"
    viewBox="0 0 24 24"
    version="1.1"
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    {...props}
  >
    <g
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M7.5 18.5h9.25a3.75 3.75 0 0 0 .4-7.48 5.25 5.25 0 0 0-10.05-1.2A3.5 3.5 0 0 0 7.5 18.5z" />
      <path d="M12 11.25v5" />
      <path d="M9.75 14.5 12 16.75 14.25 14.5" />
    </g>
  </svg>
);

export default DownloadCloud;
