# Hogar: proveedores de IA y registro

**Estado:** Draft — contrato activo para esta rama, pendiente de implementación y evidencia.
**Base revalidada:** `origin/master` en `536c2e0ea509d05e3f2131f7e6272cc138539fdf` (commit documental de esta spec, publicado por separado y conservado por decisión del usuario).

## Objetivo y decisiones

- La configuración de proveedores vive en **Hogar → Ajustes** y conserva el aislamiento por hogar y el permiso `settings`.
- Se permiten varios proveedores activos. La configuración asigna cada función de IA a un proveedor activo; con un proveedor se muestra su nombre sin selector y con varios se ofrece un selector por función.
- Las funciones visibles son: **Asistente**, **Recetas y recomendaciones**, **Planificación**, **Compra y despensa** y **Automatización del hogar**. Todos los `AiJobKind` y caminos directos del servidor se asignan exactamente a una función; `connection_test` siempre usa la configuración probada.
- Al crear la primera configuración activa, todas las funciones usan esa configuración. Si se desactiva o elimina un proveedor en uso, se advierte antes de confirmar y las funciones afectadas pasan al proveedor activo más antiguo (`created_at ASC, id ASC`). Si no queda ninguno, quedan sin proveedor y la IA informa cómo configurarlo.
- La cola conserva el hogar y el proveedor fijados al admitir un trabajo. Cambiar una asignación nunca redirige trabajos ya admitidos ni permite fallback entre hogares.
- El límite de timeout actual de 240 s se eleva a **600 s** para probar proveedores lentos. UI, API y transporte comparten ese límite; la concesión del worker debe superarlo con margen. El campo puede omitirse para usar el default actual de 30 s; no se introduce un mínimo de producto adicional, aunque un valor explícito debe ser un entero positivo.
- Un test de conexión persistido muestra estado `testing` antes de iniciar la petición, impide duplicados y permite reanudar la consulta de estado tras recargar. El estado/resultado puede persistirse; claves y credenciales efímeras nunca se escriben en tablas de jobs, estado de test, logs ni navegador persistente.
- El registro pide repetir la contraseña y valida igualdad en cliente. Solo se envía la contraseña original al servidor.
- La entrega será **un único PR**, por decisión explícita del usuario aunque el diff supere 400 líneas; documentar esa excepción con la etiqueta `size:exception` y mantener el PR en Draft durante el trabajo.

## Fuente de verdad y discrepancias

- `HOGARIA-SPEC.md` §12am y §12an documentan la antigua configuración mono-activa. Esta spec supersede **solo** la regla de exclusividad; endpoint OpenAI-compatible, redacción de claves, dispatcher único, límites de cola y jobs fijados siguen vigentes.
- `HOGARIA-SPEC.md` §12ap y `QA-HOUSEHOLD.AI.HOME-CONFIG-AND-PINNED-JOBS.1` mantienen el scope, ACL y pinning por hogar.
- `SPEC.md` del asistente global no gestiona credenciales ni proveedores; esta spec cubre la configuración que consume.
- El log adjunto `Texto pegado.txt` solo registra health/readiness/receipts con 200 y no contiene solicitudes al conector ni timeouts. No basta para atribuir la causa exacta del fallo; validar el comportamiento con el harness aislado y guardar el límite como incertidumbre si persiste.
- En el estado actual, `createAiConfigSchema` limita timeout a 240000 ms, `testConnectionSchema` no comparte ese tope y `ticket-queue.ts` usa una concesión fija de 300 s. El test de conexión guarda resultado final pero no estado previo duradero. Registro tiene password único y el backend solo espera ese campo.

## Checklist de aceptación

### Proveedores, asignaciones y hogar

- [ ] Migrar sin perder proveedores, secretos, jobs, hogares ni preferencias existentes. Inicializar cada función con el proveedor activo más antiguo (`created_at ASC, id ASC`) del mismo scope; no cruzar hogares ni recurrir a filas personales.
- [ ] Crear, editar, activar y desactivar varios proveedores sin apagar los demás. La API rechaza asignaciones a proveedor inexistente, inactivo o de otro hogar; `api_key` nunca sale en respuestas.
- [ ] Routear `recipe`/`multiple_recipes` y `recommendations` a **Recetas y recomendaciones**; `weekly_plan`/`household_plan` a **Planificación**; `receipt`, `shopping_photo`, `expiry_estimate` y búsqueda de imagen de producto a **Compra y despensa**; automation worker a **Automatización del hogar**; runtime global a **Asistente**. Auditar cada llamada del dispatcher, streaming y caminos directos. El test usa el proveedor probado, no una asignación global.
- [ ] Al desactivar o eliminar un proveedor asignado, mostrar una advertencia accesible que identifique los usos afectados y confirme la sustitución por el proveedor activo más antiguo; si no queda proveedor, dejar esos usos sin asignación y mostrar la vía de configuración.
- [ ] Probar la selección de proveedor y la sustitución automática en la API con dos hogares, permisos `settings`, múltiples proveedores activos y jobs admitidos antes del cambio. Reasignaciones y listados siguen aislados por hogar.
- [ ] Reubicar/reutilizar componentes de proveedor en Hogar → Ajustes, sin duplicar su gestor actual. Mantener accesos de compatibilidad o redirección para enlaces guardados; no cambiar la ACL servidor.
- [ ] Con un proveedor activo, mostrarlo fijo; con varios, mostrar selectores por función solo con opciones activas. Con cero activos, no mostrar selector falso.
- [ ] Ocultar el acceso global a IA cuando no haya proveedor activo. Los demás puntos de generación muestran un modal accesible con enlace directo a Hogar → Ajustes en vez de disparar una petición fallida; el backend conserva sus guards.

### Timeout y estado del test de conexión

- [ ] UI, esquemas de alta/edición/test y transporte aceptan hasta 600000 ms, con validación compartida, error claro en límites y default de 30000 ms cuando se omite.
- [ ] Ajustar la concesión de jobs para que supere el timeout máximo más un margen documentado; una petición lenta no se reintenta ni se ejecuta dos veces por vencer el lease antes del timeout.
- [ ] Persistir estado `testing` de config guardada antes de lanzar el test. Una segunda petición concurrente o posterior a recarga no inicia otra ejecución; la UI recupera/polleará estado hasta éxito/error y siempre libera el control al terminar.
- [ ] Cubrir terminación normal, error de proveedor, abort/timeout, recarga, concurrencia, caída/reinicio y recuperación de un estado `testing` obsoleto. Los errores persistidos se redactan y el lock no queda permanente.
- [ ] Mantener la prueba de formulario sin guardar. Identificarla para evitar reenvío de la misma ejecución tras recargar sin persistir API key, URL con credenciales ni datos de proveedor en almacenamiento persistente.

### Registro

- [ ] Añadir campo accesible e internacionalizado para repetir contraseña; detectar vacío y discrepancia antes de solicitar registro.
- [ ] Probar igualdad, error corregible y reintento; el POST conserva exactamente `{name,email,password}` y nunca incluye el campo repetido.

### Verificación y entrega

- [ ] TDD con pruebas focales para cada contrato, extremos/límites, carreras, cancelación, recarga, persistencia, permisos y ausencia de proveedor. Suite usa SQLite temporal y provider HTTP sintético; no escribe en la BD habitual ni llama proveedores reales.
- [ ] Playwright real app/API con datos sintéticos: escritorio y móvil, enlace de configuración, selector y fallback, recarga de test sin duplicado, estados sin proveedor, registro, teclado/foco, modal/scroll y breakpoints afectados. Guardar e inspeccionar capturas comparables PC/móvil ignoradas por Git.
- [ ] Comprobar i18n ES/EN, nombres accesibles, controles táctiles y geometría equivalente con tolerancia máxima de 1 CSS px. Cobertura del código nuevo/modificado ≥70 % en statements, ramas, funciones y líneas, sin rebajar gates existentes; registrar límites y comandos/resultados reales.
- [ ] Mantener esta checklist actualizada; marcar cada casilla solo con evidencia reproducible. La rama y cada PR permanecen Draft; no mergear.

## Unidades de entrega

1. Registro: repetir contraseña, validación local, traducciones y pruebas.
2. Timeout/test: límite seguro, estado persistente, deduplicación y recuperación.
3. Multi-proveedor: migración, asignaciones, routing y guards.
4. Hogar/UI: mover gestor, selectores, avisos, flujo sin configuración y E2E.

Cada unidad debe incluir pruebas y evidencia. No iniciar implementación hasta publicar esta spec en Draft PR.
