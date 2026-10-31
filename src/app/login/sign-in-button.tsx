"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import styles from "./login.module.css";

export function GoogleSignInButton() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function signIn() {
    setBusy(true); setError("");
    const supabase = createClient();
    const { error: authError } = await supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo: window.location.origin + "/auth/callback" } });
    if (authError) { setError(authError.message); setBusy(false); }
  }
  return <div className={styles.actionGroup}><button className={styles.googleButton} onClick={signIn} disabled={busy}><span className={styles.googleG}>G</span>{busy ? "Conectando…" : "Continuar con Google"}</button>{error && <p className={styles.error}>{error}</p>}</div>;
}
