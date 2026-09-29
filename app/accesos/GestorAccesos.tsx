"use client";

import { useMemo, useState } from "react";
import { INFORMES, INFORME_IDS, type InformeId } from "@/lib/informes";
import type { Accesos, Evento, Origen, Rol, Usuario } from "@/lib/accesos";

type Filtro = "todos" | "activos" | "suspendidos" | "admins";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

export default function GestorAccesos({
  inicial,
  origen: origenInicial,
  escribible,
  superAdmins,
  yo,
  panelSaludUrl,
}: {
  inicial: Accesos;
  origen: Origen;
  escribible: boolean;
  superAdmins: string[];
  yo: string;
  panelSaludUrl: string;
}) {
  const [guardado, setGuardado] = useState<Accesos>(inicial);
  const [origen, setOrigen] = useState<Origen>(origenInicial);
  const [usuarios, setUsuarios] = useState<Usuario[]>(inicial.usuarios);
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

  // ─── KPIs ─────────────────────────────────────────────────────────────────
  const activos = usuarios.filter((u) => u.activo);
  const kpis = [
    { k: "Con acceso", v: activos.length, s: `de ${usuarios.length} registrados` },
    { k: "Administradores", v: activos.filter((u) => u.rol === "admin").length, s: "gestionan esta vista" },
    { k: "Suspendidos", v: usuarios.length - activos.length, s: "sin acceso temporal" },
    {
      k: "Dominios",
      v: new Set(activos.map((u) => u.email.split("@")[1])).size,
      s: Array.from(new Set(activos.map((u) => u.email.split("@")[1]))).join(" · "),
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
      informes: x.informes.includes(id) ? x.informes.filter((i) => i !== id) : [...x.informes, id],
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
              informes: todos
                ? u.informes.filter((i) => i !== id)
                : Array.from(new Set([...u.informes, id])),
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
        body: JSON.stringify({ base: guardado.actualizado, usuarios }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || `Error ${r.status}`);
      setGuardado(data.accesos);
      setUsuarios(data.accesos.usuarios);
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
          <b>Modo solo lectura.</b> Edge Config no está conectado a este proyecto
          (faltan <code>EDGE_CONFIG</code> y/o <code>VERCEL_API_TOKEN</code>). Se
          muestra la lista semilla que hoy controla el login.
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
      <section className="matriz" role="table" aria-label="Permisos por persona e informe">
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
      {pendientes.size > 0 || msg ? (
        <div className={`savebar ${msg?.tipo === "error" ? "err" : ""}`}>
          <span>
            {msg && pendientes.size === 0
              ? msg.texto
              : msg?.tipo === "error"
                ? msg.texto
                : `${pendientes.size} persona${pendientes.size === 1 ? "" : "s"} con cambios sin guardar`}
          </span>
          {pendientes.size > 0 ? (
            <>
              <button
                className="salir"
                onClick={() => {
                  setUsuarios(guardado.usuarios);
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
          onCrear({ email: e, nombre: nombre.trim() || undefined, rol, activo: true, informes });
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
