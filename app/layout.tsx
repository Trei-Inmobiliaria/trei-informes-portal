import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Portal de Informes — Trei",
  description: "Acceso a los informes financieros de Trei Inmobiliaria.",
  robots: { index: false, follow: false },
  // Isotipo rojo de Trei en la pestaña del navegador. SVG para que se vea
  // nítido en cualquier DPI; apple-touch-icon cae al logo PNG completo
  // porque iOS todavía no soporta SVG en pantallas de inicio.
  icons: {
    icon: [{ url: "/favicon.svg", type: "image/svg+xml" }],
    apple: [{ url: "/trei-logo.png" }],
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Ubuntu:wght@400;500;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
