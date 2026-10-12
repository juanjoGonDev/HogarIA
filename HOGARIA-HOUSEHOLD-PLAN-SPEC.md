# HogarIA — Plano interactivo del hogar y tareas por zonas

Estado: **implementación funcional y CI completados; ajuste de fidelidad visual en curso según cotejo directo · PR #47 en Draft · 2026-10-12**

Este contrato concreta una nueva capacidad de HogarIA y complementa las reglas compartidas de
`HOGARIA-SPEC.md` §12ap (aislamiento por hogar, membresía, permisos y proveedor de IA) y §13
(tareas del hogar pendientes). No modifica recetas ni el calendario existente.

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
- `$env:DATABASE_PATH=':memory:'; pnpm run test:coverage` — cliente 1396/1396 y servidor 1330/1331 (1 omitida); cobertura cliente 93,89/84,75/93,62/95,59 % y servidor 91,76/83,51/95,56/94,27 % (statements/branches/functions/lines). Sin errores de umbral.
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

- [ ] **Inicio:** dejar neutras las tarjetas de método antes de la elección explícita y cotejar
      vivienda/plantas, tres métodos ilustrados, CTA y espaciado en escritorio y móvil.
- [ ] **Editor:** agrupar pared/puerta/ventana y espacios en una sola barra coherente; conservar
      piso/zoom/historial arriba del plano y dock táctil debajo en móvil. Reducir los rellenos
      asignados del plano durante el dibujo (el prototipo reserva el naranja para la selección), y
      plegar la lista de zonas para no añadir un panel visible ausente del mockup sin quitar acceso
      por teclado/lector de pantalla.
- [ ] **Iconos del flujo:** calcar las formas de herramientas, estancias, puertas/ventanas, chat y
      asignación de los SVG del prototipo; ajustar trazo/color/tamaño además del contenedor. La E2E
      comprueba el set de iconos en PC y móvil y las capturas `02-plan-editor` se cotejan de nuevo.
- [ ] **Foto/propuesta:** cotejar tamaño y proporción de la foto original y el plano generado en
      ambos breakpoints, y la jerarquía cambiar/confirmar/continuar. El fixture de E2E debe parecer
      un boceto real y generar una propuesta con el mismo número de zonas que la referencia; no usar
      etiquetas de QA en imágenes.
- [ ] **Asignación:** mantener mapa + selector lateral en escritorio. En móvil igualar la
      prominencia vertical del mapa y presentar la edición en una hoja inferior con nombre/estado,
      cuatro opciones y CTA visible, no una tarjeta compacta con estado guardado/Más acciones que
      desplacen la decisión.
- [ ] **Tareas:** cotejar el peso visual del plano y la jerarquía del panel semanal. Los controles
      funcionales avanzados deben quedar accesibles sin sobrecargar la vista principal; las siete
      asignaciones, el resumen de equidad y la acción de aplicar deben seguir visibles/alcanzables
      en móvil.
- [ ] **Ajuste por chat:** cotejar el tamaño de los planos actual/propuesta, conversación y decisión;
      en móvil mostrar/alcanzar tras la respuesta las cuatro continuaciones del prototipo (seguir
      chat, nuevo chat, subir foto, volver al lienzo) junto a aplicar/deshacer, sin comprometer el
      estado de borrador ni guardar antes de la confirmación.
- [x] E2E verifica interacción, permisos, persistencia, borradores, IA simulada, teclado/foco,
      labels, contraste AA en temas claro/oscuro, safe-area y ausencia de overflow; no hay fixtures
      personales ni llamadas reales a IA.
- [x] Capturar e inspeccionar los seis estados sintéticos a 1280×970 y 390×950; verificar además
      breakpoints 320, 359, 360, 389, 390, 639, 640, 767, 768, 1023 y 1024 px y orientación 568×320.
- [x] Generar e inspeccionar las seis comparaciones PC + seis móvil en
      `.e2e-screenshots/household-plan-comparison/` recortando la zona de producto de los mockups
      y las capturas aisladas.
- [ ] Corregir las diferencias pendientes de composición, tamaño, jerarquía, color y espaciado
      observadas en esas 12 comparaciones. No declarar fidelidad visual exacta solo por pasar pruebas
      de estructura.
- [x] Registrar comprobaciones y limitaciones reproducibles; no inferir fidelidad solo por tests
      unitarios, compilación o presencia de controles.

Evidencia visual y regresión:

- `node scripts/run-isolated-playwright.mjs --project=chromium --project=mobile-chrome tests/e2e/household-plan-tasks.spec.ts` — **2/2 pasan en 46,0 s** (ejecución final, 12-10-2026). Servidor/SQLite/artefactos aislados; el proveedor de IA se simula y la DB/artefactos temporales propios se limpian.
- La comparación con los mockups aprobados de los seis estados PC/móvil se regeneró e inspeccionó en `.e2e-screenshots/household-plan-comparison/`. Los iconos SVG de herramientas/estancias se ajustaron de 24 a 32 px en las vistas verificadas; E2E valida 32 px y que los rótulos de pestañas no se monten a 320 px.
- `pnpm --filter @hogaria/web exec ng test --no-watch --include=src/app/features/household/household-area-catalog.spec.ts --include=src/app/features/household/household-area-glyph.component.spec.ts --include=src/app/features/household/household-tasks.component.spec.ts --include=src/app/features/household/household-plan-preview-map.component.spec.ts` — **22/22**.
- `pnpm run check:ui` — sin incidencias (228 ficheros/21 reglas); `pnpm run typecheck:e2e` — aprobado.
- El primer pase halló dos fallos visuales que no detectaba el simple `scrollWidth`: a 320 px las pestañas del hogar se montaban; y en pantalla baja la decisión de foto quedaba debajo de la barra fija (`bottom=729,89`, `sticky top=693`). Se compactaron las pestañas hasta 389 px, con scroll/foco por teclado, y a 320×568 las acciones de foto dejan de ser fijas y permanecen alcanzables al desplazar. E2E verifica 320, 359, 360, 389 y 390 px y ambos casos pasan.
- El primer CI de esta revisión halló que las media queries nuevas no estaban cubiertas por la matriz global B−1/B/B+1. Se añadieron 388–390, 1198–1201 y 1278–1281 px a `tests/e2e/layout-gutters.spec.ts`; el test enfocado pasa 1/1 y el spec completo aislado pasa **7/7 en 1,3 min**.
- Las capturas actuales usan 1280×970 y 390×950 para acercarse al encuadre del mockup; los seis estados `01-plan-start` a `06-chat-adjustment` se regeneran en `.e2e-screenshots/household-plan-tasks/{chromium,mobile-chrome}/`, con capturas 320×568 y 568×320 adicionales. Las capturas usan plan/foto sintéticos, sin etiquetas QA ni datos personales. La emulación no sustituye un teléfono físico con notch.
- La inspección de las 12 comparaciones confirma que la jerarquía del inicio, el dock del editor, la hoja de asignación móvil y las cuatro continuaciones del chat ya están presentes. Siguen pendientes la forma/proporción del plano sintético frente a la referencia, la proporción del plano propuesto en móvil y diferencias de densidad/espaciado del panel de tareas y el chat. La shell real de HogarIA se conserva; no se declara fidelidad exacta hasta corregir estas diferencias y reinspeccionar las comparaciones.

### Puertas generales

- [x] API: TDD con fixtures sintéticos y proveedor simulado; DB temporal
      verificada explícitamente. No llamar a IA real para gates repetibles.
- [x] Typecheck, build, `check:ui`, tests completos aplicables y cobertura ≥70 % por archivo;
      registrar comando, resultado y limitación exactos.
- [x] Hooks pre-commit/pre-push obligatorios ejecutados sin bypass: Prettier, `check:ui`, build,
      typecheck E2E y tests completos.
- [x] CI manual final `38212052262` completó correctamente los nueve jobs; PR #47 permaneció Draft
      hasta pasar todos los gates.
- [x] Inspección Playwright con servidor aislado y datos sintéticos; PC y móvil, capturas comparables,
      geometría equivalente con tolerancia ≤1 CSS px, teclado/labels y ninguna información privada.
- [x] PR #47 pasó a Ready for review tras aprobar los gates. No se hizo merge.

Cobertura verificada localmente (repetición final después de la revisión visual):

- `$env:DATABASE_PATH=':memory:'; pnpm run test:coverage` — servidor: 66 archivos, 1328 pruebas
  aprobadas y 1 omitida; 91,76 % statements, 83,48 % ramas, 95,56 % funciones y 94,27 % líneas.
  Cliente: 1386 pruebas aprobadas; 93,99 % statements, 85,07 % ramas, 93,82 % funciones y
  95,63 % líneas. Los archivos del alcance superan 70 % en cada métrica; editor 85,38/70,41/85,71/89,8 %
  y mapa de propuesta 97,14/88,88/100/98,36 % (statements/ramas/funciones/líneas).
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
  typecheck E2E y `pnpm run test` (11 config, 1386 client, 1328 server + 1 skip).
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
