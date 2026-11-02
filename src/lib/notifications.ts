export type NotificationType = "success" | "warning" | "error" | "info";

export interface NotificationAction {
  label: string;
  href?: string;
  onClick?: () => void;
}

export interface NotificationItem {
  id?: string;
  title?: string;
  message: string;
  type: NotificationType;
  action?: NotificationAction;
  timeout?: number;
}

export function classifyPublishOutcome(outcome: {
  kind: string;
  message?: string | null;
}): { type: NotificationType; message: string } {
  if (outcome.kind === "scheduled") {
    return {
      type: "success",
      message: "Publicación aprobada y programada en Buffer.",
    };
  }
  if (outcome.kind === "needs_reconciliation") {
    return {
      type: "warning",
      message: "Buffer pudo aceptar la publicación. Comprueba su cola antes de reintentar.",
    };
  }
  if (outcome.kind === "failed") {
    return {
      type: "error",
      message: `La publicación se aprobó, pero Buffer la rechazó: ${outcome.message ?? "comprueba la configuración"}`,
    };
  }
  if (outcome.kind === "not_claimed") {
    return {
      type: "warning",
      message: "No se pudo reservar la publicación. Revisa su estado y la cuenta asociada a la fuente.",
    };
  }
  if (outcome.kind === "error") {
    return {
      type: "error",
      message: outcome.message || "Error al procesar la publicación.",
    };
  }
  return {
    type: "info",
    message: "La publicación está en proceso de envío.",
  };
}

export function buildNotification(
  message: string,
  type: NotificationType = "info",
  action?: NotificationAction,
  timeout = 5000,
): NotificationItem {
  return {
    message,
    type,
    ...(action ? { action } : {}),
    timeout,
  };
}
