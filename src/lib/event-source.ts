export type EventSource = "Manual" | "Luma" | "Meetup";

export function sourceForEventUrl(value: string | null | undefined): EventSource {
  if (!value) return "Manual";
  try {
    const hostname = new URL(value).hostname.toLowerCase();
    if (hostname === "lu.ma" || hostname.endsWith(".lu.ma") || hostname === "luma.com" || hostname.endsWith(".luma.com")) return "Luma";
    if (hostname === "meetup.com" || hostname.endsWith(".meetup.com")) return "Meetup";
  } catch { /* Invalid URLs are not used as external source identities. */ }
  return "Manual";
}
