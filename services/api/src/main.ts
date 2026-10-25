import { createApp, logger } from './bootstrap.js';
import { loadConfig } from './config.js';

// La credencial del dueño del esquema solo sirve para las migraciones (release_command, ADR-060). La API se conecta con
// su propio usuario sin BYPASSRLS; se borra del entorno para que Chromium, Tesseract y demás procesos no la hereden.
delete process.env.DATABASE_ADMIN_URL;
delete process.env.DATABASE_SUPERUSER_URL;
const config = loadConfig();
// La clave de esta ejecución de Escritorio tampoco pasa a los procesos hijos: ya quedó en la configuración.
delete process.env.COROC_DESKTOP_TOKEN;
const app = await createApp();
if (config.host) await app.listen(config.port, config.host);
else await app.listen(config.port);
logger.log(`API de COROC escuchando en el puerto ${config.port}`);

// COROC Escritorio (ADR-062): el supervisor pide el cierre por el canal IPC, porque en Windows no hay SIGTERM. Se
// terminan las peticiones y tareas en curso y se cierran las conexiones antes de salir.
let closing = false;
process.on('message', (m) => {
  if (m !== 'shutdown' || closing) return;
  closing = true;
  void app.close().then(
    () => process.exit(0),
    () => process.exit(1),
  );
});
process.send?.({ evento: 'escuchando', puerto: config.port });
