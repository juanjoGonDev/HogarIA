import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const LINKED_STYLESHEET = /styleUrls?\s*:\s*(\[[^\]]*\]|['"][^'"]+['"])/gs;
const STYLE_PATH = /['"]([^'"]+\.(?:css|scss|sass|less))['"]/g;

export function loadComponentStyles(componentSource, componentPath, read = readFileSync) {
  const styleStart = componentSource.indexOf('styles:');
  const inlineStyles = styleStart > -1 ? componentSource.slice(styleStart) : '';
  const externalStyles = [...componentSource.matchAll(LINKED_STYLESHEET)]
    .flatMap(([, references]) => [...references.matchAll(STYLE_PATH)])
    .map(([, stylePath]) => read(resolve(dirname(componentPath), stylePath), 'utf8'));

  return [inlineStyles, ...externalStyles].join('\n');
}
