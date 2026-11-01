import styles from "../../page.module.css";
import { SourceSettings } from "../../source-settings";
import type { SourceView } from "../../workspace-actions";
import type { Account } from "../workspace-types";

interface SettingsViewProps {
  mode: "review" | "automatic";
  persistent: boolean;
  bufferApiKeyConfigured: boolean;
  sources: SourceView[];
  accountList: Account[];
  onChangeMode: (mode: "review" | "automatic") => void;
  onSourcesChange: (sources: SourceView[]) => void;
  onSyncComplete: () => Promise<void>;
}

export function SettingsView({
  mode,
  persistent,
  bufferApiKeyConfigured,
  sources,
  accountList,
  onChangeMode,
  onSourcesChange,
  onSyncComplete,
}: SettingsViewProps) {
  const services = [
    [
      "Supabase",
      "Autenticación y base de datos",
      persistent ? "Configurado" : "Pendiente de configurar",
    ],
    [
      "Buffer",
      "Publicación en redes",
      bufferApiKeyConfigured
        ? "Claves configuradas"
        : "Configura las tres API keys de Buffer",
    ],
    [
      "Groq & OpenAI",
      "Redacción de borradores (con fallback)",
      "Usa GROQ_API_KEY (primario) y OPENAI_API_KEY (fallback)",
    ],
    [
      "Fuentes (Luma / Meetup / Substack)",
      "Detección de eventos y artículos",
      persistent
        ? `${sources.filter((source) => source.enabled).length} fuentes activas`
        : "Configura Supabase para importar",
    ],
  ] as const;

  return (
    <>
      <div className={styles.pageHeading}>
        <div>
          <div className={styles.eyebrow}>PREFERENCIAS DEL ESPACIO</div>
          <h1>Ajustes</h1>
          <p>Controla cómo se preparan y programan tus publicaciones.</p>
        </div>
      </div>
      <div className={styles.settingsLayout}>
        <section className={styles.settingsCard}>
          <div className={styles.settingsTitle}>
            <span className={styles.settingsIcon}>◷</span>
            <div>
              <h3>Modo de publicación</h3>
              <p>Elige si revisas los textos antes de que se programen.</p>
            </div>
          </div>
          <div className={styles.modeChoices}>
            <button
              className={mode === "review" ? styles.modeChosen : ""}
              onClick={() => {
                onChangeMode("review");
              }}
            >
              <span>◉</span>
              <b>Revisión</b>
              <small>
                Al aprobar, se programa el texto y se guarda como ejemplo de estilo.
              </small>
            </button>
            <button
              className={mode === "automatic" ? styles.modeChosen : ""}
              onClick={() => {
                onChangeMode("automatic");
              }}
            >
              <span>⚡</span>
              <b>Automático</b>
              <small>
                {persistent
                  ? "Buffer programa los borradores nuevos en cuanto se generan, sin aprobación de estilo."
                  : "En la demo, los textos y cambios se quedan en este navegador y no se envían a Buffer."}
              </small>
            </button>
          </div>
          {mode === "automatic" && (
            <div className={styles.warning}>
              {persistent
                ? "Los borradores nuevos se envían a Buffer al generarse. Si falta la clave o el ID del canal, quedarán marcados como fallidos; los resultados inciertos no se reintentan automáticamente."
                : "La demo no publica en redes; la opción automática solo se guarda en este navegador."}
            </div>
          )}
        </section>
        <section className={styles.settingsCard}>
          <div className={styles.settingsTitle}>
            <span className={styles.settingsIcon}>✦</span>
            <div>
              <h3>Servicios conectados</h3>
              <p>Las credenciales se guardan en el entorno del servidor.</p>
            </div>
          </div>
          {services.map(([name, desc, status]) => (
            <div className={styles.serviceRow} key={name}>
              <div>
                <b>{name}</b>
                <small>{desc}</small>
              </div>
              <span className={styles.servicePending}>
                <i /> {status}
              </span>
            </div>
          ))}
          <div className={styles.cronHint}>
            {persistent
              ? "El endpoint admite sincronización manual desde Fuentes y llamadas externas autenticadas con CRON_SECRET. Configura cron-job.org para ejecutarlo cada 6 horas."
              : "La sincronización manual y programada necesita Supabase configurado."}
          </div>
        </section>
      </div>
      <SourceSettings
        accounts={accountList}
        sources={sources}
        persistent={persistent}
        onSourcesChange={onSourcesChange}
        onSyncComplete={onSyncComplete}
      />
    </>
  );
}
