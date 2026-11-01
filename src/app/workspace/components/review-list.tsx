"use client";

import { useId, useState } from "react";
import styles from "../../page.module.css";
import type { Account, EventItem, Post } from "../workspace-types";
import { matchesAccount } from "../workspace-types";
import { dateAt } from "../workspace-calendar-dates";
import {
  countReviewPosts,
  filterReviewPosts,
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
    const targets = groupPosts.filter((p) => p.status === "review");
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
          <div className={styles.reviewEmptyIcon} aria-hidden="true">✓</div>
          <h2>¡Todo al día!</h2>
          <p>
            No tienes publicaciones pendientes de revisión ni incidencias de envío en este momento.
          </p>
          <div className={styles.reviewEmptyActions}>
            <button
              type="button"
              className={styles.approveButton}
              onClick={() => setTab("Calendario")}
            >
              Ver Calendario
            </button>
            <button
              type="button"
              className={styles.secondaryButton}
              onClick={() => setTab("Eventos")}
            >
              Ver Eventos
            </button>
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
            const reviewPostsInGroup = group.posts.filter((p) => p.status === "review");
            const canBatch = reviewPostsInGroup.length > 0;
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
                      <button
                        type="button"
                        className={styles.approveAllButton}
                        disabled={isBatchProcessing}
                        onClick={() => void handleApproveAllForEvent(group.posts, group.eventId)}
                        aria-label={`Aprobar todas las publicaciones pendientes de ${event?.title || "este evento"}`}
                      >
                        {isBatchProcessing
                          ? "Aprobando…"
                          : `✓ Aprobar todas (${reviewPostsInGroup.length})`}
                      </button>
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
                      <div key={post.id} className={styles.reviewPostCard}>
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
                            <span className={styles.reviewNetworkBadge}>{post.network}</span>
                          </div>

                          <div className={styles.reviewPostMeta}>
                            {scheduledLabel && <span>{scheduledLabel}</span>}
                            <span
                              className={`${styles.reviewStatusBadge} ${
                                isReview
                                  ? styles.reviewStatusReview
                                  : isFailed
                                    ? styles.reviewStatusFailed
                                    : ""
                              }`}
                            >
                              {isReview
                                ? "Pendiente de revisión"
                                : isFailed
                                  ? "Envío fallido"
                                  : post.status}
                            </span>
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
                          <button
                            type="button"
                            className={styles.secondaryButton}
                            disabled={isProcessing}
                            onClick={() => void handleRemoveSingle(post)}
                          >
                            {isProcessing
                              ? "Eliminando…"
                              : isFailed
                                ? "✕ Eliminar"
                                : "✕ Descartar"}
                          </button>
                          <button
                            type="button"
                            className={styles.secondaryButton}
                            disabled={isProcessing}
                            onClick={() => onSelectPost(post)}
                          >
                            ✎ Editar
                          </button>
                          {isReview && (
                            <button
                              type="button"
                              className={styles.approveButton}
                              disabled={isProcessing}
                              onClick={() => void handleApproveSingle(post)}
                            >
                              {isProcessing
                                ? "Aprobando…"
                                : persistent
                                  ? "✓ Aprobar y programar"
                                  : "✓ Aprobar"}
                            </button>
                          )}
                          {isFailed && (
                            <button
                              type="button"
                              className={styles.approveButton}
                              disabled={isProcessing}
                              onClick={() => void handleRetrySingle(post)}
                            >
                              {isProcessing ? "Reintentando…" : "↻ Reintentar envío"}
                            </button>
                          )}
                        </div>
                      </div>
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
