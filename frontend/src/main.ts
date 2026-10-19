import { bootstrapApplication } from '@angular/platform-browser';
import { AppComponent } from './app/app.component';
import { appConfig } from './app/app.config';
import { installConsoleForwarder } from './app/core/interceptors/console-forwarder';
import { migrateLegacyStorage } from './app/core/services/storage.service';

// RecipeApp/MiCocinAI -> HogarIA: el estado local se reubica antes de leerlo.
migrateLegacyStorage();

// Forward browser console errors to server terminal
installConsoleForwarder();

bootstrapApplication(AppComponent, appConfig)
  .catch((err) => console.error(err));
