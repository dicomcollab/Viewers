import * as React from 'react';
import * as SliderPrimitive from '@radix-ui/react-slider';

import { cn } from '../../lib/utils';

interface SliderProps extends React.ComponentPropsWithoutRef<typeof SliderPrimitive.Root> {
  variant?: 'primary' | 'white';
}

const Slider = React.forwardRef<
  React.ElementRef<typeof SliderPrimitive.Root>,
  SliderProps
>(({ className, variant = 'primary', ...props }, ref) => {
  const trackClass = variant === 'white'
    ? 'bg-white/30 relative h-1 w-full grow overflow-hidden rounded-full'
    : 'bg-primary/30 relative h-1 w-full grow overflow-hidden rounded-full';

  const rangeClass = variant === 'white'
    ? 'bg-white absolute h-full'
    : 'bg-primary absolute h-full';

  const thumbClass = variant === 'white'
    ? 'border-background bg-white focus-visible:ring-ring block h-4 w-4 rounded-full border-2 shadow transition-colors focus-visible:outline-none focus-visible:ring-1 disabled:pointer-events-none disabled:opacity-50'
    : 'border-background bg-primary focus-visible:ring-ring block h-4 w-4 rounded-full border-2 shadow transition-colors focus-visible:outline-none focus-visible:ring-1 disabled:pointer-events-none disabled:opacity-50';

  return (
    <SliderPrimitive.Root
      ref={ref}
      className={cn('relative flex w-full touch-none select-none items-center', className)}
      {...props}
    >
      <SliderPrimitive.Track className={trackClass}>
        <SliderPrimitive.Range className={rangeClass} />
      </SliderPrimitive.Track>
      <SliderPrimitive.Thumb className={thumbClass} />
    </SliderPrimitive.Root>
  );
});
Slider.displayName = SliderPrimitive.Root.displayName;

export { Slider };
