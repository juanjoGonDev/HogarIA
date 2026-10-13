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
  Las reglas recurrentes y la generación automática de ocurrencias quedan fuera de v1.
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
> prevalecen. La extensión está en implementación; los criterios de aceptación siguen pendientes hasta
> tener pruebas reproducibles. La UI de calendario existente se conserva como calendario único.

### Decisión de producto

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
   adecuada; si no, se separan y se explica el criterio. Gustos/disgustos son señales de optimización, no
   motivo automático para multiplicar platos. La IA no formula diagnósticos ni promete resultados médicos.
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
  participantes. La asignación de una comida es un permiso explícito solo para ese evento: lo ven sus
  participantes activos con `calendar.view`; no expone otros eventos/calendarios personales. La
  confirmación exige `calendar.edit` al autor. La opción general `shareCalendar` no amplía este acceso
  limitado por evento ni oculta una asignación aceptada por sus participantes.
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
  mostrar una vista previa. La IA no escribe directamente en el calendario ni en el inventario. La persona
  revisa y confirma la propuesta para persistirla.
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
- Después de registrar lo realmente comido, la IA puede comparar menús próximos con el inventario y
  proponer una lista de compra. Antes de crearla, la UI pide revisar las existencias —en especial lo que
  se necesita para las próximas comidas—, permite corregirlas y presenta un borrador editable. Solo la
  aprobación crea/actualiza la lista de **Compra**; se consolidan ingredientes repetidos entre recetas y
  comensales. Nunca se afirma que una comida se realizó por el mero hecho de estar en el calendario.
- La automatización semanal distingue dos modos: **generar una planificación nueva** (llama al planificador
  cuando llegue la fecha configurada) y **repetir la planificación actual** (reutiliza el plan semanal
  confirmado sin pedir otra respuesta a IA). Repetir no duplica eventos ni reemplaza cambios manuales sin
  permiso; la lista de compra se vuelve a calcular con las existencias actuales. Un indicador pequeño y persistente muestra la próxima ejecución automática y tiene un único
  botón alternable de play/pause; al pausar conserva fecha y plan, y al reanudar informa la próxima fecha.
  Puede configurarse si la ejecución abarca tareas, comidas o ambas.

### Alta de cuenta: pertenencia obligatoria a un hogar

El registro no termina con una cuenta sin hogar: antes de entrar al resto de la aplicación, la persona
elige explícitamente **Crear un hogar** o **Unirme a uno existente** mediante una invitación válida. No
hay ruta de omisión ni acceso al dashboard/calendario con membresía pendiente. Si se interrumpe el flujo,
se puede reanudar sin crear cuentas, hogares o membresías duplicadas. Un código inválido, vencido, una
denegación o un fallo de red deja un error recuperable y conserva la opción de crear hogar o reintentar.
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

### Estado de implementación y evidencia (13-10-2026)

Esta extensión sigue **parcial y en curso**; no se marca ningún criterio completo por haber entregado
solo su backend o sus pruebas unitarias.

- **Alta obligatoria y puerta del servidor — parcial:** el registro conduce a crear/unirse al hogar y
  el montaje real de `/api/*` rechaza funciones protegidas sin membresía activa, dejando disponibles
  descubrimiento/crear/unirse. `createHousehold` inicializa preferencias compartidas desde el creador;
  la operación es idempotente y `join` no reemplaza la configuración existente. Las pruebas de
  rutas de cuenta ahora preparan una membresía sintética para ejercitar perfil/avatar/password después
  del onboarding; la puerta real tiene su propio test con `createApp`. Falta E2E real de alta,
  invitación, interrupción/reanudación y móvil.
- **Configuración de comidas — backend/UI parcial:** `GET/PATCH /api/household/meal-planning`, columnas
  de hogar/miembro, validación de permiso existente, resolución por miembro e inicialización del hogar
  están implementados. Los overrides empiezan apagados; la preferencia de horario personal procede de
  `users.preferences.mealPlan/mealTimes` al activar override, sin copiar alergias ni gustos al hogar.
  La nueva ruta de propuesta ya consume esta resolución; `plan-week` heredado no se declara migrado.
  La UI está integrada en Hogar > Planificación con errores recuperables, guardado parcial y overrides
  separados; E2E aislada sintética pasa 2/2 en Chromium y Mobile Chrome. Falta cobertura de preferencias
  de varios miembros en el recorrido integrado y revisión completa de breakpoints/estados.
- **Plan semanal — backend parcial:** se añadió `POST /api/household/meal-planning/proposal`
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
- **Calendario compartido — backend parcial integrado:** un evento compartido se guarda una vez y sus
  participantes son usuarios del hogar con permiso de lectura; las lecturas existentes exponen el
  evento solo a las personas asignadas, sin notas/objetivos privados. El consumo dispone de GET/PUT
  separado, permiso por miembro asignado con `calendar.view`, versiones optimistas, idempotencia,
  correcciones y un ledger de movimientos de stock transaccional. La coincidencia del producto es
  estricta por nombre normalizado y unidad; inventario privado, conversión de unidades y sugerencias
  aproximadas quedan excluidos deliberadamente. La lectura existente del calendario aún no incluye este
  estado; la futura UI puede obtenerlo desde el endpoint GET. Pendiente recorrido E2E real, UI e integración
  de compra.
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
  **89,83/80,83/100/92,63 %** (statements/branches/funciones/líneas). El esquema suma **8 tests** y
  **100/100/100/100 %**. El contrato cubre valores positivos, cero solo para «no realizada», límites,
  versión y propiedades no permitidas. Se ejercitaron retries, correcciones, receta alterada/corrupta,
  rollback, contexto y permisos, cambio de unidad tras deducción parcial o restauración de línea huérfana,
  desactivación de despensa compartida, stock insuficiente, producto ambiguo y recetas ausentes/corruptas.
  `tsc --noEmit -p tsconfig.json` pasa.
  Los tests usan `DATABASE_PATH=:memory:` y datos
  sintéticos; no llaman a servidor, inventario persistente ni proveedor real. La suite completa de
  servidor y E2E UI no forman parte de esta unidad aislada.

  ```powershell
  $env:DATABASE_PATH=':memory:'
  pnpm --filter @hogaria/server exec vitest run src/routes/household-meal-proposals.routes.spec.ts src/utils/household-meal-proposal.planner.spec.ts src/utils/ai-queue.spec.ts src/schemas/household-meal-proposal-request.schema.spec.ts src/schemas/form-contract.spec.ts
  pnpm --filter @hogaria/server exec tsc --noEmit -p tsconfig.json
  pnpm --filter @hogaria/server run test:coverage
  ```

  Resultado previo a los últimos fixes: **5 archivos / 452 tests aprobados** en la focal. Tras las
  pruebas de regresión de permiso de lectura, cambio de hogar durante el parseo y ejecución del
  proveedor, límite del body, lote de más de 100 eventos y escritura atómica, la suite de servidor
  termina **75 archivos aprobados / 1 omitido; 1440 tests aprobados / 1 omitido**. TypeScript del
  servidor pasa.
  Cobertura de la ruta propuesta+confirmación: **90.47 % statements, 70.83 % branches, 98.07 % funciones
  y 92.3 % líneas**; planner: 91.73 %, 81.6 %, 100 % y 93.39 %. Cobertura global de servidor: **91.79 %
  statements, 83.14 % branches, 96.70 % funciones y 94.29 % líneas**. La suite usa `DATABASE_PATH=:memory:`
  y proveedor sintético; no se llamó a IA real. **Runtime:** las rutas se verificaron con harness Hono y
  SQLite en memoria; el recorrido real app+servidor/E2E de esta vista aún no se ejecuta. **Rollback de la
  unidad de confirmación:** retirar endpoint, esquema de confirmación, tests/cobertura y esta evidencia;
  conserva preview, schema Structured Outputs y almacén/calendario compartido. Aún faltan integrar la UI,
  E2E reproducible PC+móvil, consumo, compras, automatización y validar la matriz completa.

El análisis previo del planificador está reflejado arriba para orientar la próxima unidad; todos los
criterios inferiores permanecen sin marcar hasta validar cada condición en su alcance completo.

### Criterios pendientes de aceptación — no implementados

- [ ] **QA-HOME-MEALS.SETTINGS.1** — API, persistencia, permisos y resolución por campo; defaults de
      overrides apagados; hogar nuevo inicializado idempotentemente desde valores existentes; unirse
      no modifica valores comunes; ningún dato ajeno/no seleccionado llega al planificador.
- [ ] **QA-HOME-MEALS.PLAN.1** — subtabs `Comidas`, `Tareas` y `Ajustes`; solo el panel seleccionado
      es visible, con navegación accesible por teclado y contexto/URL conservados en escritorio y
      móvil; cada `aria-controls` apunta a un tabpanel existente. Componentes inactivos se montan bajo
      demanda, pero una propuesta aún no confirmada conserva selección, paso y día al cambiar de subtab;
      volver no genera otra petición IA. Dentro de Comidas, `Preparar` y `Revisar propuesta` son pasos excluyentes; E2E comprueba que
      no se apilan formulario+semana+confirmación y que móvil ofrece un día/grupo manejable con el CTA
      alcanzable sin recorrer toda la semana. Revisión de existencias/compra es un
      paso secuencial que conecta con el módulo Compra existente, no una sección larga con todo mezclado.
      Plan semanal con proveedor simulado, vista previa explícita y
      `response_format` estricto; plato compartido una vez, raciones por participantes, conflictos
      soft/hard, alergia estricta, todos con overrides, turnos personales, sin receta segura,
      respuesta inválida/IDs foráneos/duplicados/error sin escrituras; cantidades de receta por ración
      y cambio local de raciones sin llamada IA ni mutación de la receta base.
- [ ] **QA-HOME-MEALS.CALENDAR.1** — persistencia idempotente tras confirmar, calendario actual,
      evento compartido visible una vez, asignaciones correctas y ninguna nota/objetivo privado
      filtrado.
- [ ] **QA-HOME-MEALS.CONSUMPTION.1** — realizada/no realizada, raciones cero/positivas/fuera de
      rango, ajustes, inventario sin cambios antes de confirmar e idempotencia; la receta base y los
      movimientos de stock no se duplican.
- [ ] **QA-HOME-MEALS.SHOPPING.1** — stock editable, consolidación de ingredientes, borrador,
      revisión, edición/cancelación/rechazo/aprobación; errores y cancelaciones no mutan Compra ni
      inventario.
- [ ] **QA-HOME-PLANNING.AUTOMATION.1** — generar/repetir, play/pause, siguiente fecha, retry e
      idempotencia; repetir no llama a IA ni duplica eventos, protege ediciones manuales y permite
      elegir tareas/comidas.
- [ ] **QA-HOME-TASKS.WEEKLY.2** — asignación fija/aleatoria, equilibrio, no repetir días
      consecutivos si hay solución, excepción explicada y preservación de asignaciones manuales.
- [ ] **QA-AUTH.HOUSEHOLD-REQUIRED.1** — alta obligatoria crear/unirse, invitación inválida/vencida,
      error recuperable, reanudación, doble envío, membership activo antes de dashboard y rechazo
      server-side; sin acceso al resto con hogar pendiente.
- [ ] E2E real contra app local para PC y móvil: configuración de hogar, override por dos miembros,
      generación y aprobación, calendario, confirmación de raciones, borrador de compra, automatización y
      alta crear/unirse; usar DB temporal/semillas únicas y capturas sin datos personales.
- [ ] Actualizar la evidencia de cada unidad aquí y en `HOGARIA-SPEC.md` §12t.T. La recurrencia de
      §12t.R no cambia. No marcar la extensión completa ni la validación IA real sin evidencia
      reproducible de cada gate.
