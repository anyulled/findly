"use client";

import * as React from "react";
import { Checkbox as BaseCheckbox } from "@base-ui/react";
import styles from "./checkbox.module.css";

export type CheckboxProps = React.ComponentProps<typeof BaseCheckbox.Root>;

export function Checkbox({ className = "", ...props }: CheckboxProps) {
  return (
    <BaseCheckbox.Root
      className={[styles.checkboxRoot, className].filter(Boolean).join(" ")}
      {...props}
    >
      <BaseCheckbox.Indicator className={styles.checkboxIndicator}>
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="2.5 6.5 5 9 9.5 3.5" />
        </svg>
      </BaseCheckbox.Indicator>
    </BaseCheckbox.Root>
  );
}
