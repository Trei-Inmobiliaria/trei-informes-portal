/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  experimental: {
    // Los HTML de informes viven en /privado (fuera de /public, así Next no los
    // sirve como estáticos). Esto los incluye en la función de /ir/facturas,
    // que es la única que los lee, después de validar permiso.
    outputFileTracingIncludes: {
      "/ir/facturas": ["./privado/**/*"],
    },
  },
};

export default nextConfig;
