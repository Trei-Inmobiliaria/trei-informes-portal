/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  experimental: {
    // Los HTML de informes viven en /privado (fuera de /public, así Next no los
    // sirve como estáticos). Esto los incluye en la función de /ir/facturas,
    // que es la única que los lee, después de validar permiso.
    outputFileTracingIncludes: {
      "/ir/facturas": ["./privado/**/*"],
      // El informe comercial lee su HTML y el plano-raices desde Supabase
      // Storage; si falla, cae al archivo versionado en /privado/comercial/.
      "/ir/comercial/[[...rest]]": ["./privado/**/*"],
    },
  },
};

export default nextConfig;
