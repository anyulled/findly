/** Select accounts enabled for an event. Imported events target only their source links. */
export function selectEventAccounts<T extends { id?: string; enabled?: boolean }>(
  accounts: readonly T[],
  sourceId: string | null | undefined,
  links: readonly { sourceId: string; accountId: string }[],
): T[] {
  if (!sourceId) return accounts.filter((account) => account.enabled !== false);
  const linkedIds = new Set(links.filter((link) => link.sourceId === sourceId).map((link) => link.accountId));
  return accounts.filter((account) => account.enabled !== false && !!account.id && linkedIds.has(account.id));
}

/** Check each eligible account/network/offset rather than comparing global counts. */
export function hasMissingReminders(
  accounts: readonly { id?: string; networks: readonly string[] }[],
  leadDays: readonly number[],
  posts: readonly { accountId?: string; network: string; leadDays?: number }[],
): boolean {
  return leadDays.some((leadDay) => accounts.some((account) =>
    account.networks.some((network) => !posts.some((post) =>
      post.accountId === account.id && post.network === network && post.leadDays === leadDay,
    )),
  ));
}
