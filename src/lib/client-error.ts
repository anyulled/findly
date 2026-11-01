function extractErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message.trim();
  if (typeof error === "string") return error.trim();
  return "";
}

/**
 * Sanitizes error messages originating from Server Actions, network requests,
 * or React runtime, ensuring minified error strings or technical stack traces
 * are never surfaced to the end user.
 */
export function sanitizeClientErrorMessage(error: unknown, fallbackMessage: string): string {
  const message = extractErrorMessage(error);
  if (!message) return fallbackMessage;

  // React production minified digests or error decoder URLs
  if (/(minified react error|react\.dev\/errors)/i.test(message)) {
    return "El servidor no pudo procesar la solicitud en este momento. Por favor, inténtalo de nuevo.";
  }

  // Network and transport failures
  if (/(failed to fetch|networkerror|load failed)/i.test(message)) {
    return "Error de conexión con el servidor. Comprueba tu conexión a internet e inténtalo de nuevo.";
  }

  // Next.js Server Components / Server Actions internal error text
  if (/an error occurred in the server components render/i.test(message)) {
    return "Ha ocurrido un error inesperado en el servidor. Por favor, inténtalo de nuevo más tarde.";
  }

  return message;
}
