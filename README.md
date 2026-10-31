# Planificador de publicaciones para eventos

Aplicación personal para preparar y programar anuncios de eventos en redes sociales. El alcance y las decisiones acordadas están en [docs/especificacion.md](docs/especificacion.md).

## Estado

El proyecto está en su fase inicial. Actualmente solo contiene la estructura base de Next.js y la especificación; todavía no implementa autenticación, calendario, fuentes, generación ni programación de publicaciones.

## Desarrollo local

Requiere Node.js compatible con la versión de Next.js indicada en package.json.

```bash
npm install
npm run dev
```

Abrir http://localhost:3000. Para comprobar la base: `npm run lint` y `npm run build`.
