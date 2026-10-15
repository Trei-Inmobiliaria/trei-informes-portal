import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { leerAccesos, permisoDe } from "@/lib/accesos";
import { evaluarExtracciones } from "@/lib/extracciones";
import Topbar from "@/app/components/Topbar";
import VistaExtracciones from "./VistaExtracciones";

export const dynamic = "force-dynamic";

export default async function Page() {
  const session = await auth();
  const email = session?.user?.email?.toLowerCase() || "";
  const { accesos } = await leerAccesos({ fresco: true });
  if (!permisoDe(accesos, email).admin) redirect("/");

  // SSR del primer estado para que el admin vea algo útil al tiro; el cliente
  // refresca cada 60 s y por botón.
  const inicial = await evaluarExtracciones();

  return (
    <div className="tema-salud">
      <Topbar
        name={session?.user?.name || ""}
        email={email}
        admin
        activa="extracciones"
      />
      <main className="wrap wrap-ancho">
        <p className="eyebrow">Administración</p>
        <h1>Estado de las extracciones</h1>
        <p className="lead">
          Monitor en vivo de los pipelines que alimentan los informes. Cuando
          alguno se cae o se atrasa, llega un correo con qué pasó y los pasos
          para arreglarlo.
        </p>
        <VistaExtracciones inicial={inicial} />
      </main>
    </div>
  );
}
