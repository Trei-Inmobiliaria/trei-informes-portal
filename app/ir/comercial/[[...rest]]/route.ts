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

// Inyección: encabezado con el logo del proyecto en cada vista. Los logos viven
// en /privado/comercial/logos/ y se sirven por /ir/comercial/logos/<slug>.png.
// El slug se calcula en el navegador a partir del display name de cada proyecto
// (lo que aparece en el <option> del dropdown): minúsculas, sin tildes, con
// guiones. Si un archivo no existe (404), el <img> se auto-remueve. Esto deja
// que el pipeline regenere informe-ventas.html todos los días sin perder los
// logos: la inyección es server-side acá, no es parte del HTML del pipeline.
const INYECCION_LOGOS = `
<style>
.logo-proyecto-wrap {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 14px 0 6px;
  margin-bottom: 10px;
}
.logo-proyecto-wrap img {
  max-height: 90px;
  max-width: 320px;
  object-fit: contain;
}
</style>
<script>
(function() {
  function slugify(s) {
    return String(s)
      .normalize('NFD').replace(/[\\u0300-\\u036f]/g, '')
      .toLowerCase().trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }
  function addLogo(tabId) {
    var el = document.getElementById('tab-' + tabId);
    if (!el) return;
    // No duplicar si ya existe (p. ej. porque el usuario cambió y volvió)
    var first = el.firstElementChild;
    if (first && first.classList && first.classList.contains('logo-proyecto-wrap')) return;
    var opt = document.querySelector('#proy-select option[value="' + tabId + '"]');
    if (!opt) return;
    var slug = slugify(opt.textContent);
    if (!slug) return;
    var wrap = document.createElement('div');
    wrap.className = 'logo-proyecto-wrap';
    var img = document.createElement('img');
    img.className = 'logo-proyecto';
    img.alt = opt.textContent;
    img.src = '/ir/comercial/logos/' + slug + '.png';
    img.onerror = function() { wrap.remove(); };
    wrap.appendChild(img);
    el.insertBefore(wrap, el.firstChild);
  }
  function hookWhenReady() {
    var wrap = document.getElementById('proy-content-wrap');
    if (!wrap) { setTimeout(hookWhenReady, 300); return; }
    var mo = new MutationObserver(function(muts) {
      muts.forEach(function(m) {
        m.addedNodes.forEach(function(n) {
          if (n.nodeType === 1 && n.id && n.id.indexOf('tab-') === 0) {
            addLogo(n.id.slice('tab-'.length));
          }
        });
      });
    });
    mo.observe(wrap, { childList: true });
    // Barrido por si ya existen cuando engancho el observer
    wrap.querySelectorAll('[id^="tab-"]').forEach(function(d) {
      addLogo(d.id.slice('tab-'.length));
    });
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', hookWhenReady);
  } else {
    hookWhenReady();
  }
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
