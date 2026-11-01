import type { Dispatch, SetStateAction } from "react";
import styles from "../../page.module.css";

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
  onExtract,
  onAddEvent,
}: AddEventModalProps) {
  return (
    <div
      className={styles.overlay}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <section className={styles.modal}>
        <button className={styles.close} onClick={onClose}>
          ×
        </button>
        <div className={styles.eyebrow}>NUEVO EVENTO</div>
        <h2>Añade un evento</h2>
        <p className={styles.modalDesc}>
          Pega la URL pública de cualquier evento para extraer los datos automáticamente.
          Podrás revisarlos y corregirlos antes de guardar.
        </p>
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
        <button
          className={styles.secondaryButton}
          onClick={onExtract}
          disabled={!sourceUrl.trim() || extractingEvent}
        >
          {extractingEvent ? "Extrayendo…" : "Extraer datos del evento"}
        </button>
        {extractionMessage && (
          <p className={styles.extractionMessage} role="status">
            {extractionMessage}
          </p>
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
        <div className={styles.modalActions}>
          <button className={styles.secondaryButton} onClick={onClose}>
            Cancelar
          </button>
          <button
            className={styles.approveButton}
            onClick={onAddEvent}
            disabled={
              extractingEvent ||
              !newEvent.title.trim() ||
              (!isSubstackDraft && (!newEvent.date || !newEvent.time))
            }
          >
            Crear evento
          </button>
        </div>
      </section>
    </div>
  );
}
