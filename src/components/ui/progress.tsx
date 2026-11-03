"use client";

import * as React from "react";
import { Progress as BaseProgress } from "@base-ui/react";
import styles from "./progress.module.css";

export interface ProgressProps extends Omit<React.ComponentProps<typeof BaseProgress.Root>, "value"> {
  value?: number | null;
  max?: number;
}

export function Progress({
  value = 0,
  max = 100,
  className = "",
  ...props
}: ProgressProps) {
  const percentage = Math.min(100, Math.max(0, (Number(value ?? 0) / max) * 100));

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
          style={{ width: `${percentage}%` }}
        />
      </BaseProgress.Track>
    </BaseProgress.Root>
  );
}
