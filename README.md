# Portal de Informes — Trei

Portal-selector (Next.js + Auth.js) que gatea con **Microsoft Entra ID** el acceso
a los tres informes financieros de Trei y deja elegir a cuál entrar:

- **Control de Deuda** → `https://debt-control-rouge.vercel.app/`
- **Cobranza** → `https://debt-control-rouge.vercel.app/cobranza`
- **Tesorería** → `https://debt-control-rouge.vercel.app/tesoreria/posicion-caja`

Se sirve en `https://trei-informes.app`.

## Cómo entra la gente

1. Va a `trei-informes.app` → login con Microsoft (Entra ID).
2. Solo entra quien esté **activo en el Gestor de Accesos** (`/accesos`).
3. Cae en el selector y ve solo los informes que tiene asignados. (Cada módulo mantiene por ahora su
   propio login; unificarlos bajo Entra es el paso siguiente.)

Reutiliza la **misma app de Entra** del informe comercial (`trei-informe-auth`):
no se crea una app nueva. La regla de correos de este portal es independiente de
la del comercial.

## Gestor de Accesos (`/accesos`)

Vista visual, solo para administradores, para manejar quién entra y a qué:

- Matriz **persona × informe** con permisos de un clic (clic en el encabezado
  de columna marca/desmarca a todas las personas visibles).
- Altas, suspensiones (sin borrar), bajas, rol Usuario/Admin y nombre.
- KPIs, cobertura por informe, bitácora de cambios (quién, qué, cuándo).
- Pestañas en la barra superior: **Informes · Accesos · Panel de Salud**
  (`PANEL_SALUD_URL`). Para anexar "Accesos" dentro del Panel de Salud ver
  `docs/panel-salud-pestana.md`.

Cómo se aplica:

- La lista vive en **Vercel Edge Config** (llave `accesos`). Se lee en vivo en
  el middleware (caché de 15 s), así que una suspensión corta el acceso al
  instante, sin redeploy.
- Cobranza y Tesorería pasan por `/ir/reportes`, que rechaza si falta el
  permiso. Comercial y Contabilidad son apps externas con su propio candado:
  el portal oculta la tarjeta.
- `ADMIN_EMAILS` son super-admins: siempre entran y no se pueden degradar ni
  suspender desde la UI (para que nadie se quede fuera).
- Si Edge Config está vacío o caído, se usa la lista semilla
  (`ALLOWED_EMAILS` o la del código), nunca se bloquea a todos.
- Guardado con control de concurrencia: si otro admin guardó entremedio, pide
  recargar en vez de pisar sus cambios.

### Conectar Edge Config (una vez)

1. Vercel → Storage → **Create Edge Config** (ej. `trei-accesos`) → Connect al
   proyecto `trei-informes-app-redirect`. Esto crea `EDGE_CONFIG` solo.
2. Vercel → Account Settings → Tokens → crear un token y guardarlo como
   `VERCEL_API_TOKEN` en el proyecto (si el Edge Config es de un team, agregar
   también `VERCEL_TEAM_ID`).
3. `ADMIN_EMAILS=smendez@trei.cl` (coma para más).
4. Redeploy. Entrar a `/accesos` → **Guardar cambios** la primera vez migra la
   lista semilla a Edge Config.

## Despliegue (proyecto Vercel `trei-informes-app-redirect`)

1. **Conectar este repo** al proyecto de Vercel `trei-informes-app-redirect`
   (Settings → Git → Connect). Framework: Next.js (autodetectado).
2. **Variables de entorno** (Settings → Environment Variables), ver `.env.example`:
   - `AUTH_SECRET` — nuevo (`openssl rand -base64 32`).
   - `AUTH_MICROSOFT_ENTRA_ID_ID` = `ENTRA_CLIENT_ID` del worker.
   - `AUTH_MICROSOFT_ENTRA_ID_SECRET` = `ENTRA_CLIENT_SECRET` del worker.
   - `AUTH_MICROSOFT_ENTRA_ID_ISSUER` = `https://login.microsoftonline.com/<TENANT_ID>/v2.0`.
   - `AUTH_TRUST_HOST` = `true`.
3. **Azure** (Entra → App registrations → la app existente → Authentication →
   Redirect URIs) agregar, sin quitar las del comercial:
   `https://trei-informes.app/api/auth/callback/microsoft-entra-id`
4. Deploy. Verificar el dominio `trei-informes.app` apuntando a este proyecto.

## Local

```bash
npm install
cp .env.example .env.local   # completar valores
npm run dev
```
