import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/auth";
import { permisoActual } from "@/lib/accesos";

// Puente transparente al proyecto Supabase del Informe Comercial.
//
// El HTML del informe hace sus fetch como si Supabase fuera un endpoint local
// ("/informe_ventas/db/rest/v1/<tabla>?..." en la versión de trei.cl; acá lo
// servimos reescrito a "/api/comercial/db/..."). Esta ruta recibe esas requests
// y las reenvía al Supabase real agregando los headers de autenticación en el
// servidor — la service_role nunca viaja al navegador.
//
// Reemplaza el proxy PHP que servía trei.cl/informe_ventas/db. El modelo de
// seguridad es el mismo: el gate de Entra + Gestor de Accesos del portal filtra
// quién puede llegar hasta acá; una vez adentro, el proxy acepta tanto reads
// como writes (el informe hace POST a `proyeccion_reservas`, por ejemplo).
//
// Env vars (Vercel → Portal):
//   COMERCIAL_SB_URL   https://<ref>.supabase.co  (sin /rest/v1 al final)
//   COMERCIAL_SB_KEY   service_role del proyecto Supabase (secreta, server-side)

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Métodos que acepta el HTML del informe. GET para lecturas (PostgREST), POST
// para inserts (proyeccion_reservas), DELETE para borrar manual overrides
// (funnel_operaciones_manual), PATCH por si en el futuro se agrega una
// edición en vivo. HEAD por si algún navegador lo intenta antes del GET.
const METODOS_PERMITIDOS = new Set([
  "GET",
  "POST",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
]);

// Headers que el frontend puede pasar y queremos propagar a Supabase. Los
// de autenticación (apikey, authorization) los pone el servidor acá; los de
// cookie/host no tienen sentido reenviarlos.
const HEADERS_REENVIADOS = [
  "accept",
  "accept-encoding",
  "content-type",
  "prefer",   // PostgREST: `Prefer: count=exact`, `return=representation`, ...
  "range",    // PostgREST: paginación por rango.
  "range-unit",
];

async function proxy(request: NextRequest, segmentos: string[]): Promise<NextResponse> {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) {
    return NextResponse.json({ error: "sin-sesion" }, { status: 401 });
  }

  const permiso = await permisoActual(email);
  if (!permiso.informes.includes("comercial")) {
    return NextResponse.json({ error: "sin-permiso" }, { status: 403 });
  }

  const base = process.env.COMERCIAL_SB_URL;
  const key = process.env.COMERCIAL_SB_KEY;
  if (!base || !key) {
    return NextResponse.json(
      { error: "puente-no-configurado" },
      { status: 500 }
    );
  }

  // Reconstrucción de la URL destino: /api/comercial/db/<lo que venga>?qs
  // → <COMERCIAL_SB_URL>/<lo que venga>?qs. Se preserva la query string
  // tal cual la mandó el browser (PostgREST la usa para select/filter/order).
  const sufijo = segmentos.map(encodeURIComponent).join("/");
  const destino = new URL(
    `${base.replace(/\/$/, "")}/${sufijo}${request.nextUrl.search}`
  );

  const headers = new Headers();
  for (const nombre of HEADERS_REENVIADOS) {
    const v = request.headers.get(nombre);
    if (v) headers.set(nombre, v);
  }
  headers.set("apikey", key);
  headers.set("Authorization", `Bearer ${key}`);

  const init: RequestInit = {
    method: request.method,
    headers,
    cache: "no-store",
  };
  // GET/HEAD no llevan body; para los demás, se pasa el stream del request.
  if (!["GET", "HEAD"].includes(request.method)) {
    init.body = await request.arrayBuffer();
  }

  const r = await fetch(destino.toString(), init);

  // Reenvío de respuesta: se preservan status, content-type y los headers de
  // PostgREST que el frontend sabe leer (Content-Range para paginación).
  const respHeaders = new Headers();
  const copiar = [
    "content-type",
    "content-range",
    "range-unit",
    "preference-applied",
  ];
  for (const nombre of copiar) {
    const v = r.headers.get(nombre);
    if (v) respHeaders.set(nombre, v);
  }
  // Nunca cacheable en edge/intermediarios: cada request pasa por el gate.
  respHeaders.set("Cache-Control", "private, no-store");

  const body = await r.arrayBuffer();
  return new NextResponse(body, { status: r.status, headers: respHeaders });
}

type Ctx = { params: { path: string[] } };

async function handle(request: NextRequest, ctx: Ctx) {
  if (!METODOS_PERMITIDOS.has(request.method)) {
    return NextResponse.json({ error: "metodo-no-permitido" }, { status: 405 });
  }
  return proxy(request, ctx.params.path ?? []);
}

export const GET = handle;
export const POST = handle;
export const PATCH = handle;
export const DELETE = handle;
export const HEAD = handle;
export const OPTIONS = handle;
