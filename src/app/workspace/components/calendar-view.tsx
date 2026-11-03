import type { RefObject } from "react";
import styles from "../../page.module.css";
import type { EventItem, Post, Range } from "../workspace-types";
import { statusLabels } from "../workspace-types";
import { dayKey } from "../workspace-calendar-dates";
import { ChevronLeft, ChevronRight, Plus, Sparkles, CheckCircle2, ArrowRight } from "lucide-react";
import { NetworkIcon } from "@/components/ui/network-icon";

interface CalendarViewProps {
  persistent: boolean;
  range: Range;
  setRange: (range: Range) => void;
  anchor: Date;
  setAnchor: (anchor: Date) => void;
  navigate: (direction: number) => void;
  dates: Date[];
  monthLabel: string;
  expandedDay: string | null;
  setExpandedDay: (day: string | null) => void;
  firstRevealedPost: RefObject<HTMLButtonElement | null>;
  events: EventItem[];
  posts: Post[];
  reviewCount: number;
  openAddForm: () => void;
  setTab: (tab: string) => void;
  onSelectPost: (post: Post) => void;
}

const RANGES: Range[] = ["Quincena", "Semana", "Mes"];
const WEEKDAYS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"] as const;

export function CalendarView({
  persistent,
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
  posts,
  reviewCount,
  openAddForm,
  setTab,
  onSelectPost,
}: CalendarViewProps) {
  return (
    <>
      <div className={styles.pageHeading}>
        <div>
          <div className={styles.eyebrow}>TU CONTENIDO, DE UN VISTAZO</div>
          <h1>Calendario</h1>
          <p>Todos tus anuncios, en un solo lugar.</p>
        </div>
        <button className={styles.mobileAdd} onClick={openAddForm}>
          <Plus size={16} aria-hidden="true" style={{ marginRight: 4 }} /> Evento
        </button>
      </div>

      <div className={styles.notice}>
        <span className={styles.noticeIcon}>
          {persistent ? (
            <CheckCircle2 size={16} aria-hidden="true" />
          ) : (
            <Sparkles size={16} aria-hidden="true" />
          )}
        </span>
        <div>
          <b>{persistent ? "Datos guardados en Supabase" : "Modo demostración"}</b>
          <span>
            {persistent
              ? "Los recordatorios se programan por Buffer al aprobarlos o al generarlos en modo automático. Los resultados inciertos requieren conciliación manual."
              : "Los cambios se guardan en este navegador. Configura Supabase para usar persistencia compartida."}
          </span>
        </div>
        <button onClick={() => setTab("Ajustes")}>
          Ver configuración <ArrowRight size={14} aria-hidden="true" style={{ marginLeft: 4 }} />
        </button>
      </div>

      <div className={styles.calendarToolbar}>
        <div className={styles.period}>
          <button onClick={() => navigate(-1)} aria-label="Periodo anterior">
            <ChevronLeft size={16} aria-hidden="true" />
          </button>
          <button onClick={() => setAnchor(new Date())} className={styles.today}>
            Hoy
          </button>
          <button onClick={() => navigate(1)} aria-label="Periodo siguiente">
            <ChevronRight size={16} aria-hidden="true" />
          </button>
          <h2>{monthLabel}</h2>
        </div>
        <div className={styles.viewToggle}>
          {RANGES.map((opt) => (
            <button
              key={opt}
              onClick={() => setRange(opt)}
              className={range === opt ? styles.viewSelected : ""}
              aria-pressed={range === opt}
            >
              {opt}
            </button>
          ))}
        </div>
      </div>

      <div className={styles.calendar}>
        <div className={styles.weekdays}>
          {WEEKDAYS.map((d) => (
            <div key={d}>{d}</div>
          ))}
        </div>
        <div className={styles.days} data-testid="calendar-days">
          {dates.map((date) => {
            const key = dayKey(date);
            const offMonth = range === "Mes" && date.getMonth() !== anchor.getMonth();
            const dayPosts = posts
              .filter((p) => p.date === key && p.status !== "discarded")
              .sort((a, b) => a.time.localeCompare(b.time));
            const expanded = expandedDay === key;
            const visiblePosts = expanded ? dayPosts : dayPosts.slice(0, 3);
            return (
              <div
                key={key}
                data-testid="calendar-day"
                data-calendar-date={key}
                className={`${styles.day} ${offMonth ? styles.offMonth : ""} ${key === dayKey(new Date()) ? styles.isToday : ""}`}
              >
                <div className={styles.dayHeader}>
                  <span>{date.getDate()}</span>
                  {dayPosts.length > 0 && <small>{dayPosts.length}</small>}
                </div>
                <div className={styles.dayPosts} id={`posts-${key}`}>
                  {visiblePosts.map((post, index) => {
                    const event = events.find((e) => e.id === post.eventId);
                    const title =
                      event?.title ||
                      (post.text ? post.text.split("\n")[0].trim().slice(0, 50) : "Publicación");
                    return (
                      <button
                        key={post.id}
                        ref={expanded && index === 3 ? firstRevealedPost : undefined}
                        className={`${styles.postPill} ${styles["post" + post.status]}`}
                        onClick={() => onSelectPost(post)}
                        aria-label={`${title} · ${post.account} · ${post.network} · ${statusLabels[post.status]}`}
                        title={title}
                      >
                        <span className={styles.networkDot}>
                          <NetworkIcon network={post.network} size={13} />
                        </span>
                        <span className={styles.postDescription}>
                          <span className={styles.pillText}>{title}</span>
                          {expanded && (
                            <span className={styles.postMeta}>
                              {post.account} · {post.network}
                            </span>
                          )}
                        </span>
                      </button>
                    );
                  })}
                </div>
                {dayPosts.length > 3 && (
                  <button
                    className={styles.morePosts}
                    aria-controls={`posts-${key}`}
                    aria-expanded={expanded}
                    aria-label={
                      expanded
                        ? `Mostrar menos publicaciones del ${key}`
                        : `Mostrar ${dayPosts.length - 3} publicaciones más del ${key}`
                    }
                    onClick={() => setExpandedDay(expanded ? null : key)}
                  >
                    {expanded ? "Mostrar menos" : `+${dayPosts.length - 3} más`}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className={styles.legend}>
        <span>
          <i className={styles.legendReview} /> Revisión pendiente
        </span>
        <span>
          <i className={styles.legendApproved} /> Aprobada
        </span>
        <span>
          <i className={styles.legendScheduled} /> Programada
        </span>
        <span className={styles.legendCount}>
          {reviewCount} pendientes de revisión
        </span>
      </div>
    </>
  );
}
