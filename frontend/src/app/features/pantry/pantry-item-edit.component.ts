import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';

import { PantryService } from '../../core/services/pantry.service';
import { ToastService } from '../../core/services/toast.service';
import { ConfirmService } from '../../core/services/confirm.service';
import { I18nService } from '../../core/services/i18n.service';
import type { TranslationKey } from '../../core/i18n';
import { TranslatePipe } from '../../core/pipes/translate.pipe';
import { IconComponent } from '../../shared/components/ui/icon/icon.component';
import { InputComponent } from '../../shared/components/ui/input/input.component';
import { ButtonComponent } from '../../shared/components/ui/button/button.component';
import { TagComponent } from '../../shared/components/ui/tag/tag.component';
import {
  PickerComponent,
  type PickerOption
} from '../../shared/components/ui/picker/picker.component';
import { CatalogLabelPipe } from '../../shared/pipes/catalog-label.pipe';
import type {
  MeasurementUnit,
  PantryProduct,
  StorageLocation
} from '../../shared/models/pantry.model';

/** Lo que el formulario sabe de si mismo: las mismas letras que la ficha, listas para el PATCH. */
interface FormularioArticulo {
  name: string;
  category: string;
  /** `string` y no la union: el picker habla en `string | null`, y el casteo al tipo de
   *  verdad se hace una sola vez, al guardar —no en cada tecla de la plantilla. */
  unit: string;
  location: string;
  expirationDate: string;
  barcode: string;
  notes: string;
  aliases: string[];
}

const VACIO: FormularioArticulo = {
  name: '',
  category: 'other',
  unit: 'unit',
  location: 'pantry',
  expirationDate: '',
  barcode: '',
  notes: '',
  aliases: []
};

/**
 * La edicion de la ficha del articulo (HOGARIA-SPEC ## 12ai): su propia pantalla y su propia
 * URL, no un modal —«vista dedicada a su edicion», pidio el parte—, con guardar explicito.
 *
 * Dos cosas que esta pantalla NO edita, a proposito y dichas en pantalla:
 *
 *  - el STOCK: lo que hay dentro se mueve desde la despensa, con sus motivos de cambio —la
 *    regla escrita en la ## 12x no se rompe porque haya una ficha nueva—;
 *  - la historia de precios: se apunta al cerrar la compra, no a mano desde la ficha.
 */
@Component({
  selector: 'app-pantry-item-edit',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterLink,
    TranslatePipe,
    IconComponent,
    InputComponent,
    ButtonComponent,
    TagComponent,
    PickerComponent,
    CatalogLabelPipe
  ],
  template: `
    <div class="editar">
      <a
        [routerLink]="['/pantry', 'inventario', id]"
        class="editar__volver"
        data-test="editar-volver"
      >
        <app-icon name="chevron_left" [size]="16" [label]="null" />
        <span>{{ 'pantry.item_volver_a_la_ficha' | t }}</span>
      </a>

      @if (articulo(); as art) {
        <header class="editar__cabecera">
          <h1 class="editar__titulo">{{ 'pantry.item_editar' | t }}</h1>
          <p class="editar__nombre">{{ art.name | catalog }}</p>
        </header>

        <form class="editar__cuerpo" (ngSubmit)="guardar()">
          <app-input
            id="item-nombre"
            name="item-nombre"
            type="text"
            [label]="'pantry.columna_nombre' | t"
            [(ngModel)]="formulario.name"
            [required]="true"
            data-test="editar-campo-nombre"
          ></app-input>
          @if (errorNombre) {
            <p class="editar__error" role="alert">{{ errorNombre }}</p>
          }

          <div class="editar__fila">
            <div class="editar__campo">
              <label class="editar__etiqueta" for="item-categoria">{{
                'pantry.categoria' | t
              }}</label>
              <app-picker
                id="item-categoria"
                name="item-categoria"
                class="editar__picker"
                [options]="opcionesCategoria()"
                [value]="formulario.category"
                (valueChange)="formulario.category = $event ?? 'other'"
                data-test="editar-campo-categoria"
              ></app-picker>
            </div>

            <div class="editar__campo">
              <label class="editar__etiqueta" for="item-unidad">{{ 'pantry.unidad' | t }}</label>
              <app-picker
                id="item-unidad"
                name="item-unidad"
                class="editar__picker"
                [options]="opcionesUnidad()"
                [value]="formulario.unit"
                (valueChange)="formulario.unit = $event ?? 'unit'"
                data-test="editar-campo-unidad"
              ></app-picker>
            </div>
          </div>

          <div class="editar__fila">
            <div class="editar__campo">
              <label class="editar__etiqueta" for="item-ubicacion">{{
                'pantry.ubicacion' | t
              }}</label>
              <app-picker
                id="item-ubicacion"
                name="item-ubicacion"
                class="editar__picker"
                [options]="opcionesUbicacion()"
                [value]="formulario.location"
                (valueChange)="formulario.location = $event ?? 'pantry'"
                data-test="editar-campo-ubicacion"
              ></app-picker>
            </div>

            <app-input
              id="item-caducidad"
              name="item-caducidad"
              type="date"
              [label]="'pantry.item_caducidad' | t"
              [(ngModel)]="formulario.expirationDate"
              data-test="editar-campo-caducidad"
            ></app-input>
          </div>

          <app-input
            id="item-codigo"
            name="item-codigo"
            type="text"
            [label]="'pantry.item_codigo_barras' | t"
            [(ngModel)]="formulario.barcode"
            data-test="editar-campo-codigo"
          ></app-input>

          <app-input
            id="item-nota"
            name="item-nota"
            type="text"
            [label]="'pantry.notas_producto' | t"
            [(ngModel)]="formulario.notes"
            data-test="editar-campo-nota"
          ></app-input>

          <div class="editar__campo">
            <span class="editar__etiqueta">{{ 'pantry.aliases' | t }}</span>
            <p class="editar__ayuda">{{ 'pantry.aliases_ayuda' | t }}</p>
            <div class="editar__alias" *ngIf="formulario.aliases.length > 0">
              @for (alias of formulario.aliases; track alias) {
                <app-tag [removable]="true" (onRemove)="quitarAlias(alias)">{{ alias }}</app-tag>
              }
            </div>
            <div class="editar__alias-nuevo">
              <app-input
                id="item-alias"
                name="item-alias"
                type="text"
                [placeholder]="'pantry.anadir_alias' | t"
                [(ngModel)]="aliasNuevo"
                (keydown.enter)="$event.preventDefault(); anadirAlias()"
                data-test="editar-campo-alias"
              ></app-input>
              <button
                type="button"
                class="editar__anadir"
                (click)="anadirAlias()"
                data-test="editar-anadir-alias"
              >
                {{ 'pantry.anadir_alias' | t }}
              </button>
            </div>
          </div>

          <div class="editar__stock" data-test="editar-stock">
            <span class="editar__etiqueta">{{ 'pantry.cantidad' | t }}</span>
            <p class="editar__stock-valor">
              {{ 'pantry.en_despensa_cantidad' | t: { cantidad: art.quantity + ' ' + art.unit } }}
            </p>
            <p class="editar__ayuda">{{ 'pantry.item_stock_pista' | t }}</p>
          </div>

          @if (error) {
            <p class="editar__error" role="alert" data-test="editar-error">{{ error }}</p>
          }

          <div class="editar__acciones">
            <app-button
              variant="ghost"
              type="button"
              [disabled]="guardando()"
              (onClick)="cancelar()"
            >
              {{ 'common.cancel' | t }}
            </app-button>
            <app-button
              variant="primary"
              type="submit"
              [loading]="guardando()"
              [disabled]="guardando()"
              data-test="editar-guardar"
            >
              {{ 'pantry.guardar_producto' | t }}
            </app-button>
          </div>
        </form>
      } @else if (fallo()) {
        <div class="editar__vacio" data-test="editar-no-encontrado">
          <p class="editar__vacio-titulo">{{ 'pantry.item_no_encontrado' | t }}</p>
          <a routerLink="/pantry" class="editar__seguir">{{ 'pantry.item_volver' | t }}</a>
        </div>
      } @else {
        <p class="editar__cargando">{{ 'pantry.item_cargando' | t }}</p>
      }
    </div>
  `,
  styles: [
    `
      .editar {
        display: flex;
        flex-direction: column;
        gap: var(--space-5);
        max-width: 640px;
        margin: 0 auto;
        padding-block: var(--container-padding);
      }
      .editar__volver {
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
      .editar__volver:hover {
        color: var(--primary-dark);
        background: var(--bg-tertiary);
      }
      .editar__cabecera {
        background: var(--bg-secondary);
        border: 1px solid var(--border-default);
        border-radius: var(--radius-xl);
        box-shadow: var(--shadow-sm);
        padding: var(--space-5) var(--space-6);
      }
      .editar__titulo {
        margin: 0;
        font-family: var(--font-display);
        font-size: var(--text-xl);
        font-weight: var(--font-bold);
        color: var(--text-primary);
      }
      .editar__nombre {
        margin: var(--space-1) 0 0;
        font-size: var(--text-sm);
        color: var(--text-secondary);
        overflow-wrap: anywhere;
      }
      .editar__cuerpo {
        display: flex;
        flex-direction: column;
        gap: var(--space-4);
        background: var(--bg-secondary);
        border: 1px solid var(--border-default);
        border-radius: var(--radius-xl);
        padding: var(--space-5) var(--space-6);
      }
      .editar__fila {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: var(--space-4);
      }
      .editar__campo {
        display: flex;
        flex-direction: column;
        gap: var(--space-2);
        min-width: 0;
      }
      .editar__etiqueta {
        font-size: var(--text-xs);
        font-weight: var(--font-semibold);
        color: var(--text-tertiary);
        text-transform: uppercase;
        letter-spacing: 0.04em;
      }
      .editar__ayuda {
        margin: 0;
        font-size: var(--text-xs);
        color: var(--text-tertiary);
        line-height: 1.4;
      }
      .editar__alias {
        display: flex;
        flex-wrap: wrap;
        gap: var(--space-1);
      }
      .editar__alias-nuevo {
        display: flex;
        gap: var(--space-2);
        align-items: stretch;
      }
      .editar__anadir {
        font-size: var(--text-sm);
        font-weight: var(--font-semibold);
        color: var(--primary);
        background: none;
        border: 1px dashed var(--border-strong);
        border-radius: var(--radius-md);
        padding: 0 var(--space-3);
        cursor: pointer;
        transition: var(--transition-fast);
        white-space: nowrap;
      }
      .editar__anadir:hover {
        background: var(--bg-tertiary);
      }
      .editar__stock {
        display: flex;
        flex-direction: column;
        gap: var(--space-1);
        background: var(--bg-tertiary);
        border-radius: var(--radius-lg);
        padding: var(--space-3) var(--space-4);
      }
      .editar__stock-valor {
        margin: 0;
        font-size: var(--text-sm);
        font-weight: var(--font-semibold);
        color: var(--text-primary);
      }
      .editar__error {
        margin: 0;
        font-size: var(--text-sm);
        color: var(--error);
      }
      .editar__acciones {
        display: flex;
        justify-content: flex-end;
        gap: var(--space-3);
        padding-top: var(--space-2);
        border-top: 1px solid var(--border-default);
      }
      .editar__vacio {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: var(--space-3);
        text-align: center;
        padding: var(--space-8) var(--space-4);
        color: var(--text-secondary);
      }
      .editar__vacio-titulo {
        margin: 0;
        font-size: var(--text-base);
        font-weight: var(--font-semibold);
        color: var(--text-primary);
      }
      .editar__seguir {
        font-size: var(--text-sm);
        font-weight: var(--font-semibold);
        color: var(--primary);
        text-decoration: none;
      }
      .editar__cargando {
        margin: 0;
        font-size: var(--text-sm);
        color: var(--text-secondary);
        text-align: center;
        padding: var(--space-6) 0;
      }
      @media (max-width: 640px) {
        .editar__cuerpo,
        .editar__cabecera {
          padding: var(--space-4);
        }
        .editar__fila {
          grid-template-columns: 1fr;
        }
        .editar__alias-nuevo {
          flex-direction: column;
        }
        .editar__acciones {
          flex-direction: column-reverse;
        }
        .editar__acciones app-button {
          width: 100%;
        }
      }
    `
  ]
})
export class PantryItemEditComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly pantry = inject(PantryService);
  private readonly confirm = inject(ConfirmService);
  private readonly toast = inject(ToastService);
  private readonly i18n = inject(I18nService);

  readonly id = this.route.snapshot.paramMap.get('id') ?? '';
  readonly articulo = signal<PantryProduct | null>(null);
  readonly fallo = signal(false);
  readonly guardando = signal(false);

  formulario: FormularioArticulo = { ...VACIO };
  aliasNuevo = '';
  error = '';
  errorNombre = '';
  private inicial: FormularioArticulo = { ...VACIO };

  private readonly UNIDADES: readonly { valor: MeasurementUnit; clave: TranslationKey }[] = [
    { valor: 'g', clave: 'pantry.gramos_g' },
    { valor: 'kg', clave: 'pantry.kilogramos_kg' },
    { valor: 'ml', clave: 'pantry.mililitros_ml' },
    { valor: 'l', clave: 'pantry.litros_l' },
    { valor: 'unit', clave: 'pantry.unidades' },
    { valor: 'cup', clave: 'pantry.tazas' },
    { valor: 'tbsp', clave: 'pantry.cucharadas' },
    { valor: 'tsp', clave: 'pantry.cucharaditas' }
  ];

  readonly opcionesCategoria = computed<PickerOption[]>(() => {
    this.i18n.changeTick();
    return this.pantry.categories().map((categoria) => ({
      value: categoria.key,
      label: categoria.name
    }));
  });

  readonly opcionesUnidad = computed<PickerOption[]>(() => {
    this.i18n.changeTick();
    return this.UNIDADES.map((unidad) => ({
      value: unidad.valor,
      label: this.i18n.t(unidad.clave)
    }));
  });

  readonly opcionesUbicacion = computed<PickerOption[]>(() => {
    this.i18n.changeTick();
    const claves: Record<StorageLocation, TranslationKey> = {
      fridge: 'pantry.nevera',
      freezer: 'pantry.congelador',
      pantry: 'pantry.title',
      counter: 'pantry.encimera'
    };
    return (Object.keys(claves) as StorageLocation[]).map((ubicacion) => ({
      value: ubicacion,
      label: this.i18n.t(claves[ubicacion])
    }));
  });

  ngOnInit(): void {
    this.pantry.loadCategories();
    void this.cargar();
  }

  private async cargar(): Promise<void> {
    const articulo = await this.pantry.getProduct(this.id);
    if (!articulo) {
      this.fallo.set(true);
      return;
    }
    this.articulo.set(articulo);
    this.formulario = {
      name: articulo.name,
      category: articulo.category,
      unit: articulo.unit,
      location: (articulo.location as StorageLocation) ?? 'pantry',
      expirationDate: articulo.expirationDate ?? '',
      barcode: articulo.barcode ?? '',
      notes: articulo.notes ?? '',
      aliases: [...articulo.aliases]
    };
    this.inicial = { ...this.formulario, aliases: [...this.formulario.aliases] };
  }

  // ── alias ──

  anadirAlias(): void {
    const alias = this.aliasNuevo.trim();
    this.aliasNuevo = '';
    if (!alias) return;
    if (
      this.formulario.aliases.some((existente) => existente.toLowerCase() === alias.toLowerCase())
    ) {
      return;
    }
    this.formulario.aliases = [...this.formulario.aliases, alias];
  }

  quitarAlias(alias: string): void {
    this.formulario.aliases = this.formulario.aliases.filter((existente) => existente !== alias);
  }

  // ── acciones ──

  async guardar(): Promise<void> {
    const nombre = this.formulario.name.trim();
    this.error = '';
    this.errorNombre = '';
    if (!nombre) {
      this.errorNombre = this.i18n.t('pantry.el_nombre_es_requerido');
      return;
    }
    this.guardando.set(true);
    const resultado = await this.pantry.updateProduct(this.id, {
      name: nombre,
      category: this.formulario.category,
      unit: this.formulario.unit as MeasurementUnit,
      location: this.formulario.location as StorageLocation,
      expirationDate: this.formulario.expirationDate || null,
      barcode: this.formulario.barcode.trim() || null,
      notes: this.formulario.notes.trim() || null,
      aliases: this.formulario.aliases
    });
    this.guardando.set(false);
    if (!resultado.ok) {
      this.error = this.fraseDe(resultado);
      return;
    }
    this.toast.success(this.i18n.t('pantry.producto_guardado'));
    await this.router.navigate(['/pantry', 'inventario', this.id]);
  }

  async cancelar(): Promise<void> {
    if (this.sucio()) {
      const aceptado = await this.confirm.confirm({
        title: this.i18n.t('pantry.item_salir_sin_guardar'),
        message: this.i18n.t('pantry.item_salir_sin_guardar_mensaje'),
        variant: 'danger'
      });
      if (!aceptado) return;
    }
    await this.router.navigate(['/pantry', 'inventario', this.id]);
  }

  private sucio(): boolean {
    return (
      this.formulario.name.trim() !== this.inicial.name ||
      this.formulario.category !== this.inicial.category ||
      this.formulario.unit !== this.inicial.unit ||
      this.formulario.location !== this.inicial.location ||
      this.formulario.expirationDate !== this.inicial.expirationDate ||
      this.formulario.barcode.trim() !== this.inicial.barcode ||
      this.formulario.notes.trim() !== this.inicial.notes ||
      this.formulario.aliases.length !== this.inicial.aliases.length ||
      this.formulario.aliases.some((alias, indice) => alias !== this.inicial.aliases[indice])
    );
  }

  private fraseDe(resultado: { error?: string; message?: string }): string {
    if (resultado.error === 'PANTRY_PRODUCT_ALIAS_CLASH') {
      return this.i18n.t('pantry.item_alias_chocado');
    }
    return resultado.message || this.i18n.t('ui.ha_ocurrido_un_error');
  }
}
