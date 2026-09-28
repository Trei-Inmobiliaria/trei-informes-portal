import NextAuth from "next-auth";
import MicrosoftEntraID from "next-auth/providers/microsoft-entra-id";

// ─────────────────────────────────────────────────────────────────────────────
// Lista de correos permitidos EN ESTE PORTAL (independiente del informe comercial).
// Se puede sobreescribir con la variable de entorno ALLOWED_EMAILS (separados por
// coma). El default es la lista acordada con Control de Gestión.
// ─────────────────────────────────────────────────────────────────────────────
const DEFAULT_ALLOW = [
  "smendez@trei.cl",
  "pelgueta@trei.cl",
  "finanzas@trei.cl",
  "nicole.jaramillo@ivcb.cl",
  "pablo.macias@trei.cl",
];

const ALLOWLIST = (process.env.ALLOWED_EMAILS
  ? process.env.ALLOWED_EMAILS.split(",")
  : DEFAULT_ALLOW
)
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

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
      return !!email && ALLOWLIST.includes(email);
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
    // Gatea todas las rutas del middleware: sin sesión → a /login.
    authorized({ auth }) {
      return !!auth?.user;
    },
  },
});
