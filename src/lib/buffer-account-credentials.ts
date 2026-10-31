import { managedAccount } from "@/lib/managed-accounts";

export function bufferCredentialForAccount(name: string, environment: Record<string, string | undefined> = process.env) {
  const account = managedAccount(name);
  if (!account) return { apiKey: null, environmentVariable: null };
  return { apiKey: environment[account.apiKeyEnv]?.trim() || null, environmentVariable: account.apiKeyEnv };
}
