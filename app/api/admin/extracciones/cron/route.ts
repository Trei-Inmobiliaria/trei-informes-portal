import { NextResponse, type NextRequest } from "next/server";
import { esProblema, evaluarExtracciones } from "@/lib/extracciones";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ─────────────────────────────────────────────────────────────────────────────
// Cron horario de Vercel. Vercel manda GET con `Authorization: Bearer ${CRON_SECRET}`
// (lo setea solo cuando quien llama es su scheduler). Toda la lógica de
// evaluación y envío vive en `/api/admin/extracciones` (POST), así que acá solo
// autenticamos y reenviamos la llamada.
// ─────────────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const header = req.headers.get("authorization") || "";
  const cronSecret = process.env.CRON_SECRET || "";
  if (!cronSecret || header !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const resultado = await evaluarExtracciones();
  const problemas = resultado.proyectos.filter((p) => esProblema(p.estado));
  if (!problemas.length) {
    return NextResponse.json({
      ok: true,
      evaluadoEn: resultado.evaluadoEn,
      alertas: 0,
    });
  }

  // Reutilizamos el POST del mismo API: así hay una sola implementación de
  // dedup + envío de correo.
  const url = new URL(req.url);
  const r = await fetch(`${url.origin}/api/admin/extracciones`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${cronSecret}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ origen: "cron" }),
  });
  const data = await r.json().catch(() => ({}));
  return NextResponse.json({ ok: r.ok, origen: "cron", ...data });
}
