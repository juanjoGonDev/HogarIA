# HogarIA — Plano interactivo del hogar y tareas por zonas

Estado: **implementación en curso · primera unidad completada** · 2026-10-11

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
| Compartido o auxiliar   | `common_area` (zona común), `shared_room` (cuarto comunitario), `storage_area` (zona de almacenamiento) y `custom` (nombre libre).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |

El tipo de vivienda inicial también admite `apartment`, `studio`, `detached_house`,
`semi_detached_house`, `terraced_house`, `townhouse`, `duplex`, `shared_home`, `mobile_home` y
`other`. La forma de la vivienda no restringe qué zonas se pueden añadir.

Una zona personalizada puede tener cualquier nombre no vacío y queda marcada como tal; no se
pretende que el enum sea infinito. Las estancias anidadas válidas —por ejemplo, una piscina dentro
del jardín— pueden declararse como zona hija.

## Flujo y alcance de producto

- En **Hogar > Plano**, se puede empezar en el lienzo, colocar zonas desde un constructor guiado o
  subir una foto/boceto. Se puede cambiar de método sin perder el borrador. El hogar puede tener
  una o varias plantas, nombrarlas y seleccionar una sin mezclar sus zonas.
- El plano muestra perímetro, paredes, puertas, ventanas y entrada principal como elementos
  vectoriales editables. Tocar/clicar una zona la selecciona; también existe una lista accesible
  equivalente para teclado y lector de pantalla.
- En **Hogar > Tareas**, seleccionar una zona del plano abre sus tareas. Se puede crear/editar una
  tarea, fijar días o frecuencia, asignar una persona concreta, dejarla sin asignar o solicitar un
  reparto aleatorio equitativo para la semana.
- Una modificación por chat incluye siempre la revisión actual del plano como JSON y la petición
  nueva; puede añadir una foto/boceto. Continuar el chat anterior no es requisito de corrección:
  una conversación nueva también recibe el último plano confirmado. La IA devuelve una propuesta
  completa para previsualizar como `actual` y `propuesta`, nunca aplica ni guarda directamente.
- Se puede descartar la propuesta, deshacerla o aplicarla expresamente. Aplicar una propuesta que
  quite una zona con tareas asociadas exige resolver o confirmar esas tareas antes de guardar.
- El plano, sus revisiones aplicadas, zonas y tareas pertenecen al hogar activo. Las escrituras usan
  control de versión: una pestaña obsoleta no pisa cambios nuevos; devuelve conflicto recuperable.

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
exteriores dibujan el perímetro y las interiores las divisiones. Los segmentos generados por IA
son ortogonales. Todas las propiedades del objeto enviado al modelo son obligatorias; los valores
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
  degenerados, paredes ortogonales no nulas, referencias de puertas a paredes, aberturas dentro de
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
- Coverage focal del schema: 95,34 % statements, 75,6 % branches, 95,83 % funciones y 97,94 % líneas.
  La ejecución focal de `vitest --coverage` aplicó los thresholds de todos los archivos incluidos y
  terminó con error al no ejecutar sus suites; el archivo de esta unidad sí superó cada umbral.
- `pnpm run build` (server) y `pnpm run check:ui`: aprobados. La cobertura completa queda pendiente
  de la puerta general antes de cerrar el PR.

### QA-HOUSEHOLD.PLAN.AI-PROPOSAL.1 — generación, foto y revisión por chat

- [ ] Ruta autenticada bajo hogar activo; usa proveedor/cola de ese hogar y entrega
      `response_format` estricto. Casos mock: generation, foto, edición con contexto JSON, rechazo,
      timeout, cancelación, truncado, JSON inválido, geometría inválida y proveedor sin soporte.
- [ ] La IA devuelve una propuesta completa versionada; el servidor valida antes de mostrarla y no
      escribe el plan hasta la confirmación explícita. Base obsoleta produce conflicto; retry no
      duplica ni guarda una propuesta.
- [ ] Pruebas garantizan privacidad de logs (sin prompt, foto, base64, datos de miembros), permiso,
      aislamiento entre hogares y ausencia de fallback de proveedor.

### QA-HOUSEHOLD.PLAN.PERSISTENCE.1 — plano por hogar y concurrencia

- [ ] Migración idempotente/no destructiva, CRUD scoped al hogar activo, control de versión/CAS y
      rollback transaccional; probar miembro inválido, permisos y dos hogares.
- [ ] Se guardan solo propuestas aplicadas. Cambios de plano que retiren zonas con tareas requieren
      resolución explícita; edición concurrente no borra la versión más reciente.

### QA-HOUSEHOLD.PLAN.EDITOR.1 — lienzo y zonas interactivas

- [ ] Pestañas `Plano` y `Tareas` bajo Hogar conservan URL, navegación de teclado y estado al cambiar
      de pestaña. Lienzo libre, constructor guiado y foto pueden alternarse sin perder el borrador.
- [ ] Renderizar solo geometría local validada; selección por ratón/tacto y teclado, pisos,
      edición/arrastre, lista accesible de zonas, previsualización actual/propuesta, deshacer,
      descartar y aplicar.
- [ ] Playwright real en escritorio y móvil: breakpoints existentes y mínimos, orientación,
      teclado, zoom/scroll, safe-area, foco, lectores/labels, controles táctiles y sin overflow;
      guardar capturas comparables sintéticas inspeccionadas.

### QA-HOUSEHOLD.TASKS.WEEKLY.1 — asignación manual y justa

- [ ] Asociar tarea con zona del plano o con hogar completo; selección de persona, tareas sin
      asignar y programación semanal editables.
- [ ] Pruebas property/table para equidad, no repetición en días consecutivos, semanas vacías,
      miembros insuficientes, restricciones inviables, reproducibilidad y ausencia de persistencia
      hasta confirmar.
- [ ] E2E aislado verifica que tocar una zona lleva a sus tareas, que el reparto asigna solo
      miembros activos del hogar y que otra casa nunca ve ni altera la semana.

### Puertas generales

- [ ] TDD primero; cliente y servidor con fixtures sintéticos y proveedor simulado; DB temporal
      verificada explícitamente. No llamar a IA real para gates repetibles.
- [ ] Typecheck, build, `check:ui`, tests focales/completos aplicables, cobertura ≥70 % por archivo
      y hooks de commit/push. Registrar comando, resultado y limitación exactos.
- [ ] Inspección Playwright con servidor real y datos sintéticos; PC y móvil, capturas comparables,
      geometría equivalente con tolerancia ≤1 CSS px, accesibilidad y ninguna información privada.
- [ ] Mantener PR Draft hasta cumplir gates. Nunca hacer merge sin autorización explícita.

## Fuera de alcance v1

- Medidas arquitectónicas certificadas, cálculo de superficies/instalaciones, planos técnicos para
  obra, exportación CAD, navegación AR, sincronización domótica, notificaciones push y permisos
  configurables nuevos.
- La geometría generada es un boceto organizativo editable, no documento profesional ni medición
  fiable. La interfaz debe dejar claro que la persona revisa y confirma el resultado.
