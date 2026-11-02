# Recuperación de trabajos IA bloqueados

**Estado:** Draft PR pre-implementación; implementación no iniciada.
**Base:** origin/master (b7a754e8bbcc9524d5d2d08d0197101abc46e635).
**Rama:** fix/ai-queue-stale-job-recovery.
**Alcance:** evitar que excepciones inesperadas o leases vencidas dejen jobs IA en running, bloqueen concurrencia o dejen el test de proveedor en testing. No cambiar protocolos ni degradar Responses background.

## Evidencia vigente

- server/src/utils/ticket-queue.ts:lanzar invoca correr(...).finally(...) sin capturar rechazos.
- correr consulta DB y metadata antes del try; la preparación del recibo y el preflight genérico también tienen operaciones previas al try.
- El bucle periódico reconcilia jobs encolados pero no recupera running con lease_until vencida.
- El job diagnosticado se quedó running, sin eventos de proveedor y sin petición /v1/* en WebApi. La causa inicial exacta ya no se puede reconstruir: el rechazo original no se persistía.
- Contrato vigente AI-REQUESTS-BACKGROUND-SPEC.md: toda llamada de modelo queda bajo job background; recarga/desconexión no cancela; no reejecutar trabajos con resultado ambiguo, para evitar duplicar coste o efectos.

## Decisiones

1. Capturar toda excepción que escape del worker; persistir fallo terminal usando compare-and-set por job id + running + claim_generation. No incluir mensajes/cuerpos/URLs/credenciales en DB o logs.
2. Clasificar los escapes como WORKER_EXCEPTION, con etapa segura y diagnóstico accionable; limpiar lease. Asentar la promesa en memoria una sola vez.
3. Barrer periódicamente leases vencidas o ausentes. Marcarlas failed con WORKER_STALLED; nunca reencolar automáticamente, pues no se sabe si proveedor ya aceptó la ejecución. Abortarla si sigue viva y liberar estado dependiente (receipt/config).
4. Mantener fencing por claim_generation: callbacks tardíos no pueden modificar un job cancelado, recuperado o reclamado de nuevo.
5. Validar en Playwright contra HogarIA aislada en DB temporal y WebApi local real. Sin mocks en esta prueba opt-in; sin escribir en DB habitual. El caso mínimo real reproduce el test de conexión. Luego recorrer matriz de herramientas AI que la instalación admita, de forma secuencial, con inputs sintéticos y sin aplicar acciones no confirmadas. La búsqueda de imágenes que no usa un modelo se registra como integración real separada.

## Criterios de aceptación

### Cola y recuperación

- [ ] Una excepción de preflight antes de provider termina job y promesa; lease queda limpia; no hace request externo duplicado.
- [ ] Excepción inesperada en jobs genéricos y receipts termina fila mediante CAS, actualiza estado dependiente y no filtra datos sensibles.
- [ ] El barrido detecta leases vencidas y ausentes, libera concurrencia y actualiza receipt/config asociada; no toca jobs con lease futura.
- [ ] Una recuperación no reintenta automáticamente ni pisa estados/cambios de una generación más nueva; aborto/resolución repetidos son idempotentes.
- [ ] Tests cubren estado terminal previo, claim_generation nuevo, cancelación/resultado tardío, disponibilidad de provider y ausencia de llamadas duplicadas.

### Navegador + proveedor real, aislados

- [ ] Ejecutar Playwright real contra stack local aislado, sin mock de provider, con WebApi y sesión/modelo reales. Un POST de test de conexión devuelve 202; al cerrar/recargar la vista, la cola y configuración siguen mostrando el mismo job activo hasta terminal.
- [ ] Confirmar una sola ejecución de connection test, diagnóstico final legible, concurrencia liberada y ningún job colgado.
- [ ] Ejecutar secuencialmente la matriz live de workflows habilitados (recetas, múltiples recetas, mejora, reemplazo, recomendaciones, planificación, estimación de caducidad, foto de compra, lectura de ticket sintético, plan de hogar, asistente y búsqueda real de imágenes). Cada resultado debe ser terminal/usable; se documentan rutas que requieren fixture o no son llamadas LLM.
- [ ] Las llamadas live usan solamente DB temporal/usuario/hogar semilla; presupuesto acotado, proveedor y servicios preexistentes no reiniciados. Token desde env/almacén, jamás persistido o mostrado.
- [ ] Guardar evidencia sintética desktop/móvil solo si se cambia UI; no guardar screenshots/logs/traces con datos personales o secretos.

### Entrega

- [ ] Regresión TDD falla antes y pasa después.
- [ ] Suite focal server, cobertura >=70 % en métricas aplicables, suite requerida, build y typecheck pasan.
- [ ] PR único desde origin/master, CI verde y Ready for review solo tras completar criterios; no merge.

## Evidencia de implementación

Pendiente. Registrar aquí comandos, resultados, limitaciones y cobertura de cada escenario live.
