"use client";

import { useCallback, useEffect, useState } from "react";
import {
  type EstadoExtraccion,
  type EstadoProyecto,
  type ResultadoMonitor,
  etiquetaEstado,
  formatoRelativo,
} from "@/lib/extracciones";

type Props = { inicial: ResultadoMonitor };

// Refresco automático cada minuto. No gatilla alerta de correo: eso lo hace el
// cron POST autenticado con CRON_SECRET.
const REFRESCO_MS = 60_000;

export default function VistaExtracciones({ inicial }: Props) {
  const [datos, setDatos] = useState<ResultadoMonitor>(inicial);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [probando, setProbando] = useState(false);
  const [resultadoPrueba, setResultadoPrueba] = useState<string | null>(null);

  const refrescar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      const r = await fetch("/api/admin/extracciones", { cache: "no-store" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const nuevo = (await r.json()) as ResultadoMonitor;
      setDatos(nuevo);
    } catch (e: any) {
      setError(e?.message || "No se pudo refrescar");
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    const id = window.setInterval(refrescar, REFRESCO_MS);
    return () => window.clearInterval(id);
  }, [refrescar]);

  const probarAlerta = useCallback(async () => {
    setProbando(true);
    setResultadoPrueba(null);
    try {
      const r = await fetch("/api/admin/extracciones", {
        method: "POST",
        cache: "no-store",
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
      setResultadoPrueba(
        j.alertas
          ? `Enviadas ${j.alertas} alerta${j.alertas === 1 ? "" : "s"} por correo.`
          : j.suprimidas
          ? `Hay ${j.suprimidas} problema${j.suprimidas === 1 ? "" : "s"}, pero están en la ventana de 6 h sin reenvío.`
          : "Nada que alertar: todas las extracciones están OK."
      );
    } catch (e: any) {
      setResultadoPrueba(`Error: ${e?.message || e}`);
    } finally {
      setProbando(false);
    }
  }, []);

  const problemas = datos.proyectos.filter((p) => p.estado !== "ok");

  return (
    <>
      {/* Resumen y controles */}
      <section className="ext-resumen">
        <div className="ext-contadores">
          <Contador etiqueta="OK" valor={datos.proyectos.filter((p) => p.estado === "ok").length} color="var(--ok)" />
          <Contador etiqueta="Atrasados" valor={datos.proyectos.filter((p) => p.estado === "atrasado").length} color="#D97706" />
          <Contador etiqueta="Fallas" valor={datos.proyectos.filter((p) => p.estado === "falla").length} color="var(--rojo)" />
          <Contador etiqueta="Sin datos" valor={datos.proyectos.filter((p) => p.estado === "sin-datos").length} color="var(--gris)" />
        </div>
        <div className="ext-acciones">
          <span className="ext-ts">
            Evaluado {new Date(datos.evaluadoEn).toLocaleTimeString("es-CL", { timeZone: "America/Santiago" })}
            {cargando ? " · refrescando…" : ""}
            {error ? ` · ${error}` : ""}
          </span>
          <button className="chip" onClick={refrescar} disabled={cargando}>
            Refrescar ahora
          </button>
          <button className="chip chip-rojo" onClick={probarAlerta} disabled={probando}>
            {probando ? "Enviando…" : "Enviar correo de prueba"}
          </button>
          {resultadoPrueba ? <span className="ext-ts">{resultadoPrueba}</span> : null}
        </div>
      </section>

      {/* Grilla de proyectos */}
      <section className="ext-grid">
        {datos.proyectos.map((p) => (
          <TarjetaProyecto key={p.id} p={p} />
        ))}
      </section>

      {/* Resumen de qué va a llegar al correo si no se arregla */}
      {problemas.length ? (
        <section className="ext-correo">
          <h2>Qué llegaría al correo ahora mismo</h2>
          <p className="lead">
            El cron evalúa cada hora. Cuando un proyecto queda en atrasado, falla
            o sin datos, se manda un correo por problema (misma falla no se
            repite por 6 h).
          </p>
          <ul className="ext-correo-lista">
            {problemas.map((p) => (
              <li key={p.id}>
                <strong>{p.nombre}</strong> — {etiquetaEstado(p.estado)}:{" "}
                {p.diagnostico?.titulo || p.ultima.resumen}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <style jsx>{`
        .ext-resumen {
          display: flex;
          flex-wrap: wrap;
          gap: 16px;
          align-items: center;
          justify-content: space-between;
          margin: 20px 0 8px;
        }
        .ext-contadores {
          display: flex;
          gap: 12px;
          flex-wrap: wrap;
        }
        .ext-acciones {
          display: flex;
          gap: 10px;
          align-items: center;
          flex-wrap: wrap;
        }
        .ext-ts {
          font-size: 12.5px;
          color: var(--gris);
        }
        .chip {
          background: transparent;
          border: 1px solid var(--borde);
          color: var(--gris);
          padding: 7px 12px;
          border-radius: 999px;
          font-size: 12.5px;
          cursor: pointer;
          font-family: inherit;
        }
        .chip:hover:not(:disabled) {
          color: var(--tinta);
          border-color: var(--borde-fuerte);
        }
        .chip:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
        .chip-rojo {
          background: var(--rojo);
          border-color: var(--rojo);
          color: #fff;
          box-shadow: 0 0 14px rgba(228, 23, 47, 0.35);
        }
        .ext-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(380px, 1fr));
          gap: 16px;
          margin: 24px 0 32px;
        }
        .ext-correo {
          background: var(--carta);
          border: 1px solid var(--borde);
          border-radius: 14px;
          padding: 20px 24px;
          margin-bottom: 40px;
          backdrop-filter: blur(14px);
          -webkit-backdrop-filter: blur(14px);
          box-shadow: var(--vidrio);
        }
        .ext-correo h2 {
          font-size: 16px;
          margin: 0 0 6px;
          color: var(--tinta);
        }
        .ext-correo-lista {
          margin: 12px 0 0;
          padding-left: 20px;
          color: var(--tinta);
          font-size: 13.5px;
          line-height: 1.6;
        }
      `}</style>
    </>
  );
}

function Contador({
  etiqueta,
  valor,
  color,
}: {
  etiqueta: string;
  valor: number;
  color: string;
}) {
  return (
    <div style={{
      background: "var(--carta)",
      border: "1px solid var(--borde)",
      borderRadius: 10,
      padding: "10px 14px",
      minWidth: 110,
      backdropFilter: "blur(14px)",
    }}>
      <div style={{ fontSize: 11, color: "var(--gris)", textTransform: "uppercase", letterSpacing: ".6px" }}>{etiqueta}</div>
      <div style={{ fontSize: 22, fontWeight: 600, color, lineHeight: 1.1, marginTop: 2 }}>{valor}</div>
    </div>
  );
}

function TarjetaProyecto({ p }: { p: EstadoProyecto }) {
  const supabaseUrl = `https://supabase.com/dashboard/project/${p.ref}`;
  return (
    <article
      style={{
        background: "var(--carta)",
        border: "1px solid var(--borde)",
        borderRadius: 14,
        padding: 20,
        backdropFilter: "blur(14px)",
        WebkitBackdropFilter: "blur(14px)",
        boxShadow: "var(--vidrio)",
        display: "flex",
        flexDirection: "column",
        gap: 14,
      }}
    >
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
        <div>
          <div style={{ fontSize: 11, color: "var(--gris)", textTransform: "uppercase", letterSpacing: ".6px" }}>{p.area}</div>
          <h3 style={{ margin: "4px 0 0", fontSize: 16, color: "var(--tinta)", fontWeight: 600 }}>{p.nombre}</h3>
        </div>
        <Badge estado={p.estado} />
      </header>

      <div style={{ fontSize: 13, color: "var(--gris)", lineHeight: 1.5 }}>
        <div>
          <strong style={{ color: "var(--tinta)" }}>Última corrida:</strong>{" "}
          {formatoRelativo(p.ultima.ts)}
          {p.ultima.ts ? (
            <span style={{ color: "var(--gris-claro)" }}> · {new Date(p.ultima.ts).toLocaleString("es-CL", { timeZone: "America/Santiago" })}</span>
          ) : null}
        </div>
        {p.ultima.resumen ? <div style={{ marginTop: 4 }}>{p.ultima.resumen}</div> : null}
      </div>

      {/* Timeline de los últimos 10 */}
      {p.historial.length ? (
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
          {p.historial.slice(0, 10).map((h, i) => (
            <span
              key={i}
              title={`${h.estado.toUpperCase()} · ${h.resumen} · ${h.ts ? new Date(h.ts).toLocaleString("es-CL", { timeZone: "America/Santiago" }) : "sin fecha"}`}
              style={{
                width: 10,
                height: 20,
                borderRadius: 3,
                background: colorEstado(h.estado),
                boxShadow: h.estado === "falla" ? "0 0 10px rgba(228,23,47,.5)" : undefined,
                opacity: 0.85,
              }}
            />
          ))}
        </div>
      ) : null}

      {p.diagnostico ? (
        <details
          style={{
            background: "#00000040",
            border: "1px solid var(--borde)",
            borderRadius: 10,
            padding: "10px 12px",
            fontSize: 13,
            color: "var(--tinta)",
          }}
        >
          <summary style={{ cursor: "pointer", fontWeight: 600, color: "var(--tinta)" }}>
            {p.diagnostico.titulo}
          </summary>
          {p.diagnostico.causas?.length ? (
            <>
              <div style={{ marginTop: 10, fontSize: 11.5, color: "var(--gris)", textTransform: "uppercase", letterSpacing: ".6px" }}>Causas probables</div>
              <ul style={{ margin: "4px 0 0", paddingLeft: 18, color: "var(--tinta)", lineHeight: 1.5 }}>
                {p.diagnostico.causas.map((c, i) => (
                  <li key={i}>{c}</li>
                ))}
              </ul>
            </>
          ) : null}
          {p.diagnostico.pasos?.length ? (
            <>
              <div style={{ marginTop: 10, fontSize: 11.5, color: "var(--gris)", textTransform: "uppercase", letterSpacing: ".6px" }}>Cómo arreglarlo</div>
              <ol style={{ margin: "4px 0 0", paddingLeft: 18, color: "var(--tinta)", lineHeight: 1.5 }}>
                {p.diagnostico.pasos.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ol>
            </>
          ) : null}
        </details>
      ) : null}

      <footer style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: "auto" }}>
        <a
          href={supabaseUrl}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            fontSize: 12.5,
            padding: "7px 12px",
            borderRadius: 999,
            border: "1px solid var(--borde)",
            color: "var(--gris)",
            textDecoration: "none",
          }}
        >
          Abrir en Supabase ↗
        </a>
      </footer>
    </article>
  );
}

function Badge({ estado }: { estado: EstadoExtraccion }) {
  const bg = colorEstado(estado);
  const texto = etiquetaEstado(estado);
  const sombra = estado === "falla" ? "0 0 14px rgba(228,23,47,.5)" : estado === "atrasado" ? "0 0 10px rgba(217,119,6,.4)" : "none";
  return (
    <span
      style={{
        background: bg,
        color: "#fff",
        padding: "4px 10px",
        borderRadius: 999,
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: ".6px",
        boxShadow: sombra,
        whiteSpace: "nowrap",
      }}
    >
      {texto}
    </span>
  );
}

function colorEstado(e: EstadoExtraccion): string {
  switch (e) {
    case "ok":
      return "var(--ok)";
    case "atrasado":
      return "#D97706";
    case "falla":
      return "var(--rojo)";
    case "sin-datos":
      return "var(--gris-claro)";
  }
}
