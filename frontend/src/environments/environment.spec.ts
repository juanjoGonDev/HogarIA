import { environment as development } from './environment';
import { environment as production } from './environment.prod';

describe('repository support links', () => {
  it('uses the renamed HogarIA repository in development and production', () => {
    const expected = 'https://github.com/juanjoGonDev/HogarIA';

    expect(development.supportRepoUrl).toBe(expected);
    expect(production.supportRepoUrl).toBe(expected);
  });
});
