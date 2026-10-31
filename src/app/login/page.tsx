import Link from "next/link";
import { Suspense } from "react";
import { isSupabaseConfigured } from "@/lib/supabase/client";
import { GoogleSignInButton } from "./sign-in-button";
import styles from "./login.module.css";

export default function LoginPage(props: PageProps<"/login">) {
  return <Suspense fallback={<main className={styles.page} />}><LoginContent searchParams={props.searchParams} /></Suspense>;
}

async function LoginContent({ searchParams }: Pick<PageProps<"/login">, "searchParams">) {
  const { error } = await searchParams;
  const configured = isSupabaseConfigured();
  return <main className={styles.page}><section className={styles.card}>
    <Link href="/" className={styles.brand}><span>f</span> findly<span className={styles.dot}>.</span></Link>
    <div className={styles.mark}>✳</div><p className={styles.eyebrow}>TU ESPACIO DE PUBLICACIONES</p>
    <h1>Bienvenido</h1><p className={styles.description}>Inicia sesión con la cuenta de Google autorizada para gestionar tus eventos.</p>
    {error === "owner" && <p className={styles.error}>Esta cuenta no tiene acceso a este espacio.</p>}
    {error === "setup" && <p className={styles.error}>La aplicación requiere configurar Supabase antes de habilitar el acceso.</p>}
    {configured ? <GoogleSignInButton /> : <div className={styles.configNotice}>El acceso con Google estará disponible cuando configures las variables de Supabase.</div>}
    <p className={styles.note}>Tu sesión es privada y solo la cuenta configurada como propietaria podrá acceder.</p>
  </section></main>;
}
