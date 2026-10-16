import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import test from 'node:test';

import { loadComponentStyles } from './check-ui-component-styles.mjs';

test('loads linked stylesheet rules for a component with styleUrls', () => {
  const componentPath = 'frontend/src/app/features/recipes/recipe-catalog-results.component.ts';
  const loadedPaths = [];
  const styles = loadComponentStyles(
    `@Component({
      template: '<button class="recipe-card__favorite">Like</button>',
      styleUrls: ['./recipe-catalog-results.component.css']
    })`,
    componentPath,
    (path) => {
      loadedPaths.push(path);
      return '.recipe-card__favorite:hover { color: red; }';
    }
  );

  assert.deepEqual(loadedPaths, [
    resolve('frontend/src/app/features/recipes/recipe-catalog-results.component.css')
  ]);
  assert.match(styles, /\.recipe-card__favorite:hover/);
});

test('supports styleUrl, multiple stylesheets, and inline styles', () => {
  const loadedPaths = [];
  const styles = loadComponentStyles(
    `@Component({
      styles: ['.inline-control:focus-visible { outline: 2px solid; }'],
      styleUrl: './first.css',
      styleUrls: ['./second.css']
    })`,
    'frontend/src/app/features/recipes/recipes.component.ts',
    (path) => {
      loadedPaths.push(path);
      return `/* ${path} */`;
    }
  );

  assert.equal(loadedPaths.length, 2);
  assert.match(styles, /\.inline-control:focus-visible/);
  assert.match(styles, /first\.css/);
  assert.match(styles, /second\.css/);
});
