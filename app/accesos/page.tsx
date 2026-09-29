import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { SUPER_ADMINS, leerAccesos, permisoDe, puedeEscribir } from "@/lib/accesos";
import Topbar, { PANEL_SALUD_URL } from "@/app/components/Topbar";
import GestorAccesos from "./GestorAccesos";

export const dynamic = "force-dynamic";

export default async function AccesosPage() {
  const session = await auth();
  const email = session?.user?.email?.toLowerCase() || "";
  const { accesos, origen } = await leerAccesos({ fresco: true });
  if (!permisoDe(accesos, email).admin) redirect("/");

  return (
    <>
      <Topbar name={session?.user?.name || ""} email={email} admin activa="accesos" />
      <main className="wrap wrap-ancho">
        <p className="eyebrow">Administración</p>
        <h1>Gestor de Accesos</h1>
        <p className="lead">
          Quién puede entrar a trei-informes.app y qué informes ve cada persona.
          Los cambios aplican en segundos, sin redeploy.
        </p>
        <GestorAccesos
          inicial={accesos}
          origen={origen}
          escribible={puedeEscribir()}
          superAdmins={SUPER_ADMINS}
          yo={email}
          panelSaludUrl={PANEL_SALUD_URL}
        />
      </main>
    </>
  );
}
