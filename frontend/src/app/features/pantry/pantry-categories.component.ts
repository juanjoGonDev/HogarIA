import { Component, DestroyRef, OnInit, computed, inject, signal, viewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { PantryService } from '../../core/services/pantry.service';
import { ToastService } from '../../core/services/toast.service';
import { ConfirmService } from '../../core/services/confirm.service';
import { I18nService } from '../../core/services/i18n.service';
import { TranslatePipe } from '../../core/pipes/translate.pipe';
import { IconComponent } from '../../shared/components/ui/icon/icon.component';
import { TooltipComponent } from '../../shared/components/ui/tooltip/tooltip.component';
import { InputComponent } from '../../shared/components/ui/input/input.component';
import { FilterTagComponent } from '../../shared/components/ui/tag/filter-tag.component';
import { BadgeComponent } from '../../shared/components/ui/badge/badge.component';
import {
  PickerComponent,
  type PickerOption
} from '../../shared/components/ui/picker/picker.component';
import { PantryCategoryLabelPipe } from '../../shared/pipes/pantry-category-label.pipe';
import {
  DataTableComponent,
  DataTableCellDirective
} from '../../shared/components/ui/data-table/data-table.component';
import type { DataTableColumna } from '../../shared/components/ui/data-table/data-table.types';
import { pantryCategoryLabel } from '../../core/i18n/labels';
import type { PantryCategory, PantryCategoryView } from '../../shared/models/pantry.model';
import {
  cargarTodasLasPaginas,
  clavesNoElegiblesComoPadre,
  coincideGestor,
  colorDeCategoria,
  normalizarColorSeleccionado,
  padreDeCategoriaDesdeQuery,
  valorDeQuery
} from './pantry-gestor.util';

type FilaCategoria = PantryCategory & {
  productos: number;
  subarbol: number;
  subcategorias: number;
};

/**
 * La fila de la tabla: la categoria con sus tres cifras proyectadas. No es burocracia —`app-data-table` lee
 * campos para ordenar y para poblar los menus de filtro—; `counts` anidado no se ordena solo (## 12ac).
 */
/**
 * El gestor de categorias del inventario (HOGARIA-SPEC ## 12x).
 *
 * Es UNA pantalla con dos rutas: `pantry/categories` es la lista, `pantry/categories/:id` es la ficha (y
 * `:new`, el alta). No es un ahorro de lineas: es lo que hace que un F5 en mitad de una edicion no la tire, y
 * que el boton «atras» del navegador funcione como la gente espera. En HogarIA no habia ninguna pantalla de
 * catalogo —ni para las secciones de la cesta—, asi que el molde se lo pone esta tanda: lista filtrada y
 * paginada arriba, ficha con su impacto de borrado abajo, y todo lo que borra pasa por el dialogo de la app.
 *
 * Lo que se delega y por que:
 *  - los recuentos los hace el **server** (`counts` de cada fila), porque el numero de articulos por categoria
 *    necesita la tabla entera; pero la lista, la vista y la busqueda viven EN LA PANTALLA sobre el catalogo
 *    completo (## 12ac): `app-data-table` con menus por columna, paginacion propia y lote, como el visor;
 *  - la URL sigue siendo el estado (`?view=&q=`), jubilando `?limit=&offset=`, que era el paginador server-side;
 *  - lo que se puede elegir como padre lo decide aqui `clavesNoElegiblesComoPadre`, para no ofrecer una opcion
 *    que el server va a rechazar con 400;
 *  - y los codigos de error se traducen aqui, no se pinta el `message` del server: el server habla en castellano
 *    porque su mensaje viaja a los logs, y la pantalla tiene que hablar en el idioma de quien la mira.
 */
@Component({
  selector: 'app-pantry-categories',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    TranslatePipe,
    IconComponent,
    InputComponent,
    FilterTagComponent,
    BadgeComponent,
    PickerComponent,
    PantryCategoryLabelPipe,
    TooltipComponent,
    DataTableComponent,
    DataTableCellDirective
  ],
  template: `
    <div class="gestor">
      <header class="gestor__header">
        <button
          type="button"
          class="gestor__back"
          (click)="volver()"
          data-test="gestor-categorias-volver"
        >
          <app-icon name="chevron_left" [size]="20" [label]="null" />
          <span>{{ 'pantry.volver_al_inventario' | t }}</span>
        </button>
        <h1 class="gestor__title">{{ 'pantry.gestor_categorias' | t }}</h1>
        <p class="gestor__ayuda">{{ 'pantry.gestor_categorias_ayuda' | t }}</p>
      </header>

      @if (!ficha) {
        <section class="gestor__toolbar" data-test="gestor-categorias-lista">
          <div class="gestor__vistas">
            @for (opcion of vistas; track opcion.value) {
              <app-filter-tag
                [selected]="view() === opcion.value"
                (onClick)="cambiarVista(opcion.value)"
                [attr.data-test]="'gestor-categorias-vista-' + opcion.value"
              >
                {{ opcion.clave | t }}
              </app-filter-tag>
            }
          </div>

          <button
            type="button"
            class="gestor__nueva"
            (click)="abrirNueva()"
            data-test="gestor-categorias-nueva"
          >
            <app-icon name="add" [size]="18" [label]="null" />
            <span>{{ 'pantry.nueva_categoria' | t }}</span>
          </button>
        </section>

        @if (cargando) {
          <p class="gestor__estado">{{ 'common.loading' | t }}</p>
        } @else if (lista().length === 0) {
          <p class="gestor__estado" data-test="gestor-categorias-vacia">
            {{ 'pantry.categorias_vacias' | t }}
          </p>
        } @else {
          <app-data-table
            #tablaCats
            data-test="gestor-categorias-tabla"
            [filas]="filasTabla()"
            [columnas]="columnas()"
            [seleccionable]="true"
            [etiquetaDeFila]="etiquetaFila"
            (seleccionChange)="seleccion.set($event)"
          >
            <div data-tabla-buscar>
              <app-input
                class="gestor__buscar"
                id="gestor-categorias-q"
                name="gestor-categorias-q"
                type="search"
                [placeholder]="'pantry.buscar_categorias' | t"
                [ngModel]="q()"
                (ngModelChange)="buscar($event)"
              ></app-input>
            </div>
            <div data-tabla-lote>
              @if (seleccion().length > 0) {
                <div class="lote" data-test="gestor-categorias-lote">
                  <span class="lote__cta">
                    {{ 'pantry.seleccionados' | t: { n: seleccion().length } }}
                    @if (noBorrables() > 0) {
                      <span class="lote__nota">{{
                        'pantry.categorias_lote_saltan' | t: { n: noBorrables() }
                      }}</span>
                    }
                  </span>
                  <span class="lote__acciones">
                    @if (borrables().length > 0) {
                      <button
                        type="button"
                        class="lote__btn lote__btn--peligro"
                        [disabled]="guardando"
                        (click)="borrarLote()"
                        data-test="gestor-categorias-lote-borrar"
                      >
                        {{ 'pantry.borrar_seleccionados' | t }}
                      </button>
                    }
                    <app-tooltip position="top" [text]="'pantry.lote_anular' | t">
                      <button
                        type="button"
                        class="lote__x"
                        (click)="loteAnular()"
                        data-test="gestor-categorias-lote-anular"
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
              <span
                class="celda celda--nombre"
                [attr.data-test]="'gestor-categorias-fila-' + fila.key"
              >
                <span
                  class="celda__punto"
                  [style.background]="colorDeCategoria(fila)"
                  aria-hidden="true"
                ></span>
                <span class="celda__nombre">{{ fila | category }}</span>
                @if (fila.protected) {
                  <app-badge [size]="'sm'">{{ 'pantry.categoria_reservada_corta' | t }}</app-badge>
                }
              </span>
            </ng-template>

            <ng-template appDataTableCell="padre" let-fila>
              @if (fila.parentKey) {
                <span class="celda celda--padre">{{ etiquetaClave(fila.parentKey) }}</span>
              } @else {
                <span class="celda celda--guion" aria-hidden="true">—</span>
              }
            </ng-template>

            <ng-template appDataTableCell="acciones" let-fila>
              <span class="celda__grupo">
                <app-tooltip position="top" [text]="'pantry.editar_categoria' | t">
                  <button
                    type="button"
                    class="celda__accion"
                    [attr.aria-label]="'pantry.editar_categoria' | t"
                    (click)="abrir(fila)"
                    [attr.data-test]="'gestor-categorias-editar-' + fila.key"
                  >
                    <app-icon name="edit" [size]="16" [label]="null" />
                  </button>
                </app-tooltip>
                <app-tooltip
                  position="top"
                  [text]="
                    fila.canDelete ? ('pantry.eliminar_categoria' | t) : ('pantry.error_en_uso' | t)
                  "
                >
                  <button
                    type="button"
                    class="celda__accion celda__accion--peligro"
                    [attr.aria-label]="'pantry.eliminar_categoria' | t"
                    [disabled]="!fila.canDelete || guardando"
                    (click)="borrar(fila)"
                    [attr.data-test]="'gestor-categorias-borrar-' + fila.key"
                  >
                    <app-icon name="delete" [size]="16" [label]="null" />
                  </button>
                </app-tooltip>
              </span>
            </ng-template>
          </app-data-table>
        }
      } @else {
        <section class="ficha" data-test="gestor-categorias-ficha">
          <h2 class="ficha__titulo">
            {{ (esNueva ? 'pantry.nueva_categoria' : 'pantry.editar_categoria') | t }}
          </h2>
          @if (ficha.protected) {
            <p class="ficha__aviso" data-test="gestor-categorias-reservada">
              <app-icon name="error_outline" [size]="16" [label]="null" />
              <span>{{ 'pantry.categoria_reservada' | t }}</span>
            </p>
          }

          <app-input
            id="gestor-categoria-nombre"
            name="gestor-categoria-nombre"
            type="text"
            [label]="'pantry.nombre_categoria' | t"
            [disabled]="ficha.protected"
            [(ngModel)]="formulario.name"
            data-test="gestor-categorias-campo-nombre"
          ></app-input>

          <div class="ficha__campo" data-test="gestor-categorias-campo-color">
            <span class="ficha__etiqueta">{{ 'pantry.color_categoria' | t }}</span>
            <div class="swatches" role="group" [attr.aria-label]="'pantry.color_categoria' | t">
              @for (muestra of muestras; track muestra) {
                <button
                  type="button"
                  class="swatch"
                  [class.swatch--activa]="formulario.color.toUpperCase() === muestra"
                  [attr.aria-pressed]="formulario.color.toUpperCase() === muestra"
                  [attr.aria-label]="muestra"
                  (click)="pintar(muestra)"
                  [attr.data-test]="'gestor-categorias-color-' + muestra.toLowerCase()"
                >
                  <span
                    class="swatch__muestra"
                    [style.background]="muestra"
                    aria-hidden="true"
                  ></span>
                </button>
              }
              <div class="boton selector-color" data-test="gestor-categorias-color-picker-surface">
                <span
                  class="selector-color__muestra"
                  [style.background]="formulario.color || '#8A8F98'"
                  aria-hidden="true"
                ></span>
                <span class="selector-color__accion">{{ 'pantry.color_personalizado' | t }}</span>
                <span
                  id="gestor-categoria-color-valor"
                  class="selector-color__valor"
                  data-test="gestor-categorias-color-valor"
                  >{{ (formulario.color || '#8A8F98').toUpperCase() }}</span
                >
                <input
                  id="gestor-categoria-color"
                  name="gestor-categoria-color"
                  class="selector-color__input"
                  type="color"
                  [ngModel]="formulario.color || '#8A8F98'"
                  (ngModelChange)="pintar($event)"
                  [attr.aria-label]="'pantry.color_personalizado' | t"
                  aria-describedby="gestor-categoria-color-valor"
                  data-test="gestor-categorias-selector-color-control"
                />
              </div>
            </div>
          </div>

          <div class="ficha__campo">
            <span class="ficha__etiqueta">{{ 'pantry.padre_categoria' | t }}</span>
            <!-- La reserva se puede pintar y anotar, no renombrar, MOVER ni borrar (## 12x): el nombre y el
                 borrado ya lo respetaban; el picker del padre era el hueco, y lo cazó el e2e de la tanda 29. -->
            <app-picker
              [options]="opcionesPadre()"
              [value]="formulario.parentKey || null"
              (valueChange)="elegirPadre($event)"
              [placeholder]="'pantry.sin_padre' | t"
              [disabled]="ficha.protected"
              data-test="gestor-categorias-campo-padre"
            />
            @if (formulario.parentKey) {
              <button
                type="button"
                class="ficha__enlace"
                (click)="quitarPadre()"
                data-test="gestor-categorias-quitar-padre"
              >
                {{ 'pantry.sin_padre' | t }}
              </button>
            }
          </div>

          <app-input
            id="gestor-categoria-descripcion"
            name="gestor-categoria-descripcion"
            type="text"
            [label]="'pantry.descripcion_categoria' | t"
            [(ngModel)]="formulario.description"
            data-test="gestor-categorias-campo-descripcion"
          ></app-input>

          @if (error) {
            <p class="ficha__error" role="alert" data-test="gestor-categorias-error">{{ error }}</p>
          }

          <div class="ficha__acciones">
            <button
              type="button"
              class="boton boton--primario"
              [disabled]="guardando"
              (click)="guardar()"
              data-test="gestor-categorias-guardar"
            >
              {{ (esNueva ? 'pantry.crear_categoria' : 'common.save') | t }}
            </button>
            @if (!esNueva) {
              <button
                type="button"
                class="boton boton--peligro"
                [disabled]="ficha.protected || !ficha.canDelete"
                (click)="borrar(ficha)"
                data-test="gestor-categorias-eliminar"
              >
                {{ 'pantry.eliminar_categoria' | t }}
              </button>
            }
            <button
              type="button"
              class="boton"
              (click)="volver()"
              data-test="gestor-categorias-cancelar"
            >
              {{ 'common.cancel' | t }}
            </button>
          </div>
        </section>
      }
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
      }

      /* La pantalla entera se acota y se respira: lo que heredo de la despensa vecina (max-width de 1000px,
       padding del sistema y margen automatico) es lo que hace que al cambiar de pantalla nada salte de
       ancho. Un gestor sin contenedor, en un monitor de 27 pulgadas, es una linea de 2400px de larga y
       ninguna columna vuelve a cuadrar con la de arriba. */
      .gestor {
        display: flex;
        flex-direction: column;
        gap: var(--space-4);
        box-sizing: border-box;
        width: 100%;
        max-width: 1000px;
        margin: 0 auto;
        padding-block: var(--container-padding);
      }
      @media (min-width: 768px) {
        .gestor {
          gap: var(--space-6);
        }
      }

      /* Cabecera con su propio aire y una linea de separacion: el titulo, la ayuda y el volver son tres cosas
       distintas y no pueden ir pegadas. */
      .gestor__header {
        display: flex;
        flex-direction: column;
        gap: var(--space-1);
        padding-bottom: var(--space-4);
        border-bottom: 1px solid var(--border-default);
      }
      .gestor__back {
        display: inline-flex;
        align-items: center;
        gap: var(--space-1);
        align-self: flex-start;
        margin: 0 0 var(--space-2);
        padding: var(--space-1) var(--space-2) var(--space-1) 0;
        font: inherit;
        font-size: var(--text-xs);
        color: var(--text-secondary);
        background: none;
        border: none;
        border-radius: var(--radius-sm);
        cursor: pointer;
        transition: var(--transition-fast);
      }
      .gestor__back:hover {
        color: var(--text-primary);
      }
      .gestor__back:focus-visible {
        outline: 2px solid var(--primary);
        outline-offset: 2px;
      }
      .gestor__title {
        margin: 0;
        font-family: var(--font-display);
        font-size: var(--text-xl);
        font-weight: var(--font-bold);
        line-height: var(--leading-tight);
        letter-spacing: var(--tracking-tight);
        color: var(--text-primary);
      }
      .gestor__ayuda {
        margin: var(--space-1) 0 0;
        max-width: 66ch;
        color: var(--text-secondary);
        font-size: var(--text-sm);
        line-height: var(--leading-relaxed);
      }
      @media (min-width: 768px) {
        .gestor__title {
          font-size: var(--text-2xl);
        }
        .gestor__ayuda {
          font-size: var(--text-base);
        }
      }

      /* La barra de trabajo es una superficie, no tres controles sueltos flotando en la pagina: se alinea por
       su linea de base (align-items al final) para que buscador, filtros y boton compartan alturas. */
      .gestor__toolbar {
        display: flex;
        flex-wrap: wrap;
        align-items: end;
        gap: var(--space-3);
        padding: var(--space-3) var(--space-4);
        background: var(--bg-secondary);
        border: 1px solid var(--border-default);
        border-radius: var(--radius-xl);
      }
      .gestor__vistas {
        display: flex;
        flex-wrap: wrap;
        gap: var(--space-1);
        align-items: center;
        margin-right: auto;
        padding: var(--space-1);
        background: var(--bg-tertiary);
        border-radius: var(--radius-full);
      }
      .gestor__buscar {
        flex: 1 1 220px;
        min-width: 180px;
      }
      .gestor__nueva {
        display: inline-flex;
        align-items: center;
        gap: var(--space-2);
        padding: var(--space-2) var(--space-4);
        font: inherit;
        font-size: var(--text-sm);
        font-weight: var(--font-semibold);
        color: var(--bg-secondary);
        background: var(--primary);
        border: 1px solid transparent;
        border-radius: var(--radius-full);
        cursor: pointer;
        transition: var(--transition-fast);
      }
      .gestor__nueva:hover {
        filter: brightness(1.06);
      }
      .gestor__nueva:focus-visible {
        outline: 2px solid var(--primary);
        outline-offset: 2px;
      }

      .gestor__estado {
        margin: 0;
        padding: var(--space-5) var(--space-4);
        text-align: center;
        color: var(--text-secondary);
        font-size: var(--text-sm);
        background: var(--bg-secondary);
        border: 1px dashed var(--border-default);
        border-radius: var(--radius-xl);
      }

      .ficha {
        display: flex;
        flex-direction: column;
        gap: var(--space-5);
        padding: var(--space-4);
        background: var(--bg-secondary);
        border: 1px solid var(--border-default);
        border-radius: var(--radius-2xl);
      }
      @media (min-width: 768px) {
        .ficha {
          gap: var(--space-6);
          padding: var(--space-6);
        }
      }
      .ficha__titulo {
        margin: 0;
        font-family: var(--font-display);
        font-size: var(--text-lg);
        font-weight: var(--font-semibold);
        line-height: var(--leading-snug);
      }
      .ficha__etiqueta {
        font-size: var(--text-xs);
        font-weight: var(--font-semibold);
        letter-spacing: var(--tracking-wide);
        text-transform: uppercase;
        color: var(--text-tertiary);
      }
      .ficha__campo {
        display: flex;
        flex-direction: column;
        gap: var(--space-2);
        min-width: 0;
      }
      .form-row {
        display: grid;
        gap: var(--space-4);
      }
      @media (min-width: 720px) {
        .form-row {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }
      }
      .form-field {
        display: flex;
        flex-direction: column;
        gap: var(--space-2);
        min-width: 0;
      }

      .ficha__aviso,
      .ficha__ayuda,
      .ficha__error {
        display: flex;
        align-items: flex-start;
        gap: var(--space-2);
        margin: 0;
        padding: var(--space-3) var(--space-4);
        font-size: var(--text-sm);
        line-height: var(--leading-relaxed);
        border-radius: var(--radius-lg);
        border-left: 3px solid var(--border-strong);
        background: var(--bg-tertiary);
        color: var(--text-primary);
      }
      .ficha__aviso {
        border-left-color: var(--warning);
        background: var(--warning-subtle);
      }
      .ficha__error {
        border-left-color: var(--error);
        background: var(--error-subtle);
        color: var(--error);
      }

      .ficha__acciones {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--space-2) var(--space-3);
        padding-top: var(--space-4);
        border-top: 1px solid var(--border-default);
      }
      .ficha__enlace {
        align-self: flex-start;
        padding: var(--space-1) 0;
        font: inherit;
        font-size: var(--text-sm);
        color: var(--primary);
        background: none;
        border: none;
        cursor: pointer;
        text-decoration: underline;
        text-underline-offset: 2px;
      }
      .ficha__enlace:hover {
        color: var(--text-primary);
      }
      .ficha__enlace:focus-visible {
        outline: 2px solid var(--primary);
        outline-offset: 2px;
        border-radius: var(--radius-sm);
      }

      .boton {
        box-sizing: border-box;
        display: inline-flex;
        align-items: center;
        gap: var(--space-2);
        height: var(--button-control-height);
        padding: var(--button-control-padding-block) var(--button-control-padding-inline);
        font: inherit;
        font-size: var(--button-control-font-size);
        line-height: var(--leading-none);
        font-weight: var(--font-medium);
        color: var(--text-primary);
        background: var(--bg-tertiary);
        border: 1px solid var(--border-default);
        border-radius: var(--radius-lg);
        cursor: pointer;
        transition: var(--transition-fast);
      }
      .boton:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }
      .boton--primario {
        color: var(--bg-secondary);
        background: var(--primary);
        border-color: transparent;
        font-weight: var(--font-semibold);
        margin-inline-start: auto;
      }
      .boton--peligro {
        color: var(--error);
        border-color: color-mix(in srgb, var(--error) 45%, transparent);
      }

      /* Las muestras conservan una zona táctil de 44 px aunque el círculo visible sea compacto. */
      .swatches {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--space-2);
      }
      .swatch {
        display: grid;
        place-items: center;
        flex: 0 0 44px;
        width: 44px;
        height: 44px;
        padding: 0;
        background: transparent;
        border: 0;
        border-radius: var(--radius-full);
        cursor: pointer;
      }
      .swatch__muestra {
        display: block;
        width: 28px;
        height: 28px;
        border: 1px solid var(--border-default);
        border-radius: var(--radius-full);
      }
      .swatch:hover .swatch__muestra {
        border-color: var(--border-strong);
      }
      .swatch:focus-visible {
        outline: 2px solid var(--primary);
        outline-offset: 2px;
      }
      .swatch--activa .swatch__muestra {
        box-shadow:
          0 0 0 2px var(--bg-secondary),
          0 0 0 4px var(--text-primary);
      }
      .selector-color {
        position: relative;
        flex: 0 0 100%;
        width: 100%;
        min-width: 0;
      }
      .selector-color:focus-within {
        outline: 2px solid var(--primary);
        outline-offset: 2px;
      }
      .selector-color__muestra {
        flex: 0 0 28px;
        width: 28px;
        height: 28px;
        border: 1px solid var(--border-strong);
        border-radius: var(--radius-sm);
      }
      .selector-color__valor {
        margin-inline-start: auto;
        color: var(--text-secondary);
        font-size: var(--text-sm);
        font-variant-numeric: tabular-nums;
      }
      .selector-color__input {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        opacity: 0;
      }

      /* Que un boton se pueda pulsar se nota sin tocarlo: hover y foco visible en todo lo que acepta un click
       (regla 8 del sistema), incluido el boton primario, que si no parece deshabilitado junto al resto. */
      .boton:hover:not(:disabled) {
        border-color: var(--border-strong);
        background: var(--bg-secondary);
      }
      .boton:focus-visible {
        outline: 2px solid var(--primary);
        outline-offset: 2px;
      }
      .boton--primario:hover:not(:disabled) {
        filter: brightness(1.06);
        background: var(--primary);
      }
      .boton--primario:focus-visible {
        outline: 2px solid var(--primary);
        outline-offset: 2px;
      }
      .boton--peligro:hover:not(:disabled) {
        color: var(--bg-secondary);
        background: var(--error);
        border-color: var(--error);
      }
      .boton--peligro:focus-visible {
        outline: 2px solid var(--error);
        outline-offset: 2px;
      }

      /* El lote (## 12ac): la barra de acciones sobre la seleccion, con el aviso de lo que no se puede. */
      /* Lote flotante (## 12ad, regla F): centrado abajo, por encima de la tarjeta y por debajo de la hoja
       de filtros (55/60). El «empuje» reserva la altura para que la ultima fila jamas quede tapada. */
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
      .gestor__buscar-tabla {
        max-width: 480px;
      }
      .lote__cta {
        display: inline-flex;
        align-items: center;
        gap: var(--space-2);
        flex-wrap: wrap;
        font-size: var(--text-xs);
        font-weight: var(--font-semibold);
        color: var(--text-primary);
      }
      .lote__nota {
        font-weight: var(--font-normal);
        color: var(--text-secondary);
      }
      .lote__acciones {
        display: flex;
        gap: var(--space-2);
        flex-wrap: wrap;
      }
      .lote__btn {
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
      .lote__btn:hover:not(:disabled) {
        border-color: var(--primary);
      }
      .lote__btn:disabled {
        opacity: 0.45;
        cursor: not-allowed;
      }
      .lote__btn:focus-visible {
        outline: 2px solid var(--primary);
        outline-offset: 2px;
      }
      .lote__btn--peligro {
        color: var(--error);
        border-color: color-mix(in srgb, var(--error) 45%, transparent);
      }
      .lote__btn--peligro:hover:not(:disabled) {
        color: var(--bg-secondary);
        background: var(--error);
        border-color: var(--error);
      }
      @media (max-width: 959px) {
        /* En movil el lote se queda pegado abajo: la seleccion no puede desaparecer al recorrer la tabla. */
        .lote {
          position: sticky;
          bottom: var(--space-2);
          box-shadow: var(--shadow-md);
        }
      }

      /* Las celdas proyectadas: punto, nombre, reserva y los botones de fila. */
      .celda--nombre {
        display: inline-flex;
        align-items: center;
        gap: var(--space-2);
        min-width: 0;
      }
      .celda__punto {
        flex: none;
        width: 10px;
        height: 10px;
        border-radius: var(--radius-full);
        box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.12);
      }
      .celda__nombre {
        font-weight: var(--font-medium);
        color: var(--text-primary);
        overflow: hidden;
        white-space: nowrap;
        text-overflow: ellipsis;
      }
      .celda--padre {
        color: var(--text-secondary);
        font-size: var(--text-sm);
      }
      .celda__grupo {
        display: inline-flex;
        gap: var(--space-1);
      }
      .celda__accion {
        display: grid;
        place-items: center;
        width: 32px;
        height: 32px;
        padding: 0;
        color: var(--text-secondary);
        background: none;
        border: none;
        cursor: pointer;
        border-radius: var(--radius-md);
        transition: var(--transition-fast);
      }
      .celda__accion:hover:not(:disabled) {
        color: var(--primary);
        background: color-mix(in srgb, var(--primary) 10%, transparent);
      }
      .celda__accion:focus-visible {
        outline: 2px solid var(--primary);
        outline-offset: 2px;
      }
      .celda__accion:disabled {
        opacity: 0.35;
        cursor: not-allowed;
      }
      .celda__accion--peligro:hover:not(:disabled) {
        color: var(--error);
        background: color-mix(in srgb, var(--error) 10%, transparent);
      }
    `
  ]
})
export class PantryCategoriesComponent implements OnInit {
  private readonly pantry = inject(PantryService);
  private readonly i18n = inject(I18nService);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly colorDeCategoria = colorDeCategoria;
  protected readonly muestras = [
    '#4CAF50',
    '#B26A00',
    '#E05A5A',
    '#4FA3D1',
    '#6C8AE4',
    '#C99A2E',
    '#8E5AC8',
    '#2FA79B'
  ];

  /** El catalogo de la casa completo, una sola vez: la tabla filtra, ordena y pagina sobre esto (## 12ac). */
  protected readonly lista = signal<PantryCategory[]>([]);
  protected readonly view = signal<PantryCategoryView>('all');
  protected readonly q = signal('');
  protected readonly seleccion = signal<readonly unknown[]>([]);
  protected ficha: PantryCategory | null = null;
  protected esNueva = false;
  protected cargando = true;
  protected guardando = false;
  protected error = '';
  protected formulario = { name: '', color: '', description: '', parentKey: '' };

  private readonly tablaCats = viewChild<DataTableComponent>('tablaCats');

  /** La cuenta se proyecta en la fila porque la tabla lee campos, no metodos: el menu de columna es honesto. */
  protected readonly filasTabla = computed<FilaCategoria[]>(() =>
    this.filtradas().map((fila) => ({
      ...fila,
      productos: fila.counts.products,
      subarbol: fila.counts.descendantProducts,
      subcategorias: fila.counts.children
    }))
  );

  /** Vista y busqueda en memoria, con la semantica exacta del server: `q` casa nombre o clave normalizados. */
  protected readonly filtradas = computed<PantryCategory[]>(() => {
    const vista = this.view();
    const consulta = this.q();
    let filas = this.lista();
    if (vista === 'without-products') filas = filas.filter((fila) => fila.counts.products === 0);
    else if (vista === 'with-children') filas = filas.filter((fila) => fila.counts.children > 0);
    if (consulta.trim())
      filas = filas.filter((fila) => coincideGestor([fila.name, fila.key], consulta));
    return filas;
  });

  protected readonly borrables = computed<PantryCategory[]>(() =>
    this.seleccion().filter((fila): fila is FilaCategoria => (fila as FilaCategoria).canDelete)
  );
  protected readonly noBorrables = computed<number>(
    () => this.seleccion().length - this.borrables().length
  );

  protected readonly columnas = computed<DataTableColumna[]>(() => {
    this.i18n.changeTick();
    return [
      { clave: 'name', etiqueta: this.i18n.t('pantry.columna_nombre'), celda: 'nombre' },
      {
        clave: 'parentKey',
        etiqueta: this.i18n.t('pantry.padre_categoria'),
        celda: 'padre',
        etiquetaValor: (v) => this.etiquetaClave(String(v))
      },
      { clave: 'productos', etiqueta: this.i18n.t('pantry.columna_productos'), tipo: 'numero' },
      { clave: 'subarbol', etiqueta: this.i18n.t('pantry.columna_subarbol'), tipo: 'numero' },
      {
        clave: 'subcategorias',
        etiqueta: this.i18n.t('pantry.columna_subcategorias'),
        tipo: 'numero'
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

  protected readonly etiquetaFila = (fila: unknown): string => {
    const cat = fila as PantryCategory;
    return pantryCategoryLabel(cat, (key) => this.i18n.t(key));
  };

  protected get vistas(): {
    value: PantryCategoryView;
    clave:
      | 'pantry.categorias_todas'
      | 'pantry.categorias_sin_productos'
      | 'pantry.categorias_con_subcategorias';
  }[] {
    return [
      { value: 'all', clave: 'pantry.categorias_todas' },
      { value: 'without-products', clave: 'pantry.categorias_sin_productos' },
      { value: 'with-children', clave: 'pantry.categorias_con_subcategorias' }
    ];
  }

  ngOnInit(): void {
    this.pantry.loadCategories();
    // Lo mismo que en productos: la query es el estado, y al entrar se lee. `view` es el nombre que comparte con
    // el servidor para las vistas, no un detalle interno de la URL. `?offset=` se jubilo con el paginador server.
    const query = this.route.snapshot.queryParamMap;
    this.view.set(
      valorDeQuery(query, 'view', ['all', 'without-products', 'with-children'] as const, 'all')
    );
    this.q.set(valorDeQuery(query, 'q', null, ''));
    const id = this.route.snapshot.paramMap.get('id');
    if (id) this.abrirFicha(id);
    else void this.refrescar();
  }

  // ── lista ──

  /**
   * Carga el arbol entero de 100 en 100 (tope 2.000, el mismo del visor). Los recuentos los pone el server en
   * cada fila, asi que «todo en memoria» no significa calcular aqui lo que no se puede saber desde aqui.
   */
  private async refrescar(): Promise<void> {
    this.cargando = true;
    const filas = await cargarTodasLasPaginas<PantryCategory>(
      (offset, tamano) => this.pantry.listCategories('all', '', tamano, offset),
      100,
      2000
    );
    if (filas === null) {
      // Media lista mudaria mentiria mas que un error a la cara: se dice, y no se pinta tabla.
      this.error = this.i18n.t('ui.ha_ocurrido_un_error');
      this.lista.set([]);
    } else {
      this.error = '';
      this.lista.set(filas);
    }
    this.seleccion.set([]);
    this.cargando = false;
  }

  /** Cambiar de vista es mirar otra vez lo mismo: no hay recarga, la filtro yo en memoria. */
  protected cambiarVista(value: PantryCategoryView): void {
    this.view.set(value);
    this.loteAnular();
    void this.escribirUrl();
  }

  protected buscar(valor: string): void {
    this.q.set(valor ?? '');
    void this.escribirUrl();
  }

  protected loteAnular(): void {
    this.seleccion.set([]);
    this.tablaCats()?.limpiarSeleccion();
  }

  /**
   * El estado de la pantalla vive en la URL, no solo en el componente. Es lo que hace que un F5, el boton atras
   * del navegador y compartir el enlace den la misma lista —y lo que Basketra comprueba en sus specs de
   * navegador—, y a diferencia de `localStorage` no deja la sorpresa de «por que mi lista aparece filtrada».
   */
  private async escribirUrl(): Promise<void> {
    // `['../']` relativo, desde la LISTA, dependía de cómo Angular subiera un tramo por encima de una ruta sin
    // params: según eso era no-op o era un salto que desmontaba la pantalla —y las dos lecturas explican cosas
    // distintas del CI de la tanda 29, que es justo el problema de navegar «hacia arriba» en vez de «a casa».
    // El estado se escribe sobre la URL propia, absoluta; cerrar la ficha es otro paso (salvar/borrar) y no
    // pasa por aqui desde la Tanda 28.
    await this.router.navigate(['/pantry/categories'], {
      relativeTo: this.route,
      queryParams: { view: this.view() === 'all' ? null : this.view(), q: this.q().trim() || null },
      replaceUrl: this.ficha === null
    });
  }

  protected etiquetaClave(clave: string | null): string {
    if (!clave) return '';
    const fila = this.pantry.categoryByKey(clave);
    return pantryCategoryLabel(fila ?? { key: clave }, (key) => this.i18n.t(key));
  }

  /**
   * El lote de categorias es un bucle de DELETE con la regla del server por delante: solo se intentan las
   * `canDelete`, las demas se anuncian en la propia confirmacion (el «no» se ensena antes de pulsar, no
   * despues), y el recuento de lo que se borro y de lo que fallo sale en el mismo toast. Cada DELETE es
   * individual porque `other` (reservada) y las categorias con contenido tienen vetos distintos que solo el
   * server sabe aplicar; un lote no puede esconderlos detras de un todo-o-nada que no existe en la API.
   */
  protected async borrarLote(): Promise<void> {
    const objetivo = this.borrables();
    if (objetivo.length === 0) return;
    const saltan = this.noBorrables();
    const aceptado = await this.confirm.confirm({
      title: this.i18n.t('pantry.borrar_seleccionados'),
      message:
        this.i18n.t('pantry.categorias_lote_pregunta', { n: objetivo.length }) +
        (saltan > 0 ? ` ${this.i18n.t('pantry.categorias_lote_saltan', { n: saltan })}` : ''),
      confirmText: this.i18n.t('common.delete'),
      cancelText: this.i18n.t('common.cancel'),
      variant: 'danger'
    });
    if (!aceptado) return;
    this.guardando = true;
    let borradas = 0;
    let fallidas = 0;
    for (const fila of objetivo) {
      const resultado = await this.pantry.deleteCategory(fila.id);
      if (resultado.ok) borradas++;
      else fallidas++;
    }
    this.guardando = false;
    this.pantry.loadCategories(true);
    await this.refrescar();
    if (borradas === 0) {
      this.toast.error(this.i18n.t('ui.no_se_ha_podido'));
      return;
    }
    this.toast.success(
      this.i18n.t(borradas === 1 ? 'pantry.categoria_borrada' : 'pantry.n_categorias_borradas', {
        n: borradas
      }),
      fallidas > 0 ? this.i18n.t('pantry.categorias_lote_fallidas', { n: fallidas }) : undefined
    );
  }

  // ── ficha ──

  protected abrir(fila: PantryCategory): void {
    void this.router.navigate([fila.id], { relativeTo: this.route });
  }

  protected abrirNueva(): void {
    void this.router.navigate(['new'], { relativeTo: this.route });
  }

  private async abrirFicha(id: string): Promise<void> {
    this.esNueva = id === 'new';
    if (this.esNueva) {
      this.ficha = {
        id: '',
        key: '',
        name: '',
        color: '',
        description: null,
        parentKey: null,
        parentName: null,
        position: 0,
        counts: { products: 0, children: 0, descendantProducts: 0 },
        protected: false,
        canDelete: false
      };
      this.formulario = { name: '', color: '', description: '', parentKey: '' };
      await this.seleccionarPadreDeQuery();
      return;
    }
    const catalogo = this.pantry.categories();
    const encontrada =
      catalogo.find((fila) => fila.id === id) ?? (await this.buscarEnServidor(id, 0));
    if (!encontrada) {
      await this.router.navigate(['../'], { relativeTo: this.route });
      return;
    }
    this.ficha = encontrada;
    this.formulario = {
      name: encontrada.name,
      color: encontrada.color,
      description: encontrada.description ?? '',
      parentKey: encontrada.parentKey ?? ''
    };
  }

  /** Un F5 en la ficha no puede depender de que el catalogo quepa en la primera pagina: se pide por su sitio. */
  private async buscarEnServidor(id: string, pagina: number): Promise<PantryCategory | null> {
    const resultado = await this.pantry.listCategories('all', '', 100, pagina * 100);
    const fila = resultado?.data.find((candidata) => candidata.id === id) ?? null;
    if (fila || !resultado || resultado.data.length < 100) return fila;
    return this.buscarEnServidor(id, pagina + 1);
  }

  protected opcionesPadre(): PickerOption[] {
    const categorias = this.categoriasDisponibles();
    const prohibidas = clavesNoElegiblesComoPadre(
      categorias,
      this.esNueva ? null : (this.ficha?.id ?? null)
    );
    return categorias
      .filter((fila) => !prohibidas.has(fila.key))
      .map((fila) => ({
        value: fila.key,
        label: pantryCategoryLabel(fila, (key) => this.i18n.t(key)),
        color: fila.color,
        group: fila.parentName
          ? pantryCategoryLabel({ key: fila.parentKey, name: fila.parentName }, (key) =>
              this.i18n.t(key)
            )
          : undefined
      }));
  }

  /** La query propone un padre, pero solo se acepta si existe y mantiene el límite del árbol. */
  private async seleccionarPadreDeQuery(): Promise<void> {
    const solicitado = this.route.snapshot.queryParamMap.get('parent');
    if (!solicitado?.trim()) return;
    const categorias = await cargarTodasLasPaginas<PantryCategory>(
      (offset, tamano) => this.pantry.listCategories('all', '', tamano, offset),
      100,
      2000
    );
    if (!categorias) return;
    this.lista.set(categorias);
    const padre = padreDeCategoriaDesdeQuery(solicitado, categorias);
    if (!padre) return;
    this.formulario.parentKey = padre;
    if (this.comprobarFormaDelArbol(categorias)) this.formulario.parentKey = '';
  }

  private categoriasDisponibles(): PantryCategory[] {
    const cargadas = this.lista();
    return cargadas.length > 0 ? cargadas : this.pantry.categories();
  }

  /**
   * Las dos comprobaciones estructurales, hechas en la pantalla antes de llamar al server.
   *
   * No son confianza de mas: `assertPlacement` del server ya las hace, y las hara aunque esta funcione mal —la
   * unica garantia que cuenta es la de ahi—, pero lo que se evita aqui es que la persona guarde, espere y vea un
   * 400 escrito en el idioma del log. Y el techo de cuatro niveles es de los que se saltan sin darse cuenta: la
   * lista se ve bien, lo que ya no cabe es la pantalla.
   */
  private comprobarFormaDelArbol(categorias = this.categoriasDisponibles()): string | null {
    const padre = this.formulario.parentKey.trim();
    if (!padre) return null;
    const propia = this.esNueva ? null : (this.ficha?.key ?? null);
    if (propia && padre === propia) return this.i18n.t('pantry.error_ciclo');
    let cadena = padre;
    const vistas = new Set<string>();
    let profundidadPadre = 0;
    while (cadena && !vistas.has(cadena)) {
      vistas.add(cadena);
      profundidadPadre++;
      if (propia && cadena === propia) return this.i18n.t('pantry.error_ciclo');
      cadena = categorias.find((categoria) => categoria.key === cadena)?.parentKey ?? '';
    }
    if (profundidadPadre + this.altura(propia ?? '', categorias) > 4)
      return this.i18n.t('pantry.error_profundidad');
    return null;
  }

  private altura(clave: string, categorias = this.categoriasDisponibles()): number {
    if (!clave) return 1;
    const hijas = categorias.filter((fila) => fila.parentKey === clave);
    return (
      1 +
      (hijas.length > 0 ? Math.max(...hijas.map((hija) => this.altura(hija.key, categorias))) : 0)
    );
  }

  protected pintar(color: string): void {
    this.formulario.color = normalizarColorSeleccionado(color) ?? '';
  }

  protected quitarPadre(): void {
    this.formulario.parentKey = '';
  }

  /** `null` es el hueco del picker: aqui significa «sin padre», que es justo lo que el server espera. */
  protected elegirPadre(valor: string | null): void {
    this.formulario.parentKey = valor ?? '';
  }

  protected async guardar(): Promise<void> {
    const nombre = this.formulario.name.trim();
    this.error = '';
    if (!nombre) {
      this.error = this.i18n.t('pantry.el_nombre_es_requerido');
      return;
    }
    const antesDelCambio = this.comprobarFormaDelArbol();
    if (antesDelCambio) {
      this.error = antesDelCambio;
      return;
    }
    const color = normalizarColorSeleccionado(this.formulario.color) ?? '';
    const entrada = {
      name: nombre,
      color: color || null,
      description: this.formulario.description.trim() || null,
      parentKey: this.formulario.parentKey.trim() || null
    };
    // El PATCH del server distingue «tocar estructura» de «pintar y anotar» por lo que trae el payload
    // (`'parentKey' in input`, nombre no vacio): reenviar la forma entera convertia cualquier anotacion de la
    // reserva en un 409 y al guardado de cualquiera en un `rename` fantasma. En la edicion se manda el diff —
    // lo mismo que ve el contrato de la ## 12x; el alta, como no hay con que comparar, sigue entera—.
    const original = this.ficha;
    const cambios: Partial<typeof entrada> = {};
    if (original) {
      if (nombre !== original.name) cambios.name = nombre;
      const colorFinal = color || null;
      const colorAntes = normalizarColorSeleccionado(original.color);
      if (colorFinal !== colorAntes) cambios.color = colorFinal;
      const descripcion = this.formulario.description.trim() || null;
      if (descripcion !== (original.description ?? null)) cambios.description = descripcion;
      const padre = this.formulario.parentKey.trim() || null;
      if (padre !== (original.parentKey ?? null)) cambios.parentKey = padre;
      if (Object.keys(cambios).length === 0) {
        // Nada que guardar: se cierra la ficha sin pasar por el server, que un 200 de una operacion vacia
        // contaria como exito algo que no ha tocado nada.
        await this.volver();
        return;
      }
    }
    const payload = this.esNueva || !original ? entrada : cambios;
    this.guardando = true;
    const resultado = this.esNueva
      ? await this.pantry.createCategory(entrada)
      : await this.pantry.updateCategory(original!.id, payload);
    this.guardando = false;
    if (!resultado.ok) {
      this.error = this.frase(resultado.error, resultado.message, color);
      return;
    }
    this.toast.success(
      this.i18n.t(this.esNueva ? 'pantry.categoria_creada' : 'pantry.categoria_guardada')
    );
    await this.volver();
  }

  /** El codigo del server, en la frase del idioma activo. El `message` del server solo vale de respaldo. */
  private frase(codigo: string, message: string, color: string): string {
    const t = (clave: Parameters<I18nService['t']>[0]) => this.i18n.t(clave);
    switch (codigo) {
      case 'PANTRY_CATEGORY_EXISTS':
        return t('pantry.error_nombre_repetido');
      case 'PANTRY_CATEGORY_PROTECTED':
        return t('pantry.error_reservada');
      case 'PANTRY_CATEGORY_PARENT_NOT_FOUND':
        return t('pantry.error_padre_no_existe');
      case 'PANTRY_CATEGORY_IN_USE':
        return t('pantry.error_en_uso');
      case 'PANTRY_CATEGORY_INVALID':
        return !color || /^#[0-9a-fA-F]{6}$/.test(color)
          ? message || t('ui.datos_de_entrada_invalidos')
          : t('pantry.error_color_invalido');
      case 'NETWORK':
        return t('ui.sin_conexion');
      default:
        return message || t('ui.no_se_ha_podido');
    }
  }

  protected async borrar(fila: PantryCategory): Promise<void> {
    const etiqueta = pantryCategoryLabel(fila, (key) => this.i18n.t(key));
    const impacto = await this.pantry.categoryImpact(fila.id);
    if (impacto && !impacto.canDelete) {
      // No se abre un dialogo para decir «no»: se dice con los numeros, que son la unica informacion que sirve.
      this.toast.warning(
        this.i18n.t('pantry.error_en_uso'),
        this.i18n.t('pantry.impacto_borrar_categoria', {
          articulos: this.i18n.t('pantry.cuenta_articulos', { n: impacto.products }),
          subcategorias: this.i18n.t('pantry.cuenta_subcategorias', { n: impacto.children })
        })
      );
      return;
    }
    const aceptado = await this.confirm.confirm({
      title: this.i18n.t('pantry.eliminar_categoria'),
      message: this.i18n.t('pantry.confirmar_borrar_categoria', { name: etiqueta }),
      confirmText: this.i18n.t('common.delete'),
      cancelText: this.i18n.t('common.cancel'),
      variant: 'danger'
    });
    if (!aceptado) return;
    const resultado = await this.pantry.deleteCategory(fila.id);
    if (!resultado.ok) {
      this.toast.error(
        this.i18n.t('ui.no_se_ha_podido'),
        this.frase(resultado.error, resultado.message, '')
      );
      return;
    }
    this.toast.success(this.i18n.t('pantry.categoria_borrada'));
    if (this.ficha) await this.volver();
    else await this.refrescar();
  }

  /**
   * Volver. El boton vive en la cabecera de las DOS pantallas, o sea que las dos tienen que llevar a algun
   * lado: de la ficha a la lista, y de la lista al inventario. Antes estaba guardado por «esto es una ficha?»,
   * que en la lista es falso, y el resultado era un boton que no hacia nada —lo que se oyo fue «el boton de
   * volver al inventario no funciona»—. Se decide por la URL (existe el segmento `:id`?), no por el estado:
   * `ficha` se muda durante el guardado y del borrado, y «volver» tiene que significar lo mismo en los dos
   * momentos de la misma pantalla.
   */
  protected async volver(): Promise<void> {
    if (this.route.snapshot.paramMap.has('id')) {
      await this.router.navigate(['../'], { relativeTo: this.route });
      return;
    }
    await this.router.navigate(['/pantry']);
  }
}
