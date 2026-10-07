import { readFile } from "fs/promises";
import path from "path";
import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/auth";
import { permisoActual } from "@/lib/accesos";

// Puente para informes HTML de Finanzas que viven en este mismo proyecto.
// A diferencia de /ir/reportes (que firma un token hacia debt-control), aquí el
// HTML está en /privado — fuera de /public, así Next nunca lo sirve como
// estático — y esta ruta lo lee del disco solo después de validar el permiso.
// next.config.mjs incluye /privado en el bundle de esta función.
//
// `?v=vcb` sirve la vista restringida a VCB Constructora SpA, cuyo HTML embebe
// solo las filas de VCB. Cada vista tiene su propio permiso (ver abajo).

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ARCHIVOS: Record<"full" | "vcb", string> = {
  full: "facturas-recibidas-2026.html",
  vcb: "facturas-recibidas-2026-vcb.html",
};

// Fuente privada: bucket privado de Supabase Storage donde un proceso diario (GitHub Actions) deja
// Facturas_Recibidas.html y Facturas_Recibidas_VCB.html. Variables de entorno en Vercel:
//   FACTURAS_FUENTE_URL   https://<ref>.supabase.co/storage/v1/object/informes-privados
//   FACTURAS_FUENTE_TOKEN llave service_role del proyecto (secreta, solo servidor)
// Si no están definidas o la lectura falla, se usa el archivo de /privado (versión anterior).
const REMOTOS: Record<"full" | "vcb", string> = {
  full: "Facturas_Recibidas.html",
  vcb: "Facturas_Recibidas_VCB.html",
};

async function htmlRemoto(pedido: "full" | "vcb"): Promise<string | null> {
  const base = process.env.FACTURAS_FUENTE_URL;
  const token = process.env.FACTURAS_FUENTE_TOKEN;
  if (!base || !token) return null;
  try {
    const r = await fetch(`${base.replace(/\/$/, "")}/${REMOTOS[pedido]}`, {
      headers: { Authorization: `Bearer ${token}`, apikey: token },
      cache: "no-store",
    });
    return r.ok ? await r.text() : null;
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest) {
  const session = await auth();
  const email = session?.user?.email;

  if (!email) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  // Vista completa → permiso `facturas-recibidas-2026`.
  // Vista VCB      → permiso `facturas-vcb` (o el completo, que la incluye).
  // Quien solo tiene VCB y pide la completa recibe la VCB: nunca la completa.
  const permiso = await permisoActual(email);
  const completo = permiso.informes.includes("facturas-recibidas-2026");
  const vcb = completo || permiso.informes.includes("facturas-vcb");
  const pedido = request.nextUrl.searchParams.get("v") === "vcb" ? "vcb" : "full";

  if (!vcb) {
    return NextResponse.redirect(new URL("/?error=sin-permiso", request.url));
  }
  if (pedido === "full" && !completo) {
    return NextResponse.redirect(new URL("/ir/facturas?v=vcb", request.url));
  }
  const archivo = ARCHIVOS[pedido];
  const ruta = path.join(process.cwd(), "privado", archivo);

  try {
    const html = (await htmlRemoto(pedido)) ?? (await readFile(ruta, "utf-8"));
    return new NextResponse(html, {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        // No cachear: el gate de permiso debe correrse en cada visita.
        "Cache-Control": "private, no-store",
      },
    });
  } catch {
    return new NextResponse(
      "<h1>Informe no disponible</h1><p>El archivo aún no está publicado. Avisa a Control de Gestión.</p>",
      { status: 404, headers: { "Content-Type": "text/html; charset=utf-8" } }
    );
  }
}
