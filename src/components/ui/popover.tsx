"use client";

import * as React from "react";
import { Popover as BasePopover } from "@base-ui/react";
import styles from "./popover.module.css";

export const Popover = BasePopover.Root;
export const PopoverTrigger = BasePopover.Trigger;
export const PopoverPortal = BasePopover.Portal;
export const PopoverClose = BasePopover.Close;

export function PopoverContent({
  className = "",
  children,
  sideOffset = 6,
  showArrow = true,
  ...props
}: React.ComponentProps<typeof BasePopover.Popup> & { sideOffset?: number; showArrow?: boolean }) {
  return (
    <BasePopover.Portal>
      <BasePopover.Positioner className={styles.popoverPositioner} sideOffset={sideOffset}>
        <BasePopover.Popup
          className={[styles.popoverPopup, className].filter(Boolean).join(" ")}
          {...props}
        >
          {showArrow && <BasePopover.Arrow className={styles.popoverArrow} />}
          {children}
        </BasePopover.Popup>
      </BasePopover.Positioner>
    </BasePopover.Portal>
  );
}
