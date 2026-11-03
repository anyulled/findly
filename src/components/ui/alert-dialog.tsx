"use client";

import * as React from "react";
import { AlertDialog as BaseAlertDialog, Dialog as BaseDialog } from "@base-ui/react";
import { DialogOverlay } from "./dialog";
import styles from "./alert-dialog.module.css";

export const AlertDialog = BaseAlertDialog.Root;
export const AlertDialogTrigger = BaseAlertDialog.Trigger;
export const AlertDialogPortal = BaseDialog.Portal;
export const AlertDialogCancel = BaseDialog.Close;
export const AlertDialogAction = BaseDialog.Close;

export function AlertDialogContent({
  children,
  className = "",
  ...props
}: React.ComponentProps<typeof BaseDialog.Popup>) {
  return (
    <AlertDialogPortal>
      <DialogOverlay />
      <BaseDialog.Popup className={[styles.alertPopup, className].filter(Boolean).join(" ")} {...props}>
        {children}
      </BaseDialog.Popup>
    </AlertDialogPortal>
  );
}

export function AlertDialogHeader({ className = "", ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={className} {...props} />;
}

export function AlertDialogTitle({ className = "", ...props }: React.ComponentProps<typeof BaseDialog.Title>) {
  return <BaseDialog.Title className={[styles.alertTitle, className].filter(Boolean).join(" ")} {...props} />;
}

export function AlertDialogDescription({ className = "", ...props }: React.ComponentProps<typeof BaseDialog.Description>) {
  return <BaseDialog.Description className={[styles.alertDescription, className].filter(Boolean).join(" ")} {...props} />;
}

export function AlertDialogFooter({ className = "", ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={[styles.alertFooter, className].filter(Boolean).join(" ")} {...props} />;
}
