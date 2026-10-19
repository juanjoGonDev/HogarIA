import { Component, DestroyRef, inject, OnInit, computed, signal, viewChild } from '@angular/core';
import { CommonModule, DOCUMENT } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { ActivatedRoute, Router } from '@angular/router';
import { daysUntil, toDayKey } from '../../core/time';
import { PantryService } from '../../core/services/pantry.service';
import { ToastService } from '../../core/services/toast.service';
import { ConfirmService } from '../../core/services/confirm.service';
import { syncTabWithUrl } from '../../core/utils/tab-url';
import { ButtonComponent } from '../../shared/components/ui/button/button.component';
import { InputComponent } from '../../shared/components/ui/input/input.component';
import { CardComponent } from '../../shared/components/ui/card/card.component';
import { BadgeComponent } from '../../shared/components/ui/badge/badge.component';
import { CheckboxComponent } from '../../shared/components/ui/checkbox/checkbox.component';
import {
  DataTableComponent,
  DataTableCellDirective
} from '../../shared/components/ui/data-table/data-table.component';
import type { DataTableColumna } from '../../shared/components/ui/data-table/data-table.types';
import { quitarAcentos, valorTipado } from '../../shared/components/ui/data-table/data-table.util';
import { ModalComponent } from '../../shared/components/ui/modal/modal.component';
import { LoadingComponent } from '../../shared/components/ui/loading/loading.component';
import { IconComponent } from '../../shared/components/ui/icon/icon.component';
import { TooltipComponent } from '../../shared/components/ui/tooltip/tooltip.component';
import { clavesSubarbolDe, colorDeCategoria } from './pantry-gestor.util';
import {
  Ingredient,
  IngredientCategory,
  MeasurementUnit,
  StorageLocation,
  Utensil,
  UtensilCategory
} from '../../shared/models/pantry.model';
import { TranslatePipe } from '../../core/pipes/translate.pipe';
import { CatalogLabelPipe } from '../../shared/pipes/catalog-label.pipe';
import { PantryCategoryLabelPipe } from '../../shared/pipes/pantry-category-label.pipe';
import {
  PickerComponent,
  type PickerOption
} from '../../shared/components/ui/picker/picker.component';
import { pantryCategoryLabel } from '../../core/i18n/labels';
import type { PantryCategoryKey } from '../../shared/models/pantry.model';
import type { TranslationKey } from '../../core/i18n';
import { I18nService } from '../../core/services/i18n.service';

type PantryTab = 'ingredients' | 'utensils';

/** Pestañas de la despensa: cada una se refleja en la URL (?tab=...). */
const PANTRY_TABS = ['ingredients', 'utensils'] as const;

/**
 * El inventario se pinta con `app-data-table` (## 12ab): orden, filtros por columna, paginacion y lote
 * los lleva la tabla sobre las filas completas, que el servicio carga de 100 en 100 de una vez. Los tramos
 * de secciones con `?section=` que habia antes eran una paginacion artesanal para un catalogo que ya no
 * necesita tramos: la misma tabla los ordena y los filtra.
 */
@Component({
  selector: 'app-pantry',
  standalone: true,
  imports: [
    TranslatePipe,

    CommonModule,
    FormsModule,
    ButtonComponent,
    InputComponent,
    CardComponent,
    BadgeComponent,
    ModalComponent,
    LoadingComponent,
    CheckboxComponent,
    TooltipComponent,
    DataTableComponent,
    DataTableCellDirective,
    CatalogLabelPipe,
    PantryCategoryLabelPipe,
    PickerComponent,
    IconComponent
  ],
  template: `
    <div class="pantry">
      <!-- Header -->
      <div class="pantry__header">
        <div class="pantry__title-section">
          <h1 class="pantry__title">{{ 'pantry.title' | t }}</h1>
        </div>
        <div class="pantry__header-acciones">
          <!-- ## 12ak: la despensa ordenada por lo que caduca primero, con su grafica. -->
          <app-button
            variant="secondary"
            [touchTarget]="true"
            (onClick)="irACaducidades()"
            data-test="pantry-caducidades"
          >
            {{ 'pantry.caducidades' | t }}
          </app-button>
          <!-- ## 12aa: el alta manual sigue, pero la puerta rapida al inventario de la casa es el catalogo. -->
          <app-button
            variant="secondary"
            [touchTarget]="true"
            (onClick)="abrirCatalogo()"
            data-test="pantry-anadir-catalogo"
          >
            {{ 'pantry.catalogo_anadir' | t }}
          </app-button>
          <app-button
            variant="primary"
            [touchTarget]="true"
            (onClick)="openAddModal()"
            data-test="pantry-agregar"
          >
            {{ addButtonLabel() }}
          </app-button>
        </div>
      </div>

      <!-- Tabs -->
      <div class="pantry__tabs">
        <button
          type="button"
          class="tab"
          [class.tab--active]="activeTab() === 'ingredients'"
          (click)="switchTab('ingredients')"
        >
          {{ 'pantry.ingredientes' | t }} <span class="tab__count">{{ inPantryCount() }}</span>
        </button>
        <button
          type="button"
          class="tab"
          [class.tab--active]="activeTab() === 'utensils'"
          (click)="switchTab('utensils')"
        >
          {{ 'pantry.utensilios' | t }} <span class="tab__count">{{ ownedUtensilsCount() }}</span>
        </button>
      </div>

      <!-- ═══════════════ INGREDIENTS TAB ═══════════════ -->
      <ng-container *ngIf="activeTab() === 'ingredients'">
        <!-- Stats Cards -->
        <div class="pantry__stats" *ngIf="pantryService.stats() as stats">
          <div class="stat-card stat-card--total">
            <span class="stat-card__icon"
              ><app-icon name="inventory_2" [size]="22" [label]="null"
            /></span>
            <div class="stat-card__content">
              <span class="stat-card__value">{{ inPantryCount() }}</span>
              <span class="stat-card__label">{{ 'pantry.en_despensa' | t }}</span>
            </div>
          </div>
          <div class="stat-card stat-card--warning">
            <span class="stat-card__icon"
              ><app-icon name="schedule" [size]="22" [label]="null"
            /></span>
            <div class="stat-card__content">
              <span class="stat-card__value">{{ stats.expiringSoon }}</span>
              <span class="stat-card__label">{{ 'pantry.por_caducar' | t }}</span>
            </div>
          </div>
          <div class="stat-card stat-card--danger">
            <span class="stat-card__icon"
              ><app-icon name="error_outline" [size]="22" [label]="null"
            /></span>
            <div class="stat-card__content">
              <span class="stat-card__value">{{ stats.expired }}</span>
              <span class="stat-card__label">{{ 'pantry.caducados' | t }}</span>
            </div>
          </div>
        </div>

        <!--
          El catalogo de la casa, desde la ## 12x, es gestionable: categorias y productos principales son dos
          rutas, no dos modales, y aqui solo se entra en ellas.
        -->
        <div class="pantry__gestion" data-test="pantry-gestion">
          <span class="gestion__titulo">{{ 'pantry.gestion_del_inventario' | t }}</span>
          <span class="gestion__acciones">
            <button
              type="button"
              class="gestion__enlace"
              (click)="abrirGestor('categories')"
              data-test="pantry-abrir-categorias"
            >
              {{ 'pantry.gestor_categorias' | t }}
            </button>
            <button
              type="button"
              class="gestion__enlace"
              (click)="abrirGestor('products')"
              data-test="pantry-abrir-productos"
            >
              {{ 'pantry.gestor_productos' | t }}
            </button>
            <button
              type="button"
              class="gestion__enlace"
              (click)="abrirGestor('catalogo')"
              data-test="pantry-abrir-catalogo"
            >
              <app-icon name="storefront" [size]="16" [label]="null" />
              <span>{{ 'pantry.catalogo_titulo' | t }}</span>
            </button>
          </span>
        </div>

        <!-- La busqueda se fue arriba de la tabla (regla E, ## 12ad); aqui queda el filtro de categoria. -->
        <div class="pantry__filters">
          <div class="pantry__filtro-cat">
            <app-picker
              [options]="opcionesFiltroCategoria()"
              [value]="filtroCategoria()"
              [placeholder]="'pantry.categoria_todos' | t"
              [label]="'pantry.categoria' | t"
              data-test="pantry-filtro-categoria"
              (valueChange)="elegirCategoria($event)"
            />
          </div>
        </div>

        <app-loading
          *ngIf="pantryService.isLoading()"
          [message]="'pantry.cargando_ingredientes' | t"
        ></app-loading>

        <section
          *ngIf="!pantryService.isLoading() && inventoryLoadError()"
          class="pantry__load-error"
          role="alert"
          data-test="pantry-inventory-error"
        >
          <p class="pantry__load-error-message">{{ 'pantry.inventario_carga_error' | t }}</p>
          <app-button
            variant="primary"
            type="button"
            [touchTarget]="true"
            (onClick)="reintentarCargaInventario()"
            data-test="pantry-inventory-retry"
          >
            {{ 'pantry.inventario_reintentar' | t }}
          </app-button>
        </section>

        <div *ngIf="!pantryService.isLoading() && !inventoryLoadError()">
          <!-- Lo que la casa conoce y no tiene: un expand cerrado por defecto (## 12ab). -->
          @if (suggestions().length > 0) {
            <div class="suggestions" data-test="pantry-sugerencias">
              <div class="suggestions__header">
                <span class="suggestions__title">{{ 'pantry.sugerencias_comunes' | t }}</span>
                <button
                  type="button"
                  class="suggestions__toggle"
                  [attr.aria-expanded]="sugerenciasAbiertas()"
                  (click)="alternarSugerencias()"
                  data-test="pantry-sugerencias-toggle"
                >
                  <span class="suggestions__cuenta">{{
                    'pantry.sugerencias_cuenta' | t: { n: suggestions().length }
                  }}</span>
                  <span class="suggestions__verbo">{{
                    (sugerenciasAbiertas()
                      ? 'pantry.sugerencias_cerrar'
                      : 'pantry.sugerencias_abrir'
                    ) | t
                  }}</span>
                  <app-icon
                    [name]="sugerenciasAbiertas() ? 'expand_less' : 'expand_more'"
                    [size]="18"
                    [label]="null"
                  />
                </button>
              </div>
              @if (sugerenciasAbiertas()) {
                <p class="suggestions__hint">{{ 'pantry.toca_para_anadirlas_a' | t }}</p>
                <div class="suggestions__chips">
                  @for (s of suggestions(); track s.id) {
                    <app-tooltip position="top" [text]="s.name | catalog">
                      <button
                        type="button"
                        class="chip"
                        (click)="quickAddSuggestion(s)"
                        [attr.data-test]="'pantry-sugerencia-' + s.id"
                      >
                        <span
                          class="chip__punto"
                          [style.background]="colorDe(s.category)"
                          aria-hidden="true"
                        ></span>
                        <span class="chip__name">{{ s.name | catalog }}</span>
                        <span class="chip__plus">+</span>
                      </button>
                    </app-tooltip>
                  }
                </div>
              }
            </div>
          }

          @if (filasInventario().length > 0 || hayInventario()) {
            <app-data-table
              #tablaInv
              data-test="pantry-tabla-inventario"
              [filas]="filasInventario()"
              [columnas]="columnasInventario()"
              [seleccionable]="true"
              [claveDeFila]="identificadorDeFila"
              [etiquetaDeFila]="nombreDeFila"
              [claseFila]="claseFilaInv"
              (seleccionChange)="inventarioSeleccion.set($event)"
            >
              <div data-tabla-buscar class="pantry__buscar-tabla">
                <app-input
                  id="search"
                  name="search"
                  type="search"
                  [placeholder]="'pantry.buscar_ingredientes' | t"
                  [ngModel]="searchTerm()"
                  (ngModelChange)="escribirBusqueda($event)"
                ></app-input>
              </div>
              <div data-tabla-lote>
                @if (inventarioSeleccion().length > 0) {
                  <div class="lote" data-test="pantry-lote">
                    <span class="lote__cta">{{
                      'pantry.seleccionados' | t: { n: inventarioSeleccion().length }
                    }}</span>
                    <span class="lote__acciones">
                      <button
                        type="button"
                        class="lote__btn"
                        (click)="loteVaciar()"
                        data-test="pantry-lote-vaciar"
                      >
                        {{ 'pantry.lote_vaciar' | t }}
                      </button>
                      <button
                        type="button"
                        class="lote__btn lote__btn--peligro"
                        (click)="loteBorrar()"
                        data-test="pantry-lote-borrar"
                      >
                        {{ 'pantry.lote_borrar' | t }}
                      </button>
                      <app-tooltip position="top" [text]="'pantry.lote_anular' | t">
                        <button
                          type="button"
                          class="lote__x"
                          (click)="loteAnular()"
                          data-test="pantry-lote-anular"
                          [attr.aria-label]="'pantry.lote_anular' | t"
                        >
                          <app-icon name="close" [size]="16" [label]="null" />
                        </button>
                      </app-tooltip>
                    </span>
                  </div>
                  <div class="lote__empuje" aria-hidden="true"></div>
                }
              </div>
              <ng-template appDataTableCell="nombre" let-fila>
                <span class="celda-nombre">
                  <span
                    class="ingredient-item__punto"
                    [style.background]="colorDe(filaCat(fila))"
                    aria-hidden="true"
                  ></span>
                  <!-- El nombre es el enlace a la ficha del articulo (## 12ai): href de verdad y
                       navegacion propia, para que el boton central y «abrir en pestana nueva»
                       sigan siendo un enlace y no un boton disfrazado (el patron de la cesta). -->
                  <a
                    class="celda-nombre__enlace"
                    [href]="hrefDeItem(fila)"
                    (click)="abrirItem(fila, $event)"
                    [attr.aria-label]="'pantry.abrir_articulo' | t: { name: filaNombre(fila) }"
                    [attr.data-test]="'pantry-item-' + filaId(fila)"
                    >{{ filaNombre(fila) | catalog }}</a
                  >
                </span>
              </ng-template>
              <ng-template appDataTableCell="cantidad" let-fila>
                <span class="pantry__stock">
                  <app-tooltip position="top" [text]="'pantry.quitar_unidad' | t">
                    <button
                      type="button"
                      class="stock-btn"
                      [attr.aria-label]="'pantry.quitar_unidad' | t"
                      (click)="quitarUnidad(filaIngrediente(fila), $event)"
                      [attr.data-test]="'pantry-stock-menos-' + filaId(fila)"
                    >
                      <app-icon name="remove" [size]="14" [label]="null" />
                    </button>
                  </app-tooltip>
                  <span class="ingredient-item__quantity">{{ filaCantidad(fila) }}</span>
                  <app-tooltip position="top" [text]="'pantry.anadir_unidad' | t">
                    <button
                      type="button"
                      class="stock-btn"
                      [attr.aria-label]="'pantry.anadir_unidad' | t"
                      (click)="anadirUnidad(filaIngrediente(fila), $event)"
                      [attr.data-test]="'pantry-stock-mas-' + filaId(fila)"
                    >
                      <app-icon name="add" [size]="14" [label]="null" />
                    </button>
                  </app-tooltip>
                </span>
              </ng-template>
              <ng-template appDataTableCell="caducidad" let-fila>
                <span class="celda-caducidad">
                  @if (filaCaducidad(fila); as dia) {
                    <span class="celda">{{ dia }}</span>
                  }
                  @if (getExpirationStatus(filaIngrediente(fila)); as status) {
                    <app-badge [variant]="status.variant" size="sm">{{ status.label }}</app-badge>
                  }
                </span>
              </ng-template>
              <ng-template appDataTableCell="acciones" let-fila>
                <span class="ingrediente-acciones">
                  <app-tooltip position="top" [text]="'pantry.editar_ingrediente' | t">
                    <button
                      type="button"
                      class="action-btn"
                      [attr.aria-label]="'pantry.editar_ingrediente' | t"
                      (click)="editIngredient(filaIngrediente(fila))"
                      [attr.data-test]="'pantry-editar-' + filaId(fila)"
                    >
                      <app-icon name="edit" [size]="16" [label]="null" />
                    </button>
                  </app-tooltip>
                  <app-tooltip position="top" [text]="'pantry.eliminar_ingrediente' | t">
                    <button
                      type="button"
                      class="action-btn action-btn--danger"
                      [attr.aria-label]="'pantry.eliminar_ingrediente' | t"
                      (click)="deleteIngredient(filaIngrediente(fila))"
                      [attr.data-test]="'pantry-eliminar-' + filaId(fila)"
                    >
                      <app-icon name="delete" [size]="16" [label]="null" />
                    </button>
                  </app-tooltip>
                </span>
              </ng-template>
            </app-data-table>
          } @else if (suggestions().length === 0) {
            <div class="empty-state">
              <span class="empty-state__icon"
                ><app-icon name="inventory_2" [size]="64" [label]="null"
              /></span>
              <h3 class="empty-state__title">{{ 'pantry.empty' | t }}</h3>
              <p class="empty-state__text">{{ 'pantry.agrega_ingredientes_para_empezar' | t }}</p>
              <app-button variant="primary" (onClick)="openAddModal()">{{
                'pantry.agregar_primer_ingrediente' | t
              }}</app-button>
            </div>
          }
        </div>
      </ng-container>

      <!-- ═══════════════ UTENSILS TAB ═══════════════ -->
      <ng-container *ngIf="activeTab() === 'utensils'">
        <div class="utensils-intro">
          <p>{{ 'pantry.marca_los_utensilios_y' | t }}</p>
        </div>

        <app-loading
          *ngIf="utensilsLoading()"
          [message]="'onboarding.cargando_utensilios' | t"
        ></app-loading>

        <div *ngIf="!utensilsLoading()" class="utensils">
          <div class="utensils-meta">
            <span>{{
              'pantry.de_marcados' | t: { owned: ownedUtensilsCount(), total: utensilTotal() }
            }}</span>
          </div>

          @if (utensilTotal() === 0) {
            <div class="empty-state">
              <span class="empty-state__icon"
                ><app-icon name="kitchen" [size]="64" [label]="null"
              /></span>
              <h3 class="empty-state__title">{{ 'pantry.todavia_no_hay_utensilios' | t }}</h3>
              <p class="empty-state__text">
                {{ 'pantry.anade_los_que_uses' | t }}
              </p>
              <app-button variant="primary" (onClick)="openUtensilModal()">{{
                'pantry.anadir_utensilio' | t
              }}</app-button>
            </div>
          } @else {
            <app-data-table
              #tablaUti
              data-test="utensilios-tabla"
              [filas]="utensiliosFiltrados()"
              [columnas]="columnasUtensilios()"
              [seleccionable]="true"
              [claveDeFila]="identificadorDeFila"
              [etiquetaDeFila]="nombreDeFila"
              [claseFila]="claseFilaUti"
              (seleccionChange)="utensiliosSeleccion.set($event)"
            >
              <div data-tabla-buscar class="pantry__buscar-tabla">
                <app-input
                  id="utensilios-q"
                  name="utensiliosQ"
                  type="search"
                  [placeholder]="'pantry.buscar_utensilios' | t"
                  [ngModel]="utensiliosQ()"
                  (ngModelChange)="utensiliosQ.set($event ?? '')"
                />
              </div>
              <div data-tabla-lote>
                @if (utensiliosSeleccion().length > 0) {
                  <div class="lote" data-test="utensilios-lote">
                    <span class="lote__cta">{{
                      'pantry.seleccionados' | t: { n: utensiliosSeleccion().length }
                    }}</span>
                    <span class="lote__acciones">
                      <button
                        type="button"
                        class="lote__btn"
                        (click)="loteUtensilios(true)"
                        data-test="utensilios-lote-marcar"
                      >
                        {{ 'pantry.lote_disponibles' | t }}
                      </button>
                      <button
                        type="button"
                        class="lote__btn"
                        (click)="loteUtensilios(false)"
                        data-test="utensilios-lote-desmarcar"
                      >
                        {{ 'pantry.lote_no_disponibles' | t }}
                      </button>
                      <app-tooltip position="top" [text]="'pantry.lote_anular' | t">
                        <button
                          type="button"
                          class="lote__x"
                          (click)="loteUtensiliosAnular()"
                          data-test="utensilios-lote-anular"
                          [attr.aria-label]="'pantry.lote_anular' | t"
                        >
                          <app-icon name="close" [size]="16" [label]="null" />
                        </button>
                      </app-tooltip>
                    </span>
                  </div>
                  <div class="lote__empuje" aria-hidden="true"></div>
                }
              </div>
              <ng-template appDataTableCell="estado" let-fila>
                <app-checkbox
                  [hideLabel]="true"
                  [label]="filaNombre(fila)"
                  [checked]="filaDisponible(fila)"
                  (onChange)="toggleUtensil(filaUtensil(fila))"
                  [attr.data-test]="'utensil-marcar-' + filaId(fila)"
                />
              </ng-template>
              <ng-template appDataTableCell="nombre" let-fila>
                <span class="celda-nombre">
                  <span>{{ filaNombre(fila) | catalog }}</span>
                </span>
              </ng-template>
              <ng-template appDataTableCell="acciones" let-fila>
                <span class="ingrediente-acciones">
                  <app-tooltip position="top" [text]="'common.delete' | t">
                    <button
                      type="button"
                      class="action-btn action-btn--danger utensil-card__delete"
                      [attr.aria-label]="'common.delete' | t"
                      (click)="deleteUtensil(filaUtensil(fila))"
                      [attr.data-test]="'utensil-borrar-' + filaId(fila)"
                    >
                      <app-icon name="delete" [size]="16" [label]="null" />
                    </button>
                  </app-tooltip>
                </span>
              </ng-template>
            </app-data-table>
          }

          <div class="utensils-add">
            <h3 class="utensils-add__title">
              <app-icon name="add" [size]="18" [label]="null" />
              <span>{{ 'pantry.no_encuentras_un_utensilio' | t }}</span>
            </h3>
            <p class="utensils-add__hint">
              {{ 'pantry.anade_los_que_no' | t }}
            </p>
            <app-button variant="secondary" size="sm" (onClick)="openUtensilModal()">
              {{ 'pantry.anadir_utensilio_personalizado' | t }}
            </app-button>
          </div>
        </div>
      </ng-container>

      <!-- Add/Edit Ingredient Modal -->
      <app-modal
        [isOpen]="isIngredientModalOpen()"
        [title]="
          editingIngredient()
            ? ('pantry.editar_ingrediente' | t)
            : ('pantry.agregar_ingrediente' | t)
        "
        size="md"
        (onClose)="closeIngredientModal()"
      >
        <form (ngSubmit)="saveIngredient()" class="ingredient-form">
          <app-input
            id="ingredientName"
            name="ingredientName"
            [label]="'auth.name' | t"
            [placeholder]="'pantry.ej_tomate' | t"
            [(ngModel)]="formData.name"
            [required]="true"
            [error]="formErrors.name()"
          ></app-input>

          <div class="form-row">
            <app-input
              id="quantity"
              name="quantity"
              type="number"
              [label]="'pantry.cantidad' | t"
              placeholder="0"
              [(ngModel)]="formData.quantity"
              [required]="true"
            ></app-input>

            <div class="form-field">
              <label class="form-label" for="pantry-ingredient-unit">{{
                'pantry.unidad' | t
              }}</label>
              <select
                id="pantry-ingredient-unit"
                [(ngModel)]="formData.unit"
                name="unit"
                class="form-select"
              >
                <option value="g">{{ 'pantry.gramos_g' | t }}</option>
                <option value="kg">{{ 'pantry.kilogramos_kg' | t }}</option>
                <option value="ml">{{ 'pantry.mililitros_ml' | t }}</option>
                <option value="l">{{ 'pantry.litros_l' | t }}</option>
                <option value="unit">{{ 'pantry.unidades' | t }}</option>
                <option value="cup">{{ 'pantry.tazas' | t }}</option>
                <option value="tbsp">{{ 'pantry.cucharadas' | t }}</option>
                <option value="tsp">{{ 'pantry.cucharaditas' | t }}</option>
              </select>
            </div>
          </div>

          <div class="form-row">
            <div class="form-field">
              <!--
                El select nativo se cae en la ## 12x por dos motivos: no se puede pintar con el tema (en Android
                abre el dialogo del sistema) y, sobre todo, no puede ensenar el catalogo de la casa —que desde
                esta tanda incluye lo que la familia haya anadido— con su punto de color y su subcategoria
                agrupada bajo su padre. El picker si, y es la pieza que el diseno ya tenia para esto.
              -->
              <app-picker
                [options]="opcionesCategoria()"
                [(value)]="formData.category"
                [label]="'pantry.categoria' | t"
                [placeholder]="'pantry.categoria' | t"
                data-test="pantry-picker-categoria"
              />
            </div>

            <div class="form-field">
              <!-- El segundo select que quedaba en el formulario, fuera por el mismo motivo que el de
                   categoria: no se pinta con el tema y no puede ensenar nada que el codigo no conozca. -->
              <app-picker
                [options]="opcionesUbicacion()"
                [value]="formData.location"
                (valueChange)="elegirUbicacion($event)"
                [label]="'pantry.ubicacion' | t"
                data-test="pantry-picker-ubicacion"
              />
            </div>
          </div>

          <app-input
            id="expiration"
            name="expiration"
            type="date"
            [label]="'pantry.fecha_de_caducidad_opcional' | t"
            [(ngModel)]="formData.expirationDate"
          ></app-input>

          <app-input
            id="notes"
            name="notes"
            [label]="'calendar.notas_opcional' | t"
            [placeholder]="'pantry.ej_comprado_ayer' | t"
            [(ngModel)]="formData.notes"
          ></app-input>

          <div class="form-actions">
            <app-button variant="ghost" type="button" (onClick)="closeIngredientModal()">{{
              'common.cancel' | t
            }}</app-button>
            <app-button variant="primary" type="submit" [loading]="isSaving()">
              {{ (editingIngredient() ? 'common.save' : 'pantry.agregar') | t }}
            </app-button>
          </div>
        </form>
      </app-modal>

      <!-- Add Custom Utensil Modal -->
      <app-modal
        [isOpen]="isUtensilModalOpen()"
        [title]="'pantry.agregar_utensilio' | t"
        size="md"
        (onClose)="closeUtensilModal()"
      >
        <form (ngSubmit)="saveUtensil()" class="utensil-form">
          <app-input
            id="utensilName"
            name="utensilName"
            [label]="'auth.name' | t"
            [placeholder]="'pantry.ej_sous_vide_panificadora' | t"
            [(ngModel)]="utensilForm.name"
            [required]="true"
            [error]="utensilFormError()"
          ></app-input>

          <div class="form-field">
            <label class="form-label" for="utensilCategory">{{ 'pantry.categoria' | t }}</label>
            <select
              id="utensilCategory"
              name="utensilCategory"
              class="form-select"
              [(ngModel)]="utensilForm.category"
            >
              <option *ngFor="let cat of utensilCategoryOptions" [value]="cat.value">
                {{ cat.labelKey | t }}
              </option>
            </select>
          </div>

          <label class="utensil-form__check">
            <input
              type="checkbox"
              id="utensilAvailable"
              name="utensilAvailable"
              [(ngModel)]="utensilForm.available"
            />
            <span>{{ 'pantry.lo_tengo_en_casa' | t }}</span>
          </label>

          <div class="form-actions">
            <app-button variant="ghost" type="button" (onClick)="closeUtensilModal()">{{
              'common.cancel' | t
            }}</app-button>
            <app-button variant="primary" type="submit" [loading]="isSavingUtensil()">{{
              'pantry.agregar' | t
            }}</app-button>
          </div>
        </form>
      </app-modal>
    </div>
  `,
  styles: [
    `
      .pantry {
        padding-block: var(--container-padding);
        max-width: 1000px;
        margin: 0 auto;
      }

      .pantry__header {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: var(--space-3);
        margin-bottom: var(--space-4);
      }
      .pantry__title-section {
        display: flex;
        align-items: baseline;
        gap: var(--space-3);
      }
      .pantry__title {
        font-family: var(--font-display);
        font-size: var(--text-2xl);
        font-weight: var(--font-bold);
      }

      .pantry__load-error {
        display: grid;
        justify-items: start;
        gap: var(--space-3);
      }

      .pantry__load-error-message {
        margin: 0;
        padding: var(--space-2) var(--space-3);
        border-radius: var(--radius-md);
        background: var(--error-subtle);
        color: var(--color-error-700);
        font-size: var(--text-sm);
      }

      /* Tabs */
      .pantry__tabs {
        display: flex;
        gap: var(--space-2);
        border-bottom: 1px solid var(--border-default);
        margin-bottom: var(--space-5);
      }
      .tab {
        background: none;
        border: none;
        padding: var(--space-3) var(--space-4);
        font-family: var(--font-sans);
        font-size: var(--text-sm);
        font-weight: var(--font-medium);
        color: var(--text-secondary);
        cursor: pointer;
        border-bottom: 2px solid transparent;
        display: inline-flex;
        align-items: center;
        gap: var(--space-2);
        transition: var(--transition-fast);
        &:hover {
          color: var(--text-primary);
        }
        &--active {
          color: var(--primary);
          border-bottom-color: var(--primary);
        }
      }
      .tab__count {
        background: var(--bg-tertiary);
        border-radius: var(--radius-full);
        padding: 1px 8px;
        font-size: var(--text-xs);
        color: var(--text-secondary);
      }
      .tab--active .tab__count {
        background: var(--primary-subtle);
        color: var(--primary-dark);
      }

      /* Stats: una franja profesional, no tres tarjetas sueltas (## 12aa). Una sola superficie con tres celdas
       separadas por un hilo, y la cifra en tabular-nums para que el numero no baile al refrescar. */
      .pantry__stats {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        margin-bottom: var(--space-5);
        background: var(--bg-secondary);
        border: 1px solid var(--border-default);
        border-radius: var(--radius-xl);
        overflow: hidden;
      }
      .stat-card {
        display: flex;
        align-items: center;
        gap: var(--space-3);
        min-width: 0;
        padding: var(--space-4);
        color: var(--text-secondary);
      }
      .stat-card + .stat-card {
        border-left: 1px solid var(--border-default);
      }
      .stat-card__icon {
        display: grid;
        place-items: center;
        flex: none;
      }
      .stat-card__content {
        display: flex;
        flex-direction: column;
        min-width: 0;
      }
      .stat-card__value {
        font-size: var(--text-xl);
        font-weight: var(--font-bold);
        font-variant-numeric: tabular-nums;
      }
      .stat-card__label {
        font-size: var(--text-xs);
        color: var(--text-secondary);
      }
      @media (max-width: 600px) {
        .pantry__header-acciones {
          width: 100%;
        }
        .pantry__stats {
          grid-template-columns: 1fr;
        }
        .stat-card + .stat-card {
          border-left: none;
          border-top: 1px solid var(--border-default);
        }
      }
      .stat-card--warning .stat-card__value {
        color: var(--warning);
      }
      .stat-card--danger .stat-card__value {
        color: var(--error);
      }

      .pantry__header-acciones {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--space-2);
      }

      .pantry__filters {
        display: flex;
        flex-wrap: wrap;
        align-items: flex-end;
        gap: var(--space-3) var(--space-4);
        margin-bottom: var(--space-5);
      }
      .pantry__buscar-tabla {
        max-width: 480px;
      }
      /* El filtro minimizado (## 12ab): un picker del sistema, no un riel con scroll. */
      .pantry__filtro-cat {
        flex: 0 1 280px;
        min-width: 200px;
      }
      /* La entrada al catalogo vive dentro de la pantalla del inventario y antes era una fila de botones sueltos:
       ahora es una franja con su superficie, su titulo a la izquierda y sus acciones a la derecha, alineada con
       el resto de bloques de la pagina. */
      .pantry__gestion {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: var(--space-3) var(--space-4);
        margin-bottom: var(--space-5);
        padding: var(--space-4);
        background: var(--bg-secondary);
        border: 1px solid var(--border-default);
        border-radius: var(--radius-xl);
      }
      .gestion__titulo {
        font-family: var(--font-display);
        font-size: var(--text-base);
        font-weight: var(--font-semibold);
        color: var(--text-primary);
        line-height: var(--leading-snug);
      }
      .gestion__acciones {
        display: flex;
        flex-wrap: wrap;
        gap: var(--space-2);
      }
      .gestion__enlace {
        display: inline-flex;
        align-items: center;
        gap: var(--space-2);
        padding: var(--space-2) var(--space-4);
        font: inherit;
        font-size: var(--text-sm);
        font-weight: var(--font-medium);
        color: var(--text-primary);
        background: var(--bg-tertiary);
        border: 1px solid var(--border-default);
        border-radius: var(--radius-full);
        cursor: pointer;
        transition: var(--transition-fast);
      }
      .gestion__enlace:hover {
        border-color: var(--border-strong);
        background: var(--primary-subtle);
      }
      .gestion__enlace:focus-visible {
        outline: 2px solid var(--primary);
        outline-offset: 2px;
      }

      /* La tabla del inventario (## 12ab): las piezas de siempre siguen vivas dentro de las celdas. */
      .ingredient-item__punto {
        flex: none;
        width: 12px;
        height: 12px;
        border-radius: var(--radius-full);
      }
      .celda-nombre {
        display: inline-flex;
        align-items: center;
        gap: var(--space-2);
        min-width: 0;
        font-weight: var(--font-medium);
      }
      /* El nombre enlaza a la ficha (## 12ai): subrayado solo al pasar, que la tabla ya grita
         bastante como para andar pintando enlaces por defecto en cada fila. */
      .celda-nombre__enlace {
        color: inherit;
        text-decoration: none;
        overflow-wrap: anywhere;
      }
      .celda-nombre__enlace:hover {
        text-decoration: underline;
        text-decoration-color: var(--primary);
        text-underline-offset: 3px;
      }
      .pantry__stock {
        display: inline-flex;
        align-items: center;
        gap: 2px;
      }
      /* 36px de boton para +/- en cada fila era un ladrillo: la mitad del alto de la fila se iba en el
         stepper (pedido ## 12af, «empéqueñelos»). 28 sigue siendo un blanco comodo y el icono manda. */
      .stock-btn {
        display: grid;
        place-items: center;
        width: 28px;
        height: 28px;
        color: var(--text-secondary);
        background: var(--bg-tertiary);
        border: 1px solid var(--border-default);
        border-radius: var(--radius-md);
        cursor: pointer;
        transition: var(--transition-fast);
      }
      .stock-btn:hover {
        color: var(--primary);
        border-color: var(--border-strong);
        background: var(--primary-subtle);
      }
      .stock-btn:focus-visible {
        outline: 2px solid var(--primary);
        outline-offset: 2px;
      }
      .ingredient-item__quantity {
        font-size: var(--text-xs);
        color: var(--text-secondary);
        font-variant-numeric: tabular-nums;
      }
      .celda-caducidad {
        display: inline-flex;
        align-items: center;
        gap: var(--space-2);
        flex-wrap: wrap;
      }
      .ingrediente-acciones {
        display: flex;
        gap: var(--space-1);
        justify-content: flex-end;
      }
      .action-btn {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 40px;
        height: 40px;
        border-radius: var(--radius-md);
        background: none;
        border: none;
        cursor: pointer;
        transition: var(--transition-fast);
        color: var(--text-secondary);
        &:hover {
          background: var(--bg-tertiary);
          color: var(--primary);
        }
        &:focus-visible {
          outline: 2px solid var(--primary);
          outline-offset: 2px;
        }
        &--danger:hover {
          background: var(--error-subtle);
          color: var(--error);
        }
      }
      @media (max-width: 719px), (pointer: coarse) {
        .stock-btn,
        .action-btn {
          min-width: 44px;
          min-height: 44px;
        }
      }
      /* ── lote flotante (## 12ad, regla F) ──
       Barra centrada abajo, por encima de la tarjeta pero por debajo de la hoja de filtros y su velo (55/60).
       El «empuje» es el hueco que deja la tarjeta para que la ultima fila jamas quede tapada por la barra. */
      .lote {
        position: fixed;
        left: 50%;
        transform: translateX(-50%);
        bottom: calc(var(--space-4) + env(safe-area-inset-bottom, 0px));
        z-index: 45;
        width: min(calc(100% - 2 * var(--space-4)), 1000px);
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--space-3);
        flex-wrap: wrap;
        padding: var(--space-2) var(--space-4);
        background: var(--bg-secondary);
        color: var(--text-primary);
        border: 1px solid var(--border-default);
        border-radius: var(--radius-lg);
        box-shadow: var(--shadow-lg);
      }
      /* Con la barra de navegacion inferior (<=1023px), el lote sube por encima, como los toasts. */
      @media (max-width: 1023px) {
        .lote {
          bottom: calc(
            var(--space-4) + var(--bottom-nav-height) + env(safe-area-inset-bottom, 0px)
          );
        }
      }
      .lote__empuje {
        height: 76px;
      }
      .lote__cta {
        font-size: var(--text-sm);
        font-weight: var(--font-semibold);
        color: var(--text-primary);
      }
      .lote__acciones {
        display: flex;
        align-items: center;
        gap: var(--space-2);
        flex-wrap: wrap;
      }
      .lote__btn {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        font: inherit;
        font-size: var(--text-xs);
        padding: 6px 12px;
        cursor: pointer;
        background: var(--bg-primary);
        color: var(--text-primary);
        border: 1px solid var(--border-default);
        border-radius: var(--radius-md);
        transition: var(--transition-fast);
      }
      .lote__btn:hover {
        border-color: var(--primary);
      }
      .lote__btn:focus-visible {
        outline: 2px solid var(--primary);
        outline-offset: 2px;
      }
      .lote__btn--peligro {
        color: var(--error);
      }
      .lote__btn--peligro:hover {
        border-color: var(--error);
        background: var(--error-subtle);
      }
      .lote__btn:disabled {
        opacity: 0.5;
        cursor: default;
      }
      .lote__x {
        display: grid;
        place-items: center;
        width: 32px;
        height: 32px;
        padding: 0;
        background: none;
        color: var(--text-secondary);
        border: 1px solid var(--border-default);
        border-radius: var(--radius-md);
        cursor: pointer;
        transition: var(--transition-fast);
      }
      .lote__x:hover {
        color: var(--error);
        border-color: var(--error);
        background: var(--error-subtle);
      }
      .lote__x:focus-visible {
        outline: 2px solid var(--primary);
        outline-offset: 2px;
      }

      /* Suggestions */
      .suggestions {
        background: var(--primary-subtle);
        border: 1px dashed var(--primary);
        border-radius: var(--radius-lg);
        padding: var(--space-4);
        margin-bottom: var(--space-5);
      }
      .suggestions__header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        flex-wrap: wrap;
        gap: var(--space-2);
      }
      /* Cerrado, el bloque se aprieta; abierto, respira antes de los chips. */
      .suggestions__header:has(+ .suggestions__chips) {
        margin-bottom: var(--space-3);
      }
      /* Cerrado por defecto (## 12ab): el contador y el verbo dicen que hay ocho cosas esperando. */
      .suggestions__toggle {
        display: inline-flex;
        align-items: center;
        gap: var(--space-2);
        font: inherit;
        font-size: var(--text-xs);
        color: var(--text-secondary);
        background: var(--bg-primary);
        border: 1px solid var(--border-default);
        border-radius: var(--radius-full);
        padding: 4px 10px;
        cursor: pointer;
        transition: var(--transition-fast);
      }
      .suggestions__toggle:hover {
        border-color: var(--border-strong);
        color: var(--text-primary);
      }
      .suggestions__toggle:focus-visible {
        outline: 2px solid var(--primary);
        outline-offset: 2px;
      }
      .suggestions__cuenta {
        font-weight: var(--font-semibold);
        color: var(--text-tertiary);
        font-variant-numeric: tabular-nums;
      }
      .suggestions__title {
        font-weight: var(--font-semibold);
        font-size: var(--text-sm);
      }
      .suggestions__hint {
        font-size: var(--text-xs);
        color: var(--text-secondary);
      }
      .suggestions__chips {
        display: flex;
        flex-wrap: wrap;
        gap: var(--space-2);
      }
      .chip {
        display: inline-flex;
        align-items: center;
        gap: var(--space-1);
        padding: 6px 10px;
        background: var(--bg-primary);
        border: 1px solid var(--border-default);
        border-radius: var(--radius-full);
        font-size: var(--text-xs);
        cursor: pointer;
        transition: var(--transition-fast);
        font-family: var(--font-sans);
        &:hover {
          border-color: var(--primary);
          background: var(--bg-primary);
          transform: translateY(-1px);
        }
      }
      .chip__punto {
        flex: none;
        width: 10px;
        height: 10px;
        border-radius: var(--radius-full);
      }
      .chip__plus {
        color: var(--primary);
        font-weight: var(--font-bold);
      }

      /* Utensils */
      .utensils-intro {
        background: var(--bg-secondary);
        border: 1px solid var(--border-default);
        border-radius: var(--radius-lg);
        padding: var(--space-3) var(--space-4);
        font-size: var(--text-sm);
        color: var(--text-secondary);
        margin-bottom: var(--space-5);
      }
      .utensils {
        display: flex;
        flex-direction: column;
      }
      /* Catalogo en tabla (## 12ab): meta arriba, busqueda propia, y la fila luce las clases de siempre. */
      .utensils-meta {
        display: flex;
        justify-content: flex-end;
        margin-bottom: var(--space-2);
      }
      .utensils-meta span {
        font-size: var(--text-xs);
        color: var(--text-secondary);
        font-variant-numeric: tabular-nums;
      }
      .utensils-buscar {
        max-width: 360px;
        margin-bottom: var(--space-4);
      }
      /* La pertenencia sigue viendose como la tarjeta de siempre: fondo verde suave en la fila entera. */
      :host ::ng-deep tr.utensil-card--owned {
        background: var(--success-subtle);
      }
      .utensil-card__delete {
        /* El boton de borrar del catalogo: en la tabla esta siempre visible (el riel de hover era de la rejilla). */
        width: 34px;
        height: 34px;
        font-size: 14px;
        opacity: 1;
      }
      .utensil-card__delete:hover {
        background: var(--error-subtle);
        color: var(--error);
      }
      .utensil-card__delete:focus-visible {
        outline: 2px solid var(--primary);
        outline-offset: 2px;
      }
      .utensils-add {
        background: var(--bg-secondary);
        border: 1px solid var(--border-default);
        border-radius: var(--radius-lg);
        padding: var(--space-4);
      }
      .utensils-add__title {
        display: flex;
        align-items: center;
        gap: var(--space-2);
        font-family: var(--font-display);
        font-size: var(--text-base);
        font-weight: var(--font-semibold);
        margin: 0 0 var(--space-2);
      }
      .utensils-add__hint {
        font-size: var(--text-sm);
        color: var(--text-secondary);
        margin: 0 0 var(--space-3);
      }
      .utensil-form {
        display: flex;
        flex-direction: column;
        gap: var(--space-4);
      }
      .utensil-form__check {
        display: flex;
        align-items: center;
        gap: var(--space-2);
        font-size: var(--text-sm);
        color: var(--text-primary);
        cursor: pointer;
      }

      /* Form */
      .ingredient-form {
        display: flex;
        flex-direction: column;
        gap: var(--space-4);
      }
      .form-row {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: var(--space-4);
      }
      .form-field {
        display: flex;
        flex-direction: column;
        gap: var(--space-1);
      }
      .form-label {
        font-size: var(--text-sm);
        font-weight: var(--font-medium);
        color: var(--text-primary);
      }
      .form-select,
      .form-input {
        width: 100%;
        padding: var(--space-2) var(--space-3);
        font-family: var(--font-sans);
        font-size: var(--text-sm);
        color: var(--text-primary);
        background: var(--bg-secondary);
        border: 1px solid var(--border-default);
        border-radius: var(--radius-lg);
        &:focus {
          outline: none;
          border-color: var(--primary);
        }
      }
      .form-actions {
        display: flex;
        justify-content: flex-end;
        gap: var(--space-3);
        margin-top: var(--space-4);
      }

      /* Empty */
      .empty-state {
        display: flex;
        flex-direction: column;
        align-items: center;
        padding: var(--space-12);
        text-align: center;
      }
      .empty-state__icon {
        display: flex;
        color: var(--text-tertiary);
        margin-bottom: var(--space-4);
      }
      .empty-state__title {
        font-family: var(--font-display);
        font-size: var(--text-xl);
        font-weight: var(--font-semibold);
        margin-bottom: var(--space-2);
      }
      .empty-state__text {
        font-size: var(--text-sm);
        color: var(--text-secondary);
        margin-bottom: var(--space-6);
      }

      @media (max-width: 480px) {
        .form-row {
          grid-template-columns: 1fr;
        }
      }
    `
  ]
})
export class PantryComponent implements OnInit {
  private readonly destroyRef = inject(DestroyRef);
  private readonly i18n = inject(I18nService);
  private readonly document = inject(DOCUMENT);
  private readonly pendingStockFocusCleanups = new Set<() => void>();
  pantryService = inject(PantryService);
  private toastService = inject(ToastService);
  private confirmService = inject(ConfirmService);

  // Tabs
  activeTab = signal<PantryTab>('ingredients');

  /** El boton "+ Agregar" abre el modal de la pestaña activa. */
  addButtonLabel = computed(() =>
    // Regla 18 (12t-i18n): la condicion decide la clave, el diccionario decide la frase.
    this.i18n.t(
      this.activeTab() === 'utensils' ? 'pantry.mas_agregar_utensilio' : 'pantry.mas_agregar'
    )
  );

  // Ingredients
  /** Busqueda instantanea sobre lo cargado (## 12ab): signal + URL, ya no se llama al server por tecla. */
  searchTerm = signal('');
  filtroCategoria = signal('');
  sugerenciasAbiertas = signal(false);
  inventoryLoadError = signal(false);
  /** La seleccion del lote es de esta visita: no viaja en la URL (igual que en el gestor de productos). */
  inventarioSeleccion = signal<readonly unknown[]>([]);
  utensiliosSeleccion = signal<readonly unknown[]>([]);
  utensiliosQ = signal('');
  private readonly tablaInv = viewChild<DataTableComponent>('tablaInv');
  private readonly tablaUti = viewChild<DataTableComponent>('tablaUti');

  isIngredientModalOpen = signal(false);
  editingIngredient = signal<Ingredient | null>(null);
  isSaving = signal(false);
  utensilsLoading = signal(true);
  formErrors = { name: signal(''), quantity: signal('') };

  // Utensilios: modal de alta (el boton "+ Agregar" lo abre en esta pestaña)
  isUtensilModalOpen = signal(false);
  isSavingUtensil = signal(false);
  utensilFormError = signal('');
  utensilForm = {
    name: '',
    category: 'tools' as UtensilCategory,
    available: true
  };

  /** El inventario entero de la casa, sin filtros: de aqui salen tablas, cuentas y sugerencias. */
  ingredientesTodos = computed(() => this.pantryService.ingredients());

  ownedUtensilsCount = computed(
    () => this.pantryService.utensils().filter((u) => u.available).length
  );
  utensilTotal = computed(() => this.pantryService.utensils().length);

  /** `quitarAcentos` no cambia las mayusculas: aqui si, que una busqueda que distingue el caso miente. */
  private coincideBusqueda(nombre: string): boolean {
    const q = this.searchTerm().trim();
    if (!q) return true;
    return quitarAcentos(nombre.toLowerCase()).includes(quitarAcentos(q.toLowerCase()));
  }

  /** El subarbol elegido: «Alimentos» trae tambien sus hijas, igual que hacia el server (## 12aa). */
  private clavesFiltro(): Set<string> | null {
    const raiz = this.filtroCategoria();
    if (!raiz) return null;
    return clavesSubarbolDe(this.pantryService.categories(), raiz);
  }

  /** Las filas del inventario: cantidad > 0 y con la busqueda y el subarbol puestos (el server ya no filtra). */
  filasInventario = computed(() => {
    const claves = this.clavesFiltro();
    return this.ingredientesTodos().filter(
      (i) =>
        (i.quantity ?? 0) > 0 &&
        this.coincideBusqueda(i.name) &&
        (!claves || claves.has(i.category ?? 'other'))
    );
  });

  /**
   * Si la casa tiene algo, la tabla se queda montada aunque la busqueda no acierte: quien escribe tiene que
   * poder limpiar el campo sin cazar un fantasma (## 12ad, regla E).
   */
  hayInventario = computed(() => this.ingredientesTodos().some((i) => (i.quantity ?? 0) > 0));

  /** Lo que la casa conoce pero no tiene: mismas reglas, cantidad a cero. */
  suggestions = computed(() => {
    const claves = this.clavesFiltro();
    return this.ingredientesTodos().filter(
      (i) =>
        (i.quantity ?? 0) <= 0 &&
        this.coincideBusqueda(i.name) &&
        (!claves || claves.has(i.category ?? 'other'))
    );
  });

  /** La cuenta de la cabecera es siempre el total de la casa: no depende de los filtros puestos. */
  inPantryCount = computed(
    () => this.ingredientesTodos().filter((i) => (i.quantity ?? 0) > 0).length
  );

  /** Utensilios por la busqueda; el orden, la pagina y los filtros de columna los ve la tabla (## 12ab). */
  utensiliosFiltrados = computed(() => {
    const q = this.utensiliosQ().trim();
    // El «tengo» llega 0/1 del server y true/false del guardado optimista: si se cuela la forma cruda, el
    // menu de la columna «estado» agrupa dos veces el mismo estado. Se normaliza al entrar en la tabla.
    const crudos = this.pantryService.utensils();
    const todos = crudos.some((u) => u.available !== !!u.available)
      ? crudos.map((u) => ({ ...u, available: !!u.available }))
      : crudos;
    if (!q) return todos;
    return todos.filter((u) =>
      quitarAcentos(u.name.toLowerCase()).includes(quitarAcentos(q.toLowerCase()))
    );
  });

  /** Las siete columnas del inventario; las etiquetas, traducidas al vuelo (## 12ab). */
  columnasInventario = computed<DataTableColumna[]>(() => {
    this.i18n.changeTick();
    const catalogo = new Map(this.pantryService.categories().map((cat) => [cat.key, cat]));
    const ubicaciones: Record<string, TranslationKey> = {
      fridge: 'pantry.nevera',
      freezer: 'pantry.congelador',
      pantry: 'pantry.title',
      counter: 'pantry.encimera'
    };
    return [
      { clave: 'name', etiqueta: this.i18n.t('pantry.columna_nombre'), celda: 'nombre' },
      {
        clave: 'quantity',
        etiqueta: this.i18n.t('pantry.cantidad'),
        tipo: 'numero',
        celda: 'cantidad',
        alineacion: 'start'
      },
      { clave: 'unit', etiqueta: this.i18n.t('pantry.unidad'), filtrable: true },
      {
        clave: 'category',
        etiqueta: this.i18n.t('pantry.categoria'),
        etiquetaValor: (v) => {
          const cat = catalogo.get(String(v));
          return cat ? pantryCategoryLabel(cat, (key) => this.i18n.t(key)) : String(v);
        }
      },
      {
        clave: 'expirationDate',
        etiqueta: this.i18n.t('pantry.caducidad_producto'),
        tipo: 'fecha',
        celda: 'caducidad'
      },
      {
        clave: 'location',
        etiqueta: this.i18n.t('pantry.ubicacion'),
        etiquetaValor: (v) => this.i18n.t(ubicaciones[String(v)] ?? 'pantry.title')
      },
      {
        clave: 'acciones',
        etiqueta: this.i18n.t('pantry.acciones'),
        celda: 'acciones',
        ordenable: false,
        filtrable: false,
        alineacion: 'end',
        ancho: '88px'
      }
    ];
  });

  /** Las cuatro del catalogo de utensilios; «estado» filtra por disponible / no disponible. */
  columnasUtensilios = computed<DataTableColumna[]>(() => {
    this.i18n.changeTick();
    const etiquetas = new Map<string, string>(
      this.utensilCategoryOptions.map((op) => [String(op.value), this.i18n.t(op.labelKey)])
    );
    return [
      { clave: 'name', etiqueta: this.i18n.t('pantry.columna_nombre'), celda: 'nombre' },
      {
        clave: 'category',
        etiqueta: this.i18n.t('pantry.categoria'),
        etiquetaValor: (v) => etiquetas.get(String(v)) ?? String(v)
      },
      {
        clave: 'available',
        etiqueta: this.i18n.t('pantry.estado'),
        tipo: 'booleano',
        celda: 'estado',
        // El menu de la columna pasa la clave ya empaquetada ('true'/'false'), no el booleano: hay que
        // destiparla aqui o todo el mundo sale «no disponible» (## 12ab, rojo de la sonda).
        etiquetaValor: (v) =>
          valorTipado(v, 'booleano') === true
            ? this.i18n.t('pantry.disponible')
            : this.i18n.t('pantry.no_disponible')
      },
      {
        clave: 'acciones',
        etiqueta: this.i18n.t('pantry.acciones'),
        celda: 'acciones',
        ordenable: false,
        filtrable: false,
        alineacion: 'end',
        ancho: '64px'
      }
    ];
  });

  /** El filtro de categorias minimizado: un picker del sistema con cuentas y color, no un riel con scroll. */
  opcionesFiltroCategoria = computed<PickerOption[]>(() => {
    this.i18n.changeTick();
    const catalogo = this.pantryService.categories();
    const base: PickerOption[] = [{ value: '', label: this.i18n.t('pantry.categoria_todos') }];
    if (catalogo.length === 0) {
      return [
        ...base,
        ...this.ingredientCategoriesNoAll.map((cat) => ({
          value: cat.value as string,
          label: this.i18n.t(cat.labelKey)
        }))
      ];
    }
    return [
      ...base,
      ...catalogo.map((cat) => {
        const etiqueta = pantryCategoryLabel(cat, (key) => this.i18n.t(key));
        const cuenta = cat.counts?.descendantProducts ?? cat.counts?.products ?? 0;
        return {
          value: cat.key,
          label: cuenta > 0 ? `${etiqueta} · ${cuenta}` : etiqueta,
          color: cat.color ?? undefined,
          group: cat.parentName ?? undefined
        } satisfies PickerOption;
      })
    ];
  });

  // ── helpers de las celdas proyectadas ──
  /** El contexto de las plantillas llega como `unknown` (la tabla no conoce el modelo); aqui se viste. */
  protected filaId(fila: unknown): string {
    return String((fila as { id: string }).id);
  }

  /** El href de la ficha del articulo (## 12ai): de verdad, para que el boton central del raton
   *  y el «abrir en pestana nueva» sigan siendo un enlace y no un boton disfrazado. */
  protected hrefDeItem(fila: unknown): string {
    return `/pantry/inventario/${this.filaId(fila)}`;
  }

  protected abrirItem(fila: unknown, event: Event): void {
    event.preventDefault();
    void this.router.navigate(['/pantry', 'inventario', this.filaId(fila)]);
  }

  protected filaNombre(fila: unknown): string {
    return String((fila as { name: string }).name ?? '');
  }
  protected filaCat(fila: unknown): PantryCategoryKey | undefined {
    return (fila as { category?: PantryCategoryKey }).category;
  }
  protected filaIngrediente(fila: unknown): Ingredient {
    return fila as Ingredient;
  }
  protected filaUtensil(fila: unknown): Utensil {
    return fila as Utensil;
  }
  protected filaCantidad(fila: unknown): string {
    const i = fila as Ingredient;
    return `${i.quantity} ${i.unit}`;
  }
  protected filaDisponible(fila: unknown): boolean {
    return !!(fila as Utensil).available;
  }
  /** La fecha en dd/mm/aaaa, como en el gestor: la tabla recibe el dato crudo y aqui se viste. */
  protected filaCaducidad(fila: unknown): string {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(
      String((fila as { expirationDate?: string | null }).expirationDate ?? '')
    );
    return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
  }

  protected readonly identificadorDeFila = (fila: unknown): string =>
    String((fila as { id?: string }).id ?? '');
  protected readonly nombreDeFila = (fila: unknown): string =>
    String((fila as { name?: string }).name ?? '');
  /** Las clases de siempre, para que la fila siga pareciendo lo que era. */
  protected readonly claseFilaInv = (): string => 'ingredient-item';
  protected readonly claseFilaUti = (fila: unknown): string =>
    'utensil-card' + ((fila as Utensil).available ? ' utensil-card--owned' : '');

  // ── lote (## 12ab): vaciar = PATCH {quantity:0} en bucle; borrar = DELETE en bucle, con confirmacion ──
  protected loteAnular(): void {
    this.tablaInv()?.limpiarSeleccion();
  }
  protected loteUtensiliosAnular(): void {
    this.tablaUti()?.limpiarSeleccion();
  }

  protected async loteVaciar(): Promise<void> {
    const ids = this.inventarioSeleccion()
      .map((f) => this.identificadorDeFila(f))
      .filter(Boolean);
    if (ids.length === 0) return;
    const aceptado = await this.confirmService.confirm({
      title: this.i18n.t('pantry.lote_titulo_vaciar'),
      message: this.i18n.t('pantry.lote_pregunta_vaciar', { n: ids.length }),
      confirmText: this.i18n.t('pantry.lote_vaciar')
    });
    if (!aceptado) return;
    await Promise.all(
      ids.map(async (id) => {
        try {
          await firstValueFrom(this.pantryService.updateIngredient(id, { quantity: 0 }));
        } catch {
          /* la recarga pinta lo que haya vuelto; el error ya lo grita el interceptor */
        }
      })
    );
    this.tablaInv()?.limpiarSeleccion();
    await this.recargarInventario();
    this.toastService.success(this.i18n.t('pantry.lote_vaciados', { n: ids.length }));
  }

  protected async loteBorrar(): Promise<void> {
    const filas = this.inventarioSeleccion()
      .map((f) => f as Ingredient)
      .filter((f) => !!f?.id);
    if (filas.length === 0) return;
    const aceptado = await this.confirmService.confirm({
      title: this.i18n.t('pantry.lote_titulo_borrar'),
      message: this.i18n.t('pantry.lote_pregunta_borrar', { n: filas.length }),
      confirmText: this.i18n.t('pantry.lote_borrar')
    });
    if (!aceptado) return;
    await Promise.all(
      filas.map(async (f) => {
        try {
          await firstValueFrom(this.pantryService.deleteIngredient(f.id));
        } catch {
          /* idem: la recarga deja el mapa como esta en el server */
        }
      })
    );
    this.tablaInv()?.limpiarSeleccion();
    await this.recargarInventario();
    this.toastService.success(this.i18n.t('pantry.lote_borrados', { n: filas.length }));
  }

  protected async loteUtensilios(disponibles: boolean): Promise<void> {
    const ids = this.utensiliosSeleccion()
      .map((f) => this.identificadorDeFila(f))
      .filter(Boolean);
    if (ids.length === 0) return;
    await Promise.all(
      ids.map(async (id) => {
        try {
          await firstValueFrom(this.pantryService.updateUtensil(id, { available: disponibles }));
        } catch {
          /* la lista se recarga al final y pinta la realidad */
        }
      })
    );
    this.tablaUti()?.limpiarSeleccion();
    this.loadUtensils();
    this.toastService.success(
      this.i18n.t('pantry.lote_utensilios_actualizados', { n: ids.length })
    );
  }

  private router = inject(Router);
  private route = inject(ActivatedRoute);

  /**
   * La pestaña activa viaja en la URL (?tab=utensils), igual que en el resto de vistas con pestañas de
   * la aplicacion. Busqueda y subarbol tambien (`?buscar=`, `?category=`, ## 12ab): pantalla enlazable
   * y a prueba de F5. `?section=` ya no existe: la tabla del catalogo lo sustituye.
   */
  constructor() {
    this.destroyRef.onDestroy(() => {
      for (const cleanup of this.pendingStockFocusCleanups) cleanup();
    });

    syncTabWithUrl<PantryTab>({
      param: 'tab',
      values: PANTRY_TABS,
      fallback: 'ingredients',
      current: () => this.activeTab(),
      onChange: (tab) => this.activeTab.set(tab)
    });
  }

  formData = {
    name: '',
    quantity: 0,
    unit: 'g' as MeasurementUnit,
    category: 'other' as PantryCategoryKey,
    location: 'pantry' as StorageLocation,
    expirationDate: '',
    notes: ''
  };

  /**
   * Las categorias de la despensa. `labelKey`, no `label`: el catalogo se pinta en tres sitios (los chips
   * del filtro, el selector del alta y el grupo de utensilios) y escribir la frase aqui era tenerla en
   * espanol en los tres, con el idioma cambiado (HOGARIA-SPEC ## 12u).
   */
  ingredientCategoriesNoAll: {
    value: IngredientCategory;
    labelKey: TranslationKey;
  }[] = [
    { value: 'vegetables', labelKey: 'pantry.categoria_verduras' },
    { value: 'fruits', labelKey: 'pantry.categoria_frutas' },
    { value: 'meat', labelKey: 'pantry.categoria_carnes' },
    { value: 'fish', labelKey: 'pantry.categoria_pescados' },
    { value: 'dairy', labelKey: 'pantry.categoria_lacteos' },
    { value: 'grains', labelKey: 'pantry.categoria_cereales' },
    { value: 'spices', labelKey: 'pantry.categoria_especias' },
    { value: 'condiments', labelKey: 'pantry.categoria_condimentos' },
    { value: 'frozen', labelKey: 'pantry.categoria_congelados' },
    { value: 'canned', labelKey: 'pantry.categoria_enlatados' },
    { value: 'beverages', labelKey: 'pantry.categoria_bebidas' },
    { value: 'other', labelKey: 'pantry.categoria_otros' }
  ];
  /** Las cuatro guardas de siempre, en un picker (## 12x: se quitan los `select` nativos del formulario). */
  readonly opcionesUbicacion = computed<PickerOption[]>(() => {
    this.i18n.changeTick();
    return [
      { value: 'fridge', label: this.i18n.t('pantry.nevera') },
      { value: 'freezer', label: this.i18n.t('pantry.congelador') },
      { value: 'pantry', label: this.i18n.t('pantry.title') },
      { value: 'counter', label: this.i18n.t('pantry.encimera') }
    ];
  });

  protected elegirUbicacion(valor: string | null): void {
    this.formData.location = (valor ?? 'pantry') as StorageLocation;
  }

  /** El gestor del catalogo de la casa: dos rutas, no dos modales. */
  protected abrirGestor(destino: 'categories' | 'products' | 'catalogo'): void {
    void this.router.navigate(['/pantry', destino]);
  }

  protected abrirCatalogo(): void {
    void this.router.navigate(['/pantry', 'catalogo']);
  }

  /** La pantalla de caducidades (## 12ak): misma familia que el catalogo, URL propia. */
  protected irACaducidades(): void {
    void this.router.navigate(['/pantry', 'caducidades']);
  }

  /** El punto de color de la fila y de la sugerencia: el dato de la categoria, ya cargada, no un emoji por clave. */
  protected colorDe(clave: PantryCategoryKey | null | undefined): string {
    if (!clave) return colorDeCategoria(undefined);
    return colorDeCategoria(this.pantryService.categories().find((cat) => cat.key === clave));
  }

  /** Las opciones del picker de categoria, con su color y las subcategorias agrupadas bajo su padre. */
  readonly opcionesCategoria = computed<PickerOption[]>(() => {
    this.i18n.changeTick();
    const catalogo = this.pantryService.categories();
    if (catalogo.length === 0) {
      return this.ingredientCategoriesNoAll.map((cat) => ({
        value: cat.value as string,
        label: this.i18n.t(cat.labelKey)
      }));
    }
    return catalogo.map((cat) => ({
      value: cat.key,
      label: pantryCategoryLabel(cat, (key) => this.i18n.t(key)),
      color: cat.color,
      group: cat.parentName ?? undefined,
      hint:
        cat.counts.products > 0
          ? this.i18n.t('pantry.cuenta_articulos', { n: cat.counts.products })
          : undefined
    }));
  });

  /** Opciones del catálogo de utensilios (orden de secciones incluido). */
  utensilCategoryOptions: { value: UtensilCategory; labelKey: TranslationKey }[] = [
    { value: 'oven', labelKey: 'pantry.utensilio_horno' },
    { value: 'microwave', labelKey: 'pantry.utensilio_microondas' },
    { value: 'airfryer', labelKey: 'pantry.utensilio_freidora' },
    { value: 'stovetop', labelKey: 'pantry.utensilio_cocina' },
    { value: 'blender', labelKey: 'pantry.utensilio_batidora_vaso' },
    { value: 'mixer', labelKey: 'pantry.utensilio_batidora_mano' },
    { value: 'food-processor', labelKey: 'pantry.utensilio_procesador' },
    { value: 'cookware', labelKey: 'pantry.utensilio_ollas' },
    { value: 'bakeware', labelKey: 'pantry.utensilio_horneado' },
    { value: 'tools', labelKey: 'pantry.utensilio_herramientas' }
  ];

  ngOnInit(): void {
    // El catalogo de categorias (## 12x): el picker del filtro, la columna y el color del punto salen de el.
    this.pantryService.loadCategories();
    // `?buscar=` llega del boton «ver en la despensa» del gestor y `?category=` es el subarbol elegido:
    // los dos viajan en la URL (## 12ab), se leen al montar y se reescriben al cambiar —enlazable y a
    // prueba de F5 sin depender de que el server recuerde nada—.
    const query = this.route.snapshot.queryParamMap;
    const busqueda = query.get('buscar');
    if (busqueda) this.searchTerm.set(busqueda);
    const categoria = query.get('category');
    if (categoria) this.filtroCategoria.set(categoria);
    void this.recargarInventario();
    void this.loadUtensils();
  }

  private async loadUtensils(): Promise<void> {
    this.utensilsLoading.set(true);
    try {
      await firstValueFrom(this.pantryService.loadUtensils());
    } catch {
      /* el interceptor ya avisa; la pantalla enseña el empty-state de siempre */
    }
    this.utensilsLoading.set(false);
  }

  switchTab(tab: PantryTab): void {
    this.activeTab.set(tab);
  }

  /** La busqueda es instantanea sobre lo cargado; la URL solo guarda el estado compartible. */
  escribirBusqueda(valor: string): void {
    this.searchTerm.set(valor ?? '');
    void this.escribirUrl();
  }

  elegirCategoria(valor: string | null): void {
    this.filtroCategoria.set(valor ?? '');
    void this.escribirUrl();
  }

  alternarSugerencias(): void {
    this.sugerenciasAbiertas.update((abierto) => !abierto);
  }

  /** `?tab=`, `?buscar=` y `?category=` son todo el estado viajero de esta pantalla (## 12ab). */
  private async escribirUrl(): Promise<void> {
    const queryParams: Record<string, string> = {};
    const tab = this.activeTab();
    if (tab !== 'ingredients') queryParams['tab'] = tab;
    const busqueda = this.searchTerm().trim();
    if (busqueda) queryParams['buscar'] = busqueda;
    if (this.filtroCategoria()) queryParams['category'] = this.filtroCategoria();

    const actual = this.route.snapshot.queryParamMap;
    const mismo =
      (actual.get('tab') ?? '') === (queryParams['tab'] ?? '') &&
      (actual.get('buscar') ?? '') === (queryParams['buscar'] ?? '') &&
      (actual.get('category') ?? '') === (queryParams['category'] ?? '');
    if (mismo) return;

    await this.router.navigate(['/pantry'], { queryParams, replaceUrl: true });
  }

  /** El boton del header abre el modal de lo que se esta viendo. */
  // ── el stepper de cantidad (## 12aa) ──
  // El PATCH de `ingredients/:id` es el mismo del modal de edicion, y ahi esta la gracia: el stepper no es una
  // segunda forma de cambiar algo, es un atajo a lo mismo. Bajar a 0 NO borra la fila: deja el producto en «lo
  // que la casa conoce y no tiene» (la semantica de `staples` de la ## 12x) y la fila vuelve a las sugerencias.

  anadirUnidad(ingrediente: Ingredient, event?: Event): void {
    this.moverStock(ingrediente, 1, event);
  }

  quitarUnidad(ingrediente: Ingredient, event?: Event): void {
    this.moverStock(ingrediente, -1, event);
  }

  private moverStock(ingrediente: Ingredient, delta: number, event?: Event): void {
    const siguiente = Math.max(0, (ingrediente.quantity ?? 0) + delta);
    if (siguiente === ingrediente.quantity) return;
    const sourceButton = (event?.currentTarget as HTMLButtonElement | null) ?? null;
    const dataTest = sourceButton?.getAttribute('data-test');
    const shouldRestoreFocus = this.document.activeElement === sourceButton;
    let focusDataTest = dataTest;
    let focusSourceButton = sourceButton;
    let restoreFocus = shouldRestoreFocus;
    let focusTrackingDisposed = false;
    const trackPantryActionFocus = (event: FocusEvent): void => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target === this.document.body || target === this.document.documentElement) return;

      const actionButton = target.closest<HTMLButtonElement>(
        'button[data-test^="pantry-stock-"], button[data-test^="pantry-editar-"], button[data-test^="pantry-eliminar-"]'
      );
      const activeDataTest = actionButton?.getAttribute('data-test');
      if (actionButton && this.esAccionDeFilaPantry(activeDataTest)) {
        focusDataTest = activeDataTest;
        focusSourceButton = actionButton;
        restoreFocus = true;
        return;
      }

      focusDataTest = undefined;
      focusSourceButton = null;
      restoreFocus = false;
    };
    const stopTrackingFocus = (): void => {
      focusTrackingDisposed = true;
      if (shouldRestoreFocus) {
        this.document.removeEventListener('focusin', trackPantryActionFocus);
        this.pendingStockFocusCleanups.delete(stopTrackingFocus);
      }
    };
    if (shouldRestoreFocus) {
      this.document.addEventListener('focusin', trackPantryActionFocus);
      this.pendingStockFocusCleanups.add(stopTrackingFocus);
    }

    this.pantryService.updateIngredient(ingrediente.id, { quantity: siguiente }).subscribe({
      next: () => {
        void this.recargarInventario()
          .then(() => {
            if (!focusTrackingDisposed) {
              this.restaurarFocoAccionInventario(focusDataTest, focusSourceButton, restoreFocus);
            }
          })
          .finally(stopTrackingFocus);
      },
      error: stopTrackingFocus
    });
  }

  private esAccionDeFilaPantry(dataTest: string | null | undefined): dataTest is string {
    return (
      dataTest?.startsWith('pantry-stock-mas-') === true ||
      dataTest?.startsWith('pantry-stock-menos-') === true ||
      dataTest?.startsWith('pantry-editar-') === true ||
      dataTest?.startsWith('pantry-eliminar-') === true
    );
  }

  private restaurarFocoAccionInventario(
    dataTest: string | null | undefined,
    sourceButton: HTMLButtonElement | null,
    shouldRestoreFocus: boolean
  ): void {
    if (!dataTest || !shouldRestoreFocus) return;
    const actionPrefix = [
      'pantry-stock-mas-',
      'pantry-stock-menos-',
      'pantry-editar-',
      'pantry-eliminar-'
    ].find((prefix) => dataTest.startsWith(prefix));
    if (!actionPrefix) return;
    const view = this.document.defaultView;
    view?.requestAnimationFrame(() => {
      view.requestAnimationFrame(() => {
        const activeElement = this.document.activeElement;
        const focusWasLostWithTheRow =
          activeElement === this.document.body ||
          activeElement === this.document.documentElement ||
          activeElement === sourceButton;
        if (!focusWasLostWithTheRow) return;
        if (activeElement === sourceButton && sourceButton?.isConnected) return;

        const stepperButtons = Array.from(
          this.document.querySelectorAll<HTMLButtonElement>(
            'button[data-test^="pantry-stock-"], button[data-test^="pantry-editar-"], button[data-test^="pantry-eliminar-"]'
          )
        );
        const isFullyVisible = (candidate: HTMLButtonElement): boolean => {
          const rect = candidate.getBoundingClientRect();
          return (
            candidate.getClientRects().length > 0 &&
            rect.width > 0 &&
            rect.height > 0 &&
            rect.top >= 0 &&
            rect.left >= 0 &&
            rect.bottom <= view.innerHeight &&
            rect.right <= view.innerWidth
          );
        };
        const button =
          stepperButtons.find((candidate) => candidate.getAttribute('data-test') === dataTest) ??
          stepperButtons.find(
            (candidate) =>
              candidate.getAttribute('data-test')?.startsWith(actionPrefix) &&
              isFullyVisible(candidate)
          ) ??
          this.document.querySelector<HTMLButtonElement>(
            'app-button[data-test="pantry-agregar"] button'
          );
        button?.focus();
      });
    });
  }

  openAddModal(prefill?: Partial<typeof this.formData>): void {
    if (this.activeTab() === 'utensils') {
      this.openUtensilModal();
      return;
    }

    this.editingIngredient.set(null);
    this.resetForm();
    if (prefill) Object.assign(this.formData, prefill);
    this.isIngredientModalOpen.set(true);
  }

  editIngredient(ingredient: Ingredient): void {
    this.editingIngredient.set(ingredient);
    this.formData = {
      name: ingredient.name,
      quantity: ingredient.quantity,
      unit: ingredient.unit,
      category: ingredient.category,
      location: ingredient.location,
      // `toDayKey` y no `toISOString()`: una fecha de caducidad es un DIA, y pasarla por un
      // instante la movia media jornada arriba o abajo segun la zona del dispositivo.
      expirationDate: toDayKey(ingredient.expirationDate),
      notes: ingredient.notes || ''
    };
    this.isIngredientModalOpen.set(true);
  }

  closeIngredientModal(): void {
    this.isIngredientModalOpen.set(false);
    this.editingIngredient.set(null);
    this.resetForm();
  }

  quickAddSuggestion(ing: Ingredient): void {
    // Open modal pre-filled; user sets quantity/unit/location
    this.openAddModal({
      name: ing.name,
      category: ing.category,
      unit: ing.unit,
      location: ing.location || 'pantry'
    });
  }

  /** El inventario entero y las stats detras: lo que llama toda mutacion de filas (## 12ab). */
  private recargarInventario(): Promise<void> {
    this.inventoryLoadError.set(false);
    return this.pantryService.cargarInventarioCompleto().then(
      () => {
        this.inventoryLoadError.set(false);
        this.pantryService.loadStats();
      },
      () => {
        this.inventoryLoadError.set(true);
      }
    );
  }

  reintentarCargaInventario(): Promise<void> {
    return this.recargarInventario();
  }

  saveIngredient(): void {
    this.formErrors.name.set('');
    this.formErrors.quantity.set('');
    if (!this.formData.name) {
      this.formErrors.name.set(this.i18n.t('pantry.el_nombre_es_requerido'));
      return;
    }
    if (!this.formData.quantity || this.formData.quantity <= 0) {
      this.formErrors.quantity.set(this.i18n.t('pantry.la_cantidad_debe_ser'));
      return;
    }
    this.isSaving.set(true);
    const data = { ...this.formData, expirationDate: this.formData.expirationDate || undefined };
    const obs = this.editingIngredient()
      ? this.pantryService.updateIngredient(this.editingIngredient()!.id, data)
      : this.pantryService.createIngredient(data);
    obs.subscribe({
      next: () => {
        this.toastService.success(
          this.editingIngredient()
            ? this.i18n.t('ai_config.actualizado')
            : this.i18n.t('pantry.agregado'),
          this.i18n.t(
            this.editingIngredient()
              ? 'pantry.ingrediente_actualizado'
              : 'pantry.ingrediente_agregado',
            { name: this.formData.name }
          )
        );
        this.closeIngredientModal();
        this.isSaving.set(false);
        void this.recargarInventario();
      },
      error: () => {
        this.toastService.error(this.i18n.t('ui.error'), this.i18n.t('pantry.no_se_pudo_guardar'));
        this.isSaving.set(false);
      }
    });
  }

  async deleteIngredient(ingredient: Ingredient): Promise<void> {
    const accepted = await this.confirmService.confirm({
      title: this.i18n.t('pantry.eliminar_ingrediente'),
      message: this.i18n.t('pantry.eliminar_de_la_despensa', { name: ingredient.name }),
      confirmText: this.i18n.t('common.delete')
    });
    if (!accepted) return;

    this.pantryService.deleteIngredient(ingredient.id).subscribe({
      next: () => {
        this.toastService.success(
          this.i18n.t('pantry.eliminado'),
          this.i18n.t('pantry.nombre_eliminado', { name: ingredient.name })
        );
        void this.recargarInventario();
      },
      error: () =>
        this.toastService.error(this.i18n.t('ui.error'), this.i18n.t('pantry.no_se_pudo_eliminar'))
    });
  }

  // Utensils
  toggleUtensil(u: Utensil): void {
    this.pantryService.updateUtensil(u.id, { available: !u.available }).subscribe({
      next: () =>
        this.toastService.success(
          u.available ? this.i18n.t('pantry.quitado') : this.i18n.t('pantry.anadido'),
          u.available
            ? this.i18n.t('pantry.utensilio_quitado', { name: u.name })
            : this.i18n.t('pantry.utensilio_anadido', { name: u.name })
        ),
      error: () =>
        this.toastService.error(
          this.i18n.t('ui.error'),
          this.i18n.t('household.no_se_pudo_actualizar')
        )
    });
  }

  async deleteUtensil(u: Utensil): Promise<void> {
    const accepted = await this.confirmService.confirm({
      title: this.i18n.t('pantry.eliminar_utensilio'),
      message: this.i18n.t('pantry.quitar_del_catalogo', { name: u.name }),
      confirmText: this.i18n.t('common.delete')
    });
    if (!accepted) return;

    this.pantryService.deleteUtensil(u.id).subscribe({
      next: () =>
        this.toastService.success(
          this.i18n.t('pantry.eliminado'),
          this.i18n.t('pantry.nombre_eliminado', { name: u.name })
        ),
      error: () =>
        this.toastService.error(this.i18n.t('ui.error'), this.i18n.t('pantry.no_se_pudo_eliminar'))
    });
  }

  // Add custom utensil (modal)

  openUtensilModal(): void {
    this.utensilForm = { name: '', category: 'tools', available: true };
    this.utensilFormError.set('');
    this.isUtensilModalOpen.set(true);
  }

  closeUtensilModal(): void {
    this.isUtensilModalOpen.set(false);
    this.utensilForm = { name: '', category: 'tools', available: true };
    this.utensilFormError.set('');
  }

  saveUtensil(): void {
    const name = this.utensilForm.name.trim();
    if (!name) {
      this.utensilFormError.set(this.i18n.t('auth.el_nombre_es_requerido'));
      return;
    }

    const duplicated = this.pantryService
      .utensils()
      .some((u) => u.name.trim().toLowerCase() === name.toLowerCase());
    if (duplicated) {
      this.utensilFormError.set(this.i18n.t('pantry.ya_existe_un_utensilio'));
      return;
    }

    this.utensilFormError.set('');
    this.isSavingUtensil.set(true);
    this.pantryService
      .createUtensil({
        name,
        category: this.utensilForm.category,
        available: this.utensilForm.available
      })
      .subscribe({
        next: (created) => {
          this.toastService.success(
            this.i18n.t('pantry.anadido'),
            this.i18n.t('pantry.utensilio_anadido', { name })
          );
          this.closeUtensilModal();
          this.isSavingUtensil.set(false);
          // La tabla pagina, asi que «dejarlo a la vista» ahora es buscarlo: el filtro revela la fila al
          // instante (## 12ab; antes se saltaba al tramo donde habia caido).
          this.utensiliosQ.set(name);
        },
        error: () => {
          this.toastService.error(this.i18n.t('ui.error'), this.i18n.t('pantry.no_se_pudo_anadir'));
          this.isSavingUtensil.set(false);
        }
      });
  }

  /**
   * Dias de calendario, no milisegundos: con `Math.ceil` sobre el instante, a las 23:00 del dia
   * de la caducidad el yogur ya estaba «caducado» una noche antes de estarlo.
   */
  /**
   * La etiqueta del dia de caducidad, ya en el idioma de quien mira. Se resuelve aqui y no en la plantilla
   * porque la frase lleva el numero dentro, y `'{days}d'` partido en dos trozos no se traduce en nadie.
   */
  getExpirationStatus(
    ingredient: Ingredient
  ): { variant: 'error' | 'warning' | 'success'; label: string } | null {
    const days = daysUntil(ingredient.expirationDate);
    if (days === null) return null;
    if (days < 0) return { variant: 'error', label: this.i18n.t('pantry.caducado') };
    if (days === 0) return { variant: 'warning', label: this.i18n.t('pantry.caduca_hoy') };
    if (days <= 3)
      return { variant: 'warning', label: this.i18n.t('pantry.caduca_en_dias', { days }) };
    return null;
  }
  trackById(_i: number, item: Ingredient | Utensil): string {
    return item.id;
  }

  private resetForm(): void {
    this.formData = {
      name: '',
      quantity: 0,
      unit: 'g' as MeasurementUnit,
      category: 'other',
      location: 'pantry',
      expirationDate: '',
      notes: ''
    };
    this.formErrors.name.set('');
    this.formErrors.quantity.set('');
  }
}
