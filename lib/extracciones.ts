// ─────────────────────────────────────────────────────────────────────────────
// Monitor de extracciones — 4 proyectos Supabase de producción.
//
// Esta pestaña cierra el hallazgo del "Estado del Arte GitHub-Supabase" (jul-2026):
// "Sin observabilidad: no hay alertas configuradas ante un fallo del workflow —
//  el único rastro queda en el log de GitHub Actions."
//
// Cada proyecto expone su propia bitácora. El monitor hace UN fetch REST por
// pipeline, interpreta el estado y, si algo está caído o atrasado, dispara un
// correo. Nunca escribe en los proyectos. Las keys viajan solo en el servidor.
//
// Env vars (Vercel → Portal → Settings → Environment Variables):
//   # Proyecto 1 — Bases Comerciales PlanOK (ya existe COMERCIAL_SB_URL, se
//   # reusa aquí para no duplicar). La service key se agrega solo para este
//   # monitor; nunca se expone al cliente.
//   COMERCIAL_SB_URL
//   COMERCIAL_SB_SERVICE_KEY
//
//   # Proyecto 2 — BBDD IConstruye
//   ICONSTRUYE_SB_URL
//   ICONSTRUYE_SB_SERVICE_KEY
//
//   # Proyecto 3 — Contabilidad - Finanzas (dos pipelines dentro)
//   CONTABILIDAD_SB_URL
//   CONTABILIDAD_SB_SERVICE_KEY
//
//   # Proyecto 4 — Workflow Desistimientos
//   DESIST_SB_URL
//   DESIST_SB_SERVICE_KEY
//
//   # Para el envío de correo
//   RESEND_API_KEY
//   ALERTAS_FROM            — ej. "Portal Trei <alertas@trei.cl>"
//   ALERTAS_TO              — destinatarios separados por coma
//
// ─────────────────────────────────────────────────────────────────────────────

export type EstadoExtraccion = "ok" | "atrasado" | "falla" | "sin-datos";

export type Corrida = {
  // Marca de tiempo ISO de la última corrida relevante del pipeline.
  ts: string | null;
  estado: EstadoExtraccion;
  // Lo que mostramos en la UI y en el correo (ej. "ventas_pok: 175.736 filas").
  resumen: string;
  // Texto crudo del error cuando el estado es "falla".
  error?: string | null;
};

export type EstadoProyecto = {
  id: string;
  nombre: string;
  // Nombre del proyecto en Supabase (para el link al dashboard).
  ref: string;
  // Agrupación visual.
  area: "Comercial" | "Contabilidad" | "IConstruye" | "Legal";
  // Semáforo global del proyecto.
  estado: EstadoExtraccion;
  // Último evento, para el resumen y la frescura.
  ultima: Corrida;
  // Las últimas N corridas para el timeline.
  historial: Corrida[];
  // Diagnóstico y "cómo arreglarlo" cuando no está OK (se usa en la UI y el correo).
  diagnostico?: Diagnostico;
};

export type Diagnostico = {
  titulo: string;
  causas: string[];
  pasos: string[];
};

// ─── Configuración de los 4 proyectos ───────────────────────────────────────
// `maxHorasSinCorrida` define el umbral de "atrasado". Lo elegimos holgado para
// no gatillar falsos positivos los fines de semana (los pipelines corren L-V).

type Config = {
  id: string;
  nombre: string;
  ref: string;
  area: EstadoProyecto["area"];
  // Clave de la env var con la URL del proyecto Supabase (sin /rest/v1 al final).
  envUrl: string;
  // Clave de la env var con la service_role key.
  envKey: string;
  // Función que lee la bitácora y devuelve historial normalizado.
  leer: (url: string, key: string) => Promise<Corrida[]>;
  maxHorasSinCorrida: number;
  // Hint reutilizable si no hay nada en la bitácora.
  diagnosticoSinDatos: Diagnostico;
};

// ─── 1. Bases Comerciales PlanOK ────────────────────────────────────────────
// Tabla public.carga_log: una fila por tabla y corrida. Un día bueno tiene ~6
// filas (ventas_pok, secundarios, canceladas, leads, cotizaciones, reservas),
// todas con estado=ok.
async function leerComercial(url: string, key: string): Promise<Corrida[]> {
  const r = await fetchRest(
    `${url}/rest/v1/carga_log?select=tabla,estado,ejecutado_en,detalle&order=ejecutado_en.desc&limit=20`,
    key
  );
  return r.map((f: any) => ({
    ts: f.ejecutado_en,
    estado:
      String(f.estado).toLowerCase() === "ok"
        ? "ok"
        : String(f.estado).toLowerCase().includes("error")
        ? "falla"
        : "falla",
    resumen: `${f.tabla}${f.detalle ? ` — ${f.detalle}` : ""}`,
    error: String(f.estado).toLowerCase() === "ok" ? null : f.detalle || f.estado,
  }));
}

// ─── 2. BBDD IConstruye ─────────────────────────────────────────────────────
// Tabla iconstruye_meta.carga_log: una fila por snapshot. Un día bueno tiene
// una sola fila con estado=OK y ~69 tablas.
async function leerIConstruye(url: string, key: string): Promise<Corrida[]> {
  const r = await fetchRest(
    `${url}/rest/v1/carga_log?select=snapshot_date,estado,tablas,filas,duracion_seg,error,ts&order=ts.desc&limit=10`,
    key,
    { "Accept-Profile": "iconstruye_meta" }
  );
  return r.map((f: any) => ({
    ts: f.ts,
    estado: String(f.estado).toUpperCase() === "OK" ? "ok" : "falla",
    resumen: `snapshot ${f.snapshot_date}: ${
      f.tablas ?? "?"
    } tablas, ${Number(f.filas || 0).toLocaleString("es-CL")} filas, ${
      f.duracion_seg ? `${Math.round(f.duracion_seg)}s` : "¿?"
    }`,
    error: f.error || null,
  }));
}

// ─── 3. Contabilidad - Finanzas ─────────────────────────────────────────────
// Dos pipelines distintos conviven: sii.cargas (facturas SII, mensual) y
// public.g_pc_cargas (balance / plan de cuentas, mensual). Pedimos los últimos
// de ambos y los mezclamos; el "estado" global combina ambos.
async function leerContabilidad(url: string, key: string): Promise<Corrida[]> {
  const [sii, pc] = await Promise.all([
    fetchRest(
      `${url}/rest/v1/cargas?select=periodo,tipo,variante,estado,filas,cargado_en&order=cargado_en.desc&limit=10`,
      key,
      { "Accept-Profile": "sii" }
    ).catch(() => []),
    fetchRest(
      `${url}/rest/v1/g_pc_cargas?select=empresa,tipo,periodo,filas,cargado_en&order=cargado_en.desc&limit=10`,
      key
    ).catch(() => []),
  ]);

  const corridasSii: Corrida[] = sii.map((f: any) => {
    const estado =
      !f.estado || String(f.estado).toLowerCase() === "ok" ? "ok" : "falla";
    return {
      ts: f.cargado_en,
      estado,
      resumen: `SII ${f.tipo}/${f.variante} ${f.periodo}: ${
        Number(f.filas || 0).toLocaleString("es-CL")
      } filas`,
      error: estado === "ok" ? null : String(f.estado),
    } satisfies Corrida;
  });
  const corridasPc: Corrida[] = pc.map((f: any) => ({
    ts: f.cargado_en,
    estado: "ok" as const, // esta tabla solo registra cargas exitosas
    resumen: `Plan Cuentas ${f.empresa}/${f.tipo} ${f.periodo}: ${
      Number(f.filas || 0).toLocaleString("es-CL")
    } filas`,
    error: null,
  }));
  return [...corridasSii, ...corridasPc].sort((a, b) =>
    (b.ts || "").localeCompare(a.ts || "")
  );
}

// ─── 4. Workflow Desistimientos ─────────────────────────────────────────────
// No tiene bitácora propia (es un workflow operacional, no ETL). Usamos como
// heartbeat la fecha del último case_events. Si no hay movimientos en el
// umbral, la etiqueta se queda en "atrasado" (nunca "falla").
async function leerDesistimientos(url: string, key: string): Promise<Corrida[]> {
  const r = await fetchRest(
    `${url}/rest/v1/case_events?select=id,case_id,kind,created_at&order=created_at.desc&limit=5`,
    key
  );
  return r.map((f: any) => ({
    ts: f.created_at,
    estado: "ok" as const,
    resumen: `evento #${f.id} (${f.kind || "sin tipo"}) sobre caso ${f.case_id}`,
    error: null,
  }));
}

const CONFIG: Config[] = [
  {
    id: "comercial",
    nombre: "Bases Comerciales PlanOK",
    ref: "owhlpaypipgkihgubvfl",
    area: "Comercial",
    envUrl: "COMERCIAL_SB_URL",
    envKey: "COMERCIAL_SB_SERVICE_KEY",
    leer: leerComercial,
    maxHorasSinCorrida: 36, // corre L-V 00:07; 36h cubre sábado tarde
    diagnosticoSinDatos: {
      titulo: "No llegó ninguna corrida reciente a Supabase",
      causas: [
        "El workflow bbdd_pok_diario.yml de bbdd-planok-trei no corrió o falló antes de escribir en carga_log",
        "Las credenciales SOAP/REST de PlanOk expiraron",
        "La service key SUPABASE_SERVICE_KEY del repo bbdd-planok-trei caducó",
      ],
      pasos: [
        "Abrir github.com/Trei-Inmobiliaria/bbdd-planok-trei → Actions → bbdd_pok_diario y mirar el último run",
        "Si falló por auth: regenerar los secretos PLANOK_USER / PLANOK_PASS y SUPABASE_SERVICE_KEY en Settings → Secrets",
        "Relanzar con 'Run workflow'; en ~5 min debería aparecer una nueva fila por tabla en carga_log",
      ],
    },
  },
  {
    id: "iconstruye",
    nombre: "BBDD IConstruye",
    ref: "jyrbujcnqsemwhkcnwkj",
    area: "IConstruye",
    envUrl: "ICONSTRUYE_SB_URL",
    envKey: "ICONSTRUYE_SB_SERVICE_KEY",
    leer: leerIConstruye,
    maxHorasSinCorrida: 48,
    diagnosticoSinDatos: {
      titulo: "El snapshot de IConstruye no llegó",
      causas: [
        "La ventana nocturna de IConstruye no respondió (los backups de IConstruye a veces se postergan)",
        "El pg_cron del proyecto Supabase está detenido",
        "El esquema iconstruye_meta cambió de permisos y la service key perdió acceso",
      ],
      pasos: [
        "Supabase → BBDD IConstruye → Database → Cron Jobs: revisar que el job diario esté activo y sin errores",
        "Si está en error, abrir el detalle y copiar la primera línea del traceback",
        "Si está OK pero no corrió, lanzarlo manualmente desde el panel con 'Run now'",
      ],
    },
  },
  {
    id: "contabilidad",
    nombre: "Contabilidad - Finanzas (SII + Plan de Cuentas)",
    ref: "xdislftwnamrlqqxybtm",
    area: "Contabilidad",
    envUrl: "CONTABILIDAD_SB_URL",
    envKey: "CONTABILIDAD_SB_SERVICE_KEY",
    leer: leerContabilidad,
    maxHorasSinCorrida: 24 * 10, // cargas mensuales: 10 días de holgura
    diagnosticoSinDatos: {
      titulo: "No hay cargas registradas en SII ni en Plan de Cuentas",
      causas: [
        "Nadie ha subido archivos este período (son cargas manuales de contabilidad)",
        "El endpoint de carga en reporteria-contabilidad.vercel.app está caído",
      ],
      pasos: [
        "Confirmar con el equipo contable si ya hicieron la carga del período",
        "Si debería existir: revisar logs del proyecto Vercel reporteria-contabilidad",
        "Reintentar la subida desde la misma UI; cada carga queda registrada en sii.cargas o g_pc_cargas",
      ],
    },
  },
  {
    id: "desistimientos",
    nombre: "Workflow Desistimientos",
    ref: "tqtxwwiuioykjmbpdmvl",
    area: "Legal",
    envUrl: "DESIST_SB_URL",
    envKey: "DESIST_SB_SERVICE_KEY",
    leer: leerDesistimientos,
    maxHorasSinCorrida: 24 * 14, // workflow operacional; alertar solo si quedó muy quieto
    diagnosticoSinDatos: {
      titulo: "Sin movimiento reciente en case_events",
      causas: [
        "No ha habido actividad en el workflow (puede ser normal)",
        "La app perdió permiso de escritura sobre Supabase",
      ],
      pasos: [
        "Entrar a la app del workflow y abrir un caso cualquiera; cualquier acción deja un evento",
        "Si falla al escribir: revisar la service key del workflow en Vercel",
      ],
    },
  },
];

// ─────────────────────────────────────────────────────────────────────────────

// Helper de fetch REST que normaliza headers y errores.
async function fetchRest(
  url: string,
  key: string,
  extraHeaders: Record<string, string> = {}
): Promise<any[]> {
  const r = await fetch(url, {
    headers: {
      apikey: key,
      authorization: `Bearer ${key}`,
      accept: "application/json",
      ...extraHeaders,
    },
    // El monitor es idempotente: cachear 10s amortigua ráfagas de admins
    // abriendo la vista al mismo tiempo sin esconder un cambio de estado.
    next: { revalidate: 10 },
  });
  if (!r.ok) {
    const texto = await r.text().catch(() => "");
    throw new Error(`HTTP ${r.status}: ${texto.slice(0, 240)}`);
  }
  return (await r.json()) as any[];
}

// Interpreta el historial crudo del proyecto en un estado agregado.
function diagnosticar(
  cfg: Config,
  historial: Corrida[]
): { estado: EstadoExtraccion; diagnostico?: Diagnostico; ultima: Corrida } {
  const sinDatos: Corrida = {
    ts: null,
    estado: "sin-datos",
    resumen: "sin corridas registradas",
    error: null,
  };

  if (!historial.length) {
    return {
      estado: "sin-datos",
      diagnostico: cfg.diagnosticoSinDatos,
      ultima: sinDatos,
    };
  }

  const ultima = historial[0];
  const horas = horasDesde(ultima.ts);

  // Falla real tiene prioridad sobre atraso: si la última corrida terminó mal,
  // la bitácora es la fuente de verdad.
  if (ultima.estado === "falla") {
    return {
      estado: "falla",
      ultima,
      diagnostico: diagnosticoDesdeFalla(cfg, ultima),
    };
  }

  if (horas > cfg.maxHorasSinCorrida) {
    return {
      estado: "atrasado",
      ultima,
      diagnostico: {
        titulo: `Han pasado ${Math.round(horas)} h sin una corrida nueva`,
        causas: [
          `El pipeline debería correr al menos cada ${cfg.maxHorasSinCorrida} h`,
          "El workflow quedó deshabilitado o encolado",
          "Alguna dependencia (PlanOk, IConstruye, SFTP) está caída y abortó antes de escribir",
        ],
        pasos: [
          "Revisar el log del workflow (GitHub Actions o pg_cron según corresponda)",
          "Si falló por timeout: reintentar manualmente",
          "Si falló por dependencia externa: esperar o abrir ticket al proveedor",
        ],
      },
    };
  }

  return { estado: "ok", ultima };
}

function diagnosticoDesdeFalla(cfg: Config, ultima: Corrida): Diagnostico {
  const err = (ultima.error || "").toLowerCase();
  // Un par de atajos comunes; el resto cae en el diagnóstico genérico.
  if (err.includes("auth") || err.includes("401") || err.includes("403")) {
    return {
      titulo: "Falla de autenticación",
      causas: [
        "La service key del proyecto Supabase caducó o se rotó",
        "Las credenciales del origen (PlanOk, IConstruye) expiraron",
      ],
      pasos: [
        "Regenerar la credencial afectada y actualizarla en los secretos del repo",
        "Relanzar el workflow desde Actions",
      ],
    };
  }
  if (err.includes("timeout") || err.includes("etimedout")) {
    return {
      titulo: "Timeout contra el origen",
      causas: [
        "El servidor origen tardó más de lo esperado y el workflow abortó",
        "Degradación temporal del proveedor",
      ],
      pasos: [
        "Reintentar manualmente desde GitHub Actions (Run workflow)",
        "Si vuelve a fallar, abrir ticket con el proveedor y silenciar la alerta por unas horas",
      ],
    };
  }
  return {
    titulo: `Última corrida terminó en error: ${ultima.resumen}`,
    causas: [
      "El pipeline detectó un error durante la corrida",
      ultima.error ? `Detalle: ${ultima.error}` : "Sin detalle en la bitácora",
    ],
    pasos: [
      `Supabase → ${cfg.nombre} → Logs → filtrar por el período de la última corrida`,
      "Copiar el primer error y abrir el workflow correspondiente en GitHub Actions",
      "Reintentar manualmente una vez corregido",
    ],
  };
}

function horasDesde(ts: string | null): number {
  if (!ts) return Infinity;
  return (Date.now() - new Date(ts).getTime()) / 36e5;
}

// ─── API pública del módulo ─────────────────────────────────────────────────

export type ResultadoMonitor = {
  proyectos: EstadoProyecto[];
  // Timestamp del chequeo, útil para la UI y el correo.
  evaluadoEn: string;
};

export async function evaluarExtracciones(): Promise<ResultadoMonitor> {
  const proyectos: EstadoProyecto[] = await Promise.all(
    CONFIG.map(async (cfg) => {
      const url = process.env[cfg.envUrl];
      const key = process.env[cfg.envKey];
      const base: EstadoProyecto = {
        id: cfg.id,
        nombre: cfg.nombre,
        ref: cfg.ref,
        area: cfg.area,
        estado: "sin-datos",
        ultima: {
          ts: null,
          estado: "sin-datos",
          resumen: "sin credenciales configuradas",
        },
        historial: [],
      };
      if (!url || !key) {
        base.diagnostico = {
          titulo: "Faltan credenciales del proyecto en el portal",
          causas: [
            `No hay ${cfg.envUrl} o ${cfg.envKey} definidas en Vercel`,
          ],
          pasos: [
            "Vercel → Portal → Settings → Environment Variables",
            `Agregar ${cfg.envUrl} (URL base del proyecto, sin /rest/v1)`,
            `Agregar ${cfg.envKey} (service_role key de Settings → API del proyecto Supabase)`,
            "Redeploy del portal",
          ],
        };
        return base;
      }
      try {
        const historial = await cfg.leer(url, key);
        const d = diagnosticar(cfg, historial);
        return {
          ...base,
          historial: historial.slice(0, 10),
          estado: d.estado,
          ultima: d.ultima,
          diagnostico: d.diagnostico,
        };
      } catch (e: any) {
        return {
          ...base,
          estado: "falla",
          ultima: {
            ts: null,
            estado: "falla",
            resumen: "no se pudo leer la bitácora",
            error: e?.message || String(e),
          },
          diagnostico: {
            titulo: "El monitor no pudo leer la bitácora del proyecto",
            causas: [
              `Error HTTP contra ${cfg.nombre}: ${e?.message || e}`,
              "La service key del portal perdió acceso al proyecto",
              "El proyecto Supabase está pausado",
            ],
            pasos: [
              `Supabase → ${cfg.nombre} → Settings → API: copiar service_role nueva`,
              `Vercel → Portal → actualizar ${cfg.envKey} y redeploy`,
            ],
          },
        };
      }
    })
  );

  return { proyectos, evaluadoEn: new Date().toISOString() };
}

// ─── Mensajes para la UI ────────────────────────────────────────────────────

export function etiquetaEstado(e: EstadoExtraccion): string {
  switch (e) {
    case "ok":
      return "OK";
    case "atrasado":
      return "ATRASADO";
    case "falla":
      return "FALLA";
    case "sin-datos":
      return "SIN DATOS";
  }
}

export function esProblema(e: EstadoExtraccion): boolean {
  return e === "falla" || e === "atrasado" || e === "sin-datos";
}

export function formatoRelativo(ts: string | null): string {
  if (!ts) return "—";
  const h = horasDesde(ts);
  if (h < 1) return `hace ${Math.max(1, Math.round(h * 60))} min`;
  if (h < 24) return `hace ${Math.round(h)} h`;
  const d = Math.round(h / 24);
  return `hace ${d} ${d === 1 ? "día" : "días"}`;
}
