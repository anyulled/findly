import { logger } from "./logger";

export class UserFacingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UserFacingError";
  }
}

export type ActionResult<T> =
  | { success: true; data: T }
  | { success: false; error: string };

export type ActionVoidResult =
  | { success: true }
  | { success: false; error: string };

export async function runAction<T>(
  actionName: string,
  fn: () => Promise<T>,
  options: { defaultErrorMessage?: string } = {},
): Promise<ActionResult<T>> {
  try {
    const data = await fn();
    return { success: true, data };
  } catch (err: unknown) {
    if (err instanceof UserFacingError) {
      logger.warn(`Action "${actionName}" returned user-facing error`, { action: actionName }, err);
      return { success: false, error: err.message };
    }

    logger.error(`Action "${actionName}" failed unexpectedly`, { action: actionName }, err);
    const fallbackMessage = options.defaultErrorMessage ?? "Ha ocurrido un error inesperado al procesar la solicitud.";
    return { success: false, error: fallbackMessage };
  }
}

export async function runVoidAction(
  actionName: string,
  fn: () => Promise<void>,
  options: { defaultErrorMessage?: string } = {},
): Promise<ActionVoidResult> {
  const result = await runAction(actionName, fn, options);
  if (result.success) return { success: true };
  return { success: false, error: result.error };
}
