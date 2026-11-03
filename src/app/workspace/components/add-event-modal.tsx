import type { Dispatch, SetStateAction } from "react";
import styles from "../../page.module.css";
import type { Account } from "../workspace-types";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";

interface AddEventFormState {
  title: string;
  date: string;
  time: string;
  place: string;
  description: string;
  source: string;
  imageUrl: string;
}

interface AddEventModalProps {
  onClose: () => void;
  sourceUrl: string;
  setSourceUrl: (url: string) => void;
  extractingEvent: boolean;
  extractionMessage: string;
  setExtractionMessage: (msg: string) => void;
  newEvent: AddEventFormState;
  setNewEvent: Dispatch<SetStateAction<AddEventFormState>>;
  isSubstackDraft: boolean;
  accounts: Account[];
  selectedAccountIds: string[];
  setSelectedAccountIds: Dispatch<SetStateAction<string[]>>;
  onExtract: () => void;
  onAddEvent: () => void;
}

export function AddEventModal({
  onClose,
  sourceUrl,
  setSourceUrl,
  extractingEvent,
  extractionMessage,
  setExtractionMessage,
  newEvent,
  setNewEvent,
  isSubstackDraft,
  accounts,
  selectedAccountIds,
  setSelectedAccountIds,
  onExtract,
  onAddEvent,
}: AddEventModalProps) {
  return (
    <Dialog open={true} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent showClose={true}>
        <DialogHeader>
          <div className={styles.eyebrow}>NUEVO EVENTO</div>
          <DialogTitle>Añade un evento</DialogTitle>
          <DialogDescription className={styles.modalDesc}>
            Pega la URL pública de cualquier evento para extraer los datos automáticamente.
            Podrás revisarlos y corregirlos antes de guardar.
          </DialogDescription>
        </DialogHeader>
        <label className={styles.formLabel}>
          ENLACE DEL EVENTO
          <input
            aria-label="URL del evento"
            value={sourceUrl}
            disabled={extractingEvent}
            onChange={(e) => {
              setSourceUrl(e.target.value);
              setExtractionMessage("");
            }}
            placeholder="https://ejemplo.com/evento"
          />
        </label>
        <Button
          variant="secondary"
          onClick={onExtract}
          disabled={!sourceUrl.trim() || extractingEvent}
          style={{ width: "100%", marginTop: "6px" }}
        >
          {extractingEvent ? "Extrayendo…" : "Extraer datos del evento"}
        </Button>
        {extractionMessage && (
          <p className={styles.extractionMessage} role="status">
            {extractionMessage}
          </p>
        )}
        {extractingEvent && (
          <div style={{ margin: "12px 0", display: "flex", flexDirection: "column", gap: "8px" }}>
            <Skeleton style={{ height: "20px", width: "70%" }} />
            <Skeleton style={{ height: "36px", width: "100%" }} />
          </div>
        )}
        <div className={styles.formDivider}>
          <span>revisa o completa los datos</span>
        </div>
        <label className={styles.formLabel}>
          TÍTULO
          <input
            value={newEvent.title}
            disabled={extractingEvent}
            onChange={(e) => setNewEvent({ ...newEvent, title: e.target.value })}
            placeholder="Nombre del evento"
          />
        </label>
        <div className={styles.formGrid}>
          <label className={styles.formLabel}>
            FECHA
            <input
              type="date"
              value={newEvent.date}
              disabled={extractingEvent}
              onChange={(e) => setNewEvent({ ...newEvent, date: e.target.value })}
            />
          </label>
          <label className={styles.formLabel}>
            HORA
            <input
              type="time"
              value={newEvent.time}
              disabled={extractingEvent}
              onChange={(e) => setNewEvent({ ...newEvent, time: e.target.value })}
            />
          </label>
        </div>
        <label className={styles.formLabel}>
          LUGAR
          <input
            value={newEvent.place}
            disabled={extractingEvent}
            onChange={(e) => setNewEvent({ ...newEvent, place: e.target.value })}
          />
        </label>
        <label className={styles.formLabel}>
          DESCRIPCIÓN
          <textarea
            rows={3}
            value={newEvent.description}
            disabled={extractingEvent}
            onChange={(e) => setNewEvent({ ...newEvent, description: e.target.value })}
            placeholder="¿Qué ocurrirá en el evento?"
          />
        </label>
        <fieldset className={styles.sourceAccountsFieldset}>
          <legend>CUENTAS</legend>
          {accounts.flatMap((account) => {
            if (!account.id || account.enabled === false) return [];
            const accountId = account.id;
            return [
              <label key={accountId} style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
                <Checkbox
                  checked={selectedAccountIds.includes(accountId)}
                  onCheckedChange={(checked) =>
                    setSelectedAccountIds((current) =>
                      checked
                        ? [...current, accountId]
                        : current.filter((id) => id !== accountId)
                    )
                  }
                />
                <span>{account.name}</span>
              </label>,
            ];
          })}
        </fieldset>
        <DialogFooter className={styles.modalActions}>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            variant="default"
            onClick={onAddEvent}
            disabled={
              extractingEvent ||
              selectedAccountIds.length === 0 ||
              !newEvent.title.trim() ||
              (!isSubstackDraft && (!newEvent.date || !newEvent.time))
            }
          >
            Crear evento
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
