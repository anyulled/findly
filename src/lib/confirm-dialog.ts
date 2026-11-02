/**
 * Prompts the user with a confirmation dialog asynchronously on the next event loop tick.
 *
 * Decoupling the dialog invocation from the synchronous click event dispatch allows
 * the browser to finish processing the interaction and perform the next paint
 * immediately, preventing main-thread stalls that degrade Interaction to Next Paint (INP).
 *
 * @param message The confirmation message shown to the user.
 * @param confirmFn Optional dialog function, defaults to window.confirm when available.
 * @returns A Promise resolving to true if confirmed, false otherwise.
 */
export function confirmAsync(
  message: string,
  confirmFn: (msg: string) => boolean = (msg) => (typeof window !== "undefined" ? window.confirm(msg) : false),
): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    setTimeout(() => {
      try {
        resolve(confirmFn(message));
      } catch {
        resolve(false);
      }
    }, 0);
  });
}
