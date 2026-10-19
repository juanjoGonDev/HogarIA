import { SILENT_TOAST } from '../interceptors/error.interceptor';
import { photoAnalysisHttpContext } from './shopping-photo-http-context';

describe('photoAnalysisHttpContext', () => {
  it('marks photo analysis errors for inline handling instead of a global toast', () => {
    expect(photoAnalysisHttpContext().get(SILENT_TOAST)).toBeTrue();
  });
});
