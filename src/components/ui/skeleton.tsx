import * as React from "react";
import styles from "./skeleton.module.css";

export function Skeleton({
  className = "",
  style,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden="true"
      className={[styles.skeletonBlock, className].filter(Boolean).join(" ")}
      style={style}
      {...props}
    />
  );
}
