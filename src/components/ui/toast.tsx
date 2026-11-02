"use client";

import * as React from "react";
import { Toast } from "@base-ui/react/toast";
import styles from "./toast.module.css";
import type { NotificationAction, NotificationType } from "@/lib/notifications";

export const toastManager = Toast.createToastManager();

export interface ToastOptions {
  id?: string;
  title?: React.ReactNode;
  description?: React.ReactNode;
  type?: NotificationType;
  timeout?: number;
  action?: NotificationAction;
  actionProps?: React.ComponentPropsWithoutRef<"button">;
}

export function showToast(
  message: React.ReactNode,
  options?: Omit<ToastOptions, "description">,
): string {
  const timeout = options?.timeout ?? 5000;
  return toastManager.add({
    ...options,
    description: message,
    timeout,
    type: options?.type ?? "info",
    data: {
      action: options?.action,
    },
  });
}

export const toast = {
  add: (options: ToastOptions) =>
    toastManager.add({
      ...options,
      timeout: options.timeout ?? 5000,
      type: options.type ?? "info",
      data: {
        action: options.action,
      },
    }),
  success: (
    message: React.ReactNode,
    options?: Omit<ToastOptions, "description" | "type">,
  ) => showToast(message, { ...options, type: "success" }),
  warning: (
    message: React.ReactNode,
    options?: Omit<ToastOptions, "description" | "type">,
  ) => showToast(message, { ...options, type: "warning" }),
  error: (
    message: React.ReactNode,
    options?: Omit<ToastOptions, "description" | "type">,
  ) => showToast(message, { ...options, type: "error" }),
  info: (
    message: React.ReactNode,
    options?: Omit<ToastOptions, "description" | "type">,
  ) => showToast(message, { ...options, type: "info" }),
  close: (id?: string) => toastManager.close(id),
  promise: toastManager.promise,
};

function IconBase({ children }: { children: React.ReactNode }) {
  return (
    <div className={styles.iconWrapper}>
      <svg
        className={styles.icon}
        viewBox="0 0 20 20"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        {children}
      </svg>
    </div>
  );
}

function ToastIcon({ type }: { type?: string }) {
  if (type === "success") {
    return (
      <IconBase>
        <path d="M16.5 6.5l-8 8L4.5 10.5" />
      </IconBase>
    );
  }

  if (type === "warning") {
    return (
      <IconBase>
        <path d="M10 3L2 17h16L10 3z" />
        <path d="M10 8.5v3.5" />
        <path d="M10 14.5v.5" />
      </IconBase>
    );
  }

  if (type === "error") {
    return (
      <IconBase>
        <circle cx="10" cy="10" r="8" />
        <path d="M10 6v5" />
        <circle cx="10" cy="14" r="0.75" fill="currentColor" stroke="none" />
      </IconBase>
    );
  }

  return (
    <IconBase>
      <circle cx="10" cy="10" r="8" />
      <path d="M10 9v5" />
      <circle cx="10" cy="6.5" r="0.75" fill="currentColor" stroke="none" />
    </IconBase>
  );
}

function ToastList() {
  const { toasts } = Toast.useToastManager<{ action?: NotificationAction }>();

  return (
    <Toast.Viewport className={styles.viewport} aria-label="Notificaciones">
      {toasts.map((toastItem) => {
        const action = toastItem.data?.action;
        const isError = toastItem.type === "error";

        return (
          <Toast.Root
            key={toastItem.id}
            toast={toastItem}
            className={styles.root}
            data-type={toastItem.type}
            role={isError ? "alert" : "status"}
          >
            <ToastIcon type={toastItem.type} />
            <Toast.Content className={styles.content}>
              {toastItem.title && (
                <Toast.Title className={styles.title}>
                  {toastItem.title}
                </Toast.Title>
              )}
              {toastItem.description && (
                <Toast.Description className={styles.description}>
                  {toastItem.description}
                </Toast.Description>
              )}
              {action && (
                <div className={styles.actionContainer}>
                  {action.href ? (
                    <a
                      href={action.href}
                      className={styles.actionLink}
                      onClick={() => {
                        action.onClick?.();
                        toast.close(toastItem.id);
                      }}
                    >
                      {action.label}
                    </a>
                  ) : (
                    <Toast.Action
                      className={styles.actionButton}
                      onClick={() => {
                        action.onClick?.();
                        toast.close(toastItem.id);
                      }}
                    >
                      {action.label}
                    </Toast.Action>
                  )}
                </div>
              )}
            </Toast.Content>
            <Toast.Close
              render={(props) => {
                // eslint-disable-next-line @typescript-eslint/no-unused-vars
                const { "aria-hidden": _ignored, ...rest } = props as Record<string, unknown>;
                return (
                  <button
                    {...rest}
                    type="button"
                    className={styles.closeButton}
                    aria-label="Cerrar notificación"
                  >
                    <svg
                      viewBox="0 0 16 16"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                      width="14"
                      height="14"
                    >
                      <path d="M4 4l8 8" />
                      <path d="M12 4l-8 8" />
                    </svg>
                  </button>
                );
              }}
            />
          </Toast.Root>
        );
      })}
    </Toast.Viewport>
  );
}

export function Toaster() {
  return (
    <Toast.Provider toastManager={toastManager} timeout={5000} limit={5}>
      <Toast.Portal>
        <ToastList />
      </Toast.Portal>
    </Toast.Provider>
  );
}
