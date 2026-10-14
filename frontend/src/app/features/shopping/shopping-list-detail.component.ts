import { Component, OnDestroy, computed, effect, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { formatDateTime } from '../../core/time';
import { listCategoryLabelKey } from '../../core/i18n/labels';
import { UnitPickerComponent } from './unit-picker.component';
import { parseQuickAddLine } from './quick-add';
import { seccionDeLista } from './seccion-de-catalogo';
import {
  auditFace,
  describeLineDiscount,
  discountDraftFromSaved,
  discountInputFromSaved,
  lineDiscountOfItem,
  type LineDiscount,
  type ListEvent
} from '../../shared/models/shopping.model';
import { ShoppingService } from '../../core/services/shopping.service';
import { HouseholdService } from '../../core/services/household.service';
import { shoppingStreamPath } from '../../core/services/shopping-stream-path';
import { PantryService } from '../../core/services/pantry.service';
import type { PantryCatalogProduct } from '../../shared/models/pantry.model';
import { ToastService } from '../../core/services/toast.service';
import { ConfirmService } from '../../core/services/confirm.service';
import { AuthService } from '../../core/services/auth.service';
import {
  CreateItemInput,
  DiscountScope,
  MissingPriceLine,
  LIST_CATEGORIES,
  ShoppingListItem,
  formatMoney,
  formatQuantity,
  groupItemsByCategory,
  orderShoppingItems,
  parseMoneyToMinor,
  describeOffer,
  productKeyOf,
  offerOfItem,
  LineOffer,
  OFFER_PRESETS,
  CompletePriceInput,
  DiscountInput,
  PhotoLine
} from '../../shared/models/shopping.model';
import { LongPressDirective, SwipeRowDirective } from '../../shared/directives/swipe-row.directive';
import { ButtonComponent } from '../../shared/components/ui/button/button.component';
import { CheckboxComponent } from '../../shared/components/ui/checkbox/checkbox.component';
import { IconComponent } from '../../shared/components/ui/icon/icon.component';
import { IconButtonComponent } from '../../shared/components/ui/icon-button/icon-button.component';
import { PickerComponent, PickerOption } from '../../shared/components/ui/picker/picker.component';
import { AvatarComponent } from '../../shared/components/ui/avatar/avatar.component';
import { TranslatePipe } from '../../core/pipes/translate.pipe';
import { catalogLabel } from '../../shared/pipes/catalog-label.pipe';
import { CatalogLabelPipe } from '../../shared/pipes/catalog-label.pipe';
import type { TranslationKey } from '../../core/i18n';
import { I18nService } from '../../core/services/i18n.service';

/** Una linea de la foto con lo que la persona toco: `keep` no existe en el contrato. */
export type KeptPhotoLine = PhotoLine & { keep: boolean };

/** Lo que devuelve `/photo/analyze`, con la marca de que la persona todavia no ha dicho nada. */
interface PhotoReview {
  listId: string;
  mode: 'auto' | 'ticket' | 'shelf';
  currency: string;
  warnings: string[];
  categories: { name: string; color: string }[];
  lines: KeptPhotoLine[];
}

/** Autoguardado: 400 ms despues del ultimo tecleo, ni antes ni despues. */
const AUTOSAVE_MS = 400;
const UNDO_MS = 6000;
const UNGROUPED_CATEGORY = '__ungrouped__';

/**
 * La lista, en pantalla.
 *
 * Es la pantalla donde el gesto importa: el pulgar desliza, marca y se va. Por eso
 * el orden visual es el de la tienda (las secciones agrupan), la casilla ocupa todo
 * el golpeteo facil, y ninguna accion vive solo en el gesto: el riel descubierto
 * muestra `Editar · Quitar`, y la ⋯ muestra lo mismo sin deslizar nada.
 */
/** «15,40» -> «15,4»; los ceros de mas en un campo de descuento molestan mas de lo que ayudan. */
function trimNumber(value: number): string {
  return String(Number(value.toFixed(2))).replace('.', ',');
}

function parsePositive(raw: string | number | null | undefined): number | null {
  const text = String(raw ?? '')
    .trim()
    .replace(',', '.');
  if (!text) return null;
  const value = Number(text);
  if (!Number.isFinite(value) || value <= 0) return null;
  return value;
}

/** Unidades pagadas de una oferta: con 3x2 y 6 unidades, 4. Es el ciclo, no una resta. */
function paidUnitsOf(quantity: number, offer: { buy: number; take: number }): number {
  const buy = Math.max(1, Math.floor(offer.buy));
  const take = Math.min(buy - 1, Math.max(0, Math.floor(offer.take)));
  const cycles = Math.floor(quantity / buy);
  return cycles * take + Math.min(quantity - cycles * buy, take);
}

type LineDiscountKindUi = 'none' | 'percent' | 'amount';

@Component({
  selector: 'app-shopping-list-detail',
  standalone: true,
  imports: [
    TranslatePipe,

    CommonModule,
    FormsModule,
    RouterLink,
    SwipeRowDirective,
    LongPressDirective,
    ButtonComponent,
    CheckboxComponent,
    IconComponent,
    IconButtonComponent,
    PickerComponent,
    UnitPickerComponent,
    AvatarComponent,
    CatalogLabelPipe
  ],
  template: `
    <div class="detail">
      <header class="detail__head">
        <a
          class="detail__back"
          routerLink="/shopping"
          [attr.aria-label]="'shopping_list_detail.volver_a_las_listas' | t"
          data-test="back"
        >
          <app-icon name="chevron_left" [size]="22" [label]="null" />
        </a>
        <div class="detail__heading">
          @if (renaming()) {
            <div class="detail__rename-row">
              <input
                class="detail__rename"
                name="listName"
                [(ngModel)]="draftName"
                (ngModelChange)="renameList()"
                maxlength="80"
                (keydown.enter)="commitRename()"
                (keydown.escape)="cancelRename()"
                (blur)="onRenameBlur()"
                data-test="rename-input"
                autofocus
              />
              <app-icon-button
                icon="check"
                [label]="'account.guardar_el_nombre' | t"
                size="sm"
                variant="primary"
                (onClick)="commitRename()"
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
            <h1
              class="detail__title"
              (click)="startRename()"
              [attr.title]="'shopping_list_detail.renombrar_la_lista' | t"
            >
              {{ list()?.name ?? ('shopping_list_detail.lista' | t) }}
              <app-icon class="detail__pencil" name="edit" [size]="14" [label]="null" />
            </h1>
          }
          <p class="detail__meta">
            <span>{{
              'shopping_list_detail.compradas_de'
                | t: { checked: checkedCount(), total: totalCount() }
            }}</span>
            @if (list()?.store) {
              <span class="detail__chip">{{ list()?.store }}</span>
            }
            <span class="detail__chip detail__chip--money">{{
              money(estimate()?.totalMinor ?? 0)
            }}</span>
            @if (unpricedCount() > 0) {
              <span class="detail__chip detail__chip--warn">{{
                'shopping_list_detail.sin_precio' | t: { n: unpricedCount() }
              }}</span>
            }
          </p>
        </div>
        <span class="detail__status" [class.detail__status--busy]="saving()" aria-live="polite">
          {{ (saving() ? 'ui.guardando' : 'ui.guardado') | t }}
        </span>
      </header>

      <form class="detail__add" (ngSubmit)="addItem()">
        <div class="detail__add-campo">
          <input
            class="detail__add-input"
            data-test="add-input"
            name="newItem"
            [(ngModel)]="draftItem"
            [placeholder]="'shopping_list_detail.anadir_2_leche_1kg' | t"
            autocomplete="off"
            enterkeyhint="done"
            role="combobox"
            aria-autocomplete="list"
            [attr.aria-expanded]="sugAbiertas()"
            (input)="onDraftInput($any($event.target).value)"
            (keydown)="onDraftKeys($event)"
            (blur)="cerrarSugerencias()"
          />
          @if (sugAbiertas() && sugerencias().length) {
            <!-- Las sugerencias del catalogo pre-registrado: teclear «lech» y ver «Leche semidesnatada ·
                 Lacteos · l», sin escribirla entera ni deletrearla. Es listbox con flechas porque quien
                 teclea no quiere soltar el teclado; el raton tambien vale (## 12ag). -->
            <ul
              class="detail__sugs"
              role="listbox"
              data-test="add-sugerencias"
              [attr.aria-label]="'shopping_list_detail.sugerencias_del_catalogo' | t"
              (mousedown)="$event.preventDefault()"
            >
              @for (s of sugerencias(); track s.id; let idx = $index) {
                <li role="option" [attr.aria-selected]="idx === sugActivo">
                  <button
                    type="button"
                    class="detail__sug"
                    [class.detail__sug--on]="idx === sugActivo"
                    [attr.data-test]="'add-sug-' + s.id.replace(':', '-')"
                    (click)="aplicarSugerencia(idx)"
                  >
                    <span class="detail__sug-nombre">{{ s.name }}</span>
                    <span class="detail__sug-meta">
                      {{ s.categoryLabel }} · {{ s.unit }}
                      @if (s.inHousehold) {
                        <span class="detail__sug-casa">{{
                          'shopping_list_detail.ya_en_casa' | t
                        }}</span>
                      }
                    </span>
                  </button>
                </li>
              }
            </ul>
          }
        </div>
        <app-button
          type="submit"
          size="md"
          data-test="add-submit"
          [disabled]="!draftItem.trim()"
          (mousedown)="mantenerFocoParaAnadir($event)"
        >
          <app-icon name="add" [size]="18" [label]="null" />
          <span>{{ 'ui.anadir' | t }}</span>
        </app-button>
        <app-icon-button
          icon="content_paste"
          [label]="'shopping_list_detail.pegar_la_lista_de' | t"
          size="md"
          variant="soft"
          data-test="paste-open"
          [attr.aria-expanded]="pasteOpen()"
          (onClick)="pasteOpen.set(!pasteOpen())"
        />
        <app-icon-button
          icon="add_a_photo"
          [label]="'shopping_list_detail.anadir_desde_una_foto' | t"
          size="md"
          variant="soft"
          data-test="photo-open"
          (onClick)="openPhoto()"
        />
        <app-icon-button
          icon="history"
          [label]="'shopping_list_detail.quien_ha_tocado_que' | t"
          size="md"
          variant="soft"
          [attr.aria-expanded]="auditOpen()"
          (onClick)="toggleAudit()"
        />
      </form>

      @if (pasteOpen()) {
        <div class="detail__paste">
          <textarea
            data-test="paste-input"
            name="pasteText"
            rows="4"
            [(ngModel)]="draftPaste"
            [placeholder]="'shopping_list_detail.2_leche_1kg_tomates' | t"
          ></textarea>
          <div class="detail__paste-actions">
            <span class="detail__hint">{{
              'shopping_list_detail.una_linea_por_producto' | t
            }}</span>
            <app-button
              type="button"
              variant="primary"
              size="md"
              data-test="paste-submit"
              (onClick)="paste()"
              [disabled]="!draftPaste.trim()"
            >
              {{ 'shopping_list_detail.anadir_a_la_lista' | t }}
            </app-button>
          </div>
        </div>
      }

      <nav class="detail__tabs" [attr.aria-label]="'shopping_list_detail.filtro_de_lineas' | t">
        <button
          type="button"
          class="detail__tab"
          data-test="tab-todo"
          [class.detail__tab--active]="tab() === 'todo'"
          (click)="selectTab('todo')"
        >
          <app-icon name="radio_button_unchecked" [size]="16" [label]="null" />
          <span>{{ 'shopping_list_detail.pendientes_n' | t: { n: pendingCount() } }}</span>
        </button>
        <button
          type="button"
          class="detail__tab"
          data-test="tab-cart"
          [class.detail__tab--active]="tab() === 'checked'"
          (click)="selectTab('checked')"
        >
          <app-icon name="shopping_cart" [size]="16" [label]="null" />
          <span>{{ 'shopping_list_detail.en_el_carro_n' | t: { n: checkedCount() } }}</span>
        </button>
        <span class="detail__tabs-spacer"></span>
        <app-icon-button
          [icon]="selection().length > 0 ? 'close' : 'select_all'"
          [label]="
            selection().length > 0
              ? ('shopping_list_detail.quitar_la_seleccion' | t)
              : ('shopping_list_detail.seleccionar_todo' | t)
          "
          size="sm"
          variant="soft"
          data-test="select-all"
          (onClick)="toggleSelectAll()"
        />
      </nav>

      @if (loading()) {
        <p class="detail__empty">{{ 'shopping_list_detail.cargando_la_lista' | t }}</p>
      } @else if (visibleItems().length === 0) {
        <p class="detail__empty">
          {{
            tab() === 'todo'
              ? ('shopping_list_detail.nada_pendiente' | t)
              : ('shopping_list_detail.nada_comprado_aun' | t)
          }}
        </p>
      } @else {
        <div class="detail__display-options" data-test="shopping-display-options">
          <app-picker
            class="detail__display-picker"
            id="shopping-display-order"
            [options]="displayOrderOptions()"
            [value]="displayOrder()"
            [label]="'shopping_list_detail.ordenar_por' | t"
            (valueChange)="setDisplayOrder($event)"
          />
          <app-checkbox
            data-test="shopping-group-category"
            [checked]="groupByCategory()"
            [label]="'shopping_list_detail.agrupar_por_categoria' | t"
            (checkedChange)="groupByCategory.set($event)"
          />
          <app-checkbox
            data-test="shopping-frozen-last"
            [checked]="frozenLast()"
            [label]="'shopping_list_detail.dejar_congelados_al_final' | t"
            (checkedChange)="frozenLast.set($event)"
          />
        </div>
        <ul class="detail__groups">
          @for (group of groups(); track group.category) {
            <li class="detail__group">
              <h2 class="detail__group-title">
                <span
                  class="detail__group-dot"
                  [style.background]="colorOf(group.category)"
                  aria-hidden="true"
                ></span>
                {{ groupLabel(group.category) }}
              </h2>
              <ul class="detail__rows">
                @for (item of group.items; track item.id) {
                  <li
                    class="detail__row"
                    [class.detail__row--checked]="item.checked === 1"
                    [class.detail__row--selected]="isSelected(item.id)"
                    [appSwipeRow]="selection().length > 0"
                    (swipeRemove)="remove(item)"
                    (swipePlus)="plus(item)"
                    (gestureEnded)="noteGesture()"
                    data-test="item-row"
                  >
                    <div class="detail__rail" aria-hidden="true">
                      <button
                        type="button"
                        class="detail__rail-btn"
                        data-test="rail-edit"
                        (click)="openEdit(item)"
                      >
                        <app-icon name="edit" [size]="18" [label]="null" />
                        <span>{{ 'common.edit' | t }}</span>
                      </button>
                      <button
                        type="button"
                        class="detail__rail-btn detail__rail-btn--danger"
                        data-test="rail-remove"
                        (click)="remove(item)"
                      >
                        <app-icon name="delete" [size]="18" [label]="null" />
                        <span>{{ 'shopping_list_detail.quitar' | t }}</span>
                      </button>
                    </div>
                    <div
                      class="detail__face"
                      appLongPress
                      [longPressDisabled]="selection().length > 0"
                      (longPress)="onLongPress(item)"
                      (click)="onTap(item)"
                    >
                      <button
                        type="button"
                        class="detail__check"
                        data-test="check"
                        data-gesture-stop
                        role="checkbox"
                        [attr.aria-checked]="item.checked === 1"
                        [attr.aria-label]="
                          'shopping_list_detail.marcar_nombre' | t: { name: item.name }
                        "
                        (click)="toggle(item); $event.stopPropagation()"
                      >
                        <app-icon
                          [name]="item.checked === 1 ? 'shopping_cart' : 'radio_button_unchecked'"
                          [size]="22"
                          [label]="null"
                        />
                      </button>
                      <span class="detail__name">{{ item.name | catalog }}</span>
                      @if (qtyOf(item)) {
                        <span class="detail__qty">{{ qtyOf(item) }}</span>
                      }
                      @if (offerOf(item); as offer) {
                        <button
                          type="button"
                          class="detail__offer"
                          data-test="offer-chip"
                          [attr.title]="
                            'shopping_list_detail.oferta_detalle'
                              | t: { desc: describeOffer(offer) }
                          "
                          (click)="setOffer(item, null); $event.stopPropagation()"
                        >
                          {{ describeOffer(offer) }}
                        </button>
                      }
                      @if (lineDiscountOf(item); as lineDiscount) {
                        <!-- El descuento se ve en la fila o no existe: una rebaja que solo vive
                             dentro de la hoja de edicion se anota y se olvida, y el total de la
                             cabecera deja de cuadrar con lo que alguien recuerda. -->
                        <button
                          type="button"
                          class="detail__offer detail__offer--discount"
                          data-test="line-discount-chip"
                          [attr.title]="
                            'shopping_list_detail.descuento_linea_detalle'
                              | t: { desc: describeDiscount(lineDiscount) }
                          "
                          (click)="openEdit(item); $event.stopPropagation()"
                        >
                          <app-icon name="discount" [size]="12" [label]="null" />
                          {{ describeDiscount(lineDiscount) }}
                        </button>
                      }
                      <span
                        class="detail__price"
                        [class.detail__price--none]="item.price_minor === null"
                      >
                        {{ money(item.price_minor) }}
                      </span>
                      @if (item.updated_by_name || item.added_by_name) {
                        <!-- El «quien» de la fila era la inicial escrita a mano: dos letras
                             sueltas que cada cual interpretaba como queria. Es el mismo icono
                             que en la auditoria y en la agenda —la foto de la persona, y su
                             inicial dentro del circulo si no tiene foto. -->
                        <span
                          class="detail__who"
                          [attr.title]="
                            'shopping_list_detail.ultimo_cambio' | t: { name: whoName(item) }
                          "
                        >
                          <app-avatar [name]="whoName(item)" [src]="whoAvatar(item)" size="xs" />
                        </span>
                      }
                      <button
                        type="button"
                        class="detail__more"
                        [attr.aria-label]="'shopping_list_detail.acciones_de_la_linea' | t"
                        (click)="openEdit(item); $event.stopPropagation()"
                      >
                        <app-icon name="more_vert" [size]="20" [label]="null" />
                      </button>
                    </div>
                  </li>
                }
              </ul>
            </li>
          }
        </ul>
      }

      <footer class="detail__bar">
        <div class="detail__totals">
          <span class="detail__totals-money" data-test="total">{{
            money(estimate()?.totalMinor ?? 0)
          }}</span>
          <button type="button" class="detail__link" (click)="estimateOpen.set(!estimateOpen())">
            {{
              estimateOpen()
                ? ('shopping_list_detail.ocultar_desglose' | t)
                : ('shopping_list_detail.ver_desglose' | t)
            }}
          </button>
        </div>
        <!-- Un boton con texto, no un icono suelto: «el porcentaje» es el ultimo sitio donde
             alguien busca el descuento que no encuentra, y aqui se ha pedido tres veces. Con
             texto en la barra se ve tambien CUANDO no hay ninguno, que es el caso por defecto. -->
        <div class="detail__bar-actions">
          <button
            type="button"
            class="detail__discount"
            [class.detail__discount--on]="!!list()?.discount"
            data-test="discount-open"
            (click)="openDiscount()"
          >
            <app-icon name="percent" [size]="16" [label]="null" />
            <span>{{ discountSummary() }}</span>
          </button>
          <app-icon-button
            icon="delete_sweep"
            [label]="'shopping_list_detail.vaciar_el_carro' | t"
            size="md"
            variant="soft"
            [disabled]="checkedCount() === 0"
            (onClick)="clearChecked()"
          />
          <button
            type="button"
            class="detail__ghost detail__ghost--text"
            (click)="clearChecked()"
            [disabled]="checkedCount() === 0"
          >
            {{ 'shopping_list_detail.vaciar_carro' | t }}
          </button>
          <app-button
            type="button"
            variant="primary"
            size="md"
            data-test="complete"
            (onClick)="complete()"
          >
            {{ 'shopping_list_detail.terminar_compra' | t }}
          </app-button>
        </div>
      </footer>

      @if (estimateOpen() && estimate(); as data) {
        <ul class="detail__estimate">
          @for (line of data.lines; track line.itemId) {
            <li class="detail__estimate-row">
              <span>{{ line.name }}</span>
              <span class="detail__estimate-src">
                {{ sourceLabel(line.source) }}
                @if (line.lineDiscountDescription) {
                  · {{ line.lineDiscountDescription }}
                }
              </span>
              <span class="detail__estimate-money">
                @if (line.lineDiscountMinor) {
                  <s class="detail__estimate-was">{{ money(line.lineTotalMinor) }}</s>
                }
                {{
                  money(
                    line.lineDiscountMinor
                      ? (line.lineTotalMinor ?? 0) - line.lineDiscountMinor
                      : line.lineTotalMinor
                  )
                }}
              </span>
            </li>
          }
          @if (data.lineDiscountMinor) {
            <li class="detail__estimate-row detail__estimate-row--sum">
              <span>{{ 'shopping_list_detail.descuentos_de_linea' | t }}</span>
              <span class="detail__estimate-src">{{
                'shopping_list_detail.lineas_antes_del_cupon' | t: { n: discountedLineCount() }
              }}</span>
              <span class="detail__estimate-money">-{{ money(data.lineDiscountMinor ?? 0) }}</span>
            </li>
          }
        </ul>
      }

      @if (selection().length > 0) {
        <div
          class="detail__selection"
          data-test="selection-toolbar"
          role="toolbar"
          [attr.aria-label]="'shopping_list_detail.acciones_de_la_seleccion' | t"
        >
          <span class="detail__selection-count">{{
            'shopping_list_detail.seleccionadas' | t: { count: selection().length }
          }}</span>
          <button
            type="button"
            class="detail__ghost"
            data-test="bulk-check"
            (click)="bulkCheck(true)"
          >
            {{ 'shopping_list_detail.marcar_comprado' | t }}
          </button>
          <button
            type="button"
            class="detail__ghost"
            data-test="bulk-remove"
            (click)="bulkRemove()"
          >
            {{ 'shopping_list_detail.quitar' | t }}
          </button>
          <button
            type="button"
            class="detail__ghost"
            data-test="bulk-discount"
            (click)="openDiscountForSelection()"
          >
            <app-icon name="percent" [size]="16" [label]="null" />
            {{ 'shopping_list_detail.descuento' | t }}
          </button>
          <button type="button" class="detail__ghost" (click)="selection.set([])">
            {{ 'common.cancel' | t }}
          </button>
        </div>
      }

      @if (editing(); as item) {
        <div class="detail__sheet-backdrop" (click)="closeEdit()">
          <section
            class="detail__sheet"
            data-test="edit-sheet"
            (click)="$event.stopPropagation()"
            [attr.aria-label]="'shopping_list_detail.editar_linea' | t"
          >
            <h2 class="detail__sheet-title">{{ item.name | catalog }}</h2>
            <!-- No dice «Cancelar», y no es un olvido: aqui todo se guarda al tocar, asi que el
                 boton cierra y punto. Prometer que deshace seria mentir. -->
            <app-icon-button
              class="detail__sheet-x"
              icon="close"
              [label]="'shopping_list_detail.cerrar_la_hoja_los' | t"
              size="sm"
              variant="ghost"
              data-test="edit-close"
              (onClick)="closeEdit()"
            />
            <div class="detail__sheet-grid">
              <label class="detail__field">
                <span>{{ 'pantry.cantidad' | t }}</span>
                <input
                  name="qty"
                  type="number"
                  min="0"
                  step="0.1"
                  [ngModel]="draft.quantity"
                  (ngModelChange)="patch({ quantity: $event })"
                />
              </label>
              <label class="detail__field">
                <span>{{ 'shopping_list_detail.precio_por_unidad' | t }}</span>
                <input
                  name="price"
                  data-test="price-input"
                  inputmode="decimal"
                  placeholder="1,95"
                  [ngModel]="draft.price"
                  (ngModelChange)="patchPrice($event)"
                  (blur)="commitPrice()"
                />
              </label>
            </div>
            <div class="detail__sheet-grid">
              <div class="detail__field">
                <span class="detail__field-label">{{ 'pantry.unidad' | t }}</span>
                <!-- UN control para UNA decision. Estaba el chip y el desplegable debajo, y al
                     tocar el chip el desplegable seguia diciendo «Otra unidad…». -->
                <app-unit-picker [value]="draft.unit" (valueChange)="patch({ unit: $event })" />
              </div>
              <div class="detail__field">
                <span class="detail__field-label">{{
                  'shopping_list_detail.seccion_de_la_tienda' | t
                }}</span>
                <app-picker
                  [label]="'shopping_list_detail.seccion' | t"
                  [options]="categoryOptions()"
                  [value]="draft.category"
                  [placeholder]="'shopping_list_detail.sin_seccion_2' | t"
                  [searchPlaceholder]="'shopping_list_detail.buscar_seccion' | t"
                  [allowCustom]="true"
                  (valueChange)="setCategory($event)"
                  data-test="category-picker"
                />
              </div>
            </div>
            <div class="detail__field">
              <span class="detail__field-label">{{
                'shopping_list_detail.oferta_de_la_tienda' | t
              }}</span>
              <div
                class="detail__chips"
                role="group"
                [attr.aria-label]="'shopping_list_detail.ofertas' | t"
              >
                @for (preset of offerPresets; track preset.label) {
                  <button
                    type="button"
                    class="detail__chip-btn"
                    [class.detail__chip-btn--active]="isOffer(preset)"
                    [attr.aria-pressed]="isOffer(preset)"
                    [attr.title]="preset.hintKey | t"
                    data-test="offer-preset"
                    (click)="pickOfferPreset(preset)"
                  >
                    <app-icon name="local_offer" [size]="14" [label]="null" />
                    {{ preset.label }}
                  </button>
                }
                @if (draftOffer()) {
                  <button
                    type="button"
                    class="detail__chip-btn detail__chip-btn--clear"
                    data-test="offer-clear"
                    (click)="setDraftOffer(null)"
                  >
                    <app-icon name="close" [size]="14" [label]="null" />
                    {{ 'shopping_list_detail.sin_oferta' | t }}
                  </button>
                }
              </div>
              <p class="detail__hint">
                {{
                  draftOffer()
                    ? ('shopping_list_detail.se_pagan_de_cada'
                      | t: { paid: draftOffer()!.buy - draftOffer()!.take, buy: draftOffer()!.buy })
                    : ('shopping_list_detail.sin_oferta_pago_unitario' | t)
                }}
              </p>
            </div>
            <div class="detail__field" data-test="line-discount">
              <span class="detail__field-label">
                <app-icon name="discount" [size]="14" [label]="null" />
                {{ 'shopping_list_detail.descuento_en_esta_linea' | t }}
              </span>
              <div
                class="detail__chips"
                role="group"
                [attr.aria-label]="
                  'shopping_list_detail.tipo_de_descuento_de' | t: { name: item.name }
                "
              >
                @for (kind of lineKinds; track kind.value) {
                  <button
                    type="button"
                    class="detail__chip-btn"
                    [class.detail__chip-btn--active]="
                      lineKind() === kind.value && kind.value !== 'none'
                    "
                    [class.detail__chip-btn--clear]="kind.value === 'none'"
                    [attr.aria-pressed]="kind.value === 'none' ? null : lineKind() === kind.value"
                    data-test="line-discount-kind"
                    (click)="pickLineKind(kind.value)"
                  >
                    <app-icon [name]="kind.icon" [size]="14" [label]="null" />
                    {{ kind.labelKey | t }}
                  </button>
                }
              </div>
              @if (lineKind() !== 'none') {
                <div class="detail__sheet-grid">
                  @if (lineKind() === 'percent') {
                    <label class="detail__field">
                      <span>{{ 'shopping_list_detail.porcentaje' | t }}</span>
                      <input
                        name="lineDiscountPercent"
                        inputmode="decimal"
                        placeholder="15"
                        [ngModel]="linePercent()"
                        (ngModelChange)="setLinePercent($event)"
                        data-test="line-discount-percent"
                      />
                    </label>
                  }
                  @if (lineKind() === 'amount') {
                    <label class="detail__field">
                      <span>{{ 'shopping_list_detail.importe_que_baja' | t }}</span>
                      <input
                        name="lineDiscountAmount"
                        inputmode="decimal"
                        placeholder="2,50"
                        [ngModel]="lineAmount()"
                        (ngModelChange)="setLineAmount($event)"
                        data-test="line-discount-amount"
                      />
                    </label>
                  }
                  <label class="detail__field">
                    <span>{{ 'shopping_list_detail.sobre_cuantas_unidades' | t }}</span>
                    <input
                      name="lineDiscountUnits"
                      inputmode="decimal"
                      placeholder="todas"
                      [ngModel]="lineUnits()"
                      (ngModelChange)="setLineUnits($event)"
                      data-test="line-discount-units"
                    />
                  </label>
                </div>
                <p class="detail__hint" data-test="line-discount-preview">
                  {{ lineDiscountHint() }}
                </p>
                <button
                  type="button"
                  class="detail__link"
                  data-test="line-discount-clear"
                  (click)="setLineKind('none')"
                >
                  <app-icon name="close" [size]="14" [label]="null" />
                  {{ 'shopping_list_detail.quitar_el_descuento_de' | t }}
                </button>
              } @else {
                <p class="detail__hint">
                  {{ 'shopping_list_detail.es_el_cartel_del' | t }}
                </p>
              }
            </div>
            <label class="detail__field">
              <span>{{ 'shopping_list_detail.nota' | t }}</span>
              <input
                name="note"
                [placeholder]="'shopping_list_detail.semidesnatada_la_de_siempre' | t"
                [ngModel]="draft.note"
                (ngModelChange)="patch({ note: $event })"
                maxlength="120"
              />
            </label>
            <div class="detail__field" data-test="product-link">
              <span class="detail__field-label">
                <app-icon name="link" [size]="14" [label]="null" />
                {{ 'shopping_list_detail.es_el_mismo_producto' | t }}
              </span>
              @if (item.product_key && item.product_key !== keyOf(item.name)) {
                <div class="detail__chips">
                  <span
                    class="detail__chip detail__chip--linked"
                    data-test="product-link-current"
                    >{{ item.product_key }}</span
                  >
                  <button
                    type="button"
                    class="detail__link"
                    data-test="product-link-clear"
                    (click)="unlinkProduct(item)"
                  >
                    <app-icon name="link_off" [size]="14" [label]="null" />
                    {{ 'shopping_list_detail.quitar_el_enlace' | t }}
                  </button>
                </div>
              }
              <app-picker
                [label]="'shopping_list_detail.productos_con_precio_anotado' | t"
                [options]="productLinkOptions()"
                [value]="item.product_key"
                [placeholder]="'shopping_list_detail.busca_entre_lo_que' | t"
                [searchPlaceholder]="'shopping_list_detail.buscar_producto' | t"
                leadingIcon="local_offer"
                (valueChange)="linkProduct(item, $event)"
                data-test="product-link-picker"
              />
              @if (linkVariants(item); as variants) {
                <p class="detail__hint" data-test="product-link-variants">{{ variants }}</p>
              }
            </div>
            <div class="detail__sheet-actions">
              <button
                type="button"
                class="detail__ghost detail__ghost--danger"
                (click)="remove(item)"
              >
                {{ 'shopping_list_detail.quitar_linea' | t }}
              </button>
              <app-button type="button" variant="primary" size="md" (onClick)="closeEdit()">
                {{ 'shopping_list_detail.hecho' | t }}
              </app-button>
            </div>
            <p class="detail__hint">{{ 'shopping_list_detail.los_cambios_se_guardan' | t }}</p>
          </section>
        </div>
      }

      @if (discountOpen()) {
        <div class="detail__sheet-backdrop" (click)="discountOpen.set(false)">
          <section
            class="detail__sheet"
            data-test="discount-sheet"
            (click)="$event.stopPropagation()"
            [attr.aria-label]="'shopping_list_detail.descuento_de_la_lista' | t"
          >
            <h2 class="detail__sheet-title">
              {{ 'shopping_list_detail.descuento_de_la_lista' | t }}
            </h2>
            <app-icon-button
              class="detail__sheet-x"
              icon="close"
              [label]="'shopping_list_detail.cerrar_sin_cambiar_el' | t"
              size="sm"
              variant="ghost"
              data-test="discount-close"
              (onClick)="discountOpen.set(false)"
            />
            <p class="detail__hint">
              {{ 'shopping_list_detail.el_importe_o_el' | t }}
            </p>
            <div
              class="detail__chips"
              role="group"
              [attr.aria-label]="'shopping_list_detail.tipo_de_descuento' | t"
            >
              @for (kind of discountKinds; track kind.value) {
                <button
                  type="button"
                  class="detail__chip-btn"
                  [class.detail__chip-btn--active]="discountDraft().kind === kind.value"
                  data-test="discount-kind"
                  (click)="setDiscountKind(kind.value)"
                >
                  <app-icon [name]="kind.icon" [size]="16" [label]="null" />
                  {{ kind.labelKey | t }}
                </button>
              }
            </div>
            <div class="detail__sheet-grid">
              @if (discountDraft().kind === 'percent') {
                <div class="detail__field">
                  <span>{{ 'shopping_list_detail.porcentaje' | t }}</span>
                  <app-picker
                    [label]="'shopping_list_detail.porcentaje' | t"
                    [options]="percentOptions"
                    [value]="percentDraft()"
                    [placeholder]="'shopping_list_detail.escribe_el_porcentaje' | t"
                    [allowCustom]="true"
                    [filterFrom]="99"
                    (valueChange)="setPercent($event)"
                    data-test="discount-percent"
                  />
                </div>
              } @else {
                <label class="detail__field">
                  <span>{{ 'shopping_list_detail.importe_euros' | t }}</span>
                  <input
                    name="discountValue"
                    inputmode="decimal"
                    placeholder="3,50"
                    [ngModel]="amountDraft()"
                    (ngModelChange)="amountDraft.set($event)"
                    (blur)="commitAmount()"
                    data-test="discount-amount"
                  />
                </label>
              }
              <label class="detail__field">
                <span>{{ 'shopping_list_detail.etiqueta_opcional' | t }}</span>
                <input
                  name="discountLabel"
                  [placeholder]="'shopping_list_detail.fidelidad_5' | t"
                  maxlength="60"
                  [ngModel]="discountDraft().label"
                  (ngModelChange)="patchDiscount({ label: $event || null })"
                />
              </label>
            </div>
            <div class="detail__field">
              <span class="detail__field-label">{{
                'shopping_list_detail.a_que_se_aplica' | t
              }}</span>
              <div
                class="detail__chips"
                role="group"
                [attr.aria-label]="'shopping_list_detail.alcance_del_descuento' | t"
              >
                @for (scope of discountScopes; track scope.value) {
                  <button
                    type="button"
                    class="detail__chip-btn"
                    [class.detail__chip-btn--active]="discountDraft().scope === scope.value"
                    [attr.title]="scope.hintKey | t"
                    data-test="discount-scope"
                    (click)="patchDiscount({ scope: scope.value })"
                  >
                    {{ scope.labelKey | t }}
                  </button>
                }
              </div>
              @if (discountDraft().scope === 'product' || discountDraft().scope === 'category') {
                <div class="detail__targets" data-test="discount-targets">
                  <div class="detail__targets-head">
                    <span>{{
                      discountDraft().scope === 'category'
                        ? ('shopping_list_detail.que_pasillos_entran' | t)
                        : ('shopping_list_detail.que_lineas_entran' | t)
                    }}</span>
                    <button
                      type="button"
                      class="detail__link"
                      data-test="discount-targets-all"
                      (click)="toggleAllTargets()"
                    >
                      {{
                        allTargetsSelected()
                          ? ('shopping_list_detail.quitar_todas' | t)
                          : ('shopping_list_detail.elegir_todas' | t)
                      }}
                    </button>
                  </div>

                  @if (discountDraft().targets.length) {
                    <div
                      class="detail__chips"
                      role="list"
                      [attr.aria-label]="'shopping_list_detail.elegidas' | t"
                    >
                      @for (target of discountDraft().targets; track target) {
                        <button
                          type="button"
                          class="detail__chip-btn detail__chip-btn--active"
                          role="listitem"
                          [attr.aria-label]="
                            'shopping_list_detail.quitar_del_descuento' | t: { name: target }
                          "
                          [attr.data-test]="'discount-target-chip-' + target"
                          (click)="toggleTarget(target)"
                        >
                          {{ target }}
                          <app-icon name="close" [size]="12" [label]="null" />
                        </button>
                      }
                    </div>
                  }

                  @if (discountDraft().scope === 'category') {
                    <div
                      class="detail__chips"
                      role="group"
                      [attr.aria-label]="'shopping_list_detail.secciones_de_la_lista' | t"
                    >
                      @for (option of discountTargetOptions(); track option.value) {
                        <button
                          type="button"
                          class="detail__chip-btn"
                          [class.detail__chip-btn--active]="isTargetSelected(option.label)"
                          role="checkbox"
                          [attr.aria-checked]="isTargetSelected(option.label)"
                          [attr.data-test]="'discount-target-' + slug(option.value)"
                          (click)="toggleTarget(option.label)"
                        >
                          {{ option.label }}
                          <span class="detail__chip-hint">{{ option.hint }}</span>
                        </button>
                      }
                    </div>
                  } @else {
                    <ul class="detail__target-list" data-test="discount-target-list">
                      @for (option of discountTargetOptions(); track option.value) {
                        <li>
                          <button
                            type="button"
                            class="detail__target-row"
                            [class.is-on]="isTargetSelected(option.label)"
                            role="checkbox"
                            [attr.aria-checked]="isTargetSelected(option.label)"
                            [attr.data-test]="'discount-target-' + slug(option.value)"
                            (click)="toggleTarget(option.label)"
                          >
                            <app-icon
                              [name]="
                                isTargetSelected(option.label)
                                  ? 'check_box'
                                  : 'check_box_outline_blank'
                              "
                              [size]="20"
                              [label]="null"
                            />
                            <span
                              class="detail__target-dot"
                              [style.background]="option.color ?? 'transparent'"
                            ></span>
                            <span class="detail__target-name">{{ option.label }}</span>
                            <span class="detail__target-hint">{{ option.hint }}</span>
                          </button>
                        </li>
                      }
                      @if (!discountTargetOptions().length) {
                        <li class="detail__target-empty">
                          {{ 'shopping_list_detail.la_lista_esta_vacia' | t }}
                        </li>
                      }
                    </ul>
                  }

                  <div class="detail__target-add">
                    <input
                      name="targetAdd"
                      [ngModel]="targetDraft()"
                      (ngModelChange)="targetDraft.set($event)"
                      (keyup.enter)="addTarget()"
                      [placeholder]="'shopping_list_detail.otro_nombre_p_ej' | t"
                      maxlength="80"
                      data-test="discount-target-input"
                    />
                    <button
                      type="button"
                      class="detail__ghost"
                      [disabled]="!targetDraft().trim()"
                      data-test="discount-target-add"
                      (click)="addTarget()"
                    >
                      <app-icon name="add" [size]="16" [label]="null" />
                      {{ 'shopping_list_detail.anadir' | t }}
                    </button>
                  </div>
                  <p class="detail__hint">
                    {{ 'shopping_list_detail.se_compara_el_nombre' | t }}
                  </p>
                </div>
              }
              @if (discountDraft().scope === 'firstUnits') {
                <div class="detail__first-units">
                  <span>{{ 'shopping_list_detail.primeras_unidades' | t }}</span>
                  <div class="detail__stepper">
                    <app-icon-button
                      icon="remove"
                      [label]="'shopping_list_detail.quitar_una_unidad' | t"
                      size="sm"
                      variant="soft"
                      (onClick)="bumpFirstUnits(-1)"
                    />
                    <input
                      name="firstUnits"
                      type="number"
                      min="1"
                      step="1"
                      [ngModel]="discountDraft().firstUnits ?? 1"
                      (ngModelChange)="setFirstUnits($event)"
                      data-test="discount-first-units"
                    />
                    <app-icon-button
                      icon="add"
                      [label]="'shopping_list_detail.anadir_una_unidad' | t"
                      size="sm"
                      variant="soft"
                      (onClick)="bumpFirstUnits(1)"
                    />
                  </div>
                </div>
              }
            </div>
            <div class="detail__sheet-actions">
              @if (list()?.discount) {
                <button
                  type="button"
                  class="detail__ghost detail__ghost--danger"
                  data-test="discount-remove"
                  (click)="removeDiscount()"
                >
                  <app-icon name="delete" [size]="16" [label]="null" />
                  {{ 'shopping_list_detail.quitar_descuento' | t }}
                </button>
              }
              <app-button
                type="button"
                variant="primary"
                size="md"
                data-test="discount-save"
                (onClick)="saveDiscount()"
              >
                {{ 'common.save' | t }}
              </app-button>
            </div>
          </section>
        </div>
      }

      @if (payOpen()) {
        <div class="detail__sheet-backdrop" (click)="closePay()">
          <section
            class="detail__sheet detail__sheet--wide"
            data-test="pay-sheet"
            (click)="$event.stopPropagation()"
            [attr.aria-label]="'shopping_list_detail.precios_pagados_por_tienda' | t"
          >
            <h2 class="detail__sheet-title">{{ 'shopping_list_detail.cuanto_has_pagado' | t }}</h2>
            <app-icon-button
              class="detail__sheet-x"
              icon="close"
              [label]="'shopping_list_detail.cerrar_sin_terminar_la' | t"
              size="sm"
              variant="ghost"
              data-test="pay-close"
              (onClick)="closePay()"
            />
            <p class="detail__hint">
              {{ 'shopping_list_detail.se_guarda_por_establecimiento' | t }}
            </p>

            <div class="detail__field">
              <span class="detail__field-label">
                <app-icon name="storefront" [size]="14" [label]="null" />
                {{ 'shopping_list_detail.establecimiento' | t }}
              </span>
              @if (storeChips().length) {
                <div
                  class="detail__chips"
                  role="group"
                  [attr.aria-label]="'shopping_list_detail.tiendas_de_esta_casa' | t"
                >
                  @for (store of storeChips(); track store) {
                    <button
                      type="button"
                      class="detail__chip-btn"
                      [class.detail__chip-btn--active]="payStore().trim() === store"
                      [attr.data-test]="'pay-store-' + store"
                      (click)="choosePayStore(store)"
                    >
                      {{ store }}
                    </button>
                  }
                </div>
              }
              <input
                name="payStore"
                [ngModel]="payStore()"
                (ngModelChange)="setPayStore($event)"
                [placeholder]="'shopping_list_detail.mercadona' | t"
                maxlength="80"
                data-test="pay-store"
              />
              @if (payStoreError()) {
                <p class="detail__hint detail__hint--warn" data-test="pay-store-error">
                  {{ 'shopping_list_detail.sin_tienda_no_se' | t }}
                </p>
              }
            </div>

            <ul class="detail__pay">
              @for (line of payLines(); track line.itemId) {
                <li
                  class="detail__pay-row"
                  [class.detail__pay-row--empty]="!payValue(line.itemId).trim()"
                >
                  <div class="detail__pay-head">
                    <span class="detail__pay-name">{{ line.name }}</span>
                    <span class="detail__pay-qty"
                      >{{ line.quantity }}{{ line.unit ? ' ' + line.unit : '' }}</span
                    >
                  </div>
                  @if (paySuggestion(line.itemId); as hint) {
                    <button
                      type="button"
                      class="detail__pay-suggest"
                      [attr.data-test]="'pay-suggest-' + line.itemId"
                      (click)="usePaySuggestion(line.itemId, hint.minor)"
                    >
                      <app-icon name="history" [size]="14" [label]="null" />
                      {{ 'shopping_list_detail.usar_importe' | t: { amount: money(hint.minor) } }}
                      <span *ngIf="hint.store">({{ hint.store }})</span>
                    </button>
                  }
                  <div class="detail__pay-money">
                    <input
                      inputmode="decimal"
                      [placeholder]="
                        payMode(line.itemId) === 'unit'
                          ? ('shopping_list_detail.pago_por_unidad' | t)
                          : ('shopping_list_detail.pago_en_total' | t)
                      "
                      [ngModel]="payValue(line.itemId)"
                      (ngModelChange)="setPayValue(line.itemId, $event)"
                      [attr.data-test]="'pay-price-' + line.itemId"
                    />
                    <button
                      type="button"
                      class="detail__link"
                      [attr.data-test]="'pay-mode-' + line.itemId"
                      (click)="togglePayMode(line.itemId)"
                    >
                      {{
                        payMode(line.itemId) === 'unit'
                          ? ('shopping_list_detail.eur_por_unidad' | t)
                          : ('shopping_list_detail.total_pagado' | t)
                      }}
                    </button>
                  </div>
                  <input
                    class="detail__pay-alias"
                    [name]="'payAlias' + line.itemId"
                    [ngModel]="payAlias(line.itemId)"
                    (ngModelChange)="setPayAlias(line.itemId, $event)"
                    [placeholder]="'shopping_list_detail.como_se_llama_aqui' | t"
                    maxlength="120"
                    [attr.data-test]="'pay-alias-' + line.itemId"
                  />
                </li>
              }
            </ul>

            <div class="detail__sheet-actions">
              <button
                type="button"
                class="detail__ghost"
                data-test="pay-cancel"
                (click)="closePay()"
              >
                {{ 'common.cancel' | t }}
              </button>
              <app-button
                type="button"
                variant="primary"
                size="md"
                data-test="pay-confirm"
                [disabled]="payMissing() > 0"
                (onClick)="finishPurchase()"
              >
                <app-icon name="done_all" [size]="16" [label]="null" />
                {{ 'shopping_list_detail.guardar_y_terminar' | t }}
              </app-button>
            </div>
            <p class="detail__hint" data-test="pay-foot">
              @if (payMissing() > 0) {
                Faltan {{ payMissing() }}
                {{
                  (payMissing() === 1
                    ? 'shopping_list_detail.linea_uno'
                    : 'shopping_list_detail.lineas_varios'
                  ) | t
                }}
                por anotar ·
              }
              total {{ money(payTotal()) }} · lo que no se escribe aqui no entra en el historial.
            </p>
          </section>
        </div>
      }

      @if (photoOpen()) {
        <div class="detail__sheet-backdrop" (click)="closePhoto()">
          <section
            class="detail__sheet detail__sheet--wide"
            data-test="photo-sheet"
            (click)="$event.stopPropagation()"
            [attr.aria-label]="'shopping_list_detail.anadir_desde_una_foto_2' | t"
          >
            <h2 class="detail__sheet-title">{{ 'shopping_list_detail.desde_una_foto' | t }}</h2>
            <app-icon-button
              class="detail__sheet-x"
              icon="close"
              [label]="'shopping_list_detail.cerrar_la_foto' | t"
              size="sm"
              variant="ghost"
              data-test="photo-close"
              (onClick)="closePhoto()"
            />
            <p class="detail__hint">
              {{ 'shopping_list_detail.la_foto_la_mira' | t }}
            </p>

            <label
              class="detail__photo-drop"
              [class.detail__photo-drop--ready]="photoPreview()"
              data-test="photo-drop"
            >
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                capture="environment"
                name="photoFile"
                (change)="onPhotoFile($event)"
              />
              @if (photoPreview()) {
                <img [src]="photoPreview()" [alt]="'shopping_list_detail.foto_que_se_va' | t" />
              } @else {
                <app-icon name="add_a_photo" [size]="28" [label]="null" />
                <span>{{ 'shopping_list_detail.foto_del_ticket_o' | t }}</span>
              }
            </label>

            <div class="detail__sheet-grid">
              <div class="detail__field">
                <span class="detail__field-label">{{
                  'shopping_list_detail.que_es_la_foto' | t
                }}</span>
                <app-picker
                  [label]="'shopping_list_detail.modo' | t"
                  [options]="photoModes()"
                  [value]="photoMode()"
                  (valueChange)="setPhotoMode($event)"
                  data-test="photo-mode"
                />
              </div>
              <label class="detail__field">
                <span>{{ 'shopping_list_detail.nota_para_el_modelo' | t }}</span>
                <input
                  name="photoNote"
                  [placeholder]="'shopping_list_detail.es_del_chino_los' | t"
                  maxlength="280"
                  [ngModel]="photoNote()"
                  (ngModelChange)="photoNote.set($event)"
                />
              </label>
            </div>

            @if (photoError()) {
              <p class="detail__photo-error" role="alert" data-test="photo-error">
                <app-icon name="error_outline" [size]="18" [label]="null" />
                <span>{{ photoError() }}</span>
                @if (photoRedirect()) {
                  <a class="detail__link" [routerLink]="photoRedirect()">{{
                    'shopping_list_detail.configurar_la_ia' | t
                  }}</a>
                }
              </p>
            }

            @if (photoBusy()) {
              <p class="detail__photo-busy" role="status">
                <app-icon name="refresh" [size]="16" [label]="null" />{{
                  'shopping_list_detail.mirando_la_foto' | t
                }}
              </p>
            }

            @if (photoResult(); as result) {
              <ul class="detail__photo-lines">
                @for (line of result.lines; track $index) {
                  <li class="detail__photo-line" [class.detail__photo-line--off]="!line.keep">
                    <button
                      type="button"
                      class="detail__photo-keep"
                      role="checkbox"
                      [attr.aria-checked]="line.keep"
                      [attr.aria-label]="
                        'shopping_list_detail.anadir_nombre' | t: { name: line.name }
                      "
                      (click)="line.keep = !line.keep"
                    >
                      <app-icon
                        [name]="line.keep ? 'check_circle' : 'radio_button_unchecked'"
                        [size]="20"
                        [label]="null"
                      />
                    </button>
                    <input
                      class="detail__photo-name"
                      name="photoName{{ $index }}"
                      [attr.aria-label]="
                        'shopping_list_detail.foto_nombre_producto' | t: { name: line.name }
                      "
                      [ngModel]="line.name"
                      (ngModelChange)="line.name = $event"
                      maxlength="80"
                    />
                    <input
                      class="detail__photo-qty"
                      name="photoQty{{ $index }}"
                      type="number"
                      min="0"
                      step="0.1"
                      [attr.aria-label]="
                        'shopping_list_detail.foto_cantidad_producto' | t: { name: line.name }
                      "
                      [ngModel]="line.quantity"
                      (ngModelChange)="setLineQuantity(line, $event)"
                    />
                    <input
                      class="detail__photo-price"
                      name="photoPrice{{ $index }}"
                      inputmode="decimal"
                      placeholder="precio"
                      [attr.aria-label]="
                        'shopping_list_detail.foto_precio_producto' | t: { name: line.name }
                      "
                      [ngModel]="minorToInput(line.priceMinor)"
                      (ngModelChange)="setLinePrice(line, $event)"
                    />
                    <span class="detail__photo-cat" [style.color]="colorOf(line.category)">
                      {{ line.category ?? ('shopping_list_detail.sin_seccion' | t) }}
                      @if (line.createCategory) {
                        <span class="detail__photo-new">{{
                          'shopping_list_detail.nueva_2' | t
                        }}</span>
                      }
                    </span>
                    @if (line.confidence !== undefined && line.confidence < 0.6) {
                      <span
                        class="detail__photo-doubt"
                        [attr.title]="'shopping_list_detail.la_ia_no_esta' | t"
                        >{{ 'shopping_list_detail.baja_confianza' | t }}</span
                      >
                    }
                  </li>
                }
              </ul>
              @if (result.warnings.length) {
                <ul class="detail__photo-warnings">
                  @for (warning of result.warnings; track $index) {
                    <li>{{ warning }}</li>
                  }
                </ul>
              }
              <div class="detail__sheet-actions">
                <button type="button" class="detail__ghost" (click)="analyzePhoto()">
                  {{ 'shopping_list_detail.otro_intento' | t }}
                </button>
                <app-button
                  type="button"
                  variant="primary"
                  size="md"
                  data-test="photo-apply"
                  [disabled]="keptPhotoLines().length === 0 || photoApplying()"
                  (onClick)="applyPhoto()"
                >
                  {{
                    photoApplying()
                      ? ('shopping_list_detail.anadiendo' | t)
                      : ('shopping_list_detail.anadir_lineas' | t: { n: keptPhotoLines().length })
                  }}
                </app-button>
              </div>
            } @else {
              <div class="detail__sheet-actions">
                <app-button
                  type="button"
                  variant="primary"
                  size="md"
                  data-test="photo-analyze"
                  [disabled]="!photoData() || photoBusy()"
                  (onClick)="analyzePhoto()"
                >
                  {{
                    photoData()
                      ? ('shopping_list_detail.analizar_la_foto' | t)
                      : ('shopping_list_detail.elige_una_foto' | t)
                  }}
                </app-button>
              </div>
            }
          </section>
        </div>
      }

      @if (auditOpen()) {
        <div class="detail__sheet-backdrop" (click)="auditOpen.set(false)">
          <section
            class="detail__sheet"
            data-test="audit-sheet"
            (click)="$event.stopPropagation()"
            [attr.aria-label]="'shopping_list_detail.quien_ha_tocado_que' | t"
          >
            <h2 class="detail__sheet-title">
              {{ 'shopping_list_detail.quien_ha_tocado_que' | t }}
            </h2>
            <app-icon-button
              class="detail__sheet-x"
              icon="close"
              [label]="'shopping_list_detail.cerrar_el_historial' | t"
              size="sm"
              variant="ghost"
              data-test="audit-close"
              (onClick)="auditOpen.set(false)"
            />
            @if (events().length === 0) {
              <p class="detail__hint">{{ 'shopping_list_detail.todavia_no_hay_nada' | t }}</p>
            } @else {
              <ul class="detail__audit">
                @for (event of events(); track event.id) {
                  <li class="detail__audit-row" data-test="audit-row">
                    <app-avatar [name]="face(event).name" [src]="face(event).avatar" size="sm" />
                    <span class="detail__audit-text">{{ face(event).text }}</span>
                    <span class="detail__audit-when" [title]="when(event.created_at)">{{
                      since(event.created_at)
                    }}</span>
                  </li>
                }
              </ul>
            }
            <p class="detail__hint">{{ 'shopping_list_detail.se_actualiza_solo_mientras' | t }}</p>
          </section>
        </div>
      }
    </div>
  `,
  styles: [
    `
      .detail__display-options {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--space-3);
        padding: 0 0 var(--space-2);
        border-bottom: 1px solid var(--border-default);
      }
      .detail__display-picker {
        min-width: 190px;
      }
      @media (max-width: 600px) {
        .detail__display-options {
          display: grid;
          grid-template-columns: minmax(0, 1fr);
          gap: var(--space-1) var(--space-3);
        }
        .detail__display-picker {
          min-width: 0;
          width: 100%;
        }
      }
      .detail__group-title {
        display: flex;
        align-items: center;
        gap: var(--space-1);
      }
      .detail__group-dot {
        width: 8px;
        height: 8px;
        border-radius: var(--radius-full);
        /* Sin seccion conocida el punto no se pinta: un gris inventado pareceria un dato. */
        background: var(--bg-tertiary);
      }
      .detail__rename-row {
        display: flex;
        align-items: center;
        gap: var(--space-1);
      }
      .detail__rename-row .detail__rename {
        flex: 1 1 auto;
        min-width: 0;
      }
      .detail__tabs-spacer {
        flex: 1 1 auto;
      }
      .detail__tab {
        display: inline-flex;
        align-items: center;
        gap: var(--space-1);
      }
      .detail__tab-count {
        min-width: 18px;
        padding: 0 4px;
        border-radius: var(--radius-full);
        background: var(--bg-tertiary);
        font-size: 11px;
        font-variant-numeric: tabular-nums;
        color: var(--text-secondary);
      }
      .detail__check {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        color: var(--text-tertiary);
      }
      .detail__row--checked .detail__check {
        color: var(--primary);
      }
      .detail__offer {
        display: inline-flex;
        align-items: center;
        gap: 2px;
        border: none;
        background: var(--color-warning-50, rgba(201, 154, 46, 0.16));
        color: var(--warning, #b06e00);
        border-radius: var(--radius-full);
        padding: 1px 7px;
        font-size: 11px;
        font-weight: var(--font-semibold);
        font-family: inherit;
        cursor: pointer;
      }
      /* Antes este span ERA el avatar: un circulo de 22 px con dos letras dentro. Ahora el
         circulo lo pinta app-avatar, y aqui solo hace falta que no se deforme ni pelee con la
         fila —dos circulos uno dentro de otro es lo que sale si se queda el fondo—. Nada de
         backticks en este comentario: cierran el literal de estilos y el AOT se cae. */
      .detail__who {
        display: inline-flex;
        flex: none;
      }
      .detail__field-label {
        font-size: var(--text-xs);
        color: var(--text-secondary);
        text-transform: uppercase;
        letter-spacing: 0.03em;
      }
      .detail__chip-btn {
        display: inline-flex;
        align-items: center;
        gap: 4px;
      }
      .detail__chip-btn--muted {
        color: var(--text-tertiary);
      }
      .detail__sheet--wide {
        max-width: 640px;
      }
      /* El picker del descuento se abre dentro de la hoja, que tiene su propio scroll;
         sin margen el panel tapa la linea de acciones. */
      .detail__target {
        margin-top: var(--space-2);
      }
      .detail__first-units {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--space-2);
        margin-top: var(--space-2);
        font-size: var(--text-sm);
      }
      .detail__stepper {
        display: inline-flex;
        align-items: center;
        gap: var(--space-1);
      }
      .detail__stepper input {
        width: 62px;
        text-align: center;
        border: 1px solid var(--border-default);
        border-radius: var(--radius-md);
        background: var(--bg-primary);
        color: var(--text-primary);
        min-height: 36px;
        font-family: inherit;
        font-size: var(--text-sm);
      }
      .detail__discount {
        display: inline-flex;
        align-items: center;
        gap: var(--space-1);
        border: 1px dashed var(--primary);
        background: transparent;
        color: var(--primary);
        border-radius: var(--radius-full);
        padding: 3px var(--space-2);
        font-size: var(--text-xs);
        font-family: inherit;
        cursor: pointer;
      }
      /* Los dos controles de «vaciar» se turnan por pantalla, no se apilan ni se esconden los dos:
         en ancha manda el texto (es lo que se lee), en estrecha el boton compacto con su etiqueta
         accessible. La pareja anterior dejaba el texto con display none en TODO anchor (## 12ag,
         el rojo viejo de CI en shopping-lists > vaciar el carro). */
      @media (max-width: 720px) {
        .detail__ghost--text {
          display: none;
        }
      }
      @media (min-width: 721px) {
        .detail__bar-actions app-icon-button {
          display: none;
        }
      }
      .detail__photo-drop {
        position: relative;
        display: grid;
        gap: var(--space-1);
        justify-items: center;
        align-items: center;
        min-height: 132px;
        padding: var(--space-3);
        border: 1px dashed var(--border-strong);
        border-radius: var(--radius-xl);
        background: var(--bg-tertiary);
        color: var(--text-secondary);
        font-size: var(--text-sm);
        cursor: pointer;
        overflow: hidden;
      }
      .detail__photo-drop input[type='file'] {
        position: absolute;
        inset: 0;
        opacity: 0;
        cursor: pointer;
      }
      .detail__photo-drop img {
        max-height: 200px;
        max-width: 100%;
        border-radius: var(--radius-lg);
        object-fit: contain;
      }
      .detail__photo-drop--ready {
        border-style: solid;
        border-color: var(--primary);
      }
      .detail__photo-error {
        display: flex;
        align-items: center;
        gap: var(--space-2);
        margin: 0;
        padding: var(--space-2) var(--space-3);
        border-radius: var(--radius-md);
        background: var(--color-error-50, rgba(224, 90, 90, 0.12));
        color: var(--error);
        font-size: var(--text-sm);
      }
      .detail__photo-busy {
        display: flex;
        align-items: center;
        gap: var(--space-1);
        font-size: var(--text-sm);
        color: var(--text-secondary);
      }
      .detail__photo-lines {
        list-style: none;
        margin: 0;
        padding: 0;
        display: grid;
        gap: var(--space-1);
      }
      .detail__photo-line {
        display: grid;
        grid-template-columns: auto minmax(90px, 1.6fr) 62px 82px minmax(70px, 1fr);
        align-items: center;
        gap: var(--space-1);
        padding: var(--space-1) 0;
        border-bottom: 1px solid var(--border-default);
      }
      .detail__photo-line--off {
        opacity: 0.45;
      }
      .detail__photo-line input {
        border: 1px solid transparent;
        border-radius: var(--radius-sm);
        background: transparent;
        color: var(--text-primary);
        font-family: inherit;
        font-size: var(--text-sm);
        padding: 4px 6px;
        min-width: 0;
      }
      .detail__photo-line input:focus {
        outline: none;
        border-color: var(--primary);
        background: var(--bg-primary);
      }
      .detail__photo-qty,
      .detail__photo-price {
        text-align: right;
        font-variant-numeric: tabular-nums;
      }
      .detail__photo-cat {
        font-size: var(--text-xs);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .detail__photo-new {
        margin-left: 4px;
        color: var(--primary);
        font-size: 10px;
      }
      .detail__photo-doubt {
        font-size: 10px;
        color: var(--warning, #b06e00);
      }
      .detail__photo-keep {
        border: none;
        background: transparent;
        color: inherit;
        cursor: pointer;
        padding: 2px;
        display: inline-flex;
      }
      .detail__photo-warnings {
        margin: 0;
        padding-left: var(--space-4);
        font-size: var(--text-xs);
        color: var(--text-tertiary);
      }
      @media (max-width: 600px) {
        .detail__photo-line {
          grid-template-columns: auto 1fr 48px 60px;
        }
        .detail__photo-cat,
        .detail__photo-doubt {
          grid-column: 2 / -1;
        }
      }
      .detail__audit {
        list-style: none;
        margin: 0;
        padding: 0;
        display: grid;
        gap: var(--space-1);
        max-height: 46vh;
        overflow-y: auto;
      }
      .detail__audit-row {
        display: grid;
        grid-template-columns: auto 1fr auto;
        align-items: center;
        gap: var(--space-2);
        padding: var(--space-1) 0;
        border-bottom: 1px solid var(--border-default);
        font-size: var(--text-sm);
      }
      .detail__audit-text {
        min-width: 0;
        color: var(--text-primary);
      }
      .detail__audit-when {
        font-size: var(--text-xs);
        color: var(--text-tertiary);
        white-space: nowrap;
      }
      .detail {
        padding-block: var(--container-padding);
        max-width: 760px;
        margin: 0 auto;
        display: flex;
        flex-direction: column;
        gap: var(--space-3);
      }
      .detail__head {
        display: grid;
        grid-template-columns: auto 1fr auto;
        align-items: start;
        gap: var(--space-3);
      }
      .detail__back {
        display: grid;
        place-items: center;
        width: 40px;
        height: 40px;
        border-radius: var(--radius-full);
        background: var(--bg-secondary);
        border: 1px solid var(--border-default);
        color: var(--text-primary);
        text-decoration: none;
        font-size: var(--text-lg);
      }
      .detail__title {
        font-family: var(--font-display);
        font-size: var(--text-xl);
        font-weight: var(--font-bold);
        color: var(--text-primary);
        display: flex;
        align-items: center;
        gap: var(--space-2);
        cursor: pointer;
      }
      .detail__pencil {
        font-size: var(--text-sm);
        color: var(--text-tertiary);
      }
      .detail__rename {
        width: 100%;
        border: 1px solid var(--border-strong);
        border-radius: var(--radius-md);
        background: var(--bg-secondary);
        color: var(--text-primary);
        font-size: var(--text-lg);
        padding: var(--space-2);
      }
      .detail__meta {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--space-2);
        margin-top: var(--space-1);
        font-size: var(--text-sm);
        color: var(--text-secondary);
      }
      .detail__chip {
        padding: 2px var(--space-2);
        border-radius: var(--radius-full);
        background: var(--bg-tertiary);
        font-size: var(--text-xs);
      }
      .detail__chip--money {
        background: var(--success-subtle);
        color: var(--success);
      }
      .detail__chip--warn {
        background: var(--warning-subtle);
        color: var(--warning);
      }
      .detail__status {
        font-size: var(--text-xs);
        color: var(--text-tertiary);
        white-space: nowrap;
      }
      .detail__status--busy {
        color: var(--primary);
      }
      .detail__add {
        display: flex;
        gap: var(--space-2);
        align-items: center;
      }
      .detail__add-input {
        flex: 1;
        min-width: 0;
        border: 1px solid var(--border-default);
        border-radius: var(--radius-lg);
        background: var(--bg-secondary);
        color: var(--text-primary);
        padding: var(--space-3);
        font-size: var(--text-base);
        min-height: 48px;
      }
      .detail__ghost {
        border: 1px solid var(--border-default);
        border-radius: var(--radius-lg);
        background: var(--bg-secondary);
        color: var(--text-primary);
        font-size: var(--text-sm);
        padding: var(--space-2) var(--space-3);
        min-height: 44px;
        cursor: pointer;
      }
      .detail__ghost:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }
      .detail__ghost--danger {
        color: var(--error);
      }
      .detail__paste {
        display: grid;
        gap: var(--space-2);
        padding: var(--space-3);
        border: 1px solid var(--border-default);
        border-radius: var(--radius-xl);
        background: var(--bg-secondary);
      }
      .detail__paste textarea {
        border: 1px solid var(--border-default);
        border-radius: var(--radius-md);
        background: var(--bg-primary);
        color: var(--text-primary);
        padding: var(--space-2);
        font-size: var(--text-sm);
        font-family: inherit;
        resize: vertical;
      }
      .detail__paste-actions {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: var(--space-2);
        flex-wrap: wrap;
      }
      .detail__hint {
        font-size: var(--text-xs);
        color: var(--text-tertiary);
      }
      .detail__tabs {
        display: flex;
        align-items: center;
        gap: var(--space-2);
        flex-wrap: wrap;
      }
      .detail__tab {
        border: 1px solid var(--border-default);
        background: var(--bg-secondary);
        color: var(--text-secondary);
        border-radius: var(--radius-full);
        padding: var(--space-2) var(--space-3);
        font-size: var(--text-sm);
        cursor: pointer;
      }
      .detail__tab--active {
        background: var(--primary);
        border-color: var(--primary);
        color: var(--white);
      }
      .detail__tab-all {
        margin-left: auto;
        font-size: var(--text-xs);
      }
      .detail__empty {
        padding: var(--space-6);
        border: 1px dashed var(--border-default);
        border-radius: var(--radius-xl);
        text-align: center;
        color: var(--text-secondary);
        font-size: var(--text-sm);
      }
      .detail__groups,
      .detail__rows {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: var(--space-2);
      }
      .detail__group {
        list-style: none;
      }
      .detail__group-title {
        font-size: var(--text-xs);
        font-weight: var(--font-semibold);
        letter-spacing: var(--tracking-wider);
        text-transform: uppercase;
        color: var(--text-tertiary);
        margin: var(--space-3) 0 var(--space-2);
      }
      .detail__row {
        position: relative;
      }
      /* El gesto ya ejecuto su accion: 250 ms de silencio para que el click
         residual del arrastre no abra la hoja de una linea recien borrada. */
      .detail__row.swipe-row--busy {
        pointer-events: none;
        border-radius: var(--radius-lg);
        overflow: hidden;
        background: var(--bg-tertiary);
      }
      .detail__rail {
        position: absolute;
        inset: 0 0 0 auto;
        display: flex;
        align-items: stretch;
      }
      .detail__rail-btn {
        border: none;
        width: 84px;
        background: var(--bg-secondary);
        color: var(--text-primary);
        font-size: var(--text-sm);
        font-weight: var(--font-medium);
        cursor: pointer;
      }
      .detail__rail-btn--danger {
        background: var(--error);
        color: var(--white);
      }
      .detail__face {
        position: relative;
        z-index: 1;
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--space-2);
        padding: var(--space-2) var(--space-3);
        min-height: 56px;
        background: var(--bg-secondary);
        border-radius: var(--radius-lg);
        transform: translateX(var(--swipe-x, 0px));
        transition: transform var(--duration-200) var(--ease-out);
        touch-action: pan-y;
        user-select: none;
      }
      .swipe-row--dragging .detail__face {
        transition: none;
      }
      .swipe-row--armed .detail__face {
        background: var(--error);
        color: var(--white);
      }
      .detail__check {
        flex: none;
        width: 30px;
        height: 30px;
        border-radius: var(--radius-full);
        border: 1.5px solid var(--border-strong);
        background: transparent;
        color: var(--white);
        display: grid;
        place-items: center;
        cursor: pointer;
        font-size: var(--text-sm);
      }
      .detail__row--checked .detail__check {
        background: var(--success);
        border-color: var(--success);
      }
      .detail__name {
        flex: 1;
        min-width: 56px;
        font-size: var(--text-base);
        color: var(--text-primary);
        overflow-wrap: anywhere;
      }
      .detail__row--checked .detail__name {
        color: var(--text-tertiary);
        text-decoration: line-through;
      }
      .detail__qty {
        flex: none;
        font-size: var(--text-xs);
        color: var(--text-secondary);
      }
      .detail__price {
        flex: none;
        font-size: var(--text-sm);
        font-variant-numeric: tabular-nums;
        color: var(--text-primary);
      }
      .detail__price--none {
        color: var(--warning);
      }
      .detail__more {
        flex: none;
        border: none;
        background: transparent;
        color: var(--text-tertiary);
        font-size: var(--text-lg);
        line-height: 1;
        padding: var(--space-1) var(--space-2);
        cursor: pointer;
      }
      .detail__row--selected .detail__face {
        outline: 2px solid var(--primary);
        outline-offset: -2px;
      }
      .detail__bar {
        position: sticky;
        bottom: calc(var(--space-2) + env(safe-area-inset-bottom, 0px));
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--space-3);
        flex-wrap: wrap;
        padding: var(--space-3);
        background: var(--bg-secondary);
        border: 1px solid var(--border-default);
        border-radius: var(--radius-xl);
        box-shadow: var(--shadow-md);
      }
      .detail__totals {
        display: flex;
        align-items: baseline;
        gap: var(--space-2);
      }
      .detail__totals-money {
        font-family: var(--font-display);
        font-size: var(--text-xl);
        font-weight: var(--font-bold);
        font-variant-numeric: tabular-nums;
      }
      .detail__link {
        border: none;
        background: transparent;
        color: var(--primary);
        font-size: var(--text-xs);
        cursor: pointer;
        text-decoration: underline;
        padding: 0;
      }
      .detail__bar-actions {
        display: flex;
        flex-wrap: wrap;
        gap: var(--space-2);
        max-width: 100%;
      }
      .detail__estimate {
        list-style: none;
        margin: 0;
        padding: var(--space-3);
        display: flex;
        flex-direction: column;
        gap: var(--space-1);
        background: var(--bg-secondary);
        border: 1px solid var(--border-default);
        border-radius: var(--radius-lg);
        font-size: var(--text-sm);
      }
      .detail__estimate-row--sum {
        border-top: 1px solid var(--border-default);
        font-weight: var(--font-semibold);
      }
      /* Lo que costaba, tachado, junto a lo que se paga: el numero nuevo sin el viejo se
         discute; con el viejo al lado se entiende solo. */
      .detail__estimate-was {
        color: var(--text-tertiary);
        font-weight: var(--font-normal);
        text-decoration: line-through;
        margin-right: var(--space-1);
      }
      .detail__estimate-row {
        display: flex;
        gap: var(--space-2);
        align-items: baseline;
      }
      .detail__estimate-src {
        flex: 1;
        font-size: var(--text-xs);
        color: var(--text-tertiary);
      }
      .detail__estimate-money {
        font-variant-numeric: tabular-nums;
      }
      .detail__selection {
        position: sticky;
        bottom: calc(var(--space-10) + env(safe-area-inset-bottom, 0px));
        display: flex;
        align-items: center;
        gap: var(--space-2);
        flex-wrap: wrap;
        padding: var(--space-2) var(--space-3);
        background: var(--primary);
        color: var(--white);
        border-radius: var(--radius-xl);
        box-shadow: var(--shadow-lg);
      }
      .detail__selection .detail__ghost {
        background: transparent;
        border-color: transparent;
        color: var(--white);
        min-height: 36px;
      }
      .detail__selection-count {
        font-size: var(--text-sm);
        font-weight: var(--font-semibold);
      }
      .detail__sheet-backdrop {
        position: fixed;
        inset: 0;
        /* Debajo del modal de la app, no encima (## 12ah): el confirm de quitar linea es un
           app-modal (z-index 1000) y con la hoja a 1200 se pintaba DETRAS del backdrop
           oscurecido, inalcanzable. La escalera completa: popovers de pagina (45) < hoja (900)
           < modal/confirm (1000). */
        z-index: 900;
        background: rgba(0, 0, 0, 0.45);
        display: flex;
        align-items: flex-end;
      }
      /* La X arriba a la derecha, no un boton «Cancelar» mas abajo: en una hoja movida
         lo que se busca con el pulgar es el angulo, y el texto largo de un Cancelar
         estrencha el titulo. El backdrop tambien cierra; esto es lo que se ve. */
      .detail__sheet-x {
        position: absolute;
        top: var(--space-2);
        right: var(--space-2);
      }
      .detail__sheet {
        position: relative;
        width: 100%;
        max-width: 560px;
        margin: 0 auto;
        padding: var(--space-4);
        display: grid;
        gap: var(--space-3);
        background: var(--bg-secondary);
        border-radius: var(--radius-2xl) var(--radius-2xl) 0 0;
        animation: sheet-up var(--duration-300) var(--ease-out);
      }
      @keyframes sheet-up {
        from {
          transform: translateY(18px);
          opacity: 0;
        }
        to {
          transform: translateY(0);
          opacity: 1;
        }
      }
      .detail__sheet-title {
        font-size: var(--text-lg);
        font-weight: var(--font-semibold);
        color: var(--text-primary);
      }
      .detail__sheet-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: var(--space-3);
      }
      .detail__field {
        display: grid;
        gap: var(--space-1);
        font-size: var(--text-sm);
        color: var(--text-secondary);
      }
      .detail__field input,
      .detail__field select {
        border: 1px solid var(--border-default);
        border-radius: var(--radius-md);
        background: var(--bg-primary);
        color: var(--text-primary);
        padding: var(--space-3);
        font-size: var(--text-base);
        min-height: 48px;
      }
      .detail__chips {
        display: flex;
        gap: var(--space-1);
        flex-wrap: wrap;
      }
      .detail__chip-btn {
        border: 1px solid var(--border-default);
        background: var(--bg-primary);
        color: var(--text-secondary);
        border-radius: var(--radius-full);
        padding: var(--space-2) var(--space-3);
        font-size: var(--text-sm);
        cursor: pointer;
      }
      .detail__chip-btn--active {
        background: var(--primary);
        border-color: var(--primary);
        color: var(--white);
      }
      /* «Sin oferta» y «Sin descuento» NO son un estado: son una accion de quitar. Con el mismo
         borde gris que los demas chips se leian como una cuarta oferta posible. Borde discontinuo
         y color de aviso: es un quite, y no queda nunca «activo». */
      .detail__chip-btn--clear {
        border-style: dashed;
        border-color: color-mix(in srgb, var(--error) 45%, transparent);
        color: var(--error);
        background: transparent;
      }
      .detail__chip-btn--clear:hover {
        background: var(--error-subtle);
        border-color: var(--error);
      }
      .detail__sheet-actions {
        display: flex;
        justify-content: space-between;
        gap: var(--space-2);
      }
      @media (max-width: 600px) {
        .detail__sheet-backdrop {
          inset: 0 auto auto 0;
          width: 100vw;
          height: 100vh;
          width: 100dvw;
          height: 100dvh;
        }
        .detail__sheet {
          min-width: 0;
          max-height: calc(100dvh - env(safe-area-inset-top));
          overflow-y: auto;
          overscroll-behavior: contain;
          padding-bottom: calc(var(--space-4) + env(safe-area-inset-bottom));
        }
        .detail__sheet-grid {
          grid-template-columns: minmax(0, 1fr);
        }
      }

      /* ── descuento con varias dianas ─────────────────────────────── */
      /* La fila tocable es de 44 px minimo: quien elige los productos esta en la tienda,
         con una mano y el carrito delante, y una lista compacta de checkboxes es la receta
         para marcar la linea de al lado. */
      .detail__targets {
        display: grid;
        gap: var(--space-2);
        margin-top: var(--space-2);
      }
      .detail__targets-head {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: var(--space-2);
        font-size: var(--text-sm);
        color: var(--text-secondary);
      }
      .detail__target-list {
        list-style: none;
        margin: 0;
        padding: 0;
        display: grid;
        gap: 2px;
        max-height: 45vh;
        overflow-y: auto;
        overscroll-behavior: contain;
        border: 1px solid var(--border-default);
        border-radius: var(--radius-md);
        background: var(--bg-primary);
      }
      .detail__target-row {
        display: flex;
        align-items: center;
        gap: var(--space-2);
        width: 100%;
        min-height: 44px;
        padding: var(--space-2) var(--space-3);
        border: none;
        border-bottom: 1px solid var(--border-default);
        background: transparent;
        color: var(--text-primary);
        font: inherit;
        text-align: left;
        cursor: pointer;
        transition: var(--transition-fast);
      }
      .detail__target-row:last-child {
        border-bottom: none;
      }
      .detail__target-row.is-on {
        background: var(--primary-subtle);
      }
      .detail__target-row:active {
        transform: scale(0.99);
      }
      .detail__target-dot {
        width: 8px;
        height: 8px;
        border-radius: var(--radius-full);
        flex: 0 0 auto;
      }
      .detail__target-name {
        flex: 1 1 auto;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .detail__target-hint,
      .detail__chip-hint {
        flex: 0 0 auto;
        font-size: var(--text-xs);
        color: var(--text-tertiary);
      }
      .detail__target-empty {
        padding: var(--space-3);
        font-size: var(--text-sm);
        color: var(--text-tertiary);
      }
      .detail__target-add {
        display: flex;
        gap: var(--space-2);
        align-items: center;
      }
      .detail__target-add input {
        flex: 1 1 auto;
        min-width: 0;
      }
      .detail__discount--on {
        border-style: solid;
        background: var(--primary-subtle);
      }

      /* ── hoja de precios del cierre ────────────────────────────────── */
      .detail__pay {
        list-style: none;
        margin: 0;
        padding: 0;
        display: grid;
        gap: var(--space-3);
        max-height: 45vh;
        overflow-y: auto;
        overscroll-behavior: contain;
      }
      .detail__pay-row {
        display: grid;
        gap: var(--space-1);
        padding: var(--space-3);
        border: 1px solid var(--border-default);
        border-radius: var(--radius-md);
        background: var(--bg-primary);
      }
      .detail__pay-row--empty {
        border-color: var(--warning, #d9822b);
      }
      .detail__pay-head {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: var(--space-2);
      }
      .detail__pay-name {
        font-weight: 600;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .detail__pay-qty {
        flex: 0 0 auto;
        font-size: var(--text-sm);
        color: var(--text-tertiary);
        font-variant-numeric: tabular-nums;
      }
      .detail__pay-money {
        display: flex;
        align-items: center;
        gap: var(--space-2);
      }
      .detail__pay-money input {
        flex: 1 1 auto;
        min-width: 0;
        font-variant-numeric: tabular-nums;
      }
      .detail__pay-suggest {
        justify-self: start;
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: 2px var(--space-2);
        border: 1px dashed var(--border-default);
        border-radius: var(--radius-full);
        background: transparent;
        color: var(--text-secondary);
        font: inherit;
        font-size: var(--text-xs);
        cursor: pointer;
        transition: var(--transition-fast);
      }
      .detail__pay-suggest:hover {
        border-style: solid;
        color: var(--primary-dark);
      }
      .detail__pay-alias {
        font-size: var(--text-sm);
      }
      .detail__chip--linked {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: 2px var(--space-2);
        border-radius: var(--radius-full);
        background: var(--primary-subtle);
        color: var(--primary-dark);
        font-size: var(--text-xs);
      }
      .detail__hint--warn {
        color: var(--danger, #c62828);
      }
      /*
      * ── Estados de interaccion (HOGARIA-SPEC 12q-B) ───────────────────────────────────────────
      *
      * Todo lo que se pulsa avisa antes de que se pulse. Estan aqui, juntas, en lugar de repartidas por
      * las reglas de cada control, para que la proxima clase que se anada se compare con esta lista. El
      * check-ui (regla boton-sin-afecto) no deja a nadie anadir un boton sin su hover, pero un
      * boton sin hover ya existente se veia todos los dias y nadie decia nada: eso es lo que arregla
      * este bloque.
      *
      * Los :not(:disabled) no son decoracion: sin ellos, un boton apagado se ilumina al pasar por
      * encima, que es la manera mas rapida de ensenar a alguien a desconfiar de la pantalla.
      */

      /* Los de caja: el borde pasa a color de accion y el fondo se tina un paso. */
      .detail__ghost:hover:not(:disabled),
      .detail__back:hover {
        border-color: var(--primary);
        background: var(--primary-subtle);
        color: var(--primary-dark);
      }

      .detail__ghost--danger:hover:not(:disabled) {
        border-color: var(--error);
        background: var(--error-subtle);
        color: var(--error);
      }

      /* Pestanas: sin caja propia no se leia que eran pulsables —la clase activa si tenia fondo, la
      inactiva era texto suelto. Ahora son las dos mitades de la misma pastilla. */
      .detail__tab {
        padding: var(--space-2) var(--space-3);
        border: 1px solid var(--border-default);
        border-radius: var(--radius-full);
        background: var(--bg-secondary);
        color: var(--text-secondary);
        font-size: var(--text-sm);
        min-height: 40px;
      }

      .detail__tab:hover:not(.detail__tab--active) {
        border-color: var(--primary);
        color: var(--primary-dark);
        background: var(--primary-subtle);
      }

      .detail__tab--active:hover {
        background: var(--primary-dark);
        border-color: var(--primary-dark);
        color: var(--white);
      }

      /* Sueltos dentro de la fila: el icono sin caja es la unica senal de que la fila tiene acciones. */
      .detail__check:hover,
      .detail__more:hover,
      .detail__photo-keep:hover,
      .detail__sheet-x:hover {
        background: var(--bg-tertiary);
        color: var(--text-primary);
      }

      .detail__check,
      .detail__more,
      .detail__photo-keep,
      .detail__sheet-x {
        border-radius: var(--radius-full);
        transition: var(--transition-fast);
      }

      /* Riel de accion de la fila (swipe): la accion se ve en el gesto, asi que el hover se limita a
      aclarar/oscurecer lo que ya esta ahi, sin mover nada. */
      .detail__rail-btn:hover {
        background: var(--bg-tertiary);
      }

      .detail__rail-btn--danger:hover {
        background: var(--color-error-600, #b42318);
      }

      /* Chicles de oferta y descuento: mismos dos estados, tinta en lugar de caja. */
      .detail__chip-btn:hover,
      .detail__offer:hover,
      .detail__offer--discount:hover,
      .detail__discount:hover {
        border-color: var(--primary);
        color: var(--primary-dark);
        background: var(--primary-subtle);
      }

      .detail__chip-btn--active:hover {
        filter: brightness(0.94);
      }

      .detail__target-row:hover {
        background: var(--bg-tertiary);
      }

      .detail__link:hover {
        color: var(--primary-dark);
      }

      /* La capa detras de la hoja se pulsa para cerrarla: el puntero lo dice, y el hecho de que sea el
      fondo (no un control) se nota en que no se tina de color de accion. */
      .detail__sheet-backdrop {
        cursor: pointer;
      }
    `,

    /* El presupuesto de estilos por componente (10k de aviso, 20k de corte) se mide por hoja: el panel del
       autocompletado viaja en la suya, que ademas es CSS de un solo sitio y no necesita el resto. */
    `
      /* El panel cuelga del campo, y z-40 lo pone sobre las filas y bajo las hojas (## 12ad). */
      .detail__add-campo {
        position: relative;
        flex: 1;
        display: flex;
      }
      @media (max-width: 600px) {
        .detail__add {
          flex-wrap: wrap;
        }
        .detail__add-campo {
          flex: 1 1 100%;
          min-width: 0;
          display: grid;
          grid-template-columns: minmax(0, 1fr);
        }
      }
      .detail__sugs {
        position: absolute;
        top: calc(100% + 6px);
        left: 0;
        right: 0;
        z-index: 40;
        display: flex;
        flex-direction: column;
        gap: 2px;
        margin: 0;
        padding: var(--space-1);
        max-height: 264px;
        overflow: auto;
        background: var(--bg-secondary);
        border: 1px solid var(--border-default);
        border-radius: var(--radius-md);
        box-shadow: var(--shadow-md);
      }
      @media (max-width: 600px) {
        .detail__sugs {
          position: static;
          grid-column: 1 / -1;
          width: 100%;
          max-height: min(264px, 40dvh);
          margin-top: var(--space-2);
          z-index: auto;
        }
      }
      .detail__sug {
        display: flex;
        justify-content: space-between;
        gap: var(--space-3);
        padding: var(--space-2) var(--space-3);
        border: 0;
        background: none;
        color: var(--text-primary);
        font-size: var(--text-sm);
        border-radius: var(--radius-md);
        cursor: pointer;
      }
      .detail__sug:hover,
      .detail__sug--on {
        background: var(--primary-subtle);
      }
      .detail__sug-meta {
        color: var(--text-secondary);
        font-size: var(--text-xs);
        white-space: nowrap;
      }
      .detail__sug-casa {
        color: var(--color-success-600);
      }
    `
  ]
})
export class ShoppingListDetailComponent implements OnDestroy {
  private readonly i18n = inject(I18nService);
  private readonly shopping = inject(ShoppingService);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmService);
  /** Solo para el historial: las filas propias se pintan con la sesion viva. */
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly household = inject(HouseholdService);
  private openedHouseholdId = this.household.activeHouseholdId();
  private lastContextRevision = this.household.contextRevision();
  private contextSwitchPending = false;

  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  /** Banderin de un solo uso: el proximo `click` es residual de un gesto. */
  private swallowNextTap = false;
  private gestureAt = 0;

  readonly tab = signal<'todo' | 'checked'>('todo');
  readonly displayOrder = signal<'manual' | 'weight'>('manual');
  readonly groupByCategory = signal(true);
  readonly frozenLast = signal(false);
  readonly selection = signal<string[]>([]);
  readonly editing = signal<ShoppingListItem | null>(null);
  readonly renaming = signal(false);
  readonly estimateOpen = signal(false);
  readonly pasteOpen = signal(false);

  draftItem = '';
  draftPaste = '';
  draftName = '';
  draft: {
    quantity: number;
    unit: string | null;
    price: string;
    category: string | null;
    note: string | null;
    /** El descuento propio de la linea (§12h); `null` = ninguno. */
    discount: LineDiscount | null;
  } = {
    quantity: 1,
    unit: null,
    price: '',
    category: null,
    note: null,
    discount: null
  };

  readonly categories = LIST_CATEGORIES;
  readonly displayOrderOptions = computed<PickerOption[]>(() => {
    this.i18n.changeTick();
    return [
      {
        value: 'manual',
        label: this.i18n.t('shopping_list_detail.orden_manual')
      },
      {
        value: 'weight',
        label: this.i18n.t('shopping_list_detail.peso_mas_pesado_primero')
      }
    ];
  });
  readonly money = formatMoney;
  readonly offerPresets = OFFER_PRESETS;
  readonly describeOffer = describeOffer;

  /** El modelo guarda `promo_buy`/`promo_take`; la UI solo habla de `LineOffer`. */
  offerOf(item: ShoppingListItem): LineOffer | null {
    return offerOfItem(item);
  }

  /** Quien toco la linea por ultima vez (y si nadie la toco, quien la anadio). */
  whoName(item: ShoppingListItem): string {
    return String(item.updated_by_name ?? item.added_by_name ?? '').trim();
  }

  whoAvatar(item: ShoppingListItem): string | undefined {
    return item.updated_by_avatar ?? item.added_by_avatar ?? undefined;
  }
  readonly listId = inject(ActivatedRoute).snapshot.paramMap.get('id') ?? '';

  readonly list = computed(() => this.shopping.list());
  readonly loading = computed(() => this.shopping.loadingList());
  readonly saving = computed(() => this.shopping.saving());
  readonly estimate = computed(() => this.shopping.estimate());

  readonly items = computed(() => this.shopping.items());
  readonly visibleItems = computed(() => {
    const want = this.tab() === 'checked' ? 1 : 0;
    return this.items().filter((item) => item.checked === want);
  });
  /** La categoria guardada esta en castellano (es un valor, no una etiqueta): aqui se traduce. */
  protected etiquetaCategoria(categoria: string): string {
    const clave = listCategoryLabelKey(categoria);
    return clave ? this.i18n.t(clave) : categoria;
  }

  protected groupLabel(category: string): string {
    return category === UNGROUPED_CATEGORY
      ? this.i18n.t('shopping_list_detail.todos_los_productos')
      : this.etiquetaCategoria(category);
  }

  readonly groups = computed(() => {
    const items = orderShoppingItems(this.visibleItems(), {
      weightFirst: this.displayOrder() === 'weight',
      frozenLast: this.frozenLast()
    });
    if (this.tab() === 'checked' && this.groupByCategory()) {
      return [{ category: 'En el carro', items }];
    }
    if (this.groupByCategory()) {
      return groupItemsByCategory(items, { frozenLast: this.frozenLast() });
    }
    return [{ category: UNGROUPED_CATEGORY, items }];
  });
  readonly pendingCount = computed(() => this.items().filter((item) => item.checked === 0).length);
  readonly checkedCount = computed(() => this.items().filter((item) => item.checked === 1).length);
  readonly totalCount = computed(() => this.items().length);
  readonly unpricedCount = computed(() => this.estimate()?.unpriced.length ?? 0);

  constructor() {
    effect(() => {
      const revision = this.household.contextRevision();
      const activeHouseholdId = this.household.activeHouseholdId();
      const selectedHouseholdId = this.household.household()?.id ?? null;
      const switchingHousehold = this.household.switchingHousehold();
      const revisionChanged = revision !== this.lastContextRevision;
      const activeHouseholdChanged = activeHouseholdId !== this.openedHouseholdId;

      if (revisionChanged || activeHouseholdChanged) {
        this.lastContextRevision = revision;
        if (switchingHousehold || activeHouseholdChanged) {
          this.contextSwitchPending = true;
          this.stopStream();
        }
      }

      if (
        !this.contextSwitchPending ||
        switchingHousehold ||
        (activeHouseholdId && selectedHouseholdId !== activeHouseholdId)
      ) {
        return;
      }

      this.contextSwitchPending = false;
      if (this.openedHouseholdId && activeHouseholdId !== this.openedHouseholdId) {
        this.stopStream();
        void this.router.navigate(['/shopping'], { replaceUrl: true });
        return;
      }

      // La carga inicial puede resolver el hogar después de montar esta ruta. En ese
      // primer caso se adopta el contexto; un cambio posterior sí cierra el detalle.
      this.openedHouseholdId = activeHouseholdId;
      if (this.listId) this.shopping.loadList(this.listId);
      this.startStream();
    });

    // Una sola carga inicial: el resto de la pantalla se actualiza con lo que
    // confirma el servidor, y el autoguardado ya se ocupa del resto.
    if (this.listId) {
      this.shopping.loadList(this.listId);
      this.shopping.loadCategories();
    }
    // En vivo: si otra persona de la casa toca la lista, se vuelve a leer (nunca se pinta
    // el payload del aviso, que es una pista de refresco, no el estado).
    this.startStream();
  }

  readonly liveBy = signal<string | null>(null);
  private cancelingRename = false;

  ngOnDestroy(): void {
    this.timers.forEach((timer) => clearTimeout(timer));
    this.timers.clear();
    this.stopStream();
  }

  private startStream(): void {
    this.stopStream();
    const contextRevision = this.household.contextRevision();
    this.cancelStream = this.shopping.openStream(shoppingStreamPath(this.listId), (payload) => {
      if (contextRevision !== this.household.contextRevision()) return;
      this.shopping.loadList(this.listId);
      if (this.auditOpen()) this.shopping.loadEvents(this.listId);
      const event = payload as { byName?: string | null; action?: string } | null;
      if (event?.byName) this.liveBy.set(event.byName);
    });
  }

  private stopStream(): void {
    this.cancelStream?.();
    this.cancelStream = null;
  }

  selectTab(tab: 'todo' | 'checked'): void {
    this.tab.set(tab);
    this.selection.set([]);
  }

  setDisplayOrder(value: string | null): void {
    if (value === 'manual' || value === 'weight') this.displayOrder.set(value);
  }

  qtyOf(item: ShoppingListItem): string {
    return formatQuantity(item.quantity, item.unit);
  }

  isSelected(id: string): boolean {
    return this.selection().includes(id);
  }

  // ------------------------------------------------------------- anadir

  async addItem(): Promise<void> {
    const raw = this.draftItem.trim();
    if (!raw) return;
    this.draftItem = '';
    // Si la ultima accion sobre el campo fue elegir una sugerencia, la linea se crea con el nombre del
    // catalogo (que es lo que enlaza precio y ficha), la cantidad que el usuario dejo escrita, la unidad
    // canonica del catalogo si el usuario no puso ninguna y la seccion de su pasillo: la hoja del super
    // ya dice donde se compra y la linea no deberia esperar a que alguien la clasifique a mano (## 12ah).
    // Escribirlo a mano sigue valiendo igual.
    const sug = this.sugElegida;
    this.sugElegida = null;
    this.cerrarSugerencias();
    const parsed = parseQuickAddLine(raw);
    const input = sug
      ? {
          name: sug.producto.name,
          quantity: parsed.quantity,
          unit: parsed.unit ?? sug.producto.unit,
          category: seccionDeLista(sug.producto.category)
        }
      : parsed;
    await this.shopping.addItem(this.listId, input);
  }

  // ── sugerencias del catalogo del super (## 12ag) ──
  // La casa ya conoce 471 productos con su hoja, su unidad y su etiqueta; escribir «Leche semidesnatada»
  // entero para que el precio aprendido en la tienda anterior se enganche a la linea es trabajo del
  // catalogo, no del pulgar del usuario. Se consulta el MISMO endpoint que usa el gestor de la despensa
  // (`/pantry/catalog/products`, normalizado y paginado) —otra fuente de sugerencias seria otro criterio
  // de «que existe» que romper la familia—.
  private readonly pantry = inject(PantryService);
  readonly sugerencias = signal<PantryCatalogProduct[]>([]);
  readonly sugAbiertas = signal(false);
  protected sugActivo = -1;
  private sugElegida: {
    producto: PantryCatalogProduct;
    parsed: { name: string; quantity: number; unit: string | null };
  } | null = null;
  private sugSeq = 0;

  /** El texto libre empieza por cantidad+unidad a veces («2kg lec»); se busca por la parte del nombre. */
  onDraftInput(valor: string): void {
    this.sugElegida = null; // el borrador ha cambiado: la eleccion anterior ya no representa el texto
    const nombre = parseQuickAddLine(valor.trim()).name.trim();
    const pending = this.timers.get('sug:input');
    if (pending) clearTimeout(pending);
    if (nombre.length < 2) {
      // Con una letra cualquier cosa es «cualquier producto»: se cierra el panel y no se dispara nada.
      this.sugAbiertas.set(false);
      this.sugerencias.set([]);
      return;
    }
    this.timers.set(
      'sug:input',
      setTimeout(() => {
        this.timers.delete('sug:input');
        const seq = ++this.sugSeq;
        void this.pantry.listCatalog({ q: nombre, limit: 6 }).then((resultado) => {
          if (seq !== this.sugSeq) return; // una respuesta llegada tarde ya no describe el texto actual
          const lista = resultado?.data ?? [];
          this.sugerencias.set(lista);
          this.sugActivo = -1;
          this.sugAbiertas.set(lista.length > 0);
        });
      }, 150)
    );
  }

  /** Enter sin nada resaltado manda la linea tecleada (el comportamiento de siempre); con resaltado, elige. */
  protected onDraftKeys(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      this.cerrarSugerencias();
      return;
    }
    if (!this.sugAbiertas()) return;
    const n = this.sugerencias().length;
    if (n === 0) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      this.sugActivo = (this.sugActivo + 1) % n;
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      this.sugActivo = this.sugActivo <= 0 ? n - 1 : this.sugActivo - 1;
    } else if (event.key === 'Enter' && this.sugActivo >= 0) {
      event.preventDefault();
      this.aplicarSugerencia(this.sugActivo);
    }
  }

  protected mantenerFocoParaAnadir(event: MouseEvent): void {
    // En móvil el listbox está en el flujo: al mover el foco, blur lo cerraría y
    // reubicaría el botón antes del click. Mantener el foco del combobox hasta submit evita perderlo.
    if (this.sugAbiertas()) event.preventDefault();
  }

  protected aplicarSugerencia(indice: number): void {
    const producto = this.sugerencias()[indice];
    if (!producto) return;
    const raw = this.draftItem.trim();
    const parsed = parseQuickAddLine(raw);
    // Se cambia SOLO la parte del nombre: el prefijo con cantidad y unidad («2kg ») sigue donde estaba.
    this.draftItem =
      parsed.name && raw.endsWith(parsed.name)
        ? `${raw.slice(0, -parsed.name.length)}${producto.name}`
        : producto.name;
    this.sugElegida = { producto, parsed };
    this.cerrarSugerencias();
  }

  cerrarSugerencias(): void {
    // Cerrar es cerrar de verdad: si el retardo del tecleo o una consulta ya en vuelo siguen vivos,
    // el panel reaparece un latido despues sobre la primera fila de la lista y se come los clics.
    const pendiente = this.timers.get('sug:input');
    if (pendiente) {
      clearTimeout(pendiente);
      this.timers.delete('sug:input');
    }
    this.sugSeq++;
    this.sugAbiertas.set(false);
    this.sugActivo = -1;
  }

  async paste(): Promise<void> {
    const text = this.draftPaste.trim();
    if (!text) return;
    const result = await this.shopping.addLines(this.listId, text);
    if (!result) return;
    this.draftPaste = '';
    this.pasteOpen.set(false);
    const skipped = result.skipped.length;
    this.toast.success(
      this.i18n.t('ui.n_lineas_anadidas', { n: result.added + result.merged }),
      skipped > 0
        ? this.i18n.t('ui.repetidas_ignoradas', { n: skipped })
        : this.i18n.t('ui.revisa_las_cantidades_y')
    );
  }

  // ------------------------------------------------------------- marcado

  toggle(item: ShoppingListItem): void {
    if (this.selection().length > 0) {
      this.pick(item.id);
      return;
    }
    this.shopping.toggleItem(item.list_id, item);
  }

  onTap(item: ShoppingListItem): void {
    if (this.swallowNextTap) {
      this.swallowNextTap = false;
      if (Date.now() - this.gestureAt < 600) return;
    }
    if (this.selection().length > 0) {
      this.pick(item.id);
      return;
    }
    this.toggle(item);
  }

  /**
   * Soltar un arrastre dispara `click` para el navegador, igual que un toque. Se
   * resuelve con un banderin de un solo uso y no con una ventana de tiempo: en una
   * maquina lenta el click puede llegar 300 ms despues del gesto, y ahi un reloj
   * corto se come el toque siguiente mientras que el banderin, no. El plazo de 600
   * ms solo existe para que un gesto terminado fuera de la fila no deje la fila muda.
   */
  noteGesture(): void {
    this.swallowNextTap = true;
    this.gestureAt = Date.now();
  }

  onLongPress(item: ShoppingListItem): void {
    this.noteGesture();
    if (this.selection().length === 0) this.selection.set([item.id]);
    else this.pick(item.id);
  }

  pick(id: string): void {
    this.selection.update((selected) =>
      selected.includes(id) ? selected.filter((entry) => entry !== id) : [...selected, id]
    );
  }

  toggleSelectAll(): void {
    if (this.selection().length > 0) {
      this.selection.set([]);
      return;
    }
    this.selection.set(this.visibleItems().map((item) => item.id));
  }

  async bulkCheck(checked: boolean): Promise<void> {
    const ids = this.selection();
    this.shopping.bulkCheck(this.listId, ids, checked);
    this.selection.set([]);
  }

  async bulkRemove(): Promise<void> {
    const ids = this.selection();
    if (ids.length === 0) return;
    this.shopping.bulkRemove(this.listId, ids);
    this.selection.set([]);
    this.toast.show({
      type: 'info',
      title: this.i18n.t('ui.n_lineas_quitadas', { n: ids.length }),
      duration: UNDO_MS,
      countdown: true,
      position: 'bottom',
      action: {
        label: this.i18n.t('ui.deshacer'),
        run: () => ids.forEach((id) => void this.shopping.restoreItem(this.listId, id))
      }
    });
  }

  plus(item: ShoppingListItem): void {
    this.shopping.bumpItem(item.list_id, item);
  }

  /**
   * Quitar una linea pregunta antes, y el aviso nombra la linea. El Deshacer del toast se queda:
   * no cubre el «me he equivocado al confirmar» (para eso esta el confirm), cubre el «el servidor no se
   * entero», que es otro fallo y necesita otro remedio.
   */
  async remove(item: ShoppingListItem): Promise<void> {
    const accepted = await this.confirm.confirm({
      title: this.i18n.t('ui.quitar_de_la_lista'),
      message: this.i18n.t('ui.borrar_de_la_compra', { name: item.name }),
      confirmText: this.i18n.t('shopping_list_detail.quitar'),
      variant: 'danger'
    });
    if (!accepted) return;
    const listId = item.list_id;
    void this.shopping.removeItem(listId, item).then(() => {
      // La barra sale pase lo que pase con la red: la fila ya no esta en la lista,
      // y dejar a alguien sin forma de devolverla es el peor resultado posible.
      // Si el server nunca se entero, Deshacer restaura una fila viva (404) y el
      // servicio lo cuenta; si se entero, Deshacer hace lo que promete.
      this.toast.show({
        type: 'info',
        title: this.i18n.t('ui.item_quitada', { name: item.name }),
        message: this.i18n.t('ui.tienes_6_segundos_para'),
        duration: UNDO_MS,
        countdown: true,
        position: 'bottom',
        action: {
          label: this.i18n.t('ui.deshacer'),
          run: () => {
            void this.shopping.restoreItem(listId, item.id);
          }
        }
      });
    });
  }

  async clearChecked(): Promise<void> {
    const items = this.items().filter((item) => item.checked === 1);
    if (items.length === 0) return;
    // Es un borrado multiple, y un multiple es el unico sitio donde «le di a sin mirar» cuesta una
    // tarde de reescribir lineas: el aviso cuenta cuantas se van.
    const accepted = await this.confirm.confirm({
      title: this.i18n.t('ui.vaciar_lo_comprado'),
      message: this.i18n.t(items.length === 1 ? 'ui.vaciar_una_linea' : 'ui.vaciar_varias_lineas', {
        n: items.length
      }),
      confirmText: this.i18n.t('ui.vaciar'),
      variant: 'danger'
    });
    if (!accepted) return;
    await this.shopping.clearChecked(this.listId);
    this.toast.show({
      type: 'success',
      title: this.i18n.t('ui.n_lineas_vaciadas', { n: items.length }),
      duration: UNDO_MS,
      countdown: true,
      position: 'bottom',
      action: {
        label: this.i18n.t('ui.deshacer'),
        run: () => items.forEach((item) => void this.shopping.restoreItem(this.listId, item.id))
      }
    });
  }

  // ------------------------------------------------------- hoja de edicion

  /** Al abrir la hoja se traen los productos con precio: el enlace se elige ahi, y no se
   *  puede elegir lo que no se ha cargado. */
  openEdit(item: ShoppingListItem): void {
    void this.shopping.loadKnownProducts();
    // Un ⋯ que llega tarde (el arrastre que lo precedio ya borro la linea) no abre
    // una hoja sobre una fila que ya no existe.
    if (!this.items().some((candidate) => candidate.id === item.id)) return;
    this.editing.set(item);
    this.draft = {
      quantity: item.quantity,
      unit: item.unit,
      price: item.price_minor === null ? '' : (item.price_minor / 100).toFixed(2).replace('.', ','),
      category: item.category,
      note: item.note,
      discount: lineDiscountOfItem(item)
    };
    this.hydrateLineDiscount(item);
  }

  closeEdit(): void {
    // Cerrar la hoja no descarta: lo ultimo tecleado (la unidad suelta, la nota...) puede ir todavia
    // dentro del retardo del autoguardado. Si al cerrar no se dispara, reabrir muestra el dato viejo y
    // la impresion es que la app no guardo nada (## 12ag).
    const item = this.editing();
    if (item) this.flush(`item:${item.id}`);
    this.editing.set(null);
  }

  /** Autoguardado con retardo: se escribe cuando dejas de teclear, no a cada letra. */
  patch(
    changes: Partial<{
      quantity: number;
      unit: string | null;
      category: string | null;
      note: string | null;
      discount: LineDiscount | null;
    }>
  ): void {
    const item = this.editing();
    if (!item) return;
    // Una cantidad que no es positiva se deja en el campo pero no se envia: el
    // contrato la rechaza, y serie ruido de error por cada tecla intermedia.
    if (changes.quantity !== undefined && !(Number(changes.quantity) > 0)) return;
    Object.assign(this.draft, changes);
    // Todo en el MISMO envio: con dos `debounced` separados, tocar un chip del descuento
    // reemplazaba el commit del precio que estaba en el tintero, y el precio se perdía sin
    // avisar. Lo mismo aplica al precio desde 12ag: `linePatch` es el unico payload.
    this.commit(this.linePatch(parseMoneyToMinor(this.draft.price)));
  }

  private commit(patch: Partial<CreateItemInput>): void {
    const item = this.editing();
    if (!item) return;
    this.debounced(`item:${item.id}`, () => {
      this.shopping.updateItem(item.list_id, item, patch);
    });
  }

  patchPrice(value: string): void {
    this.draft.price = value;
    const minor = parseMoneyToMinor(value);
    if (minor === null && value.trim() !== '') return;
    // El payload completo, no solo el precio: dos retados distintos sobre la misma linea se
    // pisaban el uno al otro, y ganaba el ultimo en llegar.
    this.commit(this.linePatch(minor));
  }

  /** Lo que se escribe en la hoja, junto: un solo envio, un solo version. */
  private linePatch(priceMinor: number | null): Partial<CreateItemInput> {
    return {
      quantity: this.draft.quantity,
      unit: this.draft.unit,
      category: this.draft.category,
      note: this.draft.note,
      priceMinor,
      discount: this.draft.discount
    };
  }

  commitPrice(): void {
    const item = this.editing();
    if (!item) return;
    const value = this.draft.price.trim();
    const minor = value === '' ? null : parseMoneyToMinor(value);
    if (value !== '' && minor === null) {
      this.toast.warning(this.i18n.t('ui.precio_no_valido'), this.i18n.t('ui.escribe_algo_como_1'));
      return;
    }
    const hadPending = this.timers.has(`item:${item.id}`);
    this.flush(`item:${item.id}`);
    // Si habia algo en el tintero, `flush` lo ha escrito ya con este precio dentro (patch lo
    // mete en el payload). Mandarlo otra vez seria un segundo PATCH con el `version` viejo:
    // el CAS lo rechazaria y el aviso de error mentiria.
    if (!hadPending) this.shopping.updateItem(item.list_id, item, { priceMinor: minor });
  }

  private debounced(key: string, run: () => void): void {
    const pending = this.timers.get(key);
    if (pending) clearTimeout(pending);
    const disparo = () => {
      this.timers.delete(key);
      this.debouncedRuns.delete(key);
      run();
    };
    this.debouncedRuns.set(key, disparo);
    this.timers.set(key, setTimeout(disparo, AUTOSAVE_MS));
  }

  /** Las ejecuciones aplazadas del retardo, localizables: `flush` es tocar el timbre antes de hora. */
  private readonly debouncedRuns = new Map<string, () => void>();

  private flush(key: string): void {
    const pending = this.timers.get(key);
    if (pending) {
      clearTimeout(pending);
      this.timers.delete(key);
    }
    // Antes `flush` SOLO cancelaba: y cancelar sin ejecutar dejaba en la cuneta el ultimo cambio
    // (la medida escrita a mano, por ejemplo). El retardo existe para no escribir a cada tecla,
    // no para tirar lo tecleado (## 12ag).
    this.debouncedRuns.get(key)?.();
  }

  // ------------------------------------------------------------ cabecera

  startRename(): void {
    this.draftName = this.list()?.name ?? '';
    this.renaming.set(true);
  }

  renameList(): void {
    const list = this.list();
    const name = this.draftName.trim();
    if (!list || !name || name === list.name) return;
    this.debounced(
      'list:name',
      () => void this.shopping.renameList(list.id, { name }, list.version)
    );
  }

  /**
   * Terminar la compra. Decide el server (toda linea comprada necesita precio y tienda), y
   * su rechazo no se traduce a un toast: abre la hoja donde se escriben los precios, porque
   * quien cierra una lista esta de pie en el pasillo con el ticket en la mano, y lo ultimo
   * que necesita es otro sitio al que ir a buscar el boton.
   */
  async complete(): Promise<void> {
    const list = this.list();
    if (!list) return;
    const result = await this.shopping.complete(list.id);
    if (result.ok) {
      this.finishCompleteToast(result.paidMinor, result.pricesRecorded, result.store, {
        moved: result.pantryMoved,
        merged: result.pantryMerged
      });
      return;
    }
    if (result.code === 'PRICES_MISSING') {
      this.openPay(result.missing);
      return;
    }
    if (result.code === 'STORE_REQUIRED') {
      this.payOpen.set(true);
      this.payStoreError.set(true);
      return;
    }
    if (result.code === 'STALE_LIST') {
      this.toast.show({
        type: 'info',
        title: this.i18n.t('ui.la_lista_habia_cambiado'),
        message: this.i18n.t('ui.se_ha_vuelto_a')
      });
      this.shopping.loadList(list.id);
    }
  }

  private finishCompleteToast(
    paidMinor: number,
    recorded: number,
    store: string | null,
    pantry = { moved: 0, merged: 0 }
  ): void {
    const total = this.estimate()?.totalMinor ?? 0;
    const unpriced = this.unpricedCount();
    const partes = [
      store
        ? this.i18n.t('ui.pagado_en_tienda', {
            importe: formatMoney(paidMinor || total),
            tienda: store
          })
        : this.i18n.t('ui.pagado_sin_tienda', { importe: formatMoney(paidMinor || total) }),
      this.i18n.t(recorded === 1 ? 'ui.precio_apuntado_uno' : 'ui.precios_apuntados_varios', {
        n: recorded
      })
    ];
    // Y lo que ha caido en la nevera: el cierre ya no es solo contabilidad, es el puente entre el carro y
    // el inventario (## 12ag). Se suma una en el recibo del pago, no un segundo toast: una accion, un aviso.
    const inventario = pantry.moved + pantry.merged;
    if (inventario > 0) {
      partes.push(
        this.i18n.t(inventario === 1 ? 'ui.al_inventario_uno' : 'ui.al_inventario_varias', {
          n: inventario
        })
      );
    }
    if (unpriced > 0) {
      partes.push(
        this.i18n.t(unpriced === 1 ? 'ui.linea_pendiente_una' : 'ui.lineas_pendientes_varias', {
          n: unpriced
        })
      );
    }
    this.toast.success(this.i18n.t('ui.compra_terminada'), partes.join(' · ') + '.');
    void this.router.navigate(['/shopping'], { queryParams: { tab: 'hechas' } });
  }

  // ------------------------------------------------ hoja de precios del cierre

  readonly payOpen = signal(false);
  readonly payLines = signal<MissingPriceLine[]>([]);
  readonly payStore = signal('');
  readonly payStoreError = signal(false);
  private payValues = new Map<string, string>();
  private payModes = new Map<string, 'unit' | 'total'>();
  private payAliases = new Map<string, string>();

  readonly storeChips = computed(() =>
    this.shopping
      .stores()
      .slice(0, 4)
      .map((entry) => entry.store)
  );

  /**
   * Se parte de lo que el server ha rechazado, no de toda la lista: las lineas con precio
   * ya estan bien, y volver a pedirlas es desconfiar de quien lo acaba de escribir.
   */
  openPay(missing: MissingPriceLine[]): void {
    this.payLines.set(missing);
    this.payStore.set(this.list()?.store?.trim() ?? '');
    this.payStoreError.set(false);
    for (const line of missing) {
      const suggested = this.paySuggestion(line.itemId);
      if (suggested && !this.payValue(line.itemId).trim())
        this.payValues.set(line.itemId, formatMoney(suggested.minor));
    }
    this.payOpen.set(true);
  }

  payValue(itemId: string): string {
    return this.payValues.get(itemId) ?? '';
  }

  setPayValue(itemId: string, value: string | null): void {
    this.payValues.set(itemId, String(value ?? ''));
  }

  setPayStore(value: string | null): void {
    this.payStore.set(String(value ?? ''));
    this.payStoreError.set(false);
  }

  choosePayStore(store: string): void {
    this.setPayStore(store);
  }

  payMode(itemId: string): 'unit' | 'total' {
    return this.payModes.get(itemId) ?? 'unit';
  }

  /**
   * Un ticket dice «3,90 €», una memoria dice «a 1,30». Se puede entrar cualquiera de las
   * dos y la otra se calcula: la division la hace el server sobre las unidades PAGADAS, que
   * con una oferta 3x2 no son las llevadas —y ahi es donde un reparto a mano enseña a la app
   * un precio un tercio mas barato del real, para siempre.
   */
  togglePayMode(itemId: string): void {
    this.payModes.set(itemId, this.payMode(itemId) === 'unit' ? 'total' : 'unit');
  }

  payAlias(itemId: string): string {
    return this.payAliases.get(itemId) ?? '';
  }

  setPayAlias(itemId: string, value: string | null): void {
    this.payAliases.set(itemId, String(value ?? ''));
  }

  paySuggestion(itemId: string): { minor: number; store: string | null } | null {
    const line = this.estimate()?.lines.find((entry) => entry.itemId === itemId);
    if (!line || line.source === 'unpriced' || line.unitMinor == null) return null;
    const quantity = this.items().find((item) => item.id === itemId)?.quantity ?? 1;
    return {
      minor: Math.max(0, Math.round(line.unitMinor * (quantity || 1))),
      store: line.store ?? null
    };
  }

  usePaySuggestion(itemId: string, minor: number): void {
    this.payModes.set(itemId, 'total');
    this.payValues.set(itemId, formatMoney(minor));
  }

  payMissing(): number {
    return this.payLines().filter((line) => parseMoneyToMinor(this.payValue(line.itemId)) === null)
      .length;
  }

  payTotal(): number {
    let total = 0;
    for (const line of this.payLines()) {
      const minor = parseMoneyToMinor(this.payValue(line.itemId));
      if (minor === null) continue;
      total +=
        this.payMode(line.itemId) === 'unit' ? Math.round(minor * (line.quantity || 1)) : minor;
    }
    return total;
  }

  closePay(): void {
    this.payOpen.set(false);
    this.payStoreError.set(false);
  }

  /** Escribir los precios y cerrar va en la MISMA llamada: dos peticiones sueltas dejan la
   *  ventana en la que el cierre llega antes que el precio y la lista se archiva coja. */
  async finishPurchase(): Promise<void> {
    const list = this.list();
    if (!list) return;
    const store = this.payStore().trim();
    const prices: CompletePriceInput[] = [];
    for (const line of this.payLines()) {
      const minor = parseMoneyToMinor(this.payValue(line.itemId));
      if (minor === null) continue;
      const alias = this.payAlias(line.itemId).trim();
      prices.push(
        this.payMode(line.itemId) === 'unit'
          ? { itemId: line.itemId, priceMinor: minor, ...(alias ? { productName: alias } : {}) }
          : {
              itemId: line.itemId,
              totalPaidMinor: minor,
              quantity: line.quantity || 1,
              ...(alias ? { productName: alias } : {})
            }
      );
    }
    const result = await this.shopping.complete(list.id, { store: store || null, prices });
    if (result.ok) {
      this.payOpen.set(false);
      this.finishCompleteToast(
        result.paidMinor,
        result.pricesRecorded,
        result.store || store || null,
        {
          moved: result.pantryMoved,
          merged: result.pantryMerged
        }
      );
      return;
    }
    if (result.code === 'PRICES_MISSING') {
      this.openPay(result.missing);
      return;
    }
    if (result.code === 'STORE_REQUIRED') this.payStoreError.set(true);
  }

  // ---------------------------------------------------------- enlace de producto

  /** La clave se compara como en el server: dos normalizaciones distintas es tener dos
   *  opiniones sobre si «Jamón Serrano» es el producto que ya tiene precio. */
  keyOf(name: string): string {
    return productKeyOf(name);
  }

  readonly productLinkOptions = computed<PickerOption[]>(() =>
    this.shopping.knownProducts().map((product) => ({
      value: product.productKey,
      label: product.name,
      hint:
        product.variants.length > 1
          ? product.variants.length + ' tiendas'
          : product.observations + ' precios'
    }))
  );

  /** Cuanto cuesta el producto enlazado en cada tienda: la frase que hace saber que el
   *  enlace existe y que los precios no son uno solo. */
  linkVariants(item: ShoppingListItem): string | null {
    const product = this.shopping
      .knownProducts()
      .find((entry) => entry.productKey === item.product_key);
    if (!product?.variants.length) return null;
    return product.variants
      .map(
        (variant) =>
          `${variant.store ?? this.i18n.t('shopping_list_detail.sin_tienda')} ${formatMoney(variant.unitMinor)}`
      )
      .join(' · ');
  }

  async linkProduct(item: ShoppingListItem, key: string | null): Promise<void> {
    if (!key || key === item.product_key) return;
    await this.shopping.updateItemSync(item.list_id, item, { productKey: key });
  }

  async unlinkProduct(item: ShoppingListItem): Promise<void> {
    await this.shopping.updateItemSync(item.list_id, item, { productKey: null });
  }

  sourceLabel(source: 'manual' | 'observed' | 'unpriced'): string {
    // La condicion elige la clave y el diccionario pone la frase: asi se traduce y el gate lo ve.
    const clave =
      source === 'manual'
        ? 'shopping_list_detail.precio_de_esta_lista'
        : source === 'observed'
          ? 'shopping_list_detail.ultimo_precio_pagado'
          : 'shopping_list_detail.aun_sin_precio';
    return this.i18n.t(clave);
  }

  // -------------------------------------------------- renombrar (con forma de salir)

  commitRename(): void {
    this.flush('list:name');
    const list = this.list();
    const name = this.draftName.trim();
    this.renaming.set(false);
    if (!list || !name || name === list.name) return;
    void this.shopping.renameList(list.id, { name }, list.version);
  }

  /** Cancelar NO es solo cerrar el input: el texto que se habia autoguardado se deshace. */
  cancelRename(): void {
    this.cancelingRename = true;
    const previous = this.list()?.name ?? '';
    this.draftName = previous;
    this.renaming.set(false);
    setTimeout(() => (this.cancelingRename = false));
  }

  onRenameBlur(): void {
    if (this.cancelingRename) return;
    this.commitRename();
  }

  // ------------------------------------------------------------------ unidades

  readonly categoryOptions = computed<PickerOption[]>(() => {
    const catalogue = this.shopping.categories();
    if (!catalogue.length) {
      return LIST_CATEGORIES.map((name, index) => ({
        value: name,
        label: name,
        color: null as string | null
      }));
    }
    return catalogue.map((category) => ({
      value: category.name,
      label: category.name,
      color: category.color
    }));
  });

  setCategory(value: string | null): void {
    this.patch({ category: value || null });
    const known = this.categoryOptions().some((option) => option.value === value);
    // Seccion nueva escrita a mano: se da de alta en el catalogo, que es lo que la hace
    // aparecer manana en la foto del pasillo y en el resto de listas de la casa.
    if (value && !known) void this.shopping.createCategory(value);
  }

  colorOf(category: string | null | undefined): string | null {
    if (!category) return null;
    return this.shopping.categories().find((entry) => entry.name === category)?.color ?? null;
  }

  // -------------------------------------------------------------------- ofertas

  readonly draftOffer = signal<LineOffer | null>(null);

  isOffer(preset: LineOffer): boolean {
    const draft = this.draftOffer();
    return !!draft && draft.buy === preset.buy && draft.take === preset.take;
  }

  /**
   * Reclicar la oferta encendida la apaga. Estar seguro de que «2x1» es lo que hay y tener que
   * buscar el botoncito de «Sin oferta» es un viaje de ojo para algo que se dice con un toque;
   * el chip inactivo por dentro ya no se distingue, asi que el estado se anuncia con aria-pressed.
   */
  pickOfferPreset(preset: LineOffer): void {
    this.setDraftOffer(this.isOffer(preset) ? null : preset);
  }

  setDraftOffer(offer: LineOffer | null): void {
    this.draftOffer.set(offer);
    const item = this.editing();
    if (!item) return;
    this.shopping.updateItem(item.list_id, item, { offer } as Partial<CreateItemInput>);
  }

  /**
   * La sesion viva, para el historial: ver la foto propia antigua despues de subir una nueva es
   * peor que no ver el cambio (el aviso dijo que si). `auditFace` resuelve solo las filas propias.
   */
  private readonly auditMe = computed(() => {
    const user = this.auth.currentUser();
    return user ? { id: user.id, name: user.name, avatar: user.avatar ?? null } : null;
  });

  face(event: ListEvent): { name: string; avatar?: string; text: string } {
    return auditFace(event, this.auditMe(), {
      t: (key, params) => this.i18n.t(key, params),
      // El articulo del historial es el mismo nombre que la fila de la lista: si la fila se lee «Milk», la
      // frase no puede decir «Leche» (HOGARIA-SPEC ## 12w).
      item: (nombre) => catalogLabel(nombre, (key) => this.i18n.t(key))
    });
  }

  /** El descuento propio de una fila, y su frase, para pintarlos en la lista. */
  lineDiscountOf(item: ShoppingListItem): LineDiscount | null {
    return lineDiscountOfItem(item);
  }

  /**
   * La oferta de la linea, con las palabras del idioma de la app (12t-i18n). El modelo formatea numeros;
   * quien escribe «unidad» o «unit» es la pantalla, que es la que sabe en que idioma se esta leyendo.
   */
  describeDiscount(lineDiscount: Parameters<typeof describeLineDiscount>[0]): string | null {
    if (!lineDiscount) return null;
    return describeLineDiscount(lineDiscount, {
      unidad: this.i18n.t('shopping_list_detail.unidad'),
      unidades: this.i18n.t('shopping_list_detail.unidades')
    });
  }

  readonly discountedLineCount = computed(
    () => this.estimate()?.lines.filter((line) => (line.lineDiscountMinor ?? 0) > 0).length ?? 0
  );

  /** La oferta se toca desde la hoja de edicion o con un toque en la fila. */
  setOffer(item: ShoppingListItem, offer: LineOffer | null): void {
    this.shopping.updateItem(item.list_id, item, { offer } as Partial<CreateItemInput>);
  }

  // ------------------------------------------------- descuento propio de la linea (§12h)

  /**
   * Tres botones, una decision. La oferta de la tienda y este descuento NO son la misma
   * pregunta: la oferta cambia CUANTAS unidades se pagan, este cambia CUANTO se paga por elas,
   * y en caja van uno detras de otro — por eso siguen siendo dos bloques y no un menu unico.
   */
  readonly lineKinds: {
    value: LineDiscountKindUi;
    labelKey: TranslationKey;
    icon: 'close' | 'percent' | 'payments';
  }[] = [
    { value: 'none', labelKey: 'shopping_list_detail.sin_descuento', icon: 'close' },
    { value: 'percent', labelKey: 'shopping_list_detail.tipo_porcentaje', icon: 'percent' },
    { value: 'amount', labelKey: 'shopping_list_detail.tipo_importe', icon: 'payments' }
  ];
  readonly lineKind = signal<LineDiscountKindUi>('none');
  readonly linePercent = signal('');
  readonly lineAmount = signal('');
  /** Cadenas, no numeros: «15,» es un estado intermedio legitimo mientras se teclea. */
  readonly lineUnits = signal('');

  private hydrateLineDiscount(item: ShoppingListItem): void {
    const discount = lineDiscountOfItem(item);
    this.lineKind.set(discount ? discount.kind : 'none');
    this.linePercent.set(
      discount?.kind === 'percent' ? trimNumber((discount.percentBps ?? 0) / 100) : ''
    );
    this.lineAmount.set(
      discount?.kind === 'amount' ? trimNumber((discount.valueMinor ?? 0) / 100) : ''
    );
    this.lineUnits.set(discount?.units ? trimNumber(discount.units) : '');
  }

  /** Lo mismo con el descuento de la linea: volver a pulsar el tipo activo lo quita. */
  pickLineKind(kind: LineDiscountKindUi): void {
    this.setLineKind(this.lineKind() === kind && kind !== 'none' ? 'none' : kind);
  }

  setLineKind(kind: LineDiscountKindUi): void {
    this.lineKind.set(kind);
    // Cambiar de tipo sin haber escrito todavia el numero no borra lo anterior: `buildLineDiscount`
    // devuelve `null` y el patch deja la fila como estaba hasta que haya un valor.
    this.patch({ discount: this.buildLineDiscount(kind) });
  }

  setLinePercent(value: string): void {
    this.linePercent.set(value);
    this.patch({ discount: this.buildLineDiscount() });
  }

  setLineAmount(value: string): void {
    this.lineAmount.set(value);
    this.patch({ discount: this.buildLineDiscount() });
  }

  setLineUnits(value: string): void {
    this.lineUnits.set(value);
    this.patch({ discount: this.buildLineDiscount() });
  }

  /**
   * El descuento de la linea a partir de lo que hay en los campos. Un campo a medias («15,»)
   * NO es «0 %»: se devuelve `null` y no se guarda nada, que es lo que evita que la fila se
   * quede con un descuento de cero euros ocupando sitio en la hoja.
   */
  private buildLineDiscount(kind = this.lineKind()): LineDiscount | null {
    if (kind === 'none') return null;
    const units = parsePositive(this.lineUnits());
    if (kind === 'percent') {
      const percent = parsePositive(this.linePercent());
      if (!percent) return null;
      return {
        kind: 'percent',
        percentBps: Math.round(Math.min(percent * 100, 10_000)),
        valueMinor: null,
        units
      };
    }
    const amount = parseMoneyToMinor(this.lineAmount());
    if (!amount) return null;
    return { kind: 'amount', valueMinor: amount, percentBps: null, units };
  }

  /**
   * «de 2,85 € a 2,56 €» mientras se escribe. La cuenta es la del server (`list-discount.ts`),
   * aqui solo para el anticipo: lo que se guarda y se cobra lo decide `estimate`, y si las dos
   * cifras se separaran la hoja mentiria.
   */
  lineDiscountHint(): string {
    const item = this.editing();
    if (!item) return '';
    const discount = this.draft.discount;
    if (!discount) {
      return this.i18n.t(
        this.lineKind() === 'none'
          ? 'shopping_list_detail.pista_sin_descuento'
          : 'shopping_list_detail.pista_escribe'
      );
    }
    const unitMinor = this.draft.price ? parseMoneyToMinor(this.draft.price) : item.price_minor;
    if (!unitMinor) return this.i18n.t('shopping_list_detail.pista_sin_precio');
    const quantity = Number(this.draft.quantity) > 0 ? Number(this.draft.quantity) : 1;
    const offer = this.draftOffer();
    const paid = offer ? paidUnitsOf(quantity, offer) : quantity;
    const capped = discount.units && discount.units > 0 ? Math.min(discount.units, paid) : paid;
    const base = Math.round(unitMinor * capped);
    const raw =
      discount.kind === 'percent'
        ? Math.round((base * (discount.percentBps ?? 0)) / 10_000)
        : (discount.valueMinor ?? 0);
    const off = Math.min(raw, base);
    const label = this.describeDiscount(discount) ?? this.i18n.t('shopping_list_detail.descuento');
    if (raw <= 0) return this.i18n.t('shopping_list_detail.pista_sin_valor', { label });
    if (discount.units && capped < paid) {
      return this.i18n.t('shopping_list_detail.pista_no_llegan', {
        label,
        paid: trimNumber(paid),
        unidad: this.i18n.t(
          paid === 1 ? 'shopping_list_detail.unidad' : 'shopping_list_detail.unidades'
        ),
        units: trimNumber(discount.units)
      });
    }
    const from = this.money(base);
    const to = this.money(base - off);
    return this.i18n.t(
      raw > base ? 'shopping_list_detail.pista_no_baja_de_cero' : 'shopping_list_detail.pista_de_a',
      { label, from, to }
    );
  }

  // ------------------------------------------------------------------- descuento

  readonly discountOpen = signal(false);
  readonly discountKinds: {
    value: 'amount' | 'percent';
    labelKey: TranslationKey;
    icon: 'payments' | 'percent';
  }[] = [
    { value: 'amount', labelKey: 'shopping_list_detail.tipo_importe', icon: 'payments' },
    { value: 'percent', labelKey: 'shopping_list_detail.tipo_porcentaje', icon: 'percent' }
  ];
  // Los cuatro alcances que se ven en el pasillo de verdad: la oferta de la cesta, la de
  // «los dos primeros», la del producto concretado en la etiqueta y la del pasillo entero.
  readonly discountScopes: {
    value: DiscountScope;
    labelKey: TranslationKey;
    hintKey: TranslationKey;
  }[] = [
    {
      value: 'all',
      labelKey: 'shopping_list_detail.alcance_cesta',
      hintKey: 'shopping_list_detail.alcance_cesta_pista'
    },
    {
      value: 'firstUnits',
      labelKey: 'shopping_list_detail.alcance_primeras',
      hintKey: 'shopping_list_detail.alcance_primeras_pista'
    },
    {
      value: 'product',
      labelKey: 'shopping_list_detail.alcance_productos',
      hintKey: 'shopping_list_detail.alcance_productos_pista'
    },
    {
      value: 'category',
      labelKey: 'shopping_list_detail.alcance_secciones',
      hintKey: 'shopping_list_detail.alcance_secciones_pista'
    }
  ];
  readonly percentOptions: PickerOption[] = [5, 10, 15, 20, 25, 50].map((value) => ({
    value: String(value),
    label: value + ' %'
  }));
  readonly discountDraft = signal<{
    kind: 'amount' | 'percent';
    scope: DiscountScope;
    firstUnits: number | null;
    /**
     * Lo que entra en el descuento, en los nombres legibles de la lista. Es un array y no
     * un string porque el cartel del pasillo casi nunca habla de un producto: «2 € en
     * jamón, queso y pan» es UN descuento sobre tres lineas, y partirlo en tres seria
     * aplicar tres recortes donde la caja aplico uno.
     */
    targets: string[];
    label: string | null;
  }>({ kind: 'amount', scope: 'all', firstUnits: null, targets: [], label: null });
  /** Nombre escrito a mano para anadirlo a las dianas (lo que no esta en la lista). */
  readonly targetDraft = signal('');
  readonly amountDraft = signal('');
  readonly percentDraft = signal<string | null>(null);

  private discountHydrated = false;

  /** Al abrir la hoja se parte de lo que hay, no de un formulario en blanco. */
  hydrateDiscount(): void {
    const saved = discountDraftFromSaved(this.list()?.discount);
    this.discountDraft.set({
      kind: saved.kind,
      scope: saved.scope,
      firstUnits: saved.firstUnits,
      targets: saved.targets,
      label: saved.label
    });
    this.amountDraft.set(saved.amount);
    this.percentDraft.set(saved.percent);
  }

  setDiscountKind(kind: 'amount' | 'percent'): void {
    this.discountDraft.update((draft) => ({ ...draft, kind }));
  }

  patchDiscount(
    changes: Partial<{ scope: DiscountScope; firstUnits: number | null; label: string | null }>
  ): void {
    this.discountDraft.update((draft) => ({ ...draft, ...changes }));
    // Cambiar de alcance deja de tener sentido la diana anterior (una seccion no es un
    // producto), y arrastrarla daria un descuento guardado con una nota que no se corresponde.
    if (changes.scope && changes.scope !== 'product' && changes.scope !== 'category') {
      this.discountDraft.update((draft) => ({ ...draft, targets: [] }));
    }
  }

  /** Clave de un `data-test`: los nombres de producto llevan espacios y acentos. */
  slug(value: string): string {
    return productKeyOf(value).replace(/\s+/g, '-');
  }

  isTargetSelected(name: string): boolean {
    return this.discountDraft().targets.includes(name);
  }

  /** Conmutar: deseleccionar es la unica forma de deshacer un toque en la hoja. */
  toggleTarget(name: string): void {
    const clean = String(name ?? '').trim();
    if (!clean) return;
    this.discountDraft.update((draft) => ({
      ...draft,
      targets: draft.targets.includes(clean)
        ? draft.targets.filter((entry) => entry !== clean)
        : [...draft.targets, clean]
    }));
  }

  addTarget(): void {
    const clean = this.targetDraft().trim();
    if (!clean) return;
    this.toggleTarget(clean);
    this.targetDraft.set('');
  }

  allTargetsSelected(): boolean {
    const options = this.discountTargetOptions();
    return options.length > 0 && options.every((option) => this.isTargetSelected(option.label));
  }

  toggleAllTargets(): void {
    const options = this.discountTargetOptions();
    this.discountDraft.update((draft) => ({
      ...draft,
      targets: this.allTargetsSelected() ? [] : options.map((option) => option.label)
    }));
  }

  /** La fila de totales: el descuento presente o ausente, pero dicho con palabras. */
  readonly discountSummary = computed(() => {
    const description = this.list()?.discountDescription;
    return description
      ? this.i18n.t('shopping_list_detail.descuento_de', { description })
      : this.i18n.t('shopping_list_detail.anadir_descuento');
  });

  /**
   * Dianas posibles del descuento, sacadas de LO QUE HAY EN LA LISTA: prometer un
   * descuento «en el pan de molde» cuando no está es el 0 € que nadie entiende. Con
   * `allowCustom` igualmente se puede escribir una marca que aun no has añadido.
   */
  readonly discountTargetOptions = computed<PickerOption[]>(() => {
    const scope = this.discountDraft().scope;
    const lines = this.items();
    if (scope === 'category') {
      const seen = new Set<string>();
      return lines
        .map((item) => String(item.category ?? '').trim())
        .filter(
          (name) =>
            name &&
            !seen.has(name.toLocaleLowerCase('es')) &&
            seen.add(name.toLocaleLowerCase('es'))
        )
        .map((name) => ({
          value: name,
          label: name,
          hint:
            String(lines.filter((item) => item.category === name).length) + (name ? ' art.' : '')
        }))
        .sort((a, b) => a.label.localeCompare(b.label, 'es'));
    }
    return lines
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name, 'es'))
      .map((item) => ({
        // La clave del producto, si la tiene: es lo que compara el server, y dos listas
        // distintas con «Jamón» y «jamon » solo se entienden comparando la clave.
        value: item.product_key || item.name,
        label: item.name,
        color: this.colorOf(item.category),
        hint: String(item.quantity ?? 1) + (item.unit ? ' ' + item.unit : '')
      }));
  });

  setPercent(value: string | null): void {
    this.percentDraft.set(value);
  }

  commitAmount(): void {
    const raw = String(this.amountDraft() ?? '').trim();
    this.amountDraft.set(parseMoneyToMinor(raw) === null ? '' : raw);
  }

  bumpFirstUnits(step: number): void {
    this.discountDraft.update((draft) => ({
      ...draft,
      firstUnits: Math.max(1, (draft.firstUnits ?? 1) + step)
    }));
  }

  async saveDiscount(): Promise<void> {
    const list = this.list();
    if (!list) return;
    const draft = this.discountDraft();
    const input: DiscountInput = { kind: draft.kind, scope: draft.scope };
    if (draft.kind === 'percent') {
      const percent = Number(String(this.percentDraft() ?? '').replace(',', '.'));
      if (!Number.isFinite(percent) || percent <= 0 || percent > 100) {
        this.toast.warning(
          this.i18n.t('ui.el_porcentaje_no_cuadra'),
          this.i18n.t('ui.entre_1_y_100')
        );
        return;
      }
      input.percentBps = Math.round(percent * 100);
    } else {
      const minor = parseMoneyToMinor(this.amountDraft());
      if (!minor || minor <= 0) {
        this.toast.warning(
          this.i18n.t('ui.falta_el_importe'),
          this.i18n.t('ui.escribe_cuanto_descuentan_por')
        );
        return;
      }
      input.valueMinor = minor;
    }
    if (draft.scope === 'firstUnits') input.firstUnits = draft.firstUnits ?? 1;
    if (draft.scope === 'product' || draft.scope === 'category') {
      const targets = [
        ...new Set(draft.targets.map((entry) => String(entry).trim()).filter(Boolean))
      ];
      if (!targets.length) {
        // Sin diana el server responderia 400, y un 400 despues de pulsar «Guardar» sabe a
        // castigo: se lo decimos antes, con la lista de lineas marcada.
        this.toast.warning(this.i18n.t('ui.dime_donde'), this.i18n.t('ui.elige_al_menos_un'));
        return;
      }
      input.targets = targets;
    }
    if (draft.label) input.label = draft.label;

    const saved = await this.shopping.setDiscount(list.id, input);
    this.discountOpen.set(false);
    if (saved)
      this.toast.success(this.i18n.t('ui.descuento_aplicado'), saved.description ?? undefined);
  }

  async removeDiscount(): Promise<void> {
    const list = this.list();
    if (!list) return;
    const previous = list.discount;
    await this.shopping.setDiscount(list.id, null);
    this.discountOpen.set(false);
    this.toast.show({
      type: 'info',
      title: this.i18n.t('ui.descuento_quitado'),
      duration: 6000,
      countdown: true,
      position: 'bottom',
      action: {
        label: this.i18n.t('ui.deshacer'),
        run: () => {
          if (!previous) return;
          void this.shopping.setDiscount(list.id, discountInputFromSaved(previous));
        }
      }
    });
  }

  // ----------------------------------------------------------------------- foto

  readonly photoOpen = signal(false);
  readonly photoMode = signal<'auto' | 'ticket' | 'shelf'>('auto');
  readonly photoNote = signal('');
  readonly photoBusy = signal(false);
  readonly photoApplying = signal(false);
  readonly photoError = signal<string | null>(null);
  readonly photoRedirect = signal<string | null>(null);
  readonly photoData = signal<string | null>(null);
  readonly photoPreview = signal<string | null>(null);
  readonly photoResult = signal<PhotoReview | null>(null);
  /** El modo de la foto: el picker quiere la etiqueta escrita, asi que se traduce en el computed. */
  readonly photoModes = computed<PickerOption[]>(() =>
    (
      [
        {
          value: 'auto',
          labelKey: 'shopping_list_detail.foto_no_lo_se',
          hintKey: 'shopping_list_detail.foto_no_lo_se_pista'
        },
        {
          value: 'ticket',
          labelKey: 'shopping_list_detail.foto_ticket',
          hintKey: 'shopping_list_detail.foto_ticket_pista'
        },
        {
          value: 'shelf',
          labelKey: 'shopping_list_detail.foto_estanteria',
          hintKey: 'shopping_list_detail.foto_estanteria_pista'
        }
      ] as const
    ).map((mode) => ({
      value: mode.value,
      label: this.i18n.t(mode.labelKey),
      hint: this.i18n.t(mode.hintKey)
    }))
  );

  openDiscount(prefill?: string[]): void {
    this.hydrateDiscount();
    // Desde la seleccion multiple las lineas elegidas SON las dianas: es el gesto de
    // «esto tres, que me han dicho que llevan descuento», y no hay que volver a buscarlas.
    if (prefill?.length) {
      this.discountDraft.update((draft) => ({
        ...draft,
        scope: draft.scope === 'all' ? 'product' : draft.scope,
        targets: [...new Set([...draft.targets, ...prefill])]
      }));
    }
    this.discountOpen.set(true);
  }

  openDiscountForSelection(): void {
    const chosen = this.items()
      .filter((item) => this.selection().includes(item.id))
      .map((item) => item.name);
    this.openDiscount(chosen.length ? chosen : undefined);
  }

  openPhoto(): void {
    this.photoOpen.set(true);
    this.photoError.set(null);
    this.photoRedirect.set(null);
    // El catalogo se tiene aqui antes de mirar la foto: el prompt lo necesita y la hoja
    // de repaso pinta los colores con el mismo dato.
    this.shopping.loadCategories(true);
  }

  closePhoto(): void {
    this.photoOpen.set(false);
    this.photoBusy.set(false);
  }

  onPhotoFile(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    if (!/^image\/(png|jpe?g|webp)$/.test(file.type)) {
      this.photoError.set(this.i18n.t('ui.eso_no_es_una'));
      return;
    }
    if (file.size > 6 * 1024 * 1024) {
      this.photoError.set(this.i18n.t('ui.la_foto_pesa_demasiado'));
      return;
    }
    this.photoError.set(null);
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result ?? '');
      this.photoData.set(dataUrl);
      this.photoPreview.set(dataUrl);
      this.photoResult.set(null);
    };
    reader.onerror = () => this.photoError.set(this.i18n.t('ui.no_se_ha_podido'));
    reader.readAsDataURL(file);
  }

  async analyzePhoto(): Promise<void> {
    const data = this.photoData();
    if (!data || this.photoBusy()) return;
    this.photoBusy.set(true);
    this.photoError.set(null);
    this.photoRedirect.set(null);
    const outcome = await this.shopping.analyzePhoto(
      this.listId,
      data,
      this.photoMode(),
      this.photoNote().trim() || undefined
    );
    this.photoBusy.set(false);
    if (outcome.ok) {
      this.photoResult.set({
        listId: outcome.data.listId,
        mode: outcome.data.mode,
        currency: outcome.data.currency,
        warnings: outcome.data.warnings ?? [],
        categories: outcome.data.categories ?? [],
        // Todo entra marcado: desmarcar lo que sobra es mucho menos tecleo que marcar
        // lo que interesa, y el repaso existe justamente para eso.
        lines: (outcome.data.lines ?? []).map((line) => ({ ...line, keep: true }))
      });
      return;
    }
    this.photoResult.set(null);
    if (outcome.message === 'AI_NOT_CONFIGURED') {
      this.photoRedirect.set('/ai-config');
      this.photoError.set(this.i18n.t('ui.falta_configurar_la_ia'));
      return;
    }
    // Codigo de error -> CLAVE de diccionario: el mapa en prose era el unico que se quedaba en castellano.
    const claves = {
      IMAGE_TOO_LARGE: 'shopping_list_detail.la_foto_es_demasiado',
      AI_ANSWER_NOT_UNDERSTOOD: 'shopping_list_detail.el_modelo_no_ha',
      AI_TIMEOUT: 'shopping_list_detail.el_modelo_ha_tardado',
      INVALID_PHOTO: 'shopping_list_detail.la_imagen_no_se'
    } as const; // sin `as const` los valores se ensanchan a `string` y `t()` deja de compilar
    this.photoError.set(
      this.i18n.t(claves[outcome.message as keyof typeof claves] ?? 'ui.el_modelo_no_esta')
    );
    if (outcome.message === 'AI_ANSWER_NOT_UNDERSTOOD') this.logSample(outcome.data);
  }

  private logSample(data: Record<string, unknown>): void {
    // La muestra del response crudo va al visor de logs: sin ella, un fallo de formato de
    // un modelo concreto es indepurgable desde la pantalla.
    const sample =
      typeof (data as { sample?: unknown })?.sample === 'string'
        ? String((data as { sample?: string }).sample)
        : '';
    if (sample)
      void fetch('/api/logs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          level: 'warn',
          scope: 'shopping:photo',
          message: 'respuesta de IA no parseable',
          meta: { sample }
        })
      }).catch(() => undefined);
  }

  keptPhotoLines(): PhotoLine[] {
    return (this.photoResult()?.lines ?? [])
      .filter((line) => line.keep && line.name.trim())
      .map((line) => {
        const { keep, ...rest } = line;
        return rest as PhotoLine;
      });
  }

  async applyPhoto(): Promise<void> {
    const lines = this.keptPhotoLines();
    if (!lines.length || this.photoApplying()) return;
    this.photoApplying.set(true);
    const applied = await this.shopping.applyPhotoLines(this.listId, lines);
    this.photoApplying.set(false);
    if (!applied) return;
    this.photoOpen.set(false);
    this.photoResult.set(null);
    this.photoData.set(null);
    this.photoPreview.set(null);
    const created = applied.createdCategories.length
      ? ', ' + this.i18n.t('ui.secciones_nuevas') + ': ' + applied.createdCategories.join(', ')
      : '';
    this.toast.success(
      this.i18n.t('ui.lineas_anadidas'),
      this.i18n.t('ui.nuevas_y_sumadas', {
        nuevas: applied.added,
        sumadas: applied.merged.length,
        resto: created
      })
    );
  }

  minorToInput(minor: number | null | undefined): string {
    return minor === null || minor === undefined ? '' : (minor / 100).toFixed(2).replace('.', ',');
  }

  // Los numeros y el dinero se convierten en el componente: una plantilla no tiene Number() ni
  // funciones del modulo, y copiar la conversion aqui y en la hoja dos veces es la manera mas rapida de
  // que un dia diverjan el precio del desglose y el de la fila.
  //
  // (Nota de la ronda 19: este comentario salio partido por un script que movia CSS de sitio —el texto
  // de arriba es la version recompuesta, no la original palabra por palabra.)
  setLineQuantity(line: KeptPhotoLine, value: unknown): void {
    line.quantity = Number(value) > 0 ? Number(value) : 1;
  }

  setLinePrice(line: KeptPhotoLine, value: unknown): void {
    line.priceMinor = parseMoneyToMinor(typeof value === 'string' ? value : String(value ?? ''));
  }

  setFirstUnits(value: unknown): void {
    const units = Number(value);
    this.patchDiscount({ firstUnits: Number.isFinite(units) && units > 0 ? Math.floor(units) : 1 });
  }

  setPhotoMode(value: string | null): void {
    this.photoMode.set(value === 'ticket' || value === 'shelf' ? value : 'auto');
  }

  // ------------------------------------------------------------------ auditoria

  readonly auditOpen = signal(false);
  readonly events = computed(() => this.shopping.events());
  private cancelStream: (() => void) | null = null;

  toggleAudit(): void {
    this.auditOpen.set(!this.auditOpen());
    if (this.auditOpen()) this.shopping.loadEvents(this.listId);
  }

  /**
   * El reloj de la auditoria es relativo «a ojo» y absoluto al mantener el dedo: una hora
   * mal situada en la zona del dispositivo se nota en cuanto se la escribe entera.
   */
  since(value: string): string {
    return this.i18n.relativeTime(value);
  }

  when(value: string): string {
    return formatDateTime(value);
  }
}
