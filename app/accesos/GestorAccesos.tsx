"use client";

import { useMemo, useState } from "react";
import {
  INFORMES,
  INFORME_IDS,
  informesPermitidos,
  recortarInformes,
  type InformeId,
} from "@/lib/informes";
import type { Accesos, Dominio, Evento, Origen, Rol, Usuario } from "@/lib/accesos";

type Filtro = "todos" | "activos" | "suspendidos" | "admins";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DOMINIO_RE = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/;
const limpiarDominio = (d: string) => d.trim().toLowerCase().replace(/^@+/, "");

const ACCION: Record<Evento["accion"], string> = {
  alta: "Alta",
  baja: "Baja",
  suspension: "Suspendido",
  reactivacion: "Reactivado",
  permisos: "Permisos",
  rol: "Rol",
  datos: "Datos",
};

function iniciales(u: Usuario) {
  const base = u.nombre?.trim() || u.email.split("@")[0].replace(/[._-]+/g, " ");
  const p = base.split(/\s+/).filter(Boolean);
  return ((p[0]?.[0] || "") + (p[1]?.[0] || "")).toUpperCase() || "?";
}

function hace(iso?: string) {
  if (!iso) return "";
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return "recién";
  if (s < 3600) return `hace ${Math.round(s / 60)} min`;
  if (s < 86400) return `hace ${Math.round(s / 3600)} h`;
  return new Date(iso).toLocaleDateString("es-CL", { day: "numeric", month: "short" });
}

const firma = (u: Usuario) =>
  JSON.stringify([u.nombre || "", u.rol, u.activo, [...u.informes].sort()]);
const firmaDom = (d: Dominio) => JSON.stringify([d.activo, [...d.informes].sort()]);

export default function GestorAccesos({
  inicial,
  origen: origenInicial,
  escribible,
  faltas,
  superAdmins,
  yo,
  panelSaludUrl,
}: {
  inicial: Accesos;
  origen: Origen;
  escribible: boolean;
  faltas: string[];
  superAdmins: string[];
  yo: string;
  panelSaludUrl: string;
}) {
  const [guardado, setGuardado] = useState<Accesos>(inicial);
  const [origen, setOrigen] = useState<Origen>(origenInicial);
  const [usuarios, setUsuarios] = useState<Usuario[]>(inicial.usuarios);
  const [dominios, setDominios] = useState<Dominio[]>(inicial.dominios || []);
  const [nuevoDomAbierto, setNuevoDomAbierto] = useState(false);
  const [q, setQ] = useState("");
  const [filtro, setFiltro] = useState<Filtro>("todos");
  const [nuevoAbierto, setNuevoAbierto] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [msg, setMsg] = useState<{ tipo: "ok" | "error"; texto: string } | null>(null);

  // ─── Cambios pendientes (comparado con lo guardado) ───────────────────────
  const pendientes = useMemo(() => {
    const antes = new Map(guardado.usuarios.map((u) => [u.email, firma(u)]));
    const ahora = new Set(usuarios.map((u) => u.email));
    const set = new Set<string>();
    for (const u of usuarios) if (antes.get(u.email) !== firma(u)) set.add(u.email);
    for (const e of Array.from(antes.keys())) if (!ahora.has(e)) set.add(e);
    return set;
  }, [usuarios, guardado]);

  const pendientesDom = useMemo(() => {
    const antes = new Map((guardado.dominios || []).map((d) => [d.dominio, firmaDom(d)]));
    const ahora = new Set(dominios.map((d) => d.dominio));
    const set = new Set<string>();
    for (const d of dominios) if (antes.get(d.dominio) !== firmaDom(d)) set.add(d.dominio);
    for (const k of Array.from(antes.keys())) if (!ahora.has(k)) set.add(k);
    return set;
  }, [dominios, guardado]);
  const nPend = pendientes.size + pendientesDom.size;

  // ─── KPIs ─────────────────────────────────────────────────────────────────
  const activos = usuarios.filter((u) => u.activo);
  const kpis = [
    { k: "Con acceso", v: activos.length, s: `de ${usuarios.length} registrados` },
    { k: "Administradores", v: activos.filter((u) => u.rol === "admin").length, s: "gestionan esta vista" },
    { k: "Suspendidos", v: usuarios.length - activos.length, s: "sin acceso temporal" },
    {
      k: "Dominios habilitados",
      v: dominios.filter((d) => d.activo).length,
      s:
        dominios
          .filter((d) => d.activo)
          .map((d) => "@" + d.dominio)
          .join(" · ") || "ninguno: solo personas de la lista",
    },
  ];

  const lista = usuarios
    .filter((u) => {
      if (filtro === "activos" && !u.activo) return false;
      if (filtro === "suspendidos" && u.activo) return false;
      if (filtro === "admins" && u.rol !== "admin") return false;
      const t = q.trim().toLowerCase();
      return !t || u.email.includes(t) || (u.nombre || "").toLowerCase().includes(t);
    })
    .sort((a, b) => Number(b.activo) - Number(a.activo) || a.email.localeCompare(b.email));

  const bloqueado = (u: Usuario) => superAdmins.includes(u.email);
  const editar = (email: string, f: (u: Usuario) => Usuario) =>
    setUsuarios((xs) => xs.map((u) => (u.email === email ? f(u) : u)));
  const toggleInforme = (u: Usuario, id: InformeId) =>
    editar(u.email, (x) => ({
      ...x,
      informes: recortarInformes(
        x.email,
        x.informes.includes(id) ? x.informes.filter((i) => i !== id) : [...x.informes, id]
      ),
    }));
  const toggleColumna = (id: InformeId) => {
    const visibles = new Set(lista.map((u) => u.email));
    const todos = lista.every((u) => u.informes.includes(id));
    setUsuarios((xs) =>
      xs.map((u) =>
        !visibles.has(u.email)
          ? u
          : {
              ...u,
              informes: recortarInformes(
                u.email,
                todos
                  ? u.informes.filter((i) => i !== id)
                  : Array.from(new Set([...u.informes, id]))
              ),
            }
      )
    );
  };

  async function guardar() {
    setGuardando(true);
    setMsg(null);
    try {
      const r = await fetch("/api/accesos", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ base: guardado.actualizado, usuarios, dominios }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || `Error ${r.status}`);
      setGuardado(data.accesos);
      setUsuarios(data.accesos.usuarios);
      setDominios(data.accesos.dominios || []);
      setOrigen("edge-config");
      setMsg({ tipo: "ok", texto: `Guardado · ${data.cambios} cambio(s) registrados en la bitácora.` });
    } catch (e: any) {
      setMsg({ tipo: "error", texto: e.message || "No se pudo guardar." });
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="gestor">
      {/* ── Estado del almacenamiento ── */}
      {!escribible ? (
        <div className="aviso">
          <b>Modo solo lectura.</b> Se muestra la lista semilla que hoy controla el
          login. Para poder guardar falta:
          <ul className="faltas">
            {faltas.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
          Después de agregar o renombrar variables en Vercel hay que hacer Redeploy.
        </div>
      ) : origen === "semilla" ? (
        <div className="aviso aviso-info">
          Edge Config está conectado pero vacío: esta es la lista semilla actual.
          Al guardar por primera vez queda migrada a Edge Config.
        </div>
      ) : null}

      {/* ── KPIs ── */}
      <section className="kpis">
        {kpis.map((k) => (
          <div className="kpi" key={k.k}>
            <span className="kpi-k">{k.k}</span>
            <span className="kpi-v">{k.v}</span>
            <span className="kpi-s">{k.s}</span>
          </div>
        ))}
      </section>

      {/* ── Cobertura por informe ── */}
      <section className="cobertura">
        {INFORMES.map((it) => {
          const n = activos.filter((u) => u.informes.includes(it.id)).length;
          const pct = activos.length ? Math.round((n / activos.length) * 100) : 0;
          return (
            <div className="cob" key={it.id}>
              <span className="cob-ico" aria-hidden="true">
                <svg viewBox="0 0 24 24">{it.icon}</svg>
              </span>
              <div className="cob-txt">
                <b>{it.corto}</b>
                <span>
                  {n} persona{n === 1 ? "" : "s"}
                  {!it.controlado ? " · enlace externo" : ""}
                </span>
                <span className="barra">
                  <span style={{ width: `${pct}%` }} />
                </span>
              </div>
            </div>
          );
        })}
        <a className="cob cob-salud" href={panelSaludUrl} target="_blank" rel="noopener noreferrer">
          <span className="cob-ico" aria-hidden="true">
            <svg viewBox="0 0 24 24">
              <path d="M3 12h4l2-5 4 10 2-5h6" />
            </svg>
          </span>
          <div className="cob-txt">
            <b>Panel de Salud</b>
            <span>Estado y mantención de los servicios ↗</span>
          </div>
        </a>
      </section>

      {/* ── Barra de herramientas ── */}
      <section className="toolbar">
        <div className="buscar">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          <input
            placeholder="Buscar por nombre o correo"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <div className="chips" role="tablist">
          {(
            [
              ["todos", "Todos"],
              ["activos", "Con acceso"],
              ["suspendidos", "Suspendidos"],
              ["admins", "Admins"],
            ] as [Filtro, string][]
          ).map(([f, t]) => (
            <button
              key={f}
              role="tab"
              aria-selected={filtro === f}
              className={filtro === f ? "chip on" : "chip"}
              onClick={() => setFiltro(f)}
            >
              {t}
            </button>
          ))}
        </div>
        <button className="btn-rojo" onClick={() => setNuevoAbierto(true)} disabled={!escribible}>
          + Agregar persona
        </button>
      </section>

      {/* ── Matriz persona × informe ── */}
      <section
        className="matriz"
        role="table"
        aria-label="Permisos por persona e informe"
        style={{ ["--n-inf" as any]: INFORMES.length }}
      >
        <div className="fila cab" role="row">
          <span role="columnheader">Persona</span>
          <span role="columnheader">Rol</span>
          {INFORMES.map((it) => (
            <button
              key={it.id}
              role="columnheader"
              className="col-inf"
              title={`Marcar/desmarcar ${it.corto} para las personas visibles`}
              onClick={() => toggleColumna(it.id)}
              disabled={!escribible}
            >
              {it.corto}
            </button>
          ))}
          <span role="columnheader">Acceso</span>
          <span role="columnheader" aria-label="Acciones" />
        </div>

        {lista.map((u) => {
          const fijo = bloqueado(u);
          const soyYo = u.email === yo;
          return (
            <div
              key={u.email}
              role="row"
              className={[
                "fila",
                u.activo ? "" : "susp",
                pendientes.has(u.email) ? "cambio" : "",
              ].join(" ")}
            >
              <div className="persona" role="cell">
                <span className={u.rol === "admin" ? "avatar admin" : "avatar"}>{iniciales(u)}</span>
                <div className="pers-txt">
                  <input
                    className="nombre"
                    value={u.nombre || ""}
                    placeholder={u.email.split("@")[0]}
                    onChange={(e) => editar(u.email, (x) => ({ ...x, nombre: e.target.value }))}
                    disabled={!escribible}
                    aria-label={`Nombre de ${u.email}`}
                  />
                  <span className="email">
                    {u.email}
                    {soyYo ? <em className="yo">tú</em> : null}
                    {fijo ? <em className="fijo" title="Definido en ADMIN_EMAILS">protegido</em> : null}
                  </span>
                  {u.actualizado ? (
                    <span className="meta">
                      Editado {hace(u.actualizado)}
                      {u.actualizadoPor ? ` por ${u.actualizadoPor.split("@")[0]}` : ""}
                    </span>
                  ) : null}
                </div>
              </div>

              <div role="cell" className="celda-rol">
                <div className="seg">
                  {(["usuario", "admin"] as Rol[]).map((r) => (
                    <button
                      key={r}
                      className={u.rol === r ? "on" : ""}
                      disabled={!escribible || fijo || soyYo}
                      onClick={() => editar(u.email, (x) => ({ ...x, rol: r }))}
                    >
                      {r === "admin" ? "Admin" : "Usuario"}
                    </button>
                  ))}
                </div>
              </div>

              {INFORMES.map((it) => {
                const on = u.informes.includes(it.id);
                return (
                  <div role="cell" className="celda-inf" key={it.id} data-label={it.corto}>
                    <button
                      className={on ? "perm on" : "perm"}
                      aria-pressed={on}
                      aria-label={`${it.corto} para ${u.email}`}
                      disabled={!escribible || fijo}
                      onClick={() => toggleInforme(u, it.id)}
                    >
                      {on ? (
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                          <path d="m5 12 5 5 9-10" />
                        </svg>
                      ) : null}
                    </button>
                  </div>
                );
              })}

              <div role="cell" className="celda-acc" data-label="Acceso">
                <button
                  className={u.activo ? "switch on" : "switch"}
                  role="switch"
                  aria-checked={u.activo}
                  aria-label={`Acceso de ${u.email}`}
                  disabled={!escribible || fijo || soyYo}
                  onClick={() => editar(u.email, (x) => ({ ...x, activo: !x.activo }))}
                >
                  <span />
                </button>
                <span className="estado">{u.activo ? "Activo" : "Suspendido"}</span>
              </div>

              <div role="cell" className="celda-del">
                <button
                  className="borrar"
                  title="Quitar del portal"
                  aria-label={`Quitar a ${u.email}`}
                  disabled={!escribible || fijo || soyYo}
                  onClick={() => {
                    if (confirm(`¿Quitar a ${u.email} del portal?`))
                      setUsuarios((xs) => xs.filter((x) => x.email !== u.email));
                  }}
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" />
                  </svg>
                </button>
              </div>
            </div>
          );
        })}

        {lista.length === 0 ? <div className="vacio">Nadie coincide con el filtro.</div> : null}
      </section>

      {/* ── Acceso por dominio ── */}
      <section className="toolbar">
        <div className="dom-titulo">
          <h3>Acceso por dominio</h3>
          <p>
            Cualquier correo de estos dominios entra con los informes marcados, sin
            agregarlo uno por uno. Nunca da rol de admin. Si la persona también está
            en la lista de arriba, manda su fila (sirve para suspender a alguien puntual).
          </p>
        </div>
        <button className="btn-rojo" onClick={() => setNuevoDomAbierto(true)} disabled={!escribible}>
          + Agregar dominio
        </button>
      </section>

      <section
        className="matriz"
        role="table"
        aria-label="Permisos por dominio e informe"
        style={{ ["--n-inf" as any]: INFORMES.length }}
      >
        <div className="fila cab" role="row">
          <span role="columnheader">Dominio</span>
          <span role="columnheader">Tipo</span>
          {INFORMES.map((it) => (
            <span key={it.id} role="columnheader" className="col-inf">
              {it.corto}
            </span>
          ))}
          <span role="columnheader">Acceso</span>
          <span role="columnheader" aria-label="Acciones" />
        </div>
        {dominios.map((d) => {
          const fijos = informesPermitidos("x@" + d.dominio);
          const editarDom = (f: (x: Dominio) => Dominio) =>
            setDominios((xs) => xs.map((x) => (x.dominio === d.dominio ? f(x) : x)));
          return (
            <div
              key={d.dominio}
              role="row"
              className={["fila", d.activo ? "" : "susp", pendientesDom.has(d.dominio) ? "cambio" : ""].join(" ")}
            >
              <div className="persona" role="cell">
                <span className="avatar">@</span>
                <div className="pers-txt">
                  <b className="dom-nombre">@{d.dominio}</b>
                  <span className="email">
                    {usuarios.filter((u) => u.email.endsWith("@" + d.dominio)).length} con fila propia
                    {fijos ? <em className="fijo" title="Regla fija en lib/informes.tsx">restringido</em> : null}
                  </span>
                  {d.actualizado ? (
                    <span className="meta">
                      Editado {hace(d.actualizado)}
                      {d.actualizadoPor ? ` por ${d.actualizadoPor.split("@")[0]}` : ""}
                    </span>
                  ) : null}
                </div>
              </div>
              <div role="cell" className="celda-rol">
                <span className="estado">Todo el dominio</span>
              </div>
              {INFORMES.map((it) => {
                const on = d.informes.includes(it.id);
                const vetado = !!fijos && !fijos.includes(it.id);
                return (
                  <div role="cell" className="celda-inf" key={it.id} data-label={it.corto}>
                    <button
                      className={on ? "perm on" : "perm"}
                      aria-pressed={on}
                      aria-label={`${it.corto} para @${d.dominio}`}
                      title={vetado ? "Este dominio no puede tener este informe" : undefined}
                      disabled={!escribible || vetado}
                      onClick={() =>
                        editarDom((x) => ({
                          ...x,
                          informes: on ? x.informes.filter((i) => i !== it.id) : [...x.informes, it.id],
                        }))
                      }
                    >
                      {on ? (
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                          <path d="m5 12 5 5 9-10" />
                        </svg>
                      ) : null}
                    </button>
                  </div>
                );
              })}
              <div role="cell" className="celda-acc" data-label="Acceso">
                <button
                  className={d.activo ? "switch on" : "switch"}
                  role="switch"
                  aria-checked={d.activo}
                  aria-label={`Acceso de @${d.dominio}`}
                  disabled={!escribible}
                  onClick={() => editarDom((x) => ({ ...x, activo: !x.activo }))}
                >
                  <span />
                </button>
                <span className="estado">{d.activo ? "Activo" : "Suspendido"}</span>
              </div>
              <div role="cell" className="celda-del">
                <button
                  className="borrar"
                  title="Quitar dominio"
                  aria-label={`Quitar @${d.dominio}`}
                  disabled={!escribible}
                  onClick={() => {
                    if (confirm(`¿Quitar el acceso por dominio de @${d.dominio}? Las personas con fila propia no se ven afectadas.`))
                      setDominios((xs) => xs.filter((x) => x.dominio !== d.dominio));
                  }}
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" />
                  </svg>
                </button>
              </div>
            </div>
          );
        })}
        {dominios.length === 0 ? (
          <div className="vacio">Sin dominios. Hoy solo entran las personas de la lista.</div>
        ) : null}
      </section>

      <p className="nota">
        Las personas externas (por ejemplo @razo.cl) igual deben poder iniciar sesión
        con Microsoft en el tenant de Trei: invitadas en Entra ID como usuarios
        externos (B2B). El dominio evita tener que darlas de alta aquí una por una.
      </p>

      <p className="nota">
        <b>Comercial</b> y <b>Contabilidad</b> se abren en apps externas con su
        propio candado Entra: el portal oculta la tarjeta, pero el control
        definitivo vive en esas apps. <b>Cobranza</b> y <b>Tesorería</b> pasan por
        el puente SSO del portal, que bloquea el acceso si el permiso no está.
      </p>

      {/* ── Bitácora ── */}
      <section className="bitacora">
        <h3>Actividad reciente</h3>
        {guardado.log.length === 0 ? (
          <p className="vacio">Sin cambios registrados todavía.</p>
        ) : (
          <ol>
            {guardado.log.slice(0, 25).map((e, i) => (
              <li key={i}>
                <span className={`tag-acc acc-${e.accion}`}>{ACCION[e.accion]}</span>
                <span className="log-txt">
                  <b>{e.email}</b>
                  {e.detalle ? <span> · {e.detalle}</span> : null}
                </span>
                <span className="log-meta">
                  {e.por.split("@")[0]} · {hace(e.ts)}
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>

      {/* ── Barra de guardado ── */}
      {nPend > 0 || msg ? (
        <div className={`savebar ${msg?.tipo === "error" ? "err" : ""}`}>
          <span>
            {msg && nPend === 0
              ? msg.texto
              : msg?.tipo === "error"
                ? msg.texto
                : [
                    pendientes.size ? `${pendientes.size} persona${pendientes.size === 1 ? "" : "s"}` : "",
                    pendientesDom.size ? `${pendientesDom.size} dominio${pendientesDom.size === 1 ? "" : "s"}` : "",
                  ]
                    .filter(Boolean)
                    .join(" y ") + " con cambios sin guardar"}
          </span>
          {nPend > 0 ? (
            <>
              <button
                className="salir"
                onClick={() => {
                  setUsuarios(guardado.usuarios);
                  setDominios(guardado.dominios || []);
                  setMsg(null);
                }}
                disabled={guardando}
              >
                Descartar
              </button>
              <button className="btn-rojo" onClick={guardar} disabled={guardando || !escribible}>
                {guardando ? "Guardando…" : "Guardar cambios"}
              </button>
            </>
          ) : (
            <button className="salir" onClick={() => setMsg(null)}>
              Cerrar
            </button>
          )}
        </div>
      ) : null}

      {nuevoDomAbierto ? (
        <NuevoDominio
          existentes={dominios.map((d) => d.dominio)}
          onCerrar={() => setNuevoDomAbierto(false)}
          onCrear={(d) => {
            setDominios((xs) => [...xs, d]);
            setNuevoDomAbierto(false);
          }}
        />
      ) : null}

      {nuevoAbierto ? (
        <NuevoUsuario
          existentes={usuarios.map((u) => u.email)}
          onCerrar={() => setNuevoAbierto(false)}
          onCrear={(u) => {
            setUsuarios((xs) => [...xs, u]);
            setNuevoAbierto(false);
            setFiltro("todos");
            setQ("");
          }}
        />
      ) : null}
    </div>
  );
}

function NuevoUsuario({
  existentes,
  onCerrar,
  onCrear,
}: {
  existentes: string[];
  onCerrar: () => void;
  onCrear: (u: Usuario) => void;
}) {
  const [email, setEmail] = useState("");
  const [nombre, setNombre] = useState("");
  const [rol, setRol] = useState<Rol>("usuario");
  const [informes, setInformes] = useState<InformeId[]>([...INFORME_IDS]);
  const e = email.trim().toLowerCase();
  const error = !e
    ? ""
    : !EMAIL_RE.test(e)
      ? "Correo inválido"
      : existentes.includes(e)
        ? "Ya está en la lista"
        : "";

  return (
    <div className="modal-fondo" onClick={onCerrar}>
      <form
        className="modal"
        onClick={(ev) => ev.stopPropagation()}
        onSubmit={(ev) => {
          ev.preventDefault();
          if (!e || error) return;
          // Correos de dominios restringidos (razo.cl): solo sus informes fijos, rol usuario.
          const fijos = informesPermitidos(e);
          onCrear({
            email: e,
            nombre: nombre.trim() || undefined,
            rol: fijos ? "usuario" : rol,
            activo: true,
            informes: fijos ? [...fijos] : informes,
          });
        }}
      >
        <h3>Agregar persona</h3>
        <p className="sub">
          Debe entrar con su cuenta Microsoft de ese correo (invitados B2B incluidos).
        </p>
        <label>
          Correo
          <input autoFocus type="email" value={email} onChange={(x) => setEmail(x.target.value)} placeholder="nombre@trei.cl" />
          {error ? <span className="err">{error}</span> : null}
          {!error && e && informesPermitidos(e) ? (
            <span className="sub">
              Correo externo: solo podrá ver{" "}
              {informesPermitidos(e)!
                .map((id) => INFORMES.find((it) => it.id === id)?.corto || id)
                .join(", ")}
              , sin rol de admin.
            </span>
          ) : null}
        </label>
        <label>
          Nombre <span className="opc">(opcional)</span>
          <input value={nombre} onChange={(x) => setNombre(x.target.value)} placeholder="Nombre Apellido" />
        </label>
        <span className="lbl">Informes</span>
        <div className="checks">
          {INFORMES.map((it) => {
            const on = informes.includes(it.id);
            return (
              <button
                type="button"
                key={it.id}
                className={on ? "chk on" : "chk"}
                aria-pressed={on}
                onClick={() =>
                  setInformes((xs) => (on ? xs.filter((i) => i !== it.id) : [...xs, it.id]))
                }
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">{it.icon}</svg>
                {it.corto}
              </button>
            );
          })}
        </div>
        <span className="lbl">Rol</span>
        <div className="seg">
          {(["usuario", "admin"] as Rol[]).map((r) => (
            <button type="button" key={r} className={rol === r ? "on" : ""} onClick={() => setRol(r)}>
              {r === "admin" ? "Admin" : "Usuario"}
            </button>
          ))}
        </div>
        <div className="modal-acc">
          <button type="button" className="salir" onClick={onCerrar}>
            Cancelar
          </button>
          <button type="submit" className="btn-rojo" disabled={!e || !!error}>
            Agregar
          </button>
        </div>
      </form>
    </div>
  );
}

function NuevoDominio({
  existentes,
  onCerrar,
  onCrear,
}: {
  existentes: string[];
  onCerrar: () => void;
  onCrear: (d: Dominio) => void;
}) {
  const [texto, setTexto] = useState("");
  const d = limpiarDominio(texto);
  const fijos = d ? informesPermitidos("x@" + d) : null;
  // Por defecto ningún informe marcado: dar acceso a un dominio entero es una
  // decisión que conviene tomar informe por informe. Los restringidos vienen fijos.
  const [informes, setInformes] = useState<InformeId[]>([]);
  const elegidos = fijos ? [...fijos] : informes;
  const error = !d
    ? ""
    : d.includes("@")
      ? "Escribe solo el dominio, sin la parte antes de @"
      : !DOMINIO_RE.test(d)
        ? "Dominio inválido (ej. razo.cl)"
        : existentes.includes(d)
          ? "Ese dominio ya está en la lista"
          : "";

  return (
    <div className="modal-fondo" onClick={onCerrar}>
      <form
        className="modal"
        onClick={(ev) => ev.stopPropagation()}
        onSubmit={(ev) => {
          ev.preventDefault();
          if (!d || error || !elegidos.length) return;
          onCrear({ dominio: d, informes: elegidos, activo: true });
        }}
      >
        <h3>Agregar dominio</h3>
        <p className="sub">
          Todos los correos de este dominio podrán entrar con los informes que marques,
          sin rol de admin.
        </p>
        <label>
          Dominio
          <input autoFocus value={texto} onChange={(x) => setTexto(x.target.value)} placeholder="razo.cl" />
          {error ? <span className="err">{error}</span> : null}
          {!error && fijos ? (
            <span className="sub">
              Dominio restringido: solo puede ver{" "}
              {fijos.map((id) => INFORMES.find((it) => it.id === id)?.corto || id).join(", ")}.
            </span>
          ) : null}
        </label>
        <span className="lbl">Informes</span>
        <div className="checks">
          {INFORMES.map((it) => {
            const on = elegidos.includes(it.id);
            const vetado = !!fijos && !fijos.includes(it.id);
            return (
              <button
                type="button"
                key={it.id}
                className={on ? "chk on" : "chk"}
                aria-pressed={on}
                disabled={!!fijos || vetado}
                onClick={() =>
                  setInformes((xs) => (on ? xs.filter((i) => i !== it.id) : [...xs, it.id]))
                }
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">{it.icon}</svg>
                {it.corto}
              </button>
            );
          })}
        </div>
        <div className="modal-acc">
          <button type="button" className="salir" onClick={onCerrar}>
            Cancelar
          </button>
          <button type="submit" className="btn-rojo" disabled={!d || !!error || !elegidos.length}>
            Agregar
          </button>
        </div>
      </form>
    </div>
  );
}
