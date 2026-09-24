import { createApp, logger } from './bootstrap.js';
import { loadConfig } from './config.js';

// La credencial del dueño del esquema solo sirve para las migraciones (release_command, ADR-060). La API se conecta con
// su propio usuario sin BYPASSRLS; se borra del entorno para que Chromium, Tesseract y demás procesos no la hereden.
delete process.env.DATABASE_ADMIN_URL;
delete process.env.DATABASE_SUPERUSER_URL;
const config = loadConfig();
const app = await createApp();
await app.listen(config.port);
logger.log(`API de COROC escuchando en el puerto ${config.port}`);
