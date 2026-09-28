import { auth, signOut } from "@/auth";

const INFORMES = [
  {
    ctag: "Ventas & Leads",
    title: "Informe Comercial",
    desc: "Ventas, leads y estado comercial en tiempo real por proyecto.",
    tags: ["Por proyecto", "Leads", "Reservas", "Se abre en trei.cl"],
    // Vive en trei.cl con su propio Entra (mismo tenant → SSO, sin segunda clave).
    href: "https://trei.cl/informe_ventas/",
    icon: <path d="M4 20V10M10 20V4M16 20V13M3 20h18" />,
  },
  {
    ctag: "Cartera de Clientes",
    title: "Cobranza",
    desc: "Cartera por proyecto y conciliación de ingresos en vivo: recaudación del mes, bandejas por conciliar y Transbank/TOKU.",
    tags: ["Por proyecto", "Conciliación", "Recaudación"],
    // Pasa por el puente SSO firmado; `next` aterriza en la sección de cobranza.
    href: "/ir/reportes?next=%2Fcobranza",
    icon: <path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3Z M9 8h6 M9 12h6" />,
  },
  {
    ctag: "Caja, Bancos & Deuda",
    title: "Tesorería y Control de Deuda",
    desc: "Posición de caja por sociedad y conciliación bancaria, junto con la deuda financiera del grupo: créditos, acreedores, perfil de vencimientos y costo promedio ponderado (WACD).",
    tags: ["Posición de caja", "Movimientos", "Créditos", "Acreedores", "Vencimientos"],
    // Pasa por el puente SSO firmado; `next=/` aterriza en el tablero de tesorería/deuda.
    href: "/ir/reportes?next=%2F",
    icon: (
      <path d="M3 21h18M4 21V10m4 11V10m4 11V10m4 11V10m4 11V10M12 3 3.5 8h17L12 3Z" />
    ),
  },
  {
    ctag: "Finanzas",
    title: "Reportería de Contabilidad",
    desc: "Balance, estado de resultados y cuentas por pagar del grupo. Acceso por correo, validado con Microsoft Entra.",
    tags: ["Balance", "EERR", "Cuentas por pagar"],
    // App propia con su candado Entra (mismo tenant → SSO). Enlace directo.
    href: "https://reporteria-contabilidad.vercel.app/",
    icon: <path d="M6 3h12v18H6zM9 7h6M9 11h6M9 15h4" />,
  },
];

const arrow = (
  <svg viewBox="0 0 24 24">
    <path d="M5 12h14M13 6l6 6-6 6" />
  </svg>
);

export default async function Home() {
  const session = await auth();
  const name = session?.user?.name || "";
  const email = session?.user?.email || "";

  return (
    <>
      <header className="topbar">
        <div className="brand">
          <span className="logo-tile">
            <img src="/trei-logo.png" alt="Trei Inmobiliaria" />
          </span>
          <span className="div" />
          <span className="sub">Control de Gestión</span>
        </div>
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

      <main className="wrap">
        <p className="eyebrow">Portal de Informes</p>
        <h1>Elige un informe</h1>
        <p className="lead">
          Los tableros del área financiera de Trei. Selecciona a cuál entrar.
        </p>

        <section className="grid">
          {INFORMES.map((it) => {
            const external = it.href.startsWith("http");
            return (
              <a
                className="card"
                key={it.title}
                href={it.href}
                {...(external
                  ? { target: "_blank", rel: "noopener noreferrer" }
                  : {})}
              >
                <span className="ico" aria-hidden="true">
                  <svg viewBox="0 0 24 24">{it.icon}</svg>
                </span>
                <p className="ctag">{it.ctag}</p>
                <h2>{it.title}</h2>
                <p className="desc">{it.desc}</p>
                <ul className="tags">
                  {it.tags.map((t) => (
                    <li key={t}>{t}</li>
                  ))}
                </ul>
                <span className="cta">Entrar {arrow}</span>
              </a>
            );
          })}
        </section>

        <footer>
          <span className="lock" aria-hidden="true">
            <svg viewBox="0 0 24 24">
              <rect x="4.5" y="10.5" width="15" height="10" rx="2" />
              <path d="M8 10.5V7a4 4 0 0 1 8 0v3.5" />
            </svg>
            Sesión validada con Microsoft Entra ID
          </span>
          <span className="sep">·</span>
          <span>Grupo VCB · Trei Inmobiliaria</span>
          <span className="sep">·</span>
          <span>Control de Gestión</span>
        </footer>
      </main>
    </>
  );
}
