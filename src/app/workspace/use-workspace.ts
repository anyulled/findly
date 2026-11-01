"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { isSupabaseConfigured } from "@/lib/supabase/client";
import { validatePost } from "@/lib/social-validation";
import { detectTitleLanguage } from "@/lib/language";
import { sourceForEventUrl } from "@/lib/event-source";
import { isSubstackUrl } from "@/lib/substack";
import { selectEventAccounts } from "@/lib/event-targets";
import {
  approvePost,
  confirmPostMissingFromBuffer,
  createEvent,
  deleteEvent,
  generateReviewPosts,
  loadWorkspace,
  reconcileScheduledPost,
  retryFailedPost,
  saveBufferChannel,
  updateAccountVoice,
  updatePostContent,
  updatePublishingMode,
  type SourceView,
  type UserProfile,
} from "../workspace-actions";
import type {
  Account,
  EventItem,
  Network,
  Post,
  Range,
  Status,
} from "./workspace-types";
import { defaultAccounts, matchesAccount } from "./workspace-types";
import {
  madridClock,
  makeDates,
  starterPosts,
} from "./workspace-calendar-dates";

export function useWorkspace() {
  const [tab, setTab] = useState("Calendario");
  const [range, setRange] = useState<Range>("Quincena");
  const [anchor, setAnchor] = useState(() => new Date());
  const [expandedDay, setExpandedDay] = useState<string | null>(null);
  const firstRevealedPost = useRef<HTMLButtonElement>(null);
  const [events, setEvents] = useState<EventItem[]>([]);
  const [accountList, setAccountList] = useState<Account[]>(defaultAccounts);
  const [sources, setSources] = useState<SourceView[]>([]);
  const [posts, setPosts] = useState<Post[]>([]);
  const [mode, setMode] = useState<"review" | "automatic">("review");
  const [profile, setProfile] = useState<UserProfile>({
    name: "Administrador",
    email: "",
    initials: "A",
  });
  const [bufferApiKeyConfigured, setBufferApiKeyConfigured] = useState(false);
  const [selected, setSelected] = useState<Post | null>(null);
  const [editing, setEditing] = useState("");
  const [reconciliationId, setReconciliationId] = useState("");
  const [absenceConfirmed, setAbsenceConfirmed] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [newEvent, setNewEvent] = useState({
    title: "",
    date: "",
    time: "",
    place: "",
    description: "",
    source: "Manual",
    imageUrl: "",
  });
  const [sourceUrl, setSourceUrl] = useState("");
  const [selectedAccountIds, setSelectedAccountIds] = useState<string[]>([]);
  const [extractingEvent, setExtractingEvent] = useState(false);
  const [extractionMessage, setExtractionMessage] = useState("");
  const extractionRequestId = useRef(0);
  const addFormOpen = useRef(false);
  const [hydrated, setHydrated] = useState(false);
  const [syncingWorkspace, setSyncingWorkspace] = useState(false);
  const [feedback, setFeedback] = useState("");
  const persistent = isSupabaseConfigured();

  useEffect(() => {
    if (expandedDay) firstRevealedPost.current?.focus();
  }, [expandedDay]);

  function openAddForm() {
    extractionRequestId.current += 1;
    addFormOpen.current = true;
    setSelectedAccountIds(accountList.flatMap((account) => account.id && account.enabled !== false ? [account.id] : []));
    setShowAdd(true);
  }

  function closeAddForm() {
    extractionRequestId.current += 1;
    addFormOpen.current = false;
    setExtractingEvent(false);
    setShowAdd(false);
  }

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (persistent) {
      let active = true;
      const cached = localStorage.getItem("findly-workspace-cache-v1");
      if (cached) {
        try {
          const parsed = JSON.parse(cached);
          if (Array.isArray(parsed.events)) setEvents(parsed.events);
          if (Array.isArray(parsed.posts)) setPosts(parsed.posts);
          if (parsed.mode === "review" || parsed.mode === "automatic") setMode(parsed.mode);
          if (Array.isArray(parsed.accounts) && parsed.accounts.length > 0) {
            setAccountList(parsed.accounts);
            setBufferApiKeyConfigured(parsed.accounts.every((account: Account) => account.bufferApiKeyConfigured));
          }
          if (Array.isArray(parsed.sources)) setSources(parsed.sources);
          if (parsed.profile) setProfile(parsed.profile);
          setHydrated(true);
        } catch {
          localStorage.removeItem("findly-workspace-cache-v1");
        }
      }
      setSyncingWorkspace(true);
      void loadWorkspace()
        .then((snapshot) => {
          if (!active) return;
          setSyncingWorkspace(false);
          if (snapshot.error) {
            setFeedback(snapshot.error);
            setHydrated(true);
            return;
          }
          setEvents(snapshot.events);
          setPosts(snapshot.posts);
          setMode(snapshot.mode);
          setBufferApiKeyConfigured(snapshot.accounts.every((account) => account.bufferApiKeyConfigured));
          setAccountList(snapshot.accounts);
          setSources(snapshot.sources);
          if (snapshot.profile) setProfile(snapshot.profile);
          try {
            localStorage.setItem("findly-workspace-cache-v1", JSON.stringify(snapshot));
          } catch {
            /* Ignore quota errors */
          }
          setHydrated(true);
        })
        .catch((error: unknown) => {
          if (!active) return;
          setSyncingWorkspace(false);
          setFeedback(error instanceof Error ? error.message : "No se pudieron cargar los datos.");
          setHydrated(true);
        });
      return () => {
        active = false;
      };
    }
    const saved = localStorage.getItem("findly-state-v1");
    if (saved) {
      try {
        const value = JSON.parse(saved);
        const legacyMockIds = new Set(["evt-1", "evt-2", "evt-3", "evt-4"]);
        const cleanedEvents: EventItem[] = (value.events ?? []).filter((e: EventItem) => !legacyMockIds.has(e.id));
        const cleanedPosts: Post[] = (value.posts ?? []).filter((p: Post) => !legacyMockIds.has(p.eventId));
        setEvents(cleanedEvents);
        setPosts(cleanedPosts);
        setMode(value.mode ?? "review");
        setAccountList(value.accounts ?? defaultAccounts);
        setSources(value.sources ?? []);
        if (value.profile) setProfile(value.profile);
      } catch {
        localStorage.removeItem("findly-state-v1");
      }
    }
    setHydrated(true);
  }, [persistent]);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    if (!persistent && hydrated) {
      localStorage.setItem(
        "findly-state-v1",
        JSON.stringify({ events, posts, mode, accounts: accountList, sources, profile }),
      );
    }
  }, [events, posts, mode, accountList, sources, profile, hydrated, persistent]);

  const dates = useMemo(() => makeDates(anchor, range), [anchor, range]);
  const first = dates[0];
  const last = dates[dates.length - 1];
  const monthLabel =
    range === "Mes"
      ? anchor.toLocaleDateString("es-ES", { month: "long", year: "numeric" })
      : `${first.toLocaleDateString("es-ES", { day: "numeric", month: "short" })} – ${last.toLocaleDateString("es-ES", { day: "numeric", month: "short", year: "numeric" })}`;
  const reviewCount = posts.filter((p) => p.status === "review").length;

  function navigate(direction: number) {
    if (range === "Mes") {
      setAnchor(new Date(anchor.getFullYear(), anchor.getMonth() + direction, 1));
      return;
    }
    const next = new Date(anchor);
    next.setDate(next.getDate() + (range === "Quincena" ? 14 : 7) * direction);
    setAnchor(next);
  }

  async function updatePost(post: Post, next: Partial<Post>) {
    const content = next.text ?? post.text;
    let changes = next;
    if (persistent) {
      if (next.status === "approved") {
        const outcome = await approvePost(post.id, content);
        if (outcome.kind === "error") throw new Error(outcome.message);
        if (outcome.kind === "not_claimed") {
          await refreshWorkspaceAfterSync();
          setFeedback("No se pudo reservar la publicación. Revisa su estado y la cuenta asociada a la fuente.");
          return;
        }
        const status: Status =
          outcome.kind === "scheduled"
            ? "scheduled"
            : outcome.kind === "failed"
              ? "failed"
              : outcome.kind === "needs_reconciliation"
                ? "needs_reconciliation"
                : "scheduling";
        const message = "message" in outcome ? outcome.message : null;
        changes = { ...next, status, lastError: message };
        setAccountList((all) =>
          all.map((account) =>
            account.id === post.accountId
              ? {
                  ...account,
                  styleExampleCount:
                    (persistent
                      ? account.styleExampleCount
                      : posts.filter((item) => item.accountId === post.accountId && item.status === "approved").length) + 1,
                }
              : account,
          ),
        );
        setFeedback(
          status === "scheduled"
            ? "Publicación aprobada y programada en Buffer."
            : status === "needs_reconciliation"
              ? "Buffer pudo aceptar la publicación. Comprueba su cola antes de reintentar."
              : status === "failed"
                ? `La publicación se aprobó, pero Buffer la rechazó: ${message ?? "comprueba la configuración"}`
                : "La publicación está en proceso de envío.",
        );
      } else if (next.text !== undefined) {
        const result = await updatePostContent(post.id, content);
        if (!result.success) throw new Error(result.error);
      }
    }
    if (!persistent && next.status === "approved") {
      setAccountList((all) =>
        all.map((account) =>
          account.name === post.account
            ? { ...account, styleExampleCount: posts.filter((item) => item.account === post.account && item.status === "approved").length + 1 }
            : account,
        ),
      );
    }
    setPosts((all) => all.map((item) => (item.id === post.id ? { ...item, ...changes } : item)));
    if (selected) setSelected({ ...selected, ...changes });
  }

  const isSubstackDraft = newEvent.source === "Substack" || isSubstackUrl(sourceUrl.trim());

  async function addEvent() {
    if (extractingEvent || selectedAccountIds.length === 0) return;
    if (!newEvent.title.trim() || (!isSubstackDraft && (!newEvent.date || !newEvent.time))) return;
    let parsedUrl: URL | null = null;
    try {
      const candidate = new URL(sourceUrl.trim());
      if (candidate.protocol === "https:" || candidate.protocol === "http:") parsedUrl = candidate;
    } catch {
      /* A missing or invalid link falls back to manual event entry. */
    }
    const source = sourceForEventUrl(parsedUrl?.toString());
    const madrid = madridClock();
    const fallbackDate = `${madrid.year}-${madrid.month}-${madrid.day}`;
    const fallbackTime = `${madrid.hour}:${madrid.minute}`;
    const draftEvent = {
      ...newEvent,
      accountIds: selectedAccountIds,
      date: newEvent.date || fallbackDate,
      time: newEvent.time || fallbackTime,
      source,
      url: parsedUrl?.toString(),
      imageUrl: newEvent.imageUrl || undefined,
    };
    let savedEvent: EventItem | null = null;
    try {
      let event: EventItem;
      if (persistent) {
        const created = await createEvent(draftEvent);
        if (!created.success) throw new Error(created.error);
        event = created.event;
        savedEvent = event;
      } else {
        event = { ...draftEvent, id: "evt-" + Date.now(), language: detectTitleLanguage(draftEvent.title) };
      }
      setEvents((all) => [event, ...all]);
      if (persistent) {
        const generated = await generateReviewPosts(event.id);
        if (!generated.success) throw new Error(generated.error);
        setPosts((all) => [...all, ...generated.posts]);
      } else {
        setPosts((all) => [...all, ...starterPosts([event], selectEventAccounts(accountList, null, [], event.accountIds))]);
      }
      setFeedback("");
    } catch (error) {
      if (savedEvent) {
        setFeedback(
          `El evento quedó guardado, pero no se guardaron todos sus borradores. Puedes reintentarlo desde la ficha del evento. ${error instanceof Error ? error.message : ""}`,
        );
        closeAddForm();
        setNewEvent({ title: "", date: "", time: "", place: "", description: "", source: "Manual", imageUrl: "" });
        setSourceUrl("");
        setExtractionMessage("");
        setTab("Eventos");
      } else {
        setFeedback(error instanceof Error ? error.message : "No se pudo guardar el evento.");
      }
      return;
    }
    closeAddForm();
    setNewEvent({ title: "", date: "", time: "", place: "", description: "", source: "Manual", imageUrl: "" });
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
      const payload = (await response.json()) as {
        event?: typeof newEvent & { url: string };
        missingFields?: string[];
        error?: string;
      };
      if (!response.ok || !payload.event || !payload.missingFields) {
        throw new Error(payload.error ?? "No se pudieron extraer los datos del evento.");
      }
      if (requestId !== extractionRequestId.current || !addFormOpen.current) return;
      const result = { event: payload.event, missingFields: payload.missingFields };
      setNewEvent((current) => ({
        ...current,
        ...result.event,
        source: sourceForEventUrl(result.event.url),
      }));
      setSourceUrl(result.event.url);
      setExtractionMessage(
        result.missingFields.length === 0
          ? "Datos extraídos. Revísalos antes de crear el evento."
          : `Extraje lo disponible; completa estos campos: ${result.missingFields
              .map(
                (field) =>
                  ({ date: "fecha", time: "hora", place: "lugar", description: "descripción" })[field] ?? field,
              )
              .join(", ")}.`,
      );
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
      const result = await generateReviewPosts(event.id);
      if (!result.success) {
        setFeedback(result.error);
        return;
      }
      const saved = result.posts;
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
    setSyncingWorkspace(true);
    const snapshot = await loadWorkspace();
    setSyncingWorkspace(false);
    if (snapshot.error) {
      setFeedback(snapshot.error);
      return;
    }
    setEvents(snapshot.events);
    setPosts(snapshot.posts);
    setMode(snapshot.mode);
    setBufferApiKeyConfigured(snapshot.accounts.every((account) => account.bufferApiKeyConfigured));
    setAccountList(snapshot.accounts);
    setSources(snapshot.sources);
    if (snapshot.profile) setProfile(snapshot.profile);
    try {
      localStorage.setItem("findly-workspace-cache-v1", JSON.stringify(snapshot));
    } catch {
      /* Ignore quota errors */
    }
  }

  async function changeMode(nextMode: "review" | "automatic") {
    try {
      if (persistent) {
        const result = await updatePublishingMode(nextMode);
        if (!result.success) {
          setFeedback(result.error);
          return;
        }
      }
      setMode(nextMode);
      setFeedback("");
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "No se pudo guardar el modo.");
    }
  }

  async function changeVoice(account: Account, prompt: string) {
    setAccountList((all) => all.map((item) => (matchesAccount(item, account) ? { ...item, prompt } : item)));
    if (persistent && account.id) {
      try {
        const result = await updateAccountVoice(account.id, prompt);
        setFeedback(result.success ? "" : result.error);
      } catch (error) {
        setFeedback(error instanceof Error ? error.message : "No se pudo guardar el tono.");
      }
    }
  }

  async function changeBufferChannel(account: Account, network: Network, value: string) {
    if (persistent && account.id) {
      try {
        const result = await saveBufferChannel(account.id, network, value);
        if (!result.success) {
          setFeedback(result.error);
          return;
        }
        setFeedback("");
      } catch (error) {
        setFeedback(error instanceof Error ? error.message : "No se pudo guardar el canal de Buffer.");
      }
    }
    setAccountList((all) =>
      all.map((item) =>
        matchesAccount(item, account)
          ? { ...item, bufferChannels: { ...item.bufferChannels, [network]: value.trim() } }
          : item,
      ),
    );
  }

  async function retryPost(post: Post) {
    try {
      const outcome = await retryFailedPost(post.id);
      if (outcome.kind === "error") {
        setFeedback(outcome.message);
        return;
      }
      if (outcome.kind === "not_claimed") {
        await refreshWorkspaceAfterSync();
        setSelected(null);
        setFeedback("No se pudo reservar la publicación. Revisa su estado y la cuenta asociada a la fuente.");
        return;
      }
      const status: Status =
        outcome.kind === "scheduled"
          ? "scheduled"
          : outcome.kind === "failed"
            ? "failed"
            : outcome.kind === "needs_reconciliation"
              ? "needs_reconciliation"
              : "scheduling";
      const message = "message" in outcome ? outcome.message : null;
      const changes: Partial<Post> = { status, lastError: message };
      setPosts((all) => all.map((item) => (item.id === post.id ? { ...item, ...changes } : item)));
      if (selected?.id === post.id) setSelected({ ...selected, ...changes });
      setFeedback(
        status === "scheduled"
          ? "Publicación programada en Buffer."
          : status === "needs_reconciliation"
            ? "Comprueba la cola de Buffer antes de reintentar."
            : status === "failed"
              ? `Buffer rechazó la publicación: ${message ?? "comprueba la configuración"}`
              : "La publicación está en proceso de envío.",
      );
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "No se pudo reintentar la publicación.");
    }
  }

  async function confirmReconciledPost(post: Post) {
    try {
      const result = await reconcileScheduledPost(post.id, reconciliationId);
      if (!result.success) {
        setFeedback(result.error);
        return;
      }
      const changes: Partial<Post> = { status: "scheduled", bufferPostId: reconciliationId.trim(), lastError: null };
      setPosts((all) => all.map((item) => (item.id === post.id ? { ...item, ...changes } : item)));
      setSelected({ ...post, ...changes });
      setReconciliationId("");
      setFeedback("Post encontrado en Buffer y marcado como programado.");
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "No se pudo guardar la conciliación.");
    }
  }

  async function confirmPostAbsent(post: Post) {
    try {
      const result = await confirmPostMissingFromBuffer(post.id);
      if (!result.success) {
        setFeedback(result.error);
        return;
      }
      const changes: Partial<Post> = { status: "failed", lastError: "Has confirmado que no aparece en la cola de Buffer." };
      setPosts((all) => all.map((item) => (item.id === post.id ? { ...item, ...changes } : item)));
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

  async function removeEvent(eventId: string) {
    try {
      if (persistent) {
        const result = await deleteEvent(eventId);
        if (!result.success) {
          setFeedback(result.error);
          return;
        }
      }
      setEvents((all) => all.filter((e) => e.id !== eventId));
      setPosts((all) => all.filter((p) => p.eventId !== eventId));
      setFeedback("");
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "No se pudo eliminar el evento.");
    }
  }

  const currentEvent = selected ? events.find((event) => event.id === selected.eventId) : null;
  const postValidation = selected ? validatePost(selected.network, editing) : null;

  return {
    tab,
    setTab,
    range,
    setRange,
    anchor,
    setAnchor,
    navigate,
    dates,
    monthLabel,
    expandedDay,
    setExpandedDay,
    firstRevealedPost,
    events,
    accountList,
    setAccountList,
    sources,
    setSources,
    posts,
    mode,
    profile,
    bufferApiKeyConfigured,
    selected,
    setSelected,
    editing,
    setEditing,
    reconciliationId,
    setReconciliationId,
    absenceConfirmed,
    setAbsenceConfirmed,
    showAdd,
    openAddForm,
    closeAddForm,
    newEvent,
    setNewEvent,
    sourceUrl,
    setSourceUrl,
    selectedAccountIds,
    setSelectedAccountIds,
    extractingEvent,
    extractionMessage,
    setExtractionMessage,
    hydrated,
    syncingWorkspace,
    feedback,
    persistent,
    reviewCount,
    currentEvent,
    postValidation,
    isSubstackDraft,
    addEvent,
    extractEventFromUrl,
    retryDrafts,
    refreshWorkspaceAfterSync,
    changeMode,
    changeVoice,
    changeBufferChannel,
    retryPost,
    confirmReconciledPost,
    confirmPostAbsent,
    savePostChanges,
    removeEvent,
  };
}
