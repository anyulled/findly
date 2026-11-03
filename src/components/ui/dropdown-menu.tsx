"use client";

import * as React from "react";
import { Menu as BaseMenu } from "@base-ui/react";
import styles from "./dropdown-menu.module.css";

export const DropdownMenu = BaseMenu.Root;
export const DropdownMenuTrigger = BaseMenu.Trigger;
export const DropdownMenuPortal = BaseMenu.Portal;

export function DropdownMenuContent({
  className = "",
  children,
  sideOffset = 6,
  ...props
}: React.ComponentProps<typeof BaseMenu.Popup> & { sideOffset?: number }) {
  return (
    <BaseMenu.Portal>
      <BaseMenu.Positioner className={styles.menuPositioner} sideOffset={sideOffset}>
        <BaseMenu.Popup
          className={[styles.menuPopup, className].filter(Boolean).join(" ")}
          {...props}
        >
          {children}
        </BaseMenu.Popup>
      </BaseMenu.Positioner>
    </BaseMenu.Portal>
  );
}

export function DropdownMenuItem({
  className = "",
  destructive = false,
  ...props
}: React.ComponentProps<typeof BaseMenu.Item> & { destructive?: boolean }) {
  return (
    <BaseMenu.Item
      className={[
        styles.menuItem,
        destructive ? styles.menuItemDestructive : "",
        className,
      ].filter(Boolean).join(" ")}
      {...props}
    />
  );
}

export function DropdownMenuSeparator({
  className = "",
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={[styles.menuSeparator, className].filter(Boolean).join(" ")} {...props} />;
}
