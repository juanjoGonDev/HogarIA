import { config } from '../config/app.config.js';
import { createStoreGeocoder } from './store-geocoder.js';

/** One process-wide limiter/cache shared by ticket workers and manual receipt edits. */
export const storeGeocoder = createStoreGeocoder({
  endpoint: config.geocoding.storeEndpoint,
  userAgent: config.geocoding.storeUserAgent,
  // Resolve global fetch at request time so isolated tests can provide a synthetic endpoint.
  fetchImpl: (input, init) => fetch(input, init),
  attribution: {
    text: config.geocoding.storeAttribution,
    url: config.geocoding.storeAttributionUrl
  }
});
