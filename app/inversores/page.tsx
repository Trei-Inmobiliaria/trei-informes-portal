import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { permisoActual } from "@/lib/accesos";
import { rpc } from "@/lib/comercial-sb";
import Topbar from "@/app/components/Topbar";
import "./inversores.css";

export const dynamic = "force-dynamic";

// Vista simplificada del Informe Comercial para inversores.
//
// Todo sale de inversor_resumen() (Supabase): cifras agregadas por proyecto,
// ya filtradas por los proyectos asignados a esta persona. Esta página no lee
// ninguna tabla con datos de clientes ni recibe filas por unidad.

type Proy = {
  proyecto: string;
  nombre: string;
  unidades: number;
  vendidas: number;
  reservadas: number;
  promesadas: number;
  escrituradas: number;
  disponibles: number;
  uf_vendidas: number;
  cierre_promesas: number;
  cierre_promesas_uf: number;
  cierre_neto: number;
  cierre_escrituras: number;
  cierre_desist: number;
  ppto_promesas_uf: number;
  velocidad: number;
  meses_stock: number | null;
  leads_mes: number;
};
type Punto = { proyecto: string; periodo: string; neto: number; escrituras: number };
type Resumen = { corte: string | null; mes_cierre: string | null; rol: string; proyectos: Proy[]; serie: Punto[] };

const n0 = new Intl.NumberFormat("es-CL", { maximumFractionDigits: 0 });
const n1 = new Intl.NumberFormat("es-CL", { maximumFractionDigits: 1 });
const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const MESES_LARGO = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const fechaLarga = (iso: string | null) => {
  if (!iso) return "sin dato";
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return `${d} de ${MESES_LARGO[m - 1]} de ${y}`;
};
const mesLargo = (iso: string | null) => {
  if (!iso) return "sin dato";
  const [y, m] = iso.slice(0, 10).split("-").map(Number);
  return `${MESES_LARGO[m - 1]} de ${y}`;
};
const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : 0);

function Barras({ puntos }: { puntos: Punto[] }) {
  if (puntos.length === 0) return <p className="inv-nodato">Sin cierres recientes</p>;
  const W = 168, H = 56, base = 38, tope = 12;
  const max = Math.max(1, ...puntos.map((p) => p.neto));
  const min = Math.min(0, ...puntos.map((p) => p.neto));
  const alto = base - tope;
  const escala = max > 0 ? alto / max : 1;
  const bajo = H - base - 4;
  const escalaNeg = min < 0 ? bajo / Math.abs(min) : 0;
  const ancho = W / puntos.length;
  return (
    <svg viewBox={`0 0 ${W} ${H + 12}`} role="img" aria-label="Ventas netas de los últimos cierres mensuales" className="inv-spark">
      <line x1="0" x2={W} y1={base} y2={base} className="inv-eje" />
      {puntos.map((p, i) => {
        const h = p.neto >= 0 ? p.neto * escala : Math.abs(p.neto) * escalaNeg;
        const y = p.neto >= 0 ? base - h : base;
        const x = i * ancho + ancho * 0.2;
        const mes = MESES[Number(p.periodo.slice(5, 7)) - 1];
        return (
          <g key={p.periodo}>
            <rect x={x} y={y} width={ancho * 0.6} height={Math.max(h, p.neto === 0 ? 0 : 1.5)} rx="1.5"
              className={p.neto < 0 ? "inv-neg" : "inv-pos"} />
            {p.neto !== 0 ? (
              <text x={x + ancho * 0.3} y={p.neto >= 0 ? y - 3 : y + h + 9} textAnchor="middle" className="inv-val">{p.neto}</text>
            ) : null}
            <text x={x + ancho * 0.3} y={H + 8} textAnchor="middle" className="inv-mes">{mes}</text>
          </g>
        );
      })}
    </svg>
  );
}

export default async function Inversores() {
  const session = await auth();
  const email = (session?.user?.email || "").toLowerCase();
  if (!email) redirect("/login");
  const permiso = await permisoActual(email);
  if (!permiso.admin && !permiso.informes.includes("inversores")) redirect("/?error=sin-permiso");

  const r = await rpc<Resumen>(email, "inversor_resumen");
  const D = r.ok ? r.data! : null;
  const proys = D?.proyectos ?? [];

  const tot = proys.reduce(
    (a, p) => ({
      unidades: a.unidades + p.unidades,
      vendidas: a.vendidas + p.vendidas,
      uf: a.uf + p.uf_vendidas,
      escr: a.escr + p.escrituradas,
      disp: a.disp + p.disponibles,
      neto: a.neto + p.cierre_neto,
      vel: a.vel + p.velocidad,
    }),
    { unidades: 0, vendidas: 0, uf: 0, escr: 0, disp: 0, neto: 0, vel: 0 }
  );
  const mesesStock = tot.vel > 0 ? tot.disp / tot.vel : null;

  return (
    <>
      <Topbar name={session?.user?.name || ""} email={email} admin={permiso.admin}
        verExtracciones={permiso.verExtracciones} activa="informes" />
      <main className="wrap wrap-ancho inv-pagina">
        <p className="eyebrow">Informe para inversores</p>
        <h1>Avance comercial</h1>
        <p className="lead">
          Estado de ventas de {proys.length === 1 ? "tu proyecto" : "tus proyectos"} al {fechaLarga(D?.corte ?? null)}.
          Los resultados mensuales corresponden al último cierre ({mesLargo(D?.mes_cierre ?? null)}).
        </p>

        {permiso.admin ? (
          <div className="aviso aviso-info">
            Vista de administrador: ves todos los proyectos. Un inversor solo ve los que le asignes en Accesos.
          </div>
        ) : null}

        {!r.ok ? (
          <div className="aviso">
            No se pudo cargar el informe ({r.error}). Si el problema sigue, avisa a Control de Gestión.
          </div>
        ) : proys.length === 0 ? (
          <div className="inv-vacia">
            <b>Aún no tienes proyectos asignados.</b>
            <span>Escribe a Control de Gestión para que te habiliten el acceso.</span>
          </div>
        ) : (
          <>
            <section className="inv-kpis" aria-label="Resumen de tus proyectos">
              <div className="inv-k"><span className="kpi-k">Unidades vendidas</span>
                <b>{n0.format(tot.vendidas)}<small> de {n0.format(tot.unidades)}</small></b>
                <span className="kpi-s">{pct(tot.vendidas, tot.unidades)}% del inventario</span></div>
              <div className="inv-k"><span className="kpi-k">UF vendidas</span>
                <b>{n0.format(tot.uf)}</b><span className="kpi-s">reservas, promesas y escrituras</span></div>
              <div className="inv-k"><span className="kpi-k">Escrituradas</span>
                <b>{n0.format(tot.escr)}</b><span className="kpi-s">{pct(tot.escr, tot.vendidas)}% de lo vendido</span></div>
              <div className="inv-k"><span className="kpi-k">Ventas netas del mes cerrado</span>
                <b>{n0.format(tot.neto)}</b><span className="kpi-s">unidades, {mesLargo(D?.mes_cierre ?? null)}</span></div>
              <div className="inv-k"><span className="kpi-k">Velocidad de venta</span>
                <b>{n1.format(tot.vel)}<small> un/mes</small></b><span className="kpi-s">promedio de los últimos 3 cierres</span></div>
              <div className="inv-k"><span className="kpi-k">Meses de stock</span>
                <b>{mesesStock === null ? "—" : n1.format(mesesStock)}</b>
                <span className="kpi-s">{n0.format(tot.disp)} unidades disponibles</span></div>
            </section>

            {proys.length > 1 ? (
              <details className="inv-det inv-comp">
                <summary><span className="cerrado">Ver comparativo entre proyectos</span><span className="abierto">Ocultar comparativo</span></summary>
                <div className="inv-scroll">
                  <table className="inv-tabla inv-ancha">
                    <thead>
                      <tr><th>Proyecto</th><th>Unidades</th><th>Vendidas</th><th>% vendido</th><th>Escrituradas</th><th>Disponibles</th>
                        <th>UF vendidas</th><th>Neto del mes</th><th>Velocidad</th><th>Meses de stock</th></tr>
                    </thead>
                    <tbody>
                      {proys.map((p) => (
                        <tr key={p.proyecto}>
                          <td>{p.nombre}</td><td>{n0.format(p.unidades)}</td><td>{n0.format(p.vendidas)}</td>
                          <td>{pct(p.vendidas, p.unidades)}%</td><td>{n0.format(p.escrituradas)}</td><td>{n0.format(p.disponibles)}</td>
                          <td>{n0.format(p.uf_vendidas)}</td><td>{n0.format(p.cierre_neto)}</td>
                          <td>{n1.format(p.velocidad)}</td><td>{p.meses_stock === null ? "—" : n1.format(p.meses_stock)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr><td>Total</td><td>{n0.format(tot.unidades)}</td><td>{n0.format(tot.vendidas)}</td>
                        <td>{pct(tot.vendidas, tot.unidades)}%</td><td>{n0.format(tot.escr)}</td><td>{n0.format(tot.disp)}</td>
                        <td>{n0.format(tot.uf)}</td><td>{n0.format(tot.neto)}</td>
                        <td>{n1.format(tot.vel)}</td><td>{mesesStock === null ? "—" : n1.format(mesesStock)}</td></tr>
                    </tfoot>
                  </table>
                </div>
              </details>
            ) : null}

            <section className="inv-cards" aria-label="Detalle por proyecto">
              {proys.map((p) => {
                const serie = (D?.serie ?? []).filter((s) => s.proyecto === p.proyecto);
                const cumpl = p.ppto_promesas_uf > 0 ? Math.round((p.cierre_promesas_uf / p.ppto_promesas_uf) * 100) : null;
                return (
                  <article className="inv-card" key={p.proyecto}>
                    <header>
                      <h2>{p.nombre}</h2>
                      <span className="inv-pct">{pct(p.vendidas, p.unidades)}%<small> vendido</small></span>
                    </header>
                    <div className="inv-apil" role="img"
                      aria-label={`${p.escrituradas} escrituradas, ${p.promesadas} promesadas, ${p.reservadas} reservadas, ${p.disponibles} disponibles`}>
                      <span className="e" style={{ width: `${pct(p.escrituradas, p.unidades)}%` }} />
                      <span className="p" style={{ width: `${pct(p.promesadas, p.unidades)}%` }} />
                      <span className="r" style={{ width: `${pct(p.reservadas, p.unidades)}%` }} />
                    </div>
                    <ul className="inv-leyenda">
                      <li><i className="e" />Escrituradas {n0.format(p.escrituradas)}</li>
                      <li><i className="p" />Promesadas {n0.format(p.promesadas)}</li>
                      <li><i className="r" />Reservadas {n0.format(p.reservadas)}</li>
                      <li><i className="d" />Disponibles {n0.format(p.disponibles)}</li>
                    </ul>
                    <dl>
                      <dt>Vendidas / total</dt><dd>{n0.format(p.vendidas)} / {n0.format(p.unidades)}</dd>
                      <dt>UF vendidas</dt><dd>{n0.format(p.uf_vendidas)}</dd>
                      <dt>Ventas netas del mes cerrado</dt><dd>{n0.format(p.cierre_neto)} un.</dd>
                      <dt>Meses de stock</dt><dd>{p.meses_stock === null ? "—" : n1.format(p.meses_stock)}</dd>
                    </dl>

                    <details className="inv-det">
                      <summary><span className="cerrado">Ver detalle</span><span className="abierto">Ocultar detalle</span></summary>

                      <div className="inv-bloque">
                        <h3>Inventario por estado</h3>
                        <table className="inv-tabla">
                          <thead><tr><th>Estado</th><th>Unidades</th><th>% del total</th></tr></thead>
                          <tbody>
                            <tr><td><i className="e" />Escrituradas</td><td>{n0.format(p.escrituradas)}</td><td>{pct(p.escrituradas, p.unidades)}%</td></tr>
                            <tr><td><i className="p" />Promesadas</td><td>{n0.format(p.promesadas)}</td><td>{pct(p.promesadas, p.unidades)}%</td></tr>
                            <tr><td><i className="r" />Reservadas</td><td>{n0.format(p.reservadas)}</td><td>{pct(p.reservadas, p.unidades)}%</td></tr>
                            <tr><td><i className="d" />Disponibles</td><td>{n0.format(p.disponibles)}</td><td>{pct(p.disponibles, p.unidades)}%</td></tr>
                          </tbody>
                          <tfoot><tr><td>Total</td><td>{n0.format(p.unidades)}</td><td>100%</td></tr></tfoot>
                        </table>
                      </div>

                      <div className="inv-bloque">
                        <h3>Cierre de {mesLargo(D?.mes_cierre ?? null)}</h3>
                        <dl>
                          <dt>Promesas firmadas</dt><dd>{n0.format(p.cierre_promesas)} un. · {n0.format(p.cierre_promesas_uf)} UF</dd>
                          <dt>Desistimientos</dt><dd>{n0.format(p.cierre_desist)} un.</dd>
                          <dt>Ventas netas</dt><dd>{n0.format(p.cierre_neto)} un.</dd>
                          <dt>Escrituras</dt><dd>{n0.format(p.cierre_escrituras)} un.</dd>
                          <dt>Presupuesto de promesas</dt><dd>{p.ppto_promesas_uf > 0 ? `${n0.format(p.ppto_promesas_uf)} UF` : "sin presupuesto"}</dd>
                          <dt>Cumplimiento</dt><dd>{cumpl === null ? "—" : `${cumpl}%`}</dd>
                        </dl>
                        {cumpl !== null ? (
                          <div className="inv-cumpl" role="img" aria-label={`Cumplimiento del presupuesto: ${cumpl}%`}>
                            <span style={{ width: `${Math.min(cumpl, 100)}%` }} className={cumpl >= 100 ? "ok" : ""} />
                          </div>
                        ) : null}
                      </div>

                      <div className="inv-bloque">
                        <h3>Ritmo comercial</h3>
                        <dl>
                          <dt>Velocidad (promedio 3 cierres)</dt><dd>{n1.format(p.velocidad)} un/mes</dd>
                          <dt>Unidades disponibles</dt><dd>{n0.format(p.disponibles)}</dd>
                          <dt>Meses de stock</dt><dd>{p.meses_stock === null ? "—" : n1.format(p.meses_stock)}</dd>
                          <dt>Leads del mes en curso</dt><dd>{n0.format(p.leads_mes)}</dd>
                        </dl>
                      </div>

                      <div className="inv-bloque">
                        <h3>Últimos cierres mensuales</h3>
                        <Barras puntos={serie} />
                        {serie.length > 0 ? (
                          <table className="inv-tabla">
                            <thead><tr><th>Mes</th><th>Ventas netas</th><th>Escrituras</th></tr></thead>
                            <tbody>
                              {[...serie].reverse().map((s) => (
                                <tr key={s.periodo}>
                                  <td>{MESES_LARGO[Number(s.periodo.slice(5, 7)) - 1]} {s.periodo.slice(0, 4)}</td>
                                  <td className={s.neto < 0 ? "neg" : ""}>{n0.format(s.neto)}</td>
                                  <td>{n0.format(s.escrituras)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        ) : null}
                      </div>
                    </details>
                  </article>
                );
              })}
            </section>

            <p className="inv-nota">
              Cifras agregadas por proyecto; no incluyen datos de clientes. Unidades vendidas = reservadas + promesadas + escrituradas
              (inventario principal, sin estacionamientos ni bodegas). Ventas netas = promesas del mes menos desistimientos, según el
              cierre mensual oficial. Los meses de stock dividen las unidades disponibles por la velocidad de los últimos 3 cierres.
            </p>
          </>
        )}
      </main>
    </>
  );
}
