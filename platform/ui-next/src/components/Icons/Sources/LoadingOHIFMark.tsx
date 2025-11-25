import React from 'react';
import type { IconProps } from '../types';
import medpacsLogo from '../../../../../../platform/ui/static/medpacs-logo.png';

export const LoadingOHIFMark = (props: IconProps) => {
  const { style, className, ...restProps } = props;
  const imgProps = restProps as unknown as React.ImgHTMLAttributes<HTMLImageElement>;
  return (
    <img
      src={medpacsLogo}
      alt="MedPACS Logo"
      className={className}
      style={{ height: '47px', width: '47px', ...style }}
      {...imgProps}
    />
  );
};

export default LoadingOHIFMark;
