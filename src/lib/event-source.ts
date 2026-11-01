export type EventSource = "Manual" | "Luma" | "Meetup" | "Substack";

export function sourceForEventUrl(value: string | null | undefined): EventSource {
  if (!value) return "Manual";
  try {
    const parsed = new URL(value);
    const hostname = parsed.hostname.toLowerCase();
    if (hostname === "lu.ma" || hostname.endsWith(".lu.ma") || hostname === "luma.com" || hostname.endsWith(".luma.com")) return "Luma";
    if (hostname === "meetup.com" || hostname.endsWith(".meetup.com")) return "Meetup";
    if (hostname === "substack.com" || hostname.endsWith(".substack.com") || parsed.pathname.endsWith("/api/v1/posts")) return "Substack";
  } catch { /* Invalid URLs are not used as external source identities. */ }
  return "Manual";
}
