import { createApp, logger } from './bootstrap.js';
import { loadConfig } from './config.js';

const config = loadConfig();
const app = await createApp();
await app.listen(config.port);
logger.log(`API de COROC escuchando en el puerto ${config.port}`);
