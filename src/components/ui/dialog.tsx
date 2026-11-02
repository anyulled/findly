"use client";

import * as React from "react";
import { Dialog as BaseDialog } from "@base-ui/react";
import styles from "./dialog.module.css";

export const Dialog = BaseDialog.Root;
export const DialogTrigger = BaseDialog.Trigger;
export const DialogPortal = BaseDialog.Portal;
export const DialogClose = BaseDialog.Close;

export function DialogOverlay({ className = "", ...props }: React.ComponentProps<typeof BaseDialog.Backdrop>) {
  return <BaseDialog.Backdrop className={[styles.backdrop, className].filter(Boolean).join(" ")} {...props} />;
}

export function DialogContent({
  children,
  className = "",
  showClose = true,
  ...props
}: React.ComponentProps<typeof BaseDialog.Popup> & { showClose?: boolean }) {
  return (
    <DialogPortal>
      <DialogOverlay />
      <BaseDialog.Popup className={[styles.popup, className].filter(Boolean).join(" ")} {...props}>
        {children}
        {showClose && (
          <BaseDialog.Close className={styles.closeButton} aria-label="×">
            ×
          </BaseDialog.Close>
        )}
      </BaseDialog.Popup>
    </DialogPortal>
  );
}

export function DialogHeader({ className = "", ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={[styles.header, className].filter(Boolean).join(" ")} {...props} />;
}

export function DialogTitle({ className = "", ...props }: React.ComponentProps<typeof BaseDialog.Title>) {
  return <BaseDialog.Title className={[styles.title, className].filter(Boolean).join(" ")} {...props} />;
}

export function DialogDescription({ className = "", ...props }: React.ComponentProps<typeof BaseDialog.Description>) {
  return <BaseDialog.Description className={[styles.description, className].filter(Boolean).join(" ")} {...props} />;
}

export function DialogFooter({ className = "", ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={[styles.footer, className].filter(Boolean).join(" ")} {...props} />;
}
