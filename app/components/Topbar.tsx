import { signOut } from "@/auth";

export const PANEL_SALUD_URL =
  process.env.PANEL_SALUD_URL || "https://trei-panel-salud.smendez.workers.dev/salud/";

type Tab = "informes" | "accesos";

// Barra superior compartida. Las pestañas son el selector entre vistas del
// portal: Informes (todos) y, para administradores, Accesos + Panel de Salud.
export default function Topbar({
  name,
  email,
  admin,
  activa,
}: {
  name: string;
  email: string;
  admin: boolean;
  activa: Tab;
}) {
  return (
    <header className="topbar">
      <div className="brand">
        <span className="logo-tile">
          <img src="/trei-logo.png" alt="Trei Inmobiliaria" />
        </span>
        <span className="div" />
        <span className="sub">Control de Gestión</span>
      </div>

      {admin ? (
        <nav className="tabs" aria-label="Vistas del portal">
          <a href="/" className={activa === "informes" ? "on" : ""}>
            Informes
          </a>
          <a href="/accesos" className={activa === "accesos" ? "on" : ""}>
            Accesos
          </a>
          <a href={PANEL_SALUD_URL} target="_blank" rel="noopener noreferrer">
            Panel de Salud
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M14 4h6v6M20 4l-9 9M18 14v6H4V6h6" />
            </svg>
          </a>
        </nav>
      ) : null}

      <div className="userbox">
        <svg className="msft" viewBox="0 0 21 21" aria-hidden="true">
          <rect x="1" y="1" width="9" height="9" fill="#f25022" />
          <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
          <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
          <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
        </svg>
        <span className="who">
          {name ? <b>{name}</b> : null}
          {email}
        </span>
        <form
          action={async () => {
            "use server";
            await signOut({ redirectTo: "/login" });
          }}
        >
          <button className="salir" type="submit">
            Salir
          </button>
        </form>
      </div>
    </header>
  );
}
