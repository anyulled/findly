import * as React from "react";
import styles from "./badge.module.css";

export type BadgeVariant = "default" | "secondary" | "outline" | "destructive" | "success" | "warning";

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
}

export function Badge({
  className = "",
  variant = "default",
  children,
  ...props
}: BadgeProps) {
  const variantClass = {
    default: styles.variantDefault,
    secondary: styles.variantSecondary,
    outline: styles.variantOutline,
    destructive: styles.variantDestructive,
    success: styles.variantSuccess,
    warning: styles.variantWarning,
  }[variant];

  return (
    <span
      className={[styles.badge, variantClass, className].filter(Boolean).join(" ")}
      {...props}
    >
      {children}
    </span>
  );
}
