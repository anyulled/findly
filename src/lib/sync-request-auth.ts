export function isSameOriginSessionRequest(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

export function isOwnerEmailAuthorized(
  userEmail: string | null | undefined,
  ownerEmail: string | null | undefined,
): boolean {
  if (!userEmail || !ownerEmail) return false;
  return userEmail.trim().toLowerCase() === ownerEmail.trim().toLowerCase();
}

