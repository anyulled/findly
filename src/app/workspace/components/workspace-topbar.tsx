import styles from "../../page.module.css";

interface WorkspaceTopbarProps {
  tab: string;
  syncingWorkspace: boolean;
  openAddForm: () => void;
}

export function WorkspaceTopbar({ tab, syncingWorkspace, openAddForm }: WorkspaceTopbarProps) {
  return (
    <header className={styles.topbar}>
      <div className={styles.breadcrumb}>
        Workspace <span>/</span> <b>{tab}</b>
      </div>
      <div className={styles.topActions}>
        {syncingWorkspace && (
          <span className={styles.tz} role="status">
            Actualizando…
          </span>
        )}
        <span className={styles.tz}>◷ &nbsp;Europe/Madrid</span>
        <button className={styles.helpBtn}>
          ? <span>Ayuda</span>
        </button>
        <button className={styles.addButton} onClick={openAddForm}>
          <span>＋</span> Añadir evento
        </button>
      </div>
    </header>
  );
}
