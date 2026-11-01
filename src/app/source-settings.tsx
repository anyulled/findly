"use client";

import { useState, type FormEvent } from "react";
import styles from "./page.module.css";
import { deleteSource, saveSource, setSourceEnabled, type AccountView, type SourceInput, type SourceType, type SourceView } from "./workspace-actions";

type Props = {
  accounts: AccountView[];
  sources: SourceView[];
  persistent: boolean;
  onSourcesChange: (sources: SourceView[]) => void;
  onSyncComplete: () => Promise<void>;
};

const emptySource = { name: "", type: "luma_ical" as SourceType, url: "", accountIds: [] as string[] };

export function SourceSettings({ accounts, sources, persistent, onSourcesChange, onSyncComplete }: Props) {
  const [draft, setDraft] = useState(emptySource);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const accountsReady = !persistent || accounts.some((a) => /^[0-9a-f-]{36}$/i.test(a.id ?? ""));

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
    const input: SourceInput = { ...draft, enabled: true };
    try {
      if (persistent) {
        const result = await saveSource(input);
        if (!result.success) {
          setError(result.error);
          return;
        }
        onSourcesChange([...sources, result.source]);
      } else {
        onSourcesChange([...sources, { ...input, enabled: true, id: crypto.randomUUID() }]);
      }
      setDraft(emptySource);
      setMessage("La fuente y sus cuentas asociadas se han guardado.");
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

  async function removeSource(source: SourceView) {
    setPending(true);
    setError("");
    try {
      if (persistent) {
        const result = await deleteSource(source.id);
        if (!result.success) {
          setError(result.error);
          return;
        }
      }
      onSourcesChange(sources.filter((item) => item.id !== source.id));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No se pudo eliminar la fuente.");
    } finally {
      setPending(false);
    }
  }

  function toggleAccount(accountId: string) {
    setDraft((current) => ({
      ...current,
      accountIds: current.accountIds.includes(accountId)
        ? current.accountIds.filter((id) => id !== accountId)
        : [...current.accountIds, accountId],
    }));
  }

  function accountLabel(accountId: string) {
    return accounts.find((account) => account.id === accountId || account.name === accountId)?.name ?? "Cuenta";
  }

  async function syncNow() {
    setPending(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/cron/sync", { method: "POST" });
      type Delivery = { scheduled: number; failed: number; needsReconciliation: number; errors: number; selected: number; deferred: number };
      const result = await response.json() as { sources?: number; feedsSucceeded?: number; feedsFailed?: number; eventsInserted?: number; draftsCreated?: number; issues?: unknown[]; error?: string; approvedRecovery?: Delivery; automaticDelivery?: Delivery };
      if (!response.ok && !result.approvedRecovery) throw new Error(result.error === "unauthorized" ? "Vuelve a iniciar sesión para sincronizar." : "No se pudo completar la sincronización. Comprueba la configuración del servidor.");
      await onSyncComplete();
      const issueCount = result.issues?.length ?? 0;
      const deliveries = [result.approvedRecovery, result.automaticDelivery].filter((item): item is Delivery => Boolean(item));
      const deliveryIssues = deliveries.reduce((sum, item) => sum + item.failed + item.needsReconciliation + item.errors, 0);
      const scheduled = deliveries.reduce((sum, item) => sum + item.scheduled, 0);
      const hasMore = deliveries.some((item) => item.deferred > 0 || item.selected >= 50);
      setMessage(`Sincronización terminada: ${result.feedsSucceeded ?? 0} fuentes consultadas, ${result.eventsInserted ?? 0} eventos nuevos, ${result.draftsCreated ?? 0} borradores creados y ${scheduled} aprobados programados.${issueCount || deliveryIssues ? " Hay incidencias en fuentes o envíos que revisar." : ""}${hasMore ? " Puede haber más aprobados pendientes; vuelve a sincronizar." : ""}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No se pudo completar la sincronización.");
    } finally {
      setPending(false);
    }
  }

  return <section className={styles.settingsCard} aria-labelledby="sources-heading">
    <div className={styles.settingsTitle}>
      <span className={styles.settingsIcon}>↗</span>
      <div><h3 id="sources-heading">Fuentes de eventos</h3><p>Guarda las fuentes y elige qué cuentas recibirán sus eventos.</p></div>
    </div>

    <p className={styles.sourceNotice}>{persistent ? "La sincronización importa eventos y publicaciones nuevas de fuentes Luma iCal, Meetup RSS y Substack activas. Para un evento o artículo individual, pega su URL en Añadir evento." : "La demo guarda las fuentes en este navegador, pero no consulta feeds. Conecta Supabase para importar eventos."}</p>

    {sources.length === 0 ? <p className={styles.sourceEmpty}>Aún no hay fuentes configuradas.</p> : <div className={styles.sourceList}>
      {sources.map((source) => <article className={styles.sourceCard} key={source.id}>
        <div className={styles.sourceCardTop}>
          <div><b>{source.name}</b><small>{source.type === "luma_ical" ? "Luma · iCal" : source.type === "substack" ? "Substack · feed" : "Meetup · RSS"}</small></div>
          <a href={source.url} target="_blank" rel="noreferrer">Abrir ↗</a>
        </div>
        <p className={styles.sourceUrl}>{source.url}</p>
        <p className={styles.sourceAccounts}><b>Cuentas:</b> {source.accountIds.map(accountLabel).join(", ") || "Sin cuentas"}</p>
        <div className={styles.sourceActions}>
          <label><input type="checkbox" checked={source.enabled} disabled={pending} onChange={() => { void toggleSource(source); }}/> Activa</label>
          <button type="button" className={styles.secondaryButton} disabled={pending} onClick={() => { void removeSource(source); }}>Eliminar</button>
        </div>
      </article>)}
    </div>}

    <div className={styles.sourceActions}>
      <button type="button" className={styles.approveButton} disabled={!persistent || pending} onClick={() => { void syncNow(); }}>{pending ? "Sincronizando…" : "Sincronizar ahora"}</button>
      {!persistent && <small>La sincronización requiere Supabase configurado e iniciar sesión como propietario.</small>}
      {persistent && !sources.some((source) => source.enabled) && <small>Sin fuentes activas, se recuperan las publicaciones aprobadas pendientes.</small>}
    </div>

    <form className={styles.sourceForm} onSubmit={(event) => { void addSource(event); }}>
      <h4>Añadir fuente</h4>
      <label className={styles.formLabel}>NOMBRE DE LA FUENTE
        <input aria-label="Nombre de la fuente" required maxLength={120} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="Ej. BarcelonaJS"/>
      </label>
      <label className={styles.formLabel}>TIPO DE FUENTE
        <select aria-label="Tipo de fuente" value={draft.type} onChange={(event) => setDraft({ ...draft, type: event.target.value as SourceType })}>
          <option value="luma_ical">Luma iCal</option>
          <option value="substack">Substack</option>
          <option value="meetup">Meetup RSS</option>
        </select>
      </label>
      <label className={styles.formLabel}>{draft.type === "luma_ical" ? "URL DE SUSCRIPCIÓN ICAL" : draft.type === "substack" ? "URL DE FEED O POSTS DE SUBSTACK" : "URL DE FEED RSS O GRUPO DE MEETUP"}
        <input aria-label={draft.type === "luma_ical" ? "URL de suscripción iCal" : draft.type === "substack" ? "URL de Substack" : "URL de Meetup"} required type="url" maxLength={2000} value={draft.url} onChange={(event) => setDraft({ ...draft, url: event.target.value })} placeholder={draft.type === "luma_ical" ? "https://.../calendar.ics" : draft.type === "substack" ? "https://tu-blog.substack.com/feed" : "https://www.meetup.com/barcelonajug/events/rss/"}/>
      </label>
      <fieldset className={styles.sourceAccountsFieldset}>
        <legend>ASOCIAR A CUENTAS</legend>
        {accounts.map((account) => {
          const id = account.id ?? account.name;
          return <label key={id}><input type="checkbox" disabled={pending || !accountsReady} checked={draft.accountIds.includes(id)} onChange={() => toggleAccount(id)}/>{account.name}</label>;
        })}
      </fieldset>
      <p className={styles.sourceHelp}>{draft.type === "luma_ical" ? "Puedes asociar una fuente a varias cuentas. Los feeds Luma iCal activos se consultan al sincronizar." : draft.type === "substack" ? "Los feeds de Substack (/feed o /api/v1/posts) importan artículos con título, descripción y miniatura, programándolos en el siguiente hueco disponible de cada canal en Buffer." : "Puedes pegar el feed RSS (https://www.meetup.com/grupo/events/rss/) o la URL del grupo de Meetup. Los eventos activos se importan y preparan sus borradores al sincronizar."}</p>
      {error && <p role="alert" className={styles.sourceError}>{error}</p>}
      {message && <p role="status" className={styles.sourceSuccess}>{message}</p>}
      <button className={styles.approveButton} type="submit" disabled={pending || accounts.length === 0 || !accountsReady}>
        {!accountsReady ? "Cargando cuentas…" : "Guardar fuente"}
      </button>
    </form>
  </section>;
}
