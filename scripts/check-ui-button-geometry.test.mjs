import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { findButtonGeometryViolations } from './check-ui-button-geometry.mjs';

const globalStyles = readFileSync(join(process.cwd(), 'frontend/src/styles.scss'), 'utf8');
const calendarStyles = readFileSync(
  join(process.cwd(), 'frontend/src/styles/calendar-feature.scss'),
  'utf8'
);
const buttonStyles = readFileSync(
  join(process.cwd(), 'frontend/src/app/shared/components/ui/button/button.component.ts'),
  'utf8'
);

test('la UI mantiene una geometría común y acotada para botones de acción', () => {
  assert.deepEqual(
    findButtonGeometryViolations({ globalStyles, calendarStyles, buttonStyles }),
    []
  );
});

test('mantiene la guarda de geometría en el CSS de calendario diferido', () => {
  const missingCalendarRule = calendarStyles.replaceAll('.cal-btn {', '.calendar-action {');
  const violation = findButtonGeometryViolations({
    globalStyles,
    calendarStyles: missingCalendarRule,
    buttonStyles
  }).find((item) => item.detail.includes('falta la regla base .cal-btn'));

  assert.equal(violation?.source, 'calendar');
});

test('falla si el token estándar se aumenta y genera acciones sobredimensionadas', () => {
  const oversized = globalStyles.replace(
    '--button-control-height: 44px;',
    '--button-control-height: 64px;'
  );
  assert(
    findButtonGeometryViolations({ globalStyles: oversized, calendarStyles, buttonStyles }).some(
      (violation) => violation.detail.includes('--button-control-height: 44px')
    )
  );
});

test('falla si el padding inline compartido se reduce por debajo del contrato', () => {
  const compact = globalStyles.replace(
    '--button-control-padding-inline: var(--space-4);',
    '--button-control-padding-inline: var(--space-3);'
  );
  assert(
    findButtonGeometryViolations({ globalStyles: compact, calendarStyles, buttonStyles }).some(
      (violation) => violation.detail.includes('--button-control-padding-inline: var(--space-4)')
    )
  );
});

test('falla si un variant añade dimensiones propias', () => {
  const divergent = buttonStyles.replace(/(\.btn--primary\s*\{)/, '$1\n      min-height: 64px;');
  assert(
    findButtonGeometryViolations({ globalStyles, calendarStyles, buttonStyles: divergent }).some(
      (violation) => violation.detail.includes('no puede sobrescribir geometría compartida')
    )
  );
});

test('falla si el footer del evento deja de usar tracks iguales', () => {
  const uneven = calendarStyles.replace(
    'grid-template-columns: repeat(auto-fit, var(--calendar-action-width));',
    'grid-template-columns: auto 1fr;'
  );
  assert(
    findButtonGeometryViolations({ globalStyles, calendarStyles: uneven, buttonStyles }).some(
      (violation) =>
        violation.detail.includes('.calendar-event-actions debe usar grid-template-columns')
    )
  );
});

test('falla si se elimina una familia base o el grupo móvil', () => {
  const missingGlobalRules = globalStyles
    .replace(':root {', ':root-removed {')
    .replace('button:not([class]) {', 'button.default-action {');
  const missingCalendarRules = calendarStyles
    .replaceAll('.cal-btn {', '.calendar-action {')
    .replace('.cal-top {', '.calendar-header {')
    .replaceAll('.calendar-event-actions {', '.event-actions {')
    .replace('.calendar-event-actions > .cal-btn {', '.event-actions > .cal-btn {');
  const missingButtonRule = buttonStyles.replace(
    /\.btn--sm,\s*\.btn--md,\s*\.btn--lg\s*\{/,
    '.btn--compact {'
  );

  const violations = findButtonGeometryViolations({
    globalStyles: missingGlobalRules,
    calendarStyles: missingCalendarRules,
    buttonStyles: missingButtonRule
  });
  assert(violations.some((violation) => violation.detail.includes('falta la regla base')));
  assert(violations.some((violation) => violation.detail.includes('debe heredar')));
  assert(violations.some((violation) => violation.detail.includes('en móvil')));
});
