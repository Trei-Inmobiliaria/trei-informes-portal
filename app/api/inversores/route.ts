import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/auth";
import {
  EMAIL_RE,
  LOG_LIMITE,
  SUPER_ADMINS,
  diferencias,
  guardarAccesos,
  leerAccesos,
  permisoDe,
  puedeEscribir,
  type Usuario,
} from "@/lib/accesos";
import { informesPermitidos } from "@/lib/informes";
import { rpc } from "@/lib/comercial-sb";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Gestión de inversores desde /accesos. Dos almacenes, un solo gesto:
//   1) Supabase (informe_usuario + informe_usuario_proyecto): rol `inversor` y
//      los proyectos que puede ver. Lo escribe inversor_guardar(), que exige
//      rol admin en la base. El filtro por proyecto se hace allá, no aquí.
//   2) Edge Config del portal: la fila con el informe `inversores`, que es lo
//      que le abre la puerta a trei-informes.app.
// El inversor nunca recibe el informe `comercial` completo.

const ERRORES: Record<string, [number, string]> = {
  "solo-admin": [403, "Tu usuario no es administrador en la base del Informe Comercial."],
  "sin-proyectos": [400, "Asigna al menos un proyecto."],
  "correo-invalido": [400, "Correo inválido."],
  "ya-es-usuario-interno": [409, "Ese correo ya es un usuario interno. Gestiónalo en la tabla de arriba."],
  "puente-no-configurado": [500, "Faltan variables COMERCIAL_SB_* en este deploy."],
};

const mensajeError = (e: string): [number, string] =>
  ERRORES[e] ?? [502, `No se pudo completar: ${e}`];

async function admin() {
  const session = await auth();
  const email = session?.user?.email?.toLowerCase() || "";
  const { accesos } = await leerAccesos({ fresco: true });
  return { email, accesos, ok: permisoDe(accesos, email).admin };
}

type ListaDb = {
  proyectos: { proyecto: string; nombre: string }[];
  inversores: {
    email: string;
    nombre: string | null;
    empresa: string | null;
    activo: boolean;
    vence_at: string | null;
    editado_at: string | null;
    editado_por: string | null;
    proyectos: string[];
  }[];
};

export async function GET() {
  const a = await admin();
  if (!a.ok) return NextResponse.json({ error: "Solo administradores" }, { status: 403 });
  const r = await rpc<ListaDb>(a.email, "inversor_listar");
  if (!r.ok) {
    const [status, error] = mensajeError(r.error || "");
    return NextResponse.json({ error }, { status });
  }
  const enPortal = new Set(
    a.accesos.usuarios.filter((u) => u.activo && u.informes.includes("inversores")).map((u) => u.email)
  );
  return NextResponse.json({
    proyectos: r.data!.proyectos,
    inversores: r.data!.inversores.map((i) => ({ ...i, enPortal: enPortal.has(i.email) })),
    escribible: puedeEscribir(),
  });
}

// Crea o actualiza un inversor (alta, cambio de proyectos, vencimiento, suspensión).
export async function PUT(request: NextRequest) {
  const a = await admin();
  if (!a.ok) return NextResponse.json({ error: "Solo administradores" }, { status: 403 });
  if (!puedeEscribir())
    return NextResponse.json(
      { error: "Edge Config no está conectado (faltan EDGE_CONFIG / VERCEL_API_TOKEN)." },
      { status: 503 }
    );

  const b = await request.json().catch(() => null);
  const email = String(b?.email || "").trim().toLowerCase();
  const nombre = String(b?.nombre || "").trim().slice(0, 80);
  const empresa = String(b?.empresa || "").trim().slice(0, 80);
  const activo = b?.activo !== false;
  const proyectos: string[] = Array.isArray(b?.proyectos) ? b.proyectos.map(String) : [];
  const vence: string | null = b?.vence ? String(b.vence) : null;

  if (!EMAIL_RE.test(email)) return NextResponse.json({ error: "Correo inválido." }, { status: 400 });
  if (vence && !/^\d{4}-\d{2}-\d{2}$/.test(vence))
    return NextResponse.json({ error: "Fecha de vencimiento inválida." }, { status: 400 });
  if (SUPER_ADMINS.includes(email))
    return NextResponse.json({ error: "Ese correo es administrador del portal." }, { status: 409 });
  if (informesPermitidos(email))
    return NextResponse.json(
      { error: "Ese dominio está restringido a otro informe y no admite acceso de inversor." },
      { status: 409 }
    );

  const previo = a.accesos.usuarios.find((u) => u.email === email);
  if (previo && (previo.rol === "admin" || previo.informes.some((i) => i !== "inversores")))
    return NextResponse.json(
      { error: "Ese correo ya es un usuario interno. Gestiónalo en la tabla de arriba." },
      { status: 409 }
    );

  // 1) Base: rol inversor + proyectos. Aquí se valida todo lo demás.
  const g = await rpc(a.email, "inversor_guardar", {
    p_email: email,
    p_nombre: nombre,
    p_empresa: empresa,
    p_proyectos: proyectos,
    p_vence: vence ? `${vence}T23:59:59-03:00` : null,
    p_activo: activo,
  });
  if (!g.ok) {
    const [status, error] = mensajeError(g.error || "");
    return NextResponse.json({ error }, { status });
  }

  // 2) Portal: fila con el informe `inversores` y nada más.
  const ahora = new Date().toISOString();
  const fila: Usuario = {
    email,
    nombre: nombre || undefined,
    rol: "usuario",
    activo,
    informes: ["inversores"],
    actualizado: ahora,
    actualizadoPor: a.email,
  };
  const usuarios = [...a.accesos.usuarios.filter((u) => u.email !== email), fila].sort((x, y) =>
    x.email.localeCompare(y.email)
  );
  const eventos = diferencias(a.accesos.usuarios, usuarios, a.email);
  try {
    await guardarAccesos({
      version: a.accesos.version + 1,
      actualizado: ahora,
      usuarios,
      dominios: a.accesos.dominios,
      log: [...eventos.reverse(), ...a.accesos.log].slice(0, LOG_LIMITE),
    });
  } catch (e: any) {
    console.error("[inversores] Edge Config falló:", e);
    return NextResponse.json(
      {
        error:
          "Se guardó en la base, pero no se pudo abrir la puerta en el portal. Vuelve a guardar. " +
          (e?.message || ""),
      },
      { status: 502 }
    );
  }
  return NextResponse.json({ ok: true, email, proyectos: (g.data as any)?.proyectos ?? [] });
}
