export { auth as middleware } from "@/auth";

// Protege todo el portal salvo: las rutas de Auth.js, la pantalla de login,
// los estáticos de Next y el logo.
//
// Los HTML de informes bajo /facturas-recibidas-* NO deben servirse directo
// desde /public: tienen que entrar por /ir/facturas, que valida permiso. Por
// eso NO están excluidos del middleware — una visita directa queda detrás del
// login y, aun con login, Next sirve el .html crudo. Lo correcto es que /public
// no exponga esos archivos: /ir/facturas los lee del disco y los entrega. Para
// evitar que alguien adivine la URL del .html y lo descargue, los guardamos con
// un sufijo privado (`.priv.html`) que /ir/facturas sabe leer; Next no los sirve
// como estáticos públicos porque solo cumple con .html exacto.
export const config = {
  matcher: [
    "/((?!api/auth|login|_next/static|_next/image|favicon.ico|trei-logo.png).*)",
  ],
};
