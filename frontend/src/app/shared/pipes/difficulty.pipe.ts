/**
 * Dificultad de una receta: la etiqueta traducida; el color se resuelve en el componente visual.
 *
 * La logica es una funcion pura que recibe `t` por parametro —el mismo acuerdo que `describeLineDiscount`—
 * para que se pueda probar sin arbol de Angular. El pipe solo la alimenta con el servicio.
 */
import { Pipe, PipeTransform, inject } from '@angular/core';
import { I18nService } from '../../core/services/i18n.service';
import type { TranslationKey } from '../../core/i18n';

const LABEL_KEYS: Record<string, TranslationKey> = {
  easy: 'recipes.facil',
  medium: 'recipes.medio',
  hard: 'recipes.dificil'
};

export function difficultyLabel(
  value: string | null | undefined,
  t: (key: TranslationKey) => string
): string {
  if (!value) return '';
  const clave = value.toLowerCase();
  const key = LABEL_KEYS[clave];
  // Lo que no es una de las tres se pinta tal cual: es un dato que llego de fuera, no un texto que traducir.
  const label = key ? t(key) : value;
  return label;
}

@Pipe({
  name: 'difficulty',
  standalone: true
})
export class DifficultyPipe implements PipeTransform {
  private readonly i18n = inject(I18nService);

  transform(value: string | null | undefined): string {
    return difficultyLabel(value, (key) => this.i18n.t(key));
  }
}
