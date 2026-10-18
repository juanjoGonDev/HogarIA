const STANDARD_ACTION_HEIGHT = '44px';
const STANDARD_ACTION_WIDTH = '96px';

function normalize(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractRuleBodies(source, selector) {
  const css = normalize(source);
  const marker = `${selector} {`;
  const bodies = [];
  let from = 0;

  while (from < css.length) {
    const start = css.indexOf(marker, from);
    if (start < 0) break;
    const open = start + marker.length - 1;
    let depth = 0;
    let end = open;
    for (; end < css.length; end++) {
      if (css[end] === '{') depth++;
      else if (css[end] === '}' && --depth === 0) break;
    }
    if (end >= css.length) break;
    bodies.push(css.slice(open + 1, end));
    from = end + 1;
  }

  return bodies;
}

function hasDeclaration(block, property, value) {
  const css = normalize(block);
  const escapedProperty = property.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const escapedValue = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|[;{}])\\s*${escapedProperty}\\s*:\\s*${escapedValue}\\s*(?:;|$)`).test(
    css
  );
}

function hasAnyDimension(block) {
  return /(?:^|[;{}])\s*(?:width|height|min-width|min-height|max-width|max-height|padding|padding-block|padding-inline|font-size|line-height)\s*:/i.test(
    normalize(block)
  );
}

/**
 * Guard the shared text-action geometry used by app-button and calendar actions.
 * Grid controls and icon-only buttons remain separate functional families.
 */
export function findButtonGeometryViolations({ globalStyles, calendarStyles, buttonStyles }) {
  const violations = [];
  const add = (detail, source = 'global') =>
    violations.push({ rule: 'button-geometria', detail, source });
  const global = normalize(globalStyles);
  const standardHeight = `--button-control-height: ${STANDARD_ACTION_HEIGHT};`;
  const standardWidth = `--calendar-action-width: ${STANDARD_ACTION_WIDTH};`;
  if (!global.includes(standardHeight)) add(`el token ${standardHeight} es obligatorio`);
  if (!global.includes(standardWidth)) add(`el token ${standardWidth} es obligatorio`);

  const sharedTokens = [
    ['--button-control-padding-block', 'var(--space-2)'],
    ['--button-control-padding-inline', 'var(--space-4)'],
    ['--button-control-font-size', 'var(--text-sm)']
  ];
  for (const [property, value] of sharedTokens) {
    if (!hasDeclaration(extractRuleBodies(globalStyles, ':root')[0] ?? '', property, value)) {
      add(`:root debe definir ${property}: ${value}`);
    }
  }

  const sharedGeometry = [
    ['height', 'var(--button-control-height)'],
    ['padding', 'var(--button-control-padding-block) var(--button-control-padding-inline)'],
    ['font-size', 'var(--button-control-font-size)'],
    ['white-space', 'nowrap']
  ];
  const requiredRules = [
    [globalStyles, 'button:not([class])', 'botón base sin clase', 'global'],
    [buttonStyles, '.btn--sm, .btn--md, .btn--lg', 'app-button de texto', 'button'],
    [calendarStyles, '.cal-btn', 'botón de acción del calendario', 'calendar']
  ];
  for (const [styles, selector, label, source] of requiredRules) {
    const block = extractRuleBodies(styles, selector)[0];
    if (!block) {
      add(`falta la regla base ${selector} (${label})`, source);
      continue;
    }
    for (const [property, value] of sharedGeometry) {
      if (!hasDeclaration(block, property, value)) {
        add(`${selector} debe usar ${property}: ${value}`, source);
      }
    }
  }

  const calendarTop = extractRuleBodies(calendarStyles, '.cal-top')[0] ?? '';
  for (const [property, value] of [
    ['--cal-control-size', 'var(--button-control-height)'],
    ['--cal-control-pad-block', 'var(--button-control-padding-block)'],
    ['--cal-control-pad-inline', 'var(--button-control-padding-inline)'],
    ['--cal-control-font-size', 'var(--button-control-font-size)']
  ]) {
    if (!hasDeclaration(calendarTop, property, value)) {
      add(`.cal-top debe heredar ${property}: ${value}`, 'calendar');
    }
  }

  const actionGroup = extractRuleBodies(calendarStyles, '.calendar-event-actions')[0] ?? '';
  for (const [property, value] of [
    ['display', 'grid'],
    ['grid-template-columns', 'repeat(auto-fit, var(--calendar-action-width))'],
    ['justify-content', 'end']
  ]) {
    if (!hasDeclaration(actionGroup, property, value)) {
      add(`.calendar-event-actions debe usar ${property}: ${value}`, 'calendar');
    }
  }

  const actionButton =
    extractRuleBodies(calendarStyles, '.calendar-event-actions > .cal-btn')[0] ?? '';
  for (const [property, value] of [
    ['width', 'var(--calendar-action-width)'],
    ['height', 'var(--button-control-height)'],
    ['white-space', 'nowrap']
  ]) {
    if (!hasDeclaration(actionButton, property, value)) {
      add(`cada acción del evento debe usar ${property}: ${value}`, 'calendar');
    }
  }

  const mobileActionGroup = extractRuleBodies(calendarStyles, '.calendar-event-actions')[1] ?? '';
  if (
    !hasDeclaration(
      mobileActionGroup,
      'grid-template-columns',
      'repeat(2, var(--calendar-action-width))'
    )
  ) {
    add('el pie del evento debe conservar columnas iguales de dos en móvil', 'calendar');
  }

  for (const [styles, selector, label, source] of [
    [buttonStyles, '.btn--primary', 'app-button primario', 'button'],
    [buttonStyles, '.btn--outline', 'app-button outline', 'button'],
    [buttonStyles, '.btn--ghost', 'app-button ghost', 'button'],
    [buttonStyles, '.btn--danger', 'app-button peligro', 'button'],
    [buttonStyles, '.btn--secondary', 'app-button secundario', 'button'],
    [calendarStyles, '.cal-btn--primary', 'cal-btn primario', 'calendar'],
    [calendarStyles, '.cal-btn--danger', 'cal-btn peligro', 'calendar']
  ]) {
    for (const block of extractRuleBodies(styles, selector)) {
      if (hasAnyDimension(block)) {
        add(`${label} no puede sobrescribir geometría compartida`, source);
      }
    }
  }

  return violations;
}
