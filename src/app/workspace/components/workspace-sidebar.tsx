import styles from "../../page.module.css";
import { BrandIcon } from "../../brand-icon";
import { Button } from "@/components/ui/button";
import type { UserProfile } from "../../workspace-actions";
import {
  CalendarDays,
  FileCheck2,
  CalendarCheck,
  Users,
  BarChart3,
  Settings,
  Sparkles,
  ChevronDown,
  ArrowRight,
  MoreHorizontal,
} from "lucide-react";

interface WorkspaceSidebarProps {
  tab: string;
  setTab: (tab: string) => void;
  eventsCount: number;
  reviewCount: number;
  profile: UserProfile;
}

const SIDEBAR_ITEMS = [
  { name: "Calendario", icon: CalendarDays },
  { name: "Revisiones", icon: FileCheck2 },
  { name: "Eventos", icon: CalendarCheck },
  { name: "Cuentas", icon: Users },
  { name: "Estadísticas", icon: BarChart3 },
  { name: "Ajustes", icon: Settings },
] as const;

export function WorkspaceSidebar({
  tab,
  setTab,
  eventsCount,
  reviewCount,
  profile,
}: WorkspaceSidebarProps) {
  return (
    <aside className={styles.sidebar}>
      <div className={styles.brand}>
        <BrandIcon size={28} />
        <span>
          findly<span className={styles.brandDot}>.</span>
        </span>
      </div>
      <div className={styles.workspace}>
        <div className={styles.workspaceIcon}>
          <Sparkles size={16} aria-hidden="true" />
        </div>
        <div>
          <b>Mi espacio</b>
          <small>3 cuentas conectadas</small>
        </div>
        <ChevronDown size={14} className={styles.chevron} aria-hidden="true" />
      </div>
      <p className={styles.navLabel}>ESPACIO DE TRABAJO</p>
      <nav>
        {SIDEBAR_ITEMS.map(({ name: item, icon: Icon }) => (
          <Button
            key={item}
            variant="ghost"
            onClick={() => setTab(item)}
            className={tab === item ? styles.navActive : styles.navItem}
          >
            <span className={styles.navIcon}>
              <Icon size={16} aria-hidden="true" />
            </span>
            {item}
            {item === "Eventos" && <span className={styles.navCount}>{eventsCount}</span>}
            {item === "Revisiones" && reviewCount > 0 && (
              <span className={styles.navCount}>{reviewCount}</span>
            )}
          </Button>
        ))}
      </nav>
      <div className={styles.sidebarBottom}>
        <div className={styles.planCard}>
          <div className={styles.planIcon}>
            <Sparkles size={18} aria-hidden="true" />
          </div>
          <b>Tu contenido, en orden</b>
          <p>Todo lo que necesitas para que cada evento llegue a más gente.</p>
          <Button variant="link" onClick={() => setTab("Ajustes")}>
            Configurar espacio <ArrowRight size={14} style={{ marginLeft: 4 }} aria-hidden="true" />
          </Button>
        </div>
        <div className={styles.profile}>
          <div className={styles.avatar}>
            {profile.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={profile.avatarUrl}
                alt={profile.name}
                className={styles.avatarImg}
                referrerPolicy="no-referrer"
              />
            ) : (
              profile.initials
            )}
          </div>
          <div>
            <b>{profile.name}</b>
            <small>Administrador</small>
          </div>
          <MoreHorizontal size={16} className={styles.chevron} aria-hidden="true" />
        </div>
      </div>
    </aside>
  );
}
