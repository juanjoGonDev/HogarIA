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

- [ ] **Inicio:** dejar neutras las tarjetas de método antes de la elección explícita y cotejar
      vivienda/plantas, tres métodos ilustrados, CTA y espaciado en escritorio y móvil.
- [x] **Editor:** agrupar pared/puerta/ventana y espacios en una sola barra coherente; conservar
      piso/zoom/historial arriba del plano y dock táctil debajo en móvil. Reducir los rellenos
      asignados del plano durante el dibujo (el prototipo reserva el naranja para la selección), y
      plegar la lista de zonas para no añadir un panel visible ausente del mockup sin quitar acceso
      por teclado/lector de pantalla. En dibujo libre, alinear las tres acciones de vértice en una
      fila de igual altura y jerarquía, con icono SVG legible además de texto; dar a «Vista previa»
      un icono y alinear su contenido con los demás botones de acción. Verificar la geometría de esos
      controles en escritorio, móvil y 320 px; no basta con que estén presentes.
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
  - [ ] **Iconos del flujo:** calcar las formas de herramientas, estancias, puertas/ventanas, chat y
        asignación de los SVG del prototipo; ajustar trazo/color/tamaño además del contenedor. La E2E
        comprueba el set de iconos en PC y móvil y las capturas `02-plan-editor` se cotejan de nuevo.
        La auditoría visual detectó que la referencia colorea en naranja el cursor seleccionado y
        etiqueta la pared como «Pared»; ambos detalles se corrigieron y verificaron. Sigue pendiente
        cotejar las siluetas SVG restantes frente al recorte, no solo comprobar que cada botón tiene
        un SVG.
  - [x] **Dock de dibujo en escritorio:** a 1920 px, las tarjetas de herramienta/estancia conservan
        la medida de 88 px del prototipo y sus SVG 32×32 px. Playwright mide esas geometrías.
  - [x] **Selección y nombres del dock:** el cursor activo usa el naranja primario del prototipo
        (`#f97316`), sin cambiar los glifos no seleccionados; la pared se rotula «Pared» en una línea.
        Playwright comprueba el color exacto a 1920 px y el texto del control en PC/móvil.
- [ ] **Foto/propuesta:** cotejar tamaño y proporción de la foto original y el plano generado en
      ambos breakpoints, y la jerarquía cambiar/confirmar/continuar. Mantener una salida accesible
      para descartar el borrador como control de icono compacto en el encabezado de propuesta, no
      como enlace suelto bajo la acción principal. El fixture de E2E debe parecer un boceto real y
      generar una propuesta con el mismo número de zonas que la referencia; no usar etiquetas de QA
      en imágenes. A 320–359 px verificar que el descarte no tapa título/estado y que la decisión
      y la continuación mantienen un margen ≥8 px frente a las acciones fijas; el plano sigue
      legible sin ocupar más altura de la disponible en pantallas estrechas.
- [ ] **Asignación:** mantener mapa + selector lateral en escritorio. En móvil igualar la
      prominencia vertical del mapa y presentar la edición en una hoja inferior con nombre/estado,
      cuatro opciones y CTA visible, no una tarjeta compacta con estado guardado/Más acciones que
      desplacen la decisión.
- [x] En escritorio, las cuatro opciones de responsabilidad aparecen en una fila de tarjetas
      iguales, centradas y legibles como en el prototipo (sin apilarlas); en móvil siguen en la hoja
      de asignación. Al seleccionar una estancia, el contorno naranja indica selección sin borrar
      el relleno que comunica quién se encarga de ella. Playwright mide alineación/altura común y
      conserva una aserción de color para la selección.
- [ ] **Tareas:** cotejar el peso visual del plano y la jerarquía del panel semanal. Los controles
      funcionales avanzados deben quedar accesibles sin sobrecargar la vista principal.
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
- [ ] **Ajuste por chat, acabado visual:** cotejar densidad y espaciado restantes de planos,
      conversación y decisión contra el mockup; en escritorio el plano debe ocupar al menos el 74 %
      de la altura útil de su marco sin deformar su geometría. Mantener el fixture móvil casi
      cuadrado y uno vertical en escritorio para que ambas comparaciones correspondan a sus
      referencias; no ocultar diferencias de tipografía/respiración.
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
- [ ] Corregir las diferencias pendientes de composición, tamaño, jerarquía, color y espaciado
      observadas en esas 12 comparaciones. No declarar fidelidad visual exacta solo por pasar pruebas
      de estructura.
- [x] Registrar comprobaciones y limitaciones reproducibles; no inferir fidelidad solo por tests
      unitarios, compilación o presencia de controles.

Evidencia visual y regresión:

- `node scripts/run-isolated-playwright.mjs --project=chromium --project=mobile-chrome tests/e2e/household-plan-tasks.spec.ts` — **2/2 pasan en 49,6 s** (12-10-2026, última ejecución). Servidor/SQLite/artefactos aislados; el proveedor de IA se simula y la DB/artefactos temporales propios se limpian.
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
