import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/auth";
import {
  EMAIL_RE,
  LOG_LIMITE,
  SUPER_ADMINS,
  diferencias,
  guardarAccesos,
  leerAccesos,
  normalizar,
  permisoDe,
  puedeEscribir,
} from "@/lib/accesos";
import { informesPermitidos, recortarInformes } from "@/lib/informes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function admin() {
  const session = await auth();
  const email = session?.user?.email?.toLowerCase() || "";
  const { accesos, origen } = await leerAccesos({ fresco: true });
  return { email, accesos, origen, ok: permisoDe(accesos, email).admin };
}

export async function GET() {
  const a = await admin();
  if (!a.ok) return NextResponse.json({ error: "Solo administradores" }, { status: 403 });
  return NextResponse.json({
    accesos: a.accesos,
    origen: a.origen,
    escribible: puedeEscribir(),
    superAdmins: SUPER_ADMINS,
  });
}

// Guarda la lista completa. `base` es el `actualizado` que el cliente leyó:
// si otro admin guardó entremedio, se rechaza (409) en vez de pisarlo.
export async function PUT(request: NextRequest) {
  const a = await admin();
  if (!a.ok) return NextResponse.json({ error: "Solo administradores" }, { status: 403 });
  if (!puedeEscribir())
    return NextResponse.json(
      { error: "Edge Config no está conectado (faltan EDGE_CONFIG / VERCEL_API_TOKEN)." },
      { status: 503 }
    );

  const body = await request.json().catch(() => null);
  if (!body || !Array.isArray(body.usuarios))
    return NextResponse.json({ error: "Solicitud inválida" }, { status: 400 });
  if (body.base !== a.accesos.actualizado)
    return NextResponse.json(
      { error: "Otra persona guardó cambios mientras editabas. Recarga para ver la versión nueva." },
      { status: 409 }
    );

  const nuevos = normalizar({ usuarios: body.usuarios }).usuarios;
  const vistos = new Set<string>();
  for (const u of nuevos) {
    if (!EMAIL_RE.test(u.email))
      return NextResponse.json({ error: `Correo inválido: ${u.email}` }, { status: 400 });
    if (vistos.has(u.email))
      return NextResponse.json({ error: `Correo repetido: ${u.email}` }, { status: 400 });
    vistos.add(u.email);
    // Los super-admins (ADMIN_EMAILS) no se pueden degradar ni suspender.
    if (SUPER_ADMINS.includes(u.email)) {
      u.rol = "admin";
      u.activo = true;
    }
    // Dominios restringidos (razo.cl): solo sus informes fijos, nunca admin.
    if (informesPermitidos(u.email)) {
      u.rol = "usuario";
      u.informes = recortarInformes(u.email, u.informes);
    }
  }
  const yo = nuevos.find((u) => u.email === a.email);
  if (!SUPER_ADMINS.includes(a.email) && (!yo || !yo.activo || yo.rol !== "admin"))
    return NextResponse.json(
      { error: "No puedes quitarte a ti mismo el acceso de administrador." },
      { status: 400 }
    );

  const eventos = diferencias(a.accesos.usuarios, nuevos, a.email);
  const ahora = new Date().toISOString();
  const tocados = new Set(eventos.map((e) => e.email));
  for (const u of nuevos) {
    const previo = a.accesos.usuarios.find((x) => x.email === u.email);
    if (tocados.has(u.email)) {
      u.actualizado = ahora;
      u.actualizadoPor = a.email;
    } else if (previo) {
      u.actualizado = previo.actualizado;
      u.actualizadoPor = previo.actualizadoPor;
    }
  }

  const valor = {
    version: a.accesos.version + 1,
    actualizado: ahora,
    usuarios: nuevos.sort((x, y) => x.email.localeCompare(y.email)),
    log: [...eventos.reverse(), ...a.accesos.log].slice(0, LOG_LIMITE),
  };

  try {
    await guardarAccesos(valor);
  } catch (e: any) {
    console.error("[accesos] escritura falló:", e);
    return NextResponse.json(
      { error: `No se pudo guardar en Edge Config. ${e?.message || ""}`.trim() },
      { status: 502 }
    );
  }
  return NextResponse.json({ accesos: valor, origen: "edge-config", cambios: eventos.length });
}
