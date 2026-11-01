import styles from "../../page.module.css";
import { selectEventAccounts, hasMissingReminders } from "@/lib/event-targets";
import type { SourceView } from "../../workspace-actions";
import type { Account, EventItem, Post } from "../workspace-types";
import { dateAt, scheduleDates } from "../workspace-calendar-dates";

interface EventListProps {
  events: EventItem[];
  posts: Post[];
  sources: SourceView[];
  accountList: Account[];
  persistent: boolean;
  openAddForm: () => void;
  onRetryDrafts: (event: EventItem) => void;
  onRemoveEvent: (eventId: string) => void;
}

export function EventList({
  events,
  posts,
  sources,
  accountList,
  persistent,
  openAddForm,
  onRetryDrafts,
  onRemoveEvent,
}: EventListProps) {
  return (
    <>
      <div className={styles.pageHeading}>
        <div>
          <div className={styles.eyebrow}>EVENTOS DETECTADOS Y MANUALES</div>
          <h1>Eventos</h1>
          <p>Gestiona los eventos y las publicaciones que generan.</p>
        </div>
        <button className={styles.addButton} onClick={openAddForm}>
          ＋ Añadir evento
        </button>
      </div>

      {events.length === 0 ? (
        <p className={styles.emptyNotice}>Aún no hay eventos registrados.</p>
      ) : (
        <div className={styles.eventsList}>
          {events.map((event) => {
            const eventPosts = posts.filter((post) => post.eventId === event.id);
            const links = sources.flatMap((source) =>
              source.accountIds.map((accountId) => ({ sourceId: source.id, accountId })),
            );
            const eligibleAccounts = selectEventAccounts(accountList, event.sourceId, links);
            const expectedLeadDays =
              event.source === "Substack"
                ? ([1] as const)
                : scheduleDates(event.date).map(({ leadDays }) => leadDays);
            const missing = hasMissingReminders(eligibleAccounts, expectedLeadDays, eventPosts);

            return (
              <article key={event.id} className={styles.eventCard}>
                <div className={styles.eventDate}>
                  <b>{dateAt(event.date).toLocaleDateString("es-ES", { day: "2-digit" })}</b>
                  <span>{dateAt(event.date).toLocaleDateString("es-ES", { month: "short" })}</span>
                </div>
                <div className={styles.eventInfo}>
                  <div className={styles.eventMeta}>
                    <span className={styles.sourceTag}>{event.source}</span>
                    <span>
                      {event.source === "Substack" && !event.place
                        ? "Artículo"
                        : `${event.time} · ${event.place}`}
                    </span>
                  </div>
                  <h3>{event.title}</h3>
                  <p>{event.description}</p>
                  <div className={styles.eventFoot}>
                    {eventPosts.length} publicaciones previstas{" "}
                    {persistent && missing && (
                      <button
                        className={styles.morePosts}
                        onClick={() => {
                          onRetryDrafts(event);
                        }}
                      >
                        Completar recordatorios
                      </button>
                    )}{" "}
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
                    >
                      {event.source === "Manual" ? "Añadido manualmente" : "Abrir evento ↗"}
                    </a>
                  </div>
                </div>
                <div className={styles.eventActions}>
                  <button
                    type="button"
                    className={styles.secondaryButton}
                    onClick={() => {
                      onRemoveEvent(event.id);
                    }}
                    aria-label={`Eliminar evento ${event.title}`}
                  >
                    Eliminar
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </>
  );
}
