# HogarIA — test IA en segundo plano, logs de runtime y actualización web

**Estado:** contrato activo para esta rama; pendiente de implementación y pruebas.
**Base:** `master` (`83ee351`); el repositorio no tiene rama `main`.
**Rama/PR:** `fix/runtime-smoke-cache-refresh`; abrir Draft contra `master` antes de implementar.

## Fuente de verdad y alcance

- El contrato de proveedores vigente es `AI-PROVIDER-SETTINGS-SPEC.md`: el test de una configuración guardada debe persistir `testing` antes de empezar, deduplicar ejecuciones y reanudar consulta tras recarga (`§ Objetivo`, `§ Timeout y estado del test de conexión`). Esta unidad implementa ese comportamiento, no el resto del trabajo de proveedores.
- Ahora `POST /api/ai/test-connection` espera a `pingDeConexion()` y solo guarda resultado final; `test_status` existe en `ai_configs`, pero la UI conserva `probandoId` solo en memoria del componente. Por eso refresh pierde el indicador y otra petición puede disparar otro ping.
- `/health` ya expone segundos de `process.uptime()`, pero la página Logs no consulta esa ruta y `version` está codificada en `1.0.0`. La imagen GHCR ya etiqueta revisión OCI con `github.sha`; runtime no recibe esa revisión.
- El servidor Node devuelve `no-cache` para `index.html` y caché larga solo para assets con hash. Nginx da `public, immutable` por siete días a todos los JS/CSS y no define política explícita para shell/service worker. Angular usa service worker en producción y no hay flujo explícito de aviso/recarga de una versión nueva.
- El nuevo remoto es `https://github.com/juanjoGonDev/HogarIA.git`; la rama predeterminada verificada es `master`. Actualizar referencias activas de soporte y User-Agent, no borrar nombres antiguos de migración ni reescribir evidencia histórica.

### Decisiones de seguridad

- El test reanudable cubre configuraciones guardadas. No persistir claves en jobs, historial, URL, `localStorage`, logs ni telemetría. El test del formulario sin guardar mantiene su flujo efímero y no se reenvía tras recarga.
- El trabajo guardado se reclama atómicamente por configuración. Una petición repetida devuelve/consulta la ejecución existente; nunca lanza un segundo ping mientras siga activa.
- El trabajo continúa en el servidor aunque cliente navegue, recargue o cierre pestaña. Si proceso servidor cae, cerrar estado obsoleto como interrumpido; no dejar `testing` infinito ni relanzar llamadas reales implícitamente.
- El código de revisión de imagen se inyecta al construirla y coincide con `org.opencontainers.image.revision`; no montar socket Docker ni inspeccionar otros contenedores.
- Conservar caché larga únicamente para recursos versionados por hash. Shell y manifiestos del service worker deben revalidar. Avisar sobre actualización disponible sin recargar automáticamente y perder cambios de formulario.

## Criterios de aceptación

### 1. Test de conexión IA — una ejecución reanudable

- [ ] Al probar una configuración guardada, API persiste `testing` y timestamp/identificador antes de aceptar trabajo en segundo plano; respuesta inicial no espera al proveedor.
- [ ] Claim es atómico en solicitudes concurrentes; al existir una ejecución activa para la configuración, las solicitudes duplicadas recuperan su estado y no llaman de nuevo al proveedor.
- [ ] Navegar, cerrar pestaña o recargar no cancela la ejecución. Al abrir de nuevo Ajustes, UI muestra `testing`, consulta estado hasta `success`/`failed`/`interrupted` y luego detiene polling sin volver a iniciar el test.
- [ ] Reinicio/fallo de servidor no deja estado `testing` permanente. Estados, timeout y errores recuperados no exponen claves, URLs con credenciales ni respuesta del proveedor.
- [ ] Test de formulario sin guardar sigue sin persistir credenciales y no se repite automáticamente al recargar.
- [ ] Pruebas reproducen duplicado concurrente, éxito, fallo, timeout, cierre del cliente, refresh, estado obsoleto y ausencia de datos secretos; DB siempre aislada.

### 2. Logs — uptime y versión real de imagen

- [ ] Barra Logs muestra uptime del servidor formateado legiblemente y revisión/tag inyectado al build de la imagen GHCR; ES/EN, estado de carga/error accesibles.
- [ ] `/health` y la app usan una única fuente de metadatos. Local/dev muestra valor explícito (`dev`); GHCR expone revisión igual a etiqueta OCI `org.opencontainers.image.revision`.
- [ ] Tests cubren mapeo/respuesta y renderizado; `scripts/container-smoke.mjs` sigue verificando uptime/version y comprueba revisión cuando el build la define.

### 3. Web actualizada sin servir shell obsoleto

- [ ] Nginx y servidor Node coinciden: `index.html`, `ngsw.json` y `ngsw-worker.js` revalidan en cada navegación/actualización; assets con hash conservan caché `immutable`; archivos sin hash no reciben caché inmutable larga.
- [ ] Angular detecta versión nueva y ofrece recarga explícita; no recarga a escondidas ni borra estado sin guardar. Tras aceptar, la app usa shell/worker nuevos.
- [ ] Tests comprueban cabeceras reales de servidor y contrato de Nginx, actualización del service worker y estado sin actualización; una sesión normal no depende de «hard refresh» manual.

### 4. Referencias al repo renombrado

- [ ] URLs de soporte/diagnóstico activas apuntan a `juanjoGonDev/HogarIA`.
- [ ] No se sustituyen nombres de compatibilidad/migración ni URLs/ramas de evidencia histórica sin necesidad demostrada.

### Verificación de UI y entrega

- [ ] Suites focales primero; luego `pnpm run test:config`, cliente/servidor, coverage ≥70 % S/B/F/L en código tocado, lint/build/typecheck aplicables y CI real de PR verde.
- [ ] Playwright contra app/backend reales y DB temporal: escritorio/móvil, refresh durante test, navegación/cierre de página, actualización pendiente, teclado/foco y breakpoints afectados. Capturas sintéticas comparables de Logs y actualización, ignoradas por Git; revisar geometría equivalente (≤1 CSS px).
- [ ] Registrar comandos, resultados y limitaciones aquí. Marcar casillas solo con evidencia reproducible. Mantener Draft hasta gates verdes; no mergear.

## Unidades

1. Test persistido en segundo plano, UI reanudable y pruebas.
2. Uptime/revisión GHCR y tests.
3. Política de caché/service worker y pruebas de actualización.
4. URLs activas del repo, tests/checks finales y evidencia.
