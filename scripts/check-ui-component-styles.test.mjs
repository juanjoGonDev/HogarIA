import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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

test('builds household feature CSS as a lazy stylesheet instead of initial global CSS', () => {
  const angularConfig = JSON.parse(
    readFileSync(new URL('../frontend/angular.json', import.meta.url), 'utf8')
  );
  const globalStyles = readFileSync(
    new URL('../frontend/src/styles.scss', import.meta.url),
    'utf8'
  );
  const featureStyles = readFileSync(
    new URL('../frontend/src/styles/household-feature.scss', import.meta.url),
    'utf8'
  );
  const styles = angularConfig.projects.hogaria.architect.build.options.styles;
  const featureBundle = styles.find(
    (entry) => typeof entry === 'object' && entry.bundleName === 'household-feature'
  );

  assert.doesNotMatch(globalStyles, /@use\s+['"]\.\/styles\/household-(?:plan-editor|tasks)['"]/);
  assert.match(featureStyles, /@use\s+['"]\.\/household-plan-editor['"]/);
  assert.match(featureStyles, /@use\s+['"]\.\/household-tasks['"]/);
  assert.deepEqual(featureBundle, {
    input: 'src/styles/household-feature.scss',
    bundleName: 'household-feature',
    inject: false
  });
});
