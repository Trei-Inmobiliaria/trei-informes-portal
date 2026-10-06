// Catálogo de informes del portal. El `id` es la llave que usa el Gestor de
// Accesos para decidir qué tarjetas ve cada persona.
export type InformeId =
  | "comercial"
  | "cobranza"
  | "tesoreria"
  | "contabilidad"
  | "facturas-recibidas-2026"
  | "facturas-vcb";

export type Informe = {
  id: InformeId;
  ctag: string;
  title: string;
  corto: string;
  desc: string;
  tags: string[];
  href: string;
  // true = el portal puede bloquear el acceso (pasa por /ir/reportes).
  // false = enlace externo con su propio candado: el portal solo oculta la tarjeta.
  controlado: boolean;
  icon: JSX.Element;
};

export const INFORMES: Informe[] = [
  {
    id: "comercial",
    ctag: "Ventas & Leads",
    title: "Informe Comercial",
    corto: "Comercial",
    desc: "Ventas, leads y estado comercial en tiempo real por proyecto.",
    tags: ["Por proyecto", "Leads", "Reservas", "Se abre en trei.cl"],
    // Vive en trei.cl con su propio Entra (mismo tenant → SSO, sin segunda clave).
    href: "https://trei.cl/informe_ventas/",
    controlado: false,
    icon: <path d="M4 20V10M10 20V4M16 20V13M3 20h18" />,
  },
  {
    id: "cobranza",
    ctag: "Cartera de Clientes",
    title: "Cobranza",
    corto: "Cobranza",
    desc: "Cartera por proyecto y conciliación de ingresos en vivo: recaudación del mes, bandejas por conciliar y Transbank/TOKU.",
    tags: ["Por proyecto", "Conciliación", "Recaudación"],
    // Pasa por el puente SSO firmado; `next` aterriza en la sección de cobranza.
    href: "/ir/reportes?next=%2Fcobranza",
    controlado: true,
    icon: <path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3Z M9 8h6 M9 12h6" />,
  },
  {
    id: "tesoreria",
    ctag: "Caja, Bancos & Deuda",
    title: "Tesorería y Control de Deuda",
    corto: "Tesorería",
    desc: "Posición de caja por sociedad y conciliación bancaria, junto con la deuda financiera del grupo: créditos, acreedores, perfil de vencimientos y costo promedio ponderado (WACD).",
    tags: ["Posición de caja", "Movimientos", "Créditos", "Acreedores", "Vencimientos"],
    // Pasa por el puente SSO firmado; `next=/` aterriza en el tablero de tesorería/deuda.
    href: "/ir/reportes?next=%2F",
    controlado: true,
    icon: (
      <path d="M3 21h18M4 21V10m4 11V10m4 11V10m4 11V10m4 11V10M12 3 3.5 8h17L12 3Z" />
    ),
  },
  {
    id: "contabilidad",
    ctag: "Finanzas",
    title: "Reportería de Contabilidad",
    corto: "Contabilidad",
    desc: "Balance, estado de resultados y cuentas por pagar del grupo. Acceso por correo, validado con Microsoft Entra.",
    tags: ["Balance", "EERR", "Cuentas por pagar"],
    // App propia con su candado Entra (mismo tenant → SSO). Enlace directo.
    href: "https://reporteria-contabilidad.vercel.app/",
    controlado: false,
    icon: <path d="M6 3h12v18H6zM9 7h6M9 11h6M9 15h4" />,
  },
  {
    id: "facturas-recibidas-2026",
    ctag: "Finanzas",
    title: "Facturas Recibidas 2026",
    corto: "Facturas 2026",
    desc: "Cruce IConstruye ↔ Softland: DTE recibidos, estado de contabilización, pagos (egreso, factoring, traspaso) y saldo por documento. Corte 30-09-2026.",
    tags: ["IConstruye", "Softland", "Contabilización", "Pagos", "Factoring"],
    // Archivo HTML en /public, servido tras validar permiso por /ir/facturas.
    href: "/ir/facturas",
    controlado: true,
    icon: <path d="M4 4h12l4 4v12H4zM14 4v6h6M8 14h8M8 18h5" />,
  },
  {
    id: "facturas-vcb",
    ctag: "VCB Constructora",
    title: "Facturas Recibidas 2026 — VCB Constructora",
    corto: "Facturas VCB",
    desc: "Facturas recibidas de VCB Constructora SpA: contabilización en Softland, pagos y saldo por documento. Corte 30-09-2026.",
    tags: ["VCB Constructora", "Contabilización", "Pagos", "Exportar a Excel"],
    // Mismo informe, solo con las filas de VCB embebidas en el HTML.
    href: "/ir/facturas?v=vcb",
    controlado: true,
    icon: <path d="M4 4h12l4 4v12H4zM14 4v6h6M8 14h8M8 18h5" />,
  },
];

export const INFORME_IDS = INFORMES.map((i) => i.id);

// ─── Dominios restringidos ──────────────────────────────────────────────────
// Correos externos que solo pueden ver un subconjunto fijo de informes, sin
// importar lo que se marque en el Gestor de Accesos, y que nunca son admin.
// Se aplica al leer permisos (lib/accesos.ts) y al guardar (api/accesos).
export const DOMINIOS_RESTRINGIDOS: Record<string, InformeId[]> = {
  "razo.cl": ["facturas-vcb"],
};

export function informesPermitidos(email: string): InformeId[] | null {
  const dominio = email.toLowerCase().split("@")[1] || "";
  return DOMINIOS_RESTRINGIDOS[dominio] ?? null;
}

// Recorta la lista de informes de un correo restringido a lo que su dominio permite.
export function recortarInformes(email: string, informes: InformeId[]): InformeId[] {
  const permitidos = informesPermitidos(email);
  return permitidos ? informes.filter((i) => permitidos.includes(i)) : informes;
}

// A qué informe corresponde cada destino del puente /ir/reportes.
export function informeDeRuta(next: string | null | undefined): InformeId {
  return next && next.startsWith("/cobranza") ? "cobranza" : "tesoreria";
}
