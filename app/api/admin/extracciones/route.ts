import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/auth";
import { destinatariosExtracciones, leerAccesos, permisoDe } from "@/lib/accesos";
import {
  esProblema,
  etiquetaEstado,
  evaluarExtracciones,
  formatoRelativo,
  type EstadoProyecto,
  type ResultadoMonitor,
} from "@/lib/extracciones";
import type { EstadoInforme } from "@/lib/informes-salud";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ─────────────────────────────────────────────────────────────────────────────
// GET  → devuelve el estado para la UI del admin. Requiere sesión + rol admin.
// POST → evalúa y, si hay problemas, envía correo. Llamado por el cron horario
//        de Vercel. Se autentica con el header `authorization: Bearer $CRON_SECRET`
//        que Vercel pone solo cuando el llamador es su scheduler.
// ─────────────────────────────────────────────────────────────────────────────

export async function GET() {
  const session = await auth();
  const email = session?.user?.email?.toLowerCase() || "";
  if (!email) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const { accesos } = await leerAccesos({ fresco: false });
  if (!permisoDe(accesos, email).verExtracciones) {
    return NextResponse.json({ error: "Sin permiso para ver Extracciones" }, { status: 403 });
  }

  const resultado = await evaluarExtracciones();
  return NextResponse.json(resultado);
}

export async function POST(req: NextRequest) {
  // El cron de Vercel manda `Authorization: Bearer ${CRON_SECRET}`. Si está
  // bien, atendemos sin sesión. Si no, pedimos sesión admin (así un admin puede
  // forzar la evaluación con un POST manual desde la UI).
  const header = req.headers.get("authorization") || "";
  const cronSecret = process.env.CRON_SECRET || "";
  const esCron = cronSecret && header === `Bearer ${cronSecret}`;

  if (!esCron) {
    const session = await auth();
    const email = session?.user?.email?.toLowerCase() || "";
    const { accesos } = await leerAccesos({ fresco: false });
    if (!permisoDe(accesos, email).verExtracciones) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }
  }

  const resultado = await evaluarExtracciones();

  // Problemas de proyectos Supabase (extracción).
  const problemasP = resultado.proyectos.filter((p) => esProblema(p.estado));
  // Problemas de informes: SOLO cuando el ping del informe falló y el proyecto
  // está OK — es decir, cuando el eslabón Supabase→informe se rompió por su
  // cuenta. Si el proyecto ya está rojo, ya se mandó correo por el proyecto;
  // no duplicamos la alerta.
  const problemasI = resultado.informes.filter(
    (i) =>
      esProblema(i.estado) &&
      i.estadoProyecto === "ok" &&
      i.tipoCheck !== "hereda-proyecto"
  );

  if (!problemasP.length && !problemasI.length) {
    return NextResponse.json({ ok: true, evaluadoEn: resultado.evaluadoEn, alertas: 0 });
  }

  // Dedup simple: no reenviamos el mismo problema en < 6 h.
  const nuevasP = problemasP.filter((p) => debeAlertar(huellaProyecto(p)));
  const nuevasI = problemasI.filter((i) => debeAlertar(huellaInforme(i)));
  if (!nuevasP.length && !nuevasI.length) {
    return NextResponse.json({
      ok: true,
      evaluadoEn: resultado.evaluadoEn,
      alertas: 0,
      suprimidas: problemasP.length + problemasI.length,
    });
  }

  const [enviadasP, enviadasI] = await Promise.all([
    Promise.all(nuevasP.map((p) => enviarAlertaProyecto(p, resultado))),
    Promise.all(nuevasI.map((i) => enviarAlertaInforme(i, resultado))),
  ]);
  nuevasP.forEach((p, k) => enviadasP[k] && marcarAlerta(huellaProyecto(p)));
  nuevasI.forEach((i, k) => enviadasI[k] && marcarAlerta(huellaInforme(i)));

  return NextResponse.json({
    ok: true,
    evaluadoEn: resultado.evaluadoEn,
    alertas: enviadasP.filter(Boolean).length + enviadasI.filter(Boolean).length,
    detalle: [
      ...nuevasP.map((p, k) => ({ tipo: "proyecto", id: p.id, enviado: enviadasP[k] })),
      ...nuevasI.map((i, k) => ({ tipo: "informe", id: i.id, enviado: enviadasI[k] })),
    ],
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Dedup en memoria (6 h por combinación proyecto+hash de error).
// Para dedup persistente ver docs/admin-extracciones.md (sección "Dedup real").
// ─────────────────────────────────────────────────────────────────────────────

const VENTANA_MS = 6 * 60 * 60 * 1000;
const ultimas: Map<string, number> = (globalThis as any).__treiAlertas ||
  ((globalThis as any).__treiAlertas = new Map<string, number>());

function huellaProyecto(p: EstadoProyecto): string {
  return `proyecto:${p.id}:${p.estado}:${(p.ultima.error || p.diagnostico?.titulo || "").slice(0, 120)}`;
}

function huellaInforme(i: EstadoInforme): string {
  return `informe:${i.id}:${i.estado}:${(i.diagnostico?.titulo || i.resumen).slice(0, 120)}`;
}

function debeAlertar(h: string): boolean {
  const prev = ultimas.get(h);
  return !prev || Date.now() - prev > VENTANA_MS;
}

function marcarAlerta(h: string): void {
  ultimas.set(h, Date.now());
}

// ─────────────────────────────────────────────────────────────────────────────
// Correo — Resend. HTML simple, en español, con lo mínimo para actuar.
// ─────────────────────────────────────────────────────────────────────────────

// Reúne destinatarios de la env var ALERTAS_TO + los usuarios del portal
// activos con permiso de ver Extracciones (admins + flag verExtracciones).
// Así basta con marcarle a alguien el chip en /accesos para que empiece a
// recibir alertas, sin tener que tocar env vars en Vercel.
async function resolverDestinatarios(): Promise<string[]> {
  const fijos = (process.env.ALERTAS_TO || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  try {
    const { accesos } = await leerAccesos({ fresco: false });
    return Array.from(new Set([...fijos, ...destinatariosExtracciones(accesos)]));
  } catch (e) {
    console.warn("[alerta] no se pudo leer accesos, usando solo ALERTAS_TO:", e);
    return fijos;
  }
}

async function enviarAlertaProyecto(
  p: EstadoProyecto,
  resultado: ResultadoMonitor
): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.ALERTAS_FROM;
  const to = await resolverDestinatarios();

  if (!apiKey || !from || !to.length) {
    console.warn("[alerta] Falta RESEND_API_KEY / ALERTAS_FROM / destinatarios; no se puede enviar");
    return false;
  }

  const subject = `[Portal Trei] ${etiquetaEstado(p.estado)} — ${p.nombre}`;
  const html = armarHtmlProyecto(p, resultado);

  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ from, to, subject, html }),
  });
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    console.error(`[alerta] Resend ${r.status}: ${t.slice(0, 200)}`);
    return false;
  }
  return true;
}

// Envío de alerta de informe (puente roto con proyecto Supabase OK).
async function enviarAlertaInforme(
  i: EstadoInforme,
  resultado: ResultadoMonitor
): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.ALERTAS_FROM;
  const to = await resolverDestinatarios();
  if (!apiKey || !from || !to.length) {
    console.warn("[alerta informe] Falta RESEND_API_KEY / ALERTAS_FROM / destinatarios");
    return false;
  }
  const subject = `[Portal Trei] ${etiquetaEstado(i.estado)} — Informe ${i.nombre}`;
  const html = armarHtmlInforme(i, resultado);
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ from, to, subject, html }),
  });
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    console.error(`[alerta informe] Resend ${r.status}: ${t.slice(0, 200)}`);
    return false;
  }
  return true;
}

function armarHtmlInforme(i: EstadoInforme, resultado: ResultadoMonitor): string {
  const d = i.diagnostico;
  const color =
    i.estado === "falla" ? "#E1093F" : i.estado === "atrasado" ? "#D97706" : "#6B7280";
  const panelUrl = process.env.NEXT_PUBLIC_PORTAL_URL || "https://trei-informes.app";

  const li = (xs: string[]) =>
    xs.map((x) => `<li style="margin:4px 0">${escapar(x)}</li>`).join("");

  return `<!doctype html><html lang="es"><body style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;background:#f6f7f9;margin:0;padding:24px;color:#111">
  <div style="max-width:620px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb">
    <div style="background:${color};color:#fff;padding:18px 24px">
      <div style="font-size:12px;letter-spacing:.8px;text-transform:uppercase;opacity:.9">Portal Trei · Puente Supabase → informe</div>
      <h1 style="margin:4px 0 0;font-size:20px;font-weight:600">Informe ${escapar(i.nombre)} — ${etiquetaEstado(i.estado)}</h1>
    </div>
    <div style="padding:20px 24px;line-height:1.5">
      <p style="margin:0 0 12px"><strong>Importante:</strong> la extracción a Supabase (${escapar(i.proyectoNombre)}) está <strong style="color:#1a9d5a">OK</strong>. El problema está en el eslabón que lleva los datos de Supabase al informe.</p>
      <p style="margin:0 0 12px"><strong>Qué pasó.</strong> ${escapar(d?.titulo || i.resumen)}</p>
      <p style="margin:0 0 4px;color:#6B7280;font-size:13px">${escapar(i.resumen)}</p>
      ${d?.causas?.length ? `<h2 style="font-size:14px;margin:16px 0 6px">Causas probables</h2><ul style="margin:0;padding-left:20px;font-size:14px">${li(d.causas)}</ul>` : ""}
      ${d?.pasos?.length ? `<h2 style="font-size:14px;margin:16px 0 6px">Cómo arreglarlo</h2><ol style="margin:0;padding-left:20px;font-size:14px">${li(d.pasos)}</ol>` : ""}
      <div style="margin-top:20px">
        <a href="${panelUrl}/admin/extracciones" style="display:inline-block;background:#111;color:#fff;text-decoration:none;padding:10px 14px;border-radius:8px;font-size:13px">Abrir panel</a>
      </div>
    </div>
    <div style="padding:12px 24px;border-top:1px solid #e5e7eb;color:#9CA3AF;font-size:11px">
      Evaluado ${escapar(new Date(resultado.evaluadoEn).toLocaleString("es-CL", { timeZone: "America/Santiago" }))} ·
      No se repite esta alerta por 6 h salvo que cambie el error.
    </div>
  </div>
</body></html>`;
}

function armarHtmlProyecto(p: EstadoProyecto, resultado: ResultadoMonitor): string {
  const d = p.diagnostico;
  const color =
    p.estado === "falla" ? "#E1093F" : p.estado === "atrasado" ? "#D97706" : "#6B7280";
  const panelUrl = process.env.NEXT_PUBLIC_PORTAL_URL || "https://trei-informes.app";
  const supabaseUrl = `https://supabase.com/dashboard/project/${p.ref}`;

  const li = (xs: string[]) =>
    xs.map((x) => `<li style="margin:4px 0">${escapar(x)}</li>`).join("");

  return `<!doctype html><html lang="es"><body style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;background:#f6f7f9;margin:0;padding:24px;color:#111">
  <div style="max-width:620px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb">
    <div style="background:${color};color:#fff;padding:18px 24px">
      <div style="font-size:12px;letter-spacing:.8px;text-transform:uppercase;opacity:.9">Portal Trei · Monitor de extracciones</div>
      <h1 style="margin:4px 0 0;font-size:20px;font-weight:600">${escapar(p.nombre)} — ${etiquetaEstado(p.estado)}</h1>
    </div>
    <div style="padding:20px 24px;line-height:1.5">
      <p style="margin:0 0 12px"><strong>Qué pasó.</strong> ${escapar(d?.titulo || p.ultima.resumen)}</p>
      <p style="margin:0 0 4px;color:#6B7280;font-size:13px">Última corrida: ${escapar(formatoRelativo(p.ultima.ts))} ${p.ultima.ts ? `· ${escapar(new Date(p.ultima.ts).toLocaleString("es-CL", { timeZone: "America/Santiago" }))}` : ""}</p>
      ${p.ultima.resumen ? `<p style="margin:0 0 16px;color:#6B7280;font-size:13px">${escapar(p.ultima.resumen)}</p>` : ""}
      ${d?.causas?.length ? `<h2 style="font-size:14px;margin:16px 0 6px">Causas probables</h2><ul style="margin:0;padding-left:20px;font-size:14px">${li(d.causas)}</ul>` : ""}
      ${d?.pasos?.length ? `<h2 style="font-size:14px;margin:16px 0 6px">Cómo arreglarlo</h2><ol style="margin:0;padding-left:20px;font-size:14px">${li(d.pasos)}</ol>` : ""}
      <div style="margin-top:20px;display:flex;gap:8px;flex-wrap:wrap">
        <a href="${panelUrl}/admin/extracciones" style="display:inline-block;background:#111;color:#fff;text-decoration:none;padding:10px 14px;border-radius:8px;font-size:13px">Abrir panel</a>
        <a href="${supabaseUrl}" style="display:inline-block;background:#fff;color:#111;text-decoration:none;padding:10px 14px;border-radius:8px;border:1px solid #e5e7eb;font-size:13px">Ir al proyecto en Supabase</a>
      </div>
    </div>
    <div style="padding:12px 24px;border-top:1px solid #e5e7eb;color:#9CA3AF;font-size:11px">
      Evaluado ${escapar(new Date(resultado.evaluadoEn).toLocaleString("es-CL", { timeZone: "America/Santiago" }))} ·
      No se repite esta alerta por 6 h salvo que cambie el error.
    </div>
  </div>
</body></html>`;
}

function escapar(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
