import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { PantryService } from '../../core/services/pantry.service';
import { I18nService } from '../../core/services/i18n.service';
import { ButtonComponent } from '../../shared/components/ui/button/button.component';
import { BadgeComponent } from '../../shared/components/ui/badge/badge.component';
import { LoadingComponent } from '../../shared/components/ui/loading/loading.component';
import { TranslatePipe } from '../../core/pipes/translate.pipe';
import type { TranslationKey } from '../../core/i18n';
import { barrasDeCaducidad } from './caducidades-chart.util';
import type { CaducidadRow } from '../../shared/models/caducidades.model';

/**
 * La pantalla de caducidades (HOGARIA-SPEC ## 12ak): la despensa ordenada por lo que se tira
 * antes, con su grafica de barras y su ritmo de compra.
 *
 * El servidor ya devuelve la lista por urgencia; aqui se REORDENA en memoria al pulsar las
 * cabeceras (una despensa no da para paginar) y se pinta dos veces: como barras de «dias para
 * caducar» y como tabla con el detalle —la fecha, su origen (registrada, IA, catalogo), cada
 * cuanto se compra y cuanto dura el stock—. El boton de estimar cubre lo que no tiene ni
 * fecha ni entrada en el catalogo: primero el catalogo (gratis) y el resto por la IA local.
 */

type Columna = 'caduca' | 'nombre' | 'dura';

@Component({
  selector: 'app-caducidades',
  standalone: true,
  imports: [CommonModule, RouterLink, DatePipe, ButtonComponent, BadgeComponent, LoadingComponent, TranslatePipe],
  template: `
    <div class="cad">
      <header class="cad__head">
        <div class="cad__titular">
          <a class="cad__volver" routerLink="/pantry">
            {{ 'caducidades.volver' | t }}
          </a>
          <h1 class="cad__titulo">{{ 'caducidades.titulo' | t }}</h1>
          <p class="cad__subtitulo">{{ 'caducidades.subtitulo' | t }}</p>
        </div>
        <app-button
          variant="primary"
          type="button"
          [loading]="estimando()"
          (onClick)="estimar()"
          data-test="cad-estimar"
        >
          {{ estimando() ? ('caducidades.estimando' | t) : ('caducidades.estimar' | t) }}
        </app-button>
      </header>

      @if (estimacion(); as resultado) {
        <p class="cad__estimacion" data-test="cad-estimacion">
          {{ 'caducidades.estimacion_ok' | t: { ia: resultado.ia, catalogo: resultado.catalogo } }}
        </p>
      }
      @if (errorEstimacion(); as error) {
        <p class="cad__error" data-test="cad-error">{{ textoDeError(error) }}</p>
      }

      @if (service.cargandoCaducidades()) {
        <app-loading />
      } @else if (service.caducidadesError()) {
        <section class="cad__error-carga" data-test="cad-error-carga">
          <p class="cad__error" role="alert">{{ 'caducidades.carga_error' | t }}</p>
          <app-button
            variant="primary"
            type="button"
            [touchTarget]="true"
            (onClick)="service.loadCaducidades()"
            data-test="cad-reintentar"
          >
            {{ 'caducidades.reintentar' | t }}
          </app-button>
        </section>
      } @else if (filas().length === 0) {
        <div class="cad__vacio" data-test="cad-vacio">
          <span class="cad__vacio-titulo">{{ 'caducidades.vacio' | t }}</span>
          <span class="cad__vacio-hint">{{ 'caducidades.vacio_hint' | t }}</span>
        </div>
      } @else {
        <div class="cad__resumen" data-test="cad-resumen">
          <span class="cad__chip cad__chip--caducado">{{ 'caducidades.resumen_caducados' | t: { n: resumen().caducados } }}</span>
          <span class="cad__chip cad__chip--semana">{{ 'caducidades.resumen_semana' | t: { n: resumen().semana } }}</span>
          <span class="cad__chip">{{ 'caducidades.resumen_estimadas' | t: { n: resumen().estimadas } }}</span>
          <span class="cad__chip">{{ 'caducidades.resumen_sin_fecha' | t: { n: resumen().sinFecha } }}</span>
        </div>

        @if (resumen().sinFecha === filas().length) {
          <p class="cad__hint">{{ 'caducidades.sin_nada_hint' | t }}</p>
        }

        <!-- La grafica: una barra por producto, el color del semaforo, el ≈ de lo estimado. -->
        <section class="cad__grafica" [attr.aria-label]="'caducidades.grafica' | t" data-test="cad-grafica">
          <header class="cad__grafica-head">
            <span class="cad__grafica-titulo">{{ 'caducidades.grafica' | t }}</span>
            <span class="cad__grafica-hint">{{ 'caducidades.grafica_hint' | t }}</span>
          </header>
          <ul class="cad__barras">
            @for (barra of barras().barras; track barra.nombre) {
              <li class="cad-barra">
                <span class="cad-barra__nombre" [title]="barra.nombre">{{ barra.nombre }}</span>
                <span class="cad-barra__pista">
                  <span
                    class="cad-barra__relleno"
                    [class]="'cad-barra__relleno--' + barra.urgencia"
                    [style.width.%]="barra.anchura"
                  ></span>
                </span>
                <span class="cad-barra__dias" [class]="'cad-barra__dias--' + barra.urgencia">{{
                  textoDeDias(barra.dias, barra.estimada)
                }}</span>
              </li>
            }
          </ul>
          @if (barras().sobran > 0) {
            <span class="cad__grafica-mas">{{ 'caducidades.y_n_mas' | t: { n: barras().sobran } }}</span>
          }
        </section>

        <!-- La tabla: ordenable por caducidad, nombre o duracion del stock. -->
        <div class="cad-tabla" role="table" data-test="cad-tabla">
          <div class="cad-tabla__head" role="row">
            <button
              type="button"
              class="cad-tabla__orden"
              [attr.aria-label]="'caducidades.ordenar_por' | t: { columna: ('caducidades.producto' | t) }"
              (click)="ordenarPor('nombre')"
              data-test="cad-orden-nombre"
            >
              {{ 'caducidades.producto' | t }} @if (columna() === 'nombre') {
                <span class="cad-tabla__flecha">{{ ascendente() ? '▲' : '▼' }}</span>
              }
            </button>
            <button
              type="button"
              class="cad-tabla__orden"
              [attr.aria-label]="'caducidades.ordenar_por' | t: { columna: ('caducidades.caduca' | t) }"
              (click)="ordenarPor('caduca')"
              data-test="cad-orden-caduca"
            >
              {{ 'caducidades.caduca' | t }} @if (columna() === 'caduca') {
                <span class="cad-tabla__flecha">{{ ascendente() ? '▲' : '▼' }}</span>
              }
            </button>
            <span class="cad-tabla__celda">{{ 'caducidades.origen' | t }}</span>
            <span class="cad-tabla__celda">{{ 'caducidades.ritmo' | t }}</span>
            <button
              type="button"
              class="cad-tabla__orden"
              [attr.aria-label]="'caducidades.ordenar_por' | t: { columna: ('caducidades.dura' | t) }"
              (click)="ordenarPor('dura')"
              data-test="cad-orden-dura"
            >
              {{ 'caducidades.dura' | t }} @if (columna() === 'dura') {
                <span class="cad-tabla__flecha">{{ ascendente() ? '▲' : '▼' }}</span>
              }
            </button>
          </div>
          @for (fila of filas(); track fila.id) {
            <div class="cad-tabla__fila" role="row" [attr.data-test]="'cad-fila-' + fila.name">
              <span class="cad-tabla__celda cad-tabla__celda--nombre" role="cell">
                <span class="cad-tabla__nombre">{{ fila.name }}</span>
                <span class="cad-tabla__cantidad">{{ fila.quantity }} {{ fila.unit || '' }}</span>
              </span>
              <span class="cad-tabla__celda" role="cell">
                @if (fila.vence; as cuando) {
                  <span class="cad-tabla__fecha">{{ cuando | date: 'dd/MM/yyyy' }}</span>
                }
                <span class="cad-tabla__dias" [class]="'cad-tabla__dias--' + urgencia(fila)">{{
                  textoDeDias(fila.daysLeft, fila.shelfSource !== 'fecha' && fila.daysLeft !== null)
                }}</span>
              </span>
              <span class="cad-tabla__celda" role="cell">
                <app-badge [variant]="varianteDeOrigen(fila)">{{ claveDeOrigen(fila) | t }}</app-badge>
              </span>
              <span class="cad-tabla__celda" role="cell">
                @if (fila.cadaDias !== null) {
                  <span class="cad-tabla__ritmo">
                    {{ 'caducidades.cada_n_dias' | t: { n: fila.cadaDias } }}
                    @if (fila.unidadesPorCompra !== null) {
                      · {{ 'caducidades.de_n_en_n' | t: { n: fila.unidadesPorCompra } }}
                    }
                  </span>
                } @else {
                  <span class="cad-tabla__ritmo cad-tabla__ritmo--vacio">{{ 'caducidades.sin_datos' | t }}</span>
                }
              </span>
              <span class="cad-tabla__celda" role="cell">
                @if (fila.duraDias !== null) {
                  {{ 'caducidades.dura_n_dias' | t: { n: fila.duraDias } }}
                } @else {
                  <span class="cad-tabla__ritmo--vacio">{{ 'caducidades.sin_datos' | t }}</span>
                }
              </span>
            </div>
          }
        </div>
      }
    </div>
  `,
  styles: [
    `
      .cad {
        display: grid;
        gap: var(--space-4, 16px);
        max-width: 860px;
        margin: 0 auto;
        padding-block: var(--container-padding);
      }

      .cad__head {
        display: flex;
        flex-wrap: wrap;
        align-items: flex-end;
        justify-content: space-between;
        gap: var(--space-3, 12px);
      }

      .cad__titular {
        display: grid;
        gap: 4px;
      }

      .cad__volver {
        font-size: var(--text-sm, 14px);
        color: var(--text-secondary);
        text-decoration: none;
        width: fit-content;
      }

      .cad__volver:hover {
        color: var(--text-primary);
      }

      .cad__titulo {
        margin: 0;
        font-size: var(--text-2xl, 24px);
        font-weight: var(--font-bold, 700);
        color: var(--text-primary);
      }

      .cad__subtitulo {
        margin: 0;
        max-width: 52ch;
        font-size: var(--text-sm, 14px);
        color: var(--text-secondary);
      }

      .cad__estimacion {
        margin: 0;
        padding: var(--space-2, 8px) var(--space-3, 12px);
        border-radius: var(--radius-md, 10px);
        background: var(--success-subtle, #e8f5ec);
        color: var(--success);
        font-size: var(--text-sm, 14px);
      }

      .cad__error {
        margin: 0;
        padding: var(--space-2, 8px) var(--space-3, 12px);
        border-radius: var(--radius-md, 10px);
        background: rgba(220, 38, 38, 0.08);
        color: var(--danger);
        font-size: var(--text-sm, 14px);
      }

      .cad__error-carga {
        display: grid;
        justify-items: start;
        gap: var(--space-3, 12px);
      }

      .cad__vacio {
        display: grid;
        gap: 4px;
        padding: var(--space-8, 40px) 0;
        text-align: center;
      }

      .cad__vacio-titulo {
        font-size: var(--text-base, 16px);
        font-weight: var(--font-medium, 500);
        color: var(--text-primary);
      }

      .cad__vacio-hint {
        font-size: var(--text-sm, 14px);
        color: var(--text-secondary);
      }

      .cad__resumen {
        display: flex;
        flex-wrap: wrap;
        gap: var(--space-2, 8px);
      }

      .cad__chip {
        padding: 4px var(--space-3, 12px);
        border-radius: var(--radius-full, 999px);
        background: var(--bg-tertiary);
        color: var(--text-secondary);
        font-size: var(--text-xs, 12px);
        font-weight: var(--font-medium, 500);
      }

      .cad__chip--caducado {
        background: rgba(220, 38, 38, 0.08);
        color: var(--danger);
      }

      .cad__chip--semana {
        background: var(--warning-subtle, #fdf3e4);
        color: var(--warning);
      }

      .cad__hint {
        margin: 0;
        font-size: var(--text-xs, 12px);
        color: var(--text-tertiary);
      }

      .cad__grafica {
        display: grid;
        gap: var(--space-2, 8px);
        padding: var(--space-4, 16px);
        border: 1px solid var(--border-default);
        border-radius: var(--radius-lg, 12px);
        background: var(--bg-primary);
      }

      .cad__grafica-head {
        display: grid;
        gap: 2px;
      }

      .cad__grafica-titulo {
        font-size: var(--text-sm, 14px);
        font-weight: var(--font-semibold, 600);
        color: var(--text-primary);
      }

      .cad__grafica-hint {
        font-size: var(--text-xs, 12px);
        color: var(--text-tertiary);
      }

      .cad__barras {
        list-style: none;
        margin: 0;
        padding: 0;
        display: grid;
        gap: var(--space-2, 8px);
      }

      .cad-barra {
        display: grid;
        grid-template-columns: minmax(90px, 160px) 1fr 72px;
        align-items: center;
        gap: var(--space-2, 8px);
      }

      .cad-barra__nombre {
        font-size: var(--text-xs, 12px);
        color: var(--text-primary);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .cad-barra__pista {
        height: 10px;
        border-radius: var(--radius-full, 999px);
        background: var(--bg-tertiary);
        overflow: hidden;
      }

      .cad-barra__relleno {
        display: block;
        height: 100%;
        border-radius: var(--radius-full, 999px);
        transition: width 0.25s ease;
      }

      .cad-barra__relleno--caducado,
      .cad-barra__relleno--critico {
        background: var(--danger);
      }

      .cad-barra__relleno--semana {
        background: var(--warning);
      }

      .cad-barra__relleno--quincena {
        background: color-mix(in srgb, var(--warning) 45%, var(--bg-tertiary));
      }

      .cad-barra__relleno--lejos {
        background: var(--success);
      }

      .cad-barra__relleno--sin {
        background: var(--border-strong);
      }

      .cad-barra__dias {
        font-size: var(--text-xs, 12px);
        font-weight: var(--font-medium, 500);
        color: var(--text-secondary);
        text-align: right;
      }

      .cad-barra__dias--caducado,
      .cad-barra__dias--critico {
        color: var(--danger);
      }

      .cad-barra__dias--semana {
        color: var(--warning);
      }

      .cad__grafica-mas {
        font-size: var(--text-xs, 12px);
        color: var(--text-tertiary);
      }

      .cad-tabla {
        border: 1px solid var(--border-default);
        border-radius: var(--radius-lg, 12px);
        overflow-x: auto;
        background: var(--bg-primary);
      }

      .cad-tabla__head,
      .cad-tabla__fila {
        display: grid;
        grid-template-columns: minmax(150px, 2fr) minmax(120px, 1fr) 96px minmax(150px, 1.2fr) minmax(90px, 0.8fr);
        gap: var(--space-2, 8px);
        align-items: center;
        padding: var(--space-2, 8px) var(--space-3, 12px);
        min-width: 620px;
      }

      .cad-tabla__head {
        background: var(--bg-tertiary);
        font-size: var(--text-xs, 12px);
        font-weight: var(--font-semibold, 600);
        text-transform: uppercase;
        letter-spacing: 0.03em;
        color: var(--text-secondary);
      }

      .cad-tabla__orden {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        border: none;
        background: transparent;
        padding: 0;
        font: inherit;
        color: inherit;
        text-transform: inherit;
        letter-spacing: inherit;
        cursor: pointer;
      }

      .cad-tabla__orden:hover {
        color: var(--text-primary);
      }

      .cad-tabla__flecha {
        font-size: 10px;
      }

      .cad-tabla__fila {
        border-top: 1px solid var(--border-default);
      }

      .cad-tabla__celda {
        display: grid;
        gap: 2px;
        font-size: var(--text-sm, 14px);
        color: var(--text-primary);
        min-width: 0;
      }

      .cad-tabla__celda--nombre {
        gap: 0;
      }

      .cad-tabla__nombre {
        font-weight: var(--font-medium, 500);
        overflow-wrap: anywhere;
      }

      .cad-tabla__cantidad {
        font-size: var(--text-xs, 12px);
        color: var(--text-tertiary);
      }

      .cad-tabla__fecha {
        font-size: var(--text-xs, 12px);
        color: var(--text-secondary);
      }

      .cad-tabla__dias {
        font-weight: var(--font-medium, 500);
      }

      .cad-tabla__dias--caducado,
      .cad-tabla__dias--critico {
        color: var(--danger);
      }

      .cad-tabla__dias--semana {
        color: var(--warning);
      }

      .cad-tabla__dias--sin {
        color: var(--text-tertiary);
      }

      .cad-tabla__ritmo {
        font-size: var(--text-sm, 14px);
        color: var(--text-primary);
      }

      .cad-tabla__ritmo--vacio {
        color: var(--text-tertiary);
      }

      @media (max-width: 640px) {
        .cad-barra {
          grid-template-columns: minmax(70px, 110px) 1fr 60px;
        }
      }
    `
  ]
})
export class CaducidadesComponent implements OnInit {
  readonly service = inject(PantryService);
  private readonly i18n = inject(I18nService);

  readonly estimando = signal(false);
  readonly estimacion = signal<{ ia: number; catalogo: number } | null>(null);
  readonly errorEstimacion = signal<'NO_CONFIG' | 'BAD_JSON' | 'ERROR' | null>(null);

  readonly columna = signal<Columna>('caduca');
  readonly ascendente = signal(true);

  /** La lista reordenada al pulsar las cabeceras; el server la manda ya por urgencia. */
  readonly filas = computed<CaducidadRow[]>(() => {
    const filas = [...this.service.caducidades()];
    const columna = this.columna();
    const signo = this.ascendente() ? 1 : -1;
    return filas.sort((a, b) => {
      if (columna === 'nombre') return signo * a.name.localeCompare(b.name, 'es');
      if (columna === 'dura') {
        const [x, y] = [a.duraDias ?? -1, b.duraDias ?? -1];
        return signo * (x - y) || a.name.localeCompare(b.name, 'es');
      }
      // caduca: lo que no sabe cuando vence cierra, no abre.
      if (a.daysLeft === null && b.daysLeft === null) return signo * a.name.localeCompare(b.name, 'es');
      if (a.daysLeft === null) return 1;
      if (b.daysLeft === null) return -1;
      return signo * (a.daysLeft - b.daysLeft) || a.name.localeCompare(b.name, 'es');
    });
  });

  readonly resumen = computed(() => {
    const filas = this.service.caducidades();
    return {
      caducados: filas.filter((fila) => fila.daysLeft !== null && fila.daysLeft < 0).length,
      semana: filas.filter((fila) => fila.daysLeft !== null && fila.daysLeft >= 0 && fila.daysLeft <= 7).length,
      estimadas: filas.filter((fila) => fila.shelfSource === 'ia' || fila.shelfSource === 'catalogo').length,
      sinFecha: filas.filter((fila) => fila.daysLeft === null).length
    };
  });

  readonly barras = computed(() => barrasDeCaducidad(this.service.caducidades()));

  ngOnInit(): void {
    this.service.loadCaducidades();
  }

  ordenarPor(columna: Columna): void {
    if (this.columna() === columna) {
      this.ascendente.update((valor) => !valor);
    } else {
      this.columna.set(columna);
      this.ascendente.set(true);
    }
  }

  urgencia(fila: CaducidadRow): string {
    if (fila.daysLeft === null) return 'sin';
    if (fila.daysLeft < 0) return 'caducado';
    if (fila.daysLeft <= 3) return 'critico';
    if (fila.daysLeft <= 7) return 'semana';
    if (fila.daysLeft <= 14) return 'quincena';
    return 'lejos';
  }

  claveDeOrigen(fila: CaducidadRow): TranslationKey {
    const claves: Record<string, TranslationKey> = {
      fecha: 'caducidades.origen.fecha',
      ia: 'caducidades.origen.ia',
      catalogo: 'caducidades.origen.catalogo'
    };
    return claves[fila.shelfSource ?? ''] ?? 'caducidades.origen.nada';
  }

  varianteDeOrigen(fila: CaducidadRow): 'primary' | 'secondary' | 'success' | 'neutral' {
    if (fila.shelfSource === 'fecha') return 'secondary';
    if (fila.shelfSource === 'ia') return 'primary';
    if (fila.shelfSource === 'catalogo') return 'success';
    return 'neutral';
  }

  textoDeDias(dias: number | null, estimada: boolean): string {
    if (dias === null) return this.i18n.t('caducidades.sin_datos');
    if (dias === 0) return this.i18n.t('caducidades.caduca_hoy');
    if (dias < 0) return this.i18n.t('caducidades.caducado_hace', { n: Math.abs(dias) });
    const clave: TranslationKey = estimada ? 'caducidades.estimado_en_n_dias' : 'caducidades.en_n_dias';
    return this.i18n.t(clave, { n: dias });
  }

  textoDeError(error: 'NO_CONFIG' | 'BAD_JSON' | 'ERROR'): string {
    // Mensajes propios, no los de receipts: aqui la IA no lee fotos, estima vidas utiles.
    if (error === 'NO_CONFIG') return this.i18n.t('caducidades.error_sin_ia');
    if (error === 'BAD_JSON') return this.i18n.t('caducidades.error_json');
    return this.i18n.t('caducidades.error');
  }

  async estimar(): Promise<void> {
    if (this.estimando()) return;
    this.estimando.set(true);
    this.errorEstimacion.set(null);
    this.estimacion.set(null);
    const resultado = await this.service.estimarCaducidades();
    this.estimando.set(false);
    if ('error' in resultado && resultado.error) {
      this.errorEstimacion.set(resultado.error);
      return;
    }
    if ('ia' in resultado) {
      this.estimacion.set({ ia: resultado.ia, catalogo: resultado.catalogo });
      this.service.loadCaducidades();
    }
  }
}
