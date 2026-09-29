import { INFORME_IDS, type InformeId } from "@/lib/informes";

// ─────────────────────────────────────────────────────────────────────────────
// Gestor de Accesos — almacenamiento en Vercel Edge Config.
//
// Todo el estado vive en UNA llave de Edge Config (`accesos`), así la lectura
// en el middleware es una sola request barata y la escritura es atómica.
//
// Env vars (Vercel → Portal):
//   EDGE_CONFIG        — (o GLOBAL_CONFIG) connection string (la agrega Vercel al conectar el
//                        Edge Config al proyecto): https://edge-config.vercel.com/ecfg_…?token=…
//   VERCEL_API_TOKEN   — token con permiso de escritura sobre ese Edge Config.
//   VERCEL_TEAM_ID     — opcional, si el Edge Config vive en un team.
//   ADMIN_EMAILS       — super-admins (coma). Siempre entran y siempre son admin,
//                        para que nadie pueda dejarse fuera desde la UI.
//   ALLOWED_EMAILS     — lista semilla mientras Edge Config está vacío.
// ─────────────────────────────────────────────────────────────────────────────

export type Rol = "admin" | "usuario";

export type Usuario = {
  email: string;
  nombre?: string;
  rol: Rol;
  activo: boolean;
  informes: InformeId[];
  actualizado?: string;
  actualizadoPor?: string;
};

export type Evento = {
  ts: string;
  por: string;
  accion: "alta" | "baja" | "suspension" | "reactivacion" | "permisos" | "rol" | "datos";
  email: string;
  detalle?: string;
};

export type Accesos = {
  version: number;
  actualizado: string;
  usuarios: Usuario[];
  log: Evento[];
};

export type Origen = "edge-config" | "semilla";

const KEY = "accesos";
const LOG_MAX = 80;
const CACHE_MS = 15_000;

const DEFAULT_ALLOW = [
  "smendez@trei.cl",
  "pelgueta@trei.cl",
  "finanzas@trei.cl",
  "nicole.jaramillo@ivcb.cl",
  "pablo.macias@trei.cl",
];
const DEFAULT_ADMINS = ["smendez@trei.cl"];

const lista = (v: string | undefined, def: string[]) =>
  (v ? v.split(",") : def).map((e) => e.trim().toLowerCase()).filter(Boolean);

export const SUPER_ADMINS = lista(process.env.ADMIN_EMAILS, DEFAULT_ADMINS);

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function semilla(): Accesos {
  const emails = Array.from(
    new Set([...lista(process.env.ALLOWED_EMAILS, DEFAULT_ALLOW), ...SUPER_ADMINS])
  );
  return {
    version: 0,
    actualizado: new Date(0).toISOString(),
    usuarios: emails.map((email) => ({
      email,
      rol: SUPER_ADMINS.includes(email) ? "admin" : "usuario",
      activo: true,
      informes: [...INFORME_IDS],
    })),
    log: [],
  };
}

// Vercel a veces crea la variable con otro nombre al conectar el Edge Config.
const edgeConfigCs = () => process.env.EDGE_CONFIG || process.env.GLOBAL_CONFIG || "";

// Edge Config pasó a llamarse Global Config: las conexiones nuevas usan
// global-config.vercel.com y su API REST vive en /v1/global-config. Se usa la
// misma familia que indique el connection string.
type Conexion = { id: string; token: string; host: string; api: "global-config" | "edge-config" };

function conexion(): Conexion | null {
  const cs = edgeConfigCs();
  if (!cs) return null;
  try {
    const u = new URL(cs);
    if (!/^(edge|global)-config\.vercel\.com$/.test(u.hostname)) return null;
    const id = u.pathname.replace(/^\//, "");
    const token = u.searchParams.get("token") || "";
    const api = u.hostname.startsWith("global") ? "global-config" : "edge-config";
    return id && token ? { id, token, host: u.hostname, api } : null;
  } catch {
    return null;
  }
}

let cache: { valor: Accesos; origen: Origen; ts: number } | null = null;

// Lee el estado. Nunca lanza: si Edge Config falla, usa el último valor en
// memoria o la semilla, para que un corte de Edge Config no bloquee a todos.
export async function leerAccesos(
  opts: { fresco?: boolean } = {}
): Promise<{ accesos: Accesos; origen: Origen }> {
  if (!opts.fresco && cache && Date.now() - cache.ts < CACHE_MS) {
    return { accesos: cache.valor, origen: cache.origen };
  }
  const c = conexion();
  if (!c) return { accesos: semilla(), origen: "semilla" };
  try {
    const r = await fetch(
      `https://${c.host}/${c.id}/item/${KEY}?token=${c.token}`,
      { cache: "no-store" }
    );
    if (r.status === 404) {
      cache = { valor: semilla(), origen: "semilla", ts: Date.now() };
    } else if (r.ok) {
      const valor = normalizar(await r.json());
      cache = { valor, origen: "edge-config", ts: Date.now() };
    } else {
      throw new Error(`Edge Config ${r.status}`);
    }
  } catch (e) {
    console.error("[accesos] lectura falló:", e);
    if (!cache) return { accesos: semilla(), origen: "semilla" };
  }
  return { accesos: cache!.valor, origen: cache!.origen };
}

export function puedeEscribir(): boolean {
  return !!conexion() && !!process.env.VERCEL_API_TOKEN;
}

// Qué falta para poder guardar, en palabras para el aviso de solo lectura.
// Nunca incluye valores de las variables.
export function faltasEscritura(): string[] {
  const faltas: string[] = [];
  if (!edgeConfigCs()) faltas.push("No hay variable EDGE_CONFIG (ni GLOBAL_CONFIG) en este deploy.");
  else if (!conexion())
    faltas.push(
      "EDGE_CONFIG / GLOBAL_CONFIG existe pero no tiene el formato https://global-config.vercel.com/…?token=…"
    );
  if (!process.env.VERCEL_API_TOKEN) faltas.push("No hay variable VERCEL_API_TOKEN en este deploy.");
  return faltas;
}

export async function guardarAccesos(valor: Accesos): Promise<void> {
  const c = conexion();
  const token = process.env.VERCEL_API_TOKEN;
  if (!c || !token) throw new Error("Edge Config no configurado para escritura");
  const team = process.env.VERCEL_TEAM_ID ? `?teamId=${process.env.VERCEL_TEAM_ID}` : "";
  const patch = (api: string) =>
    fetch(`https://api.vercel.com/v1/${api}/${c.id}/items${team}`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ items: [{ operation: "upsert", key: KEY, value: valor }] }),
    });
  let r = await patch(c.api);
  // Por si la API de la otra familia es la que reconoce este store.
  if (r.status === 404) {
    const otra = await patch(c.api === "global-config" ? "edge-config" : "global-config");
    if (otra.status !== 404) r = otra;
  }
  if (!r.ok) {
    // Vercel responde { error: { code, message } }; nunca incluye el token.
    let detalle = "";
    try {
      const j = await r.json();
      detalle = [j?.error?.code, j?.error?.message].filter(Boolean).join(": ");
    } catch {}
    const pista =
      r.status === 401 || r.status === 403
        ? "El token (VERCEL_API_TOKEN) no es válido o no tiene acceso al equipo del Edge Config (revisa VERCEL_TEAM_ID y el alcance del token)."
        : r.status === 404
          ? "No se encontró el Edge Config con ese equipo: revisa que VERCEL_TEAM_ID sea el del equipo dueño del Edge Config."
          : "";
    throw new Error(
      [`Vercel respondió ${r.status}`, detalle.slice(0, 200), pista].filter(Boolean).join(". ")
    );
  }
  // Edge Config tarda unos segundos en propagar: esta instancia ve el cambio ya.
  cache = { valor, origen: "edge-config", ts: Date.now() };
}

export function normalizar(raw: any): Accesos {
  const usuarios: Usuario[] = Array.isArray(raw?.usuarios) ? raw.usuarios : [];
  return {
    version: Number(raw?.version) || 0,
    actualizado: String(raw?.actualizado || new Date(0).toISOString()),
    usuarios: usuarios
      .filter((u) => u && typeof u.email === "string")
      .map((u) => ({
        email: u.email.trim().toLowerCase(),
        nombre: u.nombre ? String(u.nombre).slice(0, 80) : undefined,
        rol: u.rol === "admin" ? "admin" : "usuario",
        activo: u.activo !== false,
        informes: (Array.isArray(u.informes) ? u.informes : []).filter((i: any) =>
          INFORME_IDS.includes(i)
        ),
        actualizado: u.actualizado,
        actualizadoPor: u.actualizadoPor,
      })),
    log: Array.isArray(raw?.log) ? raw.log.slice(0, LOG_MAX) : [],
  };
}

// ─── Consultas de permiso ───────────────────────────────────────────────────

export type Permiso = { permitido: boolean; admin: boolean; informes: InformeId[] };

export function permisoDe(accesos: Accesos, email: string | null | undefined): Permiso {
  const e = (email || "").toLowerCase();
  if (!e) return { permitido: false, admin: false, informes: [] };
  if (SUPER_ADMINS.includes(e)) return { permitido: true, admin: true, informes: [...INFORME_IDS] };
  const u = accesos.usuarios.find((x) => x.email === e);
  if (!u || !u.activo) return { permitido: false, admin: false, informes: [] };
  return { permitido: true, admin: u.rol === "admin", informes: u.informes };
}

export async function permisoActual(email: string | null | undefined): Promise<Permiso> {
  const { accesos } = await leerAccesos();
  return permisoDe(accesos, email);
}

// ─── Bitácora: compara estado anterior y nuevo ──────────────────────────────

export function diferencias(antes: Usuario[], despues: Usuario[], por: string): Evento[] {
  const ts = new Date().toISOString();
  const ev: Evento[] = [];
  const mapA = new Map(antes.map((u) => [u.email, u]));
  const mapD = new Map(despues.map((u) => [u.email, u]));
  for (const d of despues) {
    const a = mapA.get(d.email);
    if (!a) {
      ev.push({ ts, por, accion: "alta", email: d.email, detalle: d.informes.join(", ") || "sin informes" });
      continue;
    }
    if (a.activo !== d.activo)
      ev.push({ ts, por, accion: d.activo ? "reactivacion" : "suspension", email: d.email });
    if (a.rol !== d.rol) ev.push({ ts, por, accion: "rol", email: d.email, detalle: d.rol });
    const ma = [...a.informes].sort().join(","), md = [...d.informes].sort().join(",");
    if (ma !== md) {
      const mas = d.informes.filter((i) => !a.informes.includes(i));
      const menos = a.informes.filter((i) => !d.informes.includes(i));
      const det = [...mas.map((i) => "+" + i), ...menos.map((i) => "−" + i)].join(" ");
      ev.push({ ts, por, accion: "permisos", email: d.email, detalle: det });
    }
    if ((a.nombre || "") !== (d.nombre || ""))
      ev.push({ ts, por, accion: "datos", email: d.email, detalle: d.nombre || "" });
  }
  for (const a of antes) if (!mapD.has(a.email)) ev.push({ ts, por, accion: "baja", email: a.email });
  return ev;
}

export const LOG_LIMITE = LOG_MAX;
