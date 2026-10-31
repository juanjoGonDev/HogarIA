import { environment as development } from './environment';
import { environment as production } from './environment.prod';

describe('repository support links', () => {
  it('points development and production builds to the renamed HogarIA repository', () => {
    const expected = 'https://github.com/juanjoGonDev/HogarIA';

    expect(development.supportRepoUrl).toBe(expected);
    expect(production.supportRepoUrl).toBe(expected);
  });
});
