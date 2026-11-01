export type EventSource = "Manual" | "Luma" | "Meetup" | "Substack";

function matchesDomain(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

function classifyHostname(parsed: URL): EventSource {
  const host = parsed.hostname.toLowerCase();
  if (matchesDomain(host, "lu.ma") || matchesDomain(host, "luma.com")) return "Luma";
  if (matchesDomain(host, "meetup.com")) return "Meetup";
  if (matchesDomain(host, "substack.com") || parsed.pathname.endsWith("/api/v1/posts")) return "Substack";
  return "Manual";
}

export function sourceForEventUrl(value: string | null | undefined): EventSource {
  if (!value) return "Manual";
  try {
    return classifyHostname(new URL(value));
  } catch {
    return "Manual";
  }
}
