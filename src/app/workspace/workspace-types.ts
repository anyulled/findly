import type { EventView, PostView } from "../workspace-actions";

export type Range = "Quincena" | "Semana" | "Mes";
export type Status =
  | "review"
  | "approved"
  | "scheduling"
  | "scheduled"
  | "published"
  | "failed"
  | "needs_reconciliation";
export type Network = "LinkedIn" | "X" | "Bluesky";

export type EventItem = EventView;
export type Post = PostView;

export type Account = {
  id?: string;
  enabled?: boolean;
  name: string;
  kind: string;
  initials: string;
  color: string;
  logo: string;
  bufferApiKeyEnv: string;
  bufferApiKeyConfigured: boolean;
  prompt: string;
  networks: Network[];
  bufferChannels: Partial<Record<Network, string>>;
  styleExampleCount: number;
};

export const statusLabels: Record<Status, string> = {
  review: "Pendiente de revisión",
  approved: "Aprobada",
  scheduling: "Enviando",
  scheduled: "Programada",
  published: "Publicada",
  failed: "Fallida",
  needs_reconciliation: "Pendiente de conciliación",
};

export const defaultAccounts: Account[] = [
  {
    id: "acc-personal",
    name: "Personal",
    kind: "Cuenta personal",
    initials: "P",
    color: "violet",
    logo: "/account-logos/personal.svg",
    bufferApiKeyEnv: "BUFFER_API_KEY_PERSONAL",
    bufferApiKeyConfigured: false,
    prompt: "Cercano, curioso y directo. Primera persona. Evita sonar promocional.",
    networks: ["LinkedIn", "X", "Bluesky"],
    bufferChannels: {},
    styleExampleCount: 0,
  },
  {
    id: "acc-barcelona-jug",
    name: "Barcelona JUG",
    kind: "Asociación",
    initials: "J",
    color: "orange",
    logo: "/account-logos/barcelona-jug.webp",
    bufferApiKeyEnv: "BUFFER_API_KEY_BARCELONA_JUG",
    bufferApiKeyConfigured: false,
    prompt: "Comunidad tecnológica abierta. Entusiasta, inclusiva y concreta.",
    networks: ["LinkedIn", "X"],
    bufferChannels: {},
    styleExampleCount: 0,
  },
  {
    id: "acc-software-crafters-barcelona",
    name: "Software Crafters Barcelona",
    kind: "Asociación",
    initials: "S",
    color: "green",
    logo: "/account-logos/software-crafters-barcelona.png",
    bufferApiKeyEnv: "BUFFER_API_KEY_SOFTWARE_CRAFTERS_BARCELONA",
    bufferApiKeyConfigured: false,
    prompt: "Tono profesional y acogedor. Destaca la comunidad y el aprendizaje.",
    networks: ["LinkedIn", "Bluesky"],
    bufferChannels: {},
    styleExampleCount: 0,
  },
];

export function matchesAccount(a: Account, target: Account): boolean {
  return target.id ? a.id === target.id : a.name === target.name;
}
