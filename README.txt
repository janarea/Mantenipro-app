MANTENIPRO 2.5 — ACTUALIZACIÓN COMPLETA
=======================================

CONTENIDO
- index.html y ManteniPro_2.5.html: aplicación 2.5.
- version.json: versión 2.5.
- sw.js: Service Worker con recepción FCM en segundo plano.
- worker.js: backend Cloudflare Worker.
- migrate_push.sql: migración adicional de D1.
- README.txt: instrucciones de despliegue.

SEGURIDAD
El paquete NO contiene la clave privada de Firebase. El JSON de cuenta de servicio
debe permanecer exclusivamente en el secreto FIREBASE_SERVICE_ACCOUNT_JSON de Cloudflare.
No publiques ese JSON en GitHub ni lo compartas.

1) PUBLICAR EN GITHUB PAGES
Repositorio janarea/Mantenipro-app, rama main, carpeta raíz.
Sustituye index.html, ManteniPro_2.5.html, sw.js y version.json por los del paquete.
No es necesario subir worker.js a GitHub Pages. Confirma el commit y espera el despliegue.

2) MIGRACIÓN D1 (UNA SOLA VEZ)
Cloudflare > D1 > mantenipro-db > Console.
Ejecuta todo migrate_push.sql. Añade repeat_rule a reminders y crea
registration_rate_limits. No borra instalaciones, suscripciones ni recordatorios.
No vuelvas a ejecutar el ALTER TABLE una vez aplicado.

3) DESPLEGAR EL WORKER
Cloudflare > Workers & Pages > mantenipro-push > Edit code.
Sustituye Hello World por el contenido completo de worker.js y pulsa Deploy.
Comprueba Settings > Bindings: DB -> mantenipro-db.
Comprueba Settings > Variables and Secrets:
- FIREBASE_PROJECT_ID (Text) = mantenipro-1da42
- FIREBASE_SERVICE_ACCOUNT_JSON (Secret) = JSON completo de Firebase.
En Settings > Triggers > Cron Triggers añade * * * * * (cada minuto).
Comprueba https://mantenipro-push.janarea.workers.dev/health:
ok=true, firebaseConfigured=true y databaseConfigured=true.

4) PERMISOS DE FIREBASE
Firebase Cloud Messaging API HTTP v1 debe estar habilitada.
La cuenta de servicio debe poder enviar mensajes FCM. Si aparece 403 PERMISSION_DENIED,
revisa IAM y concede Firebase Cloud Messaging API Admin o un rol que incluya
cloudmessaging.messages.create. No hacen falta Firebase Functions ni facturación de Firebase.

5) ACTIVAR Y PROBAR EN ANDROID
Abre ManteniPro y pulsa Activar Push en el panel de avisos. Concede el permiso.
La app registra la instalación sin usuario ni contraseña y solicita una prueba FCM.
Debe aparecer «ManteniPro · Prueba Push».
Para probar con la app cerrada, crea en Notas y tareas un recordatorio para dentro
de 2-3 minutos, guarda, cierra ManteniPro y espera la notificación.

CAMBIOS INCLUIDOS
- Borrado aislado de una sola intervención del calendario.
- Últimas averías de la instalación en el detalle de tarea.
- Ajuste numérico de stock sin botones +/- duplicados.
- Campos de instalación tipados, asignables a secciones, ordenables y renombrables.
- Migración revisable de campos antiguos con copia de seguridad previa.
- Copias de seguridad completas con notas, tareas, recibos y fotos de IndexedDB;
  restauración de adjuntos desde la copia.
- Gastos con cámara/galería y compresión de recibos.
- Conservación de ubicación, códigos y datos NFC de productos al recargar/restaurar.
- Se mantienen Nuevo recordatorio, NFC con cantidad previa al descuento y cámara 1:1.
- Registro FCM por instalación, sincronización de recordatorios y envío programado.

LIMITACIONES
- Cada navegador/dispositivo tiene su propia instalación. No hay cuentas ni contraseñas
  ni vinculación entre dispositivos.
- Si se borran los datos del navegador, se pierde la credencial local y habrá que registrar
  de nuevo ese dispositivo.
- Los avisos por fecha/hora se sincronizan con D1. Las tareas basadas únicamente en
  geolocalización siguen dependiendo de que ManteniPro esté activa.
- El Cron comprueba cada minuto; la entrega depende de conexión, permisos y batería.
- Se procesan hasta 10 avisos vencidos por ejecución.
- Workers y D1 tienen límites gratuitos; al superarlos, Cloudflare puede rechazar
  solicitudes/consultas hasta el reinicio diario. No se activa ningún plan de pago.

VERIFICACIÓN
Sintaxis JavaScript comprobada para app, Service Worker y Worker. Migración SQL probada
en SQLite con el esquema D1 previsto. Revisión estática de los cambios y de la versión 2.5.
Aún NO se ha realizado un envío FCM real ni un despliegue en tus cuentas: faltan la
publicación de los cuatro archivos web, la migración D1, el Deploy del Worker y el Cron.


CAMBIOS EN PREPARACIÓN (NO PUBLICAR TODAVÍA)
- El código HTML incluye el renombrado de categorías de almacén conservando los productos asociados.
- El script de Google Apps Script admite una carpeta común Fotografias/Gastos, sin subcarpetas por gasto.
- Pendiente integrar y verificar la sincronización de recibos y la caducidad configurable antes de publicar.

ACTUALIZACION 2.5.1 - FOTOGRAFIAS DE GASTOS
- Añade conservación configurable de fotografías de gastos: sin caducidad (valor inicial), 3, 6, 12 o 24 meses.
- Las fotografías se mantienen en el almacenamiento local actual del dispositivo y se sincronizan como archivos independientes en Fotografias/Gastos en Google Drive.
- La caducidad desvincula primero la fotografía del gasto y de la tarea vinculada, guarda el registro económico y después elimina la copia de Drive. Si no hay conexión, la eliminación queda en cola.
- El registro del gasto (importe, fecha, concepto y demás campos) se conserva.
- El código ManteniPro_Code_Fotos.gs incluido admite entityType "expenses" y utiliza la carpeta común Fotografias/Gastos. Para activar la subida y el borrado remoto de estas fotos, sustituye Code.gs por el archivo incluido y publica una nueva versión de la implementación web manteniendo la misma URL /exec.
- No se activa caducidad automáticamente: el valor predeterminado es "Sin caducidad". Al elegir un plazo, la aplicación solicita confirmación porque las fotos antiguas que ya superen ese plazo se eliminarán.
