import { useMemo, useState } from "react";
import styles from "./event-list.module.css";
import { selectEventAccounts, hasMissingReminders } from "@/lib/event-targets";
import {
  paginateItems,
  getEventPlannedPosts,
  canGenerateEventDrafts,
  isPostDeletable,
} from "@/lib/event-pagination";
import type { SourceView } from "../../workspace-actions";
import type { Account, EventItem, Post, Status } from "../workspace-types";
import { dateAt, scheduleDates, sortEventsReverseChronological } from "../workspace-calendar-dates";
import {
  Plus,
  ExternalLink,
  Trash2,
  Sparkles,
  ChevronDown,
  ChevronUp,
  Pencil,
  RefreshCw,
  Calendar,
} from "lucide-react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { NetworkIcon } from "@/components/ui/network-icon";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";

const EVENTS_PER_PAGE = 6;

const statusVariants: Record<Status, BadgeVariant> = {
  review: "warning",
  approved: "secondary",
  scheduling: "secondary",
  scheduled: "default",
  published: "success",
  failed: "destructive",
  needs_reconciliation: "warning",
  discarded: "secondary",
};

const statusLabels: Record<Status, string> = {
  review: "Pendiente",
  approved: "Aprobada",
  scheduling: "Enviando",
  scheduled: "Programada",
  published: "Publicada",
  failed: "Fallida",
  needs_reconciliation: "Conciliación",
  discarded: "Descartada",
};

/**
 * Calculates a sliding window of visible page numbers for responsive pagination controls.
 *
 * @param current - The 1-based active page index.
 * @param total - The total number of pages available.
 * @returns An array of page numbers to display.
 */
function getVisiblePageNumbers(current: number, total: number): number[] {
  if (total <= 5) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }
  const start = Math.max(1, Math.min(current - 2, total - 4));
  return Array.from({ length: 5 }, (_, i) => start + i);
}

interface EventListProps {
  events: EventItem[];
  posts: Post[];
  sources: SourceView[];
  accountList: Account[];
  persistent: boolean;
  deletingEventId?: string | null;
  openAddForm: () => void;
  onRetryDrafts: (event: EventItem) => void | Promise<void>;
  onRemoveEvent: (eventId: string) => void | Promise<void>;
  onSelectPost?: (post: Post) => void;
  onRemoveDraft?: (post: Post) => void | Promise<void>;
}

/**
 * Responsive compact event list view with expandable planned publications,
 * publication editing, draft deletion, generation CTAs, and pagination.
 *
 * @param props - Event list configuration, datasets, and action handlers.
 * @returns The rendered events view.
 */
export function EventList({
  events,
  posts,
  sources,
  accountList,
  persistent,
  deletingEventId,
  openAddForm,
  onRetryDrafts,
  onRemoveEvent,
  onSelectPost,
  onRemoveDraft,
}: EventListProps) {
  const [currentPage, setCurrentPage] = useState(1);
  const [expandedEventIds, setExpandedEventIds] = useState<Set<string>>(() => new Set());
  const [generatingEventIds, setGeneratingEventIds] = useState<Set<string>>(() => new Set());

  const sortedEvents = useMemo(() => sortEventsReverseChronological(events), [events]);
  const pagination = useMemo(
    () => paginateItems(sortedEvents, currentPage, EVENTS_PER_PAGE),
    [sortedEvents, currentPage],
  );

  function toggleEventExpand(eventId: string) {
    setExpandedEventIds((prev) => {
      const next = new Set(prev);
      if (next.has(eventId)) {
        next.delete(eventId);
      } else {
        next.add(eventId);
      }
      return next;
    });
  }

  async function handleGeneratePosts(event: EventItem) {
    if (generatingEventIds.has(event.id)) return;
    setGeneratingEventIds((prev) => new Set(prev).add(event.id));
    try {
      await onRetryDrafts(event);
      // Auto-expand the event so the user sees the newly generated publications
      setExpandedEventIds((prev) => new Set(prev).add(event.id));
    } finally {
      setGeneratingEventIds((prev) => {
        const next = new Set(prev);
        next.delete(event.id);
        return next;
      });
    }
  }

  return (
    <>
      <div className={styles.pageHeading}>
        <div>
          <div className={styles.eyebrow}>EVENTOS DETECTADOS Y MANUALES</div>
          <h1 className={styles.title}>Eventos</h1>
          <p className={styles.subtitle}>Gestiona los eventos y las publicaciones que generan.</p>
        </div>
        <Button className={styles.addButton} onClick={openAddForm}>
          <Plus size={16} aria-hidden="true" /> Añadir evento
        </Button>
      </div>

      {sortedEvents.length === 0 ? (
        <div className={styles.emptyNotice}>
          <p>Aún no hay eventos registrados.</p>
          <Button variant="outline" onClick={openAddForm} style={{ marginTop: 12 }}>
            <Plus size={15} style={{ marginRight: 6 }} /> Añadir primer evento
          </Button>
        </div>
      ) : (
        <>
          <div className={styles.eventsGrid}>
            {pagination.items.map((event) => {
              const allEventPosts = posts.filter((p) => p.eventId === event.id);
              const eventPosts = getEventPlannedPosts(posts, event.id);
              const links = sources.flatMap((source) =>
                source.accountIds.map((accountId) => ({ sourceId: source.id, accountId })),
              );
              const eligibleAccounts = selectEventAccounts(accountList, event.sourceId, links, event.accountIds);
              const expectedLeadDays =
                event.source === "Substack"
                  ? ([1] as const)
                  : scheduleDates(event.date).map(({ leadDays }) => leadDays);
              const missing = hasMissingReminders(eligibleAccounts, expectedLeadDays, eventPosts);
              const hasZeroPosts = canGenerateEventDrafts(allEventPosts);
              const isExpanded = expandedEventIds.has(event.id);
              const isGenerating = generatingEventIds.has(event.id);

              return (
                <article key={event.id} className={styles.eventCard}>
                  <Card style={{ border: "none", boxShadow: "none", background: "transparent" }}>
                    <CardHeader style={{ padding: "16px 16px 8px" }}>
                      <div className={styles.cardTop}>
                        <div className={styles.dateAndMeta}>
                          <div className={styles.eventDate}>
                            <b>{dateAt(event.date).toLocaleDateString("es-ES", { day: "2-digit" })}</b>
                            <span>{dateAt(event.date).toLocaleDateString("es-ES", { month: "short" })}</span>
                          </div>
                          <div className={styles.metaInfo}>
                            <div className={styles.metaBadges}>
                              <Badge variant="secondary">{event.source}</Badge>
                            </div>
                            <span className={styles.metaDetails} title={`${event.time} · ${event.place}`}>
                              {event.source === "Substack" && !event.place
                                ? "Artículo"
                                : `${event.time} · ${event.place}`}
                            </span>
                          </div>
                        </div>

                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          disabled={deletingEventId === event.id}
                          onClick={() => {
                            void onRemoveEvent(event.id);
                          }}
                          aria-label={`Eliminar evento ${event.title}`}
                          style={{ color: "var(--text-muted)" }}
                        >
                          <Trash2 size={14} aria-hidden="true" style={{ marginRight: 4 }} />
                          {deletingEventId === event.id ? "Eliminando…" : "Eliminar"}
                        </Button>
                      </div>

                      <CardTitle className={styles.eventTitle}>{event.title}</CardTitle>
                      {event.description && (
                        <CardDescription className={styles.eventDescription}>
                          {event.description}
                        </CardDescription>
                      )}

                      <a
                        href={
                          event.url ??
                          (event.source === "Luma"
                            ? "https://lu.ma"
                            : event.source === "Meetup"
                              ? "https://meetup.com"
                              : "#")
                        }
                        target={event.url ? "_blank" : undefined}
                        rel="noreferrer"
                        className={styles.eventLink}
                      >
                        {event.source === "Manual" ? (
                          "Añadido manualmente"
                        ) : (
                          <>
                            Abrir evento <ExternalLink size={13} aria-hidden="true" />
                          </>
                        )}
                      </a>
                    </CardHeader>

                    <CardContent style={{ padding: "8px 16px 16px" }}>
                      <div className={styles.publicationsSection}>
                        <div className={styles.publicationsHeader}>
                          <span
                            className={[
                              styles.plannedCountBadge,
                              eventPosts.length === 0 ? styles.plannedCountZero : "",
                            ]
                              .filter(Boolean)
                              .join(" ")}
                          >
                            {eventPosts.length} publicaciones previstas
                          </span>

                          <div style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                            {persistent && missing && (
                              <Button
                                variant="outline"
                                size="sm"
                                disabled={isGenerating}
                                onClick={() => {
                                  void handleGeneratePosts(event);
                                }}
                                style={{ fontSize: 12, height: 28, padding: "0 8px" }}
                              >
                                <RefreshCw
                                  size={12}
                                  className={isGenerating ? "animate-spin" : ""}
                                  style={{ marginRight: 4 }}
                                />
                                Completar recordatorios
                              </Button>
                            )}

                            {eventPosts.length > 0 && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => toggleEventExpand(event.id)}
                                aria-expanded={isExpanded}
                                style={{ fontSize: 12, height: 28, padding: "0 8px", gap: 4 }}
                              >
                                {isExpanded ? (
                                  <>
                                    Ocultar <ChevronUp size={13} />
                                  </>
                                ) : (
                                  <>
                                    Ver ({eventPosts.length}) <ChevronDown size={13} />
                                  </>
                                )}
                              </Button>
                            )}
                          </div>
                        </div>

                        {hasZeroPosts && (
                          <div className={styles.createPublicationsNotice}>
                            <span className={styles.createNoticeText}>
                              Este evento no tiene publicaciones programadas.
                            </span>
                            <Button
                              variant="default"
                              size="sm"
                              disabled={isGenerating}
                              onClick={() => {
                                void handleGeneratePosts(event);
                              }}
                              style={{ gap: 6 }}
                            >
                              <Sparkles size={14} aria-hidden="true" />
                              {isGenerating ? "Generando…" : "Generar publicaciones"}
                            </Button>
                          </div>
                        )}

                        {!hasZeroPosts && eventPosts.length === 0 && (
                          <div className={styles.createPublicationsNotice}>
                            <span className={styles.createNoticeText}>
                              Todas las publicaciones previstas fueron descartadas.
                            </span>
                          </div>
                        )}

                        {isExpanded && eventPosts.length > 0 && (
                          <div className={styles.postsList}>
                            {eventPosts.map((post) => (
                              <div key={post.id} className={styles.postItem} data-testid="planned-post-item">
                                <div className={styles.postItemHeader}>
                                  <div className={styles.postItemMeta}>
                                    <NetworkIcon network={post.network} size={14} />
                                    <span className={styles.postAccountBadge}>{post.account}</span>
                                    <Badge variant="outline" style={{ fontSize: 11, padding: "1px 6px" }}>
                                      {post.network}
                                    </Badge>
                                    <span className={styles.postDate}>
                                      <Calendar size={11} style={{ display: "inline", marginRight: 3 }} />
                                      {post.date} · {post.time}
                                    </span>
                                  </div>
                                  <Badge variant={statusVariants[post.status] ?? "secondary"} style={{ fontSize: 11, padding: "2px 6px" }}>
                                    {statusLabels[post.status] ?? post.status}
                                  </Badge>
                                </div>

                                {post.text && (
                                  <p className={styles.postSnippet} title={post.text}>
                                    {post.text}
                                  </p>
                                )}

                                <div className={styles.postItemActions}>
                                  {onSelectPost && (
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      onClick={() => onSelectPost(post)}
                                      style={{ height: 26, fontSize: 11.5, padding: "0 8px", gap: 4 }}
                                      title="Editar texto o reprogramar fecha y hora"
                                    >
                                      <Pencil size={11} aria-hidden="true" />
                                      Editar / Reprogramar
                                    </Button>
                                  )}

                                  {onRemoveDraft && isPostDeletable(post.status) && (
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      onClick={() => {
                                        void onRemoveDraft(post);
                                      }}
                                      style={{ height: 26, fontSize: 11.5, padding: "0 8px", color: "var(--destructive)" }}
                                      title="Eliminar publicación"
                                    >
                                      <Trash2 size={11} aria-hidden="true" />
                                      Eliminar
                                    </Button>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                </article>
              );
            })}
          </div>

          {pagination.totalPages > 1 && (
            <div className={styles.paginationFooter}>
              <span className={styles.paginationSummary}>
                Mostrando {pagination.startIndex + 1} - {pagination.endIndex} de {pagination.totalCount} eventos
              </span>
              <Pagination>
                <PaginationContent>
                  <PaginationItem>
                    <PaginationPrevious
                      disabled={!pagination.hasPreviousPage}
                      onClick={() => setCurrentPage(Math.max(1, pagination.page - 1))}
                    />
                  </PaginationItem>

                  {getVisiblePageNumbers(pagination.page, pagination.totalPages).map((pageNum) => (
                    <PaginationItem key={pageNum}>
                      <PaginationLink
                        isActive={pageNum === pagination.page}
                        onClick={() => setCurrentPage(pageNum)}
                      >
                        {pageNum}
                      </PaginationLink>
                    </PaginationItem>
                  ))}

                  <PaginationItem>
                    <PaginationNext
                      disabled={!pagination.hasNextPage}
                      onClick={() => setCurrentPage(Math.min(pagination.totalPages, pagination.page + 1))}
                    />
                  </PaginationItem>
                </PaginationContent>
              </Pagination>
            </div>
          )}
        </>
      )}
    </>
  );
}
