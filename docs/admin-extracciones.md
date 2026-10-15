# Monitor de extracciones (`/admin/extracciones`)

Cierra el hallazgo del *Estado del Arte GitHub-Supabase* (jul-2026) para los
4 proyectos Supabase de producción:

| Proyecto Supabase | Bitácora que se consulta |
|---|---|
| Bases Comerciales PlanOK (`owhlpaypipgkihgubvfl`) | `public.carga_log` |
| BBDD IConstruye (`jyrbujcnqsemwhkcnwkj`) | `iconstruye_meta.carga_log` |
| Contabilidad - Finanzas (`xdislftwnamrlqqxybtm`) | `sii.cargas` + `public.g_pc_cargas` |
| Workflow Desistimientos (`tqtxwwiuioykjmbpdmvl`) | heartbeat sobre `public.case_events` |

Cada hora, el cron de Vercel evalúa el estado y, si algo quedó en **falla**,
**atrasado** o **sin datos**, manda un correo con causas probables y los
pasos para arreglarlo. No se repite el mismo correo por 6 h salvo que
cambie el error.

## Variables de entorno (Vercel → Portal → Settings → Environment Variables)

### Credenciales por proyecto Supabase

Para cada proyecto necesitamos la URL base (sin `/rest/v1`) y una
**service_role key** (Supabase → `<proyecto>` → Settings → API):

```
COMERCIAL_SB_URL            https://owhlpaypipgkihgubvfl.supabase.co
COMERCIAL_SB_SERVICE_KEY    <service_role del proyecto Bases Comerciales PlanOK>

ICONSTRUYE_SB_URL           https://jyrbujcnqsemwhkcnwkj.supabase.co
ICONSTRUYE_SB_SERVICE_KEY   <service_role de BBDD IConstruye>

CONTABILIDAD_SB_URL         https://xdislftwnamrlqqxybtm.supabase.co
CONTABILIDAD_SB_SERVICE_KEY <service_role de Contabilidad - Finanzas>

DESIST_SB_URL               https://tqtxwwiuioykjmbpdmvl.supabase.co
DESIST_SB_SERVICE_KEY       <service_role de Workflow Desistimientos>
```

> **Por qué `service_role` y no `anon`.** La `anon` key de los proyectos
> `iconstruye_meta.*` y `sii.*` no está publicada en los schemas expuestos a
> PostgREST para esos esquemas. Con la service_role leemos la bitácora
> saltándonos RLS, lo cual es correcto para un monitor que corre solo en el
> servidor. Las keys **nunca** se exponen al navegador: el único endpoint
> que las usa es `app/api/admin/extracciones/route.ts`, con `runtime = nodejs`.

### Opcionales — pings a los informes del portal

Si no se definen, el panel sigue funcionando pero los informes de Facturas
quedan en "SIN DATOS" (el ping se salta silencioso). El de Comercial usa
`COMERCIAL_SB_URL` + `COMERCIAL_SB_SERVICE_KEY` que ya están arriba.

```
FACTURAS_FUENTE_URL     https://xdislftwnamrlqqxybtm.supabase.co/storage/v1/object/informes-privados
FACTURAS_FUENTE_TOKEN   <service_role de Contabilidad - Finanzas, mismo valor que CONTABILIDAD_SB_SERVICE_KEY>
```

Nota: estas dos env vars ya existen en el portal desde antes (las usa
`/ir/facturas` para servir el HTML remoto), así que probablemente no haya
nada que agregar — el monitor las reutiliza.

### Envío de correo (Resend)

```
RESEND_API_KEY   re_xxx…      (api key de Resend)
ALERTAS_FROM     "Portal Trei <alertas@trei.cl>"   (sender verificado en Resend)
ALERTAS_TO       smendez@trei.cl,pelgueta@trei.cl  (coma; sin espacios obligados)
```

Si `ALERTAS_FROM` todavía no tiene dominio verificado, usar el remitente
`onboarding@resend.dev` como prueba.

### Cron (Vercel lo setea automáticamente)

```
CRON_SECRET   <string aleatorio largo>
```

Vercel genera y expone este secreto solo a sus crons; se usa para que
`/api/admin/extracciones/cron` y el POST manual sepan que la llamada vino de
su scheduler.

## Verificación

1. Entrar a `/admin/extracciones` como admin (lista de `/accesos`).
2. Debería verse una tarjeta por proyecto con estado OK y la última corrida.
3. Botón **"Enviar correo de prueba"** evalúa y despacha correos reales a
   `ALERTAS_TO` si hay algo en falla/atraso. Si todo está OK, informa "nada
   que alertar" y no manda nada.
4. El cron corre a los `:00` de cada hora. Primer registro aparece en
   Vercel → Portal → Logs → filtrar por `/api/admin/extracciones/cron`.

## Dedup real (si en algún momento molesta reiniciar la memoria tras un deploy)

Hoy la lista de "ya alerté esto" vive en memoria del isolate. Un redeploy
limpia el estado; no es grave porque el cron horario reemite rápido. Si
quieres dedup estable:

- Opción simple: una llave en **Vercel Edge Config** llamada
  `admin:extracciones:alertas` con `{ [proyectoId]: { hash, ts } }`.
- Opción fuerte: una tabla `admin.alertas_enviadas` en el proyecto
  Bases Comerciales PlanOK (donde ya vive `public.carga_log`).
