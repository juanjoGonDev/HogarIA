import { HttpContext } from '@angular/common/http';
import { SILENT_TOAST } from '../interceptors/error.interceptor';

/** The photo sheet renders request failures inline, so suppress the duplicate global toast. */
export function photoAnalysisHttpContext(): HttpContext {
  return new HttpContext().set(SILENT_TOAST, true);
}
