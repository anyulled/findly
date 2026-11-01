import styles from "../../page.module.css";
import type { EventItem, Post, Status } from "../workspace-types";
import { dateAt } from "../workspace-calendar-dates";

interface PostDetailModalProps {
  selected: Post;
  onClose: () => void;
  currentEvent: EventItem | null | undefined;
  editing: string;
  setEditing: (val: string) => void;
  postValidation: { valid: boolean; message: string } | null;
  reconciliationId: string;
  setReconciliationId: (val: string) => void;
  absenceConfirmed: boolean;
  setAbsenceConfirmed: (val: boolean) => void;
  persistent: boolean;
  onSavePostChanges: (post: Post, next: Partial<Post>) => void;
  onRetryPost: (post: Post) => void;
  onConfirmReconciledPost: (post: Post) => void;
  onConfirmPostAbsent: (post: Post) => void;
}

export function PostDetailModal({
  selected,
  onClose,
  currentEvent,
  editing,
  setEditing,
  postValidation,
  reconciliationId,
  setReconciliationId,
  absenceConfirmed,
  setAbsenceConfirmed,
  persistent,
  onSavePostChanges,
  onRetryPost,
  onConfirmReconciledPost,
  onConfirmPostAbsent,
}: PostDetailModalProps) {
  const isEditable = (["review", "approved", "failed"] as Status[]).includes(selected.status);

  return (
    <div
      className={styles.overlay}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <section className={styles.detailPanel}>
        <button className={styles.close} onClick={onClose}>
          ×
        </button>
        <div className={styles.eyebrow}>DETALLE DE PUBLICACIÓN</div>
        <h2>
          {currentEvent?.title ||
            (selected.text ? selected.text.split("\n")[0].trim() : "Publicación")}
        </h2>
        <div className={styles.detailDate}>
          ◷ &nbsp;
          {dateAt(selected.date).toLocaleDateString("es-ES", {
            weekday: "long",
            day: "numeric",
            month: "long",
          })}{" "}
          · {selected.time} · Europe/Madrid
        </div>
        <div className={styles.channelChip}>
          {selected.network} <span>·</span> {selected.account}
        </div>
        <label className={styles.postEditor}>
          TEXTO DE LA PUBLICACIÓN
          <textarea
            value={editing}
            disabled={!isEditable}
            onChange={(e) => setEditing(e.target.value)}
            rows={8}
          />
        </label>
        <div className={styles.characterCount}>
          {postValidation?.message} <span>Validación local por red.</span>
        </div>
        {selected.lastError && <p className={styles.deliveryError}>{selected.lastError}</p>}
        {["needs_reconciliation", "scheduling"].includes(selected.status) && (
          <div className={styles.reconcileBox}>
            <p>
              {selected.status === "scheduling"
                ? "El envío puede seguir en curso. Si ya aparece en Buffer, puedes confirmar su ID; no se puede confirmar su ausencia mientras siga en curso."
                : "Comprueba la cola de Buffer. Si encuentras la publicación, pega su ID para confirmar el envío."}
            </p>
            <label>
              ID DEL POST DE BUFFER
              <input
                aria-label="ID confirmado del post de Buffer"
                value={reconciliationId}
                onChange={(event) => setReconciliationId(event.target.value)}
              />
            </label>
            <button
              className={styles.secondaryButton}
              disabled={!reconciliationId.trim()}
              onClick={() => {
                onConfirmReconciledPost(selected);
              }}
            >
              Confirmar que está programada
            </button>
            {selected.status === "needs_reconciliation" && (
              <>
                <label className={styles.absenceConfirm}>
                  <input
                    type="checkbox"
                    checked={absenceConfirmed}
                    onChange={(event) => setAbsenceConfirmed(event.target.checked)}
                  />{" "}
                  He revisado el canal y no aparece ningún post coincidente.
                </label>
                <button
                  className={styles.secondaryButton}
                  disabled={!absenceConfirmed}
                  onClick={() => {
                    onConfirmPostAbsent(selected);
                  }}
                >
                  Confirmar ausencia y permitir reintento
                </button>
              </>
            )}
          </div>
        )}
        <div className={styles.detailActions}>
          {isEditable && (
            <button
              className={styles.secondaryButton}
              onClick={() => {
                onSavePostChanges(selected, { text: editing });
              }}
            >
              Guardar cambios
            </button>
          )}
          {selected.status === "review" && (
            <button
              className={styles.approveButton}
              onClick={() => {
                onSavePostChanges(selected, { text: editing, status: "approved" });
              }}
              disabled={!postValidation?.valid}
            >
              {persistent ? "✓ Aprobar, programar y guardar ejemplo" : "✓ Aprobar y guardar ejemplo"}
            </button>
          )}
          {selected.status === "failed" && (
            <button
              className={styles.approveButton}
              onClick={() => {
                onRetryPost(selected);
              }}
            >
              Reintentar envío
            </button>
          )}
        </div>
        <p className={styles.autoNote}>
          {selected.status === "scheduled"
            ? `Programada en Buffer · ID ${selected.bufferPostId ?? "guardado"}`
            : selected.status === "scheduling"
              ? "El envío puede seguir en curso. Si aparece en Buffer, registra su ID; una ausencia no se puede confirmar durante el envío."
              : selected.status === "needs_reconciliation"
                ? "Estado incierto; conciliación manual necesaria antes de cualquier reintento."
                : selected.status === "failed"
                  ? "Buffer rechazó el envío o falta configuración. Corrige el problema y vuelve a intentarlo."
                  : selected.status === "review"
                    ? persistent
                      ? "Al aprobar se programa en Buffer y se guarda el texto final como ejemplo de estilo."
                      : "En la demo, al aprobar se guarda el texto en este navegador como ejemplo local."
                    : selected.status === "published"
                      ? "La red confirmó la publicación."
                      : "Edita y guarda el texto antes de aprobarlo."}
        </p>
      </section>
    </div>
  );
}
