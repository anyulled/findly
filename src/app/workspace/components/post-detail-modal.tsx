import { useState } from "react";
import styles from "../../page.module.css";
import type { EventItem, Post, Status } from "../workspace-types";
import { dateAt } from "../workspace-calendar-dates";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { NetworkIcon } from "@/components/ui/network-icon";
import { Clock, Sparkles, Check, RefreshCw } from "lucide-react";

const generationErrors: Record<string, string> = {
  not_configured: "Falta configurar la clave de API o modelo de IA en el servidor.",
  provider_auth: "El proveedor de IA rechazó la autorización. Comprueba la clave y los permisos.",
  rate_limited: "El proveedor de IA alcanzó su límite de solicitudes. Inténtalo de nuevo más tarde.",
  provider_error: "No se pudo completar la solicitud al proveedor de IA. Revisa el servicio y el modelo.",
  empty_response: "El modelo de IA devolvió una respuesta vacía.",
  over_limit: "El texto generado superó el límite de caracteres de esta red.",
  output_truncated: "La generación con IA se detuvo antes de completar el texto (límite de tokens alcanzado).",
};

interface PostDetailModalProps {
  selected: Post;
  deletingDraft: boolean;
  draftDeleteError: string;
  onRemoveDraft: (post: Post) => void;
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
  onRegenerateAi?: (post: Post) => Promise<void>;
}

export function PostDetailModal({
  selected,
  deletingDraft,
  draftDeleteError,
  onRemoveDraft,
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
  onRegenerateAi,
}: PostDetailModalProps) {
  const isEditable = (["review", "approved", "failed"] as Status[]).includes(selected.status);
  const [editingDate, setEditingDate] = useState(selected.date);
  const [editingTime, setEditingTime] = useState(selected.time);
  const [regeneratingAi, setRegeneratingAi] = useState(false);
  const [aiError, setAiError] = useState("");

  const isScheduleChanged = Boolean(
    editingDate &&
    editingTime &&
    (editingDate !== selected.date || editingTime !== selected.time)
  );
  const schedulePayload = isScheduleChanged ? { date: editingDate, time: editingTime } : {};

  return (
    <Sheet open={true} modal={false} onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent showClose={true}>
        <SheetHeader>
          <div className={styles.eyebrow}>DETALLE DE PUBLICACIÓN</div>
          <SheetTitle>
            {currentEvent?.title ||
              (selected.text ? selected.text.split("\n")[0].trim() : "Publicación")}
          </SheetTitle>
        </SheetHeader>
        {isEditable ? (
          <div className={styles.schedulePicker}>
            <span className={styles.scheduleTz} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
              <Clock size={13} aria-hidden="true" /> Programar para:
            </span>
            <input
              type="date"
              aria-label="Fecha programada"
              className={styles.scheduleInput}
              value={editingDate}
              onChange={(e) => setEditingDate(e.target.value)}
            />
            <input
              type="time"
              aria-label="Hora programada"
              className={styles.scheduleInput}
              value={editingTime}
              onChange={(e) => setEditingTime(e.target.value)}
            />
            <span className={styles.scheduleTz}>Europe/Madrid</span>
          </div>
        ) : (
          <div className={styles.detailDate} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <Clock size={14} aria-hidden="true" />
            {dateAt(selected.date).toLocaleDateString("es-ES", {
              weekday: "long",
              day: "numeric",
              month: "long",
            })}{" "}
            · {selected.time} · Europe/Madrid
          </div>
        )}
        <div style={{ margin: "10px 0" }}>
          <Badge variant="outline" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <NetworkIcon network={selected.network} size={13} />
            {selected.network} · {selected.account}
          </Badge>
        </div>
        {regeneratingAi ? (
          <div style={{ display: "flex", flexDirection: "column", gap: "8px", margin: "16px 0" }}>
            <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>Regenerando texto con IA…</span>
            <Skeleton style={{ height: "140px", width: "100%", borderRadius: "8px" }} />
          </div>
        ) : (
          <label className={styles.postEditor}>
            TEXTO DE LA PUBLICACIÓN
            <textarea
              value={editing}
              disabled={!isEditable}
              onChange={(e) => setEditing(e.target.value)}
              rows={8}
            />
          </label>
        )}
        <div className={styles.characterCount}>
          {postValidation?.message} <span>Validación local por red.</span>
        </div>
        <div role="status" className={selected.generationOrigin === "fallback" ? styles.deliveryError : styles.autoNote}>
          {selected.generationOrigin === "fallback" ? (
            <>
              No se pudo generar con IA; se creó un borrador básico para revisión.{" "}
              {generationErrors[selected.generationErrorCode ?? ""] ?? "No se conoce el motivo."}
            </>
          ) : selected.generationOrigin === "openai" ? (
            "Texto generado inicialmente con OpenAI. Puede haber sido editado posteriormente."
          ) : selected.generationOrigin === "groq" ? (
            "Texto generado inicialmente con Groq. Puede haber sido editado posteriormente."
          ) : (
            "Origen de generación desconocido para esta publicación."
          )}
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
            <Button
              variant="secondary"
              disabled={!reconciliationId.trim()}
              onClick={() => {
                onConfirmReconciledPost(selected);
              }}
            >
              Confirmar que está programada
            </Button>
            {selected.status === "needs_reconciliation" && (
              <>
                <label className={styles.absenceConfirm} style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <Checkbox
                    checked={absenceConfirmed}
                    onCheckedChange={(checked) => setAbsenceConfirmed(Boolean(checked))}
                  />
                  <span>He revisado el canal y no aparece ningún post coincidente.</span>
                </label>
                <Button
                  variant="secondary"
                  disabled={!absenceConfirmed}
                  onClick={() => {
                    onConfirmPostAbsent(selected);
                  }}
                >
                  Confirmar ausencia y permitir reintento
                </Button>
              </>
            )}
          </div>
        )}
        <div className={styles.detailActions}>
          {(selected.status === "review" || selected.status === "failed") && (
            <Button
              variant="secondary"
              disabled={deletingDraft}
              onClick={() => onRemoveDraft(selected)}
              aria-label={selected.status === "failed" ? "Eliminar publicación" : "Eliminar borrador"}
            >
              {deletingDraft ? "Eliminando…" : selected.status === "failed" ? "Eliminar publicación" : "Eliminar borrador"}
            </Button>
          )}
          {isEditable && (
            <Button
              variant="secondary"
              disabled={regeneratingAi || deletingDraft}
              onClick={() => {
                onSavePostChanges(selected, { text: editing, ...schedulePayload });
              }}
            >
              Guardar cambios
            </Button>
          )}
          {isEditable && onRegenerateAi && (
            <Button
              variant="secondary"
              disabled={regeneratingAi || deletingDraft}
              onClick={async () => {
                setRegeneratingAi(true);
                setAiError("");
                try {
                  await onRegenerateAi(selected);
                } catch (err) {
                  setAiError(err instanceof Error ? err.message : "Error al regenerar con IA.");
                } finally {
                  setRegeneratingAi(false);
                }
              }}
              aria-label="Reintentar generación con IA"
            >
              {regeneratingAi ? (
                "Generando con IA…"
              ) : (
                <>
                  <Sparkles size={14} aria-hidden="true" style={{ marginRight: 6 }} />
                  Reintentar con IA
                </>
              )}
            </Button>
          )}
          {selected.status === "review" && (
            <Button
              variant="default"
              onClick={() => {
                onSavePostChanges(selected, { text: editing, status: "approved", ...schedulePayload });
              }}
              disabled={regeneratingAi || deletingDraft || !postValidation?.valid}
            >
              <Check size={15} aria-hidden="true" style={{ marginRight: 6 }} />
              {persistent ? "Aprobar, programar y guardar ejemplo" : "Aprobar y guardar ejemplo"}
            </Button>
          )}
          {selected.status === "failed" && (
            <Button
              variant="default"
              disabled={regeneratingAi || deletingDraft}
              onClick={() => {
                onRetryPost(selected);
              }}
            >
              <RefreshCw size={14} aria-hidden="true" style={{ marginRight: 6 }} />
              Reintentar envío
            </Button>
          )}
        </div>
        {aiError && <p role="alert" className={styles.deliveryError}>{aiError}</p>}
        {draftDeleteError && <p role="alert" className={styles.deliveryError}>{draftDeleteError}</p>}
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
      </SheetContent>
    </Sheet>
  );
}
