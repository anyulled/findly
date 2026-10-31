"use client";

import { useState, type FormEvent } from "react";
import styles from "./page.module.css";
import { deleteSource, saveSource, setSourceEnabled, type AccountView, type SourceInput, type SourceType, type SourceView } from "./workspace-actions";

type Props = {
  accounts: AccountView[];
  sources: SourceView[];
  persistent: boolean;
  onSourcesChange: (sources: SourceView[]) => void;
};

const emptySource = { name: "", type: "luma_ical" as SourceType, url: "", accountIds: [] as string[] };

export function SourceSettings({ accounts, sources, persistent, onSourcesChange }: Props) {
  const [draft, setDraft] = useState(emptySource);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function addSource(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    setMessage("");
    const input: SourceInput = { ...draft, enabled: true };
    try {
      const saved = persistent ? await saveSource(input) : { ...input, id: crypto.randomUUID() };
      onSourcesChange([...sources, saved]);
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
      if (persistent) await setSourceEnabled(source.id, !source.enabled);
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
      if (persistent) await deleteSource(source.id);
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

  return <section className={styles.settingsCard} aria-labelledby="sources-heading">
    <div className={styles.settingsTitle}>
      <span className={styles.settingsIcon}>↗</span>
      <div><h3 id="sources-heading">Fuentes de eventos</h3><p>Guarda las fuentes y elige qué cuentas recibirán sus eventos.</p></div>
    </div>

    <p className={styles.sourceNotice}>La configuración se guarda, pero la importación y extracción todavía no están conectadas.</p>

    {sources.length === 0 ? <p className={styles.sourceEmpty}>Aún no hay fuentes configuradas.</p> : <div className={styles.sourceList}>
      {sources.map((source) => <article className={styles.sourceCard} key={source.id}>
        <div className={styles.sourceCardTop}>
          <div><b>{source.name}</b><small>{source.type === "luma_ical" ? "Luma · iCal" : "Meetup · enlace"}</small></div>
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

    <form className={styles.sourceForm} onSubmit={(event) => { void addSource(event); }}>
      <h4>Añadir fuente</h4>
      <label className={styles.formLabel}>NOMBRE DE LA FUENTE
        <input aria-label="Nombre de la fuente" required maxLength={120} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="Ej. BarcelonaJS"/>
      </label>
      <label className={styles.formLabel}>TIPO DE FUENTE
        <select aria-label="Tipo de fuente" value={draft.type} onChange={(event) => setDraft({ ...draft, type: event.target.value as SourceType })}>
          <option value="luma_ical">Luma iCal</option>
          <option value="meetup">Meetup</option>
        </select>
      </label>
      <label className={styles.formLabel}>{draft.type === "luma_ical" ? "URL DE SUSCRIPCIÓN ICAL" : "URL DEL GRUPO O EVENTO DE MEETUP"}
        <input aria-label={draft.type === "luma_ical" ? "URL de suscripción iCal" : "URL de Meetup"} required type="url" maxLength={2000} value={draft.url} onChange={(event) => setDraft({ ...draft, url: event.target.value })} placeholder={draft.type === "luma_ical" ? "https://.../calendar.ics" : "https://www.meetup.com/..."}/>
      </label>
      <fieldset className={styles.sourceAccountsFieldset}>
        <legend>ASOCIAR A CUENTAS</legend>
        {accounts.map((account) => {
          const id = account.id ?? account.name;
          return <label key={id}><input type="checkbox" checked={draft.accountIds.includes(id)} onChange={() => toggleAccount(id)}/>{account.name}</label>;
        })}
      </fieldset>
      <p className={styles.sourceHelp}>Puedes asociar una fuente a varias cuentas. Esta versión solo guarda la configuración; todavía no consulta iCal ni extrae eventos de Meetup.</p>
      {error && <p role="alert" className={styles.sourceError}>{error}</p>}
      {message && <p role="status" className={styles.sourceSuccess}>{message}</p>}
      <button className={styles.approveButton} type="submit" disabled={pending || accounts.length === 0}>Guardar fuente</button>
    </form>
  </section>;
}
