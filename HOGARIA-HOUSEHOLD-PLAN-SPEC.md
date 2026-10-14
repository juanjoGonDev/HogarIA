# HogarIA — Plano interactivo del hogar y tareas por zonas

Estado: **seguimiento de calidad visual abierto; política de planificación de comidas confirmada y en implementación; PR #47 en Draft · 2026-10-13**

Este contrato concreta capacidades de HogarIA y complementa las reglas compartidas de
`HOGARIA-SPEC.md` §12ap (aislamiento por hogar, membresía, permisos y proveedor de IA) y §13
(tareas del hogar pendientes). La extensión de planificación de comidas descrita al final mantiene
el calendario existente como calendario único: añade a él eventos de comida/tareas del hogar, sin
reemplazar su vista ni modificar las recetas guardadas. Su implementación se realiza por unidades
atómicas en el PR #47; los criterios de aceptación siguen abiertos hasta tener evidencia.

## Objetivo

Cada hogar puede mantener un plano editable, dibujarlo en un lienzo, construirlo con zonas guiadas
o convertir una foto/boceto mediante IA. Las tres vías se combinan en el mismo editor; no son
modos excluyentes. El plano se puede corregir después, en cualquier momento, con el editor, una
nueva foto o una petición de chat con el estado actual como contexto. La pestaña **Tareas** permite
asociar tareas a zonas y planificarlas para la semana, manualmente o con reparto aleatorio justo.

## Zonas disponibles

El selector presenta las zonas agrupadas y traducidas a español/inglés. El catálogo inicial cubre
casas, pisos, dúplex, adosados, estudios y viviendas con varias plantas; `custom` evita bloquear
tipologías no previstas y conserva una etiqueta escrita por el hogar.

| Grupo                   | Identificadores estables (`AreaKind`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Interior                | `entrance` (entrada), `foyer` (recibidor), `living_room` (salón), `dining_room` (comedor), `kitchen` (cocina), `pantry` (despensa), `bedroom` (dormitorio), `primary_bedroom` (dormitorio principal), `guest_bedroom` (habitación de invitados), `bathroom` (baño), `toilet` (aseo), `laundry_room` (lavadero), `home_office` (despacho), `studio_room` (estudio), `library` (biblioteca), `playroom` (sala de juegos), `gym` (gimnasio), `walk_in_closet` (vestidor), `hallway` (pasillo), `staircase` (escalera), `landing` (rellano), `elevator` (ascensor), `storage_room` (trastero), `basement` (sótano), `wine_cellar` (bodega), `attic` (buhardilla/ático), `garage` (garaje), `parking_space` (plaza de aparcamiento), `utility_room` (cuarto de instalaciones), `workshop` (taller) y `sunroom` (galería acristalada). |
| Exterior o semiexterior | `garden` (jardín), `vegetable_garden` (huerto), `plot` (parcela), `balcony` (balcón), `terrace` (terraza), `patio` (patio), `courtyard` (patio interior), `porch` (porche), `veranda` (galería cubierta), `gallery` (galería), `roof_terrace` (azotea), `solarium` (solárium), `pool` (piscina), `outdoor_kitchen` (cocina exterior), `shed` (cobertizo/caseta), `greenhouse` (invernadero), `driveway` (entrada de vehículos), `outdoor_parking` (aparcamiento exterior), `path` (camino), `pet_area` (zona de mascotas) y `sports_area` (zona deportiva).                                                                                                                                                                                                                                                                      |
| Compartido o auxiliar   | `common_area` (zona común), `shared_room` (cuarto comunitario), `storage_area` (zona de almacenamiento), `clothes_drying_area` (tendedero) y `custom` (nombre libre).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |

El tipo de vivienda inicial también admite `apartment`, `studio`, `detached_house`,
`semi_detached_house`, `terraced_house`, `townhouse`, `duplex`, `shared_home`, `mobile_home` y
`other`. La forma de la vivienda no restringe qué zonas se pueden añadir.

Una zona personalizada puede tener cualquier nombre no vacío y queda marcada como tal; no se
pretende que el enum sea infinito. Las estancias anidadas válidas —por ejemplo, una piscina dentro
del jardín— pueden declararse como zona hija.

En el selector agrupado deben estar disponibles las zonas habituales de una vivienda española:
recibidor, salón, comedor, cocina, despensa, dormitorios, baño, aseo, pasillo, escaleras,
lavadero, tendedero, despacho, garaje, **trastero**, **balcón**, terraza, patio y jardín. La barra
de acceso rápido conserva los seis tipos del prototipo; las demás zonas se eligen desde el selector
completo. `custom` permite escribir cualquier otro nombre sin modificar el enum compartido.

## Flujo y alcance de producto

- En **Hogar > Plano**, se puede empezar en el lienzo, colocar zonas desde un constructor guiado o
  subir una foto/boceto. Se puede cambiar de método sin perder el borrador. El hogar puede tener
  una o varias plantas, nombrarlas y seleccionar una sin mezclar sus zonas.
- El plano muestra perímetro, paredes, puertas, ventanas y entrada principal como elementos
  vectoriales editables. Tocar/clicar una zona la selecciona; también existe una lista accesible
  equivalente para teclado y lector de pantalla.
- En **Hogar > Tareas**, seleccionar una zona del plano abre sus tareas. Se pueden crear/editar
  ocurrencias con fecha concreta dentro de la semana, asociarlas a una zona o a todo el hogar,
  asignar una persona, dejarlas sin asignar o solicitar un reparto aleatorio equitativo.
  No hay reglas manuales recurrentes en v1. La automatización semanal del hogar sí puede generar
  una nueva propuesta de tareas con IA: usa las zonas vigentes del hogar (del plano interactivo o de
  la lista simple de zonas con nombre, sin dibujo) y la semana de tareas confirmada más reciente como
  contexto; no requiere crear plantillas aparte.
  La respuesta usa `response_format` JSON Schema estricto y pasa el schema/invariantes de servidor.
  La IA solo propone títulos, fechas y zonas; el servidor resuelve asignaciones con miembros activos,
  sin enviar nombres ni perfiles personales al proveedor, y valida equilibrio y días consecutivos.
  Una zona inexistente, una asignación irresoluble, una semana destino ya ocupada o cualquier salida
  inválida deja toda la ejecución para revisión, sin escribir parcialmente ni pisar tareas manuales.
- Una modificación por chat incluye siempre la revisión actual del plano como JSON y la petición
  nueva; puede añadir una foto/boceto. Continuar el chat anterior no es requisito de corrección:
  una conversación nueva también recibe el último plano confirmado. La IA devuelve una propuesta
  completa para previsualizar como `actual` y `propuesta`, nunca aplica ni guarda directamente.
- Se puede descartar la propuesta, deshacerla o aplicarla expresamente. Aplicar una propuesta que
  quite una zona con tareas asociadas exige resolver o confirmar esas tareas antes de guardar.
- El plano, sus revisiones aplicadas, zonas y tareas pertenecen al hogar activo. Las escrituras usan
  control de versión: una pestaña obsoleta no pisa cambios nuevos; devuelve conflicto recuperable.
- Cada petición del cliente identifica el hogar que tenía seleccionado (`x-household-id`). Si el
  servidor ya resuelve otro hogar activo, rechaza lecturas, propuestas y escrituras con
  `409 HOUSEHOLD_CONTEXT_CHANGED`; evita que una operación retrasada termine sobre el hogar nuevo.

## Contrato vectorial para el canvas

La IA **no devuelve SVG, HTML, CSS, código ejecutable ni una imagen que la app inserte como plano**.
Devuelve un objeto JSON versionado de geometría semántica. El cliente renderiza primitivas propias
(SVG/canvas) a partir de un objeto ya validado; textos se pintan como texto, nunca como markup.

Contrato lógico v1:

```ts
type Point = { x: number; y: number }; // enteros normalizados entre 0 y 10_000
type DwellingType =
  | 'apartment'
  | 'studio'
  | 'detached_house'
  | 'semi_detached_house'
  | 'terraced_house'
  | 'townhouse'
  | 'duplex'
  | 'shared_home'
  | 'mobile_home'
  | 'other';
type Plan = {
  schemaVersion: 1;
  dwellingType: DwellingType;
  dwellingTypeLabel: string | null;
  summary: string;
  warnings: string[];
  floors: Array<{
    id: string;
    name: string;
    level: number; // sótanos negativos; planta de acceso 0; superiores positivos
    walls: Array<{
      id: string;
      kind: 'interior' | 'exterior';
      from: Point;
      to: Point;
    }>;
    openings: Array<{
      id: string;
      wallId: string;
      kind: 'door' | 'window' | 'garage_door';
      offset: number;
      width: number;
      isMainEntrance: boolean;
    }>;
    spaces: Array<{
      id: string;
      kind: AreaKind;
      label: string;
      polygon: Point[];
      parentSpaceId: string | null;
    }>;
  }>;
};
```

`DwellingType` y `AreaKind` son enums cerrados según las listas anteriores; `other`/`custom` usan
su campo label como nombre visible. Cada planta usa el mismo `viewBox` normalizado; las paredes
exteriores dibujan el perímetro y las interiores las divisiones. Las paredes pueden ser horizontales,
verticales o diagonales; la IA debe conservar los ángulos y contornos no rectangulares visibles en
una foto/boceto en vez de regularizarlos a rectángulos. Cada zona conserva un polígono simple y
puede ser cóncava; un editor manual debe poder crear una forma libre además de un rectángulo.
Todas las propiedades del objeto enviado al modelo son obligatorias; los valores
ausentes se representan como `null` o listas vacías. Límites de carga: 1–12 plantas, niveles enteros
entre -12 y 12, hasta 80 zonas, 250 paredes y 300 aberturas por planta, hasta 64 vértices por
polígono, 20 avisos y coordenadas enteras entre 0 y 10 000. La vista mantiene proporción, zoom y
desplazamiento sin deformar geometría.

### Respuesta de IA y validación obligatoria

- Toda petición cuyo resultado esperado sea JSON pasa `response_format` OpenAI Structured Outputs:
  `{ type: 'json_schema', json_schema: { name, strict: true, schema } }`, construido desde el
  esquema Zod del servidor con el helper existente `createAiResponseFormat`. No se degrada en
  silencio a texto libre/JSON mode si el proveedor rechaza el esquema.
- El schema enviado tiene raíz `object` (no `anyOf`), `additionalProperties: false` en todos los
  objetos y todas las claves en `required`; los valores opcionales se expresan como anulables. El
  proveedor implementa un subconjunto de JSON Schema estricto.
  Los tests inspeccionan el cuerpo real de transporte y comprueban que contiene ese formato.
- `response_format` verifica la estructura, no la coherencia geométrica. El servidor vuelve a
  parsear con Zod y valida invariantes cruzadas antes de enviar propuesta al cliente: límites,
  tipo libre de vivienda con etiqueta requerida, IDs únicos, niveles únicos, polígonos simples/no
  degenerados, paredes no nulas (incluidas las diagonales), referencias de puertas a paredes, aberturas dentro de
  su pared, entrada principal en una puerta, referencias de zonas padre existentes, ausencia de
  ciclos y geometría hija contenida. Los errores no se dibujan ni se persisten.
- Se instruye a la IA a conservar IDs de zonas sin cambios y a devolver el objeto completo de la
  revisión propuesta. El diff local identifica zonas añadidas, modificadas o retiradas y las
  tareas huérfanas. Salidas truncadas, rechazo del proveedor, JSON inválido o propuesta geométrica
  no válida se muestran como error recuperable; no se persiste una respuesta parcial.
- Foto y texto se tratan como datos para interpretar, no como instrucciones que puedan cambiar el
  contrato o el alcance. Prompts, imágenes, nombres privados de miembros y geometría no se escriben
  en logs. Peticiones, reintentos y cancelación siguen la cola/proveedor del hogar y el aislamiento
  de §12ap; nunca se usa por fallback la IA personal u otro hogar.
- La propuesta conserva la revisión base. Al aplicar, el servidor vuelve a comprobar autorización,
  validez semántica y `baseVersion`; solo entonces escribe la nueva versión.

Referencia primaria del formato: [Structured Outputs de OpenAI](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=chat)
y [Chat Completions API](https://developers.openai.com/api/reference/resources/chat). El helper y
transporte ya existentes se describen en `server/src/schemas/ai-response-format.ts` y
`server/src/utils/ai-client.ts`.

## Hogar, permisos y persistencia

- Lectura del plano y de las tareas: cualquier membresía activa del hogar. Edición del plano:
  permiso existente `settings`; creación/edición/asignación de tareas: permiso existente
  `calendar.edit`. La autorización se valida también en servidor; no se añaden permisos nuevos en
  v1. Las personas miembro/niño siguen siendo asignables conforme a su membresía activa.
- Una casa/hogar tiene un plano vigente con revisión entera. Guardar el plano y sus zonas es una
  operación transaccional; las tareas conservan su asociación estable a zona. Cambiar de hogar,
  selección obsoleta o respuesta tardía nunca puede mezclar planos, zonas, miembros, tareas ni
  propuestas de otra casa.
- Borradores aún no confirmados no sustituyen el plano compartido. Una foto subida para generar o
  editar se usa solo en esa petición; no se conserva como historial de imágenes al confirmar.
- Ninguna respuesta de IA actualiza base de datos antes de la acción explícita de aplicar. La
  persistencia usa la base aislada de tests en CI; jamás tests contra la base/proveedor normal.

## Reparto semanal de tareas

- La asignación manual siempre respeta la persona elegida. El generador aleatorio recibe miembros
  activos elegibles y ocurrencias/días solicitados; no usa ni inventa miembros.
- Entre las soluciones posibles, el algoritmo distribuye la carga con diferencia máxima de una
  asignación entre personas y evita asignar a la misma persona en días consecutivos. Si ambas
  restricciones son incompatibles por número de tareas/días/miembros, no elige silenciosamente una
  regla para romper: explica la incompatibilidad y permite ajustar la selección o repartir a mano.
- La aleatoriedad vive en una función pura con fuente de azar inyectable para reproducibilidad.
  Una semana ya aplicada no cambia al refrescar; volver a sortear es una acción explícita y vuelve
  a mostrar vista previa antes de guardar.
- Solo se asignan tareas a miembros activos del hogar. Eliminar/suspender un miembro no transfiere
  sus tareas a otra casa ni a otra persona sin aviso y confirmación.

## Unidades de entrega y checklist de aceptación

Mantener estas unidades atómicas, cada una con sus pruebas y evidencia antes de marcar `[x]`.
La implementación se mantiene en el PR Draft #47 y la rama `feat/household-floorplan`; el usuario
aprobó un único PR en esta rama y la etiqueta `size:exception` para el alcance superior a 400 líneas.

### QA-HOUSEHOLD.PLAN.GEOMETRY.1 — catálogo, contrato y validador

- [x] Pruebas rojas para límites, IDs duplicados, puntos fuera de rango, polígonos degenerados o
      autointersectados, referencias rotas, openings fuera de pared, ciclos/contención de zonas y
      enum `custom`; implementar esquema Zod + validación semántica compartidos.
- [x] Cubrir el catálogo de espacios con traducciones es/en, identificadores estables y tests que
      garanticen jardín, balcón, terraza, patio, piscina, garaje y zona personalizada.
- [x] Coverage por archivo ≥70 % en statements, ramas, funciones y líneas; JSON Schema generado es
      compatible con strict Structured Outputs y mantiene objeto raíz cerrado.

Evidencia de QA-HOUSEHOLD.PLAN.GEOMETRY.1:

- `pnpm exec vitest run src/schemas/household-plan.schema.spec.ts` (server): 11 pruebas aprobadas.
- `pnpm --filter @hogaria/web exec ng test --no-watch --include src/app/features/household/household-area-catalog.spec.ts`:
  2 pruebas aprobadas en ChromeHeadless.
- El schema alcanza 95,42 % statements, 83,59 % ramas, 96 % funciones y 97,98 % líneas en la suite
  completa del servidor (resultados globales en las puertas generales).
- `pnpm run build` (server) y `pnpm run check:ui`: aprobados.

### QA-HOUSEHOLD.PLAN.GUIDED-PLACEMENT.1 — inserción de zonas sin solapamientos

- [x] La inserción guiada encuentra un rectángulo útil dentro de la huella existente de la planta;
      respeta los límites y no cubre zonas ya dibujadas, incluidas formas irregulares.
- [x] Si no queda un espacio mínimo utilizable, no crea una zona superpuesta: comunica cómo seguir
      y conserva intacto el borrador.
- [x] En estancias compactas, el icono y los nombres largos se escalan/parten en líneas para caber
      dentro de la zona sin pisar paredes o etiquetas vecinas.
- [x] TDD en utilidad/componente y E2E sintética: distribución inicial irregular + altas repetidas,
      error sin hueco, caja del texto dentro del polígono y revisión visual en escritorio/móvil.

### QA-HOUSEHOLD.PLAN.AI-PROPOSAL.1 — generación, foto y revisión por chat

- [x] Ruta autenticada bajo hogar activo; usa proveedor/cola de ese hogar y entrega
      `response_format` estricto. Casos mock: generation, foto, edición con contexto JSON, rechazo,
      timeout, cancelación, truncado, JSON inválido, geometría inválida y proveedor sin soporte.
- [x] La IA devuelve una propuesta completa versionada; el servidor valida antes de mostrarla y no
      escribe el plan hasta la confirmación explícita. Base obsoleta produce conflicto; retry no
      duplica ni guarda una propuesta.
- [x] Pruebas garantizan permiso, aislamiento entre hogares y ausencia de fallback de proveedor.
- [x] Prompt/foto no se persisten; la cola solo almacena metadatos. Errores/logs omiten texto de
      usuario, payload, nombre de archivo, base64 y respuesta del proveedor.

Evidencia de `QA-HOUSEHOLD.PLAN.AI-PROPOSAL.1` (API simulada; ningún proveedor real):

- `DATABASE_PATH=:memory:; pnpm --filter @hogaria/server exec vitest run src/routes/household-plan.routes.spec.ts src/routes/household-tasks.routes.spec.ts src/utils/household-plan-ai.spec.ts src/utils/ai-client.spec.ts src/schemas/form-contract.spec.ts` — 463 pruebas aprobadas.
- `pnpm run build` (server): aprobado.
- Los tests inspeccionan el `response_format` del transporte; verifican propuesta inicial, foto,
  edición con plano confirmado como JSON, rechazo del schema sin fallback, timeout, cancelación,
  truncado, rechazo, JSON/geometría inválidos, permiso, scope y ausencia de escrituras. El JSON
  malformado no se conserva en `ai_jobs`; solo queda el estado de cola y error normalizado.
- El límite de cuerpo de Hono se prueba con `Content-Length` sobredimensionado y un cuerpo chunked
  mayor al límite; ambos responden 413 antes de analizar ni reenviar el archivo.
- El servidor calcula `orphanedTaskIds` para propuestas que retiren zonas; el cliente pide
  confirmación y la escritura conjunta del plano/tareas es transaccional. `QA-HOUSEHOLD.TASKS.WEEKLY.1`
  cubre la asociación de tareas a zonas y el flujo de confirmación.

### QA-HOUSEHOLD.PLAN.PERSISTENCE.1 — plano por hogar y concurrencia

- [x] Migración idempotente/no destructiva, lectura/guardado scoped al hogar activo, control de versión/CAS y
      rollback transaccional; probar miembro inválido, permisos y dos hogares.
- [x] Se guardan solo propuestas aplicadas; edición concurrente no borra la versión más reciente.
- [x] Retirar zonas con tareas exige confirmación explícita y guarda el plano y las tareas
      desvinculadas en la misma transacción.
- [x] Las peticiones capturadas para el hogar anterior fallan con `409` después de cambiar el hogar;
      las propuestas obsoletas no alcanzan el proveedor ni escriben.

Evidencia de persistencia: `server/src/routes/household-plan.routes.spec.ts` y
`server/src/routes/household-tasks.routes.spec.ts` prueban permisos, CAS, hogar ambiguo/ausente,
aislamiento, contexto retrasado, geometría inválida, historial de revisiones, tareas huérfanas y
rollback. Las tablas se crean con `CREATE TABLE IF NOT EXISTS`; las pruebas se ejecutan con
`DATABASE_PATH=:memory:`.

### QA-HOUSEHOLD.PLAN.EDITOR.1 — lienzo y zonas interactivas

- [x] Pestañas `Plano` y `Tareas` bajo Hogar conservan URL, navegación de teclado y borradores al cambiar
      de pestaña. Lienzo libre, constructor guiado y foto pueden alternarse sin perder el borrador.
- [x] Renderizar solo geometría local validada; selección por ratón/tacto y teclado, pisos,
      edición/arrastre, lista accesible de zonas, previsualización actual/propuesta, deshacer,
      descartar y aplicar.
- [x] Playwright real en escritorio y móvil: breakpoints existentes y mínimos, orientación,
      teclado, foco, controles táctiles y sin overflow; guardar e inspeccionar capturas sintéticas.
- [x] Pestañas geométricamente equivalentes a ≤1 CSS px en PC; scroll del lienzo móvil y paneles
      con padding `safe-area` (`env(safe-area-inset-bottom, 0px)`). La emulación no representa un
      dispositivo físico con notch.

### QA-HOUSEHOLD.TASKS.WEEKLY.1 — asignación manual y justa

- [x] Asociar tarea con zona del plano o con hogar completo; selección de persona, tareas sin
      asignar y programación semanal editables.
- [x] Pruebas para equidad, no repetición en días consecutivos, semanas vacías,
      miembros insuficientes, restricciones inviables, reproducibilidad y ausencia de persistencia
      hasta confirmar.
- [x] E2E aislado verifica que tocar una zona lleva a sus tareas, que el reparto solo usa miembros
      activos y queda en borrador hasta confirmar; rutas API prueban el aislamiento entre hogares.

### QA-HOUSEHOLD.PLAN.AREAS-AND-FREEFORM.1 — zonas habituales y geometría irregular

- [x] El selector agrupado permite elegir las estancias frecuentes en España, con los nombres
      visibles «Trastero», «Balcón» y «Tendedero»; mantiene las zonas menos frecuentes agrupadas y
      la barra de seis accesos rápidos sigue igual al prototipo.
- [x] «Personalizada» permite añadir una estancia con cualquier nombre no vacío y ese nombre se
      conserva en el borrador, la propuesta AI y la persistencia.
- [x] Crear una zona dibujando admite un polígono libre con tres o más vértices, sin restringir a
      rectángulos; sigue siendo posible dibujar la forma rectangular con arrastre.
- [x] Foto/boceto con contorno cóncavo y pared oblicua produce una propuesta con geometría irregular
      equivalente en el preview; las paredes diagonales, sus aberturas y tareas/selecciones mantienen
      comportamiento válido.
- [x] TDD: schema/UI prueban zonas españolas, nombre custom, cierre de polígono, cancelar/deshacer,
      autointersección, aristas diagonales y abertura en pared diagonal. La prueba AI comprueba que
      el prompt pide respetar el contorno y que no se sustituye por una caja rectangular.
- [x] E2E sintética en PC y móvil, aislamiento de DB/proveedor, capturas, validación visual y
      cobertura ≥70 % de los archivos afectados; sin usar planos ni hogares reales.

Evidencia del editor y tareas:

- `pnpm --filter @hogaria/web exec ng test --no-watch --include=src/app/features/household/household-area-catalog.spec.ts` — 4/4.
- `pnpm --filter @hogaria/server exec vitest run src/schemas/household-plan.schema.spec.ts src/utils/household-plan-ai.spec.ts` — 19/19.
- `node scripts/run-isolated-playwright.mjs --project=chromium --project=mobile-chrome tests/e2e/household-plan-tasks.spec.ts` — 2/2 pasan en 50,7 s (12-10-2026). Usa DB/usuarios temporales sintéticos; la IA se stubbea en el navegador y no se llama al proveedor. El runner limpia solo los artefactos temporales que crea.
- `$env:DATABASE_PATH=':memory:'; pnpm run test:coverage` — cliente 1396/1396 y servidor 1330/1331 (1 omitida); cobertura cliente 93,89/84,75/93,62/95,58 % y servidor 91,76/83,51/95,56/94,27 % (statements/branches/functions/lines). Sin errores de umbral.
- `pnpm run check:ui`, `pnpm run typecheck:e2e` y `pnpm run build` — pasan. Build conserva avisos preexistentes de Angular/presupuesto y no informa exceso CSS del editor del plano.
- El flujo verifica lienzo/zonas, pared exterior/puerta principal, pisos y confirmación al borrarlos, carga de imagen, propuesta sin escritura prematura, cambio de pestaña con borrador conservado, tarea por zona, preview equitativo/no consecutivo, persistencia y edición tras recargar.
- Viewports probados: 320, 359, 360, 639, 640, 767, 768, 1023 y 1024 px, además de 568×320; la pestaña conserva geometría/tipografía/espaciado equivalente con tolerancia ≤1 px y no hay overflow horizontal. Mobile Chrome usa `tap` en el plano y teclado; los componentes aplican `env(safe-area-inset-bottom, 0px)`. La emulación no sustituye comprobación en hardware físico con recorte/notch.
- Capturas PC/móvil sintéticas inspeccionadas en `.e2e-screenshots/household-plan-tasks/{chromium,mobile-chrome}/` (los seis pasos `01-plan-start` a `06-chat-adjustment`; también propuesta, previsualización aleatoria y semana guardada). Se excluyen de Git.
- La API/schema admite polígonos no rectangulares y segmentos diagonales; el prompt pide trazarlos en `polygon`/`walls`, y el test E2E demuestra que el preview mantiene una respuesta sintética cóncava con pared oblicua. No se hizo smoke con proveedor real: la calidad de la IA ante bocetos arbitrarios sigue sin validación real y no se afirma que el proveedor reproduzca toda geometría de forma exacta.

### QA-HOUSEHOLD.PLAN.VISUAL-FIDELITY.1 — interfaz según los prototipos aprobados

La referencia es la secuencia de seis mockups aprobados en esta conversación (IDs de archivo
`exec-3d60ee65-e311-4692-a979-b1f4564929a9.png`, `exec-3be5f6ed-8bd1-47a8-b708-35ab9452dff0.png`,
`exec-9299b3b6-c022-4f96-b9c4-7eb0337afc28.png`, `exec-e2e39a1a-d995-4927-bc38-205c925ab781.png`,
`exec-455e098e-dd5b-4600-b0aa-1c9939baf363.png` y `exec-042a1622-76b0-4f9a-87d6-bc7f4e404ba3.png`).
Las seis imágenes originales ya se localizaron en
`C:/Users/juanj/.codex/generated_images/01a11138-d990-7ed3-a48d-2681d285b3d7/`; cada una contiene
la vista de escritorio junto a la vista móvil. La primera inspección directa confirmó diferencias
visibles, así que los checks previos de la sección describen estructura funcional, no equivalencia
visual, y no deben darse por terminados hasta cotejar cada vista con su referencia. Los marcos de
teléfono y la navegación/shell dibujadas son parte del mockup; para la comparación se recortará el
área de producto, respetando la shell real de HogarIA y midiendo su contenido, jerarquía y geometría.
Mantener la shell y los tokens geométricos reales de HogarIA; fondo claro, superficies blancas,
naranja para acción/selección, líneas azul marino y zonas pastel. Se evalúan la composición y
jerarquía de la vista del producto, no las barras de navegador ni la shell dibujada dentro de los
mockups.

- [x] **Inicio:** dejar neutras las tarjetas de método antes de la elección explícita y cotejar
      vivienda/plantas, tres métodos ilustrados, CTA y espaciado en escritorio y móvil.
  - [x] **Plantas en escritorio:** alinear su rótulo con «Tipo de vivienda» y usar el selector de
        168 px del prototipo; Playwright mide alineación a ≤1 px y ancho exacto. El control móvil
        conserva su ancho compacto y centrado verticalmente.
  - [x] **Indicador de navegación móvil:** sustituir el carácter tipográfico por un SVG de 18×18 px,
        centrado verticalmente en cada tarjeta; ocultarlo en escritorio, donde el prototipo no lo
        muestra. Playwright mide tamaño/alineación en móvil y ausencia en escritorio. La inspección
        detectó que el trazo era demasiado fino y pálido; ahora comprueba grosor de 2,2 px y azul
        marino de iconografía `#203449` frente al prototipo. En tema oscuro cambia a texto principal
        para conservar el contraste.
- [x] **Editor:** agrupar pared/puerta/ventana y espacios en una sola barra coherente; conservar
      piso/zoom/historial arriba del plano y dock táctil debajo en móvil. Reducir los rellenos
      asignados del plano durante el dibujo (el prototipo reserva el naranja para la selección), y
      plegar la lista de zonas para no añadir un panel visible ausente del mockup sin quitar acceso
      por teclado/lector de pantalla. En dibujo libre, alinear las tres acciones de vértice en una
      fila de igual altura y jerarquía, con icono SVG legible además de texto; dar a «Vista previa»
      un icono y alinear su contenido con los demás botones de acción. Verificar la geometría de esos
      controles en escritorio, móvil y 320 px; no basta con que estén presentes.
- [x] **Superficie del lienzo:** mantener una sola cuadrícula ligera y continua bajo el plano. La
      revisión crítica encontró una hoja cuadriculada dentro de un marco punteado, con densidades y
      fondos distintos que distraen del dibujo; validar que el viewport sea la única cuadrícula en
      PC y móvil. Confirmar además que las tres acciones de dibujo mantienen icono y texto centrados
      como una sola unidad, no solo que comparten tamaño.
- [x] **Planta vacía:** mostrar un único mensaje de inicio con icono de plano en modo selección;
      ocultarlo al dibujar para no competir con las instrucciones específicas de pared/zona. La
      regresión cubre planta vacía, entrada/salida del modo libre, tamaño del icono y alineación del
      texto en PC y móvil.
- [x] La lista desplegable de zonas no repite visualmente su título: los encabezados auxiliares
      conservan nombre accesible pero usan la utilidad de texto visualmente oculto.
- [x] En 390×950 px, la vista móvil en dibujo libre mantiene dentro del primer pantallazo el área
      de trabajo, las dos filas del dock, sus acciones y «Vista previa», con al menos 8 px sobre la
      navegación fija. En 320×568 px conserva scroll útil, objetivos táctiles ≥44 px, y «Vista
      previa» puede llevarse por encima de la navegación sin overflow horizontal. El hint/etiquetas
      móviles se acortan visualmente, pero los controles conservan su nombre accesible completo.
- [x] **Auditoría de escritorio ancho (captura real 1920 px):** conservar la anchura máxima de
      800 px que refleja el prototipo, pero centrar Plano y Tareas en la columna principal (no
      anclarlos a su borde izquierdo y dejar un vacío asimétrico). Mantener título, barra de
      herramientas, acciones y lienzo alineados; validar 1280 y 1920 px y que «Vista previa» quepa
      en el primer pantallazo, centrada y con 460 px como en el prototipo. No ensanchar por
      ensanchar sin resolver la geometría del canvas.
- [x] En las capturas PC/móvil, revisar los controles visibles contra el DOM y el build actual:
      acciones con texto/icono coherentes, SVG de tamaño común, grupos con separación y línea base
      consistentes, nombres accesibles y objetivos táctiles suficientes. No añadir iconos decorativos
      a pestañas o controles que ya se entienden por texto.
- [x] **Modo libre y dock estrecho:** «Dibujar zona» debe estar disponible en el dock principal y
      permanecer visible/seleccionado mientras se dibuja; no activar este modo desde «Más opciones»
      para luego ocultar su estado. Mantener icono, `aria-pressed` y el mismo ritmo geométrico que el
      resto de herramientas. En 320–359 px, la fila horizontal de zonas rápidas debe indicar que
      continúa, permitir llegar a todas por desplazamiento y teclado, mantener objetivos táctiles
      ≥44 px y no provocar overflow horizontal de página.
  - [x] **Iconos del flujo:** calcar las formas de herramientas, estancias, puertas/ventanas, chat y
        asignación de los SVG del prototipo; ajustar trazo/color/tamaño además del contenedor. E2E
        verifica los cinco trazos de herramienta, los seis glifos de estancia (unitarias), el trazo
        de asignación compartida y las siluetas del chat en PC y móvil; `02-plan-editor` se coteja de
        nuevo. La auditoría visual detectó que la referencia colorea en naranja el cursor seleccionado
        y etiqueta la pared como «Pared»; ambos detalles se corrigieron y verificaron.
    - [x] **Estancias compactas en mapas:** en propuestas/chat y tareas, conservar el nombre de
          habitaciones pequeñas, pero ocultar el pictograma cuando compita con puertas y separar
          visualmente el nombre de las líneas subyacentes. Comprobar con plano sintético irregular
          en unit test y E2E.
    - [x] **Ventana:** marco de tres franjas horizontales y parteluz vertical limitado a la franja
          central; E2E verifica ambas divisiones. Una ampliación del recorte corrigió la primera
          lectura errónea de cuatro paños.
    - [x] **Puerta:** contorno con parte superior arqueada del pictograma; E2E descarta el arco de giro
          anterior.
    - [x] **Estancias:** cotejar las siluetas de cocina, salón, baño, dormitorio y patio contra el
          recorte original ampliado. Se ajustaron hornillas/rayas, sofá de un asiento, perfil/base del
          inodoro, almohada única y dos hojas; el pasillo conserva sus tres barras simples. Unit test y
          captura E2E PC/móvil verifican las formas.
    - [x] **Destello del asistente:** igualar a 24×24 px y centrarlo con «Asistente IA»; Playwright
          mide caja/alineación en desktop y mobile y las comparaciones 06 se reinspeccionan.
    - [x] **Avatar y continuación del chat:** igualar el pictograma de hogar y los iconos de acción
          a 24×24 px; mantener cada icono junto a su texto, incluso cuando una etiqueta móvil envuelva.
          Playwright mide tamaño/alineación en PC/móvil y confirma que la hoja conserva su margen táctil.
  - [x] **Dock de dibujo en escritorio:** a 1920 px, las tarjetas de herramienta/estancia conservan
        la medida de 88 px del prototipo y sus SVG 32×32 px. Playwright mide esas geometrías.
  - [x] **Selección y nombres del dock:** el cursor activo usa el naranja primario del prototipo
        (`#f97316`), sin cambiar los glifos no seleccionados; la pared se rotula «Pared» en una línea.
        Playwright comprueba el color exacto a 1920 px y el texto del control en PC/móvil.
- [x] **Foto/propuesta:** cotejar tamaño y proporción de la foto original y el plano generado en
      ambos breakpoints, y la jerarquía cambiar/confirmar/continuar. Mantener una salida accesible
      para descartar el borrador como control de icono compacto en el encabezado de propuesta, no
      como enlace suelto bajo la acción principal. El fixture de E2E debe parecer un boceto real y
      generar una propuesta con el mismo número de zonas que la referencia; no usar etiquetas de QA
      en imágenes. A 320–359 px verificar que el descarte no tapa título/estado y que la decisión
      y la continuación mantienen un margen ≥8 px frente a las acciones fijas; el plano sigue
      legible sin ocupar más altura de la disponible en pantallas estrechas.
- [x] **Asignación:** mantener mapa + selector lateral en escritorio. En móvil igualar la
      prominencia vertical del mapa y presentar la edición en una hoja inferior con nombre/estado,
      cuatro opciones y CTA visible, no una tarjeta compacta con estado guardado/Más acciones que
      desplacen la decisión.
- [x] **Selector de escritorio:** corregir el criterio anterior, que contradecía el mockup: las
      cuatro responsabilidades se muestran como filas verticales de ancho completo, con avatar,
      nombre y selector en una misma línea y «Compartida» legible; móvil mantiene las cuatro
      opciones en la hoja inferior. La pantalla de asignación usa un mapa limpio, no la cuadrícula
      de edición; conserva cierre y acciones secundarias accesibles sin duplicar el estado de
      asignación. El menú usa un SVG del mismo sistema, no puntos tipográficos. El mapa previsualiza
      los miembros/colores del borrador sin guardarlo hasta «Guardar», conserva el relleno de
      responsabilidad bajo el borde naranja y ajusta el plano de ejemplo a una huella irregular
      casi cuadrada (relación ancho/alto 0,92–1,04) como en el prototipo. Playwright mide filas,
      lectura, consistencia del borrador y geometría PC/móvil.
- [x] **Tareas:** cotejar el peso visual del plano y la jerarquía del panel semanal. Los controles
      funcionales avanzados deben quedar accesibles sin sobrecargar la vista principal.
  - [x] La casa sintética de escritorio respeta la huella casi cuadrada del prototipo y la móvil
        su huella apaisada; cada fixture de prueba se adapta al encuadre sin transformar los planos
        reales guardados. Las habitaciones compactas omiten el pictograma redundante si no cabe con
        margen, pero conservan nombre visible y asignación accesible.
  - [x] **Resumen semanal:** mostrar «Asignación de la semana» en escritorio; integrar el cambio
        de semana en la fila del hogar/zona en móvil, sin gastar una fila independiente. La
        captura móvil con siete tareas debe enseñar al menos tres filas completas sin scroll y
        permitir llegar a las siete por desplazamiento.
  - [x] **Cierre y mapa:** el mapa de tareas mantiene el fondo limpio del prototipo (sin retícula
        doble), el resumen equitativo tiene jerarquía e icono, y el CTA de aplicar ocupa casi todo
        el ancho disponible; acciones avanzadas siguen accesibles sin quitarle ancho al CTA.
- [x] **Agenda de escritorio:** usar los nombres breves de día del prototipo en una sola línea y
      reservar más ancho para las tarjetas de asignación, sin perder la fecha larga para lectores de
      pantalla. Playwright verifica los siete encabezados, su alineación, el formato visible y el
      `aria-label` completo.
- [x] **Checklist semanal:** las siete asignaciones, el resumen de equidad y la acción de aplicar
      siguen alcanzables en móvil. Cuando hay una sola tarea diaria, la fila muestra día + persona
      sin repetir el título; nombre, fecha/zona y completado siguen accesibles en la edición. Si un
      día tiene varias tareas, sus títulos permanecen visibles para distinguirlas.
- [x] **Checklist móvil táctil:** cada fila de tarea tiene altura mínima 44 px y las acciones de
      completado y edición conservan objetivos ≥44×44 px; ampliar la lista no debe tapar la última
      asignación ni el botón fijo de aplicar. Playwright demuestra el scroll hasta la última tarea,
      el margen sobre el footer y la separación del footer respecto de la navegación y el safe-area.
- [x] **Tareas móvil:** las pestañas de planta tienen fila propia sobre el plano, el título de zona
      precede a la navegación semanal y las flechas mantienen objetivos táctiles de al menos 44 px.
- [x] **Ajuste por chat, estructura PC/móvil:** alternar un plano grande cada vez en móvil y
      mantener sus cuatro continuaciones en cuadrícula 2×2 junto a aplicar/deshacer, sin guardar
      antes de confirmar el borrador. En escritorio el subtítulo envuelve sin colisionar con subir
      foto/volver al lienzo. Playwright verifica las acciones visibles y la huella de la propuesta.
- [x] **Ajuste por chat, acabado visual:** cotejar densidad y espaciado restantes de planos,
      conversación y decisión contra el mockup; en escritorio el plano debe ocupar al menos el 74 %
      de la altura útil de su marco sin deformar su geometría. Mantener el fixture móvil casi
      cuadrado y uno vertical en escritorio para que ambas comparaciones correspondan a sus
      referencias; no ocultar diferencias de tipografía/respiración. En el encabezado de escritorio,
      «Volver al lienzo» debe permanecer en una línea con su icono, sin desbordarse ni comprimir el
      control de subir foto.
  - [x] **Título del asistente:** el panel de chat dice «Asistente IA», igual al prototipo; no
        reutiliza el texto «Ajustar con IA» de la acción del editor. Playwright lo comprueba en PC
        y móvil y se mantienen traducciones ES/EN separadas.
  - [x] **Acciones del encabezado desktop:** «Volver al lienzo» y «Subir nueva foto o boceto» se
        muestran completos en una línea con iconos y centrado vertical; E2E comprueba 1280/1920 px.
  - [x] **Resumen del chat:** concordar cantidades en singular/plural para zonas nuevas y modificadas;
        E2E comprueba una zona de cada tipo y unitarias verifican conteos singulares/plurales en ES/EN.
- [x] **Ajuste por chat, alineación PC:** los controles de zoom/encaje quedan ≤24 px bajo las
      tarjetas comparadas y no se desplazan con la altura de la conversación; E2E reproduce primero
      el desfase de 103 px y verifica la separación corregida.
- [x] **Ajuste por chat, controles móviles:** botones de archivo, pestañas, zoom, decisión y cuatro
      continuaciones miden al menos 44×44 px y siguen completos con ≥8 px sobre navegación fija. La
      regresión inicialmente detectó controles de 40 px; se compactó la composición sin reducir el
      lienzo por debajo de 260 px.
- [x] **Mapa semanal, estancias compactas:** mantener el nombre «Aseo» dentro de una estancia
      pequeña, omitir solo el texto redundante de titular que no cabe y conservar la asignación en
      el nombre accesible del área. Unit test y E2E móvil reproducen y eliminan la colisión de «Sin
      asignar» con la estancia vecina.
- [x] E2E verifica interacción, permisos, persistencia, borradores, IA simulada, teclado/foco,
      labels, contraste AA en temas claro/oscuro, safe-area y ausencia de overflow; no hay fixtures
      personales ni llamadas reales a IA.
- [x] Capturar e inspeccionar los seis estados sintéticos a 1280×970 y 390×950; verificar además
      breakpoints 320, 359, 360, 389, 390, 639, 640, 767, 768, 1023 y 1024 px y orientación 568×320.
- [x] Generar e inspeccionar las seis comparaciones PC + seis móvil en
      `.e2e-screenshots/household-plan-comparison/` recortando la zona de producto de los mockups
      y las capturas aisladas.
- [x] Corregir las diferencias pendientes de composición, tamaño, jerarquía, color y espaciado
      observadas en esas 12 comparaciones. No declarar fidelidad visual exacta solo por pasar pruebas
      de estructura.
- [x] Registrar comprobaciones y limitaciones reproducibles; no inferir fidelidad solo por tests
      unitarios, compilación o presencia de controles.

Evidencia visual y regresión:

- El E2E detectó en la interfaz «1 zonas nuevas y 1 modificadas». Se corrigió mediante `I18nService.plural` y sustantivos traducidos; `household-plan-editor.component.spec.ts` verifica texto real en ES/EN (conteos 0, 1, 2 y 3) y `household-plan-tasks.spec.ts` exige el resumen singular de la propuesta. `ng test --no-watch --include=src/app/features/household/household-plan-editor.component.spec.ts` — **30/30**; el E2E aislado PC/móvil — **2/2** (13-10-2026).
- `node scripts/run-isolated-playwright.mjs --project=chromium --project=mobile-chrome tests/e2e/household-plan-tasks.spec.ts` — **2/2 pasan en 49,9 s** (13-10-2026). Servidor/SQLite/artefactos aislados; el proveedor de IA se simula y la DB/artefactos temporales propios se limpian.
- La auditoría comparó nuevamente las doce capturas con el prototipo; no quedan desajustes geométricos sin resolver dentro del alcance. Los cambios de plano en chat ocupan **94,4 %** de la altura útil comprobada por Playwright; las pestañas de planta y las áreas táctiles de **44 px** se conservan aunque reduzcan el número de filas semanales visibles al primer vistazo (se exige un mínimo de tres, y las siete siguen alcanzables por scroll). En E2E se fijaron, además de tamaños, las rutas SVG de las cinco herramientas, el grupo de personas compartido, el destello/avatar y los cuatro iconos de continuación. Las capturas PC/móvil se regeneraron en `.e2e-screenshots/household-plan-comparison/` el 13-10-2026. Se conserva texto oscuro en los CTAs naranjas en lugar del blanco del mockup porque el contraste AA de la combinación original no alcanza 4,5:1; Playwright valida ambas variantes del tema. Los avatares usan la imagen de perfil cuando está disponible y, si no, las iniciales accesibles como fallback.
- La comparación con los mockups aprobados de los seis estados PC/móvil se regeneró e inspeccionó en `.e2e-screenshots/household-plan-comparison/`. Los iconos SVG de herramientas/estancias se ajustaron de 24 a 32 px en las vistas verificadas; E2E valida 32 px y que los rótulos de pestañas no se monten a 320 px.
- `pnpm --filter @hogaria/web exec ng test --no-watch --include=src/app/features/household/household-area-catalog.spec.ts --include=src/app/features/household/household-area-glyph.component.spec.ts --include=src/app/features/household/household-tasks.component.spec.ts --include=src/app/features/household/household-plan-preview-map.component.spec.ts` — **22/22**.
- `pnpm run check:ui` — sin incidencias (228 ficheros/21 reglas); `pnpm run typecheck:e2e` — aprobado.
- `pnpm --filter @hogaria/web exec ng test --no-watch --include=src/app/features/household/household-tasks.component.spec.ts` — **15/15**; las filas con tarea única no repiten el título y conservan su edición accesible.
- El primer pase halló dos fallos visuales que no detectaba el simple `scrollWidth`: a 320 px las pestañas del hogar se montaban; y en pantalla baja la decisión de foto quedaba debajo de la barra fija (`bottom=729,89`, `sticky top=693`). Se compactaron las pestañas hasta 389 px, con scroll/foco por teclado, y a 320×568 las acciones de foto dejan de ser fijas y permanecen alcanzables al desplazar. E2E verifica 320, 359, 360, 389 y 390 px y ambos casos pasan.
- El primer CI de esta revisión halló que las media queries nuevas no estaban cubiertas por la matriz global B−1/B/B+1. Se añadieron 388–390, 1198–1201 y 1278–1281 px a `tests/e2e/layout-gutters.spec.ts`; el test enfocado pasa 1/1 y el spec completo aislado pasa **7/7 en 1,3 min**.
- Las capturas actuales usan 1280×970 y 390×950 para acercarse al encuadre del mockup; los seis estados `01-plan-start` a `06-chat-adjustment` se regeneran en `.e2e-screenshots/household-plan-tasks/{chromium,mobile-chrome}/`, con capturas 320×568 y 568×320 adicionales. Las capturas usan plan/foto sintéticos, sin etiquetas QA ni datos personales. La emulación no sustituye un teléfono físico con notch.
- La inspección de las 12 comparaciones confirma que la jerarquía del inicio, el dock del editor, la hoja de asignación móvil y las cuatro continuaciones del chat ya están presentes. Siguen pendientes la forma/proporción del plano sintético frente a la referencia, la proporción del plano propuesto en móvil y diferencias de densidad/espaciado del panel de tareas y el chat. La shell real de HogarIA se conserva; no se declara fidelidad exacta hasta corregir estas diferencias y reinspeccionar las comparaciones.
- Revisión crítica del editor a partir de la captura real del 12-10-2026: faltaban iconos y geometría común en las tres acciones del dibujo libre, y «Vista previa» carecía de icono. Se añadieron primero regresiones E2E y luego SVG accesibles, tres columnas iguales y una reducción del canvas únicamente durante dibujo libre; inspección de capturas 1280×970, 390×950 y medición adicional a 320 px. La UI de dibujo libre ahora mantiene línea base, ancho/alto e iconos de 18 px iguales (tolerancia ≤1 px); sigue pendiente cotejar exhaustivamente todo el flujo con los mockups.
- Revisión de alineación: un test E2E rojo a 1920 px encontró el editor y la semana anclados a la izquierda de la columna principal pese a su ancho de 800 px; se centraron sin ensanchar el canvas. La captura del menú mostró un título auxiliar visible y duplicado; se aplicó el patrón accesible de texto oculto.
- La comparación corregida de 02 encontró diferencias residuales: el CTA de escritorio era 420 px frente a 460 px del mock y los controles de zoom/historial terminaban 181 px antes del borde derecho del editor. Se actualizó el recorte E2E para el editor centrado; pruebas rojas (420 vs. 460 y desfase de 181 px) precedieron al CTA de 460 px centrado y al anclaje de esos controles al borde derecho.
- Regresión móvil roja a 390×950: la acción acababa en y=734, el dock en y=914 y la vista previa en y=974 detrás de la navegación que empezaba en y=886. Causa: un margen global de 33 px en el dock más botones de etiquetas largas apiladas. Se retiró ese margen, se compactaron hint/etiquetas con traducciones sin abreviar los nombres accesibles y se limitó el canvas a 260 px (200 px en 320–359). Verde: acciones y dock terminan en y=655/y=802, vista previa en y=862 y navegación en y=886; hay ≥8 px de separación. A 320×568 E2E comprueba scroll hasta la acción primaria, lienzo ≥200 px, toques ≥44 px y sin overflow horizontal.
- El test rojo de móvil también detectó «Cancelar dibujo» partido en dos líneas; la etiqueta visual se redujo a «Cancelar», conservando el nombre accesible «Cancelar dibujo». Los estados de captura vuelven a cerrar la lista avanzada para no confundir el editor limpio con el panel expandido; luego el flujo E2E reabre la lista para continuar pruebas de selección. El test rojo de selección documentó esa condición de estado y se corrigió reabriendo la lista después de capturar.
- Última validación UI aislada (12-10-2026): `node scripts/run-isolated-playwright.mjs --project=chromium --project=mobile-chrome tests/e2e/household-plan-tasks.spec.ts` — **2/2**, 49,1 s. También `ng test` enfocado **38/38**, `pnpm run check:ui` (228 ficheros/21 reglas) y `pnpm run typecheck:e2e` pasan. En 320×568 se desplaza la acción principal a y=420–468, separada de la navegación que comienza en y=504. Capturas sintéticas inspeccionadas: `chromium/02-plan-editor-wide-desktop.png`, `mobile-chrome/02-plan-editor-freeform.png` y `mobile-chrome/02-plan-editor-freeform-320x568.png`.
- `pnpm run build` — build producción correcto. Se movieron reglas móviles compactas al SCSS global compartido: desaparece el aviso de presupuesto del `household-plan-editor.component.scss`; permanecen avisos de presupuesto del bundle inicial/componentes ajenos y avisos Angular existentes, fuera de este cambio.
- Segunda revisión de las comparaciones: el subtítulo del ajuste por chat colisionaba con las acciones de escritorio y las cuatro continuaciones móviles no estaban en una cuadrícula 2×2. Se envolvió el subtítulo y se ajustó la cuadrícula; E2E ahora mide ausencia de colisión y comprueba las cuatro opciones visibles sobre la navegación móvil. Las diferencias restantes de composición/densidad del chat continúan pendientes.
- Revisión de evidencia del mockup móvil 06: la referencia aprobada usa pestañas para alternar y enseña un plano grande cada vez; no se requiere una comparación simultánea de miniaturas. La implementación mantiene ese patrón y las aserciones E2E no deben invertirse a dos planos simultáneos.
- Inserción guiada: la colocación basada en `spaces.length` ubicaba zonas encima de la planta. TDD reprodujo el solapamiento en E2E; ahora la búsqueda toma el mayor rectángulo libre dentro de la huella, respeta los límites y conserva el borrador si no hay un hueco mínimo. Las etiquetas de zona se reducen/enrollan hasta tres líneas y se comprueba que su caja queda dentro del polígono. Validado con 38/38 pruebas de componente/utilidad, `check:ui`, `typecheck:e2e` y 2/2 proyectos Playwright aislados (Chromium + Mobile Chrome). Las capturas PC/móvil actuales muestran la inserción sin solapamiento; la cobertura por archivo se verificó por encima del 70 % en cada métrica.
- Última inspección de la UI: el descarte de propuesta ahora es un botón de cierre con nombre accesible dentro del encabezado (44×44 px), sin enlace suelto debajo de «Continuar»; en 320–359 px el mapa conserva legibilidad con 172 px y libera el espacio necesario. Playwright verifica no-colisión título/estado, ≥8 px entre decisión y continuación fija y ≥8 px sobre navegación. La continuación queda separada de la barra móvil por 9 px en la captura 390×950.
- Revisión crítica de Tareas móvil: Playwright primero detectó que las pestañas tapaban el mapa, que el título de zona compartía renglón con las fechas y que un desplazamiento de 64 px no bastaba para mostrar la última asignación encima de Guardar. Las pestañas ahora ocupan una fila de flujo; el título y las fechas usan filas separadas; flechas y plantas se prueban ≥44 px; el checklist se desplaza 112 px para demostrar que la última fila queda ≥8 px sobre Guardar, que a su vez permanece sobre la navegación. E2E Mobile Chrome pasa **1/1 (27,0 s)** y captura 390×950, 320×568 y 568×320; la comparación móvil se regeneró e inspeccionó. Sigue pendiente el cotejo global del peso visual mapa/panel.
- Revisión del chat móvil: el primer test medía la respuesta de foto inicial, no la respuesta final que produce la captura 06. Medir la propuesta final en rojo halló huella **174,5 px** en canvas de 340 px: el stub transformaba artificialmente la revisión textual a aspecto retrato. La IA/UI conserva el aspecto de entrada; se corrigió el fixture para mantener el plano irregular casi cuadrado como el mockup. Verde: huella **259,8/340 px (76,4 %)** y relación ancho/alto ≥0,9; Playwright Mobile Chrome pasa **1/1 (26,8 s)** y regenera `06-chat-adjustment` a 390×950 y 320×568. El chat aún requiere inspección comparativa de densidad/espaciado.
- Auditoría a partir de la captura señalada por el usuario: el modo de zona libre se podía activar solo desde «Más opciones» y el panel se cerraba al elegirlo; el dock visible seguía ofreciendo «Dibujar pared» sin reflejar que se estaba trazando una zona. En 320 px las zonas rápidas dependían de una fila horizontal parcialmente visible. Se añadieron criterios explícitos para mostrar el modo actual en el dock y comprobar el acceso por teclado/scroll; quedaron pendientes hasta la regresión verde descrita a continuación.
- Regresión del modo invisible: Playwright primero falló en PC/móvil porque no existía un botón visible del modo tras activar «Zona libre». El dock incluye ahora el control SVG seleccionado, conserva ese estado para el modo rectangular avanzado y cambia etiqueta/forma según el modo. En 320 px se comprueba que el foco de teclado desplaza la fila hasta «Patio», que el control ≥44×44 queda totalmente visible y que la página no se desborda. La ejecución aislada `node scripts/run-isolated-playwright.mjs --project=chromium --project=mobile-chrome tests/e2e/household-plan-tasks.spec.ts` pasa **2/2**; capturas sintéticas PC 1920×1032 y móvil 390×950/320×568 inspeccionadas; captura 390 deja 11,2 px sobre la navegación fija.
- TDD visual de 06: la E2E inicial midió solo la caja SVG y el fixture horizontal ocupaba **54,8 %** de la altura útil en el marco vertical. Se añadió un fixture desktop vertical (el renderer conserva su relación de aspecto) y la huella visible final ocupa **94,4 %**; el fixture móvil permanece casi cuadrado. Se corrigió además una fila autoexpandida por el chat que alejaba el zoom **103 px** de las tarjetas: ahora el E2E limita la separación a **24 px**.
- Auditoría táctil móvil del chat: el test rojo encontró alturas de **40 px** en subida de imagen, pestañas, zoom, decisión y continuación. Se llevaron a **≥44×44 px**, se compactó la separación/texto y se conservó la separación exigida respecto de navegación; la prueba Mobile Chrome pasa y la captura 06 permanece completa.
- Auditoría del mapa semanal: la captura 05 mostraba «Sin asignar» ocupando el pasillo/aseo estrecho y colisionando con etiquetas vecinas. Se oculta únicamente el rótulo de titular cuando la menor dimensión del polígono es inferior a **1600 unidades**; se mantienen nombre, relleno, avatar si existe, selección y `aria-label` con estado. Unit test **16/16** y regresión E2E móvil pasan; la comparación PC/móvil se regeneró e inspeccionó tras el pase conjunto.
- Crítica del estado vacío a partir de la captura real: en un piso sin zonas el mensaje genérico «Añade una zona o dibuja el primer espacio» persistía debajo del lienzo incluso al dibujar libremente, duplicando/contradiciendo la instrucción del modo. TDD falló primero; ahora el mensaje con icono de plano solo aparece en selección y desaparece al empezar un dibujo. El E2E valida presencia, SVG de 18×18 px y alineación icono/texto (≤1 px), y vuelve a comprobar que reaparece al volver a selección. Primera corrida E2E detectó un selector de prueba que contaba el SVG exterior y el SVG interno del glifo como dos iconos; se restringió al SVG directo (no era defecto de interfaz). Ejecución aislada final `node scripts/run-isolated-playwright.mjs --project=chromium --project=mobile-chrome tests/e2e/household-plan-tasks.spec.ts`: **2/2**, 54,5 s, DB/artefactos temporales, proveedor simulado. Unit test del editor: **28/28**. Capturas sintéticas `02-plan-editor-empty-floor.png` y `02-plan-editor-empty-freeform.png` en ambas carpetas `chromium` y `mobile-chrome`; 12 comparaciones PC/móvil regeneradas e inspeccionadas.
- Revisión crítica tras la nueva captura del editor: la imagen aportada muestra el estado de zona libre sin selección visible ni iconos en las acciones de vértice. En el build actual esos defectos ya están cubiertos por el dock persistente `Zona libre`, su estado `aria-pressed`, y SVG/geométrica común en las acciones; la captura aislada actual `chromium/02-plan-editor-wide-desktop.png` confirma su representación a 1920 px. No se da por resuelta la impresión global: siguen abiertos el calco exacto de SVG y las diferencias visibles de densidad/espaciado de las pantallas de propuesta, tareas y chat recogidas en los checks pendientes.
- Revalidación visual (12-10-2026): se ejecutó `node scripts/run-isolated-playwright.mjs --project=chromium --project=mobile-chrome tests/e2e/household-plan-tasks.spec.ts` — **2/2 en 51,7 s** con DB/artefactos temporales y proveedor simulado; la cobertura incluye móvil 320×568, 390×950 y orientación 568×320. Se regeneraron las 12 comparaciones con `scripts/create-household-plan-comparison.ps1` y se inspeccionaron de nuevo las vistas de Inicio, editor, propuesta fotográfica, asignación y ajuste por chat. El mapa móvil de asignación alcanza 380 px y mantiene ≥8 px hasta la hoja de asignación. Persisten diferencias no cosméticas: densidad y saltos de línea de los controles de chat en móvil, jerarquía del panel semanal y correspondencia exacta de las formas SVG.
- Revisión crítica de asignación (12-10-2026): Playwright rojo reprodujo las cuatro opciones PC apiladas con **186 px** entre la primera y la última. Se reorganizaron en cuatro tarjetas de igual tamaño, con avatar, nombre y radio alineados; `Compartida` cabe como palabra completa. La regresión PC+móvil verifica una sola fila, alturas iguales ≥72 px, nombre sin desbordamiento y que la hoja/CTA móvil siguen intactos. `node scripts/run-isolated-playwright.mjs --project=chromium --project=mobile-chrome tests/e2e/household-plan-tasks.spec.ts` — **2/2, 51,6 s**; DB y artefactos temporales, proveedor simulado. Comparaciones 04 PC/móvil regeneradas e inspeccionadas en `.e2e-screenshots/household-plan-comparison/04-zone-assignment-{desktop,mobile}.png`. La auditoría de fidelidad global continúa abierta.
- Auditoría de checklist móvil (12-10-2026): la prueba roja midió filas de **24 px**, con acciones imposibles de tocar con precisión. El E2E exige ahora fila, completado y edición ≥**44×44 px**, y comprueba que la última tarea se puede desplazar completa encima del footer fijo, separado de la navegación inferior. La posición del footer conserva `env(safe-area-inset-bottom, 0px)` en la hoja de estilos compartida. Tras ampliar filas y objetivos, `node scripts/run-isolated-playwright.mjs --project=chromium --project=mobile-chrome tests/e2e/household-plan-tasks.spec.ts` pasa **2/2 en 51,9 s**; el test cubre además 320×568, 390×950 y 568×320 en Mobile Chrome. Capturas sintéticas PC/móvil regeneradas con `scripts/create-household-plan-comparison.ps1` e inspeccionadas; mobile 05 confirma targets y última tarea sin quedar bajo el CTA. Prettier, `check:ui` (228 archivos/21 reglas), `typecheck:e2e` y `pnpm run build` pasan (warnings Angular/bundles preexistentes). El peso visual del panel semanal permanece abierto; este ajuste táctil no declara fidelidad global.
- Después de esa revisión: `pnpm run check:ui` (228 archivos/21 reglas) y `pnpm run typecheck:e2e` pasan; `pnpm run build` pasa con warnings preexistentes de Angular/presupuesto de bundles y estilos. No se volvió a ejecutar coverage porque las últimas modificaciones fueron solo de estilos y E2E; la última cobertura registrada sigue por encima de 70 % por métrica y archivo del alcance.
- Entrega intermedia publicada sin cerrar la revisión: commit `89f26da` (`fix(household): polish floorplan editor flow`) en `feat/household-floorplan`. Lefthook pre-commit y pre-push pasaron sin bypass; el push ejecutó formato, `check:ui`, build, typecheck E2E y suite completa (config **11/11**, cliente **1406/1406**, servidor **1330 aprobadas + 1 omitida**). PR #47 permanece Draft; la fidelidad visual sigue abierta.

- Auditoría de alineación de agenda PC (12-10-2026): rojo reproducido porque «Lunes, 12 oct» ocupaba varias líneas en la columna estrecha de día. Se muestran los nombres breves localizados del prototipo, se reduce la columna de etiqueta de 74 a 56 px para dar aire a cada asignación y la fecha larga continúa en `aria-label`. La E2E verifica los siete nombres visibles en una sola línea y las siete fechas completas accesibles; el primer pase también detectó una aserción previa que aún esperaba el texto largo visible y se actualizó al nuevo contrato. Ejecución final `node scripts/run-isolated-playwright.mjs --project=chromium --project=mobile-chrome tests/e2e/household-plan-tasks.spec.ts` — **2/2, 52,1 s**. Se regeneró la comparación PC/móvil y se inspeccionó `05-weekly-tasks-{desktop,mobile}.png`, además de la captura sintética 1920×1032. La comparación móvil aún muestra diferencias de densidad y de alcance visible del checklist; la jerarquía global de Tareas sigue abierta.
- TDD del dock de dibujo (12-10-2026): la E2E roja midió tarjetas de **100 px** frente a los **88 px** del prototipo y detectó el glifo seleccionado naranja. La causa era una regla de 100 px de mayor especificidad en el SCSS encapsulado del editor, que ocultaba la medida del estilo global. Se armonizaron ambas capas en tarjetas de 88 px, glifos 32×32 y glifo activo azul marino; los rótulos/borde conservan el énfasis del token naranja. La aserción a 1920 px mide las 11 tarjetas y sus 11 iconos y compara color del seleccionado. `node scripts/run-isolated-playwright.mjs --project=chromium --project=mobile-chrome tests/e2e/household-plan-tasks.spec.ts` pasa **2/2 en 50,9 s**, incluidos 320×568/390×950/568×320; las comparaciones `02-plan-editor-{desktop,mobile}.png` se regeneraron e inspeccionaron, así como la captura de dibujo libre a 1920×1032. Se mantiene pendiente el cotejo de las formas SVG restantes contra el prototipo.
- Corrección del dock tras nueva crítica visual (13-10-2026): al enfrentar las capturas, la decisión anterior de mantener azul el cursor activo sí contradecía el prototipo; no bastaba con conservar un icono legible. TDD volvió a rojo (`rgb(194,65,12)` frente a `rgb(249,115,22)`), y el glifo seleccionado ahora usa `--primary` sin recolorear los demás. «Dibujar pared» también se partía y no coincidía con el rótulo del mockup; se cambió a «Pared» en ES/EN y se actualizaron los selectores E2E con coincidencia exacta. Verde: `node scripts/run-isolated-playwright.mjs --project=chromium --project=mobile-chrome tests/e2e/household-plan-tasks.spec.ts` — **2/2 en 52,7 s**, servidor y DB aislados, IA simulada. Comparaciones `02-plan-editor-{desktop,mobile}.png` regeneradas e inspeccionadas; aún falta calcar y cotejar las siluetas SVG de puertas/ventanas/estancias/chat/asignación.
- Calco incremental de pictogramas (13-10-2026): rojo E2E confirmó que la ventana carecía del parteluz solo en la franja central y que la puerta aún representaba un arco de giro ausente en el mockup. Una ampliación visual evitó sobrecorregir la ventana a cuatro paños. Se corrigieron la división central y el contorno arqueado de puerta. Verde: `node scripts/run-isolated-playwright.mjs --project=chromium --project=mobile-chrome tests/e2e/household-plan-tasks.spec.ts` — **2/2 en 53,5 s** con aislamiento/IA simulada. `scripts/create-household-plan-comparison.ps1` regeneró las 12 comparaciones; se inspeccionó `02-plan-editor-{desktop,mobile}.png`. Los pictogramas de estancias, chat y asignación siguen en auditoría.
- Calco de estancias (13-10-2026): la ampliación en seis símbolos mostró diferencias internas claras aunque todas las cajas SVG fueran correctas. Se ajustaron cocina, sofá, WC, cama y planta de patio; el pasillo ya coincidía. El test de componente fue primero rojo en ambos casos y luego `pnpm --filter @hogaria/web exec ng test --no-watch --include=src/app/features/household/household-area-glyph.component.spec.ts` — **2/2**. Regresión de flujo `node scripts/run-isolated-playwright.mjs --project=chromium --project=mobile-chrome tests/e2e/household-plan-tasks.spec.ts` — **2/2 en 52,7 s** con DB aislada/IA simulada. Se regeneraron las 12 comparaciones y se inspeccionó `02-plan-editor-{desktop,mobile}.png`; aún quedan iconos de chat/asignación.
- Ajuste del inicio desktop (13-10-2026): Playwright rojo midió el rótulo «Plantas» **42 px** más abajo que «Tipo de vivienda» y el selector en **148,39 px** frente a 168. La causa fue el centrado vertical de la segunda columna y su track mínimo de 150 px, que junto al divisor/padding encogía el picker. Se ancló arriba y se reservó el ancho interno preciso (track 190, picker 168) solo desde 768 px. Verde: E2E `chromium` + `mobile-chrome` **2/2 en 52,2 s**; escritorio comprueba alineación ≤1 px/168 px exactos y la aserción móvil de centrado/ancho compacto sigue pasando. Se regeneraron e inspeccionaron `01-plan-start-{desktop,mobile}.png`.
- Corrección del encabezado de propuesta por chat (13-10-2026): el cotejo 06 reveló que «Volver al lienzo» se partía en dos y «Subir nueva foto o boceto» también se partía al dar ancho al primer botón. El E2E falló primero con dos líneas en el regreso; se redistribuyó el grupo sin tapar subtítulo y se compactó solo el padding horizontal de subida. Verde: Playwright verifica ambos rótulos en una línea, icono/texto centrados y ancho ≥164 px en escritorio a 1280 y 1920, y mantiene el layout móvil. La ejecución aislada `node scripts/run-isolated-playwright.mjs --project=chromium --project=mobile-chrome tests/e2e/household-plan-tasks.spec.ts` pasa **2/2 en 54,9 s**; se regeneraron y revisaron `06-chat-adjustment-{desktop,mobile}.png`.
- Revisión crítica de tareas (13-10-2026): la regresión reprodujo la retícula doble del mapa, el cambio de semana ocupando una fila móvil y solo dos filas de tareas visibles antes del CTA. Se dejó el fondo limpio, se integró la navegación con la zona, se compactó el formulario sin reducir el plano ni los objetivos táctiles y el test mide **3 filas completas** con margen ≥8 px sobre el footer. Se añadieron iconos SVG al añadir, navegación, resumen, menú y CTA; la banda equitativa mantiene unidos el nombre y su recuento para evitar que un número quede huérfano. E2E verifica título semanal visible en PC/móvil, CTA ≥ancho del footer−16 px, menú accesible, mapa sin patrón e iconos. `pnpm --filter @hogaria/web exec ng test --no-watch --include=src/app/features/household/household-tasks.component.spec.ts` — **18/18**; `node scripts/run-isolated-playwright.mjs --project=chromium --project=mobile-chrome tests/e2e/household-plan-tasks.spec.ts` — **2/2 en 51,1 s**, DB/servidor temporales, captura sintética, IA simulada y cleanup confirmado. `pnpm run check:ui` (228 ficheros/21 reglas) y `pnpm run typecheck:e2e` pasan. Capturas regeneradas e inspeccionadas: `.e2e-screenshots/household-plan-tasks/chromium/05-weekly-tasks.png` y `.e2e-screenshots/household-plan-tasks/mobile-chrome/05-weekly-tasks.png`.
- TDD de superficie del editor (13-10-2026): la prueba aislada falló primero en Chromium y Mobile Chrome porque el SVG pintaba una hoja y otra cuadrícula dentro del viewport punteado. Se quitó la hoja interior; ahora una única retícula clara ocupa todo el campo y queda visible bajo el plano, como en el prototipo. La E2E rechaza ambos fondos anidados y mide que los iconos/textos de las tres acciones de dibujo estén centrados con tolerancia ≤1 px. Verde: `node scripts/run-isolated-playwright.mjs --project=chromium --project=mobile-chrome tests/e2e/household-plan-tasks.spec.ts` — **2/2 en 54,7 s**, DB y servidor aislados, IA simulada y limpieza confirmada; editor `ng test` **28/28**, `pnpm run check:ui` (228 ficheros/21 reglas) y `pnpm run typecheck:e2e`. Capturas sintéticas regeneradas e inspeccionadas: `.e2e-screenshots/household-plan-tasks/chromium/02-plan-editor-empty-freeform.png` y `.e2e-screenshots/household-plan-tasks/mobile-chrome/02-plan-editor-empty-freeform.png`.
- Revisión crítica de asignación (13-10-2026): una E2E roja midió la huella del ejemplo en **1,306** frente a la silueta casi cuadrada del mockup (**0,967**); se reescalaron estancias, paredes y offsets/anchos de huecos, y se verificó que sigan abriéndose las cuatro puertas y seis raíles de ventana. La captura también mostró el borrador «Compartida» en el panel mientras el mapa conservaba color/avatar anterior. Ahora el mapa previsualiza los miembros y relleno seleccionados antes de guardar; al cerrar sin guardar vuelve a la asignación persistida. La selección conserva el color semántico bajo su contorno naranja. En escritorio las cuatro opciones son filas de ancho completo con avatar/nombre/radio centrados a ≤1 px; móvil mantiene cuatro tarjetas y CTA táctiles. Validación final: `pnpm --filter @hogaria/web exec ng test --no-watch --include=src/app/features/household/household-plan-editor.component.spec.ts` **29/29**; `node scripts/run-isolated-playwright.mjs --project=chromium --project=mobile-chrome tests/e2e/household-plan-tasks.spec.ts` **2/2 en 51,1 s**; `pnpm run check:ui` (**228 ficheros/21 reglas**), `pnpm run typecheck:e2e` y `git diff --check`. Comparaciones sintéticas PC/móvil regeneradas e inspeccionadas: `.e2e-screenshots/household-plan-comparison/04-zone-assignment-{desktop,mobile}.png`. La auditoría global sigue abierta en inicio, foto/propuesta, cotejo de iconos y acabado del chat.
- Auditoría de foto/propuesta (13-10-2026): TDD rojo a **368 px** reprodujo el plano generado demasiado grande frente al mockup de **340 px** en escritorio. Se limitó y centró a 340×340 px; en móvil se redujo el máximo a 300 px para igualar el ancho visual del boceto. E2E comprueba ambos tamaños, la jerarquía de confirmar/cambiar/continuar, icono de descarte sin solapamiento con título/estado y su objetivo táctil; la ejecución aislada combinada `node scripts/run-isolated-playwright.mjs --project=chromium --project=mobile-chrome tests/e2e/household-plan-tasks.spec.ts` pasa **2/2 en 50,5 s**, con DB/servidor temporales e IA simulada. Se regeneraron las 12 comparaciones y se inspeccionó `03-photo-proposal-{desktop,mobile}.png`; la pantalla de propuesta fotográfica queda aceptada. La fidelidad visual global y otras familias continúan pendientes.
- Auditoría visual de tareas (13-10-2026): una medición E2E roja encontró que la fixture final deformaba el plano a **1,30:1 en escritorio**, frente a la huella casi cuadrada del prototipo; mantener esa misma escala también en móvil reducía el mapa a solo **67 %** del ancho útil. Las fixtures E2E ahora reproducen por separado las siluetas de referencia de escritorio (1,00:1) y móvil (1,30:1), sin tocar ni deformar planos reales. En la vista densa, se oculta el pictograma y titular redundantes de una habitación compacta si no cabe con margen; su nombre «Aseo» y estado siguen visibles y accesibles. Una E2E roja confirmó el glifo presente; luego la unitaria del mapa pasó **18/18** y el recorrido `node scripts/run-isolated-playwright.mjs --project=chromium --project=mobile-chrome tests/e2e/household-plan-tasks.spec.ts` **2/2 en 50,6 s**. `check:ui` (228 ficheros/21 reglas) y `typecheck:e2e` pasan; se regeneraron y revisaron `05-weekly-tasks-{desktop,mobile}.png`.
- Indicador de navegación de método (13-10-2026): en móvil el `›` tipográfico de las tarjetas era visualmente débil y no compartía el set SVG del producto; en escritorio, además, no aparecía en el prototipo. Playwright primero falló porque las tres tarjetas no tenían SVG; se añadieron cheurones 18×18 px centrados con tolerancia ≤1 px en móvil y se ocultaron en escritorio. Verde: la suite aislada Chromium + Mobile Chrome pasa **2/2 en 50,1 s**; se regeneraron e inspeccionaron `01-plan-start-{desktop,mobile}.png`. `check:ui`, `typecheck:e2e` y `git diff --check` pasan. Esta mejora resuelve solo ese detalle, no la auditoría visual global pendiente.
- Legibilidad de estancias compactas (13-10-2026): la E2E roja encontró **8 pictogramas** en ambas plataformas cuando el aseo nuevo se montaba con su puerta; una primera expectativa global fija (`7`) resultó demasiado rígida al descubrir tres habitaciones compactas en el fixture de escritorio. Se cambió a comprobar cada etiqueta frente a su propio polígono. La utilidad compartida mide el lado menor de la huella; propuestas/chat/tareas omiten el pictograma en estancias bajo 1600 unidades, conservan nombre/selección y dibujan el rótulo compacto sobre un halo de fondo para no fundirse con líneas. `ng test` enfocado — **36/36**; E2E aislada Chromium + Mobile Chrome — **2/2 en 49,8 s**; suite web completa con cobertura — **1412/1412**, statements **94,00 %**, branches **84,89 %**, funciones **93,89 %**, líneas **95,69 %**. Cobertura por archivo: `household-plan-editor.utils.ts` 94,53/79,59/98/98,96 %; `household-plan-preview-map.component.ts` 98,33/76,92/100/100 %; `household-tasks.component.ts` 93,52/85,21/93,91/95,90 % (statements/branches/funciones/líneas). `check:ui`, `typecheck:e2e`, Prettier y `git diff --check` pasan. Se regeneraron las 12 comparaciones y se inspeccionaron `05-weekly-tasks-{desktop,mobile}.png` y `06-chat-adjustment-{desktop,mobile}.png`; las capturas sintéticas muestran «Aseo» sin pictograma intrusivo y con nombre legible. El resto del cotejo de iconos y acabado del chat sigue abierto.
- Título del chat IA (13-10-2026): TDD rojo en Chromium y Mobile Chrome detectó «Ajustar con IA» frente a «Asistente IA» del prototipo. Se añadió `household.plan_assistant_title` en ES/EN sin cambiar la acción «Ajustar con IA» del formulario. Verde: Playwright aislado **2/2 en 50,3 s** y las capturas `06-chat-adjustment-{desktop,mobile}.png` inspeccionadas; el título ahora coincide. La auditoría de densidad/espaciado del chat permanece pendiente.
- Auditoría crítica del inicio (13-10-2026): tras inspeccionar PC, móvil y 320 px, se acepta la jerarquía/espaciado del formulario, las tres tarjetas ilustradas, la selección neutra, el selector de plantas, la CTA y los márgenes del dock. El chequeo de contraste conserva texto oscuro sobre naranja: el blanco del mockup no alcanza 4,5:1, mientras Playwright exige AA en ambos temas. En móvil, los cheurones eran demasiado finos/pálidos; TDD aislado detectó primero trazo **1,8 px** frente a **2,2 px**, y la revisión adversarial encontró negro (**rgb(28,25,23)**) donde el prototipo usa marino (**rgb(32,52,73)**). Se fijó `#203449`; tema oscuro vuelve a texto principal y Playwright lo verifica como **rgb(250,250,249)**. `node scripts/run-isolated-playwright.mjs --project=chromium --project=mobile-chrome tests/e2e/household-plan-tasks.spec.ts` — **2/2 en 50,4 s** con DB/servidor temporales e IA simulada. Capturas comparativas PC/móvil regeneradas e inspeccionadas; Prettier, `check:ui` (**228 ficheros/21 reglas**), `typecheck:e2e` y `git diff --check` pasan. Inicio queda aceptado; el cotejo SVG de herramientas/chat/asignación y el chat aún siguen abiertos.
- Destello del asistente (13-10-2026): la ampliación del recorte 06 mostró el pictograma visible menor pese a un contenedor presente; TDD falló PC y móvil (**20×20 px** frente a los **24×24 px** visibles en referencia). Se amplió el SVG y se añadió medición geométrica de caja/alineación PC+móvil. Verde: Playwright aislado Chromium + Mobile Chrome **2/2 en 50,4 s** con datos temporales y proveedor simulado; comparaciones 06 regeneradas e inspeccionadas. Prettier, `check:ui` (**228 ficheros/21 reglas**), `typecheck:e2e` y `git diff --check` pasan.
- Avatar y continuación del chat (13-10-2026): la ampliación de 06 mostró el icono de hogar pequeño y «Subir nueva foto o boceto» debajo del icono, mientras las otras tres etiquetas quedaban en fila. TDD midió el avatar en **19×19 px** frente a 24; después detectó la causa del desalineado: `.plan-editor label { display:grid }` también alcanzaba la etiqueta de subida y medía una separación horizontal **−24 px** y desfase vertical **26,5 px**. Se excluyó el control de continuación del estilo de campos, se envolvieron los cuatro rótulos como elementos flexibles y se igualaron los SVG a **24×24 px**; se conserva el mínimo táctil y los cuatro controles terminan antes del dock fijo. Verde: Playwright aislado Chromium + Mobile Chrome **2/2 en 50,9 s** con DB/servidor temporales y proveedor simulado; se regeneraron e inspeccionaron las comparaciones 06 PC/móvil. `check:ui` (**228 ficheros/21 reglas**) y `typecheck:e2e` pasan.

### Puertas generales

- [x] API: TDD con fixtures sintéticos y proveedor simulado; DB temporal
      verificada explícitamente. No llamar a IA real para gates repetibles.
- [x] Typecheck, build, `check:ui`, tests completos aplicables y cobertura ≥70 % por archivo;
      registrar comando, resultado y limitación exactos.
- [x] Hooks pre-commit/pre-push obligatorios ejecutados sin bypass: Prettier, `check:ui`, build,
      typecheck E2E y tests completos.
- [x] CI manual final de esta auditoría `38370834683`: nueve jobs verdes sobre el código y la matriz
      responsive corregida; PR #47 permanece Draft.
- [x] Inspección Playwright con servidor aislado y datos sintéticos; PC y móvil, capturas comparables,
      geometría equivalente con tolerancia ≤1 CSS px, teclado/labels y ninguna información privada.
- [x] PR #47 continúa Draft como se solicitó; no se hizo merge.

Cobertura verificada localmente (repetición final después de la revisión visual):

- `$env:DATABASE_PATH=':memory:'; pnpm run test:coverage` — servidor: 66 archivos, 1330 pruebas
  aprobadas y 1 omitida; 91,76 % statements, 83,48 % ramas, 95,56 % funciones y 94,27 % líneas.
  Cliente: 1406 pruebas aprobadas; 93,95 % statements, 84,83 % ramas, 93,82 % funciones y
  95,65 % líneas. Los archivos del alcance superan 70 % en cada métrica; editor
  85,87/71,01/85,36/89,92 %, utilidades 94,22/79,38/97,95/98,89 % y tareas
  93,09/83,8/93,85/95,75 % (statements/ramas/funciones/líneas).
- `pnpm run check:ui`, `pnpm run typecheck:e2e` y `pnpm run build` — aprobados. `check:ui` revisó
  228 archivos y 21 reglas; el build muestra
  warnings de Angular ya presentes fuera de este cambio.
- `pnpm run test:config` — 11/11 pruebas aprobadas. `pnpm run check:ui` revisó 228 archivos y 21
  reglas sin incidencias.
- Repetido en esta revisión: `pnpm run check:ui`, `pnpm run typecheck:e2e`, `pnpm run test:config`,
  `pnpm run test:coverage` y `pnpm run build` pasan. El build mantiene warnings de presupuesto de
  bundles/estilos ya existentes.
- `pnpm run lint:client` no puede iniciar Angular ESLint porque falta el paquete existente
  `@angular-eslint/builder` (`Could not find ... builder's node package`). No se añadió dependencia
  fuera de alcance; `check:ui` sí pasa y ese lint no forma parte del gate de CI ni de los hooks.
- Los commits de esta entrega se publicaron en `feat/household-floorplan` (persistencia, UI, E2E y
  matriz responsive). Los hooks pre-commit y pre-push pasaron sin bypass: Prettier, check:ui, build,
  typecheck E2E y `pnpm run test` (11 config, 1406 client, 1330 server + 1 skip).
- `pnpm run lint:server` no pasa por el script existente (`eslint src --ext .ts` rechaza `--ext`
  bajo ESLint 9); el CI y los hooks actuales no invocan ese lint. No se alteró esa configuración,
  fuera del alcance de esta entrega.
- La CI de este repositorio ejecuta su shard E2E canónico en Chromium; `mobile-chrome` se validó
  adicionalmente en esta sesión. El PR #47 se mantuvo Draft hasta pasar gates y su base
  `arena/01a0a6c2-micocinai` no coincide con `main`/`master`, las ramas del disparador `pull_request`;
  GitHub omitió CI al publicar.
  Por eso se ejecutó `CI` manualmente, sin cambiar la base ni ampliar el diff. La primera corrida
  (`38172522119`, SHA `c0ffe8a`) detectó tres defectos de las comprobaciones E2E: el test de
  calendario no navegaba a la fecha creada fuera de la semana visible; el test de caducidades
  buscaba la última fila con `:last-of-type`, que no correspondía al último resultado; y la matriz
  responsive omitía B−1 para los breakpoints CSS nuevos de 359 y 639 px del plano/tareas.
  Se corrigieron los tres tests, sin alterar el comportamiento de producto, en `cc073cd`; el lote
  enfocado de los tres casos pasó 3/3. La corrida completa posterior [CI #38173445803](https://github.com/juanjoGonDev/MiCocinAI/actions/runs/38173445803), sobre el SHA
  `cc073cd6b0a3dbfea9826cc1ed154540ffa4f434`, terminó **success** en sus nueve jobs: los cuatro
  shards E2E, E2E full-stack, tests de servidor, typecheck y builds. Usa fixtures sintéticos; no
  llamó al proveedor de IA. No se cambió la base del PR.
- La ejecución final `CI #38212052262`, sobre el código `a7e9c086cb48eb7cdaa91cb7c3292a12a88f3fd3`,
  terminó **success en los nueve jobs** (cuatro shards E2E, full-stack, typecheck, servidor y builds).
  El primer intento de esta pasada (`38211116502`) solo falló porque la matriz no incluía B−1/B/B+1
  para los nuevos breakpoints 389, 1199/1200 y 1279/1280 px; tras añadirlos, el spec responsive
  completo pasó 7/7 localmente y la corrida final quedó verde. El cambio posterior en la spec solo
  registra esta evidencia; no modifica código de producto. Sin llamadas reales al proveedor.

## Fuera de alcance v1

- Medidas arquitectónicas certificadas, cálculo de superficies/instalaciones, planos técnicos para
  obra, exportación CAD, navegación AR, sincronización domótica, notificaciones push y permisos
  configurables nuevos.
- La geometría generada es un boceto organizativo editable, no documento profesional ni medición
  fiable. La interfaz debe dejar claro que la persona revisa y confirma el resultado.

## Seguimiento de calidad visual — controles y alineación (13-10-2026)

La auditoría previa no se considera cierre suficiente: el usuario observa un switch visiblemente
descentrado en la barra «Ajustar a cuadrícula» y reporta más inconsistencias. La captura nueva es
la evidencia de referencia para este seguimiento; no se dará por resuelto el problema por existir
un control funcional o por pasar checks de estructura. La afirmación de auditoría anterior de que
«no quedan desajustes geométricos» queda **invalidada como criterio de cierre** hasta repetir la
inspección visual y geométrica de forma crítica.

### Hallazgos confirmados y correcciones

- La captura inicial y la medición Playwright encontraron que el switch del plano era un checkbox
  oculto con una pista CSS independiente: el área alcanzable medía solo **18 px**. Ajustes tenía
  otra implementación. No había contrato geométrico ni de teclado común.
- La desviación horizontal concreta venía de una regla heredada `.plan-canvas__snap` que imponía
  `display: inline-flex !important` al control, aunque el thumb se dibujaba con `margin: 3px`.
  El track quedaba **3 px fuera del centro**. La variante móvil repetía el conflicto al imponer
  `display: flex !important`.
- Tras migrar ambos consumidores a `app-switch`, Playwright volvió a detectar el conflicto en el
  selector anterior `.plan-canvas__snap`; se eliminó la colisión y se usa el host `inline-grid`
  compartido. La geometría final es objetivo **44×44 px**, track **38×22 px**, thumb **16×16 px**,
  inset horizontal simétrico **3 px** y centro vertical con tolerancia **≤1 CSS px**, en ambos
  estados.
- La inspección móvil detectó además que el panel de opciones avanzadas se superponía **12 px** a
  la descripción del editor. Se separó el panel y E2E comprueba la distancia en 390×950, 320×568
  y 568×320.
- La revisión de la propuesta desde foto mostró la pregunta de entrada pegada a «Confirmar» y
  «Cambiar»: el CSS móvil anulaba todo el `gap` de la tarjeta. Se restablecen **8 px** bajo la
  pregunta y E2E verifica el espacio entre texto y ambos botones.
- El primer E2E de Safari móvil no abría el panel al tocar una zona. El flujo solo inicializaba
  la selección completa desde el `click` del polígono, después de capturar el puntero. La activación
  se traslada también a `pointerup` cuando el gesto fue un toque sin arrastre; los arrastres y la
  herramienta actual se conservan.
- La prueba táctil ahora busca un punto de relleno realmente visible dentro del polígono en vez de
  asumir que el centro de su bounding box siempre cae dentro de la zona. La suite anterior tapaba
  a veces una pared superpuesta y producía un falso negativo.

### Aceptación obligatoria antes de cerrar

- [x] **Auditoría crítica reproducible:** volver a abrir los seis estados de plano/tareas en
      servidor Playwright aislado, inspeccionar los controles uno por uno y registrar defectos
      visibles de alineación, iconos ausentes/incorrectos, tamaño de toque, contraste, recorte,
      desbordamiento o separación. No descartar un defecto porque `scrollWidth` no detecte overflow.
- [x] **Componente compartido `app-switch`:** definir una única pista/thumb, estado on/off,
      accesibilidad (`role=switch`, nombre, `aria-checked`, deshabilitado/ocupado), teclado,
      foco visible y objetivo táctil ≥44×44 px; soportar etiqueta/hint externos sin duplicar
      nombres accesibles. La pista y el knob se posicionan por geometría explícita, no por márgenes
      de texto ni herencia accidental.
- [x] **Unificación de consumidores:** sustituir las variantes desktop/móvil de ajuste de cuadrícula
      y el switch de módulos de Ajustes por el componente compartido, conservando la persistencia,
      permisos, bloqueo durante guardado, selectores de pruebas y traducciones.
- [x] **Pruebas rojas antes del cambio:** cobertura de componente para cambio repetido, teclado,
      nombre/estado accesibles, ocupado, deshabilitado y labels; E2E a 1280×970 y 390×950 mide
      track y thumb en ambos estados y exige centro vertical ≤1 CSS px, márgenes laterales
      simétricos ≤1 CSS px, hit target ≥44×44 px y contraste ≥3:1 del thumb/track activo y foco.
      Repetir geometría y contraste en Ajustes, además de modo oscuro/claro.
- [x] **Revisión de todos los controles de los seis estados:** corregir cada defecto confirmado,
      no solo el switch. Verificar que botones/iconos forman una unidad centrada, que controles
      equivalentes comparten dimensiones/padding/alineación, y que texto/acciones no se solapan ni
      quedan fuera de la vista. Registrar explícitamente los puntos revisados que no requieren
      cambios; no ajustar tamaños aislados sin una regla compartida que lo justifique.
- [x] **Responsive y accesibilidad:** comprobar estados PC, 390×950, anchura mínima 320×568,
      orientación 568×320, foco/teclado, contraste, áreas táctiles, safe-area y ausencia de
      recorte/overflow en editor, propuesta, chat y tareas; verificar la ruta de Ajustes afectada
      por el switch compartido.
- [x] **Evidencia visual:** guardar e inspeccionar capturas sintéticas PC/móvil antes/después y
      comparar de nuevo las 12 vistas de producto; obtener rects de componentes equivalentes y
      documentar diferencias reales. No cerrar la spec mientras exista una desalineación
      reproducible dentro del alcance.
- [x] Actualizar resultados/comandos/limitaciones aquí; mantener PR #47 en Draft. Cada unidad va
      en commit atómico con pruebas, hooks completos y push a la rama actual.

#### Evidencia de esta auditoría

- **Inspección visual:** se generaron e inspeccionaron las doce comparativas sintéticas de
  escritorio/móvil (`.e2e-screenshots/household-plan-comparison/01-...` a `06-...`) y las vistas
  específicas del switch en escritorio, Chrome móvil y Safari móvil bajo
  `.e2e-screenshots/household-plan-tasks/`. La captura inicial del usuario sirve de antes; las
  capturas E2E de PC/móvil muestran el después. Inicio, asignación, tareas y chat no mostraron
  defectos reproducibles adicionales de alineación ni iconos faltantes/descentrados; las acciones
  solo textuales conservan su etiqueta. En el editor se corrigieron el switch y el solapamiento de
  12 px del panel; en propuesta desde foto, el espacio de la pregunta; en Safari, la selección
  táctil de zonas.
- **TDD del contraste:** la nueva aserción E2E primero falló de forma determinista: thumb/pista
  activa **2,68:1**, bajo el mínimo **3:1**. La pista activa usa ahora el naranja 600 y el foco el
  naranja oscuro accesible. La prueba enfocada pasó **1/1** en Chromium; la geometría y el
  contraste también pasan en los tres proyectos del E2E final.
- **E2E aislado final:**
  `node scripts/run-isolated-playwright.mjs --project=chromium --project=mobile-chrome --project=mobile-safari tests/e2e/household-plan-tasks.spec.ts tests/e2e/settings-modules.spec.ts`
  — **36/36**; DB y artefactos del servidor aislados y limpiados al terminar.
- **Pruebas de cliente:** los tres specs enfocados del componente, Ajustes y editor pasaron
  **41/41**; la suite con cobertura pasó **1.418/1.418**, con statements **93,98 %**, ramas
  **84,9 %**, funciones **93,87 %** y líneas **95,67 %**.
- `pnpm run typecheck:e2e`, `pnpm run check:ui` (**229 archivos, 21 reglas**), `git diff --check`
  y `pnpm exec prettier --check` para todos los archivos modificados pasaron.
- `scripts/create-household-plan-comparison.ps1` generó de nuevo las 12 comparativas con el color
  accesible final. El E2E cubre 1280×970, 390×950, 320×568 y 568×320; valida centro y márgenes
  ≤1 CSS px, hit target 44×44 px, ambos estados, teclado/foco y modos claro/oscuro.
- **Limitación conocida:** `pnpm run lint:client` sigue sin poder arrancar porque falta el paquete
  ya requerido `@angular-eslint/builder`; no se añadió una dependencia fuera del alcance. `check:ui`
  y los hooks sí cubren el cambio.
- **Entrega:** `cf39429` está publicado en `feat/household-floorplan`. Lefthook pre-commit y
  pre-push pasaron sin bypass: Prettier, check:ui, build, typecheck E2E y `pnpm run test`
  (11 config, 1.418 cliente, 1.330 servidor y 1 skip). PR #47 continúa Draft; no se cambió su base
  ni se hizo merge.
- **Matriz responsive en CI:** la ejecución manual `38369051262` sobre `e139a934` detectó que el
  media query `max-width: 339px` no incluía las anchuras B−1/B/B+1 (`338/339/340px`). Se añadió
  ese breakpoint a `WIDTH_BREAKPOINTS`; el spec completo `tests/e2e/layout-gutters.spec.ts` pasó
  **7/7 en 1,3 min** con servidor y SQLite aislados. La CI final [#38370834683](https://github.com/juanjoGonDev/MiCocinAI/actions/runs/38370834683),
  sobre `91f18268972ea2b088e634d6e79ca2673cacf873`, terminó **success en los nueve jobs**: cuatro
  shards E2E, full-stack E2E, build de producción, servidor y typecheck. PR #47 continúa Draft.

## Seguimiento de acabado visual — menú de opciones del plano

La captura de usuario del 13-10-2026 descubre una discrepancia no cubierta por la auditoría anterior:
el menú móvil de «Más opciones» mezcla alturas y alineaciones de botones, pone acciones de gestión
de plantas al mismo nivel visual, y «Eliminar planta» no tiene apariencia destructiva. El menú debe
parecer un único grupo de controles diseñado; no basta con que los controles funcionen.

### Aceptación

- [x] Reproducir el menú abierto en Playwright en escritorio y móvil; medir tamaños/alineación de
      botones actuales y guardar capturas sintéticas de referencia.
- [x] Agrupar visual y semánticamente edición del plano, tipo de vivienda y acciones de plantas;
      respetar los componentes/paleta existentes y no cambiar persistencia ni comportamiento.
- [x] Normalizar acciones del mismo grupo a altura y ancho coherentes (mínimo táctil 44×44 px),
      tipografía, padding, icono y separación; iconos y texto forman una unidad centrada.
- [x] Diferenciar el modo de dibujo seleccionado con el acento HogarIA; mostrar añadir planta/sótano
      como acciones secundarias consistentes; destacar «Eliminar planta» con el token de peligro y
      pictograma de eliminar, sin quitar ni debilitar su confirmación existente. «Descartar cambios»
      conserva apariencia secundaria y un estado deshabilitado legible.
- [x] En móvil, «Ajustar a cuadrícula» conserva el componente compartido `app-switch`, con nombre
      accesible y objetivo táctil de 44×44 px; medir el centro vertical del pulgar y que sus
      posiciones activada/desactivada ocupen correctamente extremos opuestos del carril (≤1 CSS px).
- [x] Medir que controles comparables comparten rectángulos con tolerancia de 1 CSS px donde deban
      ser equivalentes; el menú no recorta el contenido ni tapa el dock/CTA con 320×568, 390×844,
      escritorio y orientación apaisada. Si excede la altura disponible, su contenido puede desplazarse.
- [x] Verificar contraste, nombre accesible, teclado/foco y estado deshabilitado; guardar e inspeccionar
      capturas finales de escritorio y móvil bajo `.e2e-screenshots/`.
- [x] Actualizar esta evidencia solo después de pruebas reproducibles; mantener PR #47 Draft y correr
      todos los hooks sin bypass antes de commit/push.

### Evidencia y limitaciones

- La regresión se ejecutó en rojo antes de implementar. Línea base observada: «Dibujar zona» 59 px,
  «Añadir planta» 69 px y las acciones restantes 40 px; el texto de eliminar tenía contraste 1,20:1.
  El menú invadía el dock 90 px en 320×568 y 319 px en 568×320; no tenía desplazamiento interno.
- Prueba final aislada (fixture sintético y almacenamiento temporal):
  `node scripts/run-isolated-playwright.mjs --project=chromium --project=mobile-chrome --project=mobile-safari tests/e2e/household-plan-tasks.spec.ts -g "el menú del plano"`
  → **3/3 proyectos pasan**. Los cinco botones miden 44×334 px en escritorio y 44×332 px en móvil;
  icono/texto centrados con desviación máxima de 0,008 CSS px. En 320×568, «Añadir planta» queda
  completamente visible; el resto se alcanza desplazando el menú, sin cubrir el dock. En 568×320,
  el panel empieza 8 px bajo el encabezado fijo y mantiene scroll propio sobre el dock. Se cubrieron
  320×568, 390×844, 568×320 y los bordes B−1/B/B+1 de 400 px de alto y 767 px de ancho.
- `Eliminar planta` usa texto `rgb(185, 28, 28)` sobre `rgb(254, 242, 242)`; contraste calculado
  **5,91:1** en ambos temas. Su handler/confirmación no cambió. El foco de teclado es visible y todos
  los botones conservan nombre accesible. Se activó «Dibujar zona» y se verificó su estado `aria-pressed`,
  clase seleccionada y tokens de acento. «Descartar cambios» se verificó deshabilitado después de guardar
  el fixture; conserva texto legible y cursor de estado deshabilitado. El `app-switch` compartido mide 44 px
  de alto; carril y pulgar
  centrados verticalmente (0 px de desviación) y posiciones opuestas 19/3 px y 3/19 px dentro del carril,
  ambas con tolerancia máxima de 1 CSS px en Chromium y Safari.
- Capturas finales, inspeccionadas visualmente: `.e2e-screenshots/household-plan-tasks/chromium/08-options-menu-desktop-after.png`,
  `.e2e-screenshots/household-plan-tasks/mobile-chrome/08-options-menu-mobile-after.png`,
  `08-options-menu-draw-selected-desktop.png`, `08-options-menu-draw-selected-mobile.png`,
  `08-options-menu-320x568.png` y `08-options-menu-568x320.png` bajo las carpetas de sus proyectos.
  Las capturas sintéticas «antes» se generaron durante la reproducción roja; el test posterior reutilizó
  esos nombres al capturar las pantallas finales, por lo que las imágenes retenidas ahora son las finales;
  las mediciones rojas de línea base quedan registradas arriba.
- Verificaciones: `pnpm run test:client` **1.418 pruebas**, coverage statements 93,98 %, branches 84,90 %,
  functions 93,87 %, lines 95,67 %; `pnpm run check:ui` correcto (229 ficheros); `pnpm run typecheck:e2e`
  correcto. El gate completo `pnpm run test` también terminó correctamente: 1.418 pruebas cliente y
  1.330 pruebas de servidor aprobadas, 1 omitida; `pnpm run build` terminó correctamente. `prettier --check`
  y `git diff --check` pasan. El build mantiene avisos ya presentes
  en `household-plan-editor.component.scss` (10,27 kB frente al presupuesto de 10 kB). `pnpm run lint:client`
  no completa: el `angular.json` referencia `@angular-eslint/builder:lint`, pero ese paquete no está declarado
  ni instalado; no se añadió una dependencia ajena a esta mejora. Los comandos equivalentes a los hooks
  de commit/push terminaron correctamente; los hooks se ejecutan de nuevo automáticamente al publicar.
  El PR permanece Draft.

## Extensión — planificación del hogar, comidas por miembro y alta obligatoria (13-10-2026)

> **Decisión confirmada por el usuario (13-10-2026):** configuración del hogar como valor compartido,
> overrides personales independientes de objetivo/horario apagados por defecto, primero comida común y,
> si no es compatible, eventos individuales asignados; restricciones estrictas personales siempre
> prevalecen. Para una ejecución automática configurada por el hogar, el usuario confirma que una
> planificación nueva se publique en el calendario al finalizar; la propuesta manual mantiene la
> revisión y confirmación explícitas. La extensión está en implementación; los criterios de aceptación
> siguen pendientes hasta tener pruebas reproducibles. La UI de calendario existente se conserva como
> calendario único.

### Decisión de producto

**Decisión del usuario (13-10-2026, «Generar» en tareas):** crea una propuesta semanal nueva con
IA; no requiere plantillas ni copia automáticamente la semana anterior. La IA recibe las zonas
vigentes del hogar y la semana de tareas confirmada más reciente solo como contexto. El proveedor no
recibe nombres, perfiles ni asignaciones personales: devuelve título/fecha/zona y el servidor reparte
entre miembros activos. La propuesta se publica automáticamente únicamente después de validar todos
los ámbitos seleccionados y confirmar que la semana destino no contiene datos ni conflictos manuales.
Esta decisión resuelve la contradicción anterior que excluía la generación automática de tareas de v1;
la regla vigente es la propuesta nueva con IA descrita aquí.

La generación de comidas debe configurarse en **Hogar > Planificación**, porque produce una agenda
para el hogar y necesita considerar a sus miembros. No debe ser un interruptor global de la cuenta.
Cada persona mantiene su perfil alimentario propio; el hogar define valores compartidos por defecto.

| Dato                                                                  | Propietario y resolución propuesta                                                                                                                                       |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Planificación habilitada, comidas/horarios semanales y objetivo común | Configuración del hogar. La automatización permanece pausada hasta activarla expresamente.                                                                               |
| Objetivo personal                                                     | Perfil de cada miembro. Un switch «Usar mi objetivo» empieza apagado; apagado hereda el objetivo del hogar, encendido sustituye solo ese campo por el objetivo personal. |
| Horario/comidas que recibe cada miembro                               | Perfil de cada miembro. Un switch independiente «Personalizar mis comidas» empieza apagado; apagado hereda el horario del hogar, encendido sustituye solo ese horario.   |
| Alergias, intolerancias y restricciones marcadas como estrictas       | Siempre personales y obligatorias; nunca se desactivan al heredar el objetivo/horario del hogar.                                                                         |
| Gustos, ingredientes que no gustan y notas culinarias                 | Siempre personales; se usan como preferencias, no como restricciones de seguridad salvo que la persona las marque explícitamente como estrictas.                         |
| Quién puede editar los valores comunes                                | Miembros con el permiso vigente de configuración del hogar; cada miembro puede editar solo sus propios overrides y perfil. No crear una ACL paralela.                    |

Los dos switches son independientes: personalizar el objetivo no personaliza automáticamente los horarios,
y viceversa. Si un switch está encendido pero falta su valor personal, la UI lo exige antes de generar; no
interpreta el vacío como «sin restricciones». La selección de miembros que comerán en una generación se
confirma para esa planificación: pertenecer al hogar no implica automáticamente comer cada plato.

### Resolución de diferencias entre miembros

1. **Resolver por campo y por comensal.** Para cada persona incluida en la semana, su switch encendido
   aporta su valor personal para ese campo; apagado hereda el valor común del hogar. No se mezclan ni se
   pisan silenciosamente los valores.
2. **Seguridad primero.** Una receta nunca puede incumplir una alergia, intolerancia o restricción
   individual marcada como estricta. Si no hay una receta segura para una persona, se deja el hueco
   claramente sin resolver y se pide intervención; no se inventa una sustitución.
3. **Buscar primero una comida compartida.** Para cada fecha y turno seleccionado, la IA intenta proponer
   una receta segura para todos los comensales de ese evento y razonablemente compatible con sus objetivos
   y gustos. Si encaja, se crea **un evento compartido** sin asignación individual exclusiva, con el grupo
   de comensales y las raciones totales; no una copia por cada miembro.
4. **Separar solo cuando haga falta.** Si una comida común no puede respetar las restricciones duras o
   servir razonablemente a los objetivos aplicables, se proponen platos distintos para los grupos/personas
   afectados. Cada evento queda asignado a sus comensales, indica su objetivo culinario aplicable y su
   número de raciones. La vista previa explica por qué se separó; no se presenta como si todos hubieran
   recibido la misma planificación.
5. **Los valores personales sustituyen los del hogar campo por campo.** Si todos los comensales elegidos
   tienen el override de objetivo encendido, se ignora el objetivo común para esa generación. Si todos
   tienen el override de horario encendido, se ignora el horario común y se generan solo sus turnos
   personales. Si solo algunos lo tienen encendido, el valor del hogar sigue aplicando a quienes lo
   heredan. Si todos usan overrides pero sus valores personales coinciden o son compatibles, aún se puede
   proponer un plato/evento compartido; no se separa a las personas solo por el origen del dato. Un override
   personal no desactiva presupuesto, inventario u otros límites compartidos del hogar configurados.
6. **Objetivos incompatibles no se resuelven ocultando la diferencia.** Si todos contradicen el objetivo
   común mediante overrides, se planifica por los objetivos personales y se omite únicamente el objetivo
   común. Si una receta sirve a varios miembros con objetivos distintos, puede compartirse si sigue siendo
   adecuada; si no, se separan y se explica el criterio. Gustos/disgustos son señales de optimización,
   no motivo automático para multiplicar platos: una diferencia entre lo que gusta a dos miembros no
   implica incompatibilidad; prioriza un plato común razonable, puede omitir un ingrediente que solo
   una persona prefiere o servirlo aparte, y solo propone platos separados si ningún compromiso común
   respeta restricciones estrictas y resulta razonablemente adecuado para todos los objetivos aplicables.
   Un disgusto no se eleva a alergia/intolerancia. La IA no formula diagnósticos ni promete resultados médicos.
7. **Privacidad en el calendario.** La persona asignada ve el objetivo/resumen de su plato. Un evento
   compartido muestra una explicación neutral; no revela alergias, objetivos sensibles ni notas privadas
   de otro miembro. La petición al proveedor incluye solo perfiles de quienes participan.

Ejemplos que deberán quedar cubiertos: dos miembros que heredan el mismo horario comparten un plato si
encaja; uno personaliza objetivo y el otro hereda el común; objetivos personales incompatibles generan
eventos individuales asignados; un plato seguro para todos aparece una sola vez con participantes/raciones;
una alergia obliga a separar o a dejar el turno sin resolver aunque el objetivo común prefiera otra cosa.

### Flujo de planificación, calendario y automatización

- **Hogar > Planificación** organiza la planificación semanal mediante subtabs independientes de
  **Comidas**, **Tareas** y **Ajustes**. No se muestran todos los formularios y estados juntos en un único
  scroll: cada subtab conserva un foco de trabajo claro y la navegación mantiene el contexto del hogar.
  Dentro de **Comidas**, preparación y revisión de la propuesta son pasos separados y mutuamente
  excluyentes: no se apilan el formulario, las siete jornadas y el CTA de confirmación en una sola
  pantalla. En móvil la revisión limita las comidas visibles al día seleccionado o a grupos plegados,
  para que las semanas no se conviertan en una página interminable; confirmar no requiere recorrer
  todas las jornadas. La generación, la propuesta y la confirmación de comidas se presentan como pasos del flujo de Comidas;
  revisar existencias y aprobar una compra se muestra como un paso de revisión antes de abrir/actualizar
  la lista del módulo Compra, no como un panel de controles simultáneos. No crea un
  calendario paralelo: las comidas y tareas planificadas aparecen en el calendario actual, con persona(s)
  asignada(s), estado y hora cuando exista. Un evento de comida compartido se guarda una sola vez con su
  conjunto de participantes y raciones; comidas diferentes son eventos diferentes asignados a sus
  participantes. **Decisión del usuario (2026-10-13):** las comidas confirmadas de la planificación del
  hogar son visibles para todos sus miembros activos con `calendar.view`, aunque una comida individual
  esté asignada a una sola persona; la asignación indica para quién se planificó, no limita quién puede
  verla. La lista de compra también agrega las comidas individuales del plan del hogar y es visible en
  ese ámbito. Esto no comparte calendarios personales, notas privadas, objetivos, alergias ni prompts;
  el autor aún necesita `calendar.edit` para confirmar. `shareCalendar` continúa gobernando solo los
  eventos personales ajenos, no la planificación compartida del hogar.
- Para las tareas, el hogar puede gestionar zonas de dos formas: (a) dibujar/editar un plano interactivo,
  o (b) crear una lista sencilla de zonas con nombre, sin dibujo. Ambas admiten asignar tareas y verlas en
  Planificación; dibujar el plano es opcional. El menú permite eliminar el plano actual y empezar desde
  cero sin borrar el hogar ni tareas independientes de zonas que sigan existiendo. Una zona borrada con
  tareas asociadas exige resolverlas antes de confirmar.
- La propuesta semanal de tareas puede asignar a una persona o repartirlas automáticamente entre miembros
  elegibles. El reparto automático debe ser equitativo y evitar asignar a la misma persona dos días seguidos
  cuando exista una solución válida; si las restricciones o el número de tareas lo hacen imposible,
  muestra la excepción y el motivo. Las asignaciones manuales prevalecen sobre una nueva propuesta salvo
  que la persona confirme sustituirlas.
- La planificación de comidas se genera con la lista de miembros y preferencias resueltas, recetas,
  inventario disponible y horarios/objetivos aplicables. La respuesta de IA es un objeto completo bajo
  `response_format: { type: "json_schema", json_schema: { name, strict: true, schema } }`. El esquema
  es cerrado (`additionalProperties: false`) y exige todos los campos; el servidor vuelve a validar el
  JSON, miembros pertenecientes al hogar, recetas, horarios, raciones, restricciones y duplicados antes de
  mostrar una vista previa. En el flujo manual, la IA no escribe directamente en el calendario ni en el
  inventario: la persona revisa y confirma la propuesta. La excepción es la automatización semanal de
  comidas que el hogar ha activado explícitamente: después de la misma validación, publica automáticamente
  la propuesta en el calendario, sin un paso de confirmación adicional; nunca escribe directamente en
  inventario ni aprueba una lista de compra.
- Cada comida futura tiene estado de planificación independiente del consumo. Al llegar el momento, se
  puede confirmar **realizada** e indicar las raciones realmente cocinadas/servidas, o marcar **no
  realizada**. Planificar o saltar una comida no descuenta stock. Solo la confirmación de raciones
  descuenta los ingredientes estimados de la receta; la misma confirmación no puede aplicarse dos veces.
- La regla de acceso al consumo es por evento: cualquier miembro activo incluido en
  `meal_participants` y con el permiso existente `calendar.view` puede registrar/corregir el consumo de
  esa comida; no necesita `calendar.edit`, porque no está editando la planificación. Una persona con
  acceso al calendario pero no asignada no puede cambiarla. Las escrituras requieren `x-household-id`
  vigente y comprueban el hogar de nuevo dentro de la transacción.
- `PUT /api/household/meal-planning/meals/:mealId/consumption` recibe el estado absoluto y
  `expectedVersion`: `realized` requiere 1–100 raciones; `not_realized` exige 0. Una repetición del
  estado/raciones ya persistido es idempotente aunque llegue con una versión anterior; una corrección
  distinta requiere la versión actual. Cada corrección ajusta solo la diferencia de stock registrada,
  repone lo deducido al pasar a no realizada y escribe estado, stock y movimientos en una transacción.
  El endpoint GET adyacente devuelve `unrecorded`/estado actual y versión para una edición segura. La
  huella de las líneas del snapshot se conserva al registrar el consumo: una receta que cambió no sirve
  para una nueva deducción/corrección, aunque sí se puede marcar no realizada y reponer el débito previo.
- Solo se descuenta del inventario explícito del hogar (`ingredients.household_id`) si `shared_pantry`
  está activado; el stock privado `household_id IS NULL` de cualquier miembro no se atribuye a una comida
  común. Cada ingrediente de la receta por ración se escala por las raciones reales y se resuelve por
  nombre normalizado exactamente igual (Unicode NFKC, mayúsculas/minúsculas y espacios) **y unidad exacta**.
  No hay fuzzy matching ni conversión de unidades. Sin coincidencia o con más de una ficha coincidente no
  se descuenta; un stock insuficiente se consume solo hasta cero. La API devuelve avisos específicos.
  Antes de cualquier ajuste de una ficha ya vinculada por ID se vuelve a comprobar la unidad actual;
  si difiere de la receta, la corrección completa responde conflicto y no altera estado, stock ni ledger.
  Si `shared_pantry` se desactiva después de una deducción, los aumentos de consumo no descuentan más
  stock y devuelven un warning; marcar la comida no realizada aún puede reponer el débito anterior si
  la unidad no cambió.
  Un libro de deducciones netas y movimientos con clave única comida/versión/línea evita duplicar cambios
  al reintentar o corregir. La huella persistida de las líneas impide que una edición posterior de la
  receta cambie cantidades de una corrección; sigue permitiendo revertir el débito con «no realizada».
  Sin receta válida se registra el consumo, pero no se inventan cantidades.
- Después de registrar lo realmente comido, el servidor calcula determinísticamente las necesidades de
  comidas futuras confirmadas a partir de sus snapshots de receta y raciones; no necesita otra llamada a
  IA. Antes de crearla, la UI pide revisar las existencias —en especial lo necesario para las próximas
  comidas—, permite corregir la previsión y presenta un borrador editable. El cálculo es de solo lectura:
  no cambia stock ni Compra. Consolida ingredientes por nombre normalizado (Unicode NFKC, mayúsculas/
  minúsculas y espacios) y unidad exacta; multiplica la cantidad base por las raciones planificadas y
  resta solo existencias del inventario explícito del hogar cuando `shared_pantry` está activo. No usa
  inventarios privados, coincidencia aproximada ni conversión de unidades. Si falta una coincidencia, hay
  varias fichas posibles o solo coincide el nombre con otra unidad, muestra la necesidad y un aviso para
  revisar el stock; nunca adivina. Los ingredientes opcionales aparecen identificados como opcionales y
  no se incluyen en el total obligatorio salvo que la persona los añada. Solo la aprobación crea/actualiza
  la lista del módulo **Compra**; conserva artículos comprados y añadidos manualmente, y los errores,
  cancelación o rechazo no escriben nada. Nunca se afirma que una comida se realizó por el mero hecho de
  estar en el calendario.
- La automatización semanal distingue dos modos: **generar una planificación nueva** (llama al planificador
  cuando llegue la fecha configurada) y **repetir la planificación actual** (reutiliza el plan semanal
  confirmado más reciente del hogar, sin pedir otra respuesta a IA). En modo generar, el ámbito tareas usa
  las zonas vigentes (desde el plano interactivo o la lista sencilla sin dibujo) y la última semana
  confirmada como contexto, valida las referencias de zona y genera asignaciones en el
  servidor a partir de la membresía activa; el ámbito comidas usa el planificador y las preferencias
  efectivas vigentes. Cada ámbito publica en su almacén autoritativo (semana de tareas o eventos de comidas),
  que alimenta el calendario compartido. Si se seleccionan ambos ámbitos, ambos deben completarse y
  validarse antes de publicar cualquiera: el fallo de uno no deja un calendario semanal a medias. El usuario
  autoriza que, al completar y validar todos los ámbitos seleccionados, se publiquen automáticamente; los turnos sin
  resolver, errores, conflictos de versión, asignaciones imposibles o respuestas inválidas no escriben
  parcialmente ni sustituyen el plan actual y quedan señalados para revisión. Repetir no llama a IA,
  conserva el contenido de la última semana confirmada con nuevos IDs/fechas, marca tareas como no
  completadas y no duplica ni reemplaza cambios manuales: si la semana destino ya tiene datos, se detiene
  para revisión. La lista de compra se vuelve a calcular con las existencias actuales y su escritura
  sigue requiriendo aprobación explícita. Solo se publican eventos en huecos sin conflicto con eventos
  confirmados o cambios manuales. Cada ocurrencia planifica la semana ISO completa que empieza el
  primer lunes posterior a su fecha local programada; todas las áreas usan el mismo `weekStart`. Si el
  worker se recupera cuando esa semana ya empezó, la ocurrencia se marca omitida para revisión y no se
  publica un plan parcial. Un indicador pequeño y persistente muestra la próxima ejecución
  automática y tiene un único botón alternable de play/pause; al pausar conserva plan y configuración, y
  al reanudar programa la siguiente ocurrencia futura sin ejecutar en ráfaga las omitidas. Puede
  configurarse si la ejecución abarca tareas, comidas o ambas. Para activar la recurrencia, el hogar debe
  guardar explícitamente día semanal, hora local y zona IANA; no se hereda la zona del servidor ni del
  navegador. Si la hora local no existe por el salto de horario estacional, la ejecución pasa a la primera
  hora local válida posterior; si ocurre dos veces al volver el horario, se ejecuta una sola vez en la
  primera ocurrencia. Un timeout ambiguo de IA no se reintenta a ciegas: se conserva una ejecución
  recuperable para revisión/reintento explícito y la escritura local usa una clave idempotente por
  ocurrencia. La siguiente ejecución debe exponer su instante UTC y etiqueta en la zona elegida.
  La configuración es única por hogar, desactivada por defecto, permite seleccionar tareas/comidas y
  requiere modo, día ISO, hora local y zona IANA explícitos antes de activar. Pausar conserva modo,
  ámbitos y horario; reanudar programa la ocurrencia futura siguiente, no recupera atrasos. Solo puede
  habilitar o cambiar esta automatización una membresía activa con el permiso existente de ajustes del
  hogar (`settings`); para activarla y publicar exige también `calendar.edit`. Las escrituras de un worker
  comprueban que quien autorizó siga activo con esos permisos; la tarea automática se pausa si la
  autorización deja de ser válida. La lectura de configuración no cambia calendario, tareas, inventario
  ni listas de compra.

### Alta de cuenta: pertenencia obligatoria a un hogar

El registro no termina con una cuenta sin hogar: antes de entrar al resto de la aplicación, la persona
elige explícitamente **Crear un hogar** o **Unirme a uno existente** mediante una invitación válida. No
hay ruta de omisión ni acceso al dashboard/calendario con membresía pendiente. Si se interrumpe el flujo,
se puede reanudar sin crear cuentas, hogares o membresías duplicadas. Un código inválido o revocado, una
denegación o un fallo de red deja un error recuperable y conserva la opción de crear hogar o reintentar.
El contrato actual no define caducidad temporal de invitaciones; no se inventa un plazo.
El servidor comprueba la membresía activa en cada ruta protegida; el estado local del cliente no basta.

Se recomienda copiar una sola vez los valores iniciales de planificación vigentes del creador al crear un
hogar para no perder su configuración; desde entonces la casa es la fuente compartida y no hay fallback
por petición a `users.preferences`. Al unirse a un hogar existente no se alteran sus valores comunes; el
perfil personal y los overrides del nuevo miembro se mantienen separados. Cualquier copia/migración
inicial debe ser idempotente y preservar las preferencias originales.

El alcance no añade una capa de compatibilidad para cuentas que permanecen sin hogar. Eso no autoriza
borrar/migrar datos existentes: cualquier cuenta ya creada conserva sus datos y, si carece de membresía,
debe resolverse mediante una pantalla obligatoria de crear/unirse antes de usar funciones scoped al hogar.
Aunque hoy exista un único usuario real, las pruebas usan miembros sintéticos para verificar invitación,
asignación, conflictos y aislamiento; no se implementará un atajo que invalide el flujo de unirse.

### Contrato de implementación y criterios pendientes de aceptación

Los nombres y la resolución de configuración quedan fijados para que UI, API y planificador compartan
el mismo contrato:

- El hogar conserva `objective: { goals, notes }`, `mealTypes` (booleanos por `MealTypeKey`) y
  `mealTimes` (hora `HH:mm` por `MealTypeKey`). Los valores iniciales de `mealTypes` y `mealTimes`
  proceden de los valores actuales del creador al crear un hogar, en una operación idempotente; la
  configuración original del perfil personal no se borra.
- Cada `household_member` tiene `goalOverrideEnabled` y `scheduleOverrideEnabled`, ambos `false` al
  crear la membresía. `schedule` contiene los booleanos de comidas y los horarios personales. El
  valor personal se obtiene del perfil ya existente (`taste.goals`, `taste.goalNotes`, `mealPlan` y
  `mealTimes`); no se copian alergias ni gustos a la configuración común.
- La configuración efectiva se resuelve por campo: el objetivo/horario común si el override está
  apagado; el valor personal correspondiente si está encendido. Un override encendido sin valor
  válido bloquea la generación y pide completarlo. El estado habilitado de la planificación y los
  tipos de comida comunes no se confunden con los dos overrides personales.
- `mealPlan` bajo `users.preferences` deja de ser fuente efectiva de `plan-week`; durante la
  transición se conserva sin borrado ni migración destructiva y solo sirve como valor de origen al
  inicializar el hogar/override. El contrato futuro de §12t.T queda supersedido por esta extensión.

El JSON de cada semana representa eventos con `date`, `mealType`, `time`, `recipe`, ingredientes,
`participantIds`, `servings`, objetivo/resumen visible y estado de resolución. Una comida compartida
es un evento, no una copia por miembro. Antes de confirmar, el servidor valida pertenencia, selección,
horario efectivo, raciones y restricciones estrictas; persiste solo tras aprobación. La IA no recibe
datos de miembros fuera de la selección y el calendario no expone notas privadas de otra persona.

Para las recetas generadas, la IA entrega cantidades de ingredientes **por ración** (rendimiento base
de una ración). El número de comensales de cada evento se decide en el servidor/UI; al cambiarlo,
cantidades se escalan localmente por multiplicación y no se vuelve a llamar al proveedor ni se altera
la receta base. El tiempo de preparación/cocción describe el método, no escala linealmente con las
raciones; se conserva y la receta debe advertir si hace falta cocinar en tandas. La misma aritmética
se aplica al ajustar porciones de una receta guardada con rendimiento base conocido.

### Estado de implementación y evidencia (14-10-2026)

La extensión definida por esta checklist está implementada. El estado de cada unidad se apoya en la
evidencia reproducible de abajo; la única validación con proveedor real es un smoke aislado de una
propuesta sintética, por lo que no se extrapola su resultado a todas las combinaciones de hogares.

- **Alta obligatoria y puerta del servidor — E2E completa:** el registro conduce a crear/unirse al hogar y
  el montaje real de `/api/*` rechaza funciones protegidas sin membresía activa, dejando disponibles
  descubrimiento/crear/unirse. `createHousehold` inicializa preferencias compartidas desde el creador;
  la operación es idempotente y `join` no reemplaza la configuración existente. Las pruebas de
  rutas de cuenta ahora preparan una membresía sintética para ejercitar perfil/avatar/password después
  del onboarding; la puerta real tiene su propio test con `createApp`. E2E sintética aislada en
  Chromium/Mobile Chrome pasa **10/10**: alta y bloqueo server-side, invitación válida/unión, invitación
  inválida y revocada recuperables, error HTTP 503/reintento, error de red, reanudación tras recargar y
  doble envío sin duplicar solicitudes o membresías. Comprueba que la membresía restaurada permite luego
  una ruta protegida. Comando: `pnpm run test:e2e -- --project=chromium --project=mobile-chrome --workers=1
tests/e2e/household-required-onboarding.spec.ts` (**10/10**, 13-10-2026). Usa servidor/app local,
  cuentas e invitaciones sintéticas y DB temporal; no llama a proveedor externo ni toca datos persistentes.
  La caducidad no está definida por el contrato y no se promete. Rollback de esta cobertura: retirar los
  tests añadidos de alta/unión/reanudación conservando el onboarding previo.
  El schema `households` y las rutas `GET /invite/:code`, `POST /join` y
  `POST /regenerate-invite` no definen `expires_at`: se puede revocar regenerando el código, pero no se
  promete caducidad temporal hasta acordar e implementar un contrato para ella.
- **Configuración de comidas — backend/UI integrada:** `GET/PATCH /api/household/meal-planning`, columnas
  de hogar/miembro, validación de permiso existente, resolución por miembro e inicialización del hogar
  están implementados. Los overrides empiezan apagados; la preferencia de horario personal procede de
  `users.preferences.mealPlan/mealTimes` al activar override, sin copiar alergias ni gustos al hogar.
  Un override personal activo sin objetivo u horario explícito válido ahora bloquea la propuesta con
  `409 MEAL_PLAN_OVERRIDE_INCOMPLETE` antes de encolar/llamar a IA; el error solo identifica el tipo
  de valor que falta, nunca al miembro. Los valores legacy válidos cuentan como explícitos. Al activar
  override de horario desde Ajustes se guarda el snapshot completo visible para que los defaults de
  lectura no se conviertan silenciosamente en preferencias personales.
  La nueva ruta de propuesta ya consume esta resolución; `plan-week` heredado no se declara migrado.
  La UI está integrada en Hogar > Planificación con errores recuperables, guardado parcial y overrides
  separados; E2E aislada sintética de ajustes pasa 2/2 en Chromium y Mobile Chrome. La regresión
  focal de la guarda pasa 69/69 con cobertura **94,35/83,97/98,09/96,46 %** (statements/branches/
  funciones/líneas); ruta/store y UI focals pasan, además de `tsc` del servidor y `typecheck:e2e`.
  La E2E integrada cubre perfiles de varios miembros; la limitación restante es que el smoke real no
  demuestra todas las combinaciones semánticas posibles ni sustituye la auditoría visual global.
- **Plan semanal — backend integrado:** se añadió `POST /api/household/meal-planning/proposal`
  con selección explícita de miembros, permisos `calendar.edit`, datos del perfil de quienes participan,
  despacho IA fijado al hogar capturado, `response_format` JSON Schema estricto y validación local de
  cobertura, turnos, alergias incluidas en texto/instrucciones, privacidad de notas/nombres/alergias y
  raciones. Antes de resolver/enviar perfiles, todos los participantes requieren `calendar.view`; una
  selección sin acceso se rechaza antes de llamar al proveedor. La ruta vuelve a comprobar el hogar
  activo después de leer el body y al regresar del proveedor, así que una petición retrasada no expone
  datos del hogar anterior. Las alergias no catalogadas producen turnos pendientes sin enviarlas al proveedor. La
  respuesta incluye alias opacos y eventos normalizados; la vista previa no escribe comidas ni calendario.
  `POST /api/household/meal-planning/confirm` revalida en servidor lo recibido y el estado actual de
  los miembros, ignora los `participantIds` enviados por el navegador y reconstruye las asignaciones
  desde alias opacos. Persiste en una sola transacción solo eventos seguros y aprobados; los pendientes
  por restricciones no soportadas se reconstruyen localmente, no se persisten y no revelan el detalle
  de la alergia. El retry idéntico es idempotente y cambios al mismo `proposalId` o colisiones de turno
  responden conflicto sin sobrescribir el calendario. La confirmación limita el body a 8 MiB,
  revalida el contexto tras parsearlo y el store verifica dentro de la transacción que siga activo el
  hogar capturado. El máximo del store (2.800 eventos) coincide con el schema estructurado. El
  `POST /api/ai/plan-week` heredado no se declara sustituido.
  Una regresión integrada cubre un participante con objetivo personal activo junto a otro que hereda
  el objetivo común: el prompt conserva ambos orígenes/valores y excluye el nombre y objetivo de un
  tercer miembro no seleccionado. Con `DATABASE_PATH=:memory:`, el test focal
  `pnpm exec vitest run src/routes/household-meal-proposals.routes.spec.ts -t "sends the personal override and inherited household goal for their respective members"`
  pasa **1/1**; `pnpm exec vitest run src/routes/household-meal-proposals.routes.spec.ts
src/utils/household-meal-proposal.planner.spec.ts --coverage
--coverage.include=src/routes/household-meal-proposals.routes.ts
--coverage.include=src/utils/household-meal-proposal.planner.ts` pasa **40/40**. Cobertura de ruta
  **90,62/73,18/100/93,69 %** y planner **91,73/81,6/100/93,39 %**
  (statements/branches/funciones/líneas); `pnpm exec tsc --noEmit`, `pnpm exec prettier --check
HOGARIA-HOUSEHOLD-PLAN-SPEC.md server/src/routes/household-meal-proposals.routes.spec.ts` y
  `git diff --check` pasan. DB aislada y proveedor sintético interceptado, sin llamadas reales.
  Matriz sintética de asignación: con overrides personales distintos se omite el objetivo común, el
  prompt conserva gustos/disgustos por alias y una respuesta individual se proyecta a raciones/persona;
  con override personal más herencia común, una respuesta compartida conserva un único evento y dos
  raciones. **Actualización 14-10-2026:** el contrato de compatibilidad blanda quedó explícito en esta
  sección y en el prompt del proveedor: gustos distintos no significan incompatibilidad por sí solos,
  dislikes no son restricciones de seguridad y solo se separa si no hay un compromiso seguro y
  razonablemente compatible con los objetivos. La prueba `sends the personal override and inherited
household goal for their respective members` usa gustos distintos y una respuesta compartida sintética;
  junto con `household-meal-proposal.planner.spec.ts` pasa **40/40**, coverage de ruta
  **90,62/73,18/100/93,69 %** y planner **91,73/81,6/100/93,39 %** (S/B/F/L), con
  `DATABASE_PATH=:memory:` y `pnpm --filter @hogaria/server exec tsc --noEmit -p tsconfig.json`.
  Esto verifica el contrato enviado y el normalizador, no el criterio semántico real del modelo.
  WebAPI `GET /health/ready` responde **200** y la sesión ChatGPT volvió a `ready`. La corrida real
  controlada está documentada en el checklist de smoke; el resultado acredita una propuesta sintética,
  no todos los conflictos semánticos posibles.
  La prueba `uses a selected member schedule override, inherits household schedule for another selected member, and excludes unselected members`
  comprueba la combinación de horarios personales/heredados y excluye perfil, IDs y datos de quien no
  fue seleccionado; el archivo de rutas pasa **31/31** con `DATABASE_PATH=:memory:`.
  Límite: la matriz sintética y el smoke real de una sola propuesta no acreditan la calidad semántica
  universal; `QA-HOME-MEALS.PLAN.1` queda validado para los escenarios cubiertos, no como garantía de
  toda combinación posible. Rollback del delta de compatibilidad blanda (14-10-2026): retirar el texto
  añadido a `buildPrompt` en `server/src/routes/household-meal-proposals.routes.ts`, sus aserciones y
  gustos sintéticos en `server/src/routes/household-meal-proposals.routes.spec.ts`, y esta actualización
  de decisión/evidencia; las pruebas anteriores de propuestas no dependen de ese texto.
- **Plan semanal — UI integrada:** `Hogar > Planificación` separa `Comidas`, `Tareas` y
  `Ajustes`; dentro de Comidas, `Preparar` y `Revisar propuesta` son etapas excluyentes. Solo un
  tabpanel queda visible; los shells ARIA existen y el planificador se monta al abrir Comidas, luego
  conserva una propuesta sin confirmar al cambiar de subtab para evitar otra llamada IA. Cambiar de
  hogar limpia el borrador. Revisar muestra un día seleccionado y el CTA es alcanzable en móvil. La
  E2E aislada sintética en árbol integrado pasa **2/2** en Chromium/Mobile Chrome, incluyendo generación,
  revisión, confirmación, navegación/teclado, `response_format`, preservación del borrador sin petición
  duplicada y limpieza al cambiar de hogar. `pnpm run test:client` pasa **1533/1533** con cobertura
  **93,46/84,2/94,05/95,68 %** (statements/branches/funciones/líneas). Cobertura del planificador:
  **90,48/81,08/92,55/96,2 %**; servicio de propuestas **100 %** en las cuatro métricas. Capturas sintéticas inspeccionadas:
  `.e2e-screenshots/household-meal-planning/chromium-proposal.png`,
  `chromium-recipe-details.png`, `mobile-chrome-proposal-top.png` y
  `mobile-chrome-recipe-details.png` (artefactos ignorados por Git). Las pruebas UI usan proveedor
  sintético; quedan
  pendientes el recorrido completo de combinaciones de preferencias y la auditoría visual global.
  Regresión multi-miembro añadida: ambos miembros reciben por API las mismas comidas domésticas
  (compartidas e individuales) con iguales participantes y la interfaz de calendario semanal muestra
  los mismos títulos; solo el asignado puede leer su consumo y el otro obtiene `403`. La E2E pasa **2/2**
  en Chromium/Mobile Chrome con DB temporal/proveedor sintético. Capturas sintéticas en
  `.e2e-screenshots/household-meal-planning/`; no cierra la matriz completa de preferencias/restricciones.
- **Compra de comidas — backend/UI integrada:** `GET /api/household/meal-planning/shopping-preview`
  entrega una previsión de solo lectura para un rango máximo de 31 días a miembros activos con
  `calendar.view`. Consolida snapshots de comidas futuras del hogar —incluidas las individuales— por
  producto normalizado y unidad exacta, escala por raciones planificadas y separa ingredientes
  opcionales. Incluye comidas de hoy todavía pendientes; excluye fechas pasadas y toda comida con
  registro de consumo (`realized` o `not_realized`). Solo consulta existencias explícitas del hogar
  cuando `shared_pantry` está activo; reserva stock primero para ingredientes obligatorios y los
  opcionales usan solo el remanente. No llama a IA ni modifica inventario o listas de compra. El test
  focal final de 6 specs pasa **41/41**, TypeScript y hooks pasan; coverage aislada del store:
  **100/96,29/100/100 %** (statements/branches/funciones/líneas). La suite completa de servidor de
  1501/1 omitida y coverage agregada **91,67/83,14/96,25/94,18 %** era anterior a las regresiones;
  ver revalidación integrada final más abajo. La UI ofrece revisión editable y aprobación
  explícita en un paso separado. El servidor vuelve a calcular y validar el preview dentro de una
  transacción antes de reconciliar solo filas pendientes `meal_plan`; una clave persistente evita recrear
  una línea comprada al repetir la misma aprobación. Las filas compradas, manuales y de otras fuentes
  quedan intactas; no se escribe en el inventario. El endpoint usa el hogar activo validado incluso si el
  puntero legado del usuario es nulo y conserva una sola membresía activa. Evidencia de esta unidad: el
  test de rutas reprodujo ambos fallos antes de corregirlos; después, `pnpm --filter @hogaria/server exec
vitest run src/routes/shopping-meal-plan-approval.routes.spec.ts
src/utils/household-meal-shopping-preview.store.spec.ts` pasa **14/14** con `DATABASE_PATH=:memory:`;
  TypeScript servidor, Karma focal de planificador/servicio **13/13**, `pnpm run check:ui` (238
  archivos/21 reglas), Prettier y `git diff --check` pasan. El E2E aislado sintético nuevo pasa **1/1 en
  Chromium y 1/1 en Mobile Chrome**: revisa/edita y cancela sin crear lista ni cambiar despensa; simula
  502 y verifica que no escribe; aprueba tras reintento, marca como comprada la fila generada, agrega
  una manual, repite la aprobación y comprueba idempotencia, conservación de ambas filas y despensa
  intacta. Capturas inspeccionadas: `.e2e-screenshots/household-meal-shopping-approval/chromium-approval.png`
  y `mobile-chrome-approval.png`. El runner usó DB temporal y fixtures sintéticos, sin llamar a IA.
  Auditoría responsive posterior (13-10-2026): Playwright detectó en móvil una pestaña de compra
  recortada y el contador del encabezado solapado; SCSS ahora distribuye las tres etapas y apila el
  encabezado. La geometría comprueba a 390×844 y 320×740 que, tras desplazar al CTA, este queda completo
  dentro del viewport y encima de la navegación fija. E2E aislada Chromium/Mobile Chrome: **2/2**;
  captura sintética regenerada e inspeccionada en `.e2e-screenshots/household-meal-shopping-approval/`.
  `pnpm run test:client` pasa **1526/1526**, cobertura **93,55/84,25/94/95,7 %**; `pnpm run build`
  pasa con bundle inicial **982,22 kB**. El diccionario grande de Hogar
  era eager en todas las rutas; separar siete claves compartidas y cargarlo desde el resolver de Hogar
  redujo el bundle inicial. App/spec/e2e typechecks, Prettier, `check:ui` (246 archivos/21 reglas) y
  `git diff --check` pasan; la suite integrada de frontend/servidor y E2E también. Nuevos casos focales
  cubren errores de generación/confirmación/preview, guardas de escritura y teclado del flujo de compra;
  el planificador mide **90,48/81,08/92,55/96,2 %** y el servicio de propuestas **100/100/100/100 %**
  (sentencias/ramas/funciones/líneas), por encima del gate en cada archivo.
  Regresión multi-miembro añadida: la vista previa suma el mismo ingrediente de una comida individual
  y otra compartida para dos miembros, mostrando una sola línea de **90 g**. La E2E pasa **2/2** en
  Chromium/Mobile Chrome; capturas de la vista previa PC/móvil inspeccionadas. Usa DB temporal y no
  escribe Compra/despensa ni llama a un proveedor.
- **Automatización semanal — backend/UI y recorrido scheduler→publicación integrados:** existe configuración
  única por hogar, apagada por defecto, con GET/PATCH, Zod estricto, versión/CAS, día/hora/zona IANA
  explícitos, próximo instante mediante el helper DST ya probado y pausa conservadora. El servidor vuelve
  a comprobar contexto/membresía y exige `settings` para modificar; `calendar.edit` también para activar.
  Lectura no crea ni repara registros. El ledger persistente de ejecuciones ya tiene store y esquema SQLite;
  esta unidad añade al GET la última ejecución mediante una proyección allowlist estricta (sin IDs internos,
  lease, owner ni fencing token) y normaliza los `updated_at` UTC heredados de SQLite. Las pruebas
  existentes cubren configuración apagada, estado `in_progress` con timestamp
  SQLite, resumen `review_required` y ausencia de metadatos internos. El endpoint
  `POST /api/household/planning-automation/retry` acepta solo `{expectedVersion, occurrenceKey}`; exige
  hogar activo, header coincidente y permisos actuales `settings` + `calendar.edit`, inicia una reclamación
  explícita y devuelve 202 sin esperar al worker. Tanto respuesta como errores son allowlist/sanitizados;
  no exponen identificadores internos, fencing, lease ni detalles del proveedor. El test de ruta inyecta
  un resultado sintético y verifica rechazo de body/contexto/permisos, mapeo HTTP de resultados y que no
  se espera la promesa; la suite del worker/ledger aporta sus pruebas separadas con DB en memoria y
  proveedor sintético. Sin llamadas al proveedor real. Evidencia: **55/55**; cobertura combinada
  **83,64/80/94,73/86,11 %** (statements/branches/funciones/líneas); TypeScript del servidor pasa.
  La verificación HTTP usa worker simulado; scheduler (**6/6**) y worker (14/14, incluida generación, repetición,
  rollback de ámbitos y conflictos de destino) están validados con DB en memoria. El smoke de arranque/parada
  del scheduler también pasó. La nueva prueba `polls through the real worker once, records completion, and publishes without duplicates`
  ejercita ocurrencia vencida → ledger → worker → proveedor sintético → publicación; sondea dos veces la
  misma ocurrencia y comprueba una llamada al proveedor, una ejecución completada y una semana publicada.
  Usa `DATABASE_PATH=:memory:`, `NODE_ENV=test`; no llama a IA real. Los modos/fallos se han auditado
  contra los tests focales listados en el criterio de aceptación inferior.
  Una segunda regresión guarda por el endpoint HTTP real una automatización activa, procesa el `nextRun`
  devuelto mediante el poller y worker, y comprueba ledger completado, proveedor sintético y una sola
  semana publicada aunque vuelva a sondear. La fecha no está hardcodeada: se deriva de la respuesta del
  API para respetar el reloj UTC de SQLite. Está incluida en `household-planning-automation.scheduler.spec.ts`;
  los tests del scheduler pasan **6/6** con DB en memoria. La ejecución completa del servidor (**1693 tests + 1 omitido**)
  corresponde a la validación anterior a esta instrumentación. En esta unidad, scheduler + controles runtime pasan
  **17/17** con cobertura actual **78,37/72,22/76,92/80,88 %** y **92,1/95,45/100/94,11 %** respectivamente
  (sentencias/ramas/funciones/líneas); ambas superan cada gate del 70 %. Rollback de aquella integración:
  retirar el test `runs an HTTP-saved schedule through the due poller, worker, and one publication`;
  no cambia código de producción ni datos persistentes.
  La E2E aislada de ajustes pasa **2/2 en Chromium/Mobile Chrome** y cubre guardar → reanudar → pausar →
  cambiar a repetir/comidas → guardar con la versión actual (regresión de un 409 por usar la versión vieja
  del editor). Comprueba que día/hora/zona y CTA son alcanzables sin solaparse con el aviso fijo tras
  desplazar la página; las capturas sintéticas PC/móvil quedaron guardadas. Comando:
  `pnpm run test:e2e -- tests/e2e/household-planning-automation.spec.ts --project=chromium --project=mobile-chrome --workers=1` (**2/2**).
  La E2E dedicada `publica una propuesta desde el editor pasando por el scheduler y worker reales` enlaza
  formulario → PATCH → timer/poller → worker → transporte OpenAI-compatible local → ledger completado y
  semana publicada. Verifica JSON Schema estricto y observa al menos dos ticks de scheduler posteriores
  a la publicación, sin segunda petición ni versión duplicada (**2/2 Chromium/Mobile Chrome**). El `finally` pausa la
  automatización y espera la terminación del worker antes de cerrar el proveedor local, para aislar
  también los reintentos de Playwright. Comando:
  `$env:HOGARIA_E2E_AUTOMATION_CLOCK_OFFSET_DAYS='4'; $env:HOGARIA_E2E_AUTOMATION_POLL_INTERVAL_MS='1000'; node scripts/run-isolated-playwright.mjs tests/e2e/household-planning-automation.spec.ts --grep 'publica una propuesta' --project=chromium --project=mobile-chrome --workers=1 --forbid-only`.
  Las dos variables solo configuran el servidor dev E2E con runner directory y SQLite temporales
  verificados (helper: **92,1/95,45/100/94,11 %** sentencias/ramas/funciones/líneas); sin esos guardrails
  no se activa ningún control de reloj. Producción/full-stack conserva reloj real y sondeo de 60 s. El workflow ejecuta esta E2E dedicada en
  shard 1. Retry ambiguo, generación/repetición, concurrencia/idempotencia, DST, permisos, conflictos,
  rollback, selección de ámbitos, asignación local y privacidad quedan cubiertos por pruebas focales
  schema/routes/store/scheduler/worker (**114/114** incluyendo controles runtime; DB `:memory:`). El helper
  runtime aislado se valida con coverage focal reproducible mediante
  `pnpm --filter @hogaria/server exec vitest run --coverage --coverage.include=src/utils/household-planning-automation.scheduler.runtime.ts --coverage.include=src/utils/household-planning-automation.scheduler.ts src/utils/household-planning-automation.scheduler.runtime.spec.ts src/utils/household-planning-automation.scheduler.spec.ts`.
  El hook pre-push detectó tres fixtures de compra de comidas que fijaban el rango a 2026-10-13/2026-11-12;
  ya usaban el rango vigente y el validador correctamente rechazaba la respuesta obsoleta. Ahora derivan el
  rango actual de 30 días desde `currentShoppingPreview()`: el spec del componente pasa **20/20** y la suite
  completa web `pnpm --filter @hogaria/web run test` pasa **1526/1526**, cobertura **93,55/84,25/94/95,7 %**.
  `typecheck:e2e`, build server, `test:config` (**13/13**), Prettier y `git diff --check` pasan; su regresión también verifica que anotaciones y artefactos CI usan los outputs del recorrido dedicado. Todas las pruebas son sintéticas y usan DB temporal;
  no se llamó a IA real. `QA-HOME-PLANNING.AUTOMATION.1` queda cerrado sintéticamente; la semántica del
  proveedor real de comidas sigue en `QA-HOME-MEALS.PLAN.1`.
- **Calendario compartido y registro de consumo — backend/UI integrado:** un evento del plan se guarda
  una vez y sus asignaciones identifican usuarios del hogar. `GET /api/calendar` y `/range` muestran
  todas las comidas confirmadas del plan a cualquier miembro activo con `calendar.view`, aunque la
  asignación sea individual; no comparten calendarios personales ni objetivos, notas o prompts privados.
  Si el lector aún no tiene calendario semanal propio, la ruta proyecta la última semana del plan sin
  materializar una fila ni copiar objetivos de otra persona. El evento compartido es de solo lectura para
  otros miembros; solo sus participantes asignados registran/corrigen el consumo con `calendar.view`. La
  UI pide realizada/no realizada y raciones reales, envía la versión esperada y permite recuperarse de
  conflictos sin duplicar movimientos. La coincidencia del producto es estricta por nombre normalizado y
  unidad; inventario privado, conversión y sugerencias aproximadas quedan excluidos. Test-first confirmó
  el fallo previo (lector activo no asignado recibía cero comidas); tras el fix, tests focales de
  calendario/almacén pasan **60/60** con cobertura **88,43/79,56/94,52/90,74 %**
  (statements/branches/funciones/líneas). Consumo: **30 tests** (schema/store/ruta), cobertura de ruta
  **88,67/80/100/91,83 %**, store **89,77/80,83/100/92,59 %**; frontend focal **92/92**. E2E sintética
  aislada de escritorio y móvil **2/2** incluye generación con proveedor local sintético, confirmación,
  calendario, teclado, guardado de raciones/no realizada y anchos 320×568/568×320; `check:ui`,
  `typecheck:e2e` y `tsc` pasan. Capturas: `.e2e-screenshots/household-meal-consumption/chromium-consumption.png`
  y `mobile-chrome-consumption.png`. Las pruebas de servidor usan `DATABASE_PATH=:memory:`; el E2E creó y
  limpió su DB temporal; no se llamó a proveedor real ni se tocó inventario persistente. El coverage
  frontend de este subconjunto no es el gate global (su umbral global falla al cargar solo 92 tests). La
  suite integrada de frontend/servidor y E2E pasa; junto con los tests de límites, persistencia,
  idempotencia, rollback y stock, cierra `QA-HOME-MEALS.CONSUMPTION.1`. Continúan pendientes los gates de
  compra, automatización y matriz integral de preferencias.
- **Recetas por ración — backend/UI integrado:** el contrato nuevo usa `baseServings: 1`; la generación
  normaliza cantidades para una ración, el cliente escala cantidades localmente y conserva tiempos y
  receta base, con aviso de cocción por tandas. Los cambios del worktree ya están en esta rama; su
  regresión completa en el árbol integrado se actualizará con el gate final. No se llama a IA para
  volver a escalar una receta guardada.
- **Validación reproducible ejecutada en Windows:**

  ```powershell
  $env:DATABASE_PATH=':memory:'
  pnpm --filter @hogaria/server exec vitest run src/schemas/household-meal-consumption.schema.spec.ts src/utils/household-meal-consumption.store.spec.ts src/routes/household-meal-consumption.routes.spec.ts
  pnpm --filter @hogaria/server exec vitest run --coverage --coverage.include=src/routes/household-meal-consumption.routes.ts --coverage.include=src/utils/household-meal-consumption.store.ts src/utils/household-meal-consumption.store.spec.ts src/routes/household-meal-consumption.routes.spec.ts
  pnpm --filter @hogaria/server exec vitest run --coverage --coverage.include=src/schemas/household-meal-consumption.schema.ts src/schemas/household-meal-consumption.schema.spec.ts
  pnpm --filter @hogaria/server exec tsc --noEmit -p tsconfig.json
  ```

  Para consumo, la prueba focal aprueba **3 archivos / 30 tests** (schema, store y ruta); la ruta/store
  suman **22 tests**, con cobertura por fichero de **88,67/80/100/91,83 %** y
  **89,77/80,83/100/92,59 %** (statements/branches/funciones/líneas). El esquema suma **8 tests** y
  **100/100/100/100 %**. El contrato cubre valores positivos, cero solo para «no realizada», límites,
  versión y propiedades no permitidas. Se ejercitaron retries, correcciones, receta alterada/corrupta,
  rollback, contexto y permisos, cambio de unidad tras deducción parcial o restauración de línea huérfana,
  desactivación de despensa compartida, stock insuficiente, producto ambiguo y recetas ausentes/corruptas.
  `tsc --noEmit -p tsconfig.json` pasa. En el worktree integrado, `pnpm run check:ui`,
  `pnpm run typecheck:e2e`, 92 pruebas focales de frontend y E2E de consumo 2/2 también pasan.
  Los tests de servidor usan `DATABASE_PATH=:memory:` y datos sintéticos; no modifican inventario
  persistente. El E2E levanta app/SQLite temporales y apunta a un proveedor sintético local; tras el
  test el runner confirma limpieza de DB/artefactos temporales. No hubo llamadas a proveedor real.
  Comandos de esta unidad (el `test:coverage` filtrado informa el coverage focal; el gate global exige
  la suite completa y sigue pendiente):

  ```powershell
  pnpm --filter @hogaria/web exec ng test --no-watch --browsers=ChromeHeadless --include=src/app/core/services/household-meal-consumption.service.spec.ts --include=src/app/features/calendar/calendar-meal-consumption.component.spec.ts --include=src/app/features/calendar/calendar-timeline-consumption-permissions.spec.ts --include=src/app/features/calendar/calendar.component.spec.ts --include=src/app/features/calendar/calendar-event.component.spec.ts --include=src/app/core/services/calendar.service.spec.ts --include=src/app/shared/models/calendar.model.spec.ts
  pnpm run test:e2e -- --project=chromium --project=mobile-chrome --workers=1 --grep="registra raciones reales"
  ```

  ```powershell
  $env:DATABASE_PATH=':memory:'
  pnpm --filter @hogaria/server exec vitest run src/routes/household-meal-proposals.routes.spec.ts src/utils/household-meal-proposal.planner.spec.ts src/utils/ai-queue.spec.ts src/schemas/household-meal-proposal-request.schema.spec.ts src/schemas/form-contract.spec.ts
  pnpm --filter @hogaria/server exec tsc --noEmit -p tsconfig.json
  pnpm --filter @hogaria/server run test:coverage
  ```

  Resultado previo a los últimos fixes: **5 archivos / 452 tests aprobados** en la focal. Revalidación
  integrada actual: suite de servidor **93 archivos aprobados / 1 omitido; 1693 tests aprobados / 1
  omitido**, con cobertura **90,54/82,54/96,1/93,41 %** (statements/branches/funciones/líneas); el
  contrato de formulario incluye ahora el esquema de consumo. TypeScript del servidor pasa.
  Cobertura de la ruta propuesta+confirmación: **90.47 % statements, 70.83 % branches, 98.07 % funciones
  y 92.3 % líneas**; planner: 91.73 %, 81.6 %, 100 % y 93.39 %. La suite usa `DATABASE_PATH=:memory:`
  y proveedor sintético; no se llamó a IA real. **Runtime:** rutas verificadas con harness Hono/SQLite
  en memoria y flujo integrado aislado app+servidor para generación/revisión/confirmación en PC y
  móvil; no se usó inventario persistente.

  Validación integrada final (14-10-2026): `pnpm run test:client` pasa **1526/1526**, cobertura
  **93,55/84,25/94/95,7 %** (statements/branches/funciones/líneas). Nueve E2E sintéticas pasan
  **32/32** en Chromium/Mobile Chrome: onboarding obligatorio, ajustes/plan de comidas, calendario,
  consumo, compra, tareas, automatización, menú del plano y recorrido multi-miembro. El recorrido
  integrado aislado pasa además **3/3** en Chromium, Mobile Chrome y Mobile Safari. Crea dos cuentas,
  usa app/API locales y proveedor OpenAI-compatible sintético, comprueba overrides/permiso, `response_format`,
  propuesta compartida e individual, visibilidad del calendario, consumo asignado, preview/aprobación de
  Compra/idempotencia y configuración automática futura. Esa automatización queda deliberadamente a más
  de 48 horas: esta E2E no prueba su ejecución; scheduler/worker/publicación se valida aparte con una
  prueba integrada de proveedor sintético. `pnpm run check:ui` (246 ficheros/21 reglas),
  `pnpm run typecheck:e2e`, TypeScript de servidor, `pnpm run test:config` (12/12), `pnpm run build` y
  `git diff --check` pasan. Build: bundle inicial **982,22 kB** y avisos Angular de presupuesto
  (incluido `household-plan-editor.scss`, +274 B); no se bajó ningún umbral. Las E2E usan SQLite
  temporal y datos sintéticos; no hubo llamadas IA reales ni escrituras en la base persistente. Capturas
  PC/móvil sintéticas inspeccionadas bajo `.e2e-screenshots/`. La matriz completa de preferencias/estados
  y la aceptación global siguen abiertas.

  **Rollback de la unidad de confirmación:** retirar endpoint, esquema de confirmación, tests/cobertura
  y esta evidencia; conserva preview, schema Structured Outputs y almacén/calendario compartido.

- **Tareas semanales — UX/E2E integrada:** la vista mantiene el plano/mapa al tamaño completo y, si ya
  hay tareas, ofrece en móvil «Añadir tarea» para abrir explícitamente el formulario; una vez abierto
  no se colapsa al añadir. El título de semana queda accesible para lectores de pantalla. El panel de
  opciones en landscape se ancla bajo su control y no tapa la descripción; el mapa de asignación conserva
  286 px / ≥84 % de ancho, y la checklist expone tres filas completas antes de sus acciones sticky.
  El E2E de `household-plan-tasks.spec.ts` pasa **2/2** en Chromium y Mobile Chrome; incluye targets de
  radio/checkbox/tacto, labels ≥12 px, teclado, 320×568 y 568×320, además de propuesta equilibrada sin
  días consecutivos. Verifica que asignaciones manuales persistidas no cambian al proponer ni al pulsar
  «Usar este reparto»; solo Guardar persiste el reparto aplicado. Evidencia sintética inspeccionada:
  `.e2e-screenshots/household-plan-tasks/chromium/05-weekly-tasks.png` y
  `.e2e-screenshots/household-plan-tasks/mobile-chrome/tasks-week-three-rows.png`.
  Comando: `pnpm run test:e2e -- --project=chromium --project=mobile-chrome --workers=1 --grep="plano por hogar, propuesta revisable"`
  (13-10-2026, **2 passed / 53.3 s**); typecheck E2E, Prettier y `git diff --check` también pasan.
  Se usó DB/artifacts temporales limpiados por el harness; no se llamó a IA real ni se escribieron datos
  de hogar persistentes. La auditoría visual de familias/rutas globales queda fuera de esta unidad.
  Revisión de menú landscape (13-10-2026): el E2E a 568×320 detectó el botón inferior 8 px fuera de la
  ventana de scroll por la especificidad de `.plan-editor__advanced-settings[open] > ...`, que prevalecía
  sobre el padding de la media query. La regla ahora fija el padding vertical de verdad; la prueba hace
  tabulación hasta «Descartar cambios», confirma scroll interno y verifica que la acción queda completa
  dentro del menú y no la cubre la navegación inferior. También pasa **1/1** en Mobile Safari. Capturas
  sintéticas PC/móvil inspeccionadas:
  `.e2e-screenshots/household-plan-tasks/chromium/08-options-menu-draw-selected-desktop.png`,
  `.e2e-screenshots/household-plan-tasks/mobile-chrome/08-options-menu-568x320.png` y
  `.e2e-screenshots/household-plan-tasks/mobile-chrome/08-options-menu-568x320-final-action.png` y
  `.e2e-screenshots/household-plan-tasks/mobile-safari/08-options-menu-568x320.png`.

- **Proyección de tareas semanales en el calendario existente — backend/UI integrada, aceptación
  cerrada:** `GET /api/calendar/range` agrega tareas de semanas solapadas con el rango y filtra por
  fecha antes de responder; no se crea un calendario paralelo ni se modifica el checklist. Solo las
  personas activas con `calendar.view` pueden leerlas. La respuesta incluye título, fecha, estado, zona
  resuelta desde el plano y asignatario activo; el modelo semanal no guarda hora, así que `time` es
  `null` y no se inventa. Un asignatario inactivo se devuelve como no asignado. El JSON de calendario
  no incluye el campo `details` de las tareas. La lectura usa un número constante de consultas
  (autorización, semanas, plano y miembros activos), no una consulta por tarea;
  errores de JSON/esquema, semana vacía, fecha fuera de rango y hogar ajeno fallan cerrados. En la UI,
  una capa independiente «Tareas del hogar» puede ocultarlas; las tarjetas aparecen en agenda, mes,
  año y banda del timeline. Son de solo lectura y no interceptan los controles de crear comida/evento.
  Los eventos/comidas personales y los permisos de escritura permanecen sin cambios.

  TDD: el test de ruta `proyecta tareas semanales` fallaba antes del endpoint (`data.tasks` ausente).
  Tras el cambio, en Windows y con `DATABASE_PATH=:memory:`: `calendar.routes.spec.ts` +
  `shared-meal-calendar.store.spec.ts`, **62/62**; cobertura de los archivos tocados **89,14/80,45/
  95,29/91,23 %** (statements/branches/funciones/líneas), superior al 70 % requerido. El almacén de
  proyección aislado queda en **97,14/92,3/100/100 %**. La UI focal (`calendar.service.spec.ts`,
  `calendar.component.spec.ts`, `calendar-view-components.spec.ts`, `calendar-timeline.component.spec.ts`
  y `calendar-timeline-consumption-permissions.spec.ts`) pasa **94/94**; `pnpm run typecheck:e2e`,
  `pnpm --filter @hogaria/server exec tsc --noEmit -p tsconfig.json` y `pnpm run check:ui`
  (246 archivos/21 reglas) pasan. E2E sintética aislada de Chromium, Mobile Chrome y Mobile Safari:
  **6/6** en `household-task-calendar.spec.ts`; valida respuesta API, zona, persona, estado, capa y lectura
  en los tres proyectos; comprueba agenda, día, 4 días, semana/timeline, mes y año, seis anchuras de
  320–1440 px (incluido 568×320 horizontal), ausencia de overflow, navegación Tab/Space/Enter y `aria-pressed`, y
  que detalles de tarea no se filtran al JSON. DB y artefactos temporales se limpian; no hay llamadas a proveedor ni escrituras al
  inventario real. La captura móvil se toma con la tarea encuadrada y ambas imágenes se inspeccionaron.
  Capturas:
  `.e2e-screenshots/household-task-calendar/chromium/household-task-in-agenda.png` y
  `.e2e-screenshots/household-task-calendar/mobile-chrome/household-task-in-agenda.png`.
  El resto de comandos reproducibles (con resultados arriba; E2E **6/6**, 13-10-2026):

  ```powershell
  $env:DATABASE_PATH=':memory:'
  pnpm --filter @hogaria/server exec vitest run --coverage --coverage.include=src/routes/calendar.routes.ts --coverage.include=src/utils/household-task-calendar.store.ts --coverage.include=src/utils/shared-meal-calendar.store.ts src/routes/calendar.routes.spec.ts src/utils/shared-meal-calendar.store.spec.ts
  pnpm --filter @hogaria/server exec tsc --noEmit -p tsconfig.json
  pnpm --filter @hogaria/web run ng test --no-watch --browsers=ChromeHeadless --include=src/app/core/services/calendar.service.spec.ts --include=src/app/features/calendar/calendar.component.spec.ts --include=src/app/features/calendar/calendar-view-components.spec.ts --include=src/app/features/calendar/calendar-timeline.component.spec.ts --include=src/app/features/calendar/calendar-timeline-consumption-permissions.spec.ts
  pnpm run typecheck:e2e
  pnpm run check:ui
  node scripts/run-isolated-playwright.mjs --project=chromium --project=mobile-chrome --project=mobile-safari --workers=1 tests/e2e/household-task-calendar.spec.ts
  git diff --check
  ```

  Esta unidad cierra su matriz de vistas, seis breakpoints y teclado; la auditoría visual global de otras
  familias de interfaz sigue fuera de esta aceptación. El E2E usa fixtures sintéticos/DB temporal y no
  llama a IA real.
  **Rollback:** retirar esta proyección del endpoint/rango, su mapeo y capa/componentes del calendario,
  pruebas y evidencia; conserva intactos calendario personal, gestión semanal de tareas y persistencia.
  Prettier: TypeScript afectado y `HOGARIA-SPEC.md` pasan; el check de este documento completo ya
  fallaba en la base `cf7283c`, por formato histórico fuera de esta unidad, y no se reformateó en bloque.

El análisis previo del planificador orienta el trabajo, pero no cierra por sí mismo los criterios
compuestos. Las subunidades marcadas `[x]` tienen evidencia focal explícita; el cierre global exige validar
también las condiciones que aún están abiertas.

### Criterios de aceptación y estado de cierre

- [x] **QA-HOME-MEALS.SETTINGS.1** — API, persistencia, permisos y resolución por campo; defaults de
      overrides apagados; hogar nuevo inicializado idempotentemente desde valores existentes; unirse
      no modifica valores comunes; un override activo sin valor explícito válido bloquea antes de IA;
      ningún dato ajeno/no seleccionado llega al planificador. Evidencia: tests del store (`seeds new household defaults once`, `does not seed over existing`, `marks enabled overrides incomplete`, `persists partial home defaults`), rutas/settings/propuesta (override incompleto bloquea antes de IA y miembros no seleccionados quedan fuera), settings E2E 2/2 y recorrido integrado 3/3 Chromium/Mobile Chrome/Mobile Safari con dos miembros. Suite global pasa; cobertura focal >70 % en sentencias/ramas/funciones/líneas. Sin proveedor real.
- [x] **QA-HOME-MEALS.PLAN.1** — subtabs `Comidas`, `Tareas` y `Ajustes`; solo el panel seleccionado
      es visible, con navegación accesible por teclado y contexto/URL conservados en escritorio y
      móvil; cada `aria-controls` apunta a un tabpanel existente. Componentes inactivos se montan bajo
      demanda, pero una propuesta aún no confirmada conserva selección, paso y día al cambiar de subtab;
      volver no genera otra petición IA. Dentro de Comidas, `Preparar` y `Revisar propuesta` son pasos excluyentes; E2E comprueba que
      no se apilan formulario+semana+confirmación y que móvil ofrece un día/grupo manejable con el CTA
      alcanzable sin recorrer toda la semana. Revisión de existencias/compra es un
      paso secuencial que conecta con el módulo Compra existente, no una sección larga con todo mezclado.
      Plan semanal con proveedor simulado, vista previa explícita y
      `response_format` estricto compatible con el subconjunto de JSON Schema que admite WebAPI;
      fechas con forma ISO y validez real de calendario comprobadas localmente; plato compartido una vez,
      raciones por participantes, conflictos
      soft/hard, alergia estricta, todos con overrides, turnos personales, sin receta segura,
      respuesta inválida/IDs foráneos/duplicados/error sin escrituras; cantidades de receta por ración
      y cambio local de raciones sin llamada IA ni mutación de la receta base.
      Contrato soft cerrado en § «Resolución de diferencias entre miembros»: gustos distintos no son
      incompatibilidad automática; se prioriza un compromiso compartido seguro y compatible con objetivos,
      y un dislike no se trata como alergia. El prompt ordenado y una regresión sintética comprueban esa
      instrucción con dos perfiles de gustos distintos y un evento compartido. **Smoke opt-in dedicado:** `pnpm run smoke:ai:household-meal` ejecuta solo
      `playwright.ai-household-meal-real-smoke.config.ts` y
      `tests/e2e/household-meal-planning-live-smoke.spec.ts`, con dos perfiles sintéticos, SQLite temporal,
      límite de una completion y sin tickets ni confirmación del calendario. El proxy local comprueba antes
      de reenviar el `response_format` estricto (`events.minItems >= 1`), exactamente los dos adjuntos JSON
      versionados (`meal-planning-context.json` y `household-recipes-catalog.json`), su contenido sintético
      (perfiles, horarios/turnos, despensa, utensilios, catálogo y plan anterior), aliases y ausencia de
      identidad. Solo conserva telemetría allowlist; nunca prompt, adjuntos ni respuesta. La E2E comprueba
      los siete turnos, participantes/duplicados y que el calendario siga vacío; no confirma ni persiste la
      propuesta. El primer intento de adjuntos fue rechazado localmente, sin contactar al proveedor: el
      contrato de prueba esperaba un nombre distinto para la receta sintética del plan anterior. Se
      corrigieron el fixture y la aserción antes de la siguiente ejecución.

**Evidencia final (14-10-2026):** sesión WebAPI `ready`; una única propuesta a `gpt-5`, HTTP 200,
JSON válido, contrato estricto validado y una completion; `pnpm run smoke:ai:household-meal` salió
correctamente. La DB/app aisladas y el token temporal propio se limpiaron. No se reenviaron tickets,
no se confirmó el plan y el calendario/inventario reales no cambiaron. Esto valida una propuesta
sintética concreta, no la calidad semántica de todas las combinaciones del hogar. La E2E de
interfaz con proveedor sintético pasa **2/2** en Chromium/Mobile Chrome. La suite servidor
`pnpm --filter @hogaria/server run test:coverage` pasa **1728 tests / 1 omitido**, cobertura global
**90,31/82,57/96,18/93,3 %**; el alcance de propuesta/catálogo supera 70 % en los cuatro gates.
`pnpm run test:client` pasa **1533/1533** (cobertura **93,46/84,2/94,05/95,68 %**),
`pnpm run test:config` **73/73**, E2E UI **2/2**, build, `typecheck:e2e`, TypeScript servidor y
`check:ui` pasan. Capturas PC/móvil sintéticas quedan en `.e2e-screenshots/household-meal-planning/`
(ignoradas por Git). `pnpm run lint` sigue sin operar en este checkout porque falta
`@angular-eslint/builder` y la configuración ESLint 9 del servidor está incompleta; build emite
avisos existentes de presupuesto de bundle/estilos.

- **Hallazgo posterior resuelto (14-10-2026):** el registro antiguo de WebAPI mostró una completion con
  `{"events":[]}` y sin evidencia de participantes/contexto adjunto. Ahora el esquema y la validación
  local rechazan eventos vacíos, y la prueba decodifica los dos adjuntos desde la petición real del
  proveedor simulado. El smoke aislado con el proveedor real verificó ambos JSON versionados y devolvió
  una propuesta válida sin persistirla; evidencia y límites en `QA-HOME-MEALS.PLAN.1`/`CONTEXT.1`.

- [x] **QA-HOME-MEALS.OUTPUT.1** — `events` tiene al menos un elemento tanto en el JSON Schema estricto
      del proveedor como en la validación local. Un resultado vacío se rechaza antes de cualquier escritura;
      cada turno esperado debe quedar cubierto exactamente una vez o explícitamente `unresolved`. Si todos
      los turnos carecen de participantes aptos para IA, el servidor genera localmente sus eventos
      `unresolved` sin llamar al proveedor ni pasar por un array vacío; las restricciones no se relajan para
      admitir `events: []`. Evidencia: schema de proveedor/Zod, cobertura incompleta, caso sin participantes
      aptos y rutas sin escrituras al fallar. `pnpm --filter @hogaria/server run test:coverage` pasa
      **1728 tests / 1 omitido**, todos los gates globales; el smoke opt-in real validó una completion
      HTTP 200, objeto JSON y E2E completa aislada sin escritura en calendario.
- [x] **QA-HOME-MEALS.CONTEXT.1** — cada generación envía, junto al mensaje de texto y `response_format`
      estricto, exactamente dos adjuntos JSON versionados: `meal-planning-context.json` contiene datos
      acotados al hogar, semana y miembros seleccionados (alias opacos, preferencias, restricciones estrictas,
      objetivo y horario efectivos con su fuente, turnos, existencias positivas visibles, utensilios accesibles
      y planificación confirmada anterior o `null`); `household-recipes-catalog.json` contiene el catálogo
      completo de recetas que el solicitante puede consultar según los permisos actuales. El catálogo conserva
      el título y el contenido culinario de cada receta, pero usa alias opacos de petición como referencia;
      nunca incluye IDs internos, nombres/datos de personas ni datos de autor. No se duplican recetas en el
      contexto principal. Ningún adjunto incluye personas no seleccionadas, emails ni notas/términos privados
      usados únicamente para filtrar. Cadenas libres y ambos adjuntos se tratan como datos no confiables.
      Si el catálogo supera el máximo seguro de bytes, se devuelve un error recuperable antes de llamar a IA;
      nunca se trunca silenciosamente. Pruebas decodifican ambos `file_data` y verifican nombres, MIME,
      estructura, permisos, exclusiones, cotas y coexistencia con `response_format`; no vuelcan contenido a
      logs. El proxy opt-in inspecciona los dos adjuntos sintéticos en memoria y solo conserva telemetría no
      sensible. Evidencia (14-10-2026): tests de ruta decodifican ambos `file_data` y comprueban nombres,
      MIME, versionado, permisos, exclusiones de identidad/notas, límite de bytes antes de IA y coexistencia
      con `response_format` estricto; tests del catálogo ejercitan acceso vigente y recetas incompletas no
      elegibles. `pnpm run test:config` (**73/73**) comprueba el contrato del proxy opt-in para ambos
      adjuntos sintéticos sin retener su contenido. Verificación aislada completa:
      `DATABASE_PATH=:memory: pnpm --filter @hogaria/server run test:coverage` (**1728 tests / 1 omitido**;
      suite server 90,31/82,57/96,18/93,3 % global; todos los archivos incluidos del alcance superan 70 %
      por sentencias/ramas/funciones/líneas); `pnpm run test:client` (**1533/1533**, cobertura global
      93,46/84,2/94,05/95,68 %); E2E de navegador, app y DB aisladas con proveedor local sintético
      `pnpm run test:e2e -- --project=chromium --project=mobile-chrome
tests/e2e/household-meal-planning.spec.ts` (**2/2**); `pnpm run build`,
      `pnpm run typecheck:e2e`, `pnpm --filter @hogaria/server exec tsc --noEmit -p tsconfig.json` y
      `pnpm run check:ui` pasan. Capturas sintéticas de PC/móvil, generadas e inspeccionadas:
      `.e2e-screenshots/household-meal-planning/chromium-proposal.png`,
      `.e2e-screenshots/household-meal-planning/chromium-recipe-details.png`,
      `.e2e-screenshots/household-meal-planning/mobile-chrome-proposal.png` y
      `.e2e-screenshots/household-meal-planning/mobile-chrome-recipe-details.png` (artefactos ignorados por
      Git). El smoke real final de una llamada verificó el contrato de dos adjuntos descrito arriba; la
      propuesta no se confirmó ni se guardó en el calendario.
      Limitaciones del entorno: `pnpm run lint` no está operativo en este checkout (falta
      `@angular-eslint/builder`; el lint del servidor usa `--ext`, incompatible con ESLint 9, y no dispone
      de `eslint.config.js`). `pnpm run build` termina correctamente, aunque emite avisos de presupuesto
      de bundle/estilos, incluido el del componente del planificador.
- [x] **QA-HOME-MEALS.RECIPE.1** — cada turno planificado referencia una receta existente del catálogo
      mediante alias opaco resoluble por el servidor o declara una receta nueva completa. Se prefiere
      reutilizar una receta accesible si encaja con los objetivos y es segura; no se inventan aliases ni se
      muta una receta existente para acomodarla. Una receta nueva cumple el contrato canónico de receta IA
      de HogarIA: rendimiento base de una ración y cantidades por ración, metadatos, tiempos, ingredientes,
      utensilios, guidance, etiquetas, nutrición/conservación cuando proceda y pasos completos diferenciados
      para `basic`, `intermediate` y `expert` (con campos de paso compatibles con el editor). El proveedor
      recibe un `response_format` estricto; el servidor resuelve aliases contra el catálogo autorizado y
      valida en servidor el objeto completo, la unicidad de referencias y alergias/intolerancias en todos los
      campos de todos los niveles. Una receta no segura o no verificable deja el turno `unresolved` sin
      revelar la restricción privada. Previsualizar no escribe recetas ni calendario. Al confirmar, cada receta
      nueva se guarda una sola vez como privada del solicitante, se enlaza desde sus comidas y queda visible
      desde el evento/calendario; una receta existente conserva su `recipe_id`. La creación de recetas y los
      eventos se confirman de forma atómica e idempotente; retry, receta repetida en varios turnos, alias
      inexistente/foráneo, cambios concurrentes, schema parcial, alergia oculta en instrucciones avanzadas y
      rollback por fallo de persistencia están cubiertos. La receta abierta desde la planificación permite
      consultar ingredientes y los tres niveles sin una nueva llamada a IA. Evidencia (14-10-2026): el
      schema estricto limita la propuesta a turnos no vacíos, referencias opacas y recetas nuevas completas;
      schema local y planner revalidan estructura, referencias, duplicados, permisos y restricciones en todos
      los niveles. Tests de ruta/store cubren preview sin escrituras, alta privada solo al confirmar, enlace
      con comidas, retry/idempotencia, receta existente con ID estable, alias inválido/foráneo, revalidación
      actual y rollback transaccional; worker automatizado guarda snapshots de receta junto a eventos. La E2E
      sintética confirma la propuesta y comprueba cantidades escaladas localmente, utensilios, tiempos,
      temporizadores, conservación y tabs accesibles `basic/intermediate/expert`; test de UI oculta guidance
      vacía. La evidencia cuantitativa y limitaciones de ejecución están en `QA-HOME-MEALS.CONTEXT.1` arriba.
      El smoke real descrito arriba validó una propuesta con los dos adjuntos; no la confirmó, así que
      no guardó recetas ni cambió calendario/inventario reales. La creación privada se verifica con
      proveedor sintético al confirmar una receta nueva; el smoke real no garantiza que esa única salida
      haya seleccionado una receta nueva.

- [x] **QA-HOME-MEALS.RECIPE-CONTRACT.1** — hay un único contrato JSON de receta generado por IA,
      `server/src/schemas/recipe-ai-output.schema.ts`, compartido por generación de recetas y por
      `newRecipes[].recipe` en la planificación semanal. `response_format` estricto, validación local y
      persistencia reutilizan ese esquema; una prueba compara tanto la identidad del esquema Zod como el
      subesquema JSON Schema exacto en ambas peticiones. El formato canónico usa `baseServings: 1`,
      `storage.reheatingInstructions` y todos los campos de temperatura/temporizador por paso. `selectedDetailLevel`
      es metadato de respuesta de la API de recetas, no parte del JSON que genera la IA. La futura
      refactorización de la vista de recetas debe actualizar este contrato/tipo compartido y no crear un
      esquema paralelo. Evidencia (14-10-2026): `recipe-ai-contract.spec.ts` verifica identidad Zod y
      igualdad exacta de ambos subesquemas JSON Schema; ruta/generador, validador, calendario y persistencia
      usan el mismo objeto canónico. `household-meal-recipe-snapshot.spec.ts` comprueba además que nutrientes
      históricos (`sugar`, `sodium`) se proyectan al contrato compartido sin campos extra. `test:config`
      **73/73**, `test:client` **1533/1533** y el server aislado con `DATABASE_PATH=:memory:` y
      `pnpm --filter @hogaria/server run test:coverage` (**1731 pasados / 1 omitido**; cobertura global
      **90,32/82,60/96,17/93,30 %**); typecheck server/E2E, build y `check:ui` pasan. Playwright
      sintético aislado: confirmación del plan **2/2** (Chromium/Mobile Chrome) y generación/guardado de
      recetas **12/12** focalizados en ambas plataformas. No se repitió ninguna llamada real al proveedor;
      el contrato completo y la compatibilidad entre flujos quedan verificados con schemas y proveedor
      sintético.

- [x] **QA-HOME-MEALS.CALENDAR.1** — persistencia idempotente tras confirmar, calendario actual,
      evento compartido visible una vez a todos los miembros activos con `calendar.view` aunque la comida
      sea individual, asignaciones correctas, consumo limitado a participantes y ninguna nota/objetivo
      privado filtrado. Evidencia: E2E integrado 3/3 PC/móvil Chrome/Safari valida evento individual visible una vez para ambos miembros y consumo limitado al participante; pruebas de ruta de calendario/verificación de privacidad y llamadas idempotentes; suite server/cliente global y cobertura focal >70 %.
- [x] **QA-HOME-MEALS.CONSUMPTION.1** — realizada/no realizada, raciones cero/positivas/fuera de
      rango, ajustes, inventario sin cambios antes de confirmar e idempotencia; la receta base y los
      movimientos de stock no se duplican. Evidencia: schema/store/ruta (30 tests) cubren límites, corrección, versiones, rollback, permisos, stock e idempotencia; E2E aislada sintética PC/móvil 2/2 para raciones/no realizada; cobertura focal >70 % en los cuatro tipos; suite global pasa. No se modifica Compra/inventario antes de confirmar.
- [x] **QA-HOME-MEALS.SHOPPING.1** — preview visible a miembros activos con `calendar.view`, de solo
      lectura y a partir de todas las comidas futuras confirmadas del hogar, incluidas las asignadas
      individualmente; snapshots inmutables y raciones planificadas; consolidación por nombre normalizado + unidad exacta,
      cálculo de faltantes usando únicamente despensa compartida del hogar, avisos ante ausencias,
      ambigüedad o unidad distinta y exclusión inicial de ingredientes opcionales; UI con revisión editable
      en paso separado, cancelar/rechazar sin escritura y aprobación que crea/actualiza Compra conservando
      filas compradas/manuales. Errores no mutan Compra ni inventario.
      Evidencia: preview backend y aprobación persistente con DB en memoria; E2E sintética PC/Mobile Chrome
      prueba edición, cancelar/error sin escritura, reintento/aprobación, idempotencia, conservación de filas
      manuales/compradas y despensa intacta; el recorrido multi-miembro consolida **90 g** entre una comida
      individual y otra compartida. Geometría móvil comprobada a 390×844 y 320×740, CTA visible tras scroll.
      Suite cliente **1533/1533**; cobertura focal planificador **90,48/81,08/92,55/96,2 %** y servicio
      **100/100/100/100 %** (sentencias/ramas/funciones/líneas). No escribe inventario antes de aprobación,
      no llama IA real y usa DB temporal. Rollback: retirar preview/aprobación `meal_plan`, su UI/tests y
      esta evidencia; conservar los eventos de calendario.
- [x] **QA-HOME-PLANNING.AUTOMATION.1** — configuración explícita por hogar de día semanal, hora local
      y zona IANA antes de activar; caso de hora inexistente → primera hora válida posterior y hora duplicada
      → primera ocurrencia única. Generar/repetir, publicación automática validada de propuestas completas,
      play/pause, siguiente fecha, omisión de ejecuciones vencidas al reanudar, conflictos sin sobrescritura,
      retry explícito de timeout ambiguo e idempotencia; repetir no llama a IA ni duplica eventos y protege
      ediciones manuales; generación de tareas basada en plano + última semana confirmada, asignación local
      equitativa sin nombres personales enviados al proveedor, selección de tareas/comidas, publicación
      atómica de todos los ámbitos seleccionados y aprobación explícita para Compra. La E2E de ajustes
      guarda/reanuda/pausa en UI; otra E2E de navegador sigue el ajuste guardado hasta el scheduler/timer,
      worker y publicación de una semana con proveedor OpenAI-compatible sintético. Repite el sondeo y
      confirma que no duplica llamada ni publicación. Retry, repetición, DST, conflictos, integridad/
      privacidad y rollback están cubiertos en pruebas independientes route/scheduler/worker con DB en
      memoria. Compra conserva aprobación explícita mediante `QA-HOME-MEALS.SHOPPING.1`; la automatización
      no modifica inventario ni listas de Compra. Comando y evidencia en «Estado de implementación y evidencia».
      La cobertura actual de la UI es **87,08/75,25/97,61/94,56 %** (sentencias/ramas/funciones/líneas);
      no se llama a IA real.
- [x] El GET de automatización incluye `lastRun` como proyección estricta allowlist: ocurrencia, semana
      objetivo, estado, código de fallo y fecha de actualización; nunca filtra ID de ejecución/hogar,
      lease, worker o fence. Normaliza a ISO-8601 UTC los timestamps SQLite del estado en progreso.
      Evidencia: prueba HTTP con ledger sintético y `DATABASE_PATH=:memory:`;
      `pnpm --filter @hogaria/server exec vitest run src/routes/household-planning-automation.routes.spec.ts`
      — **7/7**. No invoca IA ni escribe planes.
- [x] El servidor arranca un poller único tras inicializar la base de datos, detecta solo la ocurrencia
      semanal más reciente que ya venció, no recupera semanas omitidas en ráfaga y se detiene limpiamente;
      lee horario/versión/fecha de cambio en el mismo snapshot y pasa una versión-fence al worker; un
      cambio de configuración concurrente invalida la ocurrencia antes de llamar a IA. La clave idempotente
      del ledger evita duplicados entre ticks/procesos y una ejecución `review_required` no se reintenta
      sin acción explícita. El harness Vitest fija `DATABASE_PATH=:memory:` antes de cargar módulos; los
      casos con archivos usan rutas temporales propias. Evidencia: `household-planning-automation.scheduler.spec.ts`
      **6/6**, `household-planning-automation.worker.spec.ts` **14/14**, build TypeScript servidor correcto;
      smoke de arranque/`SIGINT` con `DATABASE_PATH=:memory:`, `NODE_ENV=test`, `PORT=0`, `HOST=127.0.0.1`
      mostró poller iniciado y apagado; carrera de versión probada sin llamada a IA ni publicación. La prueba
      `polls through the real worker once, records completion, and publishes without duplicates` pasa la
      misma ocurrencia dos veces a través del worker real y proveedor sintético; verifica una llamada, una
      fila de ledger completada y una publicación única. No se invocó al proveedor real.
      `runs an HTTP-saved schedule through the due poller, worker, and one publication` configura vía PATCH,
      deriva el vencimiento del `nextRun` HTTP y vuelve a sondear; verifica ejecución completada y semana
      publicada una sola vez. No usa IA real ni cambia datos persistentes.
- [x] Retry manual estricto por `expectedVersion` + `occurrenceKey`; requiere contexto del hogar activo y
      `settings` + `calendar.edit` actuales. Una reclamación nueva retorna HTTP 202 con `lastRun` allowlist
      sin esperar `completion`; errores por no autorizado, ausencia, configuración obsoleta, ocupación,
      no reintentable y terminal se proyectan a estados HTTP/códigos estables, nunca a metadatos internos.
      Evidencia focal: **55/55** schema/ruta con `DATABASE_PATH=:memory:`; worker inyectado con stub en prueba
      HTTP (sin proveedor real), coverage **83,64/80/94,73/86,11 %**, TypeScript servidor pasa. No valida
      en conjunto la reclamación real del ledger a través de HTTP ni el flujo E2E del proveedor.

- [x] En modo `generate`, el worker solicita una propuesta nueva de tareas con JSON Schema estricto,
      usando las zonas vigentes y la semana confirmada más reciente solo como contexto. No envía nombres,
      perfiles ni asignaciones al proveedor; asigna localmente de forma equilibrada, evita repetir persona
      en días consecutivos cuando hay solución y publica todos los ámbitos seleccionados en una única
      transacción solo tras validar el resultado y el destino vacío. Una propuesta inválida, cancelación,
      colisión o fallo de otro ámbito no deja publicación parcial. La prueba incluye la semana anterior
      como contexto y comprueba que no se filtran IDs/detalles/personas.
      Evidencia: `household-planning-automation.worker.spec.ts`, **14/14** con `DATABASE_PATH=:memory:`;
      el caso `generates both scopes with strict JSON, assigns tasks locally, and publishes atomically`
      comprueba ambas llamadas JSON, asignación equitativa, contexto y commit atómico. Sin proveedor real.

Comandos focales:

```powershell
$env:DATABASE_PATH=':memory:'; pnpm --filter @hogaria/server exec vitest run --coverage --coverage.include=src/routes/household-planning-automation.routes.ts --coverage.include=src/schemas/household-planning-automation.schema.ts src/schemas/household-planning-automation.schema.spec.ts src/routes/household-planning-automation.routes.spec.ts
pnpm --filter @hogaria/server exec tsc --noEmit -p tsconfig.json
```

- [x] **QA-HOME-TASKS.WEEKLY.2** — asignación fija/aleatoria, equilibrio, no repetir días
      consecutivos si hay solución, excepción explicada y preservación de asignaciones manuales.
      Evidencia: `household-task-assignment.spec.ts` y `household-tasks.component.spec.ts` cubren
      equilibrio, consecutividad e imposibilidad; `tests/e2e/household-plan-tasks.spec.ts` verifica
      asignación manual persistida, propuesta aleatoria sin mutar borrador/BD, adopción solo con
      «Usar este reparto» y persistencia distinta solo tras Guardar. E2E aislada sintética en Chromium
      y Mobile Chrome: 2/2 (13-10-2026); comando y límites en «Estado de implementación y evidencia».
- [x] **QA-HOME-TASKS.CALENDAR.1** — proyección de tareas en el calendario actual para el rango visible;
      fechas/rangos y semanas vacías correctos, límite entre hogares, permiso `calendar.view` y membresía
      activa revalidados en servidor; mostrar zona, estado y persona asignada (sin hora si el modelo no la
      define); capa de visibilidad accesible, todas las vistas relevantes y sin cambiar permisos de
      escritura, comidas ni calendarios personales. API/servicio/UI focal pasan; E2E sintética aislada **6/6** en Chromium, Mobile Chrome y Mobile Safari recorre agenda, día, 4 días, semana/timeline, mes y año en seis anchuras (320/393/568×320/767/768/1440), con Tab/Space/Enter y ARIA; prueba de ruta comprueba rango, hogar, permisos y campos privados. La auditoría visual global de otras familias no forma parte de este criterio.
- [x] **QA-AUTH.HOUSEHOLD-REQUIRED.1** — alta obligatoria crear/unirse, invitación inválida/revocada,
      error recuperable de red, reanudación, doble envío, membership activo antes de dashboard y rechazo
      server-side; sin acceso al resto con hogar pendiente. La E2E aislada sintética pasa **10/10** Chromium/Mobile Chrome e incluye invitación válida/inválida/revocada, error de red/HTTP, recarga, doble envío y acceso a ruta protegida tras unirse; middleware cubierto por test. La caducidad no se prueba ni promete mientras el contrato no la defina.
- [x] E2E local integrada para PC y móvil: hogar, overrides de miembros, planificación, calendario,
      consumo, borrador/aprobación de Compra, automatización futura y alta/unión; nine E2E pasan **32/32**
      en Chromium/Mobile Chrome y recorrido integrado **3/3** en Chromium/Mobile Chrome/Mobile Safari.
      E2E aislada adicional **1/1** conecta la configuración de automatización desde navegador con scheduler,
      worker, proveedor sintético y publicación idempotente. Usa DB temporal, app/API local y datos
      sintéticos. No valida comportamiento semántico de proveedor real.
- [x] Actualizar evidencia y límites aquí y en `HOGARIA-SPEC.md` §12av. La referencia anterior a
      §12t.T/§12t.R no existe en la fuente actual; la recurrencia del calendario no cambia en esta
      extensión. No marcarla completa ni validar IA real sin evidencia reproducible de cada gate.
