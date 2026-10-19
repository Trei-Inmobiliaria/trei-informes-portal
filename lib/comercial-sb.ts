import { createHmac } from "crypto";

// Llamadas a funciones (RPC) del Supabase del Informe Comercial en nombre de la
// persona con sesión. Mismo esquema que app/api/comercial/db: JWT HS256 de 60 s
// con el claim "email", para que las funciones y las RLS de la base decidan qué
// ve cada quien. Nunca se usa service_role aquí.
//
// Variables (las mismas que el puente del informe):
//   COMERCIAL_SB_URL, COMERCIAL_SB_KEY (anon), COMERCIAL_SB_JWT_SECRET

const b64url = (buf: Buffer) =>
  buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

function firmarJwt(email: string, secret: string): string {
  const ahora = Math.floor(Date.now() / 1000);
  const h = b64url(Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const p = b64url(
    Buffer.from(JSON.stringify({ role: "authenticated", email, iat: ahora, exp: ahora + 60 }))
  );
  const firma = b64url(createHmac("sha256", secret).update(`${h}.${p}`).digest());
  return `${h}.${p}.${firma}`;
}

// tsconfig no usa strict, así que el resultado es un objeto plano (sin unión
// discriminada): ok=true trae `data`; ok=false trae `status` y `error`.
export type RpcResultado<T> = { ok: boolean; data?: T; status?: number; error?: string };

export async function rpc<T = unknown>(
  email: string,
  fn: string,
  args: Record<string, unknown> = {}
): Promise<RpcResultado<T>> {
  const base = process.env.COMERCIAL_SB_URL;
  const key = process.env.COMERCIAL_SB_KEY;
  const secret = process.env.COMERCIAL_SB_JWT_SECRET;
  if (!base || !key || !secret) {
    return { ok: false, status: 500, error: "puente-no-configurado" };
  }
  try {
    const r = await fetch(`${base.replace(/\/$/, "")}/rest/v1/rpc/${fn}`, {
      method: "POST",
      headers: {
        apikey: key,
        Authorization: `Bearer ${firmarJwt(email.toLowerCase(), secret)}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(args),
      cache: "no-store",
    });
    const texto = await r.text();
    let json: any = null;
    try {
      json = texto ? JSON.parse(texto) : null;
    } catch {}
    if (!r.ok) {
      // PostgREST responde { message, code }. El mensaje son los códigos cortos
      // de las funciones (solo-admin, sin-proyectos, …).
      return { ok: false, status: r.status, error: String(json?.message || texto || r.status).slice(0, 200) };
    }
    return { ok: true, data: json as T };
  } catch (e: any) {
    return { ok: false, status: 502, error: e?.message || "sin-conexion" };
  }
}
