# Smoke real WebAPI del asistente global

**Estado:** activo, acotado a QA del asistente; contrato funcional principal en `AI-ACTION-ASSISTANT-EXTENSION-SPEC.md`.
**Rama/PR:** `feat/household-floorplan` / #47 Draft. Sin merge, deploy ni cambio de proveedor persistente.

## Alcance y seguridad

- Usar solo el WebAPI local activo y su proveedor externo ya configurado; crear cuenta/configuración/token temporales dentro del runner aislado.
- Usar SQLite temporal y nombres sintéticos. No leer, enviar ni persistir datos reales de hogar, despensa o recetas.
- Decisión de contrato interno: pedir cada payload de acción en `payloadJson` como JSON en texto para mantener pequeños los esquemas estrictos del proveedor; parsearlo y validarlo con el esquema Zod completo antes de resolver o devolver acciones. La API pública sigue entregando `payload` como objeto.
- Desactivar temporalmente el logging/captura de detalles autorizado por el usuario; registrar sus valores originales en memoria y restaurarlos/verificarlos en `finally`. Grabación de sesión y HTML diagnóstico siguen apagados.
- El WebAPI tenía `replyInactivityTimeoutMs=120000`: una petición real agotó ese límite. Para completar el smoke, subirlo temporalmente a 210000 ms, guardar el valor original en memoria y restaurarlo/verificarlo en el mismo `finally`; el timeout de la app y el proxy permanecen dentro de sus límites actuales.
- No guardar ni imprimir bearer, prompts, respuesta completa, secretos, contenido personal ni capturas del smoke real.

## Checklist de aceptación

- [x] Diagnosticar y corregir el selector E2E de recetas: el ID está en el propio `app-picker`, no en un padre. La regresión sintética falla con `#generated-recipe-detail-level app-picker` y pasa con `#generated-recipe-detail-level` en escritorio y móvil.
- [x] Añadir un modo opt-in exclusivo para propuestas del asistente: 10 solicitudes secuenciales únicas a `POST /api/ai/assistant/proposals` mediante el proxy que conecta con WebAPI real; cada entrada exige esquema estricto `ai_action_plan`, HTTP 2xx, JSON válido y respuesta aceptada por la ruta.
- [x] Reducir los tres esquemas estrictos de propuestas y refinamiento sin debilitar la validación local: miden 6667, 6665 y 6677 bytes; el contrato de `payloadJson` se deriva de Zod y el servidor valida el payload completo antes de normalizar o devolver acciones.
- [x] Ejecutar E2E con una cuenta temporal y probar que cada propuesta de alta queda sin seleccionar ni confirmar y que su snapshot no cambia despensa, ledger ni `ai_jobs`.
- [x] Exigir diez operaciones proveedor-asistente consecutivas con contrato válido tras el fallo diagnosticado; cualquier error/incompleto reinicia el conteo. Confirmar cleanup de token, proxy, DB y app aislada.
- [x] Subir solo durante el smoke `replyInactivityTimeoutMs` de 120000 a 210000 ms y restaurar/verificar todos los límites AI originales, incluso ante fallo/cancelación.
- [x] Verificar con evidencia que el logging sensible se desactiva solo durante el smoke y que todos los valores originales se restauran, incluso ante fallo/cancelación.
- [x] Ejecutar coverage instrumentada y reportar statements/branches/functions/lines por separado. No afirmar 100 % sin un reporte reproducible; mantener los umbrales existentes y documentar toda rama fuera de alcance del proveedor real.

## Evidencia

- 2026-10-17: el smoke anterior recibió una respuesta real HTTP 200 y validó el contenido de receta; el E2E falló antes de la segunda petición porque el locator buscaba un `<app-picker>` dentro del `<app-picker>` con ID. La prueba determinista reprodujo el fallo y pasó después de cambiar ambos locators al ID correcto. No se volvió a enviar un prompt real todavía.
- 2026-10-17: la prueba focal sintética pasó en Chromium con viewport 1440×900 y 393×851. La ejecución fallida usó únicamente SQLite temporal y sus artefactos se limpiarán tras registrar la evidencia.
- 2026-10-17: la primera prueba real de propuesta falló en la solicitud 1/10 con HTTP 413; el esquema `ai_action_plan` mide 23 237 bytes frente al máximo local de WebAPI (12 000), por lo que no llegó al proveedor externo. No se cuenta como éxito. El runner limpió la cuenta/app/SQLite temporales y el WebAPI restauró y verificó `requestLogging.enabled=true` y `captureDetails=true`; grabación y HTML diagnóstico siguieron apagados.
- 2026-10-17: con el schema compacto, cinco propuestas reales consecutivas devolvieron HTTP 200 y una acción pendiente/no seleccionada. La sexta recibió HTTP 504 al alcanzar `replyInactivityTimeoutMs=120000`; el conteo se reinició. La ejecución aún no comprobó el snapshot final, así que no se afirma cero escrituras. Se restauraron/verificaron `requestLogging.enabled=true` y `captureDetails=true`; grabación y HTML diagnóstico siguieron apagados. El contrato de payload se deriva de Zod, va en la descripción estructurada y mantiene los tres formatos bajo 12 KB. El siguiente smoke comprobará snapshot tras cada propuesta, usará temporalmente 210 s de inactividad y restaurará los ocho límites AI originales.
- 2026-10-17: el smoke aislado con WebAPI real (`gpt-5`) completó 10/10 respuestas HTTP 200 en 171350 ms, con esquema estricto y respuesta JSON de plan de acciones verificadas para las diez. Chrome confirmó cada acción pendiente/no seleccionada y comparó la SQLite temporal completa con su snapshot inicial tras cada propuesta: sin cambios en despensa, ledger ni ninguna tabla; `ai_jobs` permaneció vacío. La cuenta/configuración/tokens, proxy, aplicación y DB temporales se limpiaron al terminar. Durante la prueba `replyInactivityTimeoutMs` subió de 120000 a 210000 y request logging/captura se apagaron; se restauraron y verificaron todos los límites AI, la configuración original de logging/captura y los estados originales (apagados) de grabación/HTML diagnóstico. No se guardaron prompts, respuestas, credenciales ni capturas reales.
- 2026-10-17: `pnpm --filter @hogaria/server run test:coverage` pasó: 121 archivos OK, 2099 pruebas OK, 1 skip; coverage global servidor = statements 89.61 %, branches 81.80 %, functions 95.80 %, lines 92.56 %. En el alcance IA, `ai-assistant.routes.ts` = 83.36/71.51/88.73/85.15 % y `ai-assistant.schema.ts` = 90.76/85.49/100/92.69 % (mismo orden). Se cumplen los gates por fichero actuales (70 %); esto no es 100 % y el informe enumera ramas/código fuera del flujo probado.
