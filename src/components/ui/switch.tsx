"use client";

import * as React from "react";
import { Switch as BaseSwitch } from "@base-ui/react";
import styles from "./switch.module.css";

export type SwitchProps = React.ComponentProps<typeof BaseSwitch.Root>;

export function Switch({ className = "", children, ...props }: SwitchProps) {
  return (
    <BaseSwitch.Root
      className={[styles.switchRoot, className].filter(Boolean).join(" ")}
      {...props}
    >
      <BaseSwitch.Thumb className={styles.switchThumb} />
      {children}
    </BaseSwitch.Root>
  );
}
