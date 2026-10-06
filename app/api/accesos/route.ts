import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/auth";
import {
  DOMINIO_RE,
  EMAIL_RE,
  LOG_LIMITE,
  SUPER_ADMINS,
  diferencias,
  diferenciasDominios,
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

  // Dominios: si el cliente no los manda (versión anterior de la página), se
  // conservan los guardados en vez de borrarlos.
  const dominios = Array.isArray(body.dominios)
    ? normalizar({ dominios: body.dominios }).dominios
    : a.accesos.dominios.map((d) => ({ ...d }));
  if (Array.isArray(body.dominios)) {
    const crudos = body.dominios.length;
    if (dominios.length !== crudos)
      return NextResponse.json({ error: "Hay un dominio inválido (ej. válido: razo.cl)." }, { status: 400 });
  }
  const vistosDom = new Set<string>();
  for (const d of dominios) {
    if (!DOMINIO_RE.test(d.dominio))
      return NextResponse.json({ error: `Dominio inválido: ${d.dominio}` }, { status: 400 });
    if (vistosDom.has(d.dominio))
      return NextResponse.json({ error: `Dominio repetido: ${d.dominio}` }, { status: 400 });
    vistosDom.add(d.dominio);
    // Dominios restringidos (razo.cl): solo sus informes fijos.
    d.informes = recortarInformes("x@" + d.dominio, d.informes);
  }

  const eventos = [
    ...diferencias(a.accesos.usuarios, nuevos, a.email),
    ...diferenciasDominios(a.accesos.dominios, dominios, a.email),
  ];
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

  for (const d of dominios) {
    const previo = a.accesos.dominios.find((x) => x.dominio === d.dominio);
    if (tocados.has("@" + d.dominio)) {
      d.actualizado = ahora;
      d.actualizadoPor = a.email;
    } else if (previo) {
      d.actualizado = previo.actualizado;
      d.actualizadoPor = previo.actualizadoPor;
    }
  }

  const valor = {
    version: a.accesos.version + 1,
    actualizado: ahora,
    usuarios: nuevos.sort((x, y) => x.email.localeCompare(y.email)),
    dominios: dominios.sort((x, y) => x.dominio.localeCompare(y.dominio)),
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
