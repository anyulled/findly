"use client";

import * as React from "react";
import { Select as BaseSelect } from "@base-ui/react";
import styles from "./select.module.css";

export const Select = BaseSelect.Root;
export const SelectPortal = BaseSelect.Portal;
export const SelectItemText = BaseSelect.ItemText;

export function SelectTrigger({
  className = "",
  children,
  ...props
}: React.ComponentProps<typeof BaseSelect.Trigger>) {
  return (
    <BaseSelect.Trigger
      className={[styles.selectTrigger, className].filter(Boolean).join(" ")}
      {...props}
    >
      {children}
      <BaseSelect.Icon>
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="3 4.5 6 7.5 9 4.5" />
        </svg>
      </BaseSelect.Icon>
    </BaseSelect.Trigger>
  );
}

export function SelectValue({
  placeholder,
  ...props
}: React.ComponentProps<typeof BaseSelect.Value>) {
  return <BaseSelect.Value placeholder={placeholder} {...props} />;
}

export function SelectContent({
  className = "",
  children,
  sideOffset = 4,
  ...props
}: React.ComponentProps<typeof BaseSelect.Popup> & { sideOffset?: number }) {
  return (
    <BaseSelect.Portal>
      <BaseSelect.Positioner className={styles.selectPositioner} sideOffset={sideOffset}>
        <BaseSelect.Popup
          className={[styles.selectPopup, className].filter(Boolean).join(" ")}
          {...props}
        >
          <BaseSelect.List>{children}</BaseSelect.List>
        </BaseSelect.Popup>
      </BaseSelect.Positioner>
    </BaseSelect.Portal>
  );
}

export function SelectItem({
  className = "",
  children,
  ...props
}: React.ComponentProps<typeof BaseSelect.Item>) {
  return (
    <BaseSelect.Item
      className={[styles.selectItem, className].filter(Boolean).join(" ")}
      {...props}
    >
      <BaseSelect.ItemText>{children}</BaseSelect.ItemText>
      <BaseSelect.ItemIndicator>
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="2.5 6.5 5 9 9.5 3.5" />
        </svg>
      </BaseSelect.ItemIndicator>
    </BaseSelect.Item>
  );
}
