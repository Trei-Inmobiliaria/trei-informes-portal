"use client";

import { useEffect, useMemo, useState } from "react";
import "./inversores.css";

type Proyecto = { proyecto: string; nombre: string };
type Inversor = {
  email: string;
  nombre: string | null;
  empresa: string | null;
  activo: boolean;
  vence_at: string | null;
  proyectos: string[];
  enPortal?: boolean;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const dia = (iso: string | null) => (iso ? iso.slice(0, 10) : "");
const firma = (i: Inversor) =>
  JSON.stringify([i.nombre || "", i.empresa || "", i.activo, dia(i.vence_at), [...i.proyectos].sort()]);

export default function InversoresAccesos() {
  const [proyectos, setProyectos] = useState<Proyecto[]>([]);
  const [guardados, setGuardados] = useState<Inversor[]>([]);
  const [filas, setFilas] = useState<Inversor[]>([]);
  const [cargando, setCargando] = useState(true);
  const [escribible, setEscribible] = useState(true);
  const [msg, setMsg] = useState<{ tipo: "ok" | "error"; texto: string } | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);

  // formulario de alta
  const [email, setEmail] = useState("");
  const [nombre, setNombre] = useState("");
  const [empresa, setEmpresa] = useState("");
  const [vence, setVence] = useState("");
  const [sel, setSel] = useState<string[]>([]);

  async function cargar() {
    setCargando(true);
    try {
      const r = await fetch("/api/inversores", { cache: "no-store" });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || `Error ${r.status}`);
      setProyectos(d.proyectos);
      setGuardados(d.inversores);
      setFilas(d.inversores);
      setEscribible(d.escribible !== false);
      setMsg(null);
    } catch (e: any) {
      setMsg({ tipo: "error", texto: e.message || "No se pudo cargar la lista de inversores." });
    } finally {
      setCargando(false);
    }
  }
  useEffect(() => {
    cargar();
  }, []);

  const sucio = useMemo(() => {
    const base = new Map(guardados.map((g) => [g.email, firma(g)]));
    return new Set(filas.filter((f) => base.get(f.email) !== firma(f)).map((f) => f.email));
  }, [filas, guardados]);

  const activos = filas.filter((f) => f.activo);
  const por30 = Date.now() + 30 * 86400000;
  const vencen = activos.filter((f) => f.vence_at && new Date(f.vence_at).getTime() < por30).length;
  const nombreProy = (k: string) => proyectos.find((p) => p.proyecto === k)?.nombre || k;

  const editar = (e: string, f: (i: Inversor) => Inversor) =>
    setFilas((xs) => xs.map((x) => (x.email === e ? f(x) : x)));
  const alternar = (i: Inversor, k: string) =>
    editar(i.email, (x) => ({
      ...x,
      proyectos: x.proyectos.includes(k) ? x.proyectos.filter((p) => p !== k) : [...x.proyectos, k],
    }));

  async function enviar(payload: {
    email: string;
    nombre: string;
    empresa: string;
    proyectos: string[];
    vence: string;
    activo: boolean;
  }) {
    setOcupado(payload.email);
    setMsg(null);
    try {
      const r = await fetch("/api/inversores", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || `Error ${r.status}`);
      setMsg({ tipo: "ok", texto: `Guardado: ${payload.email}` });
      await cargar();
      return true;
    } catch (e: any) {
      setMsg({ tipo: "error", texto: e.message || "No se pudo guardar." });
      return false;
    } finally {
      setOcupado(null);
    }
  }

  const guardarFila = (i: Inversor) =>
    enviar({
      email: i.email,
      nombre: i.nombre || "",
      empresa: i.empresa || "",
      proyectos: i.proyectos,
      vence: dia(i.vence_at),
      activo: i.activo,
    });

  async function alta() {
    const ok = await enviar({
      email: email.trim().toLowerCase(),
      nombre,
      empresa,
      proyectos: sel,
      vence,
      activo: true,
    });
    if (ok) {
      setEmail("");
      setNombre("");
      setEmpresa("");
      setVence("");
      setSel([]);
    }
  }

  const altaLista = EMAIL_RE.test(email.trim()) && sel.length > 0 && escribible;

  return (
    <section className="inv-sec" aria-labelledby="inv-h">
      <p className="eyebrow">Informe Comercial</p>
      <h2 id="inv-h" className="inv-h">Inversores</h2>
      <p className="lead">
        Da acceso a un inversor solo a los proyectos que le correspondan. Ve una vista
        simplificada con cifras agregadas: no incluye nombres, RUT, correos ni teléfonos
        de clientes, y no puede abrir el informe completo.
      </p>

      <div className="inv-kpis">
        <div className="inv-kpi"><span className="kpi-k">Inversores con acceso</span><b>{activos.length}</b></div>
        <div className="inv-kpi"><span className="kpi-k">Proyectos del grupo</span><b>{proyectos.length}</b></div>
        <div className="inv-kpi"><span className="kpi-k">Vencen en 30 días</span><b className={vencen ? "alerta" : ""}>{vencen}</b></div>
      </div>

      {msg ? (
        <div className={msg.tipo === "ok" ? "inv-msg ok" : "inv-msg error"} role="status">{msg.texto}</div>
      ) : null}

      <div className="inv-alta">
        <h3>Dar acceso a un inversor</h3>
        <div className="inv-form">
          <label>Correo
            <input id="inv-email" type="email" value={email} placeholder="nombre@empresa.cl"
              onChange={(e) => setEmail(e.target.value)} />
          </label>
          <label>Nombre
            <input id="inv-nombre" value={nombre} placeholder="Opcional" onChange={(e) => setNombre(e.target.value)} />
          </label>
          <label>Empresa
            <input id="inv-empresa" value={empresa} placeholder="Opcional" onChange={(e) => setEmpresa(e.target.value)} />
          </label>
          <label>Acceso hasta
            <input id="inv-vence" type="date" value={vence} onChange={(e) => setVence(e.target.value)} />
          </label>
        </div>
        <div className="inv-proys" role="group" aria-label="Proyectos del nuevo inversor">
          {proyectos.map((p) => (
            <button key={p.proyecto} type="button"
              className={sel.includes(p.proyecto) ? "chip on" : "chip"}
              aria-pressed={sel.includes(p.proyecto)}
              onClick={() => setSel((s) => (s.includes(p.proyecto) ? s.filter((x) => x !== p.proyecto) : [...s, p.proyecto]))}>
              {p.nombre}
            </button>
          ))}
          <button type="button" className="chip" onClick={() => setSel(sel.length === proyectos.length ? [] : proyectos.map((p) => p.proyecto))}>
            {sel.length === proyectos.length ? "Ninguno" : "Todos"}
          </button>
        </div>
        <button className="btn-rojo" onClick={alta} disabled={!altaLista || ocupado !== null}>
          {ocupado === email.trim().toLowerCase() ? "Guardando…" : "Dar acceso"}
        </button>
        {!escribible ? <span className="inv-hint"> Edge Config no está conectado: solo lectura.</span> : null}
      </div>

      <div className="inv-tw">
        <table className="inv-tabla">
          <thead>
            <tr>
              <th>Inversor</th>
              {proyectos.map((p) => <th key={p.proyecto}>{p.nombre}</th>)}
              <th>Hasta</th>
              <th>Acceso</th>
              <th aria-label="Acciones" />
            </tr>
          </thead>
          <tbody>
            {cargando ? (
              <tr><td colSpan={proyectos.length + 4} className="inv-vacio">Cargando…</td></tr>
            ) : filas.length === 0 ? (
              <tr><td colSpan={proyectos.length + 4} className="inv-vacio">
                Aún no hay inversores. Agrega el primero arriba: elige sus proyectos y pulsa Dar acceso.
              </td></tr>
            ) : (
              filas.map((i) => (
                <tr key={i.email} className={i.activo ? "" : "susp"}>
                  <td className="quien">
                    <input className="nombre" aria-label={`Nombre de ${i.email}`} value={i.nombre || ""}
                      placeholder={i.email.split("@")[0]}
                      onChange={(e) => editar(i.email, (x) => ({ ...x, nombre: e.target.value }))} />
                    <small>{i.email}{i.empresa ? ` · ${i.empresa}` : ""}</small>
                    {i.activo && i.proyectos.length === 0 ? <small className="alerta">Sin proyectos: no ve nada</small> : null}
                    {i.activo && !i.enPortal ? <small className="alerta">Sin puerta en el portal: guarda otra vez</small> : null}
                  </td>
                  {proyectos.map((p) => (
                    <td key={p.proyecto}>
                      <input type="checkbox" checked={i.proyectos.includes(p.proyecto)}
                        aria-label={`${i.email}: ${nombreProy(p.proyecto)}`} onChange={() => alternar(i, p.proyecto)} />
                    </td>
                  ))}
                  <td>
                    <input type="date" aria-label={`Acceso hasta, ${i.email}`} value={dia(i.vence_at)}
                      onChange={(e) => editar(i.email, (x) => ({ ...x, vence_at: e.target.value || null }))} />
                  </td>
                  <td>
                    <button type="button" className={i.activo ? "chip on" : "chip"}
                      onClick={() => editar(i.email, (x) => ({ ...x, activo: !x.activo }))}>
                      {i.activo ? "Activo" : "Suspendido"}
                    </button>
                  </td>
                  <td>
                    <button type="button" className="btn-rojo inv-guardar" disabled={!sucio.has(i.email) || ocupado !== null || !escribible}
                      onClick={() => guardarFila(i)}>
                      {ocupado === i.email ? "…" : "Guardar"}
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
