import { skipUnavailableViewTransition } from './view-transition-utils';

describe('skipUnavailableViewTransition', () => {
  it('skips an optional transition when the browser rejects its readiness promise', async () => {
    const ready = Promise.reject(new DOMException('Viewport size changed', 'InvalidStateError'));
    const skipTransition = jasmine.createSpy('skipTransition');

    skipUnavailableViewTransition({ ready, skipTransition });
    await ready.catch(() => undefined);

    expect(skipTransition).toHaveBeenCalledTimes(1);
  });
});
