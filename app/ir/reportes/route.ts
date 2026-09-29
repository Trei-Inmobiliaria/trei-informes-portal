import { createHmac } from "crypto";
import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/auth";
import { permisoActual } from "@/lib/accesos";
import { informeDeRuta } from "@/lib/informes";

// Puente SSO hacia la app de reportes (debt-control).
// El usuario ya pasó por Microsoft en el portal (NextAuth). Al hacer clic en una
// tarjeta llega ACÁ (ruta protegida por el middleware, así que hay sesión). Acá,
// EN EL SERVIDOR y AL MOMENTO DEL CLIC, firmamos un token corto (2 min) con el
// email de la sesión y redirigimos a `<reportes>/sso?token=...`. El receptor de
// Pablo (commit 04b7fcd en `main`) valida la firma y abre la sesión de datos sola.
// El secreto NUNCA llega al navegador: se usa solo acá, en el server.
//
// Env vars (Vercel → Portal):
//   PORTAL_SSO_SECRET  — mismo valor que en el proyecto de reportes
//   REPORTES_URL       — dominio de la app de reportes

export const runtime = "nodejs"; // createHmac necesita el runtime de Node, no edge.
export const dynamic = "force-dynamic"; // el token se firma en cada request (nunca cachear).

function linkFirmado(email: string, secret: string, base: string, next?: string): string {
  const payload = Buffer.from(
    JSON.stringify({ email, exp: Math.floor(Date.now() / 1000) + 120 })
  ).toString("base64url");
  const firma = createHmac("sha256", secret).update(payload).digest("hex");

  const url = new URL("/sso", base);
  url.searchParams.set("token", `${payload}.${firma}`);
  // `next` solo se acepta como ruta relativa ("/algo") para evitar open-redirect.
  if (next && next.startsWith("/") && !next.startsWith("//")) {
    url.searchParams.set("next", next);
  }
  return url.toString();
}

export async function GET(request: NextRequest) {
  const session = await auth();
  const email = session?.user?.email;

  // Sin sesión válida no hay a quién firmarle: de vuelta al login del portal.
  if (!email) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  // Permiso por informe según el Gestor de Accesos (cobranza vs tesorería).
  const next = request.nextUrl.searchParams.get("next") ?? undefined;
  const permiso = await permisoActual(email);
  if (!permiso.informes.includes(informeDeRuta(next))) {
    return NextResponse.redirect(new URL("/?error=sin-permiso", request.url));
  }

  const secret = process.env.PORTAL_SSO_SECRET;
  const base = process.env.REPORTES_URL;
  if (!secret || !base) {
    return NextResponse.redirect(new URL("/?error=sso-config", request.url));
  }

  return NextResponse.redirect(linkFirmado(email, secret, base, next));
}
