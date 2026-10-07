# Informe de facturas recibidas — trazabilidad IConstruye ↔ Softland ↔ SII

Piezas:

| Archivo | Qué hace | Dónde corre |
|---|---|---|
| `agente_sii_eventos.py` | Consulta al SII (certificado digital) los eventos de cada DTE 33/34/43 recibido (ACD, RCD, ERM, RFP, RFT) y los guarda en `iconstruye.sii_eventos_reclamo`. Incremental. | PC de Control de Gestión (el .pfx no sale de ahí) |
| `cruce_facturas_iconstruye_softland.py` | Cruza IConstruye + Softland + eventos SII y genera JSON, Excel y los dos HTML (completo y VCB). Fechas dinámicas (hasta hoy). | Diario, después de las cargas de IConstruye/Softland |
| `plantilla_facturas.html` | Molde del informe (marcadores `__DATA__`, `__SCOPE__`, `__META__`, `__TITULO__`, `__MARCA__`, `__H1__`, `__UNIVERSO__`). Mantiene botón Excel y vista VCB. | — |
| `tests/test_cruce.py` | Prueba del cruce con datos sintéticos y del render de las dos variantes. | cualquier PC |

## Reglas del estado SII
- **Rechazada**: último evento resolutivo del SII es RCD/RFP/RFT. Motivo mostrado: `RCD → «Mal referencia OC-EEPP»` (única regla de rechazo vigente).
- **Aceptada**: ACD/ERM. **Sin pronunciamiento**: consultado sin eventos. **Sin consulta**: aún no consultado.
- Los rechazos manuales del flujo de IConstruye **no** afectan este estado (filtro aparte «Estado IConstruye»).
- Rechazada en SII y sin contabilizar ⇒ «Rechazada en SII» (no es «Pendiente de contabilizar» ni entra a la antigüedad).
- «El proveedor refirió»: código de referencia del DTE (801 OC, 803 Contrato/EEPP, 802 Nota de pedido, 52 Guía).
- OC: `iconstruye.recepciones.numero_documento_origen` vía `id_factura_asociada`.

## Operación diaria
1. **PC de Control de Gestión (07:30)** — Programador de tareas de Windows ejecuta `ejecutar_agente_sii.bat` (consulta al SII con el certificado y guarda los eventos en Supabase). Variables permanentes (una vez): `setx IC_DB_URL "..."`, `setx SII_PFX_PATH "..."`, `setx SII_PFX_PASS "..."`.
2. **GitHub Actions (08:30 Chile)** — `.github/workflows/informe-facturas.yml` genera el informe y lo publica en el bucket privado `informes-privados` (Supabase «BBDD IConstruye»). Si el PC estuvo apagado, se publica con los últimos eventos SII disponibles y el informe muestra la hora de la última consulta.
3. **Portal** — `/ir/facturas` lee los HTML del bucket (tras validar el permiso con Entra). Sin bucket o con error, cae al archivo de `/privado`.

Secretos de GitHub (Settings → Secrets and variables → Actions): `IC_DB_URL`, `SF_DB_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`.
Variables de Vercel: `FACTURAS_FUENTE_URL`, `FACTURAS_FUENTE_TOKEN`. El registro de Actions es público: el flujo no imprime cifras (`--silencioso`) ni sube artefactos.

## Puesta en marcha
```
pip install pandas psycopg2-binary openpyxl zeep lxml cryptography
export IC_DB_URL=...  SF_DB_URL=...        # Session pooler de cada Supabase
export SII_PFX_PATH=C:\ruta\certificado.pfx SII_PFX_PASS=...
python agente_sii_eventos.py --probar 77886603-K 33 618     # 1ª vez: ver respuesta cruda sin escribir
python agente_sii_eventos.py                                 # carga incremental
python cruce_facturas_iconstruye_softland.py --plantilla plantilla_facturas.html --salida ./salida
```
Los HTML generados contienen datos reales: **no versionarlos en esta repo (pública)**. La ruta `/ir/facturas`
lee desde `FACTURAS_FUENTE_URL` (+ `FACTURAS_FUENTE_TOKEN`) si están definidas; si no, usa `/privado`.
