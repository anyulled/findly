# Prototipo de interfaz

## Estado de esta entrega

Esta primera entrega implementa una interfaz interactiva para explorar el flujo y el calendario. El modo sin configuración solo está habilitado en desarrollo local. En producción, la ausencia de Supabase bloquea el acceso al panel. Es un prototipo de navegador: eventos, preferencias y aprobaciones se guardan solo en `localStorage` del dispositivo. Los eventos de muestra y los textos iniciales sirven para recorrer las pantallas; no provienen de Meetup o Luma y no se han enviado a Buffer.

La aprobación cambia el estado local a «Aprobada» y cuenta como ejemplo en el perfil de esa cuenta. La edición del tono por cuenta también se conserva localmente. El modo automático se puede seleccionar, pero no envía publicaciones.

## Integraciones necesarias para producción

El inicio OAuth de Supabase y un esquema Postgres con RLS se incluyen como scaffold, pero el prototipo aún no lee ni escribe sus tablas. Faltan conectar la interfaz a esa persistencia, consultar calendarios Luma iCal, extraer datos desde URL, generar con Groq y publicar y conciliar estados con Buffer. Las credenciales de servicios se configuran como variables de entorno; solo las claves de los proveedores que publican contenido se mantienen en el servidor:

- Credenciales de Supabase y la identidad Google autorizada.
- Clave de la API GraphQL de Buffer y los IDs de los canales para cada cuenta.
- Clave de Groq y el modelo de redacción elegido.
- URL del calendario iCal de Luma. Para Meetup todavía hace falta verificar un feed real.
- Un secreto del endpoint de sincronización que pueda usar cron-job.org.

La validación determinista muestra límites iniciales para LinkedIn (3000), X (280, aplicando la ponderación de enlaces y Unicode), y Bluesky (300 grupos de grafemas). Antes de publicar habrá que contrastar estas reglas con las especificaciones y los canales conectados.

## Reglas visibles del prototipo

El calendario empieza en la quincena que contiene la semana actual y la siguiente, con semanas de lunes a domingo. Para cada evento se preparan las fechas de 14, 7 y 1 día antes que aún no hayan pasado, a las 13:00 de Madrid. El calendario tiene controles de semana, quincena y mes.


Para habilitar el acceso se configura Supabase Google OAuth, NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY y OWNER_EMAIL. La migración inicial crea las tablas propietarias y políticas RLS. El prototipo conserva su estado local hasta que la interfaz se conecte al esquema.
