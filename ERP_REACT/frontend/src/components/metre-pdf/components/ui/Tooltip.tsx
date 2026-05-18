import React, { useState, useRef, useCallback } from 'react';

type TooltipSide = 'top' | 'right' | 'bottom' | 'left';

interface TooltipProps {
  content: string;
  side?: TooltipSide;
  /** Delay in ms before showing. */
  delay?: number;
  children: React.ReactElement;
}

const sideStyles: Record<TooltipSide, string> = {
  top: 'bottom-full left-1/2 -translate-x-1/2 mb-2',
  bottom: 'top-full left-1/2 -translate-x-1/2 mt-2',
  left: 'right-full top-1/2 -translate-y-1/2 mr-2',
  right: 'left-full top-1/2 -translate-y-1/2 ml-2',
};

export const Tooltip: React.FC<TooltipProps> = ({
  content,
  side = 'top',
  delay = 400,
  children,
}) => {
  const [visible, setVisible] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();

  const show = useCallback(() => {
    timerRef.current = setTimeout(() => setVisible(true), delay);
  }, [delay]);

  const hide = useCallback(() => {
    clearTimeout(timerRef.current);
    setVisible(false);
  }, []);

  return (
    <div className="relative inline-flex" onMouseEnter={show} onMouseLeave={hide}>
      {children}
      {visible && (
        <div
          className={`pointer-events-none absolute z-50 whitespace-nowrap rounded-md bg-slate-50 dark:bg-neutral-800 px-2.5 py-1.5 text-xs font-medium text-slate-700 dark:text-neutral-200 shadow-lg ${sideStyles[side]}`}
          role="tooltip"
        >
          {content}
        </div>
      )}
    </div>
  );
};
