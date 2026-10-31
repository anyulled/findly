export const MANAGED_ACCOUNTS = [
  { key: "personal", name: "Personal", aliases: ["Personal", "Alex · personal", "Alex · Personal"], kind: "Cuenta personal", initials: "P", color: "violet", logo: "/account-logos/personal.svg", apiKeyEnv: "BUFFER_API_KEY_PERSONAL", networks: ["LinkedIn", "X", "Bluesky"] },
  { key: "barcelona_jug", name: "Barcelona JUG", aliases: ["Barcelona JUG", "BarcelonaJS"], kind: "Asociación", initials: "J", color: "orange", logo: "/account-logos/barcelona-jug.webp", apiKeyEnv: "BUFFER_API_KEY_BARCELONA_JUG", networks: ["LinkedIn", "X"] },
  { key: "software_crafters_barcelona", name: "Software Crafters Barcelona", aliases: ["Software Crafters Barcelona", "DevBcn"], kind: "Asociación", initials: "S", color: "green", logo: "/account-logos/software-crafters-barcelona.png", apiKeyEnv: "BUFFER_API_KEY_SOFTWARE_CRAFTERS_BARCELONA", networks: ["LinkedIn", "Bluesky"] },
] as const;

export function managedAccount(name: string) {
  const normalized = name.trim().toLocaleLowerCase("es");
  return MANAGED_ACCOUNTS.find((account) => account.aliases.some((alias) => alias.toLocaleLowerCase("es") === normalized));
}
