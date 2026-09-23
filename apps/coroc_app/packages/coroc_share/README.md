# coroc_share

«Compartir con COROC» (§12.4). En Android, COROC aparece en la hoja de compartir para imágenes y PDF
(`ACTION_SEND` y `ACTION_SEND_MULTIPLE`; los filtros de intención los agrega `tool/patch_platforms.py`). En iOS,
COROC aparece para abrir imágenes y PDF (tipos de documento en `Info.plist`) y el plugin recibe los archivos por el
ciclo de vida de la escena. En ambos casos el archivo se copia a la caché de la app y la app lo envía a la Bandeja.
