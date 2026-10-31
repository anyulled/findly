"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import styles from "./page.module.css";
import { validatePost } from "@/lib/social-validation";
import { isSupabaseConfigured } from "@/lib/supabase/client";
import { detectTitleLanguage, type PostLanguage } from "@/lib/language";
import { approvePost, confirmPostMissingFromBuffer, createEvent, generateReviewPosts, loadWorkspace, reconcileScheduledPost, retryFailedPost, saveBufferChannel, updateAccountVoice, updatePostContent, updatePublishingMode, type SourceView } from "./workspace-actions";
import { SourceSettings } from "./source-settings";
import Image from "next/image";
import { sourceForEventUrl } from "@/lib/event-source";
import { hasMissingReminders, selectEventAccounts } from "@/lib/event-targets";

type Range = "Quincena" | "Semana" | "Mes";
type Status = "review" | "approved" | "scheduling" | "scheduled" | "published" | "failed" | "needs_reconciliation";
type Network = "LinkedIn" | "X" | "Bluesky";
type EventItem = { id: string; title: string; date: string; time: string; place: string; description: string; source: string; sourceId?: string | null; url?: string; language?: PostLanguage; };
type Post = { id: string; eventId: string; date: string; time: string; account: string; accountId?: string; network: Network; text: string; status: Status; leadDays?: 14 | 7 | 1; language?: PostLanguage; lastError?: string | null; bufferPostId?: string | null; };
type Account = { id?: string; enabled?: boolean; name: string; kind: string; initials: string; color: string; logo: string; bufferApiKeyEnv: string; bufferApiKeyConfigured: boolean; prompt: string; networks: Network[]; bufferChannels: Partial<Record<Network, string>>; styleExampleCount: number; };

const statusLabels: Record<Status, string> = {
  review: "Pendiente de revisión",
  approved: "Aprobada",
  scheduling: "Enviando",
  scheduled: "Programada",
  published: "Publicada",
  failed: "Fallida",
  needs_reconciliation: "Pendiente de conciliación",
};

const accounts: Account[] = [
  { name: "Personal", kind: "Cuenta personal", initials: "P", color: "violet", logo: "/account-logos/personal.svg", bufferApiKeyEnv: "BUFFER_API_KEY_PERSONAL", bufferApiKeyConfigured: false, prompt: "Cercano, curioso y directo. Primera persona. Evita sonar promocional.", networks: ["LinkedIn", "X", "Bluesky"], bufferChannels: {}, styleExampleCount: 0 },
  { name: "Barcelona JUG", kind: "Asociación", initials: "J", color: "orange", logo: "/account-logos/barcelona-jug.webp", bufferApiKeyEnv: "BUFFER_API_KEY_BARCELONA_JUG", bufferApiKeyConfigured: false, prompt: "Comunidad tecnológica abierta. Entusiasta, inclusiva y concreta.", networks: ["LinkedIn", "X"], bufferChannels: {}, styleExampleCount: 0 },
  { name: "Software Crafters Barcelona", kind: "Asociación", initials: "S", color: "green", logo: "/account-logos/software-crafters-barcelona.png", bufferApiKeyEnv: "BUFFER_API_KEY_SOFTWARE_CRAFTERS_BARCELONA", bufferApiKeyConfigured: false, prompt: "Tono profesional y acogedor. Destaca la comunidad y el aprendizaje.", networks: ["LinkedIn", "Bluesky"], bufferChannels: {}, styleExampleCount: 0 },
];

const initialEvents: EventItem[] = [
  { id: "evt-1", title: "BarcelonaJS · Holiday Meetup", date: "2026-12-10", time: "19:00", place: "Barcelona", description: "Una tarde para compartir charlas cortas, conocer a la comunidad y cerrar el año con JavaScript.", source: "Luma" },
  { id: "evt-2", title: "DevBcn Community Night", date: "2026-11-19", time: "18:30", place: "Barcelona", description: "Nos reunimos para hablar de tecnología, conectar con otros profesionales y compartir ideas.", source: "Meetup" },
  { id: "evt-3", title: "AI Builders: From idea to product", date: "2026-11-27", time: "18:00", place: "Barcelona", description: "Tres equipos presentan lo que han construido. Demos, conversación y comunidad.", source: "Luma" },
  { id: "evt-4", title: "Frontend friends coffee", date: "2026-11-06", time: "09:30", place: "Barcelona", description: "Café informal para charlar de frontend y conocer a más gente de la ciudad.", source: "Manual" },
];

function dateAt(date: string) { const [y, m, d] = date.split("-").map(Number); return new Date(y, m - 1, d); }
function dayKey(d: Date) { return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, "0"), String(d.getDate()).padStart(2, "0")].join("-"); }
function monday(d: Date) { const n = new Date(d); n.setDate(n.getDate() - ((n.getDay() + 6) % 7)); n.setHours(0, 0, 0, 0); return n; }
function makeDates(anchor: Date, range: Range) {
  const start = range === "Mes" ? new Date(anchor.getFullYear(), anchor.getMonth(), 1) : monday(anchor);
  if (range === "Mes") start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  const count = range === "Semana" ? 7 : range === "Quincena" ? 14 : 42;
  return Array.from({ length: count }, (_, i) => { const d = new Date(start); d.setDate(d.getDate() + i); return d; });
}
function madridClock() {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date());
  return Object.fromEntries(parts.map(({ type, value }) => [type, value])) as Record<string, string>;
}
function scheduleDates(eventDate: string) {
  const event = dateAt(eventDate);
  const madrid = madridClock();
  const today = `${madrid.year}-${madrid.month}-${madrid.day}`;
  const nowMinutes = Number(madrid.hour) * 60 + Number(madrid.minute);
  return [14, 7, 1].map((leadDays) => { const date = new Date(event); date.setDate(date.getDate() - leadDays); return { date, leadDays: leadDays as 14 | 7 | 1 }; })
    .filter(({ date }) => dayKey(date) > today || (dayKey(date) === today && nowMinutes < 13 * 60));
}
function starterPosts(events: EventItem[], targetAccounts: Account[] = accounts): Post[] {
  return events.flatMap((event) => scheduleDates(event.date).flatMap(({ date, leadDays }) => targetAccounts.flatMap((account) => account.networks.map((network) => {
    const language = event.language ?? detectTitleLanguage(event.title);
    const until = language === "en"
      ? leadDays === 14 ? "in two weeks" : leadDays === 7 ? "next week" : "tomorrow"
      : language === "es"
        ? leadDays === 14 ? "dentro de dos semanas" : leadDays === 7 ? "dentro de una semana" : "mañana"
        : leadDays === 14 ? "d’aquí a dues setmanes" : leadDays === 7 ? "d’aquí a una setmana" : "demà";
    const text = language === "en"
      ? `Join us ${until} for ${event.title} in ${event.place}. See you there! ${event.url ?? ""}`.trim()
      : language === "es"
        ? `¡Nos vemos ${until} en ${event.title}! Te esperamos en ${event.place}. ${event.url ?? ""}`.trim()
        : `Ens veiem ${until} a ${event.title}! T’hi esperem a ${event.place}. ${event.url ?? ""}`.trim();
    return {
    id: event.id + "-" + dayKey(date) + "-" + account.initials + "-" + network,
    eventId: event.id, date: dayKey(date), time: "13:00", account: account.name, accountId: account.id, network, leadDays, language,
    text,
    status: "review" as Status,
    };}))))
}
const initialPosts = starterPosts(initialEvents);

function Dashboard() {
  const [tab, setTab] = useState("Calendario");
  const [range, setRange] = useState<Range>("Quincena");
  const [anchor, setAnchor] = useState(() => new Date());
  const [expandedDay, setExpandedDay] = useState<string | null>(null);
  const firstRevealedPost = useRef<HTMLButtonElement>(null);
  const [events, setEvents] = useState(initialEvents);
  const [accountList, setAccountList] = useState(accounts);
  const [sources, setSources] = useState<SourceView[]>([]);
  const [posts, setPosts] = useState(initialPosts);
  const [mode, setMode] = useState<"review" | "automatic">("review");
  const [bufferApiKeyConfigured, setBufferApiKeyConfigured] = useState(false);
  const [selected, setSelected] = useState<Post | null>(null);
  const [editing, setEditing] = useState("");
  const [reconciliationId, setReconciliationId] = useState("");
  const [absenceConfirmed, setAbsenceConfirmed] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [newEvent, setNewEvent] = useState({ title: "", date: "", time: "", place: "", description: "", source: "Manual" });
  const [sourceUrl, setSourceUrl] = useState("");
  const [extractingEvent, setExtractingEvent] = useState(false);
  const [extractionMessage, setExtractionMessage] = useState("");
  const extractionRequestId = useRef(0);
  const addFormOpen = useRef(false);
  const [hydrated, setHydrated] = useState(false);
  const [feedback, setFeedback] = useState("");
  const persistent = isSupabaseConfigured();

  useEffect(() => {
    if (expandedDay) firstRevealedPost.current?.focus();
  }, [expandedDay]);

  function openAddForm() {
    extractionRequestId.current += 1;
    addFormOpen.current = true;
    setShowAdd(true);
  }
  function closeAddForm() {
    extractionRequestId.current += 1;
    addFormOpen.current = false;
    setExtractingEvent(false);
    setShowAdd(false);
  }

  // This effect runs once to hydrate browser-only demo state after mount.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (persistent) {
      let active = true;
      void loadWorkspace().then((snapshot) => {
        if (!active) return;
        setEvents(snapshot.events);
        setPosts(snapshot.posts);
        setMode(snapshot.mode);
        setBufferApiKeyConfigured(snapshot.accounts.every((account) => account.bufferApiKeyConfigured));
        setAccountList(snapshot.accounts);
        setSources(snapshot.sources);
        setHydrated(true);
      }).catch((error: unknown) => {
        if (!active) return;
        setFeedback(error instanceof Error ? error.message : "No se pudieron cargar los datos.");
        setHydrated(true);
      });
      return () => { active = false; };
    }
    const saved = localStorage.getItem("findly-state-v1");
    if (saved) {
      try { const value = JSON.parse(saved); setEvents(value.events ?? initialEvents); setPosts(value.posts ?? initialPosts); setMode(value.mode ?? "review"); setAccountList(value.accounts ?? accounts); setSources(value.sources ?? []); }
      catch { localStorage.removeItem("findly-state-v1"); }
    }
    setHydrated(true);
  }, [persistent]);
  /* eslint-enable react-hooks/set-state-in-effect */
  useEffect(() => { if (!persistent && hydrated) localStorage.setItem("findly-state-v1", JSON.stringify({ events, posts, mode, accounts: accountList, sources })); }, [events, posts, mode, accountList, sources, hydrated, persistent]);

  const dates = useMemo(() => makeDates(anchor, range), [anchor, range]);
  const first = dates[0];
  const last = dates[dates.length - 1];
  const monthLabel = range === "Mes" ? first.toLocaleDateString("es-ES", { month: "long", year: "numeric" }) : `${first.toLocaleDateString("es-ES", { day: "numeric", month: "short" })} – ${last.toLocaleDateString("es-ES", { day: "numeric", month: "short", year: "numeric" })}`;
  const reviewCount = posts.filter((p) => p.status === "review").length;

  function navigate(direction: number) {
    const next = new Date(anchor);
    next.setDate(next.getDate() + (range === "Mes" ? 28 : range === "Quincena" ? 14 : 7) * direction);
    setAnchor(next);
  }
  async function updatePost(post: Post, next: Partial<Post>) {
    const content = next.text ?? post.text;
    let changes = next;
    if (persistent) {
      if (next.status === "approved") {
        const outcome = await approvePost(post.id, content);
        if (outcome.kind === "not_claimed") {
          await refreshWorkspaceAfterSync();
          setFeedback("No se pudo reservar la publicación. Revisa su estado y la cuenta asociada a la fuente.");
          return;
        }
        const status: Status = outcome.kind === "scheduled" ? "scheduled" : outcome.kind === "failed" ? "failed" : outcome.kind === "needs_reconciliation" ? "needs_reconciliation" : "scheduling";
        const message = "message" in outcome ? outcome.message : null;
        changes = { ...next, status, lastError: message };
        setAccountList((all) => all.map((account) => account.id === post.accountId
          ? { ...account, styleExampleCount: (persistent ? account.styleExampleCount : posts.filter((item) => item.accountId === post.accountId && item.status === "approved").length) + 1 }
          : account));
        setFeedback(status === "scheduled" ? "Publicación aprobada y programada en Buffer." : status === "needs_reconciliation" ? "Buffer pudo aceptar la publicación. Comprueba su cola antes de reintentar." : status === "failed" ? `La publicación se aprobó, pero Buffer la rechazó: ${message ?? "comprueba la configuración"}` : "La publicación está en proceso de envío.");
      }
      else if (next.text !== undefined) await updatePostContent(post.id, content);
    }
    if (!persistent && next.status === "approved") {
      setAccountList((all) => all.map((account) => account.name === post.account
        ? { ...account, styleExampleCount: posts.filter((item) => item.account === post.account && item.status === "approved").length + 1 }
        : account));
    }
    setPosts((all) => all.map((item) => item.id === post.id ? { ...item, ...changes } : item));
    if (selected) setSelected({ ...selected, ...changes });
  }
  async function addEvent() {
    if (extractingEvent) return;
    if (!newEvent.title.trim() || !newEvent.date || !newEvent.time) return;
    let parsedUrl: URL | null = null;
    try {
      const candidate = new URL(sourceUrl.trim());
      if (candidate.protocol === "https:" || candidate.protocol === "http:") parsedUrl = candidate;
    } catch { /* A missing or invalid link falls back to manual event entry. */ }
    const source = sourceForEventUrl(parsedUrl?.toString());
    const draftEvent = { ...newEvent, source, url: parsedUrl?.toString() };
    let savedEvent: EventItem | null = null;
    try {
      const event = persistent ? await createEvent(draftEvent) : { ...draftEvent, id: "evt-" + Date.now(), language: detectTitleLanguage(draftEvent.title) };
      if (persistent) savedEvent = event;
      setEvents((all) => [event, ...all]);
      if (persistent) {
        const savedPosts = await generateReviewPosts(event.id);
        setPosts((all) => [...all, ...savedPosts]);
      } else setPosts((all) => [...all, ...starterPosts([event], accountList)]);
      setFeedback("");
    } catch (error) {
      if (savedEvent) {
        setFeedback(`El evento quedó guardado, pero no se guardaron todos sus borradores. Puedes reintentarlo desde la ficha del evento. ${error instanceof Error ? error.message : ""}`);
        closeAddForm();
        setNewEvent({ title: "", date: "", time: "", place: "", description: "", source: "Manual" });
        setSourceUrl("");
        setExtractionMessage("");
        setTab("Eventos");
      } else {
        setFeedback(error instanceof Error ? error.message : "No se pudo guardar el evento.");
      }
      return;
    }
    closeAddForm();
    setNewEvent({ title: "", date: "", time: "", place: "", description: "", source: "Manual" });
    setSourceUrl("");
    setExtractionMessage("");
    setTab("Eventos");
  }

  async function extractEventFromUrl() {
    if (!sourceUrl.trim()) return;
    const requestId = ++extractionRequestId.current;
    const requestedUrl = sourceUrl;
    setExtractingEvent(true);
    setExtractionMessage("");
    try {
      const response = await fetch("/api/events/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: requestedUrl }),
      });
      const payload = await response.json() as { event?: typeof newEvent & { url: string }; missingFields?: string[]; error?: string };
      if (!response.ok || !payload.event || !payload.missingFields) throw new Error(payload.error ?? "No se pudieron extraer los datos del evento.");
      if (requestId !== extractionRequestId.current || !addFormOpen.current) return;
      const result = { event: payload.event, missingFields: payload.missingFields };
      setNewEvent((current) => ({
        ...current,
        ...result.event,
        source: sourceForEventUrl(result.event.url),
      }));
      setSourceUrl(result.event.url);
      setExtractionMessage(result.missingFields.length === 0
        ? "Datos extraídos. Revísalos antes de crear el evento."
        : `Extraje lo disponible; completa estos campos: ${result.missingFields.map((field) => ({ date: "fecha", time: "hora", place: "lugar", description: "descripción" })[field]).join(", ")}.`);
    } catch (error) {
      if (requestId !== extractionRequestId.current || !addFormOpen.current) return;
      setExtractionMessage(error instanceof Error ? error.message : "No se pudieron extraer los datos del evento.");
    } finally {
      if (requestId === extractionRequestId.current && addFormOpen.current) setExtractingEvent(false);
    }
  }

  async function retryDrafts(event: EventItem) {
    try {
      if (!persistent) return;
      const saved = await generateReviewPosts(event.id);
      if (saved.length === 0) {
        setFeedback("Este evento no tiene recordatorios futuros que se puedan crear.");
        return;
      }
      setPosts((all) => [...new Map([...all, ...saved].map((post) => [post.id, post])).values()]);
      setFeedback("Se han sincronizado los borradores de recordatorio.");
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "No se pudieron crear los borradores.");
    }
  }

  async function refreshWorkspaceAfterSync() {
    const snapshot = await loadWorkspace();
    setEvents(snapshot.events);
    setPosts(snapshot.posts);
    setMode(snapshot.mode);
    setAccountList(snapshot.accounts);
    setSources(snapshot.sources);
  }

  async function changeMode(nextMode: "review" | "automatic") {
    try {
      if (persistent) await updatePublishingMode(nextMode);
      setMode(nextMode);
      setFeedback("");
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "No se pudo guardar el modo.");
    }
  }

  async function changeVoice(account: Account, prompt: string) {
    setAccountList((all) => all.map((item) => item.id === account.id ? { ...item, prompt } : item));
    if (persistent && account.id) {
      try {
        await updateAccountVoice(account.id, prompt);
        setFeedback("");
      } catch (error) {
        setFeedback(error instanceof Error ? error.message : "No se pudo guardar el tono.");
      }
    }
  }

  async function changeBufferChannel(account: Account, network: Network, value: string) {
    if (!account.id) return;
    try {
      if (persistent) await saveBufferChannel(account.id, network, value);
      setAccountList((all) => all.map((item) => item.id === account.id
        ? { ...item, bufferChannels: { ...item.bufferChannels, [network]: value.trim() } }
        : item));
      setFeedback("");
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "No se pudo guardar el canal de Buffer.");
    }
  }

  async function retryPost(post: Post) {
    try {
      const outcome = await retryFailedPost(post.id);
      if (outcome.kind === "not_claimed") {
        await refreshWorkspaceAfterSync();
        setSelected(null);
        setFeedback("No se pudo reservar la publicación. Revisa su estado y la cuenta asociada a la fuente.");
        return;
      }
      const status: Status = outcome.kind === "scheduled" ? "scheduled" : outcome.kind === "failed" ? "failed" : outcome.kind === "needs_reconciliation" ? "needs_reconciliation" : "scheduling";
      const message = "message" in outcome ? outcome.message : null;
      const changes: Partial<Post> = { status, lastError: message };
      setPosts((all) => all.map((item) => item.id === post.id ? { ...item, ...changes } : item));
      if (selected?.id === post.id) setSelected({ ...selected, ...changes });
      setFeedback(status === "scheduled" ? "Publicación programada en Buffer." : status === "needs_reconciliation" ? "Comprueba la cola de Buffer antes de reintentar." : status === "failed" ? `Buffer rechazó la publicación: ${message ?? "comprueba la configuración"}` : "La publicación está en proceso de envío.");
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "No se pudo reintentar la publicación.");
    }
  }

  async function confirmReconciledPost(post: Post) {
    try {
      await reconcileScheduledPost(post.id, reconciliationId);
      const changes: Partial<Post> = { status: "scheduled", bufferPostId: reconciliationId.trim(), lastError: null };
      setPosts((all) => all.map((item) => item.id === post.id ? { ...item, ...changes } : item));
      setSelected({ ...post, ...changes });
      setReconciliationId("");
      setFeedback("Post encontrado en Buffer y marcado como programado.");
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "No se pudo guardar la conciliación.");
    }
  }

  async function confirmPostAbsent(post: Post) {
    try {
      await confirmPostMissingFromBuffer(post.id);
      const changes: Partial<Post> = { status: "failed", lastError: "Has confirmado que no aparece en la cola de Buffer." };
      setPosts((all) => all.map((item) => item.id === post.id ? { ...item, ...changes } : item));
      setSelected({ ...post, ...changes });
      setAbsenceConfirmed(false);
      setFeedback("La ausencia quedó confirmada. Puedes corregir el post y reintentar el envío.");
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "No se pudo guardar la conciliación.");
    }
  }

  async function savePostChanges(post: Post, next: Partial<Post>) {
    try {
      await updatePost(post, next);
      setSelected(null);
      if (next.status !== "approved") setFeedback("");
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "No se pudo guardar la publicación.");
    }
  }

  const side = ["Calendario", "Eventos", "Cuentas", "Ajustes"];
  const currentEvent = selected ? events.find((event) => event.id === selected.eventId) : null;
  const postValidation = selected ? validatePost(selected.network, editing) : null;

  if (!hydrated) return <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", color: "#777782", background: "#fbfaf8" }}>Cargando espacio…</main>;

  return <main className={styles.shell}>
    <aside className={styles.sidebar}>
      <div className={styles.brand}><span className={styles.brandMark}>f</span><span>findly<span className={styles.brandDot}>.</span></span></div>
      <div className={styles.workspace}><div className={styles.workspaceIcon}>✳</div><div><b>Mi espacio</b><small>3 cuentas conectadas</small></div><span className={styles.chevron}>⌄</span></div>
      <p className={styles.navLabel}>ESPACIO DE TRABAJO</p>
      <nav>{side.map((item, i) => <button key={item} onClick={() => setTab(item)} className={tab === item ? styles.navActive : styles.navItem}><span className={styles.navIcon}>{["▦", "◷", "♙", "⚙"][i]}</span>{item}{item === "Eventos" && <span className={styles.navCount}>{events.length}</span>}{item === "Calendario" && reviewCount > 0 && <span className={styles.navCount}>{reviewCount}</span>}</button>)}</nav>
      <div className={styles.sidebarBottom}><div className={styles.planCard}><div className={styles.planIcon}>✦</div><b>Tu contenido, en orden</b><p>Todo lo que necesitas para que cada evento llegue a más gente.</p><button onClick={() => setTab("Ajustes")}>Configurar espacio <span>→</span></button></div><div className={styles.profile}><div className={styles.avatar}>A</div><div><b>Alex</b><small>Administrador</small></div><span className={styles.chevron}>···</span></div></div>
    </aside>

    <section className={styles.main}>
      <header className={styles.topbar}><div className={styles.breadcrumb}>Workspace <span>/</span> <b>{tab}</b></div><div className={styles.topActions}><span className={styles.tz}>◷ &nbsp;Europe/Madrid</span><button className={styles.helpBtn}>? <span>Ayuda</span></button><button className={styles.addButton} onClick={openAddForm}><span>＋</span> Añadir evento</button></div></header>
      <div className={styles.content}>
        {tab === "Calendario" && <><div className={styles.pageHeading}><div><div className={styles.eyebrow}>TU CONTENIDO, DE UN VISTAZO</div><h1>Calendario</h1><p>Todos tus anuncios, en un solo lugar.</p></div><button className={styles.mobileAdd} onClick={openAddForm}>＋ Evento</button></div>
          {!persistent && <div className={styles.notice}><span className={styles.noticeIcon}>✦</span><div><b>Modo demostración</b><span>Los cambios se guardan en este navegador. Configura Supabase para usar persistencia compartida.</span></div><button onClick={() => setTab("Ajustes")}>Ver configuración <span>→</span></button></div>}
          {persistent && <div className={styles.notice}><span className={styles.noticeIcon}>✓</span><div><b>Datos guardados en Supabase</b><span>Los recordatorios se programan por Buffer al aprobarlos o al generarlos en modo automático. Los resultados inciertos requieren conciliación manual.</span></div><button onClick={() => setTab("Ajustes")}>Ver configuración <span>→</span></button></div>}
          {feedback && <p role="alert" style={{ color: "#a43a32", background: "#fff1f0", borderRadius: 8, padding: "10px 14px" }}>{feedback}</p>}
          <div className={styles.calendarToolbar}><div className={styles.period}><button onClick={() => navigate(-1)} aria-label="Periodo anterior">‹</button><button onClick={() => setAnchor(new Date())} className={styles.today}>Hoy</button><button onClick={() => navigate(1)} aria-label="Periodo siguiente">›</button><h2>{monthLabel}</h2></div><div className={styles.viewToggle}>{(["Quincena", "Semana", "Mes"] as Range[]).map((opt) => <button key={opt} onClick={() => setRange(opt)} className={range === opt ? styles.viewSelected : ""} aria-pressed={range === opt}>{opt}</button>)}</div></div>
          <div className={styles.calendar}>
            <div className={styles.weekdays}>{["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"].map((d) => <div key={d}>{d}</div>)}</div>
            <div className={styles.days} data-testid="calendar-days">{dates.map((date) => {
              const key = dayKey(date); const offMonth = range === "Mes" && date.getMonth() !== anchor.getMonth(); const dayPosts = posts.filter((p) => p.date === key).sort((a, b) => a.time.localeCompare(b.time));
              const expanded = expandedDay === key;
              const visiblePosts = expanded ? dayPosts : dayPosts.slice(0, 3);
              return <div key={key} data-testid="calendar-day" data-calendar-date={key} className={`${styles.day} ${offMonth ? styles.offMonth : ""} ${key === dayKey(new Date()) ? styles.isToday : ""}`}>
                <div className={styles.dayHeader}><span>{date.getDate()}</span>{dayPosts.length > 0 && <small>{dayPosts.length}</small>}</div>
                <div className={styles.dayPosts} id={`posts-${key}`}>
                  {visiblePosts.map((post, index) => {
                    const event = events.find((e) => e.id === post.eventId);
                    const title = event?.title ?? "Publicación";
                    return <button key={post.id} ref={expanded && index === 3 ? firstRevealedPost : undefined} className={`${styles.postPill} ${styles["post" + post.status]}`} onClick={() => { setSelected(post); setEditing(post.text); setReconciliationId(""); setAbsenceConfirmed(false); }} aria-label={`${title} · ${post.account} · ${post.network} · ${statusLabels[post.status]}`} title={title}>
                      <span className={styles.networkDot}>{post.network === "LinkedIn" ? "in" : post.network === "X" ? "𝕏" : "b"}</span>
                      <span className={styles.postDescription}><span className={styles.pillText}>{title}</span>{expanded && <span className={styles.postMeta}>{post.account} · {post.network} · {statusLabels[post.status]}</span>}</span>
                    </button>;
                  })}
                </div>
                {dayPosts.length > 3 && <button className={styles.morePosts} aria-controls={`posts-${key}`} aria-expanded={expanded} aria-label={expanded ? `Mostrar menos publicaciones del ${key}` : `Mostrar ${dayPosts.length - 3} publicaciones más del ${key}`} onClick={() => setExpandedDay(expanded ? null : key)}>{expanded ? "Mostrar menos" : `+${dayPosts.length - 3} más`}</button>}
              </div>;
            })}</div>
          </div>
          <div className={styles.legend}><span><i className={styles.legendReview}/> Revisión pendiente</span><span><i className={styles.legendApproved}/> Aprobada</span><span><i className={styles.legendScheduled}/> Programada</span><span className={styles.legendCount}>{posts.filter((p) => p.status === "review").length} pendientes de revisión</span></div>
        </>}

        {tab === "Eventos" && <><div className={styles.pageHeading}><div><div className={styles.eyebrow}>EVENTOS DETECTADOS Y MANUALES</div><h1>Eventos</h1><p>Gestiona los eventos y las publicaciones que generan.</p></div><button className={styles.addButton} onClick={openAddForm}>＋ Añadir evento</button></div><div className={styles.eventsList}>{events.map((event) => { const eventPosts = posts.filter((post) => post.eventId === event.id); const links = sources.flatMap((source) => source.accountIds.map((accountId) => ({ sourceId: source.id, accountId }))); const eligibleAccounts = selectEventAccounts(accountList, event.sourceId, links); const missing = hasMissingReminders(eligibleAccounts, scheduleDates(event.date).map(({ leadDays }) => leadDays), eventPosts); return <article key={event.id} className={styles.eventCard}><div className={styles.eventDate}><b>{dateAt(event.date).toLocaleDateString("es-ES", { day: "2-digit" })}</b><span>{dateAt(event.date).toLocaleDateString("es-ES", { month: "short" })}</span></div><div className={styles.eventInfo}><div className={styles.eventMeta}><span className={styles.sourceTag}>{event.source}</span><span>{event.time} · {event.place}</span></div><h3>{event.title}</h3><p>{event.description}</p><div className={styles.eventFoot}>{eventPosts.length} publicaciones previstas {persistent && missing && <button className={styles.morePosts} onClick={() => { void retryDrafts(event); }}>Completar recordatorios</button>} <a href={event.url ?? (event.source === "Luma" ? "https://lu.ma" : event.source === "Meetup" ? "https://meetup.com" : "#")} target={event.url ? "_blank" : undefined} rel="noreferrer">{event.source === "Manual" ? "Añadido manualmente" : "Abrir evento ↗"}</a></div></div><button className={styles.iconAction} onClick={() => { setNewEvent({ title: event.title, date: event.date, time: event.time, place: event.place, description: event.description, source: event.source }); setSourceUrl(event.url ?? ""); openAddForm(); }}>···</button></article>; })}</div></>}

        {tab === "Cuentas" && <><div className={styles.pageHeading}><div><div className={styles.eyebrow}>CANALES Y VOZ DE MARCA</div><h1>Tus cuentas</h1><p>Cada cuenta tiene una voz propia para tus publicaciones.</p></div></div><div className={styles.accountsGrid}>{accountList.map((account, accountIndex) => <article className={styles.accountCard} key={account.id ?? account.name}><div className={`${styles.accountTop}`}><Image className={styles.accountLogo} src={account.logo} alt={`Logo de ${account.name}`} width={38} height={38}/><div><b>{account.name}</b><small>{account.kind}</small></div><span className={styles.connected}>{persistent ? "● Supabase" : "● Demo"}</span></div><div className={styles.keyStatus}>{account.bufferApiKeyConfigured ? "API key configurada" : `Falta ${account.bufferApiKeyEnv}`}</div><div className={styles.accountNetworks}>{account.networks.map((network) => <span key={network}>{network === "LinkedIn" ? "in" : network === "X" ? "𝕏" : "◉"} &nbsp;{network}</span>)}</div><div className={styles.bufferChannels}><h4>CANALES DE BUFFER</h4><p>Introduce el ID del canal de Buffer conectado a cada red.</p>{account.networks.map((network) => <label key={network}><span>{network}</span><input aria-label={`ID de canal de Buffer ${network} para ${account.name}`} value={account.bufferChannels?.[network] ?? ""} disabled={!persistent} onChange={(event) => setAccountList((all) => all.map((item) => item.id === account.id ? { ...item, bufferChannels: { ...item.bufferChannels, [network]: event.target.value } } : item))} onBlur={(event) => { void changeBufferChannel(account, network, event.currentTarget.value); }} placeholder="ID del canal"/></label>)}</div><label>VOZ Y TONO<textarea value={account.prompt} onChange={(e) => setAccountList((all) => all.map((item, index) => index === accountIndex ? { ...item, prompt: e.target.value } : item))} onBlur={(e) => { void changeVoice(account, e.currentTarget.value); }} rows={3}/></label><div className={styles.exampleBox}><span>✦</span><div><b>{account.styleExampleCount ?? posts.filter((p) => p.account === account.name && p.status === "approved").length} ejemplos aprobados</b><small>Las publicaciones aprobadas ayudan a mantener tu estilo.</small></div></div></article>)}</div></>}

        {tab === "Ajustes" && <><div className={styles.pageHeading}><div><div className={styles.eyebrow}>PREFERENCIAS DEL ESPACIO</div><h1>Ajustes</h1><p>Controla cómo se preparan y programan tus publicaciones.</p></div></div><div className={styles.settingsLayout}><section className={styles.settingsCard}><div className={styles.settingsTitle}><span className={styles.settingsIcon}>◷</span><div><h3>Modo de publicación</h3><p>Elige si revisas los textos antes de que se programen.</p></div></div><div className={styles.modeChoices}><button className={mode === "review" ? styles.modeChosen : ""} onClick={() => { void changeMode("review"); }}><span>◉</span><b>Revisión</b><small>Al aprobar, se programa el texto y se guarda como ejemplo de estilo.</small></button><button className={mode === "automatic" ? styles.modeChosen : ""} onClick={() => { void changeMode("automatic"); }}><span>⚡</span><b>Automático</b><small>{persistent ? "Buffer programa los borradores nuevos en cuanto se generan, sin aprobación de estilo." : "En la demo, los textos y cambios se quedan en este navegador y no se envían a Buffer."}</small></button></div>{mode === "automatic" && <div className={styles.warning}>{persistent ? "Los borradores nuevos se envían a Buffer al generarse. Si falta la clave o el ID del canal, quedarán marcados como fallidos; los resultados inciertos no se reintentan automáticamente." : "La demo no publica en redes; la opción automática solo se guarda en este navegador."}</div>}</section><section className={styles.settingsCard}><div className={styles.settingsTitle}><span className={styles.settingsIcon}>✦</span><div><h3>Servicios conectados</h3><p>Las credenciales se guardan en el entorno del servidor.</p></div></div>{[["Supabase", "Autenticación y base de datos", persistent ? "Configurado" : "Pendiente de configurar"], ["Buffer", "Publicación en redes", bufferApiKeyConfigured ? "Claves configuradas" : "Configura las tres API keys de Buffer"], ["Groq", "Redacción de borradores", "Requiere GROQ_API_KEY y GROQ_MODEL"], ["Luma iCal", "Detección de eventos", persistent ? `${sources.filter((source) => source.type === "luma_ical" && source.enabled).length} fuentes activas` : "Configura Supabase para importar"]].map(([name, desc, status]) => <div className={styles.serviceRow} key={name}><div><b>{name}</b><small>{desc}</small></div><span className={styles.servicePending}><i/> {status}</span></div>)}<div className={styles.cronHint}>{persistent ? "El endpoint admite sincronización manual desde Fuentes y llamadas externas autenticadas con CRON_SECRET. Configura cron-job.org para ejecutarlo cada 6 horas." : "La sincronización manual y programada necesita Supabase configurado."}</div></section></div><SourceSettings accounts={accountList} sources={sources} persistent={persistent} onSourcesChange={setSources} onSyncComplete={refreshWorkspaceAfterSync}/></>}
      </div>
    </section>
    {selected && <div className={styles.overlay} onMouseDown={(e) => { if (e.target === e.currentTarget) setSelected(null); }}><section className={styles.detailPanel}><button className={styles.close} onClick={() => setSelected(null)}>×</button><div className={styles.eyebrow}>DETALLE DE PUBLICACIÓN</div><h2>{currentEvent?.title}</h2><div className={styles.detailDate}>◷ &nbsp;{dateAt(selected.date).toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long" })} · {selected.time} · Europe/Madrid</div><div className={styles.channelChip}>{selected.network} <span>·</span> {selected.account}</div><label className={styles.postEditor}>TEXTO DE LA PUBLICACIÓN<textarea value={editing} disabled={!(["review", "approved", "failed"] as Status[]).includes(selected.status)} onChange={(e) => setEditing(e.target.value)} rows={8}/></label><div className={styles.characterCount}>{postValidation?.message} <span>Validación local por red.</span></div>{selected.lastError && <p className={styles.deliveryError}>{selected.lastError}</p>}{["needs_reconciliation", "scheduling"].includes(selected.status) && <div className={styles.reconcileBox}><p>{selected.status === "scheduling" ? "El envío puede seguir en curso. Si ya aparece en Buffer, puedes confirmar su ID; no se puede confirmar su ausencia mientras siga en curso." : "Comprueba la cola de Buffer. Si encuentras la publicación, pega su ID para confirmar el envío."}</p><label>ID DEL POST DE BUFFER<input aria-label="ID confirmado del post de Buffer" value={reconciliationId} onChange={(event) => setReconciliationId(event.target.value)}/></label><button className={styles.secondaryButton} disabled={!reconciliationId.trim()} onClick={() => { void confirmReconciledPost(selected); }}>Confirmar que está programada</button>{selected.status === "needs_reconciliation" && <><label className={styles.absenceConfirm}><input type="checkbox" checked={absenceConfirmed} onChange={(event) => setAbsenceConfirmed(event.target.checked)}/> He revisado el canal y no aparece ningún post coincidente.</label><button className={styles.secondaryButton} disabled={!absenceConfirmed} onClick={() => { void confirmPostAbsent(selected); }}>Confirmar ausencia y permitir reintento</button></>}</div>}<div className={styles.detailActions}>{(["review", "approved", "failed"] as Status[]).includes(selected.status) && <button className={styles.secondaryButton} onClick={() => { void savePostChanges(selected, { text: editing }); }}>Guardar cambios</button>}{selected.status === "review" && <button className={styles.approveButton} onClick={() => { void savePostChanges(selected, { text: editing, status: "approved" }); }} disabled={!postValidation?.valid}>{persistent ? "✓ Aprobar, programar y guardar ejemplo" : "✓ Aprobar y guardar ejemplo"}</button>}{selected.status === "failed" && <button className={styles.approveButton} onClick={() => { void retryPost(selected); }}>Reintentar envío</button>}</div><p className={styles.autoNote}>{selected.status === "scheduled" ? `Programada en Buffer · ID ${selected.bufferPostId ?? "guardado"}` : selected.status === "scheduling" ? "El envío puede seguir en curso. Si aparece en Buffer, registra su ID; una ausencia no se puede confirmar durante el envío." : selected.status === "needs_reconciliation" ? "Estado incierto; conciliación manual necesaria antes de cualquier reintento." : selected.status === "failed" ? "Buffer rechazó el envío o falta configuración. Corrige el problema y vuelve a intentarlo." : selected.status === "review" ? (persistent ? "Al aprobar se programa en Buffer y se guarda el texto final como ejemplo de estilo." : "En la demo, al aprobar se guarda el texto en este navegador como ejemplo local.") : selected.status === "published" ? "La red confirmó la publicación." : "Edita y guarda el texto antes de aprobarlo."}</p></section></div>}
    {showAdd && <div className={styles.overlay} onMouseDown={(e) => { if (e.target === e.currentTarget) closeAddForm(); }}><section className={styles.modal}>
      <button className={styles.close} onClick={closeAddForm}>×</button>
      <div className={styles.eyebrow}>NUEVO EVENTO</div><h2>Añade un evento</h2>
      <p className={styles.modalDesc}>Pega la URL pública de un evento de Meetup o Luma para extraer los datos. Podrás revisarlos y corregirlos antes de guardar.</p>
      <label className={styles.formLabel}>ENLACE DEL EVENTO<input aria-label="URL del evento" value={sourceUrl} disabled={extractingEvent} onChange={(e) => { setSourceUrl(e.target.value); setExtractionMessage(""); }} placeholder="https://lu.ma/tu-evento"/></label>
      <button className={styles.secondaryButton} onClick={() => { void extractEventFromUrl(); }} disabled={!sourceUrl.trim() || extractingEvent}>{extractingEvent ? "Extrayendo…" : "Extraer datos del evento"}</button>
      {extractionMessage && <p className={styles.extractionMessage} role="status">{extractionMessage}</p>}
      <div className={styles.formDivider}><span>revisa o completa los datos</span></div>
      <label className={styles.formLabel}>TÍTULO<input value={newEvent.title} disabled={extractingEvent} onChange={(e) => setNewEvent({ ...newEvent, title: e.target.value })} placeholder="Nombre del evento"/></label>
      <div className={styles.formGrid}><label className={styles.formLabel}>FECHA<input type="date" value={newEvent.date} disabled={extractingEvent} onChange={(e) => setNewEvent({ ...newEvent, date: e.target.value })}/></label><label className={styles.formLabel}>HORA<input type="time" value={newEvent.time} disabled={extractingEvent} onChange={(e) => setNewEvent({ ...newEvent, time: e.target.value })}/></label></div>
      <label className={styles.formLabel}>LUGAR<input value={newEvent.place} disabled={extractingEvent} onChange={(e) => setNewEvent({ ...newEvent, place: e.target.value })}/></label>
      <label className={styles.formLabel}>DESCRIPCIÓN<textarea rows={3} value={newEvent.description} disabled={extractingEvent} onChange={(e) => setNewEvent({ ...newEvent, description: e.target.value })} placeholder="¿Qué ocurrirá en el evento?"/></label>
      <div className={styles.modalActions}><button className={styles.secondaryButton} onClick={closeAddForm}>Cancelar</button><button className={styles.approveButton} onClick={addEvent} disabled={extractingEvent || !newEvent.title.trim() || !newEvent.date || !newEvent.time}>Crear evento</button></div>
    </section></div>}
  </main>;
}

export default function Home() {
  return <Suspense fallback={<main style={{ minHeight: "100vh", background: "#fff" }} />}><Dashboard /></Suspense>;
}
