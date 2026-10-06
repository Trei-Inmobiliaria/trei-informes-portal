import { readFile } from "fs/promises";
import path from "path";
import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/auth";
import { permisoActual } from "@/lib/accesos";

// Puente para informes estáticos de Finanzas servidos desde /public.
// A diferencia de /ir/reportes (que firma un token hacia debt-control), aquí el
// HTML vive en este mismo proyecto, en /public, y se entrega leyéndolo del disco
// después de validar el permiso. Así `/facturas-recibidas-2026.html` nunca se
// expone directamente: solo se llega vía esta ruta tras pasar el gate de accesos.
//
// `?v=vcb` sirve la vista restringida a VCB Constructora SpA (misma llave de
// permiso: `facturas-recibidas-2026`). Hoy no se discrimina por variante, el
// admin decide qué correo ve qué variante poniendo el link que corresponde en el
// catálogo o enviándoselo directo.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Sufijo .priv.html → Next no los sirve como estáticos directos desde /public
// (solo cumple con .html exacto). Única vía: esta ruta, tras validar permiso.
const ARCHIVOS: Record<string, string> = {
  full: "facturas-recibidas-2026.priv.html",
  vcb: "facturas-recibidas-2026-vcb.priv.html",
};

export async function GET(request: NextRequest) {
  const session = await auth();
  const email = session?.user?.email;

  if (!email) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  const permiso = await permisoActual(email);
  if (!permiso.informes.includes("facturas-recibidas-2026")) {
    return NextResponse.redirect(new URL("/?error=sin-permiso", request.url));
  }

  const v = request.nextUrl.searchParams.get("v") || "full";
  const archivo = ARCHIVOS[v] || ARCHIVOS.full;
  const ruta = path.join(process.cwd(), "public", archivo);

  try {
    const html = await readFile(ruta, "utf-8");
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
