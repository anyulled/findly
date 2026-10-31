# Prototipo de interfaz

## Estado de esta entrega

El calendario sigue ofreciendo modo demo local cuando Supabase no está configurado en desarrollo. Con Supabase configurado, el panel carga y guarda las cuentas, eventos, borradores, preferencias y aprobación en Postgres, usando el cliente autenticado y las políticas RLS existentes. La base de datos crea las tres cuentas iniciales la primera vez que se inicia sesión.

La aplicación guarda los eventos manuales y crea los borradores de recordatorio aplicables a 14, 7 y 1 día antes, a las 13:00 de `Europe/Madrid`. Los textos de esta etapa son plantillas locales; todavía no se generan con Groq ni se envían a Buffer. La aprobación se realiza mediante una función SQL transaccional que actualiza el post y guarda el ejemplo de estilo en una única operación. Si se edita después un post aprobado, el ejemplo se actualiza también. La voz de cada cuenta y el modo global se guardan en Supabase.

## Integraciones necesarias para producción

El inicio OAuth y la persistencia de Supabase están integrados, pero hace falta configurar el proyecto, el proveedor Google y aplicar todas las migraciones. Todavía faltan consultar calendarios Luma iCal, extraer datos de URLs, generar textos con Groq, publicar y conciliar estados con Buffer, y conectar el endpoint de cron. El modo automático es solo una preferencia guardada: no programa ni publica contenido hasta implementar esas integraciones. Las claves de proveedores se mantienen en el servidor:

- Credenciales de Supabase y la identidad Google autorizada.
- Clave de la API GraphQL de Buffer y los IDs de los canales para cada cuenta.
- Clave de Groq y el modelo de redacción elegido.
- URL del calendario iCal de Luma. Para Meetup todavía hace falta verificar un feed real.
- Un secreto del endpoint de sincronización que pueda usar cron-job.org.
- `JEV_API_KEY` está reservado como placeholder opcional. No hay integración Jev ni código que consuma esa clave actualmente.

La validación determinista muestra límites iniciales para LinkedIn (3000), X (280, aplicando la ponderación de enlaces y Unicode), y Bluesky (300 grupos de grafemas). Antes de publicar habrá que contrastar estas reglas con las especificaciones y los canales conectados.

## Reglas visibles del prototipo

El calendario empieza en la quincena que contiene la semana actual y la siguiente, con semanas de lunes a domingo. Para cada evento se preparan las fechas de 14, 7 y 1 día antes que aún no hayan pasado, a las 13:00 de Madrid. El calendario tiene controles de semana, quincena y mes.


Para habilitar el acceso se configura Supabase Google OAuth, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` y `OWNER_EMAIL`; después hay que aplicar las migraciones de `supabase/migrations/`. Si estas variables faltan en desarrollo local, el modo demo conserva sus datos en el navegador. `JEV_API_KEY` puede dejarse vacío: la app no lo utiliza.
