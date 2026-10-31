"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import styles from "./page.module.css";
import { validatePost } from "@/lib/social-validation";
import { isSupabaseConfigured } from "@/lib/supabase/client";
import { detectTitleLanguage, type PostLanguage } from "@/lib/language";
import { approvePost, createEvent, createReviewPosts, loadWorkspace, updateAccountVoice, updatePostContent, updatePublishingMode } from "./workspace-actions";

type Range = "Quincena" | "Semana" | "Mes";
type Status = "review" | "approved" | "scheduled";
type Network = "LinkedIn" | "X" | "Bluesky";
type EventItem = { id: string; title: string; date: string; time: string; place: string; description: string; source: string; url?: string; language?: PostLanguage; };
type Post = { id: string; eventId: string; date: string; time: string; account: string; accountId?: string; network: Network; text: string; status: Status; leadDays?: 14 | 7 | 1; language?: PostLanguage; };
type Account = { id?: string; name: string; kind: string; initials: string; color: string; prompt: string; networks: Network[]; };

const accounts: Account[] = [
  { name: "Alex · personal", kind: "Cuenta personal", initials: "A", color: "violet", prompt: "Cercano, curioso y directo. Primera persona. Evita sonar promocional.", networks: ["LinkedIn", "X", "Bluesky"] },
  { name: "BarcelonaJS", kind: "Comunidad", initials: "B", color: "orange", prompt: "Comunidad tecnológica abierta. Entusiasta, inclusiva y concreta.", networks: ["LinkedIn", "X"] },
  { name: "DevBcn", kind: "Asociación", initials: "D", color: "green", prompt: "Tono profesional y acogedor. Destaca la comunidad y el aprendizaje.", networks: ["LinkedIn", "Bluesky"] },
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
  const [events, setEvents] = useState(initialEvents);
  const [accountList, setAccountList] = useState(accounts);
  const [posts, setPosts] = useState(initialPosts);
  const [mode, setMode] = useState<"review" | "automatic">("review");
  const [selected, setSelected] = useState<Post | null>(null);
  const [editing, setEditing] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [newEvent, setNewEvent] = useState({ title: "", date: "", time: "19:00", place: "Barcelona", description: "", source: "Manual" });
  const [sourceUrl, setSourceUrl] = useState("");
  const [hydrated, setHydrated] = useState(false);
  const [feedback, setFeedback] = useState("");
  const persistent = isSupabaseConfigured();

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
        setAccountList(snapshot.accounts);
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
      try { const value = JSON.parse(saved); setEvents(value.events ?? initialEvents); setPosts(value.posts ?? initialPosts); setMode(value.mode ?? "review"); setAccountList(value.accounts ?? accounts); }
      catch { localStorage.removeItem("findly-state-v1"); }
    }
    setHydrated(true);
  }, [persistent]);
  /* eslint-enable react-hooks/set-state-in-effect */
  useEffect(() => { if (!persistent && hydrated) localStorage.setItem("findly-state-v1", JSON.stringify({ events, posts, mode, accounts: accountList })); }, [events, posts, mode, accountList, hydrated, persistent]);

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
    if (persistent) {
      if (next.status === "approved") await approvePost(post.id, content);
      else if (next.text !== undefined) await updatePostContent(post.id, content);
    }
    setPosts((all) => all.map((item) => item.id === post.id ? { ...item, ...next } : item));
    if (selected) setSelected({ ...selected, ...next });
  }
  async function addEvent() {
    if (!newEvent.title.trim() || !newEvent.date) return;
    let parsedUrl: URL | null = null;
    try {
      const candidate = new URL(sourceUrl.trim());
      if (candidate.protocol === "https:" || candidate.protocol === "http:") parsedUrl = candidate;
    } catch { /* A missing or invalid link falls back to manual event entry. */ }
    const source = parsedUrl?.hostname.endsWith("lu.ma") ? "Luma" : parsedUrl?.hostname.endsWith("meetup.com") ? "Meetup" : "Manual";
    const draftEvent = { ...newEvent, source, url: parsedUrl?.toString() };
    let savedEvent: EventItem | null = null;
    try {
      const event = persistent ? await createEvent(draftEvent) : { ...draftEvent, id: "evt-" + Date.now(), language: detectTitleLanguage(draftEvent.title) };
      if (persistent) savedEvent = event;
      setEvents((all) => [event, ...all]);
      const generated = starterPosts([event], accountList);
      if (persistent) {
        const savedPosts = await createReviewPosts(event.id, generated);
        setPosts((all) => [...all, ...savedPosts]);
      } else setPosts((all) => [...all, ...generated]);
      setFeedback("");
    } catch (error) {
      if (savedEvent) {
        setFeedback(`El evento quedó guardado, pero no se guardaron todos sus borradores. Puedes reintentarlo desde la ficha del evento. ${error instanceof Error ? error.message : ""}`);
        setShowAdd(false);
        setNewEvent({ title: "", date: "", time: "19:00", place: "Barcelona", description: "", source: "Manual" });
        setTab("Eventos");
      } else {
        setFeedback(error instanceof Error ? error.message : "No se pudo guardar el evento.");
      }
      return;
    }
    setShowAdd(false);
    setNewEvent({ title: "", date: "", time: "19:00", place: "Barcelona", description: "", source: "Manual" });
    setTab("Eventos");
  }

  async function retryDrafts(event: EventItem) {
    try {
      const generated = starterPosts([event], accountList);
      if (generated.length === 0) {
        setFeedback("Este evento no tiene recordatorios futuros que se puedan crear.");
        return;
      }
      const saved = await createReviewPosts(event.id, generated);
      setPosts((all) => [...new Map([...all, ...saved].map((post) => [post.id, post])).values()]);
      setFeedback("Se han sincronizado los borradores de recordatorio.");
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "No se pudieron crear los borradores.");
    }
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

  async function savePostChanges(post: Post, next: Partial<Post>) {
    try {
      await updatePost(post, next);
      setSelected(null);
      setFeedback("");
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
      <header className={styles.topbar}><div className={styles.breadcrumb}>Workspace <span>/</span> <b>{tab}</b></div><div className={styles.topActions}><span className={styles.tz}>◷ &nbsp;Europe/Madrid</span><button className={styles.helpBtn}>? <span>Ayuda</span></button><button className={styles.addButton} onClick={() => setShowAdd(true)}><span>＋</span> Añadir evento</button></div></header>
      <div className={styles.content}>
        {tab === "Calendario" && <><div className={styles.pageHeading}><div><div className={styles.eyebrow}>TU CONTENIDO, DE UN VISTAZO</div><h1>Calendario</h1><p>Todos tus anuncios, en un solo lugar.</p></div><button className={styles.mobileAdd} onClick={() => setShowAdd(true)}>＋ Evento</button></div>
          {!persistent && <div className={styles.notice}><span className={styles.noticeIcon}>✦</span><div><b>Modo demostración</b><span>Los cambios se guardan en este navegador. Configura Supabase para usar persistencia compartida.</span></div><button onClick={() => setTab("Ajustes")}>Ver configuración <span>→</span></button></div>}
          {persistent && <div className={styles.notice}><span className={styles.noticeIcon}>✓</span><div><b>Datos guardados en Supabase</b><span>La generación con Groq y la programación con Buffer aún no están conectadas.</span></div><button onClick={() => setTab("Ajustes")}>Ver configuración <span>→</span></button></div>}
          {feedback && <p role="alert" style={{ color: "#a43a32", background: "#fff1f0", borderRadius: 8, padding: "10px 14px" }}>{feedback}</p>}
          <div className={styles.calendarToolbar}><div className={styles.period}><button onClick={() => navigate(-1)} aria-label="Periodo anterior">‹</button><button onClick={() => setAnchor(new Date())} className={styles.today}>Hoy</button><button onClick={() => navigate(1)} aria-label="Periodo siguiente">›</button><h2>{monthLabel}</h2></div><div className={styles.viewToggle}>{(["Quincena", "Semana", "Mes"] as Range[]).map((opt) => <button key={opt} onClick={() => setRange(opt)} className={range === opt ? styles.viewSelected : ""} aria-pressed={range === opt}>{opt}</button>)}</div></div>
          <div className={styles.calendar}>
            <div className={styles.weekdays}>{["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"].map((d) => <div key={d}>{d}</div>)}</div>
            <div className={styles.days} data-testid="calendar-days">{dates.map((date) => {
              const key = dayKey(date); const offMonth = range === "Mes" && date.getMonth() !== anchor.getMonth(); const dayPosts = posts.filter((p) => p.date === key).sort((a, b) => a.time.localeCompare(b.time));
              return <div key={key} data-testid="calendar-day" className={`${styles.day} ${offMonth ? styles.offMonth : ""} ${key === dayKey(new Date()) ? styles.isToday : ""}`}><div className={styles.dayHeader}><span>{date.getDate()}</span>{dayPosts.length > 0 && <small>{dayPosts.length}</small>}</div><div className={styles.dayPosts}>{dayPosts.slice(0, 3).map((post) => { const event = events.find((e) => e.id === post.eventId); return <button key={post.id} className={`${styles.postPill} ${styles["post" + post.status]}`} onClick={() => { setSelected(post); setEditing(post.text); }} title={event?.title}><span className={styles.networkDot}>{post.network === "LinkedIn" ? "in" : post.network === "X" ? "𝕏" : "b"}</span><span className={styles.pillText}>{event?.title ?? post.text}</span></button>; })}{dayPosts.length > 3 && <button className={styles.morePosts} onClick={() => setTab("Eventos")}>+{dayPosts.length - 3} más</button>}</div></div>;
            })}</div>
          </div>
          <div className={styles.legend}><span><i className={styles.legendReview}/> Revisión pendiente</span><span><i className={styles.legendApproved}/> Aprobada</span><span><i className={styles.legendScheduled}/> Programada</span><span className={styles.legendCount}>{posts.filter((p) => p.status === "review").length} pendientes de revisión</span></div>
        </>}

        {tab === "Eventos" && <><div className={styles.pageHeading}><div><div className={styles.eyebrow}>EVENTOS DETECTADOS Y MANUALES</div><h1>Eventos</h1><p>Gestiona los eventos y las publicaciones que generan.</p></div><button className={styles.addButton} onClick={() => setShowAdd(true)}>＋ Añadir evento</button></div><div className={styles.eventsList}>{events.map((event) => <article key={event.id} className={styles.eventCard}><div className={styles.eventDate}><b>{dateAt(event.date).toLocaleDateString("es-ES", { day: "2-digit" })}</b><span>{dateAt(event.date).toLocaleDateString("es-ES", { month: "short" })}</span></div><div className={styles.eventInfo}><div className={styles.eventMeta}><span className={styles.sourceTag}>{event.source}</span><span>{event.time} · {event.place}</span></div><h3>{event.title}</h3><p>{event.description}</p><div className={styles.eventFoot}>{posts.filter((p) => p.eventId === event.id).length} publicaciones previstas {persistent && posts.filter((p) => p.eventId === event.id).length === 0 && scheduleDates(event.date).length > 0 && <button className={styles.morePosts} onClick={() => { void retryDrafts(event); }}>Crear recordatorios</button>} <a href={event.url ?? (event.source === "Luma" ? "https://lu.ma" : event.source === "Meetup" ? "https://meetup.com" : "#")} target={event.url ? "_blank" : undefined} rel="noreferrer">{event.source === "Manual" ? "Añadido manualmente" : "Abrir evento ↗"}</a></div></div><button className={styles.iconAction} onClick={() => { setNewEvent({ title: event.title, date: event.date, time: event.time, place: event.place, description: event.description, source: event.source }); setSourceUrl(event.url ?? ""); setShowAdd(true); }}>···</button></article>)}</div></>}

        {tab === "Cuentas" && <><div className={styles.pageHeading}><div><div className={styles.eyebrow}>CANALES Y VOZ DE MARCA</div><h1>Tus cuentas</h1><p>Cada cuenta tiene una voz propia para tus publicaciones.</p></div></div><div className={styles.accountsGrid}>{accountList.map((account, accountIndex) => <article className={styles.accountCard} key={account.id ?? account.name}><div className={`${styles.accountTop}`}><div className={`${styles.accountAvatar} ${styles[account.color]}`}>{account.initials}</div><div><b>{account.name}</b><small>{account.kind}</small></div><span className={styles.connected}>{persistent ? "● Supabase" : "● Demo"}</span></div><div className={styles.accountNetworks}>{account.networks.map((network) => <span key={network}>{network === "LinkedIn" ? "in" : network === "X" ? "𝕏" : "◉"} &nbsp;{network}</span>)}</div><label>VOZ Y TONO<textarea value={account.prompt} onChange={(e) => setAccountList((all) => all.map((item, index) => index === accountIndex ? { ...item, prompt: e.target.value } : item))} onBlur={(e) => { void changeVoice(account, e.currentTarget.value); }} rows={3}/></label><div className={styles.exampleBox}><span>✦</span><div><b>{posts.filter((p) => p.account === account.name && p.status === "approved").length} ejemplos aprobados</b><small>Las publicaciones aprobadas ayudan a mantener tu estilo.</small></div></div></article>)}</div></>}

        {tab === "Ajustes" && <><div className={styles.pageHeading}><div><div className={styles.eyebrow}>PREFERENCIAS DEL ESPACIO</div><h1>Ajustes</h1><p>Controla cómo se preparan y programan tus publicaciones.</p></div></div><div className={styles.settingsLayout}><section className={styles.settingsCard}><div className={styles.settingsTitle}><span className={styles.settingsIcon}>◷</span><div><h3>Modo de publicación</h3><p>Elige si revisas los textos antes de que se programen.</p></div></div><div className={styles.modeChoices}><button className={mode === "review" ? styles.modeChosen : ""} onClick={() => { void changeMode("review"); }}><span>◉</span><b>Revisión</b><small>Aprueba cada texto. Al aprobarlo, se añade a los ejemplos de estilo.</small></button><button className={mode === "automatic" ? styles.modeChosen : ""} onClick={() => { void changeMode("automatic"); }}><span>⚡</span><b>Automático</b><small>En cuanto esté configurado, las publicaciones se programarán sin revisión.</small></button></div>{mode === "automatic" && <div className={styles.warning}>La programación automática estará disponible cuando conectes Groq y Buffer.</div>}</section><section className={styles.settingsCard}><div className={styles.settingsTitle}><span className={styles.settingsIcon}>✦</span><div><h3>Servicios conectados</h3><p>Las credenciales se guardan en el entorno del servidor.</p></div></div>{[["Supabase", "Autenticación y base de datos", persistent ? "Configurado" : "Pendiente de configurar"], ["Buffer", "Publicación en redes", "Pendiente de configurar"], ["Groq", "Redacción con IA", "Pendiente de configurar"], ["Luma iCal", "Detección de eventos", "Añade la URL del calendario"]].map(([name, desc, status]) => <div className={styles.serviceRow} key={name}><div><b>{name}</b><small>{desc}</small></div><span className={styles.servicePending}><i/> {status}</span></div>)}<div className={styles.cronHint}>La consulta automática se ejecutará cada 6 horas mediante un cron externo.</div></section></div></>}
      </div>
    </section>
    {selected && <div className={styles.overlay} onMouseDown={(e) => { if (e.target === e.currentTarget) setSelected(null); }}><section className={styles.detailPanel}><button className={styles.close} onClick={() => setSelected(null)}>×</button><div className={styles.eyebrow}>DETALLE DE PUBLICACIÓN</div><h2>{currentEvent?.title}</h2><div className={styles.detailDate}>◷ &nbsp;{dateAt(selected.date).toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long" })} · {selected.time} · Europe/Madrid</div><div className={styles.channelChip}>{selected.network} <span>·</span> {selected.account}</div><label className={styles.postEditor}>TEXTO DE LA PUBLICACIÓN<textarea value={editing} onChange={(e) => setEditing(e.target.value)} rows={8}/></label><div className={styles.characterCount}>{postValidation?.message} <span>Validación local por red.</span></div><div className={styles.detailActions}><button className={styles.secondaryButton} onClick={() => { void savePostChanges(selected, { text: editing }); }}>Guardar cambios</button>{selected.status === "review" && <button className={styles.approveButton} onClick={() => { void savePostChanges(selected, { text: editing, status: "approved" }); }} disabled={!postValidation?.valid}>✓ Aprobar y guardar ejemplo</button>}</div><p className={styles.autoNote}>{postValidation?.valid ? "La programación con Buffer requiere configurar las credenciales de la API." : postValidation?.message}</p></section></div>}
    {showAdd && <div className={styles.overlay} onMouseDown={(e) => { if (e.target === e.currentTarget) setShowAdd(false); }}><section className={styles.modal}><button className={styles.close} onClick={() => setShowAdd(false)}>×</button><div className={styles.eyebrow}>NUEVO EVENTO</div><h2>Añade un evento</h2><p className={styles.modalDesc}>Pega un enlace de Meetup o Luma para completar los datos manualmente en esta versión.</p><label className={styles.formLabel}>ENLACE DEL EVENTO<input value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} placeholder="https://lu.ma/tu-evento"/></label><div className={styles.formDivider}><span>o introduce los datos</span></div><label className={styles.formLabel}>TÍTULO<input value={newEvent.title} onChange={(e) => setNewEvent({ ...newEvent, title: e.target.value })} placeholder="Nombre del evento"/></label><div className={styles.formGrid}><label className={styles.formLabel}>FECHA<input type="date" value={newEvent.date} onChange={(e) => setNewEvent({ ...newEvent, date: e.target.value })}/></label><label className={styles.formLabel}>HORA<input type="time" value={newEvent.time} onChange={(e) => setNewEvent({ ...newEvent, time: e.target.value })}/></label></div><label className={styles.formLabel}>LUGAR<input value={newEvent.place} onChange={(e) => setNewEvent({ ...newEvent, place: e.target.value })}/></label><label className={styles.formLabel}>DESCRIPCIÓN<textarea rows={3} value={newEvent.description} onChange={(e) => setNewEvent({ ...newEvent, description: e.target.value })} placeholder="¿Qué ocurrirá en el evento?"/></label><div className={styles.modalActions}><button className={styles.secondaryButton} onClick={() => setShowAdd(false)}>Cancelar</button><button className={styles.approveButton} onClick={addEvent} disabled={!newEvent.title || !newEvent.date}>Crear evento</button></div></section></div>}
  </main>;
}

export default function Home() {
  return <Suspense fallback={<main style={{ minHeight: "100vh", background: "#fff" }} />}><Dashboard /></Suspense>;
}
