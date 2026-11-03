"use client";

import * as React from "react";
import { Tabs as BaseTabs } from "@base-ui/react";
import styles from "./tabs.module.css";

export const Tabs = BaseTabs.Root;

export function TabsList({ className = "", activateOnFocus = true, ...props }: React.ComponentProps<typeof BaseTabs.List>) {
  return <BaseTabs.List className={[styles.list, className].filter(Boolean).join(" ")} activateOnFocus={activateOnFocus} {...props} />;
}

export function TabsTrigger({ className = "", ...props }: React.ComponentProps<typeof BaseTabs.Tab>) {
  return <BaseTabs.Tab className={[styles.trigger, className].filter(Boolean).join(" ")} {...props} />;
}

export function TabsContent({ className = "", ...props }: React.ComponentProps<typeof BaseTabs.Panel>) {
  return <BaseTabs.Panel className={[styles.panel, className].filter(Boolean).join(" ")} {...props} />;
}
