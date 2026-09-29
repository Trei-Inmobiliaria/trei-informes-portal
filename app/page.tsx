import { auth } from "@/auth";
import { permisoActual } from "@/lib/accesos";
import { INFORMES } from "@/lib/informes";
import Topbar from "@/app/components/Topbar";

export const dynamic = "force-dynamic"; // los permisos se leen en vivo

const arrow = (
  <svg viewBox="0 0 24 24">
    <path d="M5 12h14M13 6l6 6-6 6" />
  </svg>
);

export default async function Home({
  searchParams,
}: {
  searchParams?: { error?: string };
}) {
  const session = await auth();
  const name = session?.user?.name || "";
  const email = session?.user?.email || "";
  const permiso = await permisoActual(email);
  const visibles = INFORMES.filter((it) => permiso.informes.includes(it.id));
  const sinPermiso = searchParams?.error === "sin-permiso";

  return (
    <>
      <Topbar name={name} email={email} admin={permiso.admin} activa="informes" />

      <main className="wrap">
        <p className="eyebrow">Portal de Informes</p>
        <h1>Elige un informe</h1>
        <p className="lead">
          Los tableros del área financiera de Trei. Selecciona a cuál entrar.
        </p>

        {sinPermiso ? (
          <div className="aviso">
            No tienes acceso a ese informe. Si lo necesitas, pídelo a Control de
            Gestión.
          </div>
        ) : null}

        <section className="grid">
          {visibles.map((it) => {
            const external = it.href.startsWith("http");
            return (
              <a
                className="card"
                key={it.id}
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

          {permiso.admin ? (
            <a className="card card-admin" href="/accesos">
              <span className="ico" aria-hidden="true">
                <svg viewBox="0 0 24 24">
                  <path d="M12 3 4.5 6v5.5c0 4.6 3.2 8.2 7.5 9.5 4.3-1.3 7.5-4.9 7.5-9.5V6L12 3Z M9 12l2 2 4-4" />
                </svg>
              </span>
              <p className="ctag">Administración</p>
              <h2>Gestor de Accesos</h2>
              <p className="desc">
                Quién entra al portal y a qué informes. Altas, suspensiones y
                permisos por informe, sin redeploy. Junto al Panel de Salud.
              </p>
              <ul className="tags">
                <li>Usuarios</li>
                <li>Permisos por informe</li>
                <li>Bitácora</li>
              </ul>
              <span className="cta">Administrar {arrow}</span>
            </a>
          ) : null}

          {visibles.length === 0 && !permiso.admin ? (
            <div className="vacio">
              Tu cuenta está activa pero aún no tiene informes asignados.
              Escribe a Control de Gestión.
            </div>
          ) : null}
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
