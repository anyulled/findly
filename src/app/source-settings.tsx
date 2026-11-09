"use client";

import { useState, type FormEvent } from "react";
import styles from "./page.module.css";
import sourceStyles from "./source-settings.module.css";
import { confirmAsync } from "@/lib/confirm-dialog";
import type { SocialNetwork } from "@/lib/social-validation";
import { Rss, ExternalLink } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  deleteSource,
  fetchSubstackPostsForSource,
  generateDraftsForSubstackArticle,
  previewUpcomingSourceEvents,
  retireSource,
  saveSource,
  setSourceEnabled,
  syncSelectedUpcomingEvents,
  type AccountView,
  type SourceInput,
  type SourceType,
  type SourceView,
  type SubstackPostItemView,
  type UpcomingSourceEvent,
} from "./workspace-actions";

type Props = {
  accounts: AccountView[];
  sources: SourceView[];
  persistent: boolean;
  onSourcesChange: (sources: SourceView[]) => void;
  onSyncComplete: () => Promise<void>;
};

type DraftState = {
  name: string;
  type: SourceType;
  url: string;
  accountIds: string[];
  accountNetworks: Record<string, SocialNetwork[]>;
};

const emptySource: DraftState = {
  name: "",
  type: "luma_ical",
  url: "",
  accountIds: [],
  accountNetworks: {},
};

export function SourceSettings({ accounts, sources, persistent, onSourcesChange, onSyncComplete }: Props) {
  const [draft, setDraft] = useState<DraftState>(emptySource);
  const [editingSourceId, setEditingSourceId] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [deletingSourceId, setDeletingSourceId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  // Selective sync modal state
  const [showSyncModal, setShowSyncModal] = useState(false);
  const [previewingSync, setPreviewingSync] = useState(false);
  const [upcomingEvents, setUpcomingEvents] = useState<UpcomingSourceEvent[]>([]);
  const [selectedUpcomingKeys, setSelectedUpcomingKeys] = useState<Set<string>>(new Set());
  const [submittingSelectiveSync, setSubmittingSelectiveSync] = useState(false);

  // Substack reverse-chronological modal state
  const [activeSubstackSource, setActiveSubstackSource] = useState<SourceView | null>(null);
  const [loadingSubstack, setLoadingSubstack] = useState(false);
  const [substackPosts, setSubstackPosts] = useState<SubstackPostItemView[]>([]);
  const [generatingPostUid, setGeneratingPostUid] = useState<string | null>(null);
  const [substackMessage, setSubstackMessage] = useState("");
  const [substackError, setSubstackError] = useState("");

  const accountsReady = accounts.length > 0;

  function toggleAccount(accountId: string) {
    const nextAccountIds = draft.accountIds.includes(accountId)
      ? draft.accountIds.filter((id) => id !== accountId)
      : [...draft.accountIds, accountId];

    const nextNetworks = { ...draft.accountNetworks };
    if (!nextAccountIds.includes(accountId)) {
      delete nextNetworks[accountId];
    } else if (!nextNetworks[accountId]) {
      const acct = accounts.find((a) => (a.id ?? a.name) === accountId);
      if (acct) nextNetworks[accountId] = [...acct.networks];
    }

    setDraft({ ...draft, accountIds: nextAccountIds, accountNetworks: nextNetworks });
  }

  function toggleAccountNetwork(accountId: string, network: SocialNetwork, allNetworks: SocialNetwork[]) {
    const current = draft.accountNetworks[accountId] ?? [...allNetworks];
    const next = current.includes(network)
      ? current.filter((n) => n !== network)
      : [...current, network];
    setDraft({
      ...draft,
      accountNetworks: { ...draft.accountNetworks, [accountId]: next },
    });
  }

  function toggleAllNetworksForAccount(accountId: string, allNetworks: SocialNetwork[]) {
    const current = draft.accountNetworks[accountId] ?? [...allNetworks];
    const next = current.length === allNetworks.length ? [] : [...allNetworks];
    setDraft({
      ...draft,
      accountNetworks: { ...draft.accountNetworks, [accountId]: next },
    });
  }

  async function addSource(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    setError("");
    setMessage("");

    if (!draft.name.trim() || !draft.url.trim()) {
      setError("Indica el nombre y la URL de la fuente.");
      return;
    }

    if (draft.accountIds.length === 0) {
      setError("Asocia la fuente al menos a una cuenta.");
      return;
    }

    setPending(true);
    try {
      const payload: SourceInput = {
        name: draft.name.trim(),
        type: draft.type,
        url: draft.url.trim(),
        accountIds: draft.accountIds,
        accountNetworks: draft.accountNetworks,
      };

      if (!persistent) {
        if (editingSourceId) {
          const updated = sources.map((s) => (s.id === editingSourceId ? { ...s, ...payload } : s));
          onSourcesChange(updated);
          setMessage("Fuente actualizada en el navegador.");
        } else {
          const created: SourceView = {
            id: `src-${Date.now()}`,
            name: payload.name,
            type: payload.type,
            url: payload.url,
            enabled: true,
            accountIds: payload.accountIds,
            accountNetworks: payload.accountNetworks,
          };
          onSourcesChange([...sources, created]);
          setMessage("Fuente añadida en el navegador. Conecta Supabase para consultar feeds.");
        }
        setDraft(emptySource);
        setEditingSourceId(null);
        return;
      }

      const result = await saveSource(payload, editingSourceId ?? undefined);
      if (!result.success) {
        setError(result.error);
        return;
      }

      if (editingSourceId) {
        onSourcesChange(sources.map((s) => (s.id === editingSourceId ? result.source : s)));
        setMessage("Fuente actualizada.");
      } else {
        onSourcesChange([...sources, result.source]);
        setMessage("Fuente guardada.");
      }
      setDraft(emptySource);
      setEditingSourceId(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No se pudo guardar la fuente.");
    } finally {
      setPending(false);
    }
  }

  function startEditing(source: SourceView) {
    setEditingSourceId(source.id);
    setDraft({
      name: source.name,
      type: source.type,
      url: source.url,
      accountIds: [...source.accountIds],
      accountNetworks: source.accountNetworks ? JSON.parse(JSON.stringify(source.accountNetworks)) : {},
    });
    setError("");
    setMessage("");
  }

  function cancelEditing() {
    setEditingSourceId(null);
    setDraft(emptySource);
  }

  async function toggleSource(source: SourceView) {
    const nextEnabled = !source.enabled;
    setError("");
    setMessage("");

    if (!persistent) {
      onSourcesChange(sources.map((s) => (s.id === source.id ? { ...s, enabled: nextEnabled } : s)));
      return;
    }

    try {
      const result = await setSourceEnabled(source.id, nextEnabled);
      if (!result.success) {
        setError(result.error);
        return;
      }
      onSourcesChange(sources.map((s) => (s.id === source.id ? { ...s, enabled: nextEnabled } : s)));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No se pudo actualizar el estado de la fuente.");
    }
  }

  async function removeSource(source: SourceView, mode: "delete" | "retire") {
    const isRetire = mode === "retire";
    const prompt = isRetire
      ? `¿Retirar «${source.name}»? Se conservarán sus ${source.eventCount ?? 0} eventos y publicaciones creados, pero dejará de sincronizarse.`
      : `¿Eliminar «${source.name}»?`;
    const confirmed = await confirmAsync(prompt);
    if (!confirmed) return;

    setError("");
    setMessage("");
    setDeletingSourceId(source.id);

    try {
      if (!persistent) {
        onSourcesChange(sources.filter((s) => s.id !== source.id));
        setMessage(isRetire ? "Fuente retirada. Se conservan sus eventos y publicaciones." : "Fuente eliminada.");
        return;
      }

      const result = isRetire ? await retireSource(source.id) : await deleteSource(source.id);
      if (!result.success) {
        setError(result.error);
        return;
      }
      onSourcesChange(sources.filter((s) => s.id !== source.id));
      setMessage(isRetire ? "Fuente retirada. Se conservan sus eventos y publicaciones." : "Fuente eliminada.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : isRetire ? "No se pudo retirar la fuente." : "No se pudo eliminar la fuente.");
    } finally {
      setDeletingSourceId(null);
    }
  }

  function renderAccountChannelsSummary(source: SourceView): string {
    if (source.accountIds.length === 0) return "Sin cuentas asociadas";
    return source.accountIds.map((accId) => {
      const acct = accounts.find((a) => (a.id ?? a.name) === accId);
      const name = acct?.name ?? accId;
      const nets = source.accountNetworks?.[accId];
      if (nets && nets.length > 0 && nets.length < (acct?.networks.length ?? 0)) {
        return `${name} (${nets.join(", ")})`;
      }
      return name;
    }).join("; ");
  }

  // Sincronizar ahora con preview y selección de eventos futuros
  async function openSyncModal() {
    setPreviewingSync(true);
    setError("");
    setMessage("");
    setShowSyncModal(true);
    try {
      const result = await previewUpcomingSourceEvents();
      if (!result.success) {
        setError(result.error);
        setShowSyncModal(false);
        return;
      }
      setUpcomingEvents(result.events);
      const initialSelected = new Set(
        result.events.filter((e) => !e.alreadyImported).map((e) => `${e.sourceId}:${e.externalId}`),
      );
      setSelectedUpcomingKeys(initialSelected);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Error al consultar los eventos futuros.");
      setShowSyncModal(false);
    } finally {
      setPreviewingSync(false);
    }
  }

  function toggleUpcomingSelection(key: string) {
    setSelectedUpcomingKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleAllUpcoming(selectAll: boolean) {
    if (selectAll) {
      setSelectedUpcomingKeys(new Set(upcomingEvents.filter((e) => !e.alreadyImported).map((e) => `${e.sourceId}:${e.externalId}`)));
    } else {
      setSelectedUpcomingKeys(new Set());
    }
  }

  async function handleConfirmSelectiveSync() {
    const selected = upcomingEvents.filter((e) => selectedUpcomingKeys.has(`${e.sourceId}:${e.externalId}`));
    if (selected.length === 0) return;
    setSubmittingSelectiveSync(true);
    setError("");
    setMessage("");
    try {
      const res = await syncSelectedUpcomingEvents(selected);
      if (!res.success) {
        setError(res.error);
        return;
      }
      await onSyncComplete();
      setShowSyncModal(false);
      setMessage(`Sincronización completada: se han programado ${res.data.scheduled} eventos futuros.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No se pudieron programar los eventos.");
    } finally {
      setSubmittingSelectiveSync(false);
    }
  }

  // Panel de Substack en orden cronológico inverso
  async function openSubstackModal(source: SourceView) {
    setActiveSubstackSource(source);
    setLoadingSubstack(true);
    setSubstackMessage("");
    setSubstackError("");

    if (!persistent) {
      setSubstackPosts([
        {
          uid: "demo-post-1",
          title: "Publicación de demostración en Substack",
          url: source.url,
          publishedAt: "2026-11-09T08:00:00Z",
          formattedDate: "2026-11-09 08:00",
          description: "Esta es una publicación de ejemplo para verificar la visualización.",
          coverImage: null,
          alreadyImported: false,
        },
      ]);
      setLoadingSubstack(false);
      return;
    }

    try {
      const result = await fetchSubstackPostsForSource(source.id);
      if (!result.success) {
        setSubstackError(result.error);
        return;
      }
      setSubstackPosts(result.posts);
    } catch (caught) {
      setSubstackError(caught instanceof Error ? caught.message : "No se pudieron cargar las publicaciones.");
    } finally {
      setLoadingSubstack(false);
    }
  }

  async function handleGenerateSubstack(postUid: string) {
    if (!activeSubstackSource) return;
    setGeneratingPostUid(postUid);
    setSubstackMessage("");
    setSubstackError("");

    if (!persistent) {
      setSubstackPosts((prev) =>
        prev.map((p) => (p.uid === postUid ? { ...p, alreadyImported: true } : p)),
      );
      setSubstackMessage("Borradores generados con éxito en el modo de prueba.");
      setGeneratingPostUid(null);
      return;
    }

    try {
      const res = await generateDraftsForSubstackArticle(activeSubstackSource.id, postUid);
      if (!res.success) {
        setSubstackError(res.error);
        return;
      }
      setSubstackPosts((prev) =>
        prev.map((p) => (p.uid === postUid ? { ...p, alreadyImported: true } : p)),
      );
      await onSyncComplete();
      setSubstackMessage(`Borradores generados con éxito (${res.data.draftsCreated} publicaciones creadas).`);
    } catch (caught) {
      setSubstackError(caught instanceof Error ? caught.message : "No se pudieron generar los borradores.");
    } finally {
      setGeneratingPostUid(null);
    }
  }

  return (
    <section className={styles.settingsCard} aria-labelledby="sources-heading">
      <div className={styles.settingsTitle}>
        <span className={styles.settingsIcon}>
          <Rss size={16} aria-hidden="true" />
        </span>
        <div>
          <h3 id="sources-heading">Fuentes de eventos y publicaciones</h3>
          <p>Guarda las fuentes y elige qué cuentas y canales recibirán sus publicaciones.</p>
        </div>
      </div>

      <p className={styles.sourceNotice}>
        {persistent
          ? "La sincronización automática añade publicaciones futuras al día en que se procesan. Usa «Sincronizar ahora» para elegir qué eventos futuros programar."
          : "La demo guarda las fuentes en este navegador, pero no consulta feeds. Conecta Supabase para importar eventos."}
      </p>

      {sources.length === 0 ? (
        <p className={styles.sourceEmpty}>Aún no hay fuentes configuradas.</p>
      ) : (
        <div className={styles.sourceList}>
          {sources.map((source) => (
            <article className={styles.sourceCard} key={source.id}>
              <div className={styles.sourceCardTop}>
                <div>
                  <b>{source.name}</b>
                  <small>
                    {source.type === "luma_ical"
                      ? "Luma · iCal"
                      : source.type === "substack"
                      ? "Substack · feed"
                      : "Meetup · RSS"}
                  </small>
                </div>
                <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
                  {source.type === "substack" && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => { void openSubstackModal(source); }}
                      style={{ gap: 4 }}
                    >
                      Ver publicaciones <ExternalLink size={12} aria-hidden="true" />
                    </Button>
                  )}
                  <a
                    href={source.url}
                    target="_blank"
                    rel="noreferrer"
                    style={{ display: "inline-flex", alignItems: "center", gap: 4, color: "var(--primary)", fontSize: "13px", textDecoration: "none" }}
                  >
                    Abrir <ExternalLink size={12} aria-hidden="true" />
                  </a>
                </div>
              </div>
              <p className={styles.sourceUrl}>{source.url}</p>
              <p className={styles.sourceAccounts}>
                <b>Destinos:</b> {renderAccountChannelsSummary(source)}
              </p>
              <div className={styles.sourceActions}>
                <label>
                  <input
                    type="checkbox"
                    checked={source.enabled}
                    disabled={pending}
                    onChange={() => { void toggleSource(source); }}
                  />{" "}
                  Activa
                </label>
                <div style={{ display: "flex", gap: "6px" }}>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={pending}
                    onClick={() => startEditing(source)}
                    aria-label={`Editar fuente ${source.name}`}
                  >
                    Editar
                  </Button>
                  {(source.eventCount ?? 0) > 0 ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={pending || deletingSourceId === source.id}
                      title="Conserva los eventos y publicaciones importados"
                      onClick={() => { void removeSource(source, "retire"); }}
                      aria-label={`Retirar fuente ${source.name}`}
                    >
                      {deletingSourceId === source.id ? "Retirando…" : "Retirar"}
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={pending || deletingSourceId === source.id}
                      onClick={() => { void removeSource(source, "delete"); }}
                      aria-label={`Eliminar fuente ${source.name}`}
                      style={{ color: "var(--destructive)" }}
                    >
                      {deletingSourceId === source.id ? "Eliminando…" : "Eliminar"}
                    </Button>
                  )}
                </div>
              </div>
            </article>
          ))}
        </div>
      )}

      <div className={styles.sourceActions}>
        <Button
          type="button"
          disabled={!persistent || pending || previewingSync}
          onClick={() => { void openSyncModal(); }}
        >
          {previewingSync ? "Consultando eventos futuros…" : "Sincronizar ahora"}
        </Button>
        {!persistent && <small>La sincronización requiere Supabase configurado e iniciar sesión como propietario.</small>}
        {persistent && !sources.some((source) => source.enabled) && (
          <small>Sin fuentes activas, activa alguna para consultar eventos futuros.</small>
        )}
      </div>

      <form className={styles.sourceForm} onSubmit={(event) => { void addSource(event); }}>
        <h4>{editingSourceId ? `Editar fuente: ${draft.name || "Sin nombre"}` : "Añadir fuente"}</h4>
        <label className={styles.formLabel}>
          NOMBRE DE LA FUENTE
          <input
            aria-label="Nombre de la fuente"
            required
            maxLength={120}
            value={draft.name}
            onChange={(event) => setDraft({ ...draft, name: event.target.value })}
            placeholder="Ej. BarcelonaJS"
          />
        </label>
        <label className={styles.formLabel}>
          TIPO DE FUENTE
          <select
            aria-label="Tipo de fuente"
            value={draft.type}
            onChange={(event) => setDraft({ ...draft, type: event.target.value as SourceType })}
          >
            <option value="luma_ical">Luma iCal</option>
            <option value="substack">Substack</option>
            <option value="meetup">Meetup RSS</option>
          </select>
        </label>
        <label className={styles.formLabel}>
          {draft.type === "luma_ical"
            ? "URL DE SUSCRIPCIÓN ICAL"
            : draft.type === "substack"
            ? "URL DE FEED O POSTS DE SUBSTACK"
            : "URL DE FEED RSS O GRUPO DE MEETUP"}
          <input
            aria-label={
              draft.type === "luma_ical"
                ? "URL de suscripción iCal"
                : draft.type === "substack"
                ? "URL de Substack"
                : "URL de Meetup"
            }
            required
            type="url"
            maxLength={2000}
            value={draft.url}
            onChange={(event) => setDraft({ ...draft, url: event.target.value })}
            placeholder={
              draft.type === "luma_ical"
                ? "https://.../calendar.ics"
                : draft.type === "substack"
                ? "https://tu-blog.substack.com/feed"
                : "https://www.meetup.com/barcelonajug/events/rss/"
            }
          />
        </label>

        <fieldset className={styles.sourceAccountsFieldset}>
          <legend>ASOCIAR A CUENTAS Y ELEGIR CANALES</legend>
          {accounts.map((account) => {
            const id = account.id ?? account.name;
            const isAssociated = draft.accountIds.includes(id);
            const chosenNets = draft.accountNetworks[id] ?? [...account.networks];
            return (
              <div key={id} style={{ marginBottom: "12px", borderBottom: "1px solid var(--border-subtle)", paddingBottom: "10px" }}>
                <label style={{ fontWeight: 600, display: "inline-flex", alignItems: "center", gap: "6px" }}>
                  <input
                    type="checkbox"
                    disabled={pending || !accountsReady}
                    checked={isAssociated}
                    onChange={() => toggleAccount(id)}
                  />
                  {account.name} <small style={{ color: "var(--text-muted)", fontWeight: 400 }}>({account.kind})</small>
                </label>

                {isAssociated && account.networks.length > 0 && (
                  <div style={{ marginLeft: "24px", marginTop: "6px", display: "flex", gap: "12px", alignItems: "center", flexWrap: "wrap", fontSize: "13px" }}>
                    <span style={{ color: "var(--text-secondary)", fontWeight: 500 }}>Canales:</span>
                    {account.networks.map((net) => (
                      <label key={net} style={{ display: "inline-flex", alignItems: "center", gap: "4px", cursor: "pointer" }}>
                        <input
                          type="checkbox"
                          disabled={pending}
                          checked={chosenNets.includes(net)}
                          onChange={() => toggleAccountNetwork(id, net, account.networks)}
                        />
                        {net}
                      </label>
                    ))}
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      style={{ padding: "2px 8px", fontSize: "11px", height: "auto" }}
                      onClick={() => toggleAllNetworksForAccount(id, account.networks)}
                    >
                      {chosenNets.length === account.networks.length ? "Ninguno" : "Todos"}
                    </Button>
                  </div>
                )}
              </div>
            );
          })}
        </fieldset>

        <p className={styles.sourceHelp}>
          Al asociar una cuenta, se generarán recordatorios en sus canales para los eventos que provengan de esta fuente.
        </p>

        {error && <p role="alert" className={styles.sourceError}>{error}</p>}
        {message && <p role="status" className={styles.sourceSuccess}>{message}</p>}

        <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
          <Button type="submit" disabled={pending || accounts.length === 0 || !accountsReady}>
            {!accountsReady ? "Cargando cuentas…" : editingSourceId ? "Guardar cambios" : "Guardar fuente"}
          </Button>
          {editingSourceId && (
            <Button type="button" variant="outline" onClick={cancelEditing} disabled={pending}>
              Cancelar edición
            </Button>
          )}
        </div>
      </form>

      {/* Modal: Sincronizar ahora (selección de eventos futuros) */}
      <Dialog
        open={showSyncModal}
        onOpenChange={(open) => {
          if (!open && !submittingSelectiveSync) {
            setShowSyncModal(false);
          }
        }}
      >
        <DialogContent className={sourceStyles.modalContent}>
          <DialogHeader>
            <DialogTitle>Sincronizar eventos futuros</DialogTitle>
            <DialogDescription className={sourceStyles.modalDesc}>
              Elige los eventos futuros a la fecha de hoy detectados en tus fuentes para programar sus borradores:
            </DialogDescription>
          </DialogHeader>

          {previewingSync ? (
            <p className={sourceStyles.loadingState}>Consultando fuentes activas…</p>
          ) : upcomingEvents.length === 0 ? (
            <div className={sourceStyles.emptyState}>
              <p style={{ margin: "0 0 6px 0", fontWeight: 600 }}>No se encontraron nuevos eventos futuros.</p>
              <small>
                Todas las publicaciones y eventos en las fuentes activas ya fueron programados o tienen fecha anterior o igual a hoy.
              </small>
            </div>
          ) : (
            <div>
              <div className={sourceStyles.syncToolbar}>
                <small className={sourceStyles.syncEventMeta}>
                  {upcomingEvents.length} eventos futuros encontrados
                </small>
                <div style={{ display: "flex", gap: "8px" }}>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => toggleAllUpcoming(true)}
                  >
                    Seleccionar todos
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => toggleAllUpcoming(false)}
                  >
                    Deseleccionar
                  </Button>
                </div>
              </div>

              <div className={sourceStyles.syncList}>
                {upcomingEvents.map((ev) => {
                  const key = `${ev.sourceId}:${ev.externalId}`;
                  const isSelected = selectedUpcomingKeys.has(key);
                  return (
                    <div
                      key={key}
                      className={[
                        sourceStyles.syncEventItem,
                        ev.alreadyImported ? sourceStyles.syncEventItemImported : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                    >
                      <input
                        type="checkbox"
                        disabled={ev.alreadyImported || submittingSelectiveSync}
                        checked={isSelected}
                        onChange={() => toggleUpcomingSelection(key)}
                        style={{ marginTop: "4px" }}
                      />
                      <div style={{ flex: 1 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", gap: "8px" }}>
                          <span className={sourceStyles.syncEventTitle}>{ev.title}</span>
                          {ev.alreadyImported ? (
                            <Badge variant="secondary">Ya programado</Badge>
                          ) : (
                            <span className={sourceStyles.syncEventMeta}>
                              {ev.date} {ev.time}
                            </span>
                          )}
                        </div>
                        <small className={sourceStyles.syncEventSource}>
                          Fuente: {ev.sourceName} {ev.location ? `· ${ev.location}` : ""}
                        </small>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={submittingSelectiveSync}
              onClick={() => setShowSyncModal(false)}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              disabled={submittingSelectiveSync || selectedUpcomingKeys.size === 0}
              onClick={() => { void handleConfirmSelectiveSync(); }}
            >
              {submittingSelectiveSync
                ? "Programando…"
                : `Programar ${selectedUpcomingKeys.size} seleccionados`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal: Publicaciones de Substack en orden cronológico inverso */}
      <Dialog
        open={Boolean(activeSubstackSource)}
        onOpenChange={(open) => {
          if (!open) {
            setActiveSubstackSource(null);
          }
        }}
      >
        <DialogContent className={sourceStyles.modalContent}>
          <DialogHeader>
            <DialogTitle>
              Publicaciones de {activeSubstackSource?.name ?? ""}
            </DialogTitle>
            <DialogDescription className={sourceStyles.modalDesc}>
              Publicaciones en orden cronológico inverso. Elige cualquier publicación para generar sus posts en las cuentas y canales configurados:
            </DialogDescription>
          </DialogHeader>

          {substackMessage && <p role="status" className={styles.sourceSuccess}>{substackMessage}</p>}
          {substackError && <p role="alert" className={styles.sourceError}>{substackError}</p>}

          {loadingSubstack ? (
            <p className={sourceStyles.loadingState}>Cargando publicaciones desde Substack…</p>
          ) : substackPosts.length === 0 ? (
            <div className={sourceStyles.emptyState}>
              <p style={{ margin: 0 }}>No se encontraron artículos en este feed de Substack.</p>
            </div>
          ) : (
            <div className={sourceStyles.substackList}>
              {substackPosts.map((post) => (
                <article
                  key={post.uid}
                  className={sourceStyles.substackArticle}
                >
                  {post.coverImage && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={post.coverImage}
                      alt=""
                      className={sourceStyles.substackCover}
                    />
                  )}
                  <div className={sourceStyles.substackArticleBody}>
                    <div className={sourceStyles.substackArticleHeader}>
                      <h4 className={sourceStyles.substackArticleTitle}>{post.title}</h4>
                      <span className={sourceStyles.substackArticleDate}>
                        {post.formattedDate}
                      </span>
                    </div>
                    {post.description && (
                      <p className={sourceStyles.substackArticleExcerpt}>
                        {post.description.slice(0, 160)}…
                      </p>
                    )}
                    <div className={sourceStyles.substackArticleFooter}>
                      <a
                        href={post.url}
                        target="_blank"
                        rel="noreferrer"
                        className={sourceStyles.substackArticleLink}
                      >
                        Leer en Substack <ExternalLink size={12} aria-hidden="true" />
                      </a>
                      <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
                        {post.alreadyImported && (
                          <Badge variant="secondary">Borradores creados</Badge>
                        )}
                        <Button
                          type="button"
                          size="sm"
                          disabled={generatingPostUid === post.uid}
                          onClick={() => { void handleGenerateSubstack(post.uid); }}
                        >
                          {generatingPostUid === post.uid
                            ? "Generando…"
                            : post.alreadyImported
                            ? "Regenerar posts"
                            : "Generar posts"}
                        </Button>
                      </div>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setActiveSubstackSource(null)}
            >
              Cerrar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
