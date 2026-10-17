# Instrucciones para agentes

Prioridades: corrección > seguridad/datos > mantenimiento > simplicidad > UX. Trabaja sobre evidencia del repositorio y la app; no des por cierto un recuerdo, una spec histórica o un test no ejecutado.

## Flujo obligatorio: spec primero (SDD)

1. Antes de implementar, localiza la fuente de verdad vigente: contrato/spec activa, rutas, código, pruebas y comportamiento actual. Si falta contrato, crea primero una spec enfocada con criterios de aceptación en checklist Markdown fácil de marcar.
2. Publica la spec en la rama solicitada y abre/actualiza un **Draft PR antes de empezar la implementación**. Sigue la rama que indique el usuario; no crees otra ni cambies de base si pidió expresamente trabajar en la actual.
3. Divide la spec en unidades pequeñas. Antes de cada casilla, revalida la fuente de verdad; marca `[x]` solo tras prueba y evidencia reproducibles. Mantén la spec actualizada con hallazgos, decisiones y lo que queda pendiente.
4. No inventes alcance a partir de documentos históricos. Si la fuente actual y la spec discrepan, registra la discrepancia y resuelve la conducta esperada antes de codificar.

## Implementación y verificación

- Trabaja con TDD: escribe primero la prueba que reproduce el fallo, implementa el cambio mínimo y verifica la regresión. Incluye casos límite, errores, carga, cancelación, repetición y persistencia relevantes.
- Cada cambio de comportamiento necesita pruebas unitarias/integración; la UI necesita validación real con Playwright contra la app y el servidor. Un test listado, simulado o solo compilado no cuenta como ejecución E2E real. Los proveedores externos se simulan en la suite repetible; el smoke real es opt-in y aislado.
- Exige al menos 70 % de coverage para statements, ramas, funciones y líneas del alcance probado; no rebajes gates superiores existentes. Comprueba los umbrales locales y los de CI, y deja constancia explícita si CI no ejecuta algún gate.
- Para cambios frontend, valida escritorio y móvil, incluidos los anchos mínimos, orientación, teclado, modales/hojas, scroll, safe-area y bordes de los breakpoints presentes en el código. Revisa accesibilidad: labels/nombres, teclado y foco, contraste, estados y controles táctiles.
- Guarda y enseña capturas comparables de PC y móvil para cambios de interfaz. Usa fixtures sintéticos y artefactos ignorados por Git; jamás pongas datos personales o secretos en capturas, vídeos, traces ni reportes.
- Ejecuta primero la prueba más estrecha que dé señal útil; antes de cerrar el cambio ejecuta todas las comprobaciones requeridas por la spec. Registra comando, resultado y limitaciones. No declares «todo funciona» si no recorriste todos los criterios.

## Datos, secretos y herramientas

- No ejecutes tests con escritura contra la base de datos, servidor o proveedor de uso normal. Aísla cada run con DB temporal, semilla única y cleanup propio; conserva intactos datos y procesos preexistentes. Verifica el `DATABASE_PATH` efectivo antes de iniciar una suite.
- Trata tokens, cookies, `.env`, credenciales y URLs con credenciales como secretos incluso si son temporales o de una LAN propia. Tómalos de variables de entorno/almacén seguro, redáctalos y nunca los guardes en Git, specs, comandos registrados, logs ni fixtures.
- Preserva trabajo existente, incluidos archivos sin seguimiento; no sobrescribas ni limpies artefactos ajenos. No realices acciones destructivas, irreversibles, secretas, de merge, release, deploy, publicación o migración remota sin permiso explícito. Un Draft PR y el push pedidos por el usuario sí están autorizados; **nunca mergees sin permiso explícito**.

## Commits, PRs y colaboración

- Haz commits atómicos por unidad de checklist, con pruebas y docs que expliquen esa unidad. Usa mensaje Conventional Commit y deja un rollback claro.
- Corre hooks de commit y push. Nunca uses `--no-verify` ni otro bypass. Si falla un hook de push sobre un commit aún local, corrige la causa y amenda ese commit antes de reintentar; no reescribas historia ya publicada: crea otro commit.
- Mantén cada PR en Draft durante el trabajo, enlaza evidencia/checklist y no lo marques listo hasta que gates y pruebas estén verdes. No impongas un límite predeterminado de PR: separa el trabajo en unidades revisables y sigue cualquier límite explícito que indique el usuario.
- Usa subagentes en paralelo cuando aporte valor, con tareas delimitadas y sin editar los mismos archivos. Considera worktrees paralelos si reducen espera sin elevar el coste de RAM; integra sus cambios en la rama/worktree inicial, verifica el resultado conjunto y elimina worktrees temporales ya integrados.
- Informa al usuario de forma simple y periódica: en qué trabajas, qué validaste, capturas PC/móvil cuando corresponda y bloqueos reales.

## Calidad de cambios

- Sigue clean code/SOLID, evita lógica, cálculos, componentes o flujos duplicados; favorece la solución reversible más pequeña.
- En formularios y modales, elimina títulos, ayudas y etiquetas visibles que repitan el mismo propósito; deja una instrucción breve, 1–2 ejemplos y una sola ayuda útil. Los placeholders no reemplazan nombres accesibles. Usa iconos solo para acciones reconocibles, siempre con nombre accesible y target táctil; oculta detalles secundarios en disclosures accesibles, sin esconder consentimiento ni avisos esenciales.
- En áreas funcionales con varios flujos, usa tabs/subtabs con nombres claros para separarlos; no amontones ajustes, edición, vistas previas, tareas y estados de seguimiento en una única vista larga. Los flujos por etapas también deben presentar una etapa cada vez, no el formulario, todos los resultados y la confirmación apilados. Mantén cada pantalla enfocada en su tarea y deja accesibles los flujos relacionados mediante navegación explícita. Para Hogar > Planificación, Comidas, Tareas y Ajustes deben estar en subtabs distintos; dentro de Comidas, preparación y revisión de propuesta son pasos separados y en móvil la semana se consulta en grupos manejables, no como una lista interminable. El calendario global existente no se sustituye y la revisión/confirmación de compra sigue un flujo por pasos, no un panel simultáneo dentro de Comidas.
- Mantén consistencia visual, i18n y accesibilidad con los patrones existentes. Las confirmaciones destructivas deben ser explícitas y accesibles.
- La meta visual es la uniformidad geométrica pixel a pixel en toda la web, no solo en la vista modificada: componentes equivalentes comparten dimensiones y tokens de tipografía, espaciado, padding, gaps, bordes y alineación. Cambia el énfasis con color, icono o estado, no aumentando el tamaño. No añadas medidas locales divergentes; cualquier diferencia funcional o responsive debe justificarse en la spec activa.
- Antes de cerrar cambios de UI, compara en el navegador la geometría calculada de elementos equivalentes en las rutas y breakpoints afectados (tolerancia máxima de 1 CSS px), revisa márgenes y padding y guarda capturas sintéticas comparables de escritorio y móvil. Si el cambio afecta un token o shell compartido, revalida la matriz completa de rutas/familias; no cierres la auditoría global si queda una familia pendiente.
- Lee solo la spec/decisión vigente y los archivos necesarios. No cambies dependencias, datos ni archivos fuera del alcance sin necesidad demostrada.
