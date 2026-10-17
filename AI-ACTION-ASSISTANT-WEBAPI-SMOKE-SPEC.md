# Smoke real WebAPI del asistente global

**Estado:** activo, acotado a QA del asistente; contrato funcional principal en `AI-ACTION-ASSISTANT-EXTENSION-SPEC.md`.
**Rama/PR:** `feat/household-floorplan` / #47 Draft. Sin merge, deploy ni cambio de proveedor persistente.

## Alcance y seguridad

- Usar solo el WebAPI local activo y su proveedor externo ya configurado; crear cuenta/configuración/token temporales dentro del runner aislado.
- Usar SQLite temporal y nombres sintéticos. No leer, enviar ni persistir datos reales de hogar, despensa o recetas.
- Decisión de contrato interno: pedir cada payload de acción en `payloadJson` como JSON en texto para mantener pequeños los esquemas estrictos del proveedor; parsearlo y validarlo con el esquema Zod completo antes de resolver o devolver acciones. La API pública sigue entregando `payload` como objeto.
- Desactivar temporalmente el logging/captura de detalles autorizado por el usuario; registrar sus valores originales en memoria y restaurarlos/verificarlos en `finally`. Grabación de sesión y HTML diagnóstico siguen apagados.
- No guardar ni imprimir bearer, prompts, respuesta completa, secretos, contenido personal ni capturas del smoke real.

## Checklist de aceptación

- [x] Diagnosticar y corregir el selector E2E de recetas: el ID está en el propio `app-picker`, no en un padre. La regresión sintética falla con `#generated-recipe-detail-level app-picker` y pasa con `#generated-recipe-detail-level` en escritorio y móvil.
- [ ] Añadir un modo opt-in exclusivo para propuestas del asistente: 10 solicitudes secuenciales únicas a `POST /api/ai/assistant/proposals` mediante el proxy que conecta con WebAPI real; cada entrada exige esquema estricto `ai_action_plan`, HTTP 2xx, JSON válido y respuesta aceptada por la ruta.
- [ ] Reducir los tres esquemas estrictos de propuestas y refinamiento sin debilitar la validación local: ocupan 23 237, 23 235 y 23 247 bytes, y WebAPI los rechaza sobre su límite de 12 000 con HTTP 413 antes de llamar al proveedor. Mantener el contrato de acciones revisables y validar el payload completo en servidor antes de normalizar o devolverlo.
- [ ] Ejecutar E2E con una cuenta temporal y probar que las propuestas de alta quedan sin seleccionar ni confirmar, y que no cambian despensa, ledger ni `ai_jobs`.
- [ ] Exigir diez operaciones proveedor-asistente consecutivas con contrato válido tras el fallo diagnosticado; cualquier error/incompleto reinicia el conteo. Confirmar cleanup de token, proxy, DB y app aislada.
- [ ] Verificar con evidencia que el logging sensible se desactiva solo durante el smoke y que todos los valores originales se restauran, incluso ante fallo/cancelación.
- [ ] Ejecutar coverage instrumentada y reportar statements/branches/functions/lines por separado. No afirmar 100 % sin un reporte reproducible; mantener los umbrales existentes y documentar toda rama fuera de alcance del proveedor real.

## Evidencia

- 2026-10-17: el smoke anterior recibió una respuesta real HTTP 200 y validó el contenido de receta; el E2E falló antes de la segunda petición porque el locator buscaba un `<app-picker>` dentro del `<app-picker>` con ID. La prueba determinista reprodujo el fallo y pasó después de cambiar ambos locators al ID correcto. No se volvió a enviar un prompt real todavía.
- 2026-10-17: la prueba focal sintética pasó en Chromium con viewport 1440×900 y 393×851. La ejecución fallida usó únicamente SQLite temporal y sus artefactos se limpiarán tras registrar la evidencia.
- 2026-10-17: la primera prueba real de propuesta falló en la solicitud 1/10 con HTTP 413; el esquema `ai_action_plan` mide 23 237 bytes frente al máximo local de WebAPI (12 000), por lo que no llegó al proveedor externo. No se cuenta como éxito. El runner limpió la cuenta/app/SQLite temporales y el WebAPI restauró y verificó `requestLogging.enabled=true` y `captureDetails=true`; grabación y HTML diagnóstico siguieron apagados.
