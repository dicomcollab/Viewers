import React from 'react';
import type { IconProps } from '../types';
import medpacsLogo from '../../../../../../platform/ui/static/medpacs-logo.png';

export const OHIFLogo = (props: IconProps) => {
  const { style, className, ...restProps } = props;
  const imgProps = restProps as unknown as React.ImgHTMLAttributes<HTMLImageElement>;
  return (
    <img
      src={medpacsLogo}
      alt="MedPACS Logo"
      className={className}
      style={{ height: '28px', width: 'auto', ...style }}
      {...imgProps}
    />
  );
};

export default OHIFLogo;
