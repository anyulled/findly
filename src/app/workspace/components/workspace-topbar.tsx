import styles from "../../page.module.css";
import { Button } from "@/components/ui/button";
import { Clock, CircleHelp, Plus } from "lucide-react";

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
        <span className={styles.tz} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <Clock size={14} aria-hidden="true" /> Europe/Madrid
        </span>
        <Button variant="ghost" size="sm" className={styles.helpBtn}>
          <CircleHelp size={15} aria-hidden="true" /> <span>Ayuda</span>
        </Button>
        <Button variant="default" onClick={openAddForm}>
          <Plus size={16} aria-hidden="true" /> Añadir evento
        </Button>
      </div>
    </header>
  );
}
