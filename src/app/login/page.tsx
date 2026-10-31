import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { isSupabaseConfigured } from "@/lib/supabase/client";
import { GoogleSignInButton } from "./sign-in-button";
import { BrandIcon } from "../brand-icon";
import styles from "./login.module.css";

export default function LoginPage(props: PageProps<"/login">) {
  return <Suspense fallback={<main className={styles.page} />}><LoginContent searchParams={props.searchParams} /></Suspense>;
}

async function LoginContent({ searchParams }: Pick<PageProps<"/login">, "searchParams">) {
  const params = await searchParams;
  const { error, code, next } = params as Record<string, string | undefined>;
  if (typeof code === "string" && code.length > 0) {
    const targetNext = typeof next === "string" ? next : "/";
    redirect(`/auth/callback?code=${encodeURIComponent(code)}&next=${encodeURIComponent(targetNext)}`);
  }
  const configured = isSupabaseConfigured();
  return <main className={styles.page}><section className={styles.card}>
    <Link href="/" className={styles.brand}><BrandIcon size={26} /> findly<span className={styles.dot}>.</span></Link>
    <div className={styles.mark}><BrandIcon size={38} /></div><p className={styles.eyebrow}>TU ESPACIO DE PUBLICACIONES</p>
    <h1>Bienvenido</h1><p className={styles.description}>Inicia sesión con la cuenta de Google autorizada para gestionar tus eventos.</p>
    {error === "owner" && <p className={styles.error}>Esta cuenta no tiene acceso a este espacio.</p>}
    {error === "setup" && <p className={styles.error}>La aplicación requiere configurar Supabase antes de habilitar el acceso.</p>}
    {configured ? <GoogleSignInButton /> : <div className={styles.configNotice}>El acceso con Google estará disponible cuando configures las variables de Supabase.</div>}
    <p className={styles.note}>Tu sesión es privada y solo la cuenta configurada como propietaria podrá acceder.</p>
  </section></main>;
}
