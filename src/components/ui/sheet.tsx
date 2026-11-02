"use client";

import * as React from "react";
import { Dialog as BaseDialog } from "@base-ui/react";
import { DialogOverlay } from "./dialog";
import dialogStyles from "./dialog.module.css";
import styles from "./sheet.module.css";

export const Sheet = BaseDialog.Root;
export const SheetTrigger = BaseDialog.Trigger;
export const SheetPortal = BaseDialog.Portal;
export const SheetClose = BaseDialog.Close;

export function SheetContent({
  children,
  className = "",
  showClose = true,
  ...props
}: React.ComponentProps<typeof BaseDialog.Popup> & { showClose?: boolean }) {
  return (
    <SheetPortal>
      <DialogOverlay />
      <BaseDialog.Popup className={[styles.content, className].filter(Boolean).join(" ")} {...props}>
        {children}
        {showClose && (
          <BaseDialog.Close className={dialogStyles.closeButton} aria-label="Cerrar ×">
            ×
          </BaseDialog.Close>
        )}
      </BaseDialog.Popup>
    </SheetPortal>
  );
}

export function SheetHeader({ className = "", ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={[styles.header, className].filter(Boolean).join(" ")} {...props} />;
}

export function SheetTitle({ className = "", render = <h3 />, ...props }: React.ComponentProps<typeof BaseDialog.Title>) {
  return <BaseDialog.Title render={render} className={[styles.title, className].filter(Boolean).join(" ")} {...props} />;
}

export function SheetDescription({ className = "", ...props }: React.ComponentProps<typeof BaseDialog.Description>) {
  return <BaseDialog.Description className={[styles.description, className].filter(Boolean).join(" ")} {...props} />;
}
