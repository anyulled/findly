"use client";

import { useId, useState } from "react";
import styles from "../../page.module.css";
import type { Account, EventItem, Post } from "../workspace-types";
import { matchesAccount } from "../workspace-types";
import { dateAt } from "../workspace-calendar-dates";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { NetworkIcon } from "@/components/ui/network-icon";
import { CheckCheck, Check, Pencil, Trash2, RefreshCw } from "lucide-react";
import {
  canBatchApprove,
  countReviewPosts,
  filterReviewPosts,
  getBatchApproveTargets,
  groupReviewPostsByEvent,
  type ReviewFilter,
} from "@/lib/reviews";

interface ReviewListProps {
  posts: Post[];
  events: EventItem[];
  accountList: Account[];
  persistent: boolean;
  onSelectPost: (post: Post) => void;
  onApprovePost: (post: Post) => Promise<void>;
  onRetryPost: (post: Post) => Promise<void>;
  onRemoveDraft: (post: Post) => Promise<void>;
  setTab: (tab: string) => void;
}

export function ReviewList({
  posts,
  events,
  accountList,
  persistent,
  onSelectPost,
  onApprovePost,
  onRetryPost,
  onRemoveDraft,
  setTab,
}: ReviewListProps) {
  const [filter, setFilter] = useState<ReviewFilter>("all");
  const [processingPostIds, setProcessingPostIds] = useState<Set<string>>(() => new Set());
  const [batchProcessingEventId, setBatchProcessingEventId] = useState<string | null>(null);
  const filterListId = useId();

  const counts = countReviewPosts(posts);
  const filteredPosts = filterReviewPosts(posts, filter);
  const eventGroups = groupReviewPostsByEvent(filteredPosts, events);

  async function handleApproveSingle(post: Post) {
    if (processingPostIds.has(post.id)) return;
    setProcessingPostIds((prev) => new Set(prev).add(post.id));
    try {
      await onApprovePost(post);
    } finally {
      setProcessingPostIds((prev) => {
        const next = new Set(prev);
        next.delete(post.id);
        return next;
      });
    }
  }

  async function handleRetrySingle(post: Post) {
    if (processingPostIds.has(post.id)) return;
    setProcessingPostIds((prev) => new Set(prev).add(post.id));
    try {
      await onRetryPost(post);
    } finally {
      setProcessingPostIds((prev) => {
        const next = new Set(prev);
        next.delete(post.id);
        return next;
      });
    }
  }

  async function handleRemoveSingle(post: Post) {
    if (processingPostIds.has(post.id)) return;
    setProcessingPostIds((prev) => new Set(prev).add(post.id));
    try {
      await onRemoveDraft(post);
    } finally {
      setProcessingPostIds((prev) => {
        const next = new Set(prev);
        next.delete(post.id);
        return next;
      });
    }
  }

  async function handleApproveAllForEvent(groupPosts: Post[], eventId: string) {
    const targets = getBatchApproveTargets(groupPosts);
    if (targets.length === 0 || batchProcessingEventId === eventId) return;

    setBatchProcessingEventId(eventId);
    for (const post of targets) {
      setProcessingPostIds((prev) => new Set(prev).add(post.id));
      try {
        await onApprovePost(post);
      } catch {
        break;
      } finally {
        setProcessingPostIds((prev) => {
          const next = new Set(prev);
          next.delete(post.id);
          return next;
        });
      }
    }
    setBatchProcessingEventId(null);
  }

  function resolveAccount(post: Post): Account | undefined {
    return accountList.find(
      (a) =>
        (post.accountId && a.id === post.accountId) ||
        matchesAccount(a, { name: post.account, id: post.accountId } as Account),
    );
  }

  return (
    <>
      <div className={styles.pageHeading}>
        <div>
          <div className={styles.eyebrow}>BANDEJA DE PUBLICACIONES</div>
          <h1>Revisiones</h1>
          <p>
            Revisa, edita, aprueba o descarta las publicaciones generadas antes de su programación en redes.
          </p>
        </div>
      </div>

      <nav aria-label="Filtros de revisiones" className={styles.reviewFilters}>
        <button
          type="button"
          onClick={() => setFilter("all")}
          className={`${styles.filterChip} ${filter === "all" ? styles.filterChipActive : ""}`}
          aria-pressed={filter === "all"}
        >
          <span>Todas</span>
          <span className={styles.filterBadge}>{counts.total}</span>
        </button>
        <button
          type="button"
          onClick={() => setFilter("review")}
          className={`${styles.filterChip} ${filter === "review" ? styles.filterChipActive : ""}`}
          aria-pressed={filter === "review"}
        >
          <span>Pendientes de revisión</span>
          <span className={styles.filterBadge}>{counts.review}</span>
        </button>
        <button
          type="button"
          onClick={() => setFilter("failed")}
          className={`${styles.filterChip} ${filter === "failed" ? styles.filterChipActive : ""}`}
          aria-pressed={filter === "failed"}
        >
          <span>Fallidas</span>
          <span className={styles.filterBadge}>{counts.failed}</span>
        </button>
      </nav>

      {counts.total === 0 ? (
        <section className={styles.reviewEmptyState} aria-label="Estado de revisiones">
          <div className={styles.reviewEmptyIcon} aria-hidden="true">
            <Check size={28} />
          </div>
          <h2>¡Todo al día!</h2>
          <p>
            No tienes publicaciones pendientes de revisión ni incidencias de envío en este momento.
          </p>
          <div className={styles.reviewEmptyActions}>
            <Button
              variant="default"
              onClick={() => setTab("Calendario")}
            >
              Ver Calendario
            </Button>
            <Button
              variant="secondary"
              onClick={() => setTab("Eventos")}
            >
              Ver Eventos
            </Button>
          </div>
        </section>
      ) : filteredPosts.length === 0 ? (
        <div className={styles.emptyNotice} role="status">
          {filter === "review"
            ? "No hay publicaciones pendientes de revisión en este momento."
            : filter === "failed"
              ? "¡Excelente! No hay publicaciones con errores de envío."
              : "No hay publicaciones que coincidan con el filtro seleccionado."}
        </div>
      ) : (
        <div className={styles.eventsList} id={filterListId}>
          {eventGroups.map((group) => {
            const event = group.event;
            const reviewPostsInGroup = getBatchApproveTargets(group.posts);
            const canBatch = canBatchApprove(group.posts);
            const isBatchProcessing = batchProcessingEventId === group.eventId;

            return (
              <article key={group.eventId} className={styles.reviewGroup}>
                <header className={styles.reviewGroupHeader}>
                  <div className={styles.reviewGroupEvent}>
                    {event ? (
                      <div className={styles.eventDate} aria-hidden="true">
                        <b>{dateAt(event.date).toLocaleDateString("es-ES", { day: "2-digit" })}</b>
                        <span>{dateAt(event.date).toLocaleDateString("es-ES", { month: "short" })}</span>
                      </div>
                    ) : (
                      <div className={styles.eventDate} aria-hidden="true">
                        <b>?</b>
                        <span>Evento</span>
                      </div>
                    )}
                    <div className={styles.reviewGroupTitle}>
                      <div className={styles.eventMeta}>
                        {event?.source && <span className={styles.sourceTag}>{event.source}</span>}
                        <span>
                          {event
                            ? event.source === "Substack" && !event.place
                              ? "Artículo"
                              : `${event.time || ""} · ${event.place || ""}`.trim().replace(/^·\s*|\s*·$/g, "")
                            : "Evento desconocido"}
                        </span>
                      </div>
                      <h3>{event?.title || "Evento asociado"}</h3>
                    </div>
                  </div>

                  <div className={styles.reviewGroupActions}>
                    {canBatch && (
                      <Button
                        variant="default"
                        size="sm"
                        disabled={isBatchProcessing}
                        onClick={() => void handleApproveAllForEvent(group.posts, group.eventId)}
                        aria-label={`Aprobar todas las publicaciones pendientes de ${event?.title || "este evento"}`}
                      >
                        {isBatchProcessing ? (
                          "Aprobando…"
                        ) : (
                          <>
                            <CheckCheck size={16} aria-hidden="true" />
                            Aprobar todas ({reviewPostsInGroup.length})
                          </>
                        )}
                      </Button>
                    )}
                  </div>
                </header>

                <div className={styles.reviewPostsGrid}>
                  {group.posts.map((post) => {
                    const account = resolveAccount(post);
                    const isProcessing = processingPostIds.has(post.id);
                    const isReview = post.status === "review";
                    const isFailed = post.status === "failed";

                    let scheduledLabel = "";
                    if (post.date) {
                      try {
                        const parsedDate = dateAt(post.date).toLocaleDateString("es-ES", {
                          day: "2-digit",
                          month: "short",
                        });
                        scheduledLabel = `Para el ${parsedDate} · ${post.time}`;
                      } catch {
                        scheduledLabel = `${post.date} · ${post.time}`;
                      }
                    }

                    return (
                      <Card key={post.id} className={styles.reviewPostCard}>
                        <div className={styles.reviewPostTop}>
                          <div className={styles.reviewPostAccount}>
                            {account?.logo ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={account.logo}
                                alt={account.name}
                                className={styles.reviewAccountAvatar}
                              />
                            ) : (
                              <div
                                className={`${styles.reviewAccountAvatar} ${
                                  account?.color ? styles[account.color] ?? "" : ""
                                }`}
                              >
                                {account?.initials ?? post.account.slice(0, 1)}
                              </div>
                            )}
                            <span className={styles.reviewPostAccountName}>
                              {account?.name ?? post.account}
                            </span>
                            <Badge variant="outline" style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                              <NetworkIcon network={post.network} size={13} />
                              {post.network}
                            </Badge>
                          </div>

                          <div className={styles.reviewPostMeta}>
                            {scheduledLabel && <span>{scheduledLabel}</span>}
                            <Badge
                              variant={
                                isReview
                                  ? "warning"
                                  : isFailed
                                    ? "destructive"
                                    : "secondary"
                              }
                            >
                              {isReview
                                ? "Pendiente de revisión"
                                : isFailed
                                  ? "Envío fallido"
                                  : post.status}
                            </Badge>
                          </div>
                        </div>

                        {isFailed && post.lastError && (
                          <div className={styles.reviewPostError} role="alert">
                            <strong>Error de Buffer: </strong>
                            {post.lastError}
                          </div>
                        )}

                        <div
                          className={styles.reviewPostContent}
                          tabIndex={0}
                          role="button"
                          onClick={() => onSelectPost(post)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              onSelectPost(post);
                            }
                          }}
                          aria-label={`Ver y editar publicación para ${post.network}`}
                        >
                          {post.text}
                        </div>

                        <div className={styles.reviewPostBottom}>
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={isProcessing}
                            onClick={() => void handleRemoveSingle(post)}
                          >
                            <Trash2 size={14} aria-hidden="true" />
                            {isProcessing
                              ? "Eliminando…"
                              : isFailed
                                ? "Eliminar"
                                : "Descartar"}
                          </Button>
                          <Button
                            variant="secondary"
                            size="sm"
                            disabled={isProcessing}
                            onClick={() => onSelectPost(post)}
                          >
                            <Pencil size={14} aria-hidden="true" />
                            Editar
                          </Button>
                          {isReview && (
                            <Button
                              variant="default"
                              size="sm"
                              disabled={isProcessing}
                              onClick={() => void handleApproveSingle(post)}
                            >
                              <Check size={15} aria-hidden="true" />
                              {isProcessing
                                ? "Aprobando…"
                                : persistent
                                  ? "Aprobar y programar"
                                  : "Aprobar"}
                            </Button>
                          )}
                          {isFailed && (
                            <Button
                              variant="default"
                              size="sm"
                              disabled={isProcessing}
                              onClick={() => void handleRetrySingle(post)}
                            >
                              <RefreshCw size={14} aria-hidden="true" />
                              {isProcessing ? "Reintentando…" : "Reintentar envío"}
                            </Button>
                          )}
                        </div>
                      </Card>
                    );
                  })}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </>
  );
}
