/**
 * Resolves a successful OAuth callback to a same-origin destination.
 * Invalid, absolute, protocol-relative, and normalized external URLs fall back
 * to the application root.
 */
export function resolveOAuthRedirect(next: string | null, origin: string): URL {
  const fallback = new URL("/", origin);

  if (
    !next ||
    !next.startsWith("/") ||
    next.startsWith("//") ||
    /\\|%5c/i.test(next)
  ) {
    return fallback;
  }

  try {
    const target = new URL(next, origin);
    const applicationOrigin = new URL(origin).origin;

    if (
      target.origin !== applicationOrigin ||
      target.username !== "" ||
      target.password !== ""
    ) {
      return fallback;
    }

    return target;
  } catch {
    return fallback;
  }
}

/** Returns the post-callback destination, exchanging the code when present. */
export async function resolveOAuthCallbackLocation(
  code: string | null,
  next: string | null,
  origin: string,
  exchangeCode: (code: string) => Promise<boolean>,
): Promise<{ location: URL; authenticated: boolean }> {
  if (!code || !(await exchangeCode(code))) {
    return { location: new URL("/login?error=auth", origin), authenticated: false };
  }

  return {
    location: resolveOAuthRedirect(next ?? "/workspace", origin),
    authenticated: true,
  };
}
