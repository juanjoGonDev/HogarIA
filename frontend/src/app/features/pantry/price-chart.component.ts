import { Component, Input, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';

import { I18nService } from '../../core/services/i18n.service';
import { TranslatePipe } from '../../core/pipes/translate.pipe';
import { formatDateTime, formatDay } from '../../core/time';
import { formatMoney } from '../../shared/models/shopping.model';
import { caminoDe, geometria, type SerieTienda } from './precio-chart.util';

/**
 * La grafica de precios por tienda (HOGARIA-SPEC ## 12ai): una linea por tienda, el tiempo
 * abajo y los euros arriba. Sin libreria de charts a proposito —la regla de la casa es no
 * meter una dependencia por cada dibujo—: esto son cuatro escalas y un puñado de paths, y
 * la logica vive probada en `precio-chart.util.ts`.
 *
 * El SVG lleva `viewBox` y anchura al 100%: la grafica respira con la pantalla (movil
 * incluido) sin recalcular nada en JS. Cada punto lleva su `<title>` nativo —la burbuja
 * del navegador es el tooltip mas barato y el unico que funciona con teclado—.
 */
@Component({
  selector: 'app-price-chart',
  standalone: true,
  imports: [CommonModule, TranslatePipe],
  template: `
    <div class="grafica" data-test="precios-grafica">
      <ul class="grafica__leyenda">
        @for (serie of series; track $index) {
          <li class="grafica__clave">
            <span class="grafica__muestra" [style.background]="serie.color"></span>
            <span class="grafica__nombre">{{ nombreDe(serie.tienda) }}</span>
            <span class="grafica__precio">{{ dinero(serie.ultimo) }}</span>
          </li>
        }
      </ul>

      @if (geo(); as g) {
        <svg
          class="grafica__svg"
          [attr.viewBox]="'0 0 ' + g.ancho + ' ' + g.alto"
          role="img"
          [attr.aria-label]="'pantry.item_grafica_aria' | t"
          preserveAspectRatio="xMidYMid meet"
        >
          @for (marca of g.marcasY; track marca.valor) {
            <line
              class="grafica__rejilla"
              [attr.x1]="g.izq"
              [attr.x2]="g.ancho - g.der"
              [attr.y1]="marca.pos"
              [attr.y2]="marca.pos"
            />
            <text
              class="grafica__texto grafica__texto--y"
              [attr.x]="g.izq - 8"
              [attr.y]="marca.pos + 4"
              text-anchor="end"
            >
              {{ dinero(marca.valor) }}
            </text>
          }
          @for (marcaDeX of marcasXVisibles(); track $index) {
            <text
              class="grafica__texto grafica__texto--x"
              [attr.x]="marcaDeX.pos"
              [attr.y]="g.alto - 8"
              text-anchor="middle"
            >
              {{ marcaDeX.etiqueta }}
            </text>
          }
          @for (serie of series; track $index) {
            @if (serie.puntos.length > 1) {
              <path class="grafica__linea" [attr.d]="caminoDe(serie)" [attr.stroke]="serie.color" />
            }
            @for (punto of serie.puntos; track $index) {
              <circle
                class="grafica__punto"
                [attr.cx]="g.x(punto.ms)"
                [attr.cy]="g.y(punto.minor)"
                [attr.fill]="serie.color"
                r="4.5"
              >
                <title>{{ tituloDe(serie, punto) }}</title>
              </circle>
            }
          }
        </svg>
      }
    </div>
  `,
  styles: [
    `
      .grafica {
        display: flex;
        flex-direction: column;
        gap: var(--space-3);
      }
      .grafica__leyenda {
        display: flex;
        flex-wrap: wrap;
        gap: var(--space-2) var(--space-4);
        margin: 0;
        padding: 0;
        list-style: none;
      }
      .grafica__clave {
        display: inline-flex;
        align-items: center;
        gap: var(--space-2);
        font-size: var(--text-xs);
        color: var(--text-secondary);
      }
      .grafica__muestra {
        width: 10px;
        height: 10px;
        border-radius: var(--radius-full);
        flex: none;
      }
      .grafica__nombre {
        font-weight: var(--font-semibold);
        color: var(--text-primary);
      }
      .grafica__precio {
        font-variant-numeric: tabular-nums;
      }
      .grafica__svg {
        width: 100%;
        height: auto;
        display: block;
      }
      .grafica__rejilla {
        stroke: var(--border-default);
        stroke-width: 1;
        stroke-dasharray: 2 4;
      }
      .grafica__texto {
        fill: var(--text-tertiary);
        font-size: 11px;
        font-variant-numeric: tabular-nums;
      }
      .grafica__linea {
        fill: none;
        stroke-width: 2.5;
        stroke-linecap: round;
        stroke-linejoin: round;
      }
      .grafica__punto {
        stroke: var(--bg-secondary);
        stroke-width: 1.5;
      }
    `
  ]
})
export class PriceChartComponent {
  @Input({ required: true }) series: SerieTienda[] = [];

  private readonly i18n = inject(I18nService);

  readonly geo = computed(() => geometria(this.series));

  /** Las fechas del eje X, deduplicadas: dos marcas del mismo dia no aportan lectura. */
  readonly marcasXVisibles = computed(() => {
    const g = this.geo();
    if (!g) return [] as { pos: number; etiqueta: string }[];
    const vistas = new Set<string>();
    const salida: { pos: number; etiqueta: string }[] = [];
    for (const marca of g.marcasX) {
      const etiqueta = formatDay(marca.valor).replace(/ de [0-9]{4}$/, '');
      if (vistas.has(etiqueta)) continue;
      vistas.add(etiqueta);
      salida.push({ pos: marca.pos, etiqueta });
    }
    return salida;
  });

  nombreDe(tienda: string | null): string {
    return tienda ?? this.i18n.t('pantry.item_sin_tienda');
  }

  dinero(minor: number): string {
    return formatMoney(minor);
  }

  protected caminoDe(serie: SerieTienda): string {
    const g = this.geo();
    return g ? caminoDe(serie, g) : '';
  }

  protected tituloDe(serie: SerieTienda, punto: { ms: number; minor: number }): string {
    return `${this.nombreDe(serie.tienda)} — ${formatDateTime(punto.ms)} — ${formatMoney(punto.minor)}`;
  }
}
