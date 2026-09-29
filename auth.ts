import NextAuth from "next-auth";
import MicrosoftEntraID from "next-auth/providers/microsoft-entra-id";

import { permisoActual } from "@/lib/accesos";

// ─────────────────────────────────────────────────────────────────────────────
// Quién entra y a qué informes lo decide el Gestor de Accesos (/accesos), que
// guarda la lista en Vercel Edge Config (ver lib/accesos.ts). Mientras Edge
// Config esté vacío se usa la lista semilla (ALLOWED_EMAILS o la del código).
// ─────────────────────────────────────────────────────────────────────────────

// El UPN de un invitado B2B llega como
// nombre_dominio.cl#EXT#@treicl.onmicrosoft.com
// y el correo real viene en el claim `email`. Por eso ese va primero.
function correoReal(claims: any): string {
  const directo =
    claims?.email || claims?.preferred_username || claims?.upn || "";
  const s = String(directo);
  if (!s.includes("#EXT#")) return s.toLowerCase();
  const local = s.split("#EXT#")[0];
  const corte = local.lastIndexOf("_");
  return (
    corte === -1 ? local : local.slice(0, corte) + "@" + local.slice(corte + 1)
  ).toLowerCase();
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    MicrosoftEntraID({
      clientId: process.env.AUTH_MICROSOFT_ENTRA_ID_ID,
      clientSecret: process.env.AUTH_MICROSOFT_ENTRA_ID_SECRET,
      // Ej: https://login.microsoftonline.com/<TENANT_ID>/v2.0
      issuer: process.env.AUTH_MICROSOFT_ENTRA_ID_ISSUER,
      authorization: { params: { scope: "openid profile email" } },
    }),
  ],
  session: { strategy: "jwt" },
  pages: { signIn: "/login", error: "/login" },
  trustHost: true,
  callbacks: {
    // Filtro de acceso: solo los correos de la lista pueden entrar a ESTE portal.
    async signIn({ profile }) {
      const email = correoReal(profile);
      return !!email && (await permisoActual(email)).permitido;
    },
    async jwt({ token, profile }) {
      if (profile) {
        token.email = correoReal(profile);
        token.name = (profile as any).name || token.name;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.email = (token.email as string) || session.user.email;
        session.user.name = (token.name as string) || session.user.name;
      }
      return session;
    },
    // Gatea todas las rutas del middleware: sin sesión → a /login. Además
    // revisa el permiso EN VIVO, así una suspensión en el gestor corta el acceso
    // al instante aunque la sesión (JWT) siga vigente.
    async authorized({ auth }) {
      if (!auth?.user?.email) return false;
      return (await permisoActual(auth.user.email)).permitido;
    },
  },
});
