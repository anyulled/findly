"use client";

import * as React from "react";
import { Accordion as BaseAccordion } from "@base-ui/react";
import styles from "./accordion.module.css";

export const Accordion = BaseAccordion.Root;
export const AccordionItem = BaseAccordion.Item;
export const AccordionHeader = BaseAccordion.Header;

export function AccordionTrigger({
  className = "",
  children,
  ...props
}: React.ComponentProps<typeof BaseAccordion.Trigger>) {
  return (
    <BaseAccordion.Header className={styles.accordionHeader}>
      <BaseAccordion.Trigger
        className={[styles.accordionTrigger, className].filter(Boolean).join(" ")}
        {...props}
      >
        <span>{children}</span>
        <svg
          className={styles.accordionChevron}
          width="14"
          height="14"
          viewBox="0 0 14 14"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="3.5 5.25 7 8.75 10.5 5.25" />
        </svg>
      </BaseAccordion.Trigger>
    </BaseAccordion.Header>
  );
}

export function AccordionPanel({
  className = "",
  children,
  ...props
}: React.ComponentProps<typeof BaseAccordion.Panel>) {
  return (
    <BaseAccordion.Panel
      className={[styles.accordionPanel, className].filter(Boolean).join(" ")}
      {...props}
    >
      {children}
    </BaseAccordion.Panel>
  );
}
