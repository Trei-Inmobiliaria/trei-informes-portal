"use server";

import { signIn } from "@/auth";

export async function signInWithMicrosoft() {
  await signIn("microsoft-entra-id", { redirectTo: "/" });
}

// Cuentas del tenant de VCB Constructora (razo.cl / ivcb.cl).
export async function signInWithMicrosoftVCB() {
  await signIn("microsoft-entra-id-vcb", { redirectTo: "/" });
}
