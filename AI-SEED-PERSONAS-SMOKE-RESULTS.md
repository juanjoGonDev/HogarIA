# Perfiles sintéticos y smoke de IA — resultados

**Ejecución:** 26-11-2026 · rama `feat/calendar-recipe-cooking` · PR #72 (Draft).
**Estado:** generador y UI E2E verificados; smoke real de generación IA pendiente por el preflight de privacidad de WebAPI.

## Matriz generada

- 10 cuentas con emails únicos bajo `hogaria.test`: 2 perfiles individuales, 2 miembros de pareja y 6 de hogar numeroso.
- 4 hogares: dos de una persona, pareja de 2 y familia de 6; todos los roles válidos (`admin`, `member`, `child`) aparecen.
- La matriz cubre los niveles de cocina, objetivos, módulos, dietas, tolerancias de picante, tamaños de ración y severidades de alergia del contrato actual.
- El API exige completar el hogar antes de leer/editar el perfil (`HOUSEHOLD_REQUIRED`, HTTP 409). Por eso «solitario» significa cuenta individual con hogar propio de un miembro, no una cuenta sin hogar.
- Registro y login reutilizan la contraseña común del helper E2E; el generador no la duplica. Tokens viven solo en la ejecución/browser aislados. Capturas usan nombres y emails sintéticos.

## Contrato de perfil persistido

- El E2E escribe y vuelve a leer cada perfil por `GET /api/auth/taste`; contrasta objetivos, alergias, gustos, aversiones, notas, nivel de cocina y módulos. La lectura de hogares comprueba miembros/roles.
- `household.schema.ts` declara dietas, picante, ración y severidad, pero su `updateMemberSchema` no está cableado a una ruta vigente. La API activa solo admite alergias por nombre y notas libres; por eso los datos sintéticos adicionales se codifican en `taste.notes`. No se presentan como campos estructurados persistidos ni se escribe SQLite directamente.

## Verificaciones ejecutadas

| Comando                                                                                                                                                                                                                                                                   | Resultado                                                                                                                                                                                          |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `node --test scripts/ai-persona-seeds.test.mjs`                                                                                                                                                                                                                           | PASS · 4/4; determinismo, valores de esquema, rechazo de IDs inseguros y guardas de aislamiento.                                                                                                   |
| `pnpm run test:config`                                                                                                                                                                                                                                                    | PASS · 150/150; incluye gates de smoke, privacidad, cancelación y configuración del runner.                                                                                                        |
| `pnpm run typecheck:e2e`                                                                                                                                                                                                                                                  | PASS.                                                                                                                                                                                              |
| `pnpm exec prettier --check package.json scripts/ai-persona-seeds.mjs scripts/ai-persona-seeds.d.mts scripts/ai-persona-seeds.test.mjs tests/e2e/ai-persona-seeds.spec.ts tests/e2e/helpers/auth.ts tests/e2e/helpers/ai-persona-seeds.ts AI-SEED-PERSONAS-SMOKE-SPEC.md` | PASS.                                                                                                                                                                                              |
| `$env:HOGARIA_AI_SEED_GENERATION='1'; node scripts/run-isolated-playwright.mjs --grep 'genera perfiles sintéticos solos y de hogar con la matriz completa'`                                                                                                               | PASS · Chromium; dos proyectos móviles se omiten intencionadamente para evitar duplicar escrituras en la misma DB por ejecución. La app y SQLite fueron aisladas en `hogaria-e2e-*` bajo `%TEMP%`. |
| `$env:HOGARIA_AI_SEED_GENERATION='1'; $env:HOGARIA_AI_SEED_CLEANUP_ON_FAILURE='1'; $env:HOGARIA_AI_SEED_GENERATION_INJECT_FAILURE='after-seed'; node scripts/run-isolated-playwright.mjs --grep 'genera perfiles sintéticos solos y de hogar con la matriz completa'`     | PASS · fallo inyectado tras crear 10 usuarios/4 hogares; proceso y puerto propios cerrados, SQLite temporal eliminada; no quedó nuevo directorio `hogaria-e2e-*`.                                  |

## Capturas sintéticas

Generadas tras esperar contenido visible y comprobar el recuento de miembros; `.e2e-screenshots/` está ignorado por Git.

- Escritorio, cuenta individual: `.e2e-screenshots/ai-persona-seeds/solo-desktop.png`
- Móvil, cuenta individual: `.e2e-screenshots/ai-persona-seeds/solo-mobile.png`
- Escritorio, familia de seis: `.e2e-screenshots/ai-persona-seeds/family-desktop.png`
- Móvil, familia de seis: `.e2e-screenshots/ai-persona-seeds/family-mobile.png`

## Estado del smoke real de IA

- El grupo DevBar `IA` estaba con `dev` detenido; se inició el comando configurado. WebAPI quedó escuchando en `127.0.0.1:3001` y reportó readiness y sesión de proveedor listas.
- El preflight oficial **rechazó antes de crear token o enviar una generación**: WebAPI tiene activo el modo debug/captura de peticiones. También rechaza el modo de logs redacted porque el estado actual no satisface sus límites de privacidad.
- No se cambiaron los controles de WebAPI ni se llamó al modelo. El smoke solo continúa tras apagar captura/debug temporalmente y restaurar exactamente el estado previo; se pidió aprobación al usuario.
- Pendiente: con privacidad habilitada de forma segura, ejecutar la matriz finita existente por flujos/job y perfiles; sin reintentos ciegos. El smoke de IA no está verificado aún.

## Hallazgo UI

La tarjeta del perfil con nivel `none` muestra literalmente `profile.cooking.none` en vez de su traducción. Capturado en la tarjeta sintética individual; registrado como hallazgo, no corregido en este cambio de harness.

## Límites

No se ejecutó una generación real de IA, ni se recorrió el producto cartesiano de perfiles. No se declara que «todas las generaciones funcionan». La matriz viva, la cobertura de fallo/timeout/cancelación y gates CI restantes siguen pendientes en `AI-SEED-PERSONAS-SMOKE-SPEC.md`.
