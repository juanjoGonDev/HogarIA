import {
  AfterContentInit,
  Component,
  ContentChildren,
  DestroyRef,
  Directive,
  EventEmitter,
  HostListener,
  Input,
  OnInit,
  Output,
  TemplateRef,
  afterNextRender,
  output,
  computed,
  effect,
  inject,
  input,
  signal
} from '@angular/core';
import { CommonModule, NgTemplateOutlet } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IconComponent } from '../icon/icon.component';
import { CheckboxComponent } from '../checkbox/checkbox.component';
import { PickerComponent, type PickerOption } from '../picker/picker.component';
import { InputComponent } from '../input/input.component';
import { TooltipComponent } from '../tooltip/tooltip.component';
import { TranslatePipe } from '../../../../core/pipes/translate.pipe';
import { I18nService } from '../../../../core/services/i18n.service';
import type { TranslationKey } from '../../../../core/i18n';
import type {
  DataTableColumna,
  DireccionOrden,
  FiltroColumna,
  FiltroFecha,
  FiltroNumero,
  ModoFecha,
  ModoNumero,
  OrdenTabla,
  TipoColumna
} from './data-table.types';
import {
  SIN_VALOR,
  coincideEnMenu,
  cuboDe,
  direccionDe,
  filtroActivo,
  hoyLocal,
  ordenar,
  paginar,
  pasarFiltros,
  posicionDeOrden,
  reanclarPagina,
  recortarFiltro,
  rotarOrden,
  tramoDeIndices,
  tramoDePaginas,
  type FiltroDeColumna,
  valorTipado,
  valoresUnicos
} from './data-table.util';

/**
 * Celda proyectada de `app-data-table` (HOGARIA-SPEC ## 12ab).
 *
 * La tabla no sabe qué es un ingrediente ni un utensilio; lo que sabe es pintar columnas. Lo que una pantalla
 * necesite meter dentro de una celda (un stepper, un botón de borrar, un badge) viaja aquí: la pantalla declara
 * `<ng-template appDataTableCell="cantidad" let-fila>` y la tabla instancia esa plantilla en la columna cuya
 * `celda` sea `'cantidad'`.
 */
@Directive({ selector: '[appDataTableCell]', standalone: true })
export class DataTableCellDirective {
  /** Nombre de la columna a la que pertenece (`[appDataTableCell]`); si falta, vale la `clave`. */
  @Input('appDataTableCell') nombre = '';
  constructor(readonly tpl: TemplateRef<{ $implicit: unknown; fila: unknown }>) {}
}

type EstadoCapa = { col: string; sup: 'cabezal' | 'hoja' };
type RangoSeleccion = { ids: string[]; origen: number; destino: number };

/**
 * La tabla de datos de la casa (HOGARIA-SPEC ## 12ab).
 *
 * Nace del veredicto del usuario sobre el visor del inventario: «filtros por columnas al estilo Excel, que te
 * abre un mini menú con selección, ordenación múltiple, búsqueda y paginación, y que se vea bien en móvil».
 * Es presentacional por contrato: recibe las filas que la pantalla ya tenga (servidor, cache, lo que sea) y
 * se ocupa de orden, filtro, paginación y selección sobre ESAS filas. Por eso el visor carga el inventario
 * completo en vez de hojear el servidor —filtrar «solo verduras vencidas» sobre una página de 20 es mentir—.
 *
 * Dos superficies, un solo DOM por control: en escritorio los menús cuelgan del cabezal; por debajo de 720px
 * la tabla se refluja a tarjetas y los mismos controles viven en una hoja inferior («Ordenar y filtrar»).
 * Los `data-test` del cabezal llevan prefijo `tabla-` y los de la hoja `hoja-`, porque en Playwright (que
 * corre los tres viewports) un selector que resolve dos elementos, uno oculto, es un rojo por strict-mode.
 */
@Component({
  selector: 'app-data-table',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    NgTemplateOutlet,
    IconComponent,
    CheckboxComponent,
    InputComponent,
    PickerComponent,
    TooltipComponent,
    TranslatePipe
  ],
  template: `
    <div class="tabla">
      <div class="tabla__buscar"><ng-content select="[data-tabla-buscar]"></ng-content></div>

      <div class="tabla__barra-movil">
        <button type="button" class="movil" (click)="abrirHoja()" data-test="tabla-hoja-abrir">
          <app-icon name="filter_list" [size]="16" [label]="null" />
          <span>{{ 'ui.tabla_ordenar_y_filtrar' | t }}</span>
          @if (nFiltros() > 0) {
            <span class="movil__marca">{{ nFiltros() }}</span>
          }
        </button>
      </div>

      <div class="tabla__lienzo">
        <table class="tabla__el">
          <thead>
            <tr>
              @if (seleccionable()) {
                <th class="tabla__th tabla__th--check">
                  <button
                    type="button"
                    class="cbox"
                    role="checkbox"
                    [attr.aria-checked]="estadoSeleccionPagina()"
                    [attr.aria-label]="'ui.tabla_seleccionar_pagina' | t"
                    (click)="togglePagina()"
                    data-test="tabla-seleccionar-pagina"
                  >
                    @if (estadoSeleccionPagina() === 'all') {
                      <app-icon name="check" [size]="13" [label]="null" />
                    } @else if (estadoSeleccionPagina() === 'mixed') {
                      <app-icon name="remove" [size]="13" [label]="null" />
                    }
                  </button>
                </th>
              }
              @for (col of columnas(); track col.clave) {
                <th
                  class="tabla__th"
                  [class.tabla__th--fin]="col.alineacion === 'end'"
                  [style.width]="col.ancho ?? null"
                  [attr.aria-sort]="ariaSortDe(col.clave)"
                >
                  <div class="th">
                    <button
                      type="button"
                      class="th__txt"
                      [class.th__txt--mudo]="!esOrdenable(col)"
                      [disabled]="!esOrdenable(col)"
                      [attr.data-test]="'tabla-orden-' + col.clave"
                      (click)="clicOrden(col, $event)"
                    >
                      <span>{{ col.etiqueta }}</span>
                      @if (dirDe(col.clave); as dir) {
                        <app-icon
                          [name]="dir === 'asc' ? 'expand_less' : 'expand_more'"
                          [size]="15"
                          [label]="null"
                        />
                        @if (posicion(col.clave); as p) {
                          <span class="th__ord">{{ p }}</span>
                        }
                      } @else if (esOrdenable(col)) {
                        <app-icon class="th__hud" name="unfold_more" [size]="14" [label]="null" />
                      }
                    </button>
                    @if (col.filtrable !== false) {
                      <button
                        type="button"
                        class="th__emb"
                        [class.th__emb--on]="activo(col.clave)"
                        [attr.aria-label]="
                          'ui.tabla_filtrar_columna' | t: { columna: col.etiqueta }
                        "
                        [attr.aria-expanded]="
                          menu()?.col === col.clave && menu()?.sup === 'cabezal'
                        "
                        [attr.data-test]="'tabla-filtro-' + col.clave"
                        (click)="alternarMenu(col, 'cabezal', $event)"
                      >
                        <app-icon name="filter_list" [size]="14" [label]="null" />
                        @if (activo(col.clave)) {
                          <span class="th__punto" aria-hidden="true"></span>
                        }
                      </button>
                      @if (menu()?.col === col.clave && menu()?.sup === 'cabezal') {
                        <div
                          class="th__menu"
                          [class.th__menu--arriba]="!anclaAbajo()"
                          [style.top.px]="menuAncla()?.top"
                          [style.left.px]="menuAncla()?.left"
                        >
                          <ng-container
                            *ngTemplateOutlet="panelFiltro; context: { $implicit: col }"
                          />
                        </div>
                      }
                    }
                  </div>
                </th>
              }
            </tr>
          </thead>
          <tbody>
            @if (vista().total === 0) {
              <tr class="tabla__vacia">
                <td class="tabla__td" [attr.colspan]="anchoFila()">
                  <div class="vacia">
                    <p class="vacia__texto">
                      {{
                        (filas().length > 0
                          ? 'ui.tabla_nada_coincide'
                          : (claveVacia() ?? 'ui.tabla_lista_vacia')
                        ) | t
                      }}
                    </p>
                    @if (filas().length > 0 && nFiltros() > 0) {
                      <button
                        type="button"
                        class="vacia__limpiar"
                        (click)="limpiarFiltros()"
                        data-test="tabla-vacia-limpiar"
                      >
                        {{ 'ui.tabla_limpiar_todos' | t }}
                      </button>
                    }
                  </div>
                </td>
              </tr>
            }
            @for (fila of vista().filas; track identificadorDe(fila)) {
              <tr
                class="tabla__fila"
                [class]="claseFilaStr(fila)"
                [attr.data-test]="'tabla-fila-' + identificadorDe(fila)"
              >
                @if (seleccionable()) {
                  <td
                    class="tabla__td--check tabla__td"
                    (mousedown)="registrarShift($event)"
                    (keydown)="registrarShift($event)"
                    (click)="alPulsarMarca($any($event), fila)"
                  >
                    <app-checkbox
                      [hideLabel]="true"
                      [label]="etiquetaFilaDe(fila)"
                      [checked]="seleccionada(fila)"
                      (onChange)="marcarFila(fila, $event)"
                      [attr.data-test]="'tabla-marcar-' + identificadorDe(fila)"
                    />
                  </td>
                }
                @for (col of columnas(); track col.clave) {
                  <td
                    class="tabla__td"
                    [class.tabla__td--fin]="col.alineacion === 'end'"
                    [class.tabla__td--vacia]="!textoCelda(col, fila) && !plantillaDe(col)"
                    [attr.data-label]="col.etiqueta"
                  >
                    @if (plantillaDe(col); as tpl) {
                      <ng-container
                        *ngTemplateOutlet="tpl; context: { $implicit: fila, fila: fila }"
                      />
                    } @else if (col.tipo === 'booleano') {
                      @if (esVerdadero(fila, col)) {
                        <app-icon name="check" [size]="16" [label]="null" class="celda__si" />
                      } @else {
                        <span class="celda celda--guion" aria-hidden="true">—</span>
                      }
                    } @else {
                      <span class="celda">{{ textoCelda(col, fila) }}</span>
                    }
                  </td>
                }
              </tr>
            }
          </tbody>
        </table>
      </div>

      <div class="tabla__pie">
        <span class="pie__rango" data-test="tabla-rango">
          {{
            'ui.tabla_rango'
              | t: { desde: vista().desde, hasta: vista().hasta, total: vista().total }
          }}
        </span>
        <div class="pie__tam">
          <!-- La pista va en popover propio: el title nativo tarda un segundo en salir, y la burbuja de
               diseno es lo pedido (## 12af). -->
          <app-tooltip position="top" [text]="'ui.tabla_por_pagina' | t">
            <app-picker
              class="pie__tam-picker"
              [options]="opcionesTamano()"
              [value]="tamanoValor()"
              [label]="''"
              data-test="tabla-tamano"
              (valueChange)="elegirTamano($event)"
            />
          </app-tooltip>
        </div>
        <nav class="pie__pag" [attr.aria-label]="'ui.tabla_paginacion' | t">
          <!-- Salto de canto: «ir a la primera» con el boton doble, y su pista en popover (## 12af: los
               hints van todos por ahi). El aria-label dice lo mismo que la burbuja: se ve «Primera pagina»,
               se lee «Primera pagina». -->
          <app-tooltip position="top" [text]="'ui.tabla_primera_pagina' | t">
            <button
              type="button"
              class="pag pag--canto"
              [disabled]="pagina() <= 1"
              (click)="irA(1)"
              [attr.aria-label]="'ui.tabla_primera_pagina' | t"
              data-test="tabla-primera"
            >
              <app-icon name="first_page" [size]="18" [label]="null" />
            </button>
          </app-tooltip>
          <button
            type="button"
            class="pag"
            [disabled]="pagina() <= 1"
            (click)="irA(pagina() - 1)"
            [attr.aria-label]="'common.anterior' | t"
            data-test="tabla-anterior"
          >
            <app-icon name="chevron_left" [size]="18" [label]="null" />
          </button>
          <span class="pag__numeros">
            @for (p of tramo(); track $index) {
              @if (p === 'ini' || p === 'fin') {
                <span class="pag__hueco" aria-hidden="true">…</span>
              } @else {
                <app-tooltip position="top" [text]="'ui.tabla_ir_pagina' | t: { pagina: p }">
                  <button
                    type="button"
                    class="pag pag--num"
                    [class.pag--on]="p === paginaEnVista()"
                    [attr.aria-current]="p === paginaEnVista() ? 'true' : null"
                    (click)="irA(p)"
                    [attr.data-test]="'tabla-pagina-' + p"
                  >
                    {{ p }}
                  </button>
                </app-tooltip>
              }
            }
          </span>
          <span class="pag__cta" data-test="tabla-pagina">
            {{ 'ui.tabla_pagina' | t: { pagina: paginaEnVista(), ultima: vista().ultima } }}
          </span>
          <button
            type="button"
            class="pag"
            [disabled]="pagina() >= vista().ultima"
            (click)="irA(pagina() + 1)"
            [attr.aria-label]="'ui.tabla_siguiente' | t"
            data-test="tabla-siguiente"
          >
            <app-icon name="chevron_right" [size]="18" [label]="null" />
          </button>
          <app-tooltip position="top" [text]="'ui.tabla_ultima_pagina' | t">
            <button
              type="button"
              class="pag pag--canto"
              [disabled]="pagina() >= vista().ultima"
              (click)="irA(vista().ultima)"
              [attr.aria-label]="'ui.tabla_ultima_pagina' | t"
              data-test="tabla-ultima"
            >
              <app-icon name="last_page" [size]="18" [label]="null" />
            </button>
          </app-tooltip>
        </nav>
      </div>

      <div class="tabla__lote"><ng-content select="[data-tabla-lote]"></ng-content></div>

      <!--
        La hoja inferior del movil y el menu de filtro comparten el panel: un solo DOM vivo por menu (la regla
        del spec; dos copias del mismo control serian dos formas de que se contradigan). El velo es solo de la
        hoja: el popover del cabezal se cierra con clic fuera, como los menus que imitamos (## 12ab).
      -->
      @if (hoja()) {
        <div class="tabla__velo" (click)="cerrarCapas()" data-test="tabla-velo"></div>
      }
      @if (hoja()) {
        <section
          class="tabla__hoja"
          role="dialog"
          [attr.aria-label]="'ui.tabla_ordenar_y_filtrar' | t"
          data-test="tabla-hoja"
        >
          @if (menu()?.sup === 'hoja' && colDeCapa(); as col) {
            <div class="hoja__cab">
              <button
                type="button"
                class="hoja__volver"
                (click)="volverColumnas()"
                data-test="hoja-volver"
              >
                <app-icon name="chevron_left" [size]="18" [label]="null" />
                <span>{{ col.etiqueta }}</span>
              </button>
            </div>
            <div class="hoja__cuerpo hoja__cuerpo--menu">
              <ng-container *ngTemplateOutlet="panelFiltro; context: { $implicit: col }" />
            </div>
          } @else {
            <div class="hoja__cab">
              <span class="hoja__titulo">{{ 'ui.tabla_columnas' | t }}</span>
              <button
                type="button"
                class="hoja__x"
                (click)="cerrarCapas()"
                [attr.aria-label]="'ui.tabla_listo' | t"
                data-test="hoja-cerrar"
              >
                <app-icon name="close" [size]="18" [label]="null" />
              </button>
            </div>
            <ul class="hoja__lista">
              @for (col of columnas(); track col.clave) {
                <li class="hoja__fila">
                  <span class="hoja__etq">{{ col.etiqueta }}</span>
                  <span class="hoja__acciones">
                    @if (esOrdenable(col)) {
                      <button
                        type="button"
                        class="hoja__btn"
                        [class.hoja__btn--on]="dirDe(col.clave)"
                        (click)="clicOrden(col, $event)"
                        [attr.data-test]="'hoja-orden-' + col.clave"
                      >
                        @if (dirDe(col.clave); as dir) {
                          <app-icon
                            [name]="dir === 'asc' ? 'expand_less' : 'expand_more'"
                            [size]="15"
                            [label]="null"
                          />
                        } @else {
                          <app-icon name="unfold_more" [size]="15" [label]="null" />
                        }
                        <span>{{ 'ui.tabla_ordenar' | t }}</span>
                        @if (posicion(col.clave); as p) {
                          <span class="hoja__ord">{{ p }}</span>
                        }
                      </button>
                    }
                    @if (col.filtrable !== false) {
                      <button
                        type="button"
                        class="hoja__btn"
                        [class.hoja__btn--on]="activo(col.clave)"
                        (click)="abrirMenuHoja(col)"
                        [attr.data-test]="'hoja-filtro-' + col.clave"
                      >
                        <app-icon name="filter_list" [size]="15" [label]="null" />
                        <span>{{ 'ui.tabla_filtrar' | t }}</span>
                        @if (activo(col.clave)) {
                          <span class="th__punto" aria-hidden="true"></span>
                        }
                      </button>
                    }
                  </span>
                </li>
              }
            </ul>
            <div class="hoja__pie">
              <p class="hoja__ayuda">{{ 'ui.tabla_orden_multiple' | t }}</p>
              @if (nFiltros() > 0) {
                <button
                  type="button"
                  class="hoja__limpiar"
                  (click)="limpiarFiltros()"
                  data-test="hoja-limpiar"
                >
                  {{ 'ui.tabla_limpiar_todos' | t }}
                </button>
              }
            </div>
          }
        </section>
      }
    </div>

    <!-- El panel del filtro: una definicion, dos superficies (cabezal en escritorio, hoja en movil). -->
    <ng-template #panelFiltro let-col>
      <div class="menu" (click)="$event.stopPropagation()">
        <div class="menu__cab">
          <span class="menu__titulo">{{ col.etiqueta }}</span>
          @if (activo(col.clave)) {
            <button
              type="button"
              class="menu__limpiar"
              (click)="limpiarFiltro(col)"
              data-test="tabla-menu-limpiar"
            >
              {{ 'ui.tabla_limpiar_filtro' | t }}
            </button>
          }
        </div>

        @if (tipoDe(col) === 'numero' || tipoDe(col) === 'fecha') {
          <div class="menu__modos">
            @for (m of modosDe(col); track m.clave) {
              <button
                type="button"
                class="modo"
                [class.modo--on]="modoDe(col) === m.clave"
                [attr.data-test]="'tabla-modo-' + m.clave"
                (click)="ponerModo(col, m.clave)"
              >
                {{ m.etiqueta | t }}
              </button>
            }
          </div>
          @if (necesitaA(col)) {
            <app-input
              [id]="'tabla-extremo-a-' + col.clave"
              [name]="'tabla-extremo-a-' + col.clave"
              [type]="tipoDe(col) === 'numero' ? 'number' : 'date'"
              [label]="
                (necesitaB(col)
                  ? 'ui.tabla_desde'
                  : tipoDe(col) === 'numero'
                    ? 'ui.tabla_valor'
                    : 'ui.tabla_dia'
                ) | t
              "
              [ngModel]="extremoDe(col, 'a')"
              (ngModelChange)="fijarExtremo(col, 'a', $event)"
            />
          }
          @if (necesitaB(col)) {
            <app-input
              [id]="'tabla-extremo-b-' + col.clave"
              [name]="'tabla-extremo-b-' + col.clave"
              [type]="tipoDe(col) === 'numero' ? 'number' : 'date'"
              [label]="'ui.tabla_hasta' | t"
              [ngModel]="extremoDe(col, 'b')"
              (ngModelChange)="fijarExtremo(col, 'b', $event)"
            />
          }
        } @else {
          <div class="menu__buscar-caja">
            <app-input
              [id]="'tabla-menu-buscar-' + col.clave"
              [name]="'tabla-buscar-valor-' + col.clave"
              type="search"
              [placeholder]="'ui.tabla_buscar_valor' | t"
              [ngModel]="busquedaMenu()"
              (ngModelChange)="ponerBusqueda($event)"
            />
          </div>
          <div class="menu__links">
            <button type="button" (click)="marcarTodos(col)" data-test="tabla-menu-todo">
              {{ 'ui.tabla_seleccionar_todo' | t }}
            </button>
            <button type="button" (click)="marcarNinguno(col)" data-test="tabla-menu-nada">
              {{ 'ui.tabla_ninguno' | t }}
            </button>
          </div>
          <ul class="menu__lista">
            @for (v of valoresMenu(col); track v.valor) {
              <li class="menu__fila">
                <app-checkbox
                  [label]="etiquetaDeValor(col, v.valor)"
                  [checked]="valorMarcado(col, v.valor)"
                  (onChange)="toggleValor(col, v.valor)"
                />
                <span class="menu__cta">{{ v.cuenta }}</span>
              </li>
            }
          </ul>
          <div class="menu__pie">
            <button
              type="button"
              class="menu__recortar"
              (click)="recortarA(col)"
              data-test="tabla-menu-recortar"
            >
              {{ 'ui.tabla_recortar' | t }}
            </button>
          </div>
        }
      </div>
    </ng-template>
  `,
  styles: [
    `
      :host {
        display: block;
      }

      /* La tarjeta es UNA: buscador pegado arriba, lienzo, pie dentro del mismo borde (## 12ad). */
      .tabla {
        position: relative;
        border: 1px solid var(--border-default);
        border-radius: var(--radius-lg);
        background: var(--bg-secondary);
        overflow: hidden;
      }
      .tabla__buscar:empty {
        display: none;
      }
      .tabla__buscar {
        /* Padding continuo: la caja de busqueda respira igual por arriba y por abajo; con el de abajo a
           cero, el buscador se veia pegado a la tabla (## 12af). */
        padding: var(--space-3) var(--space-4);
      }
      /* El lote se proyecta al pie de la tarjeta: la barra en si es position:fixed (regla F de la ## 12ad,
       estilo del cascon que la pinta); aqui solo se reserva el hueco para que la ultima fila jamas quede tapada. */
      .tabla__lote:empty {
        display: none;
      }

      /* ── lienzo y tabla ── */
      .tabla__lienzo {
        overflow-x: auto;
      }
      .tabla__el {
        width: 100%;
        border-collapse: collapse;
        font-size: var(--text-sm);
      }

      .tabla__th {
        position: sticky;
        top: 0;
        z-index: 2;
        text-align: start;
        padding: 0;
        margin: 0;
        background: var(--bg-tertiary);
        border-bottom: 1px solid var(--border-default);
      }
      .tabla__th--fin .th {
        justify-content: flex-end;
      }
      .tabla__th--check {
        width: 56px;
        padding: 0 var(--space-2);
        text-align: center;
      }
      .th {
        display: flex;
        align-items: center;
        gap: var(--space-1);
        padding: var(--space-1) var(--space-2);
        min-height: 44px;
      }
      .th__txt {
        display: inline-flex;
        align-items: center;
        gap: 2px;
        font: inherit;
        font-weight: var(--font-semibold);
        color: var(--text-primary);
        background: none;
        border: 0;
        padding: var(--space-1) var(--space-1);
        border-radius: var(--radius-md);
        cursor: pointer;
        transition: var(--transition-fast);
      }
      .th__txt:hover {
        background: var(--primary-subtle);
      }
      .th__txt:focus-visible {
        outline: 2px solid var(--primary);
        outline-offset: 1px;
      }
      .th__txt--mudo {
        cursor: default;
      }
      .th__txt--mudo:hover {
        background: none;
      }
      .th__hud {
        color: var(--text-tertiary);
        opacity: 0;
        transition: opacity var(--duration-100);
      }
      .th__txt:hover .th__hud {
        opacity: 1;
      }
      .th__ord {
        font-size: 10px;
        font-weight: var(--font-bold);
        color: var(--primary-dark);
        background: var(--primary-subtle);
        border-radius: var(--radius-full);
        padding: 0 5px;
        margin-inline-start: 2px;
      }
      .th__emb {
        position: relative;
        display: inline-grid;
        place-items: center;
        width: 30px;
        height: 30px;
        flex: none;
        color: var(--text-tertiary);
        background: none;
        border: 0;
        border-radius: var(--radius-md);
        cursor: pointer;
        transition: var(--transition-fast);
      }
      .th__emb:hover {
        color: var(--primary-dark);
        background: var(--primary-subtle);
      }
      .th__emb:focus-visible {
        outline: 2px solid var(--primary);
        outline-offset: 1px;
      }
      .th__emb--on {
        color: var(--primary-dark);
        background: var(--primary-subtle);
      }
      .th__punto {
        position: absolute;
        top: 3px;
        right: 3px;
        width: 7px;
        height: 7px;
        border-radius: var(--radius-full);
        background: var(--primary);
        border: 1.5px solid var(--bg-tertiary);
      }
      /* Capa flotante anclada en coordenadas de pantalla: dentro del lienzo (overflow) cualquier absoluto
       se recorta contra el borde de la tabla y el usuario no ve media lista (## 12ab, rojo del menu). */
      .th__menu {
        position: fixed;
        z-index: 60;
        width: 264px;
      }
      .th__menu--arriba {
        transform: translateY(calc(-100% - 12px));
      }

      .tabla__fila {
        border-bottom: 1px solid var(--border-default);
        transition: background var(--duration-100);
      }
      .tabla__fila:last-child {
        border-bottom: 0;
      }
      .tabla__fila:hover {
        background: var(--bg-primary);
      }
      .tabla__fila--sel {
        background: var(--primary-subtle);
      }
      .tabla__td {
        padding: var(--space-2);
        vertical-align: middle;
      }
      .tabla__td--fin {
        text-align: end;
      }
      .tabla__td--check {
        width: 56px;
        text-align: center;
        cursor: pointer;
      }
      .celda {
        font-size: var(--text-sm);
        color: var(--text-primary);
      }
      .celda--guion {
        color: var(--text-tertiary);
      }
      .celda__si {
        color: var(--success, var(--primary));
      }

      .vacia {
        padding: var(--space-6);
        text-align: center;
      }
      .vacia__texto {
        margin: 0 0 var(--space-2);
        font-size: var(--text-sm);
        color: var(--text-secondary);
      }
      .vacia__limpiar {
        font: inherit;
        font-size: var(--text-sm);
        font-weight: var(--font-medium);
        color: var(--primary-dark);
        background: none;
        border: 0;
        cursor: pointer;
        padding: var(--space-1) var(--space-3);
        border-radius: var(--radius-full);
      }
      .vacia__limpiar:hover {
        background: var(--primary-subtle);
      }

      /* ── pie con paginacion ── */
      .tabla__pie {
        /* Las filas moviles son position:relative y sin esto se pintarian EN el pie, tapando el picker. */
        position: relative;
        z-index: 1;
        display: flex;
        align-items: center;
        justify-content: space-between;
        flex-wrap: wrap;
        gap: var(--space-2) var(--space-4);
        padding: var(--space-2) var(--space-1);
        font-size: var(--text-xs);
        color: var(--text-secondary);
      }
      .pie__rango {
        font-variant-numeric: tabular-nums;
      }
      .pie__tam {
        display: inline-flex;
        align-items: center;
        gap: var(--space-1);
      }
      .pie__etq {
        color: var(--text-tertiary);
      }
      .pie__tam-picker {
        min-width: 132px;
      }
      .pie__pag {
        display: inline-flex;
        align-items: center;
        gap: var(--space-1);
      }
      .pag {
        display: inline-grid;
        place-items: center;
        width: 30px;
        height: 30px;
        color: var(--text-secondary);
        background: var(--bg-tertiary);
        border: 1px solid var(--border-default);
        /* El radio de las flechas era radius-full y el de los numeros radius-md: la hilera parecia dos
           piezas cosidas por separado. Un solo rectangulo para todo, como en la referencia pedida (## 12af). */
        border-radius: var(--radius-md);
        cursor: pointer;
        transition: var(--transition-fast);
      }
      .pag:hover:not(:disabled) {
        color: var(--primary-dark);
        border-color: var(--border-strong);
      }
      .pag:focus-visible {
        outline: 2px solid var(--primary);
        outline-offset: 2px;
      }
      .pag:disabled {
        opacity: 0.4;
        cursor: default;
      }
      .pag--num {
        /* Casilla fija, no «minimo»: el 1 y el 39 miden lo mismo, que la hilera no respire
           al cambiar de pagina (## 12ah). Tabular para que ni los digitos muevan el centro. */
        width: 30px;
        min-width: 30px;
        height: 30px;
        padding: 0;
        font-size: var(--text-xs);
        font-variant-numeric: tabular-nums;
        border-radius: var(--radius-md);
      }
      .pag--on {
        color: var(--bg-secondary);
        background: var(--primary);
        border-color: var(--primary);
        font-weight: var(--font-bold);
      }
      .pag__hueco {
        /* La marca de salto ocupa la casilla de un numero, no un puntito flotante: siete
           casillas son siete, con numero o con puntos (## 12ah). */
        display: inline-grid;
        place-items: center;
        width: 30px;
        height: 30px;
        color: var(--text-tertiary);
      }
      .pag__cta {
        font-variant-numeric: tabular-nums;
      }
      /* En el movil estrecho el paginador se pliega: flechas + «Pagina x de y», sin la hilera de numeros (D). */
      @media (max-width: 640px) {
        .pag__numeros,
        .pag--canto {
          display: none;
        }
      }
      @media (min-width: 641px) {
        .pag__cta {
          display: none;
        }
      }

      /* ── cabecitas de seleccion ── */
      .cbox {
        display: inline-grid;
        place-items: center;
        width: 26px;
        height: 26px;
        color: var(--primary-dark);
        background: var(--bg-secondary);
        border: 1.5px solid var(--border-strong);
        border-radius: var(--radius-md);
        cursor: pointer;
        transition: var(--transition-fast);
      }
      .cbox:hover {
        border-color: var(--primary);
      }

      /* ── el menu (una instancia viva) ── */
      .menu {
        display: flex;
        flex-direction: column;
        max-height: 72vh;
        background: var(--bg-secondary);
        border: 1px solid var(--border-default);
        border-radius: var(--radius-lg);
        box-shadow: var(--shadow-lg);
        padding: var(--space-3);
        font-size: var(--text-sm);
        text-align: start;
      }
      .menu__cab {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--space-2);
        margin-bottom: var(--space-2);
      }
      .menu__titulo {
        font-weight: var(--font-semibold);
      }
      .menu__limpiar,
      .menu__links button,
      .menu__recortar {
        font: inherit;
        font-size: var(--text-xs);
        color: var(--primary-dark);
        background: none;
        border: 0;
        cursor: pointer;
        padding: 2px var(--space-2);
        border-radius: var(--radius-full);
      }
      .menu__limpiar:hover,
      .menu__links button:hover,
      .menu__recortar:hover {
        background: var(--primary-subtle);
        text-decoration: underline;
      }
      .menu__links {
        display: flex;
        gap: var(--space-1);
        border-block: 1px solid var(--border-default);
        padding: var(--space-1) 0;
      }
      .menu__buscar-caja {
        margin-bottom: var(--space-2);
      }
      .menu__lista {
        list-style: none;
        margin: var(--space-2) 0 0;
        padding: 0 2px;
        overflow-y: auto;
        max-height: 240px;
        scrollbar-width: thin;
      }
      .menu__fila {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--space-2);
      }
      .menu__fila app-checkbox {
        min-width: 0;
      }
      .menu__cta {
        font-size: var(--text-xs);
        color: var(--text-tertiary);
        font-variant-numeric: tabular-nums;
        flex: none;
      }
      .menu__modos {
        display: flex;
        flex-wrap: wrap;
        gap: var(--space-1);
        margin-bottom: var(--space-3);
      }
      .modo {
        font: inherit;
        font-size: var(--text-xs);
        padding: var(--space-1) var(--space-2);
        color: var(--text-secondary);
        background: var(--bg-tertiary);
        border: 1px solid var(--border-default);
        border-radius: var(--radius-full);
        cursor: pointer;
        transition: var(--transition-fast);
      }
      .modo:hover {
        border-color: var(--border-strong);
      }
      .modo--on {
        color: var(--primary-dark);
        border-color: var(--primary);
        background: var(--primary-subtle);
      }
      .menu app-input {
        margin-bottom: var(--space-2);
      }
      .menu__pie {
        display: flex;
        justify-content: flex-end;
        margin-top: var(--space-2);
      }

      /* ── hoja inferior del movil ── */
      .tabla__barra-movil {
        display: none;
      }
      .movil {
        display: inline-flex;
        align-items: center;
        gap: var(--space-2);
        font: inherit;
        font-size: var(--text-sm);
        font-weight: var(--font-medium);
        color: var(--text-primary);
        background: var(--bg-secondary);
        border: 1px solid var(--border-default);
        border-radius: var(--radius-full);
        padding: var(--space-2) var(--space-4);
        cursor: pointer;
      }
      .movil:hover {
        border-color: var(--border-strong);
      }
      .movil:focus-visible {
        outline: 2px solid var(--primary);
        outline-offset: 2px;
      }

      .movil__marca {
        font-size: 11px;
        color: var(--primary-dark);
        background: var(--primary-subtle);
        border-radius: var(--radius-full);
        padding: 0 6px;
        font-variant-numeric: tabular-nums;
      }
      .tabla__velo {
        position: fixed;
        inset: 0;
        z-index: 55;
        background: rgba(0, 0, 0, 0.35);
      }
      .tabla__hoja {
        position: fixed;
        left: 0;
        right: 0;
        bottom: 0;
        z-index: 60;
        max-height: 78vh;
        overflow-y: auto;
        background: var(--bg-secondary);
        border-top: 1px solid var(--border-default);
        border-radius: var(--radius-xl) var(--radius-xl) 0 0;
        padding: var(--space-3) var(--space-4) calc(var(--space-6) + env(safe-area-inset-bottom));
      }
      .hoja__cab {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--space-2);
        margin-bottom: var(--space-2);
      }
      .hoja__titulo {
        font-family: var(--font-display);
        font-weight: var(--font-semibold);
      }
      .hoja__volver {
        display: inline-flex;
        align-items: center;
        gap: var(--space-1);
        font: inherit;
        font-weight: var(--font-semibold);
        color: var(--text-primary);
        background: none;
        border: 0;
        padding: var(--space-1);
        cursor: pointer;
      }
      .hoja__volver:hover {
        color: var(--primary-dark);
      }
      .hoja__volver:focus-visible {
        outline: 2px solid var(--primary);
        outline-offset: 2px;
      }

      .hoja__x {
        display: inline-grid;
        place-items: center;
        width: 34px;
        height: 34px;
        color: var(--text-secondary);
        background: none;
        border: 0;
        border-radius: var(--radius-full);
        cursor: pointer;
      }
      .hoja__x:hover {
        background: var(--bg-tertiary);
        color: var(--text-primary);
      }
      .hoja__x:focus-visible {
        outline: 2px solid var(--primary);
        outline-offset: 2px;
      }

      .hoja__lista {
        list-style: none;
        margin: 0;
        padding: 0;
      }
      .hoja__fila {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--space-2);
        padding: var(--space-2) 0;
        border-bottom: 1px solid var(--border-default);
      }
      .hoja__fila:last-child {
        border-bottom: 0;
      }
      .hoja__etq {
        font-weight: var(--font-medium);
      }
      .hoja__acciones {
        display: inline-flex;
        gap: var(--space-1);
      }
      .hoja__btn {
        position: relative;
        display: inline-flex;
        align-items: center;
        gap: 4px;
        font: inherit;
        font-size: var(--text-xs);
        color: var(--text-secondary);
        background: var(--bg-tertiary);
        border: 1px solid var(--border-default);
        border-radius: var(--radius-full);
        padding: var(--space-1) var(--space-2);
        cursor: pointer;
      }
      .hoja__btn--on {
        color: var(--primary-dark);
        border-color: var(--primary);
        background: var(--primary-subtle);
      }
      .hoja__btn:hover {
        border-color: var(--border-strong);
        color: var(--text-primary);
      }
      .hoja__btn:focus-visible {
        outline: 2px solid var(--primary);
        outline-offset: 2px;
      }

      .hoja__ord {
        font-size: 10px;
        font-weight: var(--font-bold);
        color: var(--primary-dark);
      }
      .hoja__pie {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--space-3);
        margin-top: var(--space-3);
      }
      .hoja__ayuda {
        margin: 0;
        font-size: var(--text-xs);
        color: var(--text-tertiary);
      }
      .hoja__limpiar {
        font: inherit;
        font-size: var(--text-sm);
        color: var(--error, var(--primary-dark));
        background: none;
        border: 0;
        padding: var(--space-1) var(--space-3);
        border-radius: var(--radius-full);
        cursor: pointer;
      }
      .hoja__limpiar:hover {
        background: var(--error-subtle);
      }
      .hoja__limpiar:focus-visible {
        outline: 2px solid var(--primary);
        outline-offset: 2px;
      }

      .th__menu--arriba .menu {
        max-height: min(48vh, 420px);
      }
      .hoja__cuerpo--menu .menu {
        width: auto;
        max-height: none;
        box-shadow: none;
        border: 0;
        padding: 0 0 var(--space-2);
      }

      /* ── el reflujo a tarjetas por debajo de 720 ── */
      @media (max-width: 719px) {
        .tabla__barra-movil {
          display: block;
          margin-bottom: var(--space-2);
        }
        .tabla__lienzo {
          overflow: visible;
          border: 0;
          background: none;
        }
        .tabla__el,
        .tabla__el thead,
        .tabla__el tbody {
          display: block;
        }
        .tabla__el thead {
          display: none;
        }
        .tabla__fila {
          display: block;
          margin-bottom: var(--space-2);
          padding: var(--space-3);
          background: var(--bg-secondary);
          border: 1px solid var(--border-default);
          border-radius: var(--radius-lg);
        }
        .tabla__fila:hover {
          background: var(--bg-secondary);
        }
        .tabla__td {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: var(--space-3);
          padding: 2px 0;
          text-align: start;
        }
        .tabla__td--fin {
          text-align: end;
        }
        .tabla__td::before {
          content: attr(data-label);
          font-size: var(--text-xs);
          color: var(--text-tertiary);
          flex: none;
          margin-inline-end: auto;
        }
        /* En la tarjeta la casilla no flota: es una linea propia, alineada a la derecha y por encima del
           contenido —asi ninguna accion de la fila se superpone al pulsarla (## 12ad, A en movil). */
        .tabla__td--check {
          display: flex;
          justify-content: flex-end;
          padding: 0 var(--space-1);
        }
        .tabla__td--check::before {
          content: none;
        }
        .tabla__fila {
          position: relative;
        }
        .tabla__td--vacia::before {
          color: var(--text-tertiary);
        }
        .tabla__vacia td {
          display: block;
          padding: 0;
        }
        .tabla__vacia td::before {
          content: none;
        }
        .tabla__hoja {
          border-radius: var(--radius-xl) var(--radius-xl) 0 0;
        }
      }
    `
  ]
})
export class DataTableComponent implements AfterContentInit, OnInit {
  @ContentChildren(DataTableCellDirective) private celdasProyectadas?: DataTableCellDirective[];

  /** Las filas completas de la pantalla: la tabla no pide nada, pero si filtra, ordena y corta. */
  readonly filas = input<readonly unknown[]>([]);
  readonly columnas = input<readonly DataTableColumna[]>([]);
  /** La clave estable de la fila (identificadores, no posiciones: la seleccion sobreviva al filtro). */
  readonly claveDeFila = input<(fila: unknown) => string>((fila) =>
    String((fila as { id?: unknown }).id ?? '')
  );
  /** Etiqueta de la fila para el `aria-label` de la casilla (el nombre, si la pantalla lo sabe decir). */
  readonly etiquetaDeFila = input<(fila: unknown) => string>(() => '');
  /** Clases extra de la fila: la pantalla puede conservar las suyas (`ingredient-item`, lo que pinte). */
  readonly claseFila = input<(fila: unknown) => string | null | undefined>(() => null);
  readonly seleccionable = input(false);
  readonly tamanos = input<readonly number[]>([10, 24, 50, 100]);
  readonly tamanoInicial = input(24);
  /** La frase del hueco de la pantalla (la tabla solo trae la genérica). */
  readonly claveVacia = input<TranslationKey | null>(null);

  @Output() readonly seleccionChange = new EventEmitter<unknown[]>();
  /** Las filas del resultado, re-emitidas cuando cambian (vease `resultado`). Solo si alguien escucha. */
  readonly resultadoChange = output<readonly unknown[]>();

  readonly orden = signal<OrdenTabla>([]);
  readonly filtros = signal<Readonly<Record<string, FiltroColumna | undefined>>>({});
  readonly pagina = signal(1);
  readonly tamano = signal(24);
  readonly busquedaMenu = signal('');
  readonly menu = signal<EstadoCapa | null>(null);
  readonly hoja = signal(false);
  /** El popover del cabezal vive en coordenadas de pantalla: dentro del lienzo con overflow se recortaba. */
  readonly menuAncla = signal<{ top: number; left: number } | null>(null);
  readonly anclaAbajo = signal(true);
  private botonMenu: HTMLElement | null = null;
  private readonly seleccion = signal<ReadonlySet<string>>(new Set());
  private plantillas: Readonly<Record<string, TemplateRef<{ $implicit: unknown; fila: unknown }>>> =
    {};

  private readonly destroyRef = inject(DestroyRef);
  private readonly i18n = inject(I18nService);

  constructor() {
    // El resultado filtrado viaja hacia fuera (## 12ac): la pantalla que tenga un boton de lote sobre «lo de
    // la pantalla» necesita exactamente estas filas, no las de la pagina cortada.
    effect(() => this.resultadoChange.emit(this.resultado()));
    afterNextRender(() => {
      const reposicionar = () => {
        if (this.menu()?.sup === 'cabezal') this.ajustarAncla();
      };
      window.addEventListener('scroll', reposicionar, true);
      window.addEventListener('resize', reposicionar);
      this.destroyRef.onDestroy(() => {
        window.removeEventListener('scroll', reposicionar, true);
        window.removeEventListener('resize', reposicionar);
      });
    });
    // Los filtros sí reinician la página; cambiar tamaño usa su propio reanclaje y no debe pasar por aquí.
    effect(() => {
      this.filtros();
      this.pagina.set(1);
    });
    // Si desaparece una fila seleccionada (p. ej. tras borrarla y recargar), la barra de lote del
    // consumidor debe recibir la selección viva, no conservar un objeto/ID que ya no existe.
    effect(() => {
      const filas = this.filas();
      const seleccion = this.seleccion();
      const clavesVivas = new Set(filas.map((fila) => this.identificadorDe(fila)));
      const podar = [...seleccion].some((id) => !clavesVivas.has(id));
      if (!podar) return;

      const idsVivos = new Set([...seleccion].filter((id) => clavesVivas.has(id)));
      this.seleccion.set(idsVivos);
      this.seleccionChange.emit(filas.filter((fila) => idsVivos.has(this.identificadorDe(fila))));
    });
  }

  ngOnInit(): void {
    // Angular asigna los signal inputs después del constructor; leerlos allí usa solo sus defaults.
    const t = this.tamanoInicial();
    if (this.tamanos().includes(t)) this.tamano.set(t);
  }

  ngAfterContentInit(): void {
    const mapa: Record<string, TemplateRef<{ $implicit: unknown; fila: unknown }>> = {};
    for (const c of this.celdasProyectadas ?? []) mapa[c.nombre] = c.tpl;
    this.plantillas = mapa;
  }

  // ── tipos y lecturas ──

  protected readonly tipoDe = (col: DataTableColumna): TipoColumna => col.tipo ?? 'texto';
  private leedor = (fila: unknown, clave: string): unknown =>
    (fila as Record<string, unknown>)[clave];

  protected identificadorDe(fila: unknown): string {
    return this.claveDeFila()(fila);
  }
  protected etiquetaFilaDe(fila: unknown): string {
    return this.etiquetaDeFila()(fila);
  }
  protected claseFilaStr(fila: unknown): string {
    const fn = this.claseFila();
    const extra = fn(fila);
    return ['tabla__fila', this.seleccionada(fila) ? 'tabla__fila--sel' : '', extra ?? '']
      .filter(Boolean)
      .join(' ');
  }
  protected anchoFila(): number {
    return this.columnas().length + (this.seleccionable() ? 1 : 0);
  }

  protected plantillaDe(
    col: DataTableColumna
  ): TemplateRef<{ $implicit: unknown; fila: unknown }> | null {
    return this.plantillas[col.celda ?? col.clave] ?? null;
  }

  protected esOrdenable(col: DataTableColumna): boolean {
    return col.ordenable !== false;
  }
  protected esVerdadero(fila: unknown, col: DataTableColumna): boolean {
    return valorTipado(this.leedor(fila, col.clave), 'booleano') === true;
  }

  protected textoCelda(col: DataTableColumna, fila: unknown): string {
    const crudo = this.leedor(fila, col.clave);
    // El hueco se pinta hueco incluso con etiqueta: una columna sin dato no debe decir «Despensa» (## 12ab).
    if (crudo === null || crudo === undefined || crudo === '') return '';
    if (col.etiquetaValor) return col.etiquetaValor(crudo) ?? '';
    switch (this.tipoDe(col)) {
      case 'numero': {
        const n = valorTipado(crudo, 'numero');
        return n === null ? '' : String(n);
      }
      case 'fecha': {
        const dia = String(crudo).slice(0, 10);
        const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dia);
        return m ? `${m[3]}/${m[2]}/${m[1]}` : dia;
      }
      default:
        return String(crudo);
    }
  }

  // ── el pipeline: filtrar -> ordenar -> cortar ──

  /**
   * Lo que la busqueda y los menus de columna dejan en pie, ordenado y AUN SIN CORTAR por pagina (## 12ac).
   * Es el «contenido de la pantalla» honesto: un boton de lote que opera sobre «lo visible» tiene que operar
   * sobre esto, no sobre las 24 filas del corte actual ni sobre el monton original.
   */
  protected readonly resultado = computed(() => {
    const columnas = this.columnas();
    const activos: FiltroDeColumna[] = [];
    const filtros = this.filtros();
    for (const col of columnas) {
      const f = filtros[col.clave];
      if (f && filtroActivo(f))
        activos.push({ columna: col.clave, tipo: this.tipoDe(col), filtro: f });
    }
    const filtradas = pasarFiltros(this.filas(), activos, this.leedor, hoyLocal());
    return ordenar(filtradas, this.orden(), this.leedor, (clave) => {
      const col = columnas.find((c) => c.clave === clave);
      return col ? this.tipoDe(col) : 'texto';
    });
  });

  protected readonly vista = computed(() =>
    paginar(this.resultado(), this.pagina(), this.tamano())
  );

  // ── orden ──

  protected clicOrden(col: DataTableColumna, evento: MouseEvent): void {
    if (!this.esOrdenable(col)) return;
    this.orden.set(rotarOrden(this.orden(), col.clave, evento.shiftKey));
  }
  protected dirDe(clave: string): DireccionOrden | null {
    return direccionDe(this.orden(), clave);
  }
  protected posicion(clave: string): number | null {
    return posicionDeOrden(this.orden(), clave);
  }
  protected ariaSortDe(clave: string): string {
    const dir = this.dirDe(clave);
    return dir === 'asc' ? 'ascending' : dir === 'desc' ? 'descending' : 'none';
  }

  // ── filtros ─

  protected activo(clave: string): boolean {
    return filtroActivo(this.filtros()[clave]);
  }
  protected readonly nFiltros = computed(
    () => this.columnas().filter((c) => this.activo(c.clave)).length
  );

  private escribirFiltro(clave: string, filtro: FiltroColumna | undefined): void {
    this.filtros.update((actuales) => {
      const copia: Record<string, FiltroColumna | undefined> = { ...actuales };
      if (filtro === undefined) delete copia[clave];
      else copia[clave] = filtro;
      return copia;
    });
  }

  protected limpiarFiltro(col: DataTableColumna): void {
    this.escribirFiltro(col.clave, undefined);
  }
  protected limpiarFiltros(): void {
    this.filtros.set({});
  }

  // valores del menu: los de TODAS las filas (lo que Excel hace; la busqueda del menu solo recorta la lista)
  protected valoresDe(col: DataTableColumna): { valor: string; cuenta: number }[] {
    return valoresUnicos(this.filas(), col.clave, this.leedor, this.tipoDe(col));
  }
  protected valoresMenu(col: DataTableColumna): { valor: string; cuenta: number }[] {
    const b = this.busquedaMenu();
    const lista = this.valoresDe(col);
    if (!b.trim()) return lista;
    return lista.filter((v) => coincideEnMenu(this.etiquetaDeValor(col, v.valor), b));
  }
  protected etiquetaDeValor(col: DataTableColumna, valor: string): string {
    if (valor === SIN_VALOR) return '—';
    return col.etiquetaValor ? col.etiquetaValor(valor) : valor;
  }

  private seleccionados(col: DataTableColumna): string[] | null {
    const f = this.filtros()[col.clave];
    if (!f || f.tipo !== 'valores') return null;
    if (f.activos === null) return null;
    return f.activos;
  }
  protected valorMarcado(col: DataTableColumna, valor: string): boolean {
    const activos = this.seleccionados(col);
    if (activos === null) return true; // sin filtro: todo marcado (Excel pinta las casillas llenas)
    return activos.includes(valor);
  }
  protected toggleValor(col: DataTableColumna, valor: string): void {
    const todos = this.valoresDe(col).map((v) => v.valor);
    const base = this.seleccionados(col) ?? [...todos];
    const tiene = base.includes(valor);
    const nuevos = tiene ? base.filter((v) => v !== valor) : [...base, valor];
    // Volver a marcarlo todo DESACTIVA el filtro (es lo que el embudo pintaba: sin punto = sin filtro).
    if (nuevos.length === todos.length)
      this.escribirFiltro(col.clave, { tipo: 'valores', activos: null });
    else this.escribirFiltro(col.clave, { tipo: 'valores', activos: nuevos });
  }
  protected marcarTodos(col: DataTableColumna): void {
    this.escribirFiltro(col.clave, { tipo: 'valores', activos: null });
  }
  protected marcarNinguno(col: DataTableColumna): void {
    this.escribirFiltro(col.clave, { tipo: 'valores', activos: [] });
  }
  protected recortarA(col: DataTableColumna): void {
    // «Quedarse con lo visible»: deja marcados solo los valores de esta columna que sobreviven a los DEMAS
    // filtros activos. Es el recortar de Excel, y es lo que la gente usa para filtrar por franjas.
    const otros: FiltroDeColumna[] = [];
    const filtros = this.filtros();
    for (const c of this.columnas()) {
      if (c.clave === col.clave) continue;
      const f = filtros[c.clave];
      if (f && filtroActivo(f)) otros.push({ columna: c.clave, tipo: this.tipoDe(c), filtro: f });
    }
    const visibles = new Set(
      pasarFiltros(this.filas(), otros, this.leedor, hoyLocal()).map((f) =>
        cuboDe(this.leedor(f, col.clave))
      )
    );
    const actuales = this.seleccionados(col) ?? this.valoresDe(col).map((v) => v.valor);
    const recortados = actuales.filter((v) => visibles.has(v));
    this.escribirFiltro(col.clave, recortarFiltro({ tipo: 'valores', activos: recortados }));
  }

  // ── filtros de numero y fecha ──

  protected modosDe(col: DataTableColumna): { clave: string; etiqueta: TranslationKey }[] {
    if (this.tipoDe(col) === 'numero') {
      return [
        { clave: 'igual', etiqueta: 'ui.tabla_igual' },
        { clave: 'mayor', etiqueta: 'ui.tabla_mayor' },
        { clave: 'menor', etiqueta: 'ui.tabla_menor' },
        { clave: 'entre', etiqueta: 'ui.tabla_entre' }
      ];
    }
    return [
      { clave: 'hoy', etiqueta: 'ui.tabla_hoy' },
      { clave: 'siete', etiqueta: 'ui.tabla_proximos_7' },
      { clave: 'vencidos', etiqueta: 'ui.tabla_vencidos' },
      { clave: 'antes', etiqueta: 'ui.tabla_antes_de' },
      { clave: 'despues', etiqueta: 'ui.tabla_despues_de' },
      { clave: 'entre', etiqueta: 'ui.tabla_entre' }
    ];
  }
  protected modoDe(col: DataTableColumna): string | null {
    const f = this.filtros()[col.clave];
    if (!f || (f.tipo !== 'numero' && f.tipo !== 'fecha')) return null;
    return f.modo;
  }
  protected ponerModo(col: DataTableColumna, modo: string): void {
    const prev = this.filtros()[col.clave];
    if (this.tipoDe(col) === 'numero') {
      const a = prev && prev.tipo === 'numero' ? prev.a : null;
      const b = prev && prev.tipo === 'numero' ? prev.b : null;
      this.escribirFiltro(col.clave, { tipo: 'numero', modo: modo as ModoNumero, a, b });
    } else {
      const a = prev && prev.tipo === 'fecha' ? prev.a : null;
      const b = prev && prev.tipo === 'fecha' ? prev.b : null;
      this.escribirFiltro(col.clave, { tipo: 'fecha', modo: modo as ModoFecha, a, b });
    }
  }
  protected necesitaA(col: DataTableColumna): boolean {
    const m = this.modoDe(col);
    return !!m && m !== 'hoy' && m !== 'siete' && m !== 'vencidos';
  }
  protected necesitaB(col: DataTableColumna): boolean {
    return this.modoDe(col) === 'entre';
  }
  protected extremoDe(col: DataTableColumna, lado: 'a' | 'b'): string {
    const f = this.filtros()[col.clave];
    if (!f || (f.tipo !== 'numero' && f.tipo !== 'fecha')) return '';
    const v = f[lado];
    return v === null || v === undefined ? '' : String(v);
  }
  protected fijarExtremo(
    col: DataTableColumna,
    lado: 'a' | 'b',
    valor: string | number | null
  ): void {
    const tipo = this.tipoDe(col);
    let anterior: FiltroNumero | FiltroFecha;
    const prev = this.filtros()[col.clave];
    if (tipo === 'numero') {
      const base: FiltroNumero =
        prev && prev.tipo === 'numero' ? prev : { tipo: 'numero', modo: 'igual', a: null, b: null };
      const n = valor === null || valor === '' || valor === undefined ? null : Number(valor);
      anterior = { ...base, [lado]: Number.isFinite(n as number) ? n : null } as FiltroNumero;
    } else {
      const base: FiltroFecha =
        prev && prev.tipo === 'fecha' ? prev : { tipo: 'fecha', modo: 'hoy', a: null, b: null };
      anterior = { ...base, [lado]: valor ? String(valor).slice(0, 10) : null } as FiltroFecha;
    }
    this.escribirFiltro(col.clave, anterior);
  }

  // ── las capas: menu popover / hoja del movil ──

  protected alternarMenu(col: DataTableColumna, sup: 'cabezal' | 'hoja', evento?: Event): void {
    const actual = this.menu();
    this.busquedaMenu.set('');
    if (actual && actual.col === col.clave && actual.sup === sup) {
      this.menu.set(null);
      return;
    }
    this.menu.set({ col: col.clave, sup });
    if (sup === 'cabezal') {
      this.botonMenu = (evento?.currentTarget as HTMLElement) ?? this.botonMenu;
      this.ajustarAncla();
    }
  }

  /** Encaja el popover bajo (o sobre) el boton del embudo, dentro del borde de la ventana. */
  private ajustarAncla(): void {
    const boton = this.botonMenu;
    if (!boton) return;
    const caja = boton.getBoundingClientRect();
    const ANCHO = 264;
    const left = Math.max(8, Math.min(caja.right - ANCHO, window.innerWidth - ANCHO - 8));
    const cabeAbajo = caja.bottom + 300 < window.innerHeight;
    this.anclaAbajo.set(cabeAbajo);
    this.menuAncla.set(cabeAbajo ? { top: caja.bottom + 6, left } : { top: caja.top - 6, left });
  }
  protected abrirMenuHoja(col: DataTableColumna): void {
    this.busquedaMenu.set('');
    this.menu.set({ col: col.clave, sup: 'hoja' });
  }
  protected abrirHoja(): void {
    this.menu.set(null);
    this.hoja.set(true);
  }
  protected volverColumnas(): void {
    this.menu.set(null);
  }
  protected cerrarCapas(): void {
    this.menu.set(null);
    this.hoja.set(false);
  }
  protected colDeCapa(): DataTableColumna | null {
    const m = this.menu();
    if (!m) return null;
    return this.columnas().find((c) => c.clave === m.col) ?? null;
  }
  protected ponerBusqueda(valor: string): void {
    this.busquedaMenu.set(valor ?? '');
  }

  /** Un clic fuera del popover del cabezal lo cierra (dentro no llega: el propio menu corta la propagacion). */
  @HostListener('document:click', ['$event.target'])
  protected alClicFuera(alvo: HTMLElement | null): void {
    const m = this.menu();
    if (!m || m.sup !== 'cabezal') return;
    if (alvo?.closest('.th__emb, .th__menu')) return;
    this.menu.set(null);
  }

  @HostListener('document:keydown.escape')
  protected alEscape(): void {
    if (this.menu() || this.hoja()) this.cerrarCapas();
  }

  // ── paginacion ──

  protected cambiarTamano(t: number): void {
    this.tamano.set(t);
  }
  protected irA(p: number): void {
    const { ultima } = this.vista();
    this.pagina.set(Math.min(Math.max(1, p), ultima));
  }

  // ── seleccion ──

  protected seleccionada(fila: unknown): boolean {
    return this.seleccion().has(this.identificadorDe(fila));
  }
  protected marcarFila(fila: unknown, valor: boolean): void {
    const id = this.identificadorDe(fila);
    if (this.gestoShift) {
      const rango = this.rangoPara(id);
      if (rango) {
        // El checkbox comunica su nuevo valor antes de que el click llegue al <td>. Guardamos el tramo y
        // dejamos que alPulsarMarca emita solo el resultado final, no el toggle intermedio.
        this.rangoShiftPendiente = { id, rango };
        return;
      }
    }
    const copia = new Set(this.seleccion());
    if (valor) copia.add(id);
    else copia.delete(id);
    this.aplicarSeleccion(copia);
  }
  protected estadoSeleccionPagina(): 'none' | 'all' | 'mixed' {
    const visibles = this.vista().filas.map((f) => this.identificadorDe(f));
    if (visibles.length === 0) return 'none';
    const marcadas = visibles.filter((id) => this.seleccion().has(id)).length;
    if (marcadas === 0) return 'none';
    return marcadas === visibles.length ? 'all' : 'mixed';
  }
  protected togglePagina(): void {
    const visibles = this.vista().filas.map((f) => this.identificadorDe(f));
    // El ancla del Shift pasa a la primera fila de la pagina: «seleccionar todo y luego Shift a una fila»
    // tramea el bloque entero, que es el gesto que la gente espera del encabezado.
    this.anclaMarca = visibles[0] ?? null;
    const copia = new Set(this.seleccion());
    const todas = visibles.every((id) => copia.has(id));
    for (const id of visibles) {
      if (todas) copia.delete(id);
      else copia.add(id);
    }
    this.aplicarSeleccion(copia);
  }
  /** Ancla del tramo con Shift: el id de la ultima pulsacion simple (envejece solo, como en Windows). */
  private anclaMarca: string | null = null;
  private gestoShift = false;
  private rangoShiftPendiente: { id: string; rango: RangoSeleccion } | null = null;

  protected registrarShift(evento: MouseEvent | KeyboardEvent): void {
    if (
      evento instanceof KeyboardEvent &&
      evento.key !== ' ' &&
      evento.key !== 'Spacebar' &&
      evento.key !== 'Enter'
    )
      return;
    this.gestoShift = evento.shiftKey;
  }

  /**
   * Shift+click en la casilla: tramo desde la ancla hasta aqui, inclusivo y SOBRE LA PAGINA visible (## 12ad).
   * Va en el `click` del `td` (no en el boton): cuando esto corre, el checkbox de la fila ya ha hecho su toggle
   * —y da igual, porque abajo se REEMPLAZA la seleccion por el tramo, que es la semantica del explorador. Sin
   * Shift, el click solo mueve el ancla: el toggle se lo deja hecho al propio boton.
   */
  protected alPulsarMarca(evento: MouseEvent, fila: unknown): void {
    const id = this.identificadorDe(fila);
    this.gestoShift = false;
    if (!evento.shiftKey) {
      this.rangoShiftPendiente = null;
      this.anclaMarca = id;
      return;
    }
    const pendiente = this.rangoShiftPendiente;
    this.rangoShiftPendiente = null;
    const rango = pendiente?.id === id ? pendiente.rango : this.rangoPara(id);
    if (!rango) return; // sin ancla valida: el toggle normal del checkbox permanece intacto
    // El tramo se mide sobre el resultado ordenado completo —el ancla puede vivir en otra pagina—, pero solo
    // entran en la seleccion las filas que estan en la pagina visible (## 12ad, B).
    const visibles = new Set(this.vista().filas.map((f) => this.identificadorDe(f)));
    // Como en el explorador: el tramo REEMPLAZA la seleccion —no se suma—, y el ancla se queda donde estaba.
    const tramo = tramoDeIndices(rango.origen, rango.destino)
      .map((i) => rango.ids[i])
      .filter((k) => visibles.has(k));
    this.aplicarSeleccion(new Set(tramo));
  }

  private rangoPara(id: string): RangoSeleccion | null {
    if (this.anclaMarca === null) return null;
    const ids = this.resultado().map((fila) => this.identificadorDe(fila));
    const origen = ids.indexOf(this.anclaMarca);
    const destino = ids.indexOf(id);
    return origen < 0 || destino < 0 ? null : { ids, origen, destino };
  }

  /** El tamano no se cambia a ciegas: se re-ancla la pagina para que la primera fila vista siga a la vista. */
  protected elegirTamano(valor: string | null): void {
    const t = Number(valor);
    if (!Number.isFinite(t) || t <= 0) return;
    const viejo = this.tamano();
    if (t === viejo) return;
    this.tamano.set(t);
    this.pagina.set(reanclarPagina(this.paginaEnVista(), viejo, t));
  }

  protected readonly opcionesTamano = computed<PickerOption[]>(() => {
    this.i18n.changeTick();
    return this.tamanos().map((n) => ({
      value: String(n),
      label: this.i18n.t('ui.tabla_filas_pagina', { n })
    }));
  });

  /** La pagina efectiva, la que salio del recorte de `paginar`, no la que alguien pido. */
  protected paginaEnVista(): number {
    return Math.min(Math.max(1, Math.trunc(this.pagina()) || 1), this.vista().ultima);
  }

  protected readonly tramo = computed(() =>
    tramoDePaginas(this.paginaEnVista(), this.vista().ultima)
  );
  protected readonly tamanoValor = computed(() => String(this.tamano()));

  private aplicarSeleccion(ids: ReadonlySet<string>): void {
    // La seleccion se poda contra las filas vivas: una fila borrada en el servidor no puede seguir «elegida».
    const claves = new Set(this.filas().map((f) => this.identificadorDe(f)));
    const podada = new Set([...ids].filter((id) => claves.has(id)));
    this.seleccion.set(podada);
    this.seleccionChange.emit(this.filas().filter((f) => podada.has(this.identificadorDe(f))));
  }
  /** La pantalla vacia la barra de lote con esto tras aplicar la accion. */
  limpiarSeleccion(): void {
    this.seleccion.set(new Set());
    this.seleccionChange.emit([]);
  }
  readonly seleccionadas = computed(() =>
    this.filas().filter((f) => this.seleccion().has(this.identificadorDe(f)))
  );
}
