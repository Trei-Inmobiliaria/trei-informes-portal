import LoginForm from "./LoginForm";

export default function Login({
  searchParams,
}: {
  searchParams?: { error?: string };
}) {
  const error = searchParams?.error;
  const denied = error === "AccessDenied";

  return (
    <div className="login-shell">
      <main className="login-main">
        <div className="login-card">
          <span className="login-logo">
            <img src="/trei-logo.png" alt="Trei Inmobiliaria" />
          </span>
          <h1>Portal de Informes</h1>
          <p className="sub">Grupo VCB · Trei Inmobiliaria</p>

          {error ? (
            <div className="login-error">
              {denied
                ? "Tu cuenta no está autorizada para este portal. Si crees que debería tener acceso, escribe a Control de Gestión."
                : "No se pudo completar el inicio de sesión. Vuelve a intentarlo."}
            </div>
          ) : null}

          <LoginForm />

          <p className="login-note">
            Entras con tu cuenta de Microsoft (la misma del correo). No hay una
            contraseña aparte que recordar.
          </p>
        </div>
      </main>
      <div className="login-foot">
        Acceso restringido · Control de Gestión — Trei Inmobiliaria
      </div>
    </div>
  );
}
