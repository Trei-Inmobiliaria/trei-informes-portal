// ─────────────────────────────────────────────────────────────────────────────
// Monitor de informes — el eslabón Supabase→informe.
//
// extracciones.ts contesta: "¿llegaron los datos a Supabase?"
// Esto contesta la pregunta siguiente: "¿y los informes los pueden leer?"
//
// Hay dos tipos de informe:
//
//   a) Servidos POR este portal (comercial, facturas-recibidas-2026, facturas-vcb):
//      hacemos un ping REAL — un GET con la misma credencial que usa el puente
//      del portal, contra la tabla/archivo que el informe efectivamente consume.
//      Si eso responde 200, el eslabón "Supabase→informe" está en pie.
//
//   b) Informes EXTERNOS (cobranza, tesorería, contabilidad): viven en otro
//      Vercel o Cloudflare Worker con su propia auth. No pingueamos: su estado
//      se hereda del proyecto Supabase que lo alimenta.
//
// Si un informe cae por su propia cuenta (puente roto) pero su proyecto Supabase
// está OK, el panel lo marca rojo y se dispara correo específico — así se
// distingue "la ETL se cayó" de "el puente de datos del portal se cayó".
// ─────────────────────────────────────────────────────────────────────────────

import {
  type Diagnostico,
  type EstadoExtraccion,
  type EstadoProyecto,
} from "./extracciones";

export type TipoCheck = "ping-supabase" | "ping-storage" | "hereda-proyecto";

export type EstadoInforme = {
  id: string;
  nombre: string;
  // Área lógica para agrupar visualmente.
  area: "Comercial" | "Cobranza" | "Tesorería" | "Contabilidad" | "Facturas";
  // Proyecto Supabase que lo alimenta (ref para linkear al dashboard).
  proyectoId: string;
  proyectoNombre: string;
  // Qué chequeo hicimos para este informe.
  tipoCheck: TipoCheck;
  // Estado combinado del informe (max de proyecto + ping cuando aplica).
  estado: EstadoExtraccion;
  // Estado heredado del proyecto Supabase (solo ETL).
  estadoProyecto: EstadoExtraccion;
  // Estado del ping (solo cuando tipoCheck no es "hereda-proyecto").
  estadoPing?: EstadoExtraccion;
  // Latencia del ping en ms.
  latenciaMs?: number;
  // Resumen humano de la última comprobación.
  resumen: string;
  // Diagnóstico cuando algo no está OK.
  diagnostico?: Diagnostico;
};

// ─── Catálogo de informes a monitorear ──────────────────────────────────────

type Config = {
  id: string;
  nombre: string;
  area: EstadoInforme["area"];
  proyectoId: string;
  tipoCheck: TipoCheck;
  // Para "ping-supabase": tabla y env vars de URL + service key.
  pingSupabase?: {
    envUrl: string;
    envKey: string;
    tabla: string;
    // Columna liviana para el select; `*` también funciona pero esto es más barato.
    select?: string;
  };
  // Para "ping-storage": URL del archivo HTML / recurso a chequear.
  pingStorage?: {
    envBase: string;      // FACTURAS_FUENTE_URL
    envToken: string;     // FACTURAS_FUENTE_TOKEN
    archivo: string;      // Facturas_Recibidas.html
  };
};

const CONFIG: Config[] = [
  {
    id: "comercial",
    nombre: "Informe Comercial",
    area: "Comercial",
    proyectoId: "comercial",
    tipoCheck: "ping-supabase",
    pingSupabase: {
      envUrl: "COMERCIAL_SB_URL",
      envKey: "COMERCIAL_SB_SERVICE_KEY",
      tabla: "ventas_pok",
      select: "id_producto",
    },
  },
  {
    id: "cobranza",
    nombre: "Cobranza",
    area: "Cobranza",
    proyectoId: "iconstruye",
    tipoCheck: "hereda-proyecto",
  },
  {
    id: "tesoreria",
    nombre: "Tesorería y Control de Deuda",
    area: "Tesorería",
    proyectoId: "iconstruye",
    tipoCheck: "hereda-proyecto",
  },
  {
    id: "contabilidad",
    nombre: "Reportería de Contabilidad",
    area: "Contabilidad",
    proyectoId: "contabilidad",
    tipoCheck: "hereda-proyecto",
  },
  {
    id: "facturas-recibidas-2026",
    nombre: "Facturas Recibidas 2026",
    area: "Facturas",
    proyectoId: "contabilidad",
    tipoCheck: "ping-storage",
    pingStorage: {
      envBase: "FACTURAS_FUENTE_URL",
      envToken: "FACTURAS_FUENTE_TOKEN",
      archivo: "Facturas_Recibidas.html",
    },
  },
  {
    id: "facturas-vcb",
    nombre: "Facturas Recibidas 2026 — VCB",
    area: "Facturas",
    proyectoId: "contabilidad",
    tipoCheck: "ping-storage",
    pingStorage: {
      envBase: "FACTURAS_FUENTE_URL",
      envToken: "FACTURAS_FUENTE_TOKEN",
      archivo: "Facturas_Recibidas_VCB.html",
    },
  },
];

// ─── Pings ───────────────────────────────────────────────────────────────────

type ResultadoPing = {
  estado: EstadoExtraccion;
  latenciaMs: number;
  detalle: string;
  diagnostico?: Diagnostico;
};

async function pingSupabase(cfg: Config): Promise<ResultadoPing> {
  const { envUrl, envKey, tabla, select } = cfg.pingSupabase!;
  const url = process.env[envUrl];
  const key = process.env[envKey];
  if (!url || !key) {
    return {
      estado: "sin-datos",
      latenciaMs: 0,
      detalle: `faltan ${envUrl} / ${envKey}`,
      diagnostico: {
        titulo: "No se puede verificar el puente de datos del informe",
        causas: [`${envUrl} o ${envKey} no están configuradas en Vercel`],
        pasos: [
          "Vercel → Portal → Settings → Environment Variables",
          `Agregar ${envUrl} y ${envKey}`,
          "Redeploy",
        ],
      },
    };
  }
  const inicio = Date.now();
  try {
    const r = await fetch(
      `${url}/rest/v1/${tabla}?select=${select || "*"}&limit=1`,
      {
        headers: {
          apikey: key,
          authorization: `Bearer ${key}`,
          accept: "application/json",
        },
        // Mismo revalidate que el monitor principal.
        next: { revalidate: 10 },
      }
    );
    const ms = Date.now() - inicio;
    if (r.ok) {
      return {
        estado: "ok",
        latenciaMs: ms,
        detalle: `GET ${tabla} → 200 (${ms} ms)`,
      };
    }
    const texto = (await r.text().catch(() => "")).slice(0, 200);
    return {
      estado: "falla",
      latenciaMs: ms,
      detalle: `GET ${tabla} → HTTP ${r.status}: ${texto}`,
      diagnostico: diagnosticoDesdeHttp(r.status, texto, tabla),
    };
  } catch (e: any) {
    return {
      estado: "falla",
      latenciaMs: Date.now() - inicio,
      detalle: `Error de red: ${e?.message || e}`,
      diagnostico: {
        titulo: "El portal no puede alcanzar Supabase",
        causas: [
          "Problema de red o Supabase caído",
          "DNS roto desde Vercel",
        ],
        pasos: [
          "Reintentar en unos minutos (botón Refrescar)",
          "Supabase status page: https://status.supabase.com",
        ],
      },
    };
  }
}

async function pingStorage(cfg: Config): Promise<ResultadoPing> {
  const { envBase, envToken, archivo } = cfg.pingStorage!;
  const base = process.env[envBase];
  const token = process.env[envToken];
  if (!base || !token) {
    return {
      estado: "sin-datos",
      latenciaMs: 0,
      detalle: `faltan ${envBase} / ${envToken}`,
      diagnostico: {
        titulo: "No se puede verificar el HTML del informe",
        causas: [`${envBase} o ${envToken} no están configuradas en Vercel`],
        pasos: [
          "Vercel → Portal → Settings → Environment Variables",
          `Agregar ${envBase} (URL del bucket de Supabase Storage) y ${envToken} (service_role)`,
          "Redeploy",
        ],
      },
    };
  }
  const inicio = Date.now();
  try {
    // HEAD para no bajar el HTML completo.
    const r = await fetch(`${base.replace(/\/$/, "")}/${archivo}`, {
      method: "HEAD",
      headers: { authorization: `Bearer ${token}`, apikey: token },
      next: { revalidate: 10 },
    });
    const ms = Date.now() - inicio;
    if (r.ok) {
      // La fecha del Last-Modified nos dice qué tan fresco está el HTML.
      const lastMod = r.headers.get("last-modified");
      return {
        estado: "ok",
        latenciaMs: ms,
        detalle: `HEAD ${archivo} → 200 (${ms} ms)${lastMod ? ` · actualizado ${lastMod}` : ""}`,
      };
    }
    return {
      estado: "falla",
      latenciaMs: ms,
      detalle: `HEAD ${archivo} → HTTP ${r.status}`,
      diagnostico: diagnosticoDesdeHttp(r.status, "", archivo),
    };
  } catch (e: any) {
    return {
      estado: "falla",
      latenciaMs: Date.now() - inicio,
      detalle: `Error de red: ${e?.message || e}`,
      diagnostico: {
        titulo: "El portal no puede alcanzar el bucket de Storage",
        causas: ["Problema de red o Supabase caído"],
        pasos: ["Reintentar en unos minutos", "Supabase status page: https://status.supabase.com"],
      },
    };
  }
}

function diagnosticoDesdeHttp(status: number, cuerpo: string, recurso: string): Diagnostico {
  const t = cuerpo.toLowerCase();
  if (status === 401 || status === 403) {
    return {
      titulo: `Autenticación falló contra ${recurso} (HTTP ${status})`,
      causas: [
        "La service_role key del puente caducó o se rotó",
        "Las políticas RLS/permisos cambiaron sobre esa tabla o bucket",
      ],
      pasos: [
        "Supabase → Settings → API: generar / copiar service_role",
        "Vercel → Portal → actualizar la env var correspondiente",
        "Redeploy",
      ],
    };
  }
  if (status === 404) {
    return {
      titulo: `${recurso} no existe en Supabase (HTTP 404)`,
      causas: [
        "La tabla o el archivo fue renombrado o eliminado",
        "El bucket cambió de nombre",
      ],
      pasos: [
        `Supabase → Database/Storage: verificar que ${recurso} existe`,
        "Si el nombre cambió, actualizar lib/informes-salud.ts del portal",
      ],
    };
  }
  if (status === 406 || t.includes("pgrst")) {
    return {
      titulo: `PostgREST rechazó la query (HTTP ${status})`,
      causas: [
        "El schema no está expuesto",
        "La columna o tabla cambió de forma",
      ],
      pasos: [
        "Supabase → Settings → API → Exposed schemas",
        "Verificar el schema contra la query en lib/informes-salud.ts",
      ],
    };
  }
  return {
    titulo: `El puente respondió HTTP ${status}`,
    causas: ["Error del lado de Supabase o del portal", cuerpo ? `Respuesta: ${cuerpo}` : "Sin cuerpo"],
    pasos: [
      "Vercel → Portal → Logs: filtrar por /admin/extracciones",
      "Reintentar; si persiste, revisar Supabase status",
    ],
  };
}

// ─── API pública ────────────────────────────────────────────────────────────

export async function evaluarInformes(
  proyectos: EstadoProyecto[]
): Promise<EstadoInforme[]> {
  const porId = new Map(proyectos.map((p) => [p.id, p]));

  return await Promise.all(
    CONFIG.map(async (cfg) => {
      const proyecto = porId.get(cfg.proyectoId);
      const estadoProyecto = proyecto?.estado || "sin-datos";
      const nombreProyecto = proyecto?.nombre || "¿?";

      // Informes externos: solo heredan.
      if (cfg.tipoCheck === "hereda-proyecto") {
        return {
          id: cfg.id,
          nombre: cfg.nombre,
          area: cfg.area,
          proyectoId: proyecto?.ref || "",
          proyectoNombre: nombreProyecto,
          tipoCheck: cfg.tipoCheck,
          estadoProyecto,
          estado: estadoProyecto,
          resumen:
            estadoProyecto === "ok"
              ? `OK (hereda de ${nombreProyecto})`
              : `${estadoProyecto.toUpperCase()} heredado de ${nombreProyecto}`,
          diagnostico: proyecto?.diagnostico,
        } satisfies EstadoInforme;
      }

      // Informes del portal: ping real.
      const ping =
        cfg.tipoCheck === "ping-supabase"
          ? await pingSupabase(cfg)
          : await pingStorage(cfg);

      // El estado final combina: proyecto y ping. Toma el peor de los dos.
      const estado = peorEstado(estadoProyecto, ping.estado);

      return {
        id: cfg.id,
        nombre: cfg.nombre,
        area: cfg.area,
        proyectoId: proyecto?.ref || "",
        proyectoNombre: nombreProyecto,
        tipoCheck: cfg.tipoCheck,
        estadoProyecto,
        estadoPing: ping.estado,
        latenciaMs: ping.latenciaMs,
        estado,
        resumen: ping.detalle,
        diagnostico:
          estado !== "ok"
            ? ping.estado !== "ok"
              ? ping.diagnostico
              : proyecto?.diagnostico
            : undefined,
      } satisfies EstadoInforme;
    })
  );
}

// Severidad de peor a mejor: falla > atrasado > sin-datos > ok.
function peorEstado(a: EstadoExtraccion, b: EstadoExtraccion): EstadoExtraccion {
  const peso: Record<EstadoExtraccion, number> = {
    ok: 0,
    "sin-datos": 1,
    atrasado: 2,
    falla: 3,
  };
  return peso[a] >= peso[b] ? a : b;
}
