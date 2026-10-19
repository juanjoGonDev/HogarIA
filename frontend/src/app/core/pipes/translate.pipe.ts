import { Pipe, PipeTransform, inject } from '@angular/core';
import { I18nService } from '../services/i18n.service';
import type { TranslationKey, TranslationParams } from '../i18n';

/**
 * Uso en las plantillas:
 *   {{ 'nav.dashboard' | t }}
 *   {{ 'dashboard.greeting' | t:{name: userName()} }}
 *
 * La clave es `TranslationKey`, o sea: la lista real de textos que existen. `strictTemplates` esta
 * encendido, asi que una errata en una plantilla es un error de build y no una clave en crudo en la
 * pantalla —es la razon por la que la pipe no acepta `string`, que era como se colaba el texto a mano.
 */
@Pipe({ name: 't', standalone: true, pure: false })
export class TranslatePipe implements PipeTransform {
  private i18n = inject(I18nService);

  transform(key: TranslationKey, params?: TranslationParams): string {
    // Read the change tick so the pipe re-evaluates on language change
    this.i18n.changeTick();
    return this.i18n.t(key, params);
  }
}
