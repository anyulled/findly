"use client";

import * as React from "react";
import { Progress as BaseProgress } from "@base-ui/react";
import styles from "./progress.module.css";

export interface ProgressProps extends Omit<React.ComponentProps<typeof BaseProgress.Root>, "value"> {
  value?: number | null;
  max?: number;
}

export function Progress({
  value = null,
  max = 100,
  className = "",
  ...props
}: ProgressProps) {
  const isIndeterminate = value === null || value === undefined;
  const percentage = isIndeterminate
    ? undefined
    : Math.min(100, Math.max(0, (Number(value) / max) * 100));

  return (
    <BaseProgress.Root
      value={value}
      max={max}
      className={[styles.progressRoot, className].filter(Boolean).join(" ")}
      {...props}
    >
      <BaseProgress.Track className={styles.progressTrack}>
        <BaseProgress.Indicator
          className={styles.progressIndicator}
          style={percentage !== undefined ? { width: `${percentage}%` } : undefined}
        />
      </BaseProgress.Track>
    </BaseProgress.Root>
  );
}
