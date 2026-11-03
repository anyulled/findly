import * as React from "react";
import styles from "./card.module.css";

export function Card({ className = "", ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={[styles.cardContainer, className].filter(Boolean).join(" ")} {...props} />;
}

export function CardHeader({ className = "", ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={[styles.cardSectionHeader, className].filter(Boolean).join(" ")} {...props} />;
}

export function CardTitle({ className = "", ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={[styles.cardHeading, className].filter(Boolean).join(" ")} {...props} />;
}

export function CardDescription({ className = "", ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={[styles.cardSubtext, className].filter(Boolean).join(" ")} {...props} />;
}

export function CardContent({ className = "", ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={[styles.cardBody, className].filter(Boolean).join(" ")} {...props} />;
}

export function CardFooter({ className = "", ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={[styles.cardActionsFooter, className].filter(Boolean).join(" ")} {...props} />;
}
