import styles from "../../page.module.css";
import { Button } from "@/components/ui/button";

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
        <Button variant="ghost" size="sm" className={styles.helpBtn}>
          ? <span>Ayuda</span>
        </Button>
        <Button variant="default" onClick={openAddForm}>
          <span>＋</span> Añadir evento
        </Button>
      </div>
    </header>
  );
}
