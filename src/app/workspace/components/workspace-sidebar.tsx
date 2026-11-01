import styles from "../../page.module.css";
import { BrandIcon } from "../../brand-icon";
import type { UserProfile } from "../../workspace-actions";

interface WorkspaceSidebarProps {
  tab: string;
  setTab: (tab: string) => void;
  eventsCount: number;
  reviewCount: number;
  profile: UserProfile;
}

const SIDEBAR_ITEMS = ["Calendario", "Eventos", "Cuentas", "Ajustes"] as const;
const SIDEBAR_ICONS = ["▦", "◷", "♙", "⚙"] as const;

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
        <div className={styles.workspaceIcon}>✳</div>
        <div>
          <b>Mi espacio</b>
          <small>3 cuentas conectadas</small>
        </div>
        <span className={styles.chevron}>⌄</span>
      </div>
      <p className={styles.navLabel}>ESPACIO DE TRABAJO</p>
      <nav>
        {SIDEBAR_ITEMS.map((item, i) => (
          <button
            key={item}
            onClick={() => setTab(item)}
            className={tab === item ? styles.navActive : styles.navItem}
          >
            <span className={styles.navIcon}>{SIDEBAR_ICONS[i]}</span>
            {item}
            {item === "Eventos" && <span className={styles.navCount}>{eventsCount}</span>}
            {item === "Calendario" && reviewCount > 0 && (
              <span className={styles.navCount}>{reviewCount}</span>
            )}
          </button>
        ))}
      </nav>
      <div className={styles.sidebarBottom}>
        <div className={styles.planCard}>
          <div className={styles.planIcon}>✦</div>
          <b>Tu contenido, en orden</b>
          <p>Todo lo que necesitas para que cada evento llegue a más gente.</p>
          <button onClick={() => setTab("Ajustes")}>
            Configurar espacio <span>→</span>
          </button>
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
          <span className={styles.chevron}>···</span>
        </div>
      </div>
    </aside>
  );
}
