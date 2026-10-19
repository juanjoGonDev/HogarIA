/** True for files that hold the core translation catalogues. */
export function isExcludedI18nCatalogPath(file) {
  return file.replace(/\\/g, '/').includes('core/i18n');
}

/** True for test-only sources that do not render user-facing text. */
export function isExcludedUiTestSupportPath(file) {
  const normalized = file.replace(/\\/g, '/');
  return normalized.endsWith('.spec.ts') || normalized.endsWith('.test-fixtures.ts');
}
