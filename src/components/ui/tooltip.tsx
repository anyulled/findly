"use client";

import * as React from "react";
import { Tooltip as BaseTooltip } from "@base-ui/react";
import styles from "./tooltip.module.css";

export const TooltipProvider = BaseTooltip.Provider;
export const Tooltip = BaseTooltip.Root;
export const TooltipTrigger = BaseTooltip.Trigger;
export const TooltipPortal = BaseTooltip.Portal;

export interface TooltipContentProps extends React.ComponentProps<typeof BaseTooltip.Popup> {
  sideOffset?: number;
  showArrow?: boolean;
}

export function TooltipContent({
  children,
  className = "",
  sideOffset = 6,
  showArrow = true,
  ...props
}: TooltipContentProps) {
  return (
    <TooltipPortal>
      <BaseTooltip.Positioner className={styles.tooltipPositioner} sideOffset={sideOffset}>
        <BaseTooltip.Popup
          className={[styles.tooltipPopup, className].filter(Boolean).join(" ")}
          {...props}
        >
          {showArrow && <BaseTooltip.Arrow className={styles.tooltipArrow} />}
          {children}
        </BaseTooltip.Popup>
      </BaseTooltip.Positioner>
    </TooltipPortal>
  );
}
