# coroc_bookmarks

Complemento de COROC solo para macOS (§16.2, ADR-036). La app corre en el sandbox de macOS: para seguir escribiendo en la
carpeta COROC que el usuario eligió, guarda un marcador de seguridad (*security-scoped bookmark*) y lo abre en cada
inicio.

- `pickDirectory` muestra `NSOpenPanel`, crea la carpeta si hace falta y devuelve la ruta y el marcador.
- `resolve` abre el marcador guardado, inicia el acceso y avisa si el marcador quedó obsoleto (se renueva).
- `stop` termina el acceso.
