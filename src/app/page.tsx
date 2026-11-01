import Image from "next/image";
import Link from "next/link";
import illustration from "../../docs/assets/findly-community-planning.png";
import styles from "./landing.module.css";
import { BrandIcon } from "./brand-icon";

const steps = [
  { number: "01", title: "Comparte el evento", description: "Conecta tu calendario de Luma o añade la URL de un evento para reunir sus detalles.", accent: "lavender" },
  { number: "02", title: "Dale tu voz", description: "Prepara textos diferentes para cada cuenta y red, con el tono de cada comunidad.", accent: "peach" },
  { number: "03", title: "Llega a tiempo", description: "Revisa y programa recordatorios en Buffer para que cada encuentro tenga su momento.", accent: "lime" },
] as const;

function Arrow({ diagonal = false }: { diagonal?: boolean }) {
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none"><path d={diagonal ? "M6 18 18 6M7 6h11v11" : "M4 12h15M13 6l6 6-6 6"} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

export default function LandingPage() {
  return <div className={styles.page}>
    <header className={styles.header}>
      <nav className={styles.nav} aria-label="Navegación principal">
        <Link href="/" className={styles.brand} aria-label="Findly, inicio"><BrandIcon size={35} /><span>findly<span className={styles.brandDot}>.</span></span></Link>
        <div className={styles.navLinks}><a href="#como-funciona">Cómo funciona</a><a href="#para-comunidades">Para comunidades</a></div>
        <Link href="/workspace" className={styles.access}>Acceder <Arrow diagonal /></Link>
      </nav>
    </header>

    <main>
      <section className={styles.hero} aria-labelledby="hero-title">
        <div className={styles.heroContent}>
          <div className={styles.eyebrow}><span className={styles.eyebrowDot} /> HECHO PARA REUNIR PERSONAS</div>
          <h1 id="hero-title">Tus eventos merecen <em>ser compartidos.</em></h1>
          <p className={styles.heroDescription}>Menos tiempo preparando publicaciones. Más tiempo creando encuentros que conectan a tu comunidad.</p>
          <div className={styles.heroActions}><Link href="/workspace" className={styles.primaryButton}>Ir a mi espacio <Arrow /></Link><a href="#como-funciona" className={styles.textLink}>Descubre cómo funciona <span aria-hidden="true">↓</span></a></div>
          <p className={styles.heroNote}><span className={styles.noteIcon} aria-hidden="true">✦</span> Tu voz, tus comunidades, tus próximos encuentros.</p>
        </div>
        <div className={styles.heroVisual}>
          <div className={styles.visualTop}><span>UN ESPACIO PARA TUS IDEAS</span><span aria-hidden="true">✳</span></div>
          <Image src={illustration} alt="Ilustración de un calendario que conecta comunidades con publicaciones programadas" priority sizes="(max-width: 800px) 100vw, 55vw" className={styles.heroImage} />
          <div className={styles.visualBottom}><span>Eventos que merecen ser compartidos</span><span>FINDLY / 01</span></div>
        </div>
      </section>

      <div className={styles.divider} aria-hidden="true"><span>DE LA IDEA AL ENCUENTRO</span><span>✳</span><span>MENOS TAREAS, MÁS COMUNIDAD</span><span>✳</span><span>DE LA IDEA AL ENCUENTRO</span></div>

      <section className={styles.how} id="como-funciona" aria-labelledby="how-title">
        <div className={styles.sectionIntro}><div><p className={styles.sectionLabel}>LA FORMA SIMPLE DE ORGANIZARTE</p><h2 id="how-title">Una buena reunión empieza <em>mucho antes.</em></h2></div><p>Encuentra todo lo que necesitas para dar visibilidad a tus eventos en un solo lugar.</p></div>
        <div className={styles.steps}>{steps.map((step) => <article className={`${styles.step} ${styles[step.accent]}`} key={step.number}><span className={styles.stepNumber}>{step.number} <span aria-hidden="true">↗</span></span><div><h3>{step.title}</h3><p>{step.description}</p></div></article>)}</div>
      </section>

      <section className={styles.community} id="para-comunidades" aria-labelledby="community-title">
        <div><p className={styles.sectionLabel}>UNA VOZ PARA CADA COMUNIDAD</p><h2 id="community-title">Cada comunidad tiene algo <em>que contar.</em></h2><p>Gestiona tus cuentas personales y las de tus asociaciones desde un mismo calendario, sin perder la forma de hablar de cada una.</p><Link href="/workspace" className={styles.primaryButton}>Abrir mi espacio <Arrow /></Link></div>
        <div className={styles.communityCards} aria-label="Publicaciones por cuenta"><div><span className={styles.communityIcon}>P</span><strong>Personal</strong><small>Tu voz, a tu manera</small></div><div><span className={styles.communityIcon}>J</span><strong>Barcelona JUG</strong><small>Una comunidad para compartir</small></div><div><span className={styles.communityIcon}>S</span><strong>Software Crafters Barcelona</strong><small>Ideas que conectan</small></div></div>
      </section>
    </main>
    <footer className={styles.footer}><Link href="/" className={styles.footerBrand}>findly<span>.</span></Link><p>Para que tus encuentros lleguen más lejos.</p><a href="#hero-title">Volver arriba ↑</a></footer>
  </div>;
}
