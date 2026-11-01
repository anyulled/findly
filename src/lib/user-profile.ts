export type UserProfile = {
  name: string;
  email: string;
  avatarUrl?: string;
  initials: string;
};

function resolveFullName(metadata: Record<string, unknown>, email?: string): string {
  if (typeof metadata.full_name === "string" && metadata.full_name.trim()) return metadata.full_name.trim();
  if (typeof metadata.name === "string" && metadata.name.trim()) return metadata.name.trim();
  if (typeof metadata.user_name === "string" && metadata.user_name.trim()) return metadata.user_name.trim();
  if (typeof email === "string" && email.includes("@")) return email.split("@")[0].trim();
  return "Administrador";
}

function resolveAvatarUrl(metadata: Record<string, unknown>): string | undefined {
  if (typeof metadata.avatar_url === "string" && metadata.avatar_url.trim()) return metadata.avatar_url.trim();
  if (typeof metadata.picture === "string" && metadata.picture.trim()) return metadata.picture.trim();
  return undefined;
}

function resolveInitials(name: string): string {
  const words = name.split(/\s+/u).filter(Boolean);
  if (words.length >= 2) return `${words[0][0] ?? ""}${words[1][0] ?? ""}`.toUpperCase();
  return (name[0] ?? "A").toUpperCase();
}

export function extractUserProfile(user?: { email?: string; user_metadata?: Record<string, unknown> } | null): UserProfile {
  if (!user) {
    return { name: "Administrador", email: "", avatarUrl: undefined, initials: "A" };
  }
  const metadata = user.user_metadata ?? {};
  const name = resolveFullName(metadata, user.email);
  return {
    name,
    email: user.email ?? "",
    avatarUrl: resolveAvatarUrl(metadata),
    initials: resolveInitials(name) || "A",
  };
}
