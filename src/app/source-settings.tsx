"use client";

import { useState, type FormEvent } from "react";
import styles from "./page.module.css";
import { confirmAsync } from "@/lib/confirm-dialog";
import type { SocialNetwork } from "@/lib/social-validation";
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

  // Substack publications modal state
  const [activeSubstackSource, setActiveSubstackSource] = useState<SourceView | null>(null);
  const [substackPosts, setSubstackPosts] = useState<SubstackPostItemView[]>([]);
  const [loadingSubstack, setLoadingSubstack] = useState(false);
  const [generatingPostUid, setGeneratingPostUid] = useState<string | null>(null);
  const [substackMessage, setSubstackMessage] = useState("");
  const [substackError, setSubstackError] = useState("");

  const accountsReady = !persistent || accounts.some((a) => /^[0-9a-f-]{36}$/i.test(a.id ?? ""));

  function startEditing(source: SourceView) {
    setEditingSourceId(source.id);
    setDraft({
      name: source.name,
      type: source.type,
      url: source.url,
      accountIds: [...source.accountIds],
      accountNetworks: { ...(source.accountNetworks ?? {}) },
    });
    setError("");
    setMessage("");
  }

  function cancelEditing() {
    setEditingSourceId(null);
    setDraft(emptySource);
    setError("");
  }

  async function addSource(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    setMessage("");
    if (draft.accountIds.length === 0) {
      setError("Asocia la fuente al menos a una cuenta.");
      setPending(false);
      return;
    }
    if (persistent && draft.accountIds.some((id) => !/^[0-9a-f-]{36}$/i.test(id))) {
      setError("Las cuentas aún no se han sincronizado con Supabase. Espera un momento.");
      setPending(false);
      return;
    }
    for (const accId of draft.accountIds) {
      const configuredNets = draft.accountNetworks[accId];
      if (configuredNets && configuredNets.length === 0) {
        const accName = accountLabel(accId);
        setError(`Selecciona al menos un canal para la cuenta «${accName}».`);
        setPending(false);
        return;
      }
    }
    const input: SourceInput = { ...draft, enabled: true };
    try {
      if (persistent) {
        const result = await saveSource(input, editingSourceId ?? undefined);
        if (!result.success) {
          setError(result.error);
          return;
        }
        if (editingSourceId) {
          onSourcesChange(sources.map((item) => (item.id === editingSourceId ? result.source : item)));
          setMessage(`Fuente «${result.source.name}» actualizada.`);
        } else {
          onSourcesChange([...sources, result.source]);
          setMessage("La fuente y sus cuentas asociadas se han guardado.");
        }
      } else {
        const fakeId = editingSourceId ?? crypto.randomUUID();
        const updatedSource: SourceView = { ...input, enabled: true, id: fakeId };
        if (editingSourceId) {
          onSourcesChange(sources.map((item) => (item.id === editingSourceId ? updatedSource : item)));
          setMessage(`Fuente «${updatedSource.name}» actualizada en memoria.`);
        } else {
          onSourcesChange([...sources, updatedSource]);
          setMessage("La fuente y sus cuentas asociadas se han guardado.");
        }
      }
      setDraft(emptySource);
      setEditingSourceId(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No se pudo guardar la fuente.");
    } finally {
      setPending(false);
    }
  }

  async function toggleSource(source: SourceView) {
    setPending(true);
    setError("");
    try {
      if (persistent) {
        const result = await setSourceEnabled(source.id, !source.enabled);
        if (!result.success) {
          setError(result.error);
          return;
        }
      }
      onSourcesChange(sources.map((item) => item.id === source.id ? { ...item, enabled: !item.enabled } : item));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No se pudo actualizar la fuente.");
    } finally {
      setPending(false);
    }
  }

  async function removeSource(source: SourceView, mode: "retire" | "delete") {
    if (pending || deletingSourceId) return;
    const verb = mode === "retire" ? "retirar" : "eliminar";
    const sourceTitle = source.name ? ` "${source.name}"` : "";
    const question = mode === "retire"
      ? `¿Retirar la fuente${sourceTitle}? Se conservarán sus eventos y publicaciones, pero ya no se sincronizará.`
      : `¿Eliminar la fuente${sourceTitle}? Ya no se sincronizarán sus eventos.`;
    const confirmed = await confirmAsync(question);
    if (!confirmed) {
      return;
    }
    setDeletingSourceId(source.id);
    setPending(true);
    setError("");
    setMessage("");
    try {
      if (persistent) {
        const result = mode === "retire" ? await retireSource(source.id) : await deleteSource(source.id);
        if (!result.success) {
          setError(result.error);
          return;
        }
      }
      onSourcesChange(sources.filter((item) => item.id !== source.id));
      if (editingSourceId === source.id) cancelEditing();
      setMessage(mode === "retire"
        ? `Fuente «${source.name}» retirada. Se conservan sus eventos y publicaciones.`
        : `Fuente «${source.name}» eliminada.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : `No se pudo ${verb} la fuente.`);
    } finally {
      setPending(false);
      setDeletingSourceId(null);
    }
  }

  function toggleAccount(accountId: string) {
    setDraft((current) => {
      const willBeIncluded = !current.accountIds.includes(accountId);
      const nextAccountIds = willBeIncluded
        ? [...current.accountIds, accountId]
        : current.accountIds.filter((id) => id !== accountId);

      const nextNetworks = { ...current.accountNetworks };
      if (willBeIncluded) {
        const acc = accounts.find((a) => (a.id ?? a.name) === accountId);
        nextNetworks[accountId] = acc?.networks ? [...acc.networks] : [];
      } else {
        delete nextNetworks[accountId];
      }

      return {
        ...current,
        accountIds: nextAccountIds,
        accountNetworks: nextNetworks,
      };
    });
  }

  function toggleAccountNetwork(accountId: string, network: SocialNetwork, allNetworks: SocialNetwork[]) {
    setDraft((current) => {
      const currentNets = current.accountNetworks[accountId] ?? [...allNetworks];
      const nextNets = currentNets.includes(network)
        ? currentNets.filter((n) => n !== network)
        : [...currentNets, network];
      return {
        ...current,
        accountNetworks: {
          ...current.accountNetworks,
          [accountId]: nextNets,
        },
      };
    });
  }

  function toggleAllNetworksForAccount(accountId: string, allNetworks: SocialNetwork[]) {
    setDraft((current) => {
      const currentNets = current.accountNetworks[accountId] ?? [...allNetworks];
      const nextNets = currentNets.length === allNetworks.length ? [] : [...allNetworks];
      return {
        ...current,
        accountNetworks: {
          ...current.accountNetworks,
          [accountId]: nextNets,
        },
      };
    });
  }

  function accountLabel(accountId: string) {
    return accounts.find((account) => account.id === accountId || account.name === accountId)?.name ?? "Cuenta";
  }

  function renderAccountChannelsSummary(source: SourceView) {
    if (source.accountIds.length === 0) return "Sin cuentas";
    return source.accountIds.map((accId) => {
      const name = accountLabel(accId);
      const acc = accounts.find((a) => (a.id ?? a.name) === accId);
      const totalPossible = acc?.networks?.length ?? 0;
      const configuredNets = source.accountNetworks?.[accId];
      if (!configuredNets || configuredNets.length === 0 || (totalPossible > 0 && configuredNets.length === totalPossible)) {
        return `${name} (Todos)`;
      }
      return `${name} (${configuredNets.join(", ")})`;
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
        <span className={styles.settingsIcon}>↗</span>
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
                    <button
                      type="button"
                      className={styles.secondaryButton}
                      style={{ padding: "4px 9px", fontSize: "13px" }}
                      onClick={() => { void openSubstackModal(source); }}
                    >
                      Ver publicaciones ↗
                    </button>
                  )}
                  <a href={source.url} target="_blank" rel="noreferrer">
                    Abrir ↗
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
                <button
                  type="button"
                  className={styles.secondaryButton}
                  disabled={pending}
                  onClick={() => startEditing(source)}
                  aria-label={`Editar fuente ${source.name}`}
                >
                  Editar
                </button>
                {(source.eventCount ?? 0) > 0 ? (
                  <button
                    type="button"
                    className={styles.secondaryButton}
                    disabled={pending || deletingSourceId === source.id}
                    title="Conserva los eventos y publicaciones importados"
                    onClick={() => { void removeSource(source, "retire"); }}
                    aria-label={`Retirar fuente ${source.name}`}
                  >
                    {deletingSourceId === source.id ? "Retirando…" : "Retirar"}
                  </button>
                ) : (
                  <button
                    type="button"
                    className={styles.secondaryButton}
                    disabled={pending || deletingSourceId === source.id}
                    onClick={() => { void removeSource(source, "delete"); }}
                    aria-label={`Eliminar fuente ${source.name}`}
                  >
                    {deletingSourceId === source.id ? "Eliminando…" : "Eliminar"}
                  </button>
                )}
              </div>
            </article>
          ))}
        </div>
      )}

      <div className={styles.sourceActions}>
        <button
          type="button"
          className={styles.approveButton}
          disabled={!persistent || pending || previewingSync}
          onClick={() => { void openSyncModal(); }}
        >
          {previewingSync ? "Consultando eventos futuros…" : "Sincronizar ahora"}
        </button>
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
              <div key={id} style={{ marginBottom: "12px", borderBottom: "1px solid #f0f0f4", paddingBottom: "10px" }}>
                <label style={{ fontWeight: 600, display: "inline-flex", alignItems: "center", gap: "6px" }}>
                  <input
                    type="checkbox"
                    disabled={pending || !accountsReady}
                    checked={isAssociated}
                    onChange={() => toggleAccount(id)}
                  />
                  {account.name} <small style={{ color: "#777", fontWeight: 400 }}>({account.kind})</small>
                </label>

                {isAssociated && account.networks.length > 0 && (
                  <div style={{ marginLeft: "24px", marginTop: "6px", display: "flex", gap: "12px", alignItems: "center", flexWrap: "wrap", fontSize: "13px" }}>
                    <span style={{ color: "#666", fontWeight: 500 }}>Canales:</span>
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
                    <button
                      type="button"
                      className={styles.secondaryButton}
                      style={{ padding: "2px 8px", fontSize: "11px", height: "auto" }}
                      onClick={() => toggleAllNetworksForAccount(id, account.networks)}
                    >
                      {chosenNets.length === account.networks.length ? "Ninguno" : "Todos"}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </fieldset>

        <p className={styles.sourceHelp}>
          {draft.type === "luma_ical"
            ? "Puedes asociar una fuente a varias cuentas y definir a qué canales de cada cuenta se publicará. Los feeds Luma iCal activos se consultan al sincronizar."
            : draft.type === "substack"
            ? "Para Substack, puedes consultar sus publicaciones en orden cronológico inverso y elegir cuáles programar en las redes y canales seleccionados."
            : "Puedes pegar el feed RSS o URL de Meetup. Permite elegir las redes específicas de cada cuenta vinculada."}
        </p>

        {error && <p role="alert" className={styles.sourceError}>{error}</p>}
        {message && <p role="status" className={styles.sourceSuccess}>{message}</p>}

        <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
          <button className={styles.approveButton} type="submit" disabled={pending || accounts.length === 0 || !accountsReady}>
            {!accountsReady ? "Cargando cuentas…" : editingSourceId ? "Guardar cambios" : "Guardar fuente"}
          </button>
          {editingSourceId && (
            <button type="button" className={styles.secondaryButton} onClick={cancelEditing} disabled={pending}>
              Cancelar edición
            </button>
          )}
        </div>
      </form>

      {/* Modal: Sincronizar ahora (selección de eventos futuros) */}
      {showSyncModal && (
        <div className={styles.overlay} onClick={() => { if (!submittingSelectiveSync) setShowSyncModal(false); }}>
          <div className={styles.modal} style={{ maxWidth: "680px" }} onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              className={styles.close}
              aria-label="Cerrar ventana"
              disabled={submittingSelectiveSync}
              onClick={() => setShowSyncModal(false)}
            >
              ×
            </button>
            <h2>Sincronizar eventos futuros</h2>
            <p className={styles.modalDesc}>
              Elige los eventos futuros a la fecha de hoy detectados en tus fuentes para programar sus borradores:
            </p>

            {previewingSync ? (
              <p style={{ textAlign: "center", padding: "24px 0", color: "#666" }}>Consultando fuentes activas…</p>
            ) : upcomingEvents.length === 0 ? (
              <div style={{ padding: "24px", background: "#f8f8fb", borderRadius: "8px", textAlign: "center" }}>
                <p style={{ margin: "0 0 6px 0", fontWeight: 600 }}>No se encontraron nuevos eventos futuros.</p>
                <small style={{ color: "#777" }}>
                  Todas las publicaciones y eventos en las fuentes activas ya fueron programados o tienen fecha anterior o igual a hoy.
                </small>
              </div>
            ) : (
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
                  <small style={{ color: "#666" }}>
                    {upcomingEvents.length} eventos futuros encontrados
                  </small>
                  <div style={{ display: "flex", gap: "8px" }}>
                    <button
                      type="button"
                      className={styles.secondaryButton}
                      style={{ padding: "3px 8px", fontSize: "12px" }}
                      onClick={() => toggleAllUpcoming(true)}
                    >
                      Seleccionar todos
                    </button>
                    <button
                      type="button"
                      className={styles.secondaryButton}
                      style={{ padding: "3px 8px", fontSize: "12px" }}
                      onClick={() => toggleAllUpcoming(false)}
                    >
                      Deseleccionar
                    </button>
                  </div>
                </div>

                <div style={{ maxHeight: "360px", overflowY: "auto", display: "flex", flexDirection: "column", gap: "10px" }}>
                  {upcomingEvents.map((ev) => {
                    const key = `${ev.sourceId}:${ev.externalId}`;
                    const isSelected = selectedUpcomingKeys.has(key);
                    return (
                      <div
                        key={key}
                        style={{
                          border: "1px solid #e7e6ec",
                          borderRadius: "8px",
                          padding: "12px",
                          background: ev.alreadyImported ? "#fbfbfe" : "#fff",
                          display: "flex",
                          gap: "12px",
                          alignItems: "flex-start",
                        }}
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
                            <b>{ev.title}</b>
                            {ev.alreadyImported ? (
                              <span style={{ fontSize: "11px", background: "#e8e7f5", color: "#6454c5", padding: "2px 6px", borderRadius: "4px" }}>
                                Ya programado
                              </span>
                            ) : (
                              <span style={{ fontSize: "12px", color: "#666" }}>
                                {ev.date} {ev.time}
                              </span>
                            )}
                          </div>
                          <small style={{ color: "#777", display: "block", marginTop: "3px" }}>
                            Fuente: {ev.sourceName} {ev.location ? `· ${ev.location}` : ""}
                          </small>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <div className={styles.modalActions}>
              <button
                type="button"
                className={styles.secondaryButton}
                disabled={submittingSelectiveSync}
                onClick={() => setShowSyncModal(false)}
              >
                Cancelar
              </button>
              <button
                type="button"
                className={styles.approveButton}
                disabled={submittingSelectiveSync || selectedUpcomingKeys.size === 0}
                onClick={() => { void handleConfirmSelectiveSync(); }}
              >
                {submittingSelectiveSync
                  ? "Programando…"
                  : `Programar ${selectedUpcomingKeys.size} seleccionados`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Publicaciones de Substack en orden cronológico inverso */}
      {activeSubstackSource && (
        <div className={styles.overlay} onClick={() => setActiveSubstackSource(null)}>
          <div className={styles.modal} style={{ maxWidth: "720px", maxHeight: "88vh" }} onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              className={styles.close}
              aria-label="Cerrar publicaciones de Substack"
              onClick={() => setActiveSubstackSource(null)}
            >
              ×
            </button>
            <h2>Publicaciones de {activeSubstackSource.name}</h2>
            <p className={styles.modalDesc}>
              Publicaciones en orden cronológico inverso. Elige cualquier publicación para generar sus posts en las cuentas y canales configurados:
            </p>

            {substackMessage && <p role="status" className={styles.sourceSuccess}>{substackMessage}</p>}
            {substackError && <p role="alert" className={styles.sourceError}>{substackError}</p>}

            {loadingSubstack ? (
              <p style={{ textAlign: "center", padding: "28px 0", color: "#666" }}>Cargando publicaciones desde Substack…</p>
            ) : substackPosts.length === 0 ? (
              <p style={{ textAlign: "center", padding: "28px 0", color: "#777" }}>No se encontraron artículos en este feed de Substack.</p>
            ) : (
              <div style={{ maxHeight: "420px", overflowY: "auto", display: "flex", flexDirection: "column", gap: "12px" }}>
                {substackPosts.map((post) => (
                  <article
                    key={post.uid}
                    style={{
                      border: "1px solid #e7e6ec",
                      borderRadius: "8px",
                      padding: "14px",
                      background: "#fff",
                      display: "flex",
                      gap: "14px",
                      alignItems: "flex-start",
                    }}
                  >
                    {post.coverImage && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={post.coverImage}
                        alt=""
                        style={{ width: "70px", height: "70px", objectFit: "cover", borderRadius: "6px", flexShrink: 0 }}
                      />
                    )}
                    <div style={{ flex: 1 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "8px" }}>
                        <h4 style={{ margin: 0, fontSize: "15px", lineHeight: 1.3 }}>{post.title}</h4>
                        <span style={{ fontSize: "12px", color: "#888", whiteSpace: "nowrap" }}>
                          {post.formattedDate}
                        </span>
                      </div>
                      {post.description && (
                        <p style={{ fontSize: "13px", color: "#666", margin: "6px 0 10px 0", lineHeight: 1.4 }}>
                          {post.description.slice(0, 160)}…
                        </p>
                      )}
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <a href={post.url} target="_blank" rel="noreferrer" style={{ fontSize: "13px" }}>
                          Leer en Substack ↗
                        </a>
                        <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
                          {post.alreadyImported && (
                            <span style={{ fontSize: "11px", background: "#e8e7f5", color: "#6454c5", padding: "2px 7px", borderRadius: "4px" }}>
                              Borradores creados
                            </span>
                          )}
                          <button
                            type="button"
                            className={styles.approveButton}
                            style={{ padding: "6px 12px", fontSize: "13px" }}
                            disabled={generatingPostUid === post.uid}
                            onClick={() => { void handleGenerateSubstack(post.uid); }}
                          >
                            {generatingPostUid === post.uid ? "Generando…" : post.alreadyImported ? "Regenerar posts" : "Generar posts"}
                          </button>
                        </div>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            )}

            <div className={styles.modalActions}>
              <button
                type="button"
                className={styles.secondaryButton}
                onClick={() => setActiveSubstackSource(null)}
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
