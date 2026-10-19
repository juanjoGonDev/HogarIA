import { Component, computed, inject, OnInit, output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TranslatePipe } from '../../core/pipes/translate.pipe';
import { I18nService } from '../../core/services/i18n.service';
import { ShoppingService } from '../../core/services/shopping.service';
import { ToastService } from '../../core/services/toast.service';
import { ButtonComponent } from '../../shared/components/ui/button/button.component';
import { BadgeComponent } from '../../shared/components/ui/badge/badge.component';
import { ModalComponent } from '../../shared/components/ui/modal/modal.component';
import { IconComponent } from '../../shared/components/ui/icon/icon.component';
import type { TranslationKey } from '../../core/i18n';
import type { MotivoDeSugerencia, SugerenciaRow } from '../../shared/models/shopping.model';

/**
 * La entrada a la lista sugerida (HOGARIA-SPEC ## 12al), arriba de la bandeja de compras.
 *
 * En la bandeja solo vive UN BOTON con el carrito y el numero de sugerencias: la bandeja es
 * para el historial, y una tarjeta grande con cinco filas le comia el primer plieglo a la
 * pantalla (lo pidio el usuario tal cual: «algo mas minimalista, un boton con algun icono
 * distintivo»). El detalle —cada fila con su PORQUE (el motivo, con su color) y su DONDE (la
 * tienda mas barata que la casa conoce)— vive en un modal, y la lista solo nace cuando se
 * pulsa el boton de ahi. Si ya hay una lista sugerida abierta, el boton del modal pasa a ser
 * «Actualizar»: se creo hace dias, la casa ha seguido comprando, y lo honesto es refrescarla
 * —sin tocar lo comprado ni lo anadido a mano, eso lo garantiza el server.
 *
 * Sin nada que sugerir y sin lista abierta, el boton no aparece: no hay nada que decir.
 */

const MOTIVO_CLAVE: Record<MotivoDeSugerencia, TranslationKey> = {
  caduca: 'shopping_suggested.motivo.caduca',
  sin_stock: 'shopping_suggested.motivo.sin_stock',
  se_acaba: 'shopping_suggested.motivo.se_acaba',
  para_el_plan: 'shopping_suggested.motivo.para_el_plan'
};

const MOTIVO_VARIANTE: Record<MotivoDeSugerencia, 'error' | 'warning' | 'primary' | 'neutral'> = {
  caduca: 'error',
  sin_stock: 'warning',
  se_acaba: 'primary',
  para_el_plan: 'neutral'
};

@Component({
  selector: 'app-shopping-suggested',
  standalone: true,
  imports: [CommonModule, TranslatePipe, ButtonComponent, BadgeComponent, ModalComponent, IconComponent],
  template: `
    @if (sePuedeAplicar()) {
      <div class="sug-trigger">
        <app-button
          variant="secondary"
          size="sm"
          type="button"
          (onClick)="abrir()"
          data-test="sugerida-abrir"
        >
          <app-icon name="add_shopping_cart" [size]="16" [label]="null" />
          <span>{{ 'shopping_suggested.boton' | t }}</span>
          @if (filas().length > 0) {
            <span class="sug-trigger__n" data-test="sugerida-n">{{ filas().length }}</span>
          }
        </app-button>
      </div>
    }

    <app-modal
      [isOpen]="abierto()"
      [title]="'shopping_suggested.titulo' | t"
      size="lg"
      [showFooter]="true"
      (onClose)="cerrar()"
    >
      <p class="sug__subtitulo">{{ 'shopping_suggested.subtitulo' | t }}</p>

      @if (shopping.cargandoSugerencia()) {
        <p class="sug__carga" data-test="sugerida-cargando">…</p>
      } @else if (filas().length === 0) {
        <p class="sug__abierta" data-test="sugerida-abierta">{{
          'shopping_suggested.lista_abierta' | t: { n: listaAbierta()?.itemsPendientes ?? 0 }
        }}</p>
      } @else {
        <ul class="sug__lista">
          @for (fila of filas(); track fila.name) {
            <li class="sug__fila" [attr.data-test]="'sugerida-item-' + fila.name">
              <span class="sug__nombre">{{ fila.name }}</span>
              <span class="sug__cantidad"
                >×{{ fila.quantity }}{{ fila.unit ? ' ' + fila.unit : '' }}</span
              >
              <app-badge [variant]="varianteDe(fila)" size="sm">{{
                MOTIVO_CLAVE[fila.motivo] | t
              }}</app-badge>
              @if (fila.mejorTienda) {
                <span class="sug__tienda">{{
                  'shopping_suggested.mejor_en' | t: { tienda: fila.mejorTienda }
                }}</span>
              }
              <span class="sug__precio">{{
                fila.precioEstimadoMinor !== null
                  ? ('shopping_suggested.total' | t: { total: euros(fila.precioEstimadoMinor) })
                  : ('shopping_suggested.sin_precio' | t)
              }}</span>
            </li>
          }
        </ul>
        @if (totalMinor() > 0) {
          <p class="sug__total" data-test="sugerida-total">
            {{ 'shopping_suggested.total' | t: { total: euros(totalMinor()) } }}
          </p>
        }
        @if (listaAbierta(); as abierta) {
          <p class="sug__abierta" data-test="sugerida-abierta">{{
            'shopping_suggested.lista_abierta' | t: { n: abierta.itemsPendientes }
          }}</p>
        }
      }

      <div class="sug__acciones" footer>
        <app-button
          variant="secondary"
          type="button"
          (onClick)="cerrar()"
          data-test="sugerida-cancelar"
        >
          {{ 'common.cancel' | t }}
        </app-button>
        <app-button
          variant="primary"
          type="button"
          [loading]="trabajando()"
          (onClick)="aplicar()"
          [attr.data-test]="listaAbierta() ? 'sugerida-actualizar' : 'sugerida-crear'"
        >
          {{ (listaAbierta() ? 'shopping_suggested.actualizar' : 'shopping_suggested.crear') | t }}
        </app-button>
      </div>
    </app-modal>
  `,
  styles: [
    `
      /* El boton no es un bloque mas de la bandeja: se pega a la derecha, junto a las acciones
         de la cabecera, y su altura es la de un boton pequeño. Lo que hace distinto al carrito
         es que nadie mas lo usa en esta pantalla. */
      .sug-trigger {
        display: flex;
        justify-content: flex-end;
        margin-top: calc(-1 * var(--space-2, 8px));
      }

      .sug-trigger__n {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: 18px;
        height: 18px;
        padding: 0 5px;
        border-radius: 999px;
        background: var(--primary, #2563eb);
        color: var(--color-neutral-0, #fff);
        font-size: var(--text-xs, 12px);
        font-weight: 600;
        line-height: 1;
      }

      .sug__subtitulo {
        margin: 0 0 var(--space-3, 12px);
        font-size: var(--text-sm, 14px);
        color: var(--text-tertiary, #666);
      }

      .sug__carga {
        margin: 0;
        color: var(--text-tertiary, #666);
      }

      .sug__lista {
        list-style: none;
        margin: 0;
        padding: 0;
        max-height: 50vh;
        overflow-y: auto;
        display: flex;
        flex-direction: column;
        gap: var(--space-2, 8px);
      }

      .sug__fila {
        display: flex;
        align-items: center;
        gap: var(--space-2, 8px);
        flex-wrap: wrap;
        font-size: var(--text-sm, 14px);
      }

      .sug__nombre {
        font-weight: 500;
        color: var(--text-primary, #111);
      }

      .sug__cantidad {
        color: var(--text-secondary, #444);
        font-variant-numeric: tabular-nums;
      }

      .sug__tienda {
        color: var(--text-tertiary, #666);
      }

      .sug__precio {
        margin-left: auto;
        color: var(--text-secondary, #444);
        font-variant-numeric: tabular-nums;
      }

      .sug__total {
        margin: var(--space-3, 12px) 0 0;
        text-align: right;
        font-size: var(--text-base, 15px);
        font-weight: 600;
        color: var(--text-primary, #111);
      }

      .sug__abierta {
        margin: var(--space-3, 12px) 0 0;
        padding: var(--space-2, 8px) var(--space-3, 12px);
        border-radius: var(--radius-md, 10px);
        background: var(--bg-primary, #f5f5f5);
        font-size: var(--text-sm, 14px);
        color: var(--text-secondary, #444);
      }

      .sug__acciones {
        display: flex;
        justify-content: flex-end;
        gap: var(--space-2, 8px);
      }
    `
  ]
})
export class ShoppingSuggestedComponent implements OnInit {
  readonly shopping = inject(ShoppingService);
  private readonly toast = inject(ToastService);
  private readonly i18n = inject(I18nService);

  /** Aviso a la bandeja: la lista acaba de nacer o de refrescarse. */
  readonly aplicada = output<void>();

  readonly abierto = signal(false);
  readonly trabajando = signal(false);
  protected readonly MOTIVO_CLAVE = MOTIVO_CLAVE;

  readonly filas = computed<SugerenciaRow[]>(() => this.shopping.sugerencia()?.sugerencias ?? []);
  readonly listaAbierta = computed(() => this.shopping.sugerencia()?.lista ?? null);
  readonly totalMinor = computed(() =>
    this.filas().reduce(
      (suma, fila) => (fila.precioEstimadoMinor !== null ? suma + fila.precioEstimadoMinor : suma),
      0
    )
  );
  /** Con lista abierta el boton vive aunque no haya nada nuevo: actualizar tambien es mantener. */
  readonly sePuedeAplicar = computed(() => this.filas().length > 0 || this.listaAbierta() !== null);

  ngOnInit(): void {
    this.shopping.cargarSugerencia();
  }

  abrir(): void {
    this.shopping.cargarSugerencia();
    this.abierto.set(true);
  }

  cerrar(): void {
    this.abierto.set(false);
  }

  varianteDe(fila: SugerenciaRow): 'error' | 'warning' | 'primary' | 'neutral' {
    return MOTIVO_VARIANTE[fila.motivo];
  }

  /** 660 -> «6,60 €»: el dinero de la app es espanol hasta en el separador. */
  euros(minor: number): string {
    return `${(minor / 100).toFixed(2).replace('.', ',')} €`;
  }

  async aplicar(): Promise<void> {
    if (this.trabajando()) return;
    this.trabajando.set(true);
    const resultado = await this.shopping.aplicarSugerida();
    this.trabajando.set(false);
    if (!resultado) return; // el toast del error ya lo ha dicho el service
    const actualizo = !resultado.creada;
    this.toast.success(
      this.i18n.t(actualizo ? 'shopping_suggested.actualizada_ok' : 'shopping_suggested.creada_ok'),
      this.i18n.t('shopping_suggested.n_lineas', { n: resultado.sugeridos })
    );
    this.cerrar();
    this.aplicada.emit();
  }
}
