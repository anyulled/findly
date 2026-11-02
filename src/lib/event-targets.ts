/** Select accounts enabled for an event. Imported events target only their source links. */
export function selectEventAccounts<T extends { id?: string; enabled?: boolean; networks?: readonly string[] }>(
  accounts: readonly T[],
  sourceId: string | null | undefined,
  links: readonly { sourceId: string; accountId: string; networks?: readonly string[] | null }[],
  selectedAccountIds?: readonly string[] | null,
): T[] {
  if (selectedAccountIds != null) {
    const selected = new Set(selectedAccountIds);
    return accounts.filter((account) => account.enabled !== false && !!account.id && selected.has(account.id));
  }
  if (!sourceId) return accounts.filter((account) => account.enabled !== false);
  const linksForSource = links.filter((link) => link.sourceId === sourceId);
  const linkByAccount = new Map(linksForSource.map((link) => [link.accountId, link.networks]));
  return accounts
    .filter((account) => account.enabled !== false && !!account.id && linkByAccount.has(account.id))
    .map((account) => {
      const configuredNets = linkByAccount.get(account.id!);
      if (!configuredNets || configuredNets.length === 0 || !account.networks) {
        return account;
      }
      const allowed = new Set(configuredNets);
      const filteredNetworks = account.networks.filter((net) => allowed.has(net));
      return { ...account, networks: filteredNetworks };
    });
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
