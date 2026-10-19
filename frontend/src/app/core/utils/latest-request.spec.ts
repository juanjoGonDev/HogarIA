import { LatestRequest } from './latest-request';

describe('LatestRequest', () => {
  it('marks only the most recently started request as current', () => {
    const requests = new LatestRequest();
    const earlier = requests.begin();
    const latest = requests.begin();

    expect(earlier).toBeLessThan(latest);
    expect(requests.isCurrent(earlier)).toBeFalse();
    expect(requests.isCurrent(latest)).toBeTrue();
  });
});
