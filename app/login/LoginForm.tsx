"use client";

import { useEffect, useRef, useState } from "react";
import { signInWithMicrosoft } from "./actions";

function MicrosoftLogo() {
  return (
    <svg viewBox="0 0 21 21" aria-hidden="true">
      <rect x="1" y="1" width="9" height="9" fill="#f25022" />
      <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
      <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
      <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
    </svg>
  );
}

export default function LoginForm() {
  const [showModal, setShowModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const confirmBtnRef = useRef<HTMLButtonElement>(null);

  const openModal = () => setShowModal(true);
  const closeModal = () => {
    if (!submitting) setShowModal(false);
  };

  const confirmAndSubmit = () => {
    setSubmitting(true);
    formRef.current?.requestSubmit();
  };

  // Cerrar con tecla Escape y foco inicial en el botón primario
  useEffect(() => {
    if (!showModal) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeModal();
    };
    document.addEventListener("keydown", onKey);
    confirmBtnRef.current?.focus();
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showModal]);

  return (
    <>
      <form ref={formRef} action={signInWithMicrosoft}>
        <button
          type="button"
          className="btn-msft"
          onClick={openModal}
          disabled={submitting}
        >
          <MicrosoftLogo />
          Entrar con Microsoft
        </button>
      </form>

      {showModal ? (
        <div
          className="login-modal-backdrop"
          onClick={closeModal}
          role="dialog"
          aria-modal="true"
          aria-labelledby="login-modal-title"
          aria-describedby="login-modal-desc"
        >
          <div
            className="login-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="login-modal-title">Antes de continuar</h2>
            <div id="login-modal-desc" className="login-modal-body">
              <p>
                Estás entrando al <strong>Portal de Informes</strong> de Trei
                Inmobiliaria.
              </p>
              <p>
                Vas a iniciar sesión con tu cuenta de Microsoft (la misma del
                correo). Una vez dentro, verás los informes a los que tengas
                acceso.
              </p>
            </div>
            <div className="login-modal-actions">
              <button
                type="button"
                className="btn-ghost"
                onClick={closeModal}
                disabled={submitting}
              >
                Cancelar
              </button>
              <button
                ref={confirmBtnRef}
                type="button"
                className="btn-msft btn-msft--modal"
                onClick={confirmAndSubmit}
                disabled={submitting}
              >
                <MicrosoftLogo />
                {submitting ? "Redirigiendo…" : "Continuar con Microsoft"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
