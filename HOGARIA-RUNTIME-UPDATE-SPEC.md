# HogarIA: test de conexión, diagnóstico y actualización de la web

**Estado:** Draft — alcance adicional solicitado; implementación pendiente.
**Rama/PR:** `feat/ai-provider-settings` / Draft PR #56. No mergear.
**Base:** `origin/master` integrado en `6280148`.

## Objetivo

Completar el flujo de prueba de conexión de IA independiente del navegador, mostrar estado del proceso e imagen en Logs, y evitar servir una versión web desactualizada tras una publicación. Actualizar los enlaces de soporte activos tras el renombre del repositorio.

## Decisiones y evidencia inicial

- El test guardado ya reclama `test_status='testing'` de forma atómica y usa la cola de IA sin propagar `Request.signal`; cerrar la pestaña no cancela el trabajo del servidor. La UI carga y consulta ese estado. Falta un E2E que cierre el contexto que inició el test y confirme resultado y ausencia de duplicado.
- `/api/health` ya devuelve `uptime`, pero la vista Logs no lo consulta ni lo muestra. El tag de imagen no está disponible en runtime; el workflow publica el manifiesto con SHA y `latest`.
- El servidor entrega `index.html` con `Cache-Control: no-cache` y chunks hasheados como `immutable`, pero falta revalidación de `ngsw.json` y gestión explícita de `VERSION_READY`/recarga.
- El remote ya apunta a `https://github.com/juanjoGonDev/HogarIA.git`; los enlaces de soporte activos y algunos `User-Agent` aún apuntan a `MiCocinAI`. Los enlaces de ejecuciones históricas no se reescriben.

## Checklist de aceptación

- [ ] Probar una configuración guardada crea un único trabajo persistente; el estado «En curso» se ve tras recargar o cerrar la pestaña iniciadora y abrir otra, el proceso concluye y no se reenvía/duplica el test.
- [ ] Los logs muestran tiempo de actividad del proceso actualizado y tag exacto de la imagen GHCR; builds locales indican claramente que el tag no corresponde a una publicación.
- [ ] `index.html` y el manifiesto del service worker se revalidan; al detectar una versión nueva, el navegador activa la versión y muestra el código actualizado sin depender de un caché obsoleto. Los chunks con hash pueden seguir siendo `immutable`.
- [ ] Actualizar a `https://github.com/juanjoGonDev/HogarIA` los enlaces activos del producto, configuración y agentes HTTP; conservar URLs históricas de runs/PRs.
- [ ] Añadir pruebas unitarias/integración y Playwright con datos sintéticos para los casos anteriores; comprobar escritorio y móvil y guardar capturas en artefactos ignorados por Git.
- [ ] Verificar coverage local existente (≥70 % en statements, branches, functions y lines), build, typecheck, suite full-stack aislada y CI remota en el HEAD final. Mantener el PR Draft.

## Seguridad y aislamiento

- No guardar ni incluir API keys en jobs/logs/capturas. Para E2E, usar solo el proveedor HTTP sintético existente y SQLite temporal aislada.
- No borrar/cambiar datos, migrar servicios remotos, publicar imágenes ni desplegar como parte de esta tarea.
