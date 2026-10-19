/**
 * La etiqueta de un nombre del catalogo que la app siembra en una casa nueva (despensa y utensilios).
 *
 * De donde sale: `server/src/utils/seed-data.ts` crea la despensa y el juego de utensilios con el nombre en
 * castellano, y la pantalla pinta `item.name`. En ingles se leia «Levadura» y «Sartén» dentro de una interfaz
 * por lo demas traducida, y no era una clave mal puesta: era texto del servidor pintado sin pasar por el
 * diccionario (HOGARIA-SPEC ## 12w).
 *
 * La regla, en una linea: se traduce la **lectura**, el **dato** no —lo que hay en la base de datos viaja al
 * prompt de la IA y lo reescribe la propia app al releer la lista—, y lo que **escribio una persona** tampoco:
 * un nombre que no esta en el catalogo se pinta tal cual. Por eso el mapa es `Record<string, TranslationKey>` y
 * no un tipo cerrado: lo desconocido es el caso normal, no un error.
 *
 * El pipe es impuro a proposito, como `t`: puro, Angular no lo vuelve a evaluar al cambiar de idioma y la
 * pantalla se queda con la etiqueta del idioma anterior congelada —el bug que la casa ya tenia anotado—. La
 * logica vive al lado, en `catalogLabel`, que recibe `t` por parametro y se prueba sin arbol de Angular.
 */
import { Pipe, PipeTransform, inject } from '@angular/core';
import { I18nService } from '../../core/services/i18n.service';
import { catalogLabelKey } from '../../core/i18n/labels';
import type { TranslationKey } from '../../core/i18n';

export function catalogLabel(value: string | null | undefined, t: (key: TranslationKey) => string): string {
  const clave = catalogLabelKey(value);
  return clave ? t(clave) : (value ?? '');
}

@Pipe({ name: 'catalog', standalone: true, pure: false })
export class CatalogLabelPipe implements PipeTransform {
  private readonly i18n = inject(I18nService);

  transform(value: string | null | undefined): string {
    this.i18n.changeTick();
    return catalogLabel(value, (key) => this.i18n.t(key));
  }
}
