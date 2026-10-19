import { Component, DestroyRef, computed, effect, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { ShoppingService } from '../../core/services/shopping.service';
import { HouseholdService } from '../../core/services/household.service';
import { shoppingStreamPath } from '../../core/services/shopping-stream-path';
import { ConfirmService } from '../../core/services/confirm.service';
import { ToastService } from '../../core/services/toast.service';
import {
  formatMoney,
  ListsQuery,
  ListsSort,
  ShoppingList
} from '../../shared/models/shopping.model';
import { IconComponent } from '../../shared/components/ui/icon/icon.component';
import { ButtonComponent } from '../../shared/components/ui/button/button.component';
import { AvatarComponent } from '../../shared/components/ui/avatar/avatar.component';
import { IconButtonComponent } from '../../shared/components/ui/icon-button/icon-button.component';
import { PickerComponent, PickerOption } from '../../shared/components/ui/picker/picker.component';
import { ShoppingSuggestedComponent } from './shopping-suggested.component';
import { TranslatePipe } from '../../core/pipes/translate.pipe';
import type { TranslationKey } from '../../core/i18n';
import { I18nService } from '../../core/services/i18n.service';

type StatusFilter = 'active' | 'done' | 'all';

// Lo que se puede ordenar, no como se llama: las cabeceras llevan su `labelKey` y este mapa solo servia
// para comprobar que el `?sort=` de la URL era un orden conocido (## 12u).
const SORTS: readonly ListsSort[] = ['updated', 'name', 'total', 'lines'];

/**
 * Filtros de total. La cantidad esta escrita dentro de la clave a proposito: no es un numero formateado, es
 * una etiqueta fija («over 25 €»), y partir la frase en dos la dejaria intraducible en los idiomas que
 * cambian el sitio del simbolo.
 */
const MIN_TOTALS: { value: string; labelKey: TranslationKey; hintKey?: TranslationKey }[] = [
  { value: '', labelKey: 'shopping_lists.total_cualquier' },
  {
    value: '1000',
    labelKey: 'shopping_lists.total_10',
    hintKey: 'shopping_lists.total_cestas_medias'
  },
  { value: '2500', labelKey: 'shopping_lists.total_25' },
  { value: '5000', labelKey: 'shopping_lists.total_50' },
  { value: '10000', labelKey: 'shopping_lists.total_100' }
];

const PAGE_SIZES: { value: string; labelKey: TranslationKey }[] = [
  { value: '10', labelKey: 'shopping_lists.pagina_10' },
  { value: '25', labelKey: 'shopping_lists.pagina_25' },
  { value: '50', labelKey: 'shopping_lists.pagina_50' }
];

/**
 * Bandeja de listas (`/shopping`).
 *
 * Es una TABLA con filtros y paginacion, no una pila infinita de tarjetas: quien revisa
 * el gasto del mes necesita comparar importes por columna, y eso con tarjetas no se hace.
 * Y sigue siendo movil primero — en una pantalla pequena la misma fila se reordena en dos
 * lineas y la accion es un icono, no un boton de texto que se come la mitad del ancho.
 *
 * Estado en la URL: `?tab=&q=&store=&min=&from=&to=&sort=&dir=&page=&size=`. Compartir la
 * pantalla de "las de abril en Mercadona" es mandar un enlace, y volver atras desde una
 * lista devuelve la bandeja como se dejo.
 */
@Component({
  selector: 'app-shopping-lists',
  standalone: true,
  imports: [
    TranslatePipe,
    CommonModule,
    FormsModule,
    ButtonComponent,
    IconComponent,
    IconButtonComponent,
    PickerComponent,
    AvatarComponent,
    ShoppingSuggestedComponent
  ],
  template: `
    <div class="tray">
      <header class="tray__head">
        <div>
          <h1 class="page-heading tray__title">{{ 'shopping_lists.lista_de_la_compra' | t }}</h1>
          <p class="tray__subtitle">{{ 'shopping_lists.cesta_por_tienda_precio' | t }}</p>
        </div>
        <div class="tray__head-actions">
          <app-icon-button
            icon="refresh"
            [label]="'shopping_lists.actualizar' | t"
            size="sm"
            variant="ghost"
            [spin]="refreshing()"
            (onClick)="refresh()"
          />
          <app-icon-button
            [icon]="creating() ? 'close' : 'add'"
            [label]="creating() ? ('common.cancel' | t) : ('shopping_lists.nueva_lista' | t)"
            size="sm"
            variant="soft"
            (onClick)="creating.set(!creating())"
            data-test="new-list"
          />
          <button
            type="button"
            class="tray__new"
            (click)="creating.set(!creating())"
            data-test="new-list-text"
          >
            <app-icon [name]="creating() ? 'close' : 'add'" [size]="18" [label]="null" />
            <span>{{
              creating() ? ('common.cancel' | t) : ('shopping_lists.nueva_lista' | t)
            }}</span>
          </button>
        </div>
      </header>

      <!-- ## 12al: la sugerencia de la casa, arriba del todo: se ve antes que el historial. -->
      <app-shopping-suggested (aplicada)="refresh()" />

      @if (creating()) {
        <form class="tray__create" (ngSubmit)="create()">
          <label class="tray__field">
            <span>{{ 'auth.name' | t }}</span>
            <input
              data-test="list-name"
              name="listName"
              [(ngModel)]="draftName"
              [placeholder]="'shopping_lists.compra_semana_38' | t"
              autocomplete="off"
              maxlength="80"
              (keydown.escape)="cancelCreate()"
            />
          </label>
          <label class="tray__field">
            <span>{{ 'shopping_lists.tienda_opcional' | t }}</span>
            <input
              name="listStore"
              data-test="list-store"
              [(ngModel)]="draftStore"
              [placeholder]="'shopping_list_detail.mercadona' | t"
              autocomplete="off"
              maxlength="60"
              list="tray-known-stores"
              (keydown.escape)="cancelCreate()"
            />
          </label>
          <datalist id="tray-known-stores">
            @for (option of storeOptions(); track option.value) {
              <option [value]="option.value"></option>
            }
          </datalist>
          <div class="tray__create-actions">
            <button type="button" class="tray__ghost" (click)="cancelCreate()">
              {{ 'common.cancel' | t }}
            </button>
            <app-button
              type="submit"
              variant="primary"
              size="md"
              data-test="create-submit"
              [disabled]="!draftName.trim() || busy()"
            >
              {{ busy() ? ('shopping_lists.creando' | t) : ('shopping_lists.crear_y_abrir' | t) }}
            </app-button>
          </div>
        </form>
      }

      <nav class="tray__tabs" [attr.aria-label]="'shopping_lists.estado_de_las_listas' | t">
        @for (option of statusOptions; track option.value) {
          <button
            type="button"
            class="tray__tab"
            [class.tray__tab--active]="status() === option.value"
            [attr.aria-current]="status() === option.value ? 'true' : null"
            [attr.data-test]="option.value === 'done' ? 'tab-done' : null"
            (click)="setStatus(option.value)"
          >
            {{ option.labelKey | t }}
          </button>
        }
        <span class="tray__tabs-spacer"></span>
        <button
          type="button"
          class="tray__filter-toggle"
          [class.tray__filter-toggle--on]="filtersOpen() || activeFilters() > 0"
          [attr.aria-label]="
            activeFilters() > 0
              ? ('shopping_lists.filtros' | t) + ': ' + activeFilters()
              : ('shopping_lists.filtros' | t)
          "
          [attr.aria-expanded]="filtersOpen()"
          (click)="filtersOpen.set(!filtersOpen())"
          aria-controls="tray-filters"
        >
          <app-icon name="filter_list" [size]="18" [label]="null" />
          <span class="tray__filter-label">{{ 'shopping_lists.filtros' | t }}</span>
          @if (activeFilters() > 0) {
            <span class="tray__filter-count">{{ activeFilters() }}</span>
          }
        </button>
      </nav>

      @if (filtersOpen()) {
        <section class="tray__filters" id="tray-filters">
          <label class="tray__field tray__field--search">
            <app-icon name="search" [size]="18" [label]="null" />
            <input
              name="trayQuery"
              [(ngModel)]="queryDraft"
              (ngModelChange)="applySearch()"
              [placeholder]="'shopping_lists.buscar_en_listas_y' | t"
              autocomplete="off"
              data-test="tray-search"
            />
            @if (queryDraft) {
              <button
                type="button"
                class="tray__clear"
                (click)="clearSearch()"
                [attr.aria-label]="'shopping_lists.quitar_la_busqueda' | t"
              >
                <app-icon name="close" [size]="16" [label]="null" />
              </button>
            }
          </label>
          <div class="tray__filters-grid">
            <app-picker
              [label]="'shopping_lists.tienda' | t"
              [options]="storeOptions()"
              [value]="store()"
              [placeholder]="'shopping_lists.todas_las_tiendas' | t"
              [filterFrom]="5"
              (valueChange)="setStore($event)"
            />
            <app-picker
              [label]="'shopping_lists.total_minimo' | t"
              [options]="minTotalOptions()"
              [value]="minTotal()"
              [placeholder]="'shopping_lists.cualquier_total' | t"
              (valueChange)="setMinTotal($event)"
            />
            <label class="tray__field">
              <span>{{ 'calendar.desde' | t }}</span>
              <input
                type="date"
                name="trayFrom"
                [ngModel]="from()"
                (ngModelChange)="setFrom($event)"
                max="{{ to() || '' }}"
              />
            </label>
            <label class="tray__field">
              <span>{{ 'calendar.hasta' | t }}</span>
              <input
                type="date"
                name="trayTo"
                [ngModel]="to()"
                (ngModelChange)="setTo($event)"
                min="{{ from() || '' }}"
              />
            </label>
          </div>
          @if (activeFilters() > 0) {
            <button type="button" class="tray__ghost" (click)="clearFilters()">
              <app-icon name="delete_sweep" [size]="16" [label]="null" />
              {{ 'shopping_lists.quitar_los_filtros' | t: { n: activeFilters() } }}
            </button>
          }
        </section>
      }

      @if (saving()) {
        <p class="tray__saving" role="status">{{ 'ui.guardando' | t }}</p>
      }
      @if (liveNote()) {
        <p class="tray__live" role="status" data-test="tray-live">
          <app-icon name="group" [size]="16" [label]="null" />
          {{ liveNote() }}
        </p>
      }

      @if (loading()) {
        <p class="tray__empty">{{ 'shopping_lists.cargando_listas' | t }}</p>
      } @else if (lists().length === 0) {
        <section class="tray__empty-card">
          <app-icon name="shopping_basket" [size]="36" [label]="null" />
          <h2 class="tray__empty-title">{{ emptyTitle() }}</h2>
          <p class="tray__empty-text">{{ emptyText() }}</p>
          @if (activeFilters() > 0) {
            <button type="button" class="tray__ghost" (click)="clearFilters()">
              {{ 'shopping_lists.quitar_los_filtros_2' | t }}
            </button>
          } @else if (status() === 'active') {
            <app-button type="button" variant="primary" size="md" (onClick)="creating.set(true)">
              {{ 'shopping_lists.empezar_una_lista' | t }}
            </app-button>
          }
        </section>
      } @else {
        <div
          class="tray__table"
          role="table"
          [attr.aria-label]="'shopping_lists.listas_de_estado' | t: { label: statusLabel() }"
        >
          <div class="tray__row tray__row--head" role="row">
            @for (column of columns; track $index) {
              <button
                type="button"
                role="columnheader"
                class="tray__th"
                [class.tray__th--active]="sort() === column.key"
                [attr.aria-sort]="ariaSort(column.key)"
                (click)="sortBy(column.key)"
                [disabled]="!column.key"
              >
                <span>{{ column.labelKey ? (column.labelKey | t) : '' }}</span>
                @if (sort() === column.key) {
                  <app-icon
                    [name]="dir() === 'asc' ? 'expand_less' : 'expand_more'"
                    [size]="16"
                    [label]="null"
                  />
                }
              </button>
            }
          </div>

          @for (list of lists(); track list.id) {
            <div
              class="tray__row"
              role="row"
              [class.tray__row--muted]="list.status !== 'active'"
              [attr.data-test]="'list-row'"
            >
              <div
                class="tray__cell tray__cell--name"
                role="cell"
                [attr.data-label]="'shopping_lists.columna_lista' | t"
              >
                @if (editingId() === list.id) {
                  <div class="tray__edit">
                    <input
                      #renameInput
                      class="tray__edit-input"
                      name="rename-{{ list.id }}"
                      [(ngModel)]="draftTitle"
                      maxlength="80"
                      [attr.aria-label]="'shopping_list_detail.renombrar_la_lista' | t"
                      autofocus
                      (keydown.enter)="commitRename(list)"
                      (keydown.escape)="cancelRename()"
                      (blur)="onRenameBlur(list)"
                      data-test="rename-input"
                    />
                    <app-icon-button
                      icon="check"
                      [label]="'account.guardar_el_nombre' | t"
                      size="sm"
                      variant="primary"
                      (onClick)="commitRename(list)"
                    />
                    <app-icon-button
                      icon="close"
                      [label]="'common.cancel' | t"
                      size="sm"
                      variant="ghost"
                      (onClick)="cancelRename()"
                    />
                  </div>
                } @else {
                  <a
                    class="tray__name"
                    [href]="hrefOf(list)"
                    (click)="open(list, $event)"
                    [attr.aria-label]="'shopping_lists.abrir_lista' | t: { name: list.name }"
                  >
                    <span>{{ list.name }}</span>
                    @if (list.ownerName) {
                      <app-avatar
                        class="tray__owner"
                        [name]="list.ownerName"
                        [src]="list.ownerAvatar ?? undefined"
                        size="xs"
                        [attr.title]="'shopping_lists.lista_de' | t: { name: list.ownerName }"
                        data-test="row-owner"
                      />
                    }
                  </a>
                  <div class="tray__name-tools">
                    <app-icon-button
                      icon="edit"
                      [label]="'shopping_lists.renombrar' | t"
                      size="sm"
                      (onClick)="startRename(list)"
                    />
                    <app-icon-button
                      icon="chevron_right"
                      [label]="'shopping_lists.abrir' | t"
                      size="sm"
                      (onClick)="open(list, $event)"
                    />
                  </div>
                }
              </div>

              <div
                class="tray__cell tray__cell--store"
                role="cell"
                [attr.data-label]="'shopping_lists.columna_tienda' | t"
              >
                @if (list.store) {
                  <span class="tray__chip">{{ list.store }}</span>
                } @else {
                  <span class="tray__dash" aria-hidden="true">—</span>
                }
              </div>

              <div
                class="tray__cell tray__cell--progress"
                role="cell"
                [attr.data-label]="'shopping_lists.columna_progreso' | t"
              >
                <span class="tray__bar" aria-hidden="true">
                  <span class="tray__bar-fill" [style.width.%]="progressOf(list)"></span>
                </span>
                <span class="tray__fraction">{{ list.checkedItems }}/{{ list.totalItems }}</span>
              </div>

              <div
                class="tray__cell tray__cell--total"
                role="cell"
                [attr.data-label]="'shopping_lists.columna_total' | t"
              >
                <span class="tray__money">{{ money(list.pricedTotalMinor) }}</span>
              </div>

              <div
                class="tray__cell tray__cell--when"
                role="cell"
                [attr.data-label]="'shopping_lists.columna_actualizado' | t"
              >
                <span class="tray__since">{{ since(list.updated_at) }}</span>
              </div>

              <div
                class="tray__cell tray__cell--actions"
                role="cell"
                [attr.data-label]="'shopping_lists.columna_acciones' | t"
              >
                <app-icon-button
                  [icon]="list.status === 'done' ? 'undo' : 'check_circle'"
                  [label]="
                    list.status === 'done'
                      ? ('shopping_lists.reabrir' | t)
                      : ('shopping_lists.terminar_lista' | t)
                  "
                  size="sm"
                  [attr.data-test]="'row-done-' + list.id"
                  (onClick)="archive(list)"
                />
                <app-icon-button
                  icon="delete"
                  [label]="'shopping_lists.borrar_lista' | t"
                  size="sm"
                  variant="danger"
                  (onClick)="remove(list)"
                />
              </div>
            </div>
          }
        </div>

        <nav class="tray__pager" [attr.aria-label]="'shopping_lists.paginas_de_listas' | t">
          <app-icon-button
            icon="chevron_left"
            [label]="'shopping_lists.pagina_anterior' | t"
            size="md"
            variant="soft"
            [disabled]="!canGoPrev()"
            (onClick)="go(-1)"
          />
          <span class="tray__pager-text">{{
            'shopping_lists.pager_de' | t: { range: rangeLabel(), total: total() }
          }}</span>
          <app-icon-button
            icon="chevron_right"
            [label]="'shopping_lists.pagina_siguiente' | t"
            size="md"
            variant="soft"
            [disabled]="!canGoNext()"
            (onClick)="go(1)"
          />
          <span class="tray__pager-spacer"></span>
          <app-picker
            [label]="'shopping_lists.tamano_de_pagina' | t"
            [options]="pageSizes()"
            [value]="pageSizeValue()"
            [filterFrom]="99"
            (valueChange)="setSize($event)"
          />
        </nav>
      }
    </div>
  `,
  styles: [
    `
      /*
     * ── Estados de interaccion (HOGARIA-SPEC 12q-B) ───────────────────────────────────────────
     *
     * Todo lo que se pulsa avisa antes de que se pulse. Va aqui arriba, junto, en lugar de repartido por
     * las reglas de cada control: asi la proxima clase que se anada se compara con esta lista, y el
     * check-ui (regla boton-sin-afecto) no deja a nadie poner un boton sin su hover. Van sin :hover los
     * deshabilitados —un boton apagado que se ilumina es la manera mas rapida de ensenar a desconfiar.
     */
      .tray__new:hover:not(:disabled) {
        background: var(--primary-dark);
        box-shadow: var(--shadow-sm);
      }

      .tray__ghost:hover:not(:disabled) {
        border-color: var(--primary);
        background: var(--primary-subtle);
        color: var(--primary-dark);
      }

      /* Las pestanas y el filtro viven dentro de una pista oscura: su respuesta es aclararse, no coloreanse
       de primario (el estado activo ya usa ese fondo, y no hay nada que decir dos veces). */
      .tray__tab:hover:not(.tray__tab--active),
      .tray__filter-toggle:hover:not(.tray__filter-toggle--on) {
        color: var(--text-primary);
        background: var(--bg-secondary);
      }

      .tray__clear:hover {
        color: var(--error);
        background: var(--error-subtle);
      }

      /* Ordenar por columna es una accion sobre la tabla entera: se anuncia en el propio encabezado. */
      .tray__th:hover:not(:disabled) {
        color: var(--text-primary);
        background: var(--bg-tertiary);
      }

      .tray {
        padding-block: var(--container-padding);
        max-width: 1040px;
        margin: 0 auto;
        display: flex;
        flex-direction: column;
        gap: var(--space-3);
      }
      .tray__head {
        display: flex;
        flex-wrap: wrap;
        align-items: flex-start;
        justify-content: space-between;
        gap: var(--space-3);
      }
      .tray__subtitle {
        margin-top: var(--space-1);
        font-size: var(--text-sm);
        color: var(--text-secondary);
        max-width: 52ch;
      }
      .tray__head-actions {
        display: flex;
        align-items: center;
        gap: var(--space-1);
      }
      .tray__new {
        display: inline-flex;
        align-items: center;
        gap: var(--space-2);
        border: none;
        border-radius: var(--radius-lg);
        background: var(--primary);
        color: var(--white);
        font-size: var(--text-sm);
        font-weight: var(--font-semibold);
        font-family: inherit;
        padding: var(--space-2) var(--space-3);
        min-height: 40px;
        cursor: pointer;
      }
      /* En el movil el boton de texto sobra: el icono de mas ya dice lo mismo y deja
         leer el titulo. Se oculta el icono suelto, no la accion. */
      @media (max-width: 600px) {
        .tray__head-actions app-icon-button:first-child + app-icon-button {
          display: none;
        }
      }
      @media (min-width: 601px) {
        .tray__new {
          display: none;
        }
      }
      .tray__create {
        display: grid;
        gap: var(--space-3);
        padding: var(--space-4);
        background: var(--bg-secondary);
        border: 1px solid var(--border-default);
        border-radius: var(--radius-xl);
      }
      .tray__create-actions {
        display: flex;
        justify-content: flex-end;
        gap: var(--space-2);
      }
      .tray__field {
        display: grid;
        gap: var(--space-1);
        font-size: var(--text-sm);
        color: var(--text-secondary);
      }
      .tray__field input,
      .tray__edit-input {
        border: 1px solid var(--border-default);
        border-radius: var(--radius-md);
        background: var(--bg-primary);
        color: var(--text-primary);
        padding: var(--space-2) var(--space-3);
        font-size: var(--text-sm);
        font-family: inherit;
        min-height: 40px;
      }
      .tray__field--search {
        grid-template-columns: auto 1fr auto;
        align-items: center;
        gap: var(--space-2);
        padding: 0 var(--space-3);
        border: 1px solid var(--border-default);
        border-radius: var(--radius-md);
        background: var(--bg-primary);
        min-height: 40px;
        color: var(--text-tertiary);
      }
      .tray__field--search input {
        border: none;
        background: transparent;
        padding: 0;
        min-height: 38px;
      }
      .tray__field--search input:focus {
        outline: none;
      }
      .tray__clear {
        border: none;
        background: transparent;
        color: var(--text-tertiary);
        cursor: pointer;
        display: inline-flex;
        padding: 2px;
      }
      .tray__tabs {
        display: flex;
        align-items: center;
        gap: var(--space-1);
        padding: var(--space-1);
        background: var(--bg-tertiary);
        border-radius: var(--radius-full);
      }
      .tray__tabs-spacer {
        flex: 1 1 auto;
      }
      .tray__tab {
        border: none;
        background: transparent;
        color: var(--text-secondary);
        border-radius: var(--radius-full);
        padding: var(--space-2) var(--space-3);
        font-size: var(--text-sm);
        font-family: inherit;
        font-weight: var(--font-medium);
        cursor: pointer;
        min-height: 36px;
      }
      .tray__tab--active {
        background: var(--bg-secondary);
        color: var(--text-primary);
        box-shadow: var(--shadow-sm);
      }
      .tray__filter-toggle {
        display: inline-flex;
        align-items: center;
        gap: var(--space-1);
        border: none;
        background: transparent;
        color: var(--text-secondary);
        border-radius: var(--radius-full);
        padding: var(--space-2) var(--space-3);
        font-size: var(--text-sm);
        font-family: inherit;
        cursor: pointer;
        min-height: 36px;
      }
      .tray__filter-toggle--on {
        background: var(--bg-secondary);
        color: var(--primary);
      }
      .tray__filter-count {
        min-width: 18px;
        height: 18px;
        border-radius: var(--radius-full);
        background: var(--primary);
        color: var(--white);
        font-size: 11px;
        line-height: 18px;
        text-align: center;
      }
      .tray__filters {
        display: grid;
        gap: var(--space-2);
        padding: var(--space-3);
        background: var(--bg-secondary);
        border: 1px solid var(--border-default);
        border-radius: var(--radius-xl);
        animation: tray-filters-in 0.16s ease-out;
      }
      @keyframes tray-filters-in {
        from {
          opacity: 0;
          transform: translateY(-6px);
        }
        to {
          opacity: 1;
          transform: translateY(0);
        }
      }
      .tray__filters-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
        gap: var(--space-2);
        align-items: end;
      }
      .tray__saving,
      .tray__live {
        font-size: var(--text-xs);
        color: var(--text-tertiary);
        display: flex;
        align-items: center;
        gap: var(--space-1);
      }
      .tray__live {
        color: var(--primary);
      }
      .tray__empty {
        color: var(--text-secondary);
        font-size: var(--text-sm);
      }
      .tray__empty-card {
        display: grid;
        gap: var(--space-2);
        padding: var(--space-6);
        border: 1px dashed var(--border-default);
        border-radius: var(--radius-xl);
        text-align: center;
        justify-items: center;
        color: var(--text-secondary);
        font-size: var(--text-sm);
      }
      .tray__empty-title {
        font-size: var(--text-lg);
        font-weight: var(--font-semibold);
        color: var(--text-primary);
      }
      .tray__table {
        border: 1px solid var(--border-default);
        border-radius: var(--radius-xl);
        background: var(--bg-secondary);
        overflow: hidden;
      }
      .tray__row {
        display: grid;
        grid-template-columns:
          minmax(160px, 2.2fr) minmax(90px, 1fr) minmax(120px, 1.2fr) minmax(80px, 0.8fr)
          minmax(84px, 0.8fr) auto;
        align-items: center;
        gap: var(--space-2);
        padding: var(--space-2) var(--space-3);
        border-bottom: 1px solid var(--border-default);
        position: relative;
      }
      .tray__row:last-child {
        border-bottom: none;
      }
      .tray__row--head {
        background: var(--bg-tertiary);
        padding-block: var(--space-1);
      }
      .tray__row--muted .tray__name {
        color: var(--text-tertiary);
      }
      .tray__th {
        display: inline-flex;
        align-items: center;
        gap: 2px;
        border: none;
        background: transparent;
        padding: var(--space-1) 0;
        font-size: var(--text-xs);
        font-family: inherit;
        font-weight: var(--font-semibold);
        color: var(--text-tertiary);
        text-transform: uppercase;
        letter-spacing: 0.02em;
        cursor: pointer;
        justify-self: start;
      }
      .tray__th:disabled {
        cursor: default;
      }
      .tray__th--active {
        color: var(--primary);
      }
      .tray__cell {
        min-width: 0;
        font-size: var(--text-sm);
        color: var(--text-primary);
        display: flex;
        align-items: center;
        gap: var(--space-2);
      }
      .tray__cell--total,
      .tray__cell--when {
        justify-content: flex-end;
        text-align: right;
      }
      .tray__name {
        display: inline-flex;
        align-items: center;
        gap: var(--space-1);
        color: var(--text-primary);
        text-decoration: none;
        font-weight: var(--font-medium);
        min-width: 0;
      }
      .tray__name span {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .tray__cell--name {
        justify-content: space-between;
      }
      .tray__owner {
        flex: none;
      }
      .tray__name-tools {
        display: inline-flex;
        gap: 0;
        opacity: 0;
        transition: var(--transition-fast);
      }
      .tray__row:hover .tray__name-tools,
      .tray__row:focus-within .tray__name-tools {
        opacity: 1;
      }
      .tray__edit {
        display: flex;
        align-items: center;
        gap: var(--space-1);
        width: 100%;
      }
      .tray__edit-input {
        flex: 1 1 auto;
        min-width: 0;
      }
      .tray__chip {
        font-size: var(--text-xs);
        color: var(--text-secondary);
        background: var(--bg-tertiary);
        border-radius: var(--radius-full);
        padding: 2px var(--space-2);
        max-width: 12ch;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .tray__dash {
        color: var(--text-tertiary);
      }
      .tray__bar {
        position: relative;
        flex: 1 1 auto;
        height: 6px;
        min-width: 44px;
        border-radius: var(--radius-full);
        background: var(--bg-tertiary);
        overflow: hidden;
      }
      .tray__bar-fill {
        position: absolute;
        inset: 0 auto 0 0;
        background: var(--primary);
        transition: width var(--transition-fast);
      }
      .tray__fraction {
        font-size: var(--text-xs);
        color: var(--text-secondary);
        font-variant-numeric: tabular-nums;
      }
      .tray__money {
        font-weight: var(--font-semibold);
        font-variant-numeric: tabular-nums;
      }
      .tray__since {
        font-size: var(--text-xs);
        color: var(--text-tertiary);
        white-space: nowrap;
      }
      .tray__pager {
        display: flex;
        align-items: center;
        gap: var(--space-2);
        font-size: var(--text-sm);
        color: var(--text-secondary);
      }
      .tray__pager-text {
        font-variant-numeric: tabular-nums;
      }
      .tray__pager-spacer {
        flex: 1 1 auto;
      }
      .tray__ghost {
        display: inline-flex;
        align-items: center;
        gap: var(--space-1);
        border: 1px solid var(--border-default);
        background: transparent;
        color: var(--text-secondary);
        border-radius: var(--radius-md);
        padding: var(--space-2) var(--space-3);
        font-size: var(--text-sm);
        font-family: inherit;
        cursor: pointer;
        min-height: 38px;
      }
      /* El movil no tiene seis columnas: la misma fila se convierte en tarjeta de dos
         lineas y cada dato lleva delante la etiqueta que antes estaba en la cabecera. */
      @media (max-width: 720px) {
        .tray__tab,
        .tray__filter-toggle {
          min-height: 44px;
        }
        .tray__row {
          grid-template-columns: 1fr auto;
          row-gap: var(--space-1);
          padding: var(--space-3);
        }
        .tray__row--head {
          display: none;
        }
        .tray__cell--name {
          grid-column: 1 / -1;
        }
        .tray__cell::before {
          content: attr(data-label);
          font-size: 10px;
          text-transform: uppercase;
          letter-spacing: 0.04em;
          color: var(--text-tertiary);
          margin-right: var(--space-1);
        }
        .tray__cell--store,
        .tray__cell--total,
        .tray__cell--when {
          justify-content: flex-start;
          text-align: left;
        }
        .tray__cell--actions {
          grid-row: 1;
          grid-column: 2;
        }
        .tray__name-tools {
          opacity: 1;
        }
      }
      @media (max-width: 362px) {
        .tray__tabs {
          gap: 0;
          min-width: 0;
        }
        .tray__tab,
        .tray__filter-toggle {
          padding-inline: var(--space-2);
        }
        .tray__tabs-spacer {
          min-width: 0;
        }
        .tray__filter-toggle {
          flex: 0 0 auto;
          justify-content: center;
          min-width: 44px;
        }
        .tray__filter-label {
          display: none;
        }
      }
    `
  ]
})
export class ShoppingListsComponent {
  private readonly i18n = inject(I18nService);
  private readonly shopping = inject(ShoppingService);
  private readonly confirm = inject(ConfirmService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly household = inject(HouseholdService);
  private lastContextRevision = this.household.contextRevision();
  private lastActiveHouseholdId = this.household.activeHouseholdId();
  private contextSwitchPending = false;
  private cancelStream: (() => void) | null = null;

  readonly statusOptions: { value: StatusFilter; labelKey: TranslationKey }[] = [
    { value: 'active', labelKey: 'shopping_lists.estado_activas' },
    { value: 'done', labelKey: 'shopping_lists.estado_terminadas' },
    { value: 'all', labelKey: 'shopping_lists.estado_todas' }
  ];
  /** El picker exige `label` ya escrita: se resuelve aqui, una vez, y no en cada fila de la plantilla. */
  readonly minTotalOptions = computed<PickerOption[]>(() =>
    MIN_TOTALS.map((option) => ({
      value: option.value,
      label: this.i18n.t(option.labelKey),
      ...(option.hintKey ? { hint: this.i18n.t(option.hintKey) } : {})
    }))
  );
  readonly pageSizes = computed<PickerOption[]>(() =>
    PAGE_SIZES.map((option) => ({ value: option.value, label: this.i18n.t(option.labelKey) }))
  );
  /** `key` vacia = columna que no se ordena (tienda y acciones). */
  readonly columns: { key: ListsSort | ''; labelKey: TranslationKey | null }[] = [
    { key: 'name', labelKey: 'shopping_lists.columna_lista' },
    { key: '', labelKey: 'shopping_lists.columna_tienda' },
    { key: 'lines', labelKey: 'shopping_lists.columna_progreso' },
    { key: 'total', labelKey: 'shopping_lists.columna_total' },
    { key: 'updated', labelKey: 'shopping_lists.columna_actualizado' },
    // La sexta columna son las acciones: un hueco en la rejilla, sin cabecera que traducir.
    { key: '', labelKey: null }
  ];
  readonly pageSizeValue = computed(() => String(this.size()));

  readonly creating = signal(false);
  readonly busy = signal(false);
  readonly refreshing = signal(false);
  readonly filtersOpen = signal(false);
  readonly status = signal<StatusFilter>('active');
  queryDraft = '';
  readonly search = signal('');
  readonly store = signal<string | null>(null);
  readonly minTotal = signal<string | null>(null);
  readonly from = signal<string | null>(null);
  readonly to = signal<string | null>(null);
  readonly sort = signal<ListsSort>('updated');
  readonly dir = signal<'asc' | 'desc'>('desc');
  readonly page = signal(0);
  readonly size = signal(25);
  readonly editingId = signal<string | null>(null);
  readonly liveNote = signal<string | null>(null);
  draftName = '';
  draftStore = '';
  draftTitle = '';

  /** Para no comerse el commit del `blur` cuando lo que se pulsado es «cancelar». */
  private cancelingRename = false;

  readonly lists = computed(() => this.shopping.lists());
  readonly loading = computed(() => this.shopping.loadingLists());
  readonly saving = computed(() => this.shopping.saving());
  readonly money = formatMoney;

  readonly total = computed(() => this.shopping.listsMeta().total);
  readonly storeOptions = computed<PickerOption[]>(() =>
    this.shopping
      .stores()
      .map((entry) => ({ value: entry.store, label: entry.store, hint: `${entry.lists} listas` }))
  );

  constructor() {
    this.readUrl();
    this.reload();
    this.shopping.loadStores();
    this.startStream();
    this.destroyRef.onDestroy(() => this.stopStream());

    effect(() => {
      const revision = this.household.contextRevision();
      const activeHouseholdId = this.household.activeHouseholdId();
      const selectedHouseholdId = this.household.household()?.id ?? null;
      const switchingHousehold = this.household.switchingHousehold();
      const revisionChanged = revision !== this.lastContextRevision;
      const activeHouseholdChanged = activeHouseholdId !== this.lastActiveHouseholdId;

      if (revisionChanged || activeHouseholdChanged) {
        this.lastContextRevision = revision;
        this.lastActiveHouseholdId = activeHouseholdId;
        this.contextSwitchPending = true;
        this.stopStream();
      }

      if (
        !this.contextSwitchPending ||
        switchingHousehold ||
        (activeHouseholdId && selectedHouseholdId !== activeHouseholdId)
      ) {
        return;
      }

      this.contextSwitchPending = false;
      this.reload();
      this.shopping.loadStores();
      this.startStream();
    });

    // Si se elimina la última fila de una página, el total del servidor puede dejar
    // el offset actual fuera de rango. Volvemos a la última página válida y corregimos
    // también la URL para no mostrar una bandeja vacía sin paginador.
    effect(() => {
      const page = this.page();
      const size = this.size();
      const total = this.total();
      const offset = this.shopping.listsMeta().offset;

      if (page === 0 || this.loading() || offset !== page * size || offset < total) return;

      const lastPage = Math.max(0, Math.ceil(total / size) - 1);
      if (lastPage >= page) return;

      this.page.set(lastPage);
      this.writeUrl();
      this.reload();
    });
  }

  private startStream(): void {
    this.stopStream();
    const contextRevision = this.household.contextRevision();
    const activeHouseholdId = this.household.activeHouseholdId();
    // La bandeja sigue en vivo, pero el listener y la SSE nacen en el contexto actual.
    this.cancelStream = this.shopping.openStream(shoppingStreamPath(null), () => {
      if (
        contextRevision !== this.household.contextRevision() ||
        activeHouseholdId !== this.household.activeHouseholdId()
      ) {
        return;
      }
      this.reload();
      this.liveNote.set(this.i18n.t('shopping_lists.alguien_del_hogar_ha'));
      setTimeout(() => this.liveNote.set(null), 6000);
    });
  }

  private stopStream(): void {
    this.cancelStream?.();
    this.cancelStream = null;
  }

  // ------------------------------------------------------------- estado / URL

  private readUrl(): void {
    const params = new URLSearchParams(window.location.search);
    const status = params.get('status') ?? params.get('tab');
    if (status === 'hechas' || status === 'done') this.status.set('done');
    else if (status === 'all' || status === 'todas') this.status.set('all');
    const query = params.get('q');
    if (query) {
      this.queryDraft = query;
      this.search.set(query);
    }
    const store = params.get('store');
    if (store) this.store.set(store);
    const min = params.get('min');
    if (min) this.minTotal.set(min);
    const from = params.get('from');
    if (from) this.from.set(from);
    const to = params.get('to');
    if (to) this.to.set(to);
    const sort = params.get('sort') as ListsSort | null;
    if (sort && (SORTS as readonly string[]).includes(sort)) this.sort.set(sort);
    const dir = params.get('dir');
    if (dir === 'asc' || dir === 'desc') this.dir.set(dir);
    const page = Number(params.get('page'));
    if (Number.isFinite(page) && page >= 0) this.page.set(page);
    const size = Number(params.get('size'));
    if (size === 10 || size === 25 || size === 50) this.size.set(size);
    this.filtersOpen.set(this.activeFilters() > 0);
  }

  private writeUrl(): void {
    const params: Record<string, string | null> = {
      tab: null,
      status: this.status() === 'active' ? null : this.status(),
      q: this.search() || null,
      store: this.store() || null,
      min: this.minTotal() || null,
      from: this.from() || null,
      to: this.to() || null,
      sort: this.sort() === 'updated' ? null : this.sort(),
      dir: this.dir() === 'desc' ? null : this.dir(),
      page: this.page() === 0 ? null : String(this.page()),
      size: this.size() === 25 ? null : String(this.size())
    };
    void this.router.navigate([], {
      queryParams: params,
      queryParamsHandling: 'merge',
      replaceUrl: true
    });
  }

  private query(): ListsQuery {
    return {
      status: this.status(),
      q: this.search() || undefined,
      store: this.store() || undefined,
      minTotalMinor: this.minTotal() ? Number(this.minTotal()) : undefined,
      from: this.from() || undefined,
      to: this.to() || undefined,
      sort: this.sort(),
      dir: this.dir(),
      limit: this.size(),
      offset: this.page() * this.size()
    };
  }

  private reload(): void {
    this.shopping.loadLists(this.query());
  }

  refresh(): void {
    this.refreshing.set(true);
    this.shopping.loadStores();
    this.reload();
    setTimeout(() => this.refreshing.set(false), 500);
  }

  // ------------------------------------------------------------------ filtros

  setStatus(status: StatusFilter): void {
    if (this.status() === status) return;
    this.status.set(status);
    this.page.set(0);
    this.writeUrl();
    this.reload();
  }

  /** Se filtra al escribir, pero con una pausa: buscar "leche" no son cinco busquedas. */
  private searchTimer?: ReturnType<typeof setTimeout>;
  applySearch(): void {
    clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => {
      this.search.set(String(this.queryDraft ?? '').trim());
      this.page.set(0);
      this.writeUrl();
      this.reload();
    }, 250);
  }

  clearSearch(): void {
    this.queryDraft = '';
    this.search.set('');
    this.writeUrl();
    this.reload();
  }

  setStore(value: string | null): void {
    this.store.set(value || null);
    this.page.set(0);
    this.writeUrl();
    this.reload();
  }

  setMinTotal(value: string | null): void {
    this.minTotal.set(value || null);
    this.page.set(0);
    this.writeUrl();
    this.reload();
  }

  setFrom(value: string | null): void {
    this.from.set(value || null);
    this.page.set(0);
    this.writeUrl();
    this.reload();
  }

  setTo(value: string | null): void {
    this.to.set(value || null);
    this.page.set(0);
    this.writeUrl();
    this.reload();
  }

  clearFilters(): void {
    this.queryDraft = '';
    this.search.set('');
    this.store.set(null);
    this.minTotal.set(null);
    this.from.set(null);
    this.to.set(null);
    this.page.set(0);
    this.writeUrl();
    this.reload();
  }

  activeFilters(): number {
    return [this.search(), this.store(), this.minTotal(), this.from(), this.to()].filter(Boolean)
      .length;
  }

  sortBy(key: ListsSort | ''): void {
    if (!key) return;
    if (this.sort() === key) this.dir.set(this.dir() === 'asc' ? 'desc' : 'asc');
    else {
      this.sort.set(key);
      // Nombre se entiende arriba; lo demas, abajo: lo primero que se quiere ver es la
      // cesta mas cara, y la lista mas reciente.
      this.dir.set(key === 'name' ? 'asc' : 'desc');
    }
    this.page.set(0);
    this.writeUrl();
    this.reload();
  }

  ariaSort(key: ListsSort | ''): string | null {
    if (!key || this.sort() !== key) return null;
    return this.dir() === 'asc' ? 'ascending' : 'descending';
  }

  canGoPrev(): boolean {
    return this.page() > 0;
  }

  canGoNext(): boolean {
    return (this.page() + 1) * this.size() < this.total();
  }

  go(step: number): void {
    const next = Math.max(0, this.page() + step);
    if (next === this.page()) return;
    this.page.set(next);
    this.writeUrl();
    this.reload();
  }

  setSize(value: string | null): void {
    const size = Number(value ?? 25);
    if (!Number.isFinite(size) || size <= 0) return;
    this.size.set(size);
    this.page.set(0);
    this.writeUrl();
    this.reload();
  }

  rangeLabel(): string {
    const total = this.total();
    if (!total || !this.lists().length) return '0';
    const first = this.page() * this.size() + 1;
    const last = Math.min(total, first + this.lists().length - 1);
    return `${first}-${last}`;
  }

  statusLabel(): string {
    const option = this.statusOptions.find((o) => o.value === this.status());
    return option ? this.i18n.t(option.labelKey) : this.i18n.t('shopping_lists.estado_todas');
  }

  emptyTitle(): string {
    // Un if y una clave; la frase la pone el diccionario (12t-i18n, regla 18).
    if (this.activeFilters() > 0) return this.i18n.t('shopping_lists.ninguna_lista_encaja_con');
    const clave =
      this.status() === 'active'
        ? 'shopping_lists.todavia_no_hay_listas'
        : this.status() === 'done'
          ? 'shopping_lists.nada_en_el_historial'
          : 'shopping_lists.ni_activas_ni_terminadas';
    return this.i18n.t(clave);
  }

  emptyText(): string {
    if (this.activeFilters() > 0) return this.i18n.t('shopping_lists.prueba_a_quitar_la_busqueda');
    const clave =
      this.status() === 'active'
        ? 'shopping_lists.crea_la_primera_y'
        : 'shopping_lists.las_listas_terminadas_se';
    return this.i18n.t(clave);
  }

  progressOf(list: ShoppingList): number {
    return list.totalItems ? (list.checkedItems / list.totalItems) * 100 : 0;
  }

  // ------------------------------------------------------------- renombrar fila

  startRename(list: ShoppingList): void {
    this.editingId.set(list.id);
    this.draftTitle = list.name;
    this.cancelingRename = false;
  }

  commitRename(list: ShoppingList): void {
    if (this.editingId() !== list.id) return;
    const name = this.draftTitle.trim();
    this.editingId.set(null);
    if (!name || name === list.name) return;
    void this.shopping.renameList(list.id, { name }, list.version).then((updated) => {
      if (updated) this.reload();
    });
  }

  /** Cancelar es lo que pide el cuerpo cuando el input se abre por error. */
  cancelRename(): void {
    this.cancelingRename = true;
    this.editingId.set(null);
    this.draftTitle = '';
    setTimeout(() => (this.cancelingRename = false));
  }

  onRenameBlur(list: ShoppingList): void {
    if (this.cancelingRename) return;
    this.commitRename(list);
  }

  // ------------------------------------------------------------------ acciones

  hrefOf(list: ShoppingList): string {
    return `/shopping/${list.id}`;
  }

  /**
   * Navegacion propia y no `routerLink` para poder prevenir el comportamiento por defecto:
   * el `href` se queda, y asi el boton central del raton y el «abrir en pestana nueva»
   * siguen siendo un enlace normal en vez de un boton disfrazado.
   */
  open(list: ShoppingList, event: Event): void {
    event.preventDefault();
    void this.router.navigate(['/shopping', list.id]);
  }

  cancelCreate(): void {
    this.creating.set(false);
    this.draftName = '';
    this.draftStore = '';
  }

  async create(): Promise<void> {
    const name = this.draftName.trim();
    if (!name || this.busy()) return;
    this.busy.set(true);
    const created = await this.shopping.createList(name, this.draftStore.trim() || null);
    this.busy.set(false);
    if (!created) return;
    this.cancelCreate();
    void this.router.navigate(['/shopping', created.id]);
  }

  /** Terminar una lista si es deshacible: la barra de aviso manda, no el boton. */
  async archive(list: ShoppingList): Promise<void> {
    const wasDone = list.status === 'done';
    const result = await this.shopping.setStatus(list.id, wasDone ? 'active' : 'done');
    const succeeded =
      result !== null && (wasDone || (typeof result === 'object' && 'ok' in result && result.ok));
    if (!succeeded) return;
    this.toast.show({
      type: 'success',
      title: wasDone ? this.i18n.t('ui.lista_reabierta') : this.i18n.t('ui.lista_terminada'),
      message: this.i18n.t(wasDone ? 'ui.lista_vuelve_a_activas' : 'ui.lista_pasa_al_historial', {
        name: list.name
      }),
      duration: 6000,
      countdown: true,
      position: 'bottom',
      action: {
        label: this.i18n.t('ui.deshacer'),
        run: () => void this.shopping.setStatus(list.id, wasDone ? 'done' : 'active')
      }
    });
  }

  /** Borrar una lista NO es deshacible (sus lineas se van): por eso pide confirmacion. */
  async remove(list: ShoppingList): Promise<void> {
    const accepted = await this.confirm.confirm({
      title: this.i18n.t('ui.borrar_esta_lista'),
      message: this.i18n.t('ui.se_borran_lista_y_lineas', { name: list.name, n: list.totalItems }),
      confirmText: this.i18n.t('calendar.borrar'),
      variant: 'danger'
    });
    if (!accepted) return;
    const deleted = await this.shopping.deleteList(list.id);
    if (!deleted) return;
    this.toast.info(this.i18n.t('ui.lista_borrada'), this.i18n.t('ui.el_historial_de_precios'));
  }

  // La hora la pone `core/time`, en la zona detectada del navegador. Cada pantalla que hacıa
  // su propio `new Date(...)` era una pantalla con la hora torcida.
  since(value: string): string {
    return this.i18n.relativeTime(value);
  }
}
