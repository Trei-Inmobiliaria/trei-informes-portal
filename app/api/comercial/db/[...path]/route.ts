import { createHmac } from "crypto";
import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/auth";
import { permisoActual } from "@/lib/accesos";

// Puente al proyecto Supabase del Informe Comercial.
//
// El HTML del informe hace sus fetch como si Supabase fuera un endpoint local
// ("/informe_ventas/db/rest/v1/<tabla>?..." en la versión de trei.cl; acá lo
// servimos reescrito a "/api/comercial/db/..."). Esta ruta recibe esas requests
// y las reenvía al Supabase real agregando los headers de autenticación en el
// servidor — ninguna llave viaja al navegador.
//
// Modelo de seguridad — importante:
//   La base tiene RLS activa en todas las tablas del informe. Las políticas
//   llaman a mi_email() (que lee del claim "email" del JWT), rol_efectivo()
//   (RBAC via public.informe_usuario) y mis_proyectos_ext() (filtro por
//   proyecto via public.informe_usuario_proyecto). Es decir, la base decide
//   qué filas devolver según QUIÉN está preguntando — distintos usuarios ven
//   distintos proyectos por diseño.
//
//   Para que RLS se aplique, tenemos que firmar un JWT user-scoped con el
//   email de la sesión y pasarlo como Bearer. Si en vez usamos la service_role,
//   PostgREST salta las RLS y TODOS ven TODO — exactamente el bug que estamos
//   evitando. Por eso COMERCIAL_SB_JWT_SECRET es obligatoria.
//
// Env vars (Vercel → Portal):
//   COMERCIAL_SB_URL         https://<ref>.supabase.co  (sin /rest/v1 al final)
//   COMERCIAL_SB_JWT_SECRET  JWT secret del proyecto Supabase (Settings → API)
//   COMERCIAL_SB_KEY         anon key del proyecto (apikey del gateway de Supabase)
//                            — service_role también pasa el gateway, pero
//                            preferimos anon por el principio de menor privilegio.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const METODOS_PERMITIDOS = new Set([
  "GET",
  "POST",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
]);

// Headers que el frontend puede pasar y queremos propagar a Supabase. Los de
// autenticación (apikey, authorization) los pone el servidor; los de
// cookie/host no tienen sentido reenviarlos.
const HEADERS_REENVIADOS = [
  "accept",
  "accept-encoding",
  "content-type",
  "prefer",   // PostgREST: `Prefer: count=exact`, `return=representation`, …
  "range",    // PostgREST: paginación por rango.
  "range-unit",
];

// Codificación base64url (sin padding) como pide el JWT.
function b64url(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

// Firma un JWT HS256 con el email del usuario y role=authenticated. El TTL
// corto (60s) alcanza para la vida del fetch y limita la ventana si llegara a
// filtrarse. El claim "email" es el que lee public.mi_email() en Postgres.
function firmarJwtUsuario(email: string, secret: string): string {
  const header = { alg: "HS256", typ: "JWT" };
  const ahora = Math.floor(Date.now() / 1000);
  const payload = {
    role: "authenticated",
    email,
    iat: ahora,
    exp: ahora + 60,
  };
  const encHeader = b64url(Buffer.from(JSON.stringify(header)));
  const encPayload = b64url(Buffer.from(JSON.stringify(payload)));
  const firmable = `${encHeader}.${encPayload}`;
  const firma = b64url(createHmac("sha256", secret).update(firmable).digest());
  return `${firmable}.${firma}`;
}

async function proxy(request: NextRequest, segmentos: string[]): Promise<NextResponse> {
  const session = await auth();
  const email = session?.user?.email?.toLowerCase();
  if (!email) {
    return NextResponse.json({ error: "sin-sesion" }, { status: 401 });
  }

  // Primer filtro: Gestor de Accesos del portal. Decide si la persona puede
  // llegar al informe comercial. El filtro FINO por proyecto lo aplica RLS
  // adentro de Postgres (ver comentario de modelo de seguridad arriba).
  const permiso = await permisoActual(email);
  if (!permiso.informes.includes("comercial")) {
    return NextResponse.json({ error: "sin-permiso" }, { status: 403 });
  }

  const base = process.env.COMERCIAL_SB_URL;
  const apiKey = process.env.COMERCIAL_SB_KEY;
  const jwtSecret = process.env.COMERCIAL_SB_JWT_SECRET;
  if (!base || !apiKey || !jwtSecret) {
    // Fail cerrado: si falta el JWT secret y usáramos service_role, se saltan
    // las RLS y todos verían todos los proyectos. Mejor devolver 500 ruidoso
    // que servir datos de más.
    const faltan = [
      !base && "COMERCIAL_SB_URL",
      !apiKey && "COMERCIAL_SB_KEY",
      !jwtSecret && "COMERCIAL_SB_JWT_SECRET",
    ].filter(Boolean);
    return NextResponse.json(
      { error: "puente-no-configurado", faltan },
      { status: 500 }
    );
  }

  // Reconstrucción de la URL destino: /api/comercial/db/<lo que venga>?qs
  // → <COMERCIAL_SB_URL>/<lo que venga>?qs. Se preserva la query string
  // tal cual (PostgREST la usa para select/filter/order).
  const sufijo = segmentos.map(encodeURIComponent).join("/");
  const destino = new URL(
    `${base.replace(/\/$/, "")}/${sufijo}${request.nextUrl.search}`
  );

  const headers = new Headers();
  for (const nombre of HEADERS_REENVIADOS) {
    const v = request.headers.get(nombre);
    if (v) headers.set(nombre, v);
  }
  // apikey pasa el gateway de Supabase (Kong). El Authorization: Bearer <JWT>
  // es lo que PostgREST usa para setear request.jwt.claims y, por lo tanto, lo
  // que las RLS leen con mi_email() y rol_efectivo().
  headers.set("apikey", apiKey);
  headers.set("Authorization", `Bearer ${firmarJwtUsuario(email, jwtSecret)}`);

  const init: RequestInit = {
    method: request.method,
    headers,
    cache: "no-store",
  };
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
