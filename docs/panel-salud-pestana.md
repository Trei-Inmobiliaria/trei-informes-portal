# Anexar "Accesos" al Panel de Salud (Worker `trei-panel-salud`)

El portal ya tiene la pestaña **Panel de Salud** (apunta a `PANEL_SALUD_URL`,
por defecto `https://trei-panel-salud.smendez.workers.dev/salud/`). Para que el
Panel de Salud tenga la vuelta — un selector **Salud | Accesos | Informes** con
el mismo look — pega esto en el HTML que devuelve el Worker, justo después de
abrir `<body>` (Cloudflare → Workers → `trei-panel-salud` → Edit code):

```html
<style>
  html{overflow-x:clip}
  .trei-tabs{background:#111;display:flex;align-items:stretch;gap:4px;min-height:48px;
    margin:-32px calc(50% - 50vw) 24px;
    padding:0 clamp(16px,4vw,40px);font-family:'Ubuntu','Calibri',system-ui,sans-serif;overflow-x:auto}
  .trei-tabs b{color:#b9b9c1;font-size:11px;font-weight:500;letter-spacing:.8px;
    text-transform:uppercase;align-self:center;margin-right:14px;white-space:nowrap}
  .trei-tabs a{display:inline-flex;align-items:center;padding:0 14px;font-size:12.5px;
    font-weight:500;color:#b9b9c1;text-decoration:none;border-bottom:2px solid transparent;white-space:nowrap}
  .trei-tabs a:hover{color:#fff}
  .trei-tabs a.on{color:#fff;border-bottom-color:#E1093F}
</style>
<nav class="trei-tabs" aria-label="Vistas Trei">
  <b>Control de Gestión</b>
  <a class="on" href="/salud/">Panel de Salud</a>
  <a href="https://trei-informes.app/accesos">Accesos</a>
  <a href="https://trei-informes.app/">Informes</a>
</nav>
```

La pestaña **Accesos** abre el gestor en `trei-informes.app`, protegido por
Microsoft Entra y visible solo para administradores.

El `margin` negativo saca la barra del `body` del panel (máx. 1180px, margen
32px) para que ocupe todo el ancho, igual que la barra del portal.

El gestor `/accesos` usa el tema `.tema-salud` (en `app/globals.css`): fondo
oscuro con halos, tarjetas de vidrio y rojo `#E4172F`, igual al Panel de Salud.
