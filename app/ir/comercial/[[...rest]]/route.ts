import { readFile } from "fs/promises";
import path from "path";
import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/auth";
import { permisoActual } from "@/lib/accesos";

// Puente para el Informe Comercial. Hoy vive en trei.cl/informe_ventas/;
// esta ruta lo trae adentro del portal para que use el mismo login de Entra
// y el mismo Gestor de Accesos que el resto de los informes del área.
//
// El HTML y los assets viven en Supabase Storage (bucket privado): el pipeline
// diario de bbdd-planok-trei los sube ahí tras regenerar el informe. Como
// fallback (p. ej. si el bucket se cae), lee el archivo que esté versionado en
// /privado/comercial/. next.config.mjs incluye /privado en el bundle.
//
// Rutas que atiende (todas gateadas por permiso "comercial"):
//   GET /ir/comercial                            → HTML del informe
//   GET /ir/comercial/plano-raices.jpg          → asset (plano del loteo de Raíces)
//   GET /ir/comercial/escrituracion             → HTML del funnel de escrituración
//
// El HTML original consulta a /informe_ventas/db (puente que viene de trei.cl).
// Acá lo reescribimos al vuelo para que apunte a /api/comercial/db, que es la
// ruta de este mismo proyecto que firma con la service_role de Supabase.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Nombres de los archivos tal como los deja el pipeline en Supabase Storage y
// como quedarían copiados en /privado/comercial/ como fallback. Si cambia el
// nombre en el pipeline, cambiar acá también.
const ARCHIVOS = {
  informe: "informe-ventas.html",
  escrituracion: "informe-escrituracion.html",
  plano: "plano-raices.jpg",
} as const;

// Fuente privada: bucket de Supabase Storage donde el pipeline deja el informe
// regenerado cada día. Mismas variables que facturas pero con prefijo propio
// para desacoplar (p. ej. si en el futuro el bucket vive en otro proyecto).
//   COMERCIAL_FUENTE_URL   https://<ref>.supabase.co/storage/v1/object/reportes
//   COMERCIAL_FUENTE_TOKEN service_role del proyecto Supabase (secreta, server-side)
// Si no están o la lectura falla, se usa el archivo del repo como fallback.
async function leerRemoto(archivo: string): Promise<Buffer | null> {
  const base = process.env.COMERCIAL_FUENTE_URL;
  const token = process.env.COMERCIAL_FUENTE_TOKEN;
  if (!base || !token) return null;
  try {
    const r = await fetch(`${base.replace(/\/$/, "")}/${archivo}`, {
      headers: { Authorization: `Bearer ${token}`, apikey: token },
      cache: "no-store",
    });
    if (!r.ok) return null;
    const ab = await r.arrayBuffer();
    return Buffer.from(ab);
  } catch {
    return null;
  }
}

async function leerLocal(archivo: string): Promise<Buffer | null> {
  try {
    const ruta = path.join(process.cwd(), "privado", "comercial", archivo);
    return await readFile(ruta);
  } catch {
    return null;
  }
}

// Inyección: logo del proyecto activo al pie del sidebar de la pestaña Proyectos.
// Los logos viven en /privado/comercial/logos/<tab_id>.png (plp, tsm, wind,
// condell, raices, cromatico, mirador) — usamos tab_id directo porque el
// display name a veces viene con "DE" / sin "DE" / con o sin "EDIFICIO" según
// cómo lo escribieron en la DB; tab_id es estable.
// El sidebar (#proy-side) lo monta un script dentro del HTML del pipeline con
// un retraso de ~1.4s y queda vivo bajo setInterval. Un poll corto (500ms) nos
// deja apegarnos ahí sin pelear por el orden de carga: se agrega una tarjeta
// con el logo abajo de los .pitem y se actualiza cuando cambia el proyecto
// seleccionado. Estilo tomado del propio sidebar (#e1e0d9 borde, #898781 label).
const INYECCION_LOGOS = `
<style>
#proy-logo-card {
  margin: 10px 10px 6px;
  padding: 14px 6px 6px;
  border-top: 1px solid #ececea;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  min-height: 72px;
}
#proy-logo-card .proy-logo-label {
  align-self: flex-start;
  padding-left: 4px;
  font-size: 10.5px;
  letter-spacing: .07em;
  text-transform: uppercase;
  color: #898781;
  font-weight: 700;
}
#proy-logo-card img {
  max-width: 100%;
  max-height: 72px;
  object-fit: contain;
  opacity: 0;
  transition: opacity .15s ease;
}
#proy-logo-card img.ready { opacity: 1; }
</style>
<script>
(function() {
  function current() {
    var sel = document.getElementById('proy-select');
    return sel && sel.value;
  }
  function ensureCard() {
    var side = document.getElementById('proy-side');
    if (!side) return null;
    var card = document.getElementById('proy-logo-card');
    if (card) return card;
    card = document.createElement('div');
    card.id = 'proy-logo-card';
    card.innerHTML = '<div class="proy-logo-label">Proyecto</div><img alt="">';
    side.appendChild(card);
    return card;
  }
  function sync() {
    var card = ensureCard();
    if (!card) return;
    var tabId = current();
    if (!tabId) return;
    if (card.dataset.tabId === tabId) return;
    card.dataset.tabId = tabId;
    var img = card.querySelector('img');
    img.classList.remove('ready');
    img.onerror = function() { card.style.display = 'none'; };
    img.onload = function() {
      card.style.display = '';
      img.classList.add('ready');
    };
    img.src = '/ir/comercial/logos/' + tabId + '.png';
  }
  setInterval(sync, 500);
  if (document.readyState !== 'loading') sync();
  else document.addEventListener('DOMContentLoaded', sync);
})();
</script>
`;

// Reescribe las URLs internas del HTML original para que apunten a este portal:
//   /informe_ventas/db   → /api/comercial/db   (puente a Supabase REST)
//   plano-raices.jpg     → /ir/comercial/plano-raices.jpg
// Además inyecta INYECCION_LOGOS antes de </body> para pintar el logo de cada
// proyecto en su vista. El HTML del repo bbdd-planok-trei no sabe que ahora
// está en el portal; en vez de pedirle al pipeline que lo adapte, lo hacemos
// al vuelo. Es un string replace sobre ~530 KB: tiempo despreciable.
function reescribirHtml(bytes: Buffer): string {
  return bytes
    .toString("utf-8")
    .replace("'/informe_ventas/db'", "'/api/comercial/db'")
    .replace("'plano-raices.jpg'", "'/ir/comercial/plano-raices.jpg'")
    .replace("</body>", INYECCION_LOGOS + "</body>");
}

function noDisponible(mensaje: string): NextResponse {
  return new NextResponse(
    `<h1>Informe no disponible</h1><p>${mensaje}</p>`,
    { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } }
  );
}

export async function GET(
  request: NextRequest,
  { params }: { params: { rest?: string[] } }
) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  const permiso = await permisoActual(email);
  if (!permiso.informes.includes("comercial")) {
    return NextResponse.redirect(new URL("/?error=sin-permiso", request.url));
  }

  const subruta = (params.rest ?? []).join("/");

  // Assets: logos de los proyectos. Son estáticos y viven versionados en
  // /privado/comercial/logos/<slug>.png. No vienen del pipeline, así que sólo
  // se leen del repo (nada de Supabase). El JS inyectado por reescribirHtml
  // los pide por este path con el slug del display name.
  if (subruta.startsWith("logos/") && subruta.endsWith(".png")) {
    const nombre = subruta.slice("logos/".length);
    if (nombre.includes("/") || nombre.includes("..") || !nombre) {
      return new NextResponse("No encontrado", { status: 404 });
    }
    const bytes = await leerLocal(path.join("logos", nombre));
    if (!bytes) {
      return new NextResponse("Logo no encontrado", { status: 404 });
    }
    return new NextResponse(bytes, {
      status: 200,
      headers: {
        "Content-Type": "image/png",
        // Los logos cambian muy rara vez; cache corto pero útil.
        "Cache-Control": "private, max-age=3600",
      },
    });
  }

  // Asset: plano del loteo de Raíces. Es el único asset binario que usa el
  // informe. Sirve de Supabase Storage; si no está, cae al archivo del repo.
  if (subruta === ARCHIVOS.plano) {
    const bytes =
      (await leerRemoto(ARCHIVOS.plano)) ?? (await leerLocal(ARCHIVOS.plano));
    if (!bytes) {
      return noDisponible(
        "El plano de Raíces aún no está publicado. Avisa a Control de Gestión."
      );
    }
    return new NextResponse(bytes, {
      status: 200,
      headers: {
        "Content-Type": "image/jpeg",
        // Es el mismo plano día a día, pero cada visita pasa por el gate de
        // permiso, así que no cacheable en edge/intermediarios.
        "Cache-Control": "private, no-store",
      },
    });
  }

  // Funnel de escrituración (sub-informe). Vive al lado del principal.
  if (subruta === "escrituracion" || subruta === "escrituracion/") {
    const bytes =
      (await leerRemoto(ARCHIVOS.escrituracion)) ??
      (await leerLocal(ARCHIVOS.escrituracion));
    if (!bytes) {
      return noDisponible(
        "El funnel de escrituración aún no está publicado. Avisa a Control de Gestión."
      );
    }
    return new NextResponse(reescribirHtml(bytes), {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "private, no-store",
      },
    });
  }

  // Default: informe comercial principal (acepta "" y "/" por si acaso).
  if (subruta === "" || subruta === "/") {
    const bytes =
      (await leerRemoto(ARCHIVOS.informe)) ?? (await leerLocal(ARCHIVOS.informe));
    if (!bytes) {
      return noDisponible(
        "El informe comercial aún no está publicado. Avisa a Control de Gestión."
      );
    }
    return new NextResponse(reescribirHtml(bytes), {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "private, no-store",
      },
    });
  }

  return new NextResponse("No encontrado", { status: 404 });
}
