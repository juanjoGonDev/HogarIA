import { shoppingStreamPath } from './shopping-stream-path';

describe('shoppingStreamPath', () => {
  it('selects the tray endpoint when there is no list ID', () => {
    expect(shoppingStreamPath(null)).toBe('tray');
  });

  it('preserves the list detail endpoint for a concrete ID', () => {
    expect(shoppingStreamPath('list-qa-1')).toBe('lists/list-qa-1');
  });
});
