import { Component, OnInit, computed, effect, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';

import { PantryService } from '../../core/services/pantry.service';
import { ShoppingService } from '../../core/services/shopping.service';
import { ToastService } from '../../core/services/toast.service';
import { ConfirmService } from '../../core/services/confirm.service';
import { I18nService } from '../../core/services/i18n.service';
import type { TranslationKey } from '../../core/i18n';
import { TranslatePipe } from '../../core/pipes/translate.pipe';
import { IconComponent } from '../../shared/components/ui/icon/icon.component';
import { BadgeComponent } from '../../shared/components/ui/badge/badge.component';
import { TagComponent } from '../../shared/components/ui/tag/tag.component';
import { TooltipComponent } from '../../shared/components/ui/tooltip/tooltip.component';
import { CatalogLabelPipe } from '../../shared/pipes/catalog-label.pipe';
import { syncTabWithUrl } from '../../core/utils/tab-url';
import { daysUntil, formatDateTime } from '../../core/time';
import {
  productKeyOf,
  formatMoney,
  type PriceObservation
} from '../../shared/models/shopping.model';
import type { PantryProduct } from '../../shared/models/pantry.model';
import { colorDeCategoria } from './pantry-gestor.util';
import { seriesPorTienda, type SerieTienda } from './precio-chart.util';
import { PriceChartComponent } from './price-chart.component';
import { PantryProductImageEditorComponent } from './pantry-product-image-editor.component';

type ItemTab = 'detalles' | 'precios';

/**
 * La ficha del articulo de inventario (HOGARIA-SPEC ## 12ai).
 *
 * La tabla de la despensa dice QUE hay; aqui se dice QUE ES: sus caracteristicas, su caducidad,
 * sus alias, su huella en la cesta —y su historia de precios por tienda, con grafica. Todo en
 * una URL propia (`/pantry/inventario/:id`) porque un F5 a media lectura no puede tirar la
 * pantalla, y con la pestana en la query (`?tab=precios`) porque enlazar «lo que cuesta alla»
 * es la mitad de la gracia de tener la historia.
 *
 * Lo que esta pantalla NO hace: mover el stock (eso vive en la despensa, con sus motivos) ni
 * editar la ficha (eso vive en su propia pantalla, `inventario/:id/editar`).
 */
@Component({
  selector: 'app-pantry-item',
  standalone: true,
  imports: [
    CommonModule,
    RouterLink,
    TranslatePipe,
    IconComponent,
    BadgeComponent,
    TagComponent,
    TooltipComponent,
    PriceChartComponent,
    CatalogLabelPipe,
    PantryProductImageEditorComponent
  ],
  template: `
    <div class="item">
      <a routerLink="/pantry" class="item__volver" data-test="item-volver">
        <app-icon name="chevron_left" [size]="16" [label]="null" />
        <span>{{ 'pantry.item_volver' | t }}</span>
      </a>

      @if (item(); as art) {
        <header class="item__cabecera">
          <div class="item__identidad">
            <span class="item__punto" [style.background]="colorDe(art)" aria-hidden="true"></span>
            <div class="item__titular">
              <h1 class="item__nombre">{{ art.name | catalog }}</h1>
              <p class="item__clase">{{ etiquetaCategoria(art) }}</p>
            </div>
          </div>
          <div class="item__estado">
            <app-badge [variant]="art.inPantry ? 'success' : 'neutral'" size="md">
              {{ art.quantity }} {{ art.unit }}
            </app-badge>
            <app-badge variant="secondary" size="md">{{
              etiquetaUbicacion(art.location)
            }}</app-badge>
            @if (estado(art); as e) {
              <app-badge [variant]="e.variant" size="md">{{ e.label }}</app-badge>
            }
          </div>
          <div class="item__acciones">
            <a
              class="item__editar"
              [routerLink]="['/pantry', 'inventario', art.id, 'editar']"
              data-test="item-editar"
            >
              <app-icon name="edit" [size]="16" [label]="null" />
              <span>{{ 'pantry.item_editar' | t }}</span>
            </a>
          </div>
        </header>

        @if (!art.inPantry) {
          <p class="item__aviso" data-test="item-basico">{{ 'pantry.item_basico' | t }}</p>
        }

        <nav class="item__tabs" role="tablist" [attr.aria-label]="'pantry.item_tabs_aria' | t">
          <button
            type="button"
            class="item__tab"
            role="tab"
            [class.item__tab--on]="tab() === 'detalles'"
            [attr.aria-selected]="tab() === 'detalles'"
            data-test="item-tab-detalles"
            (click)="tab.set('detalles')"
          >
            {{ 'pantry.item_tab_detalles' | t }}
          </button>
          <button
            type="button"
            class="item__tab"
            role="tab"
            [class.item__tab--on]="tab() === 'precios'"
            [attr.aria-selected]="tab() === 'precios'"
            data-test="item-tab-precios"
            (click)="tab.set('precios')"
          >
            {{ 'pantry.item_tab_precios' | t }}
            @if (series().length > 0) {
              <span class="item__tab-n">{{ precios().length }}</span>
            }
          </button>
        </nav>

        @if (tab() === 'detalles') {
          <section class="item__ficha" data-test="item-detalles">
            <dl class="item__rasgos">
              <div class="item__rasgo">
                <dt class="item__rasgo-etq">{{ 'pantry.categoria' | t }}</dt>
                <dd class="item__rasgo-val">
                  <span
                    class="item__punto item__punto--sm"
                    [style.background]="colorDe(art)"
                  ></span>
                  {{ etiquetaCategoria(art) }}
                </dd>
              </div>
              <div class="item__rasgo">
                <dt class="item__rasgo-etq">{{ 'pantry.unidad' | t }}</dt>
                <dd class="item__rasgo-val">{{ art.unit }}</dd>
              </div>
              <div class="item__rasgo">
                <dt class="item__rasgo-etq">{{ 'pantry.ubicacion' | t }}</dt>
                <dd class="item__rasgo-val">{{ etiquetaUbicacion(art.location) }}</dd>
              </div>
              <div class="item__rasgo">
                <dt class="item__rasgo-etq">{{ 'pantry.item_caducidad' | t }}</dt>
                <dd class="item__rasgo-val">
                  @if (art.expirationDate) {
                    {{ art.expirationDate | date: 'dd/MM/yyyy' }}
                  } @else {
                    <span class="item__rasgo-mudo">{{ 'pantry.item_sin_caducidad' | t }}</span>
                  }
                </dd>
              </div>
              <div class="item__rasgo">
                <dt class="item__rasgo-etq">{{ 'pantry.item_codigo_barras' | t }}</dt>
                <dd class="item__rasgo-val item__rasgo-val--mono">
                  @if (art.barcode) {
                    {{ art.barcode }}
                  } @else {
                    <span class="item__rasgo-mudo">—</span>
                  }
                </dd>
              </div>
              <div class="item__rasgo">
                <dt class="item__rasgo-etq">{{ 'pantry.item_registrado' | t }}</dt>
                <dd class="item__rasgo-val">{{ cuando(art.createdAt) }}</dd>
              </div>
              <div class="item__rasgo">
                <dt class="item__rasgo-etq">{{ 'pantry.item_actualizado' | t }}</dt>
                <dd class="item__rasgo-val">{{ cuando(art.updatedAt) }}</dd>
              </div>
              <div class="item__rasgo">
                <dt class="item__rasgo-etq">{{ 'pantry.aliases' | t }}</dt>
                <dd class="item__rasgo-val">
                  @if (art.aliases.length === 0) {
                    <span class="item__rasgo-mudo">—</span>
                  } @else {
                    <span class="item__alias">
                      @for (alias of art.aliases; track alias) {
                        <app-tag>{{ alias }}</app-tag>
                      }
                    </span>
                  }
                </dd>
              </div>
            </dl>

            <app-pantry-product-image-editor [producto]="art" (imageChange)="actualizarImagen($event)" />

            @if (art.notes) {
              <div class="item__nota">
                <span class="item__rasgo-etq">{{ 'pantry.notas_producto' | t }}</span>
                <p class="item__nota-texto">{{ art.notes }}</p>
              </div>
            }

            <p class="item__huella" data-test="item-huella">
              <span>{{ 'pantry.lineas_de_cesta' | t: { n: art.impact.listLines } }}</span>
              <span class="item__huella-sep" aria-hidden="true">·</span>
              <span>{{
                'pantry.observaciones_precio' | t: { n: art.impact.priceObservations }
              }}</span>
            </p>
          </section>
        } @else {
          <section class="item__precios" data-test="item-precios">
            @if (preciosCargando()) {
              <p class="item__cargando">{{ 'pantry.item_cargando_precios' | t }}</p>
            } @else if (series().length === 0) {
              <div class="item__vacio" data-test="item-precios-vacio">
                <app-icon name="receipt_long" [size]="28" [label]="null" />
                <p class="item__vacio-titulo">{{ 'pantry.item_precios_vacio' | t }}</p>
                <p class="item__vacio-texto">{{ 'pantry.item_precios_vacio_texto' | t }}</p>
              </div>
            } @else {
              <ul class="item__tiendas">
                @for (serie of series(); track serie.tienda ?? '') {
                  <li class="item__tienda" data-test="item-tienda">
                    <span class="item__tienda-muestra" [style.background]="serie.color"></span>
                    <div class="item__tienda-cuerpo">
                      <p class="item__tienda-nombre">{{ nombreTienda(serie.tienda) }}</p>
                      <p class="item__tienda-cifras">
                        <span class="item__tienda-precio">{{ dinero(serie.ultimo) }}</span>
                        <span class="item__tienda-por">{{ 'pantry.item_por_unidad' | t }}</span>
                      </p>
                      <p class="item__tienda-meta">
                        {{ 'pantry.item_media' | t }} {{ dinero(serie.media) }} ·
                        {{ serie.observaciones }} {{ 'pantry.item_observaciones' | t }}
                      </p>
                    </div>
                  </li>
                }
              </ul>

              <div class="item__grafica">
                <h2 class="item__grafica-titulo">{{ 'pantry.item_grafica' | t }}</h2>
                <app-price-chart [series]="series()" />
              </div>

              <div class="item__historial">
                <h2 class="item__grafica-titulo">{{ 'pantry.item_historial' | t }}</h2>
                <ul class="item__tabla">
                  <li class="item__fila item__fila--cab">
                    <span>{{ 'pantry.item_fecha' | t }}</span>
                    <span>{{ 'pantry.item_tienda' | t }}</span>
                    <span class="item__fila--fin">{{ 'pantry.item_pagado' | t }}</span>
                    <span class="item__fila--fin"></span>
                  </li>
                  @for (obs of precios(); track obs.id) {
                    <li class="item__fila" [attr.data-test]="'item-precio-' + obs.id">
                      <span class="item__fila-fecha">{{ cuando(obs.observed_at) }}</span>
                      <span class="item__fila-tienda">{{
                        nombreTienda(obs.store_name?.trim() || null)
                      }}</span>
                      <span class="item__fila--fin item__fila-pago">
                        {{ dinero(obs.price_minor) }}
                        @if (obs.quantity > 1) {
                          <span class="item__fila-pack"
                            >× {{ obs.quantity }} = {{ dinero(porUnidad(obs)) }}</span
                          >
                        }
                      </span>
                      <span class="item__fila--fin">
                        <app-tooltip position="left" [text]="'pantry.item_quitar_precio' | t">
                          <button
                            type="button"
                            class="item__quitar"
                            [attr.aria-label]="'pantry.item_quitar_precio' | t"
                            (click)="quitarPrecio(obs)"
                          >
                            <app-icon name="delete" [size]="15" [label]="null" />
                          </button>
                        </app-tooltip>
                      </span>
                    </li>
                  }
                </ul>
              </div>
            }
          </section>
        }
      } @else if (fallo()) {
        <div class="item__vacio" data-test="item-no-encontrado">
          <app-icon name="search" [size]="28" [label]="null" />
          <p class="item__vacio-titulo">{{ 'pantry.item_no_encontrado' | t }}</p>
          <p class="item__vacio-texto">{{ 'pantry.item_no_encontrado_texto' | t }}</p>
          <a routerLink="/pantry" class="item__editar">{{ 'pantry.item_volver' | t }}</a>
        </div>
      } @else {
        <p class="item__cargando">{{ 'pantry.item_cargando' | t }}</p>
      }
    </div>
  `,
  styles: [
    `
      .item {
        display: flex;
        flex-direction: column;
        gap: var(--space-5);
        max-width: 880px;
        margin: 0 auto;
        padding-block: var(--container-padding);
      }
      .item__volver {
        display: inline-flex;
        align-items: center;
        gap: var(--space-2);
        align-self: flex-start;
        font-size: var(--text-sm);
        font-weight: var(--font-semibold);
        color: var(--text-secondary);
        text-decoration: none;
        padding: var(--space-1) var(--space-2) var(--space-1) var(--space-1);
        border-radius: var(--radius-md);
        transition: var(--transition-fast);
      }
      .item__volver:hover {
        color: var(--primary-dark);
        background: var(--bg-tertiary);
      }

      /* ── cabecera ── */
      .item__cabecera {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--space-4);
        background: var(--bg-secondary);
        border: 1px solid var(--border-default);
        border-radius: var(--radius-xl);
        box-shadow: var(--shadow-sm);
        padding: var(--space-5) var(--space-6);
      }
      .item__identidad {
        display: flex;
        align-items: center;
        gap: var(--space-3);
        flex: 1 1 260px;
        min-width: 0;
      }
      .item__punto {
        width: 14px;
        height: 14px;
        border-radius: var(--radius-full);
        flex: none;
      }
      .item__punto--sm {
        width: 10px;
        height: 10px;
      }
      .item__titular {
        min-width: 0;
      }
      .item__nombre {
        margin: 0;
        font-family: var(--font-display);
        font-size: var(--text-2xl);
        font-weight: var(--font-bold);
        color: var(--text-primary);
        line-height: 1.15;
        overflow-wrap: anywhere;
      }
      .item__clase {
        margin: var(--space-1) 0 0;
        font-size: var(--text-sm);
        color: var(--text-secondary);
      }
      .item__estado {
        display: flex;
        flex-wrap: wrap;
        gap: var(--space-2);
      }
      .item__acciones {
        display: flex;
        justify-content: flex-end;
      }
      .item__editar {
        display: inline-flex;
        align-items: center;
        gap: var(--space-2);
        font-size: var(--text-sm);
        font-weight: var(--font-semibold);
        color: var(--bg-secondary);
        background: var(--primary);
        border-radius: var(--radius-md);
        padding: var(--space-2) var(--space-4);
        text-decoration: none;
        transition: var(--transition-fast);
      }
      .item__editar:hover {
        background: var(--primary-dark);
        color: var(--bg-secondary);
      }

      .item__aviso {
        margin: 0;
        font-size: var(--text-sm);
        color: var(--text-secondary);
        background: var(--bg-tertiary);
        border: 1px dashed var(--border-strong);
        border-radius: var(--radius-md);
        padding: var(--space-3) var(--space-4);
      }

      /* ── pestanas ── */
      .item__tabs {
        display: flex;
        gap: var(--space-2);
        border-bottom: 1px solid var(--border-default);
      }
      .item__tab {
        display: inline-flex;
        align-items: center;
        gap: var(--space-2);
        font-size: var(--text-sm);
        font-weight: var(--font-semibold);
        color: var(--text-secondary);
        background: none;
        border: none;
        border-bottom: 2px solid transparent;
        padding: var(--space-2) var(--space-3) var(--space-3);
        cursor: pointer;
        transition: var(--transition-fast);
      }
      .item__tab:hover {
        color: var(--text-primary);
      }
      .item__tab--on {
        color: var(--primary);
        border-bottom-color: var(--primary);
      }
      .item__tab-n {
        font-size: var(--text-xs);
        font-variant-numeric: tabular-nums;
        background: var(--bg-tertiary);
        border-radius: var(--radius-full);
        padding: 0 var(--space-2);
      }

      /* ── detalles ── */
      .item__ficha {
        display: flex;
        flex-direction: column;
        gap: var(--space-4);
      }
      .item__rasgos {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
        gap: var(--space-3);
        margin: 0;
      }
      .item__rasgo {
        background: var(--bg-secondary);
        border: 1px solid var(--border-default);
        border-radius: var(--radius-lg);
        padding: var(--space-3) var(--space-4);
      }
      .item__rasgo-etq {
        font-size: var(--text-xs);
        font-weight: var(--font-semibold);
        color: var(--text-tertiary);
        text-transform: uppercase;
        letter-spacing: 0.04em;
      }
      .item__rasgo-val {
        margin: var(--space-1) 0 0;
        font-size: var(--text-sm);
        color: var(--text-primary);
        display: flex;
        align-items: center;
        gap: var(--space-2);
        overflow-wrap: anywhere;
      }
      .item__rasgo-val--mono {
        font-family: var(--font-mono);
      }
      .item__rasgo-mudo {
        color: var(--text-tertiary);
      }
      .item__alias {
        display: flex;
        flex-wrap: wrap;
        gap: var(--space-1);
      }
      .item__nota {
        background: var(--bg-secondary);
        border: 1px solid var(--border-default);
        border-radius: var(--radius-lg);
        padding: var(--space-3) var(--space-4);
      }
      .item__nota-texto {
        margin: var(--space-1) 0 0;
        font-size: var(--text-sm);
        color: var(--text-primary);
        line-height: 1.5;
      }
      .item__huella {
        margin: 0;
        font-size: var(--text-sm);
        color: var(--text-secondary);
        display: flex;
        gap: var(--space-2);
        flex-wrap: wrap;
      }
      .item__huella-sep {
        color: var(--text-tertiary);
      }

      /* ── precios ── */
      .item__cargando {
        margin: 0;
        font-size: var(--text-sm);
        color: var(--text-secondary);
        padding: var(--space-6) 0;
        text-align: center;
      }
      .item__vacio {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: var(--space-2);
        text-align: center;
        color: var(--text-tertiary);
        background: var(--bg-secondary);
        border: 1px dashed var(--border-default);
        border-radius: var(--radius-xl);
        padding: var(--space-8) var(--space-4);
      }
      .item__vacio-titulo {
        margin: 0;
        font-size: var(--text-base);
        font-weight: var(--font-semibold);
        color: var(--text-primary);
      }
      .item__vacio-texto {
        margin: 0;
        font-size: var(--text-sm);
        max-width: 46ch;
        line-height: 1.5;
      }
      .item__tiendas {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
        gap: var(--space-3);
        margin: 0;
        padding: 0;
        list-style: none;
      }
      .item__tienda {
        display: flex;
        gap: var(--space-3);
        background: var(--bg-secondary);
        border: 1px solid var(--border-default);
        border-radius: var(--radius-lg);
        padding: var(--space-4);
      }
      .item__tienda-muestra {
        width: 4px;
        border-radius: var(--radius-full);
        flex: none;
      }
      .item__tienda-cuerpo {
        min-width: 0;
      }
      .item__tienda-nombre {
        margin: 0;
        font-size: var(--text-sm);
        font-weight: var(--font-semibold);
        color: var(--text-primary);
        overflow-wrap: anywhere;
      }
      .item__tienda-cifras {
        margin: var(--space-1) 0 0;
        display: flex;
        align-items: baseline;
        gap: var(--space-1);
      }
      .item__tienda-precio {
        font-family: var(--font-display);
        font-size: var(--text-xl);
        font-weight: var(--font-bold);
        color: var(--text-primary);
        font-variant-numeric: tabular-nums;
      }
      .item__tienda-por {
        font-size: var(--text-xs);
        color: var(--text-tertiary);
      }
      .item__tienda-meta {
        margin: var(--space-1) 0 0;
        font-size: var(--text-xs);
        color: var(--text-secondary);
      }
      .item__grafica,
      .item__historial {
        background: var(--bg-secondary);
        border: 1px solid var(--border-default);
        border-radius: var(--radius-xl);
        padding: var(--space-5);
      }
      .item__grafica-titulo {
        margin: 0 0 var(--space-4);
        font-size: var(--text-base);
        font-weight: var(--font-semibold);
        color: var(--text-primary);
      }

      /* ── historial ── */
      .item__tabla {
        margin: 0;
        padding: 0;
        list-style: none;
      }
      .item__fila {
        display: grid;
        grid-template-columns: minmax(120px, 1fr) minmax(90px, 1fr) auto 32px;
        gap: var(--space-3);
        align-items: center;
        font-size: var(--text-sm);
        color: var(--text-primary);
        padding: var(--space-2) var(--space-1);
        border-bottom: 1px solid var(--border-default);
      }
      .item__fila:last-child {
        border-bottom: none;
      }
      .item__fila--cab {
        font-size: var(--text-xs);
        font-weight: var(--font-semibold);
        color: var(--text-tertiary);
        text-transform: uppercase;
        letter-spacing: 0.04em;
      }
      .item__fila--fin {
        text-align: right;
        justify-self: end;
      }
      .item__fila-fecha,
      .item__fila-tienda {
        color: var(--text-secondary);
        font-variant-numeric: tabular-nums;
      }
      .item__fila-tienda {
        color: var(--text-primary);
        font-weight: var(--font-semibold);
        overflow-wrap: anywhere;
      }
      .item__fila-pago {
        font-variant-numeric: tabular-nums;
        white-space: nowrap;
      }
      .item__fila-pack {
        color: var(--text-tertiary);
        font-size: var(--text-xs);
        margin-left: var(--space-1);
      }
      .item__quitar {
        display: inline-grid;
        place-items: center;
        width: 28px;
        height: 28px;
        color: var(--text-tertiary);
        background: none;
        border: none;
        border-radius: var(--radius-md);
        cursor: pointer;
        transition: var(--transition-fast);
      }
      .item__quitar:hover {
        color: var(--error);
        background: var(--bg-tertiary);
      }

      /* ── movil: la cabecera se apila y el historial respira ── */
      @media (max-width: 640px) {
        .item__cabecera {
          padding: var(--space-4);
        }
        .item__acciones {
          justify-content: flex-start;
        }
        .item__fila {
          grid-template-columns: 1fr auto 32px;
        }
        .item__fila-fecha {
          grid-column: 1 / -1;
        }
        .item__fila--cab {
          display: none;
        }
      }
    `
  ]
})
export class PantryItemComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly pantry = inject(PantryService);
  private readonly shopping = inject(ShoppingService);
  private readonly confirm = inject(ConfirmService);
  private readonly toast = inject(ToastService);
  private readonly i18n = inject(I18nService);

  readonly item = signal<PantryProduct | null>(null);
  readonly fallo = signal(false);
  readonly tab = signal<ItemTab>('detalles');
  readonly precios = signal<PriceObservation[]>([]);
  readonly preciosCargando = signal(false);
  private preciosPedidos = false;

  readonly series = computed<SerieTienda[]>(() => seriesPorTienda(this.precios()));
  private readonly categoriasPorClave = computed(
    () => new Map(this.pantry.categories().map((categoria) => [categoria.key, categoria]))
  );

  constructor() {
    // La pestana viaja en la URL (?tab=precios) desde el constructor, no desde ngOnInit:
    // `syncTabWithUrl` monta un `effect` y eso solo vive en contexto de inyeccion (el patron
    // del visor de la despensa).
    syncTabWithUrl<ItemTab>({
      param: 'tab',
      values: ['detalles', 'precios'],
      fallback: 'detalles',
      current: () => this.tab(),
      onChange: (tab) => this.tab.set(tab)
    });
    // Los precios se piden la primera vez que hacen falta —la pestana existe aunque la historia
    // no—, y no otra vez: moverse entre pestanas no re-consulta nada.
    effect(() => {
      if (this.tab() === 'precios' && this.item() && !this.preciosPedidos) {
        this.preciosPedidos = true;
        void this.cargarPrecios();
      }
    });
  }

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id') ?? '';
    void this.cargar(id);
  }

  private async cargar(id: string): Promise<void> {
    this.pantry.loadCategories();
    const producto = await this.pantry.getProduct(id);
    if (!producto) {
      this.fallo.set(true);
      return;
    }
    this.item.set(producto);
  }

  actualizarImagen(image: string): void {
    this.item.update((current) => current ? { ...current, image } : current);
  }

  private async cargarPrecios(): Promise<void> {
    const articulo = this.item();
    if (!articulo) return;
    this.preciosCargando.set(true);
    const filas = await this.shopping.preciosDeProducto(productKeyOf(articulo.name));
    this.precios.set(filas);
    this.preciosCargando.set(false);
  }

  // ── etiquetas ──

  colorDe(articulo: PantryProduct): string {
    return colorDeCategoria(this.categoriasPorClave().get(articulo.category));
  }

  etiquetaCategoria(articulo: PantryProduct): string {
    return articulo.categoryName || articulo.category;
  }

  etiquetaUbicacion(ubicacion: string | null): string {
    const claves: Record<string, TranslationKey> = {
      fridge: 'pantry.nevera',
      freezer: 'pantry.congelador',
      pantry: 'pantry.title',
      counter: 'pantry.encimera'
    };
    const clave: TranslationKey = claves[ubicacion ?? 'pantry'] ?? 'pantry.title';
    return this.i18n.t(clave);
  }

  nombreTienda(tienda: string | null): string {
    return tienda ?? this.i18n.t('pantry.item_sin_tienda');
  }

  cuando(valor: string | Date): string {
    return formatDateTime(valor);
  }

  dinero(minor: number): string {
    return formatMoney(minor);
  }

  porUnidad(observacion: PriceObservation): number {
    return Math.round(Number(observacion.price_minor) / (Number(observacion.quantity) || 1));
  }

  /** El mismo semaforo de la tabla de la despensa, contado aqui una sola vez. */
  estado(articulo: PantryProduct): { variant: 'error' | 'warning'; label: string } | null {
    if (!articulo.expirationDate) return null;
    const dias = daysUntil(articulo.expirationDate);
    if (dias === null) return null;
    if (dias < 0) return { variant: 'error', label: this.i18n.t('pantry.caducado') };
    if (dias === 0) return { variant: 'warning', label: this.i18n.t('pantry.caduca_hoy') };
    if (dias <= 3) {
      return { variant: 'warning', label: this.i18n.t('pantry.caduca_en_dias', { days: dias }) };
    }
    return null;
  }

  // ── acciones ──

  async quitarPrecio(observacion: PriceObservation): Promise<void> {
    const aceptado = await this.confirm.confirm({
      title: this.i18n.t('pantry.item_quitar_precio_titulo'),
      message: this.i18n.t('pantry.item_quitar_precio_mensaje', {
        tienda: this.nombreTienda(observacion.store_name?.trim() || null),
        fecha: formatDateTime(observacion.observed_at)
      }),
      confirmText: this.i18n.t('shopping_list_detail.quitar'),
      variant: 'danger'
    });
    if (!aceptado) return;
    await this.shopping.deletePrice(observacion.id);
    this.precios.update((lista) => lista.filter((precio) => precio.id !== observacion.id));
    this.toast.success(this.i18n.t('pantry.item_precio_quitado'));
  }
}
