/**
 * La etiqueta de una categoria del inventario, en el idioma activo (HOGARIA-SPEC ## 12x).
 *
 * Es el mismo acuerdo que `catalog` para los nombres sembrados: se traduce la lectura, no el dato. Una
 * categoria de fabrica con su nombre de fabrica se pinta con su clave del diccionario; en cuanto la casa la
 * renombra —o cuando la categoria la creo la casa—, se pinta lo que esa persona escribio, porque ese texto es
 * suyo y la pantalla no tiene derecho a corregirlo.
 *
 * Impuro a proposito, como `t` y como `catalog`: puro, Angular no lo reevalua al cambiar de idioma y la lista
 * se queda con la etiqueta del idioma anterior congelada.
 */
import { Pipe, PipeTransform, inject } from '@angular/core';
import { I18nService } from '../../core/services/i18n.service';
import { pantryCategoryLabel } from '../../core/i18n/labels';

@Pipe({ name: 'category', standalone: true, pure: false })
export class PantryCategoryLabelPipe implements PipeTransform {
  private readonly i18n = inject(I18nService);

  transform(value: { key?: string | null; name?: string | null } | string | null | undefined): string {
    this.i18n.changeTick();
    return pantryCategoryLabel(value, (key) => this.i18n.t(key));
  }
}
