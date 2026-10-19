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

// Inyección del portal. Se agrega server-side antes de </body> y sobrevive al
// refresh diario del pipeline (que nunca sabe que está dentro del portal).
// Contiene tres bloques, todos derivados del Manual de Marca interno:
//   A. Overrides de CSS (brand-alignment: corrige activo-azul → activo-rojo
//      en nav nivel 2 y 3, y pule topbar, tabs, KPI y ritmo vertical).
//   B. Logo del proyecto activo al pie del sidebar #proy-side (poll 500ms
//      porque el sidebar lo monta el HTML del pipeline con ~1.4s de retraso).
//   C. Botón flotante "¿Consulta?" → popover → mailto a Control de Gestión.
// Logos: /privado/comercial/logos/<tab_id>.png — tab_id (plp, tsm, wind,
// condell, raices, cromatico, mirador) es estable; el display name varía.
const INYECCION_LOGOS = `
<style>
/* ============================================================
   BLOQUE A · OVERRIDES DE MARCA
   Base: Manual de Marca interno §1-§11. Las referencias [M§X]
   dejan ver qué sección respalda cada ajuste.
   ============================================================ */

/* --- Topbar (más presencia, mismo lenguaje) --- */
.top-header { padding: 10px 32px !important; }
.top-header .brand { gap: 14px !important; }
.top-header .brand img { height: 28px !important; }
.top-header h1 { font-size: 13.5px !important; letter-spacing: 0.6px !important; } /* [M§1] */
.top-header .meta { font-size: 10.5px !important; line-height: 1.5 !important; }

/* --- Nivel 1 — Tabs superiores (más respirados) [M§7] --- */
.tabs { padding: 0 20px !important; }
.tab { padding: 11px 22px !important; font-size: 11px !important; letter-spacing: 1.2px !important; }
.tab:hover { background: transparent !important; }

/* --- Sidebar de proyectos: activo en ROJO TREI [M§7, §11-①] --- */
/* Antes: fondo azul #cde2fb + borde #2a78d6 + texto #184f95 — violaba
   la regla "activo = rojo Trei" en ambos niveles de navegación. */
#proy-side { border: 1.5px solid #e4e4e8 !important; }
.pitem { padding: 10px 14px !important; font-size: 12.5px !important; font-weight: 400 !important; color: #333 !important; }
.pitem.on {
  background: #fff5f7 !important;
  border-left-color: #E1093F !important;
  color: #E1093F !important;
  font-weight: 500 !important;
}

/* --- Categorías del proyecto (Ventas Totales / Detalle / ...) [M§7] --- */
/* Mismo arreglo de marca que el sidebar. */
.pcats { border-bottom: 1.5px solid #e4e4e8 !important; }
.pcat { padding: 10px 18px !important; font-size: 12.5px !important; font-weight: 500 !important; color: #888 !important; border-bottom: 3px solid transparent !important; margin-bottom: -1.5px !important; }
.pcat:hover { color: #111 !important; }
.pcat.on { color: #E1093F !important; border-bottom-color: #E1093F !important; }

/* --- KPI de proyecto: franja de color 4px + border 1.5px [M§5] --- */
/* El actual tenía border 0.5px y sin franja — faltaban dos reglas del manual. */
.proy-kpi-row { gap: 12px !important; margin-bottom: 24px !important; }
.proy-kpi {
  position: relative !important;
  border: 1.5px solid #e4e4e8 !important;
  padding: 16px 18px !important;
  overflow: hidden !important;
}
.proy-kpi::before {
  content: '' !important;
  position: absolute !important;
  left: 0 !important; top: 0 !important; bottom: 0 !important;
  width: 4px !important;
  background: #111111;
}
.proy-kpi.c-red::before   { background: #E1093F !important; }
.proy-kpi.c-green::before { background: #006400 !important; }
.proy-kpi.c-gray::before  { background: #D9D9D9 !important; }
.proy-kpi.c-navy::before  { background: #111111 !important; }
.proy-kpi-label { font-size: 10px !important; font-weight: 700 !important; letter-spacing: 0.8px !important; margin-bottom: 6px !important; }
.proy-kpi-value { font-size: 24px !important; }
.proy-kpi-sub { margin-top: 6px !important; }

/* ============================================================
   BLOQUE B · LOGO DEL PROYECTO ACTIVO (sidebar)
   ============================================================ */
#proy-logo-card {
  margin: 12px 10px 10px;
  padding: 14px 6px 10px;
  border-top: 1px solid #ececea;
  display: flex; flex-direction: column; align-items: center; gap: 10px;
  min-height: 120px;
}
#proy-logo-card .proy-logo-label {
  align-self: flex-start; padding-left: 4px;
  font-size: 10.5px; letter-spacing: .07em; text-transform: uppercase;
  color: #898781; font-weight: 700;
}
#proy-logo-card img {
  max-width: 100%; max-height: 120px; object-fit: contain;
  opacity: 0; transition: opacity .15s ease;
}
#proy-logo-card img.ready { opacity: 1; }

/* ============================================================
   BLOQUE C · BOTÓN FLOTANTE DE FEEDBACK (consultas al CdG)
   ============================================================ */
#cdg-fab {
  position: fixed; right: 24px; bottom: 24px; z-index: 9999;
  width: 48px; height: 48px; border-radius: 50%;
  background: #E1093F;                                 /* [M§2] rojo Trei para CTA */
  border: none; cursor: pointer;
  box-shadow: 0 4px 14px rgba(225, 9, 63, 0.28), 0 2px 4px rgba(0,0,0,0.12);
  color: #fff;
  display: flex; align-items: center; justify-content: center;
  transition: transform .12s ease, box-shadow .12s ease;
  font-family: 'Ubuntu', Calibri, sans-serif;
}
#cdg-fab:hover { transform: translateY(-1px); box-shadow: 0 6px 18px rgba(225, 9, 63, 0.34), 0 2px 4px rgba(0,0,0,0.12); }
#cdg-fab svg { width: 22px; height: 22px; }

#cdg-popover {
  position: fixed; right: 24px; bottom: 84px; z-index: 9999;
  width: 320px;
  background: #fff;
  border: 1.5px solid #e4e4e8; border-radius: 10px;   /* [M§9] contenedor estándar */
  box-shadow: 0 10px 32px rgba(0,0,0,0.14), 0 2px 6px rgba(0,0,0,0.06);
  padding: 16px 18px 14px;
  font-family: 'Ubuntu', Calibri, sans-serif;
  display: none;
}
#cdg-popover.open { display: block; }
#cdg-popover .head {
  display: flex; align-items: center; justify-content: space-between;
  margin-bottom: 10px;
}
#cdg-popover .head h4 {
  font-size: 11px; font-weight: 700; letter-spacing: 0.8px;
  text-transform: uppercase; color: #111; margin: 0;
}
#cdg-popover .head button {
  background: none; border: none; cursor: pointer;
  color: #888; font-size: 18px; line-height: 1;
  padding: 2px 6px;
}
#cdg-popover .head button:hover { color: #111; }
#cdg-popover p.lead {
  font-size: 12px; color: #666; margin-bottom: 10px;
}
#cdg-popover textarea {
  width: 100%; min-height: 100px; max-height: 220px;
  padding: 10px 12px;
  font-family: 'Ubuntu', Calibri, sans-serif;
  font-size: 12.5px; color: #111;
  border: 1.5px solid #e4e4e8; border-radius: 6px;
  resize: vertical; outline: none;
  transition: border-color .12s;
}
#cdg-popover textarea:focus { border-color: #E1093F; }
#cdg-popover .act {
  display: flex; justify-content: space-between; align-items: center;
  margin-top: 10px; gap: 10px;
}
#cdg-popover .act .dest {
  font-size: 10.5px; color: #888;
  letter-spacing: 0.3px;
}
#cdg-popover .act .dest strong { color: #555; font-weight: 500; }
#cdg-popover .act button.send {
  background: #E1093F; color: #fff;
  border: none; border-radius: 6px;                   /* [M§10] botones radio 6px */
  padding: 8px 14px;
  font-family: 'Ubuntu', Calibri, sans-serif;
  font-size: 11px; font-weight: 700;
  letter-spacing: 0.6px; text-transform: uppercase;
  cursor: pointer;
  transition: background .12s;
}
#cdg-popover .act button.send:hover { background: #c00030; }
#cdg-popover .act button.send:disabled { background: #e5a4b6; cursor: not-allowed; }
</style>
<script>
(function() {
  // ========================================================
  // Logo del proyecto activo al pie del sidebar
  // ========================================================
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
    img.onload = function() { card.style.display = ''; img.classList.add('ready'); };
    img.src = '/ir/comercial/logos/' + tabId + '.png';
  }
  setInterval(sync, 500);
  if (document.readyState !== 'loading') sync();
  else document.addEventListener('DOMContentLoaded', sync);

  // ========================================================
  // Botón flotante de feedback (consultas al CdG)
  // ========================================================
  // Mailto: abre el cliente de correo del usuario con el mensaje
  // pre-cargado. Sin backend, sin API keys, sin dependencias de
  // red extras. El usuario revisa y envía desde su cliente.
  var DEST = 'smendez@trei.cl';

  function montarFab() {
    if (document.getElementById('cdg-fab')) return;

    var fab = document.createElement('button');
    fab.id = 'cdg-fab';
    fab.type = 'button';
    fab.title = '¿Consulta o problema con el informe?';
    fab.setAttribute('aria-label', 'Enviar consulta sobre el informe');
    // Icono: burbuja de mensaje con signo "?"
    fab.innerHTML = '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">' +
      '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v9A2.5 2.5 0 0 1 17.5 17H9l-5 4V5.5z" ' +
      'stroke="#fff" stroke-width="1.8" stroke-linejoin="round" fill="none"/>' +
      '<path d="M10 8.3c0-1.1.9-2 2-2s2 .9 2 2c0 .9-.6 1.3-1.2 1.7-.5.4-.8.7-.8 1.3M12 13.5v.01" ' +
      'stroke="#fff" stroke-width="1.8" stroke-linecap="round" fill="none"/>' +
      '</svg>';
    document.body.appendChild(fab);

    var pop = document.createElement('div');
    pop.id = 'cdg-popover';
    pop.setAttribute('role', 'dialog');
    pop.setAttribute('aria-label', 'Enviar consulta sobre el informe');
    pop.innerHTML =
      '<div class="head">' +
        '<h4>¿Consulta o problema?</h4>' +
        '<button type="button" aria-label="Cerrar" data-cdg-close>×</button>' +
      '</div>' +
      '<p class="lead">Dinos qué viste raro o qué te gustaría agregar. Llega directo a Control de Gestión.</p>' +
      '<textarea placeholder="Describe la consulta o el problema…" aria-label="Mensaje"></textarea>' +
      '<div class="act">' +
        '<div class="dest">Para <strong>' + DEST + '</strong></div>' +
        '<button type="button" class="send">Enviar</button>' +
      '</div>';
    document.body.appendChild(pop);

    var textarea = pop.querySelector('textarea');
    var sendBtn  = pop.querySelector('button.send');
    var closeBtn = pop.querySelector('[data-cdg-close]');

    function abrir() {
      pop.classList.add('open');
      setTimeout(function(){ textarea.focus(); }, 50);
    }
    function cerrar() { pop.classList.remove('open'); }

    fab.addEventListener('click', function() {
      pop.classList.contains('open') ? cerrar() : abrir();
    });
    closeBtn.addEventListener('click', cerrar);

    // Cerrar con Esc o click fuera
    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape' && pop.classList.contains('open')) cerrar();
    });
    document.addEventListener('click', function(e) {
      if (!pop.classList.contains('open')) return;
      if (pop.contains(e.target) || fab.contains(e.target)) return;
      cerrar();
    });

    sendBtn.addEventListener('click', function() {
      var msg = (textarea.value || '').trim();
      if (!msg) { textarea.focus(); return; }
      // Contexto que viaja en el cuerpo del mail: ayuda al CdG a reproducir.
      var sel = document.getElementById('proy-select');
      var proy = sel && sel.options[sel.selectedIndex] ? sel.options[sel.selectedIndex].text : '—';
      var activa = document.querySelector('.tab.active');
      var pestana = activa ? activa.textContent.trim() : '—';
      var hoy = new Date().toLocaleString('es-CL', { timeZone: 'America/Santiago' });

      var cuerpo =
        msg + '\\n\\n' +
        '— — —\\n' +
        'Contexto automático\\n' +
        'Pestaña: ' + pestana + '\\n' +
        'Proyecto activo: ' + proy + '\\n' +
        'Fecha/hora: ' + hoy + '\\n' +
        'URL: ' + window.location.href;

      var asunto = 'Consulta sobre Informe Comercial';
      var mailto = 'mailto:' + DEST +
                   '?subject=' + encodeURIComponent(asunto) +
                   '&body=' + encodeURIComponent(cuerpo);
      // Algunos clientes limitan la URL a ~2000 chars. Si pasa, truncamos el cuerpo.
      if (mailto.length > 1900) {
        mailto = 'mailto:' + DEST +
                 '?subject=' + encodeURIComponent(asunto) +
                 '&body=' + encodeURIComponent(msg.slice(0, 800) + '\\n\\n[truncado]');
      }
      window.location.href = mailto;
      textarea.value = '';
      cerrar();
    });
  }

  if (document.readyState !== 'loading') montarFab();
  else document.addEventListener('DOMContentLoaded', montarFab);
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
