"use server";

import { signIn } from "@/auth";

export async function signInWithMicrosoft() {
  await signIn("microsoft-entra-id", { redirectTo: "/" });
}
