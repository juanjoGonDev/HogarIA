import { Component, DestroyRef, OnInit, computed, inject, signal, viewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';

import { PantryService } from '../../core/services/pantry.service';
import { ToastService } from '../../core/services/toast.service';
import { ConfirmService } from '../../core/services/confirm.service';
import { I18nService } from '../../core/services/i18n.service';
import { TranslatePipe } from '../../core/pipes/translate.pipe';
import { IconComponent } from '../../shared/components/ui/icon/icon.component';
import { TooltipComponent } from '../../shared/components/ui/tooltip/tooltip.component';
import { InputComponent } from '../../shared/components/ui/input/input.component';
import { TagComponent } from '../../shared/components/ui/tag/tag.component';
import { FilterTagComponent } from '../../shared/components/ui/tag/filter-tag.component';
import { BadgeComponent } from '../../shared/components/ui/badge/badge.component';
import {
  PickerComponent,
  type PickerOption
} from '../../shared/components/ui/picker/picker.component';
import {
  DataTableComponent,
  DataTableCellDirective
} from '../../shared/components/ui/data-table/data-table.component';
import type { DataTableColumna } from '../../shared/components/ui/data-table/data-table.types';
import { pantryCategoryLabel } from '../../core/i18n/labels';
import { daysUntil } from '../../core/time';
import type {
  MeasurementUnit,
  PantryProduct,
  PantryProductFilter,
  PantryRequest
} from '../../shared/models/pantry.model';
import {
  aliasVisibles,
  cargarTodasLasPaginas,
  caducaEnTresDias,
  coincideGestor,
  colorDeCategoria,
  normalizarAlias,
  valorDeQuery
} from './pantry-gestor.util';

type FilaProducto = PantryProduct & { listLines: number };

/**
 * El gestor de productos principales (HOGARIA-SPEC ## 12x).
 *
 * «Producto principal», en HogarIA, es una fila de la despensa con `quantity = 0`: algo que la casa conoce y
 * que ahora mismo no tiene. No se ha creado una tabla para esto porque no hacia falta un dato nuevo, hacia
 * falta una pantalla donde gestionarlos. De ahi las dos reglas que dan forma a la interfaz:
 *
 *  - **registrar no es comprar.** El alta deja la cantidad en 0, y por eso la cantidad solo se puede poner al
 *    crear y desde aqui se avisa de lo que significa; lo que hay dentro de la despensa se mueve en la despensa,
 *    con sus motivos de cambio, no desde una ficha del catalogo;
 *  - **borrar la ficha no borra la historia.** Las lineas de la cesta y las observaciones de precio guardan su
 *    propia copia del nombre y de la clave, asi que se puede quitar un basico del catalogo sin perder el martes
 *    en que se compro; lo que si bloquea el borrado es tener unidades dentro, y eso se dice con el numero.
 *
 * Como el de las categorias, son dos rutas y una clase, y la ficha vive en su URL para que un F5 no la
 * desperdicie. La lista, desde la tanda 31 (## 12ac), es la `app-data-table` del visor sobre el catalogo
 * completo en memoria: los chips de vista y la busqueda se aplican aqui —con la semantica del server, que es la
 * que la casa prometi6—, y `?sort=` y el paginador server-side se jubilan: ordenar y paginar es cosa de la tabla.
 */
@Component({
  selector: 'app-pantry-products',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    TranslatePipe,
    IconComponent,
    InputComponent,
    TagComponent,
    FilterTagComponent,
    BadgeComponent,
    PickerComponent,
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
          data-test="gestor-productos-volver"
        >
          <app-icon name="chevron_left" [size]="20" [label]="null" />
          <span>{{ 'pantry.volver_al_inventario' | t }}</span>
        </button>
        <h1 class="gestor__title">{{ 'pantry.gestor_productos' | t }}</h1>
        <p class="gestor__ayuda">{{ 'pantry.gestor_productos_ayuda' | t }}</p>
      </header>

      @if (!ficha) {
        <section class="gestor__toolbar" data-test="gestor-productos-lista">
          <div class="gestor__vistas">
            @for (opcion of filtros; track opcion.value) {
              <app-filter-tag
                [selected]="filtro() === opcion.value"
                (onClick)="cambiarFiltro(opcion.value)"
                [attr.data-test]="'gestor-productos-filtro-' + opcion.value"
              >
                {{ opcion.clave | t }}
              </app-filter-tag>
            }
          </div>

          <button
            type="button"
            class="gestor__nueva"
            (click)="abrirNueva()"
            data-test="gestor-productos-nueva"
          >
            <app-icon name="add" [size]="18" [label]="null" />
            <span>{{ 'pantry.registrar_producto' | t }}</span>
          </button>
        </section>

        @if (cargando) {
          <p class="gestor__estado">{{ 'common.loading' | t }}</p>
        } @else if (lista().length === 0) {
          <p class="gestor__estado" data-test="gestor-productos-vacia">
            {{ 'pantry.productos_vacios' | t }}
          </p>
        } @else {
          <app-data-table
            #tablaProd
            data-test="gestor-productos-tabla"
            [filas]="filasTabla()"
            [columnas]="columnas()"
            [seleccionable]="true"
            [etiquetaDeFila]="etiquetaFila"
            (seleccionChange)="seleccion.set($event)"
          >
            <div data-tabla-buscar>
              <app-input
                class="gestor__buscar"
                id="gestor-productos-q"
                name="gestor-productos-q"
                type="search"
                [placeholder]="'pantry.buscar_productos' | t"
                [ngModel]="q()"
                (ngModelChange)="buscar($event)"
              ></app-input>
            </div>
            <div data-tabla-lote>
              @if (seleccion().length > 0) {
                <div class="lote" data-test="gestor-productos-lote">
                  <span class="lote__cta">{{
                    'pantry.seleccionados' | t: { n: seleccion().length }
                  }}</span>
                  <span class="lote__acciones">
                    <button
                      type="button"
                      class="lote__btn lote__btn--peligro"
                      [disabled]="guardando"
                      (click)="borrarLote()"
                      data-test="gestor-productos-lote-borrar"
                    >
                      {{ 'pantry.borrar_seleccionados' | t }}
                    </button>
                    <app-tooltip position="top" [text]="'pantry.lote_anular' | t">
                      <button
                        type="button"
                        class="lote__x"
                        (click)="loteAnular()"
                        data-test="gestor-productos-lote-anular"
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
                [attr.data-test]="'gestor-productos-fila-' + fila.id"
              >
                <span class="celda__nombre">{{ fila.name }}</span>
                @for (alias of aliasVisibles(fila.aliases).visibles; track alias) {
                  <span class="celda__alias">{{ alias }}</span>
                }
                @if (aliasVisibles(fila.aliases).ocultos > 0) {
                  <span class="celda__alias celda__alias--mas"
                    >+{{ aliasVisibles(fila.aliases).ocultos }}</span
                  >
                }
              </span>
            </ng-template>

            <ng-template appDataTableCell="categoria" let-fila>
              <span class="celda celda--categoria">
                <span
                  class="celda__punto"
                  [style.background]="colorDeCategoria(catalogo.get(fila.category))"
                  aria-hidden="true"
                ></span>
                {{ etiquetaCategoria(fila.category) }}
              </span>
            </ng-template>

            <ng-template appDataTableCell="stock" let-fila>
              @if (fila.inPantry) {
                <span class="celda celda--stock">{{ fila.quantity }} {{ fila.unit }}</span>
              } @else {
                <span class="celda celda--guion" aria-hidden="true">—</span>
              }
            </ng-template>

            <ng-template appDataTableCell="caducidad" let-fila>
              @if (fila.expirationDate) {
                <span class="celda-caducidad">
                  <span class="celda">{{ fila.expirationDate | date: 'dd/MM/yyyy' }}</span>
                  @if (estado(fila); as e) {
                    <app-badge [variant]="e.variant" size="sm">{{ e.label }}</app-badge>
                  }
                </span>
              } @else {
                <span class="celda celda--guion" aria-hidden="true">—</span>
              }
            </ng-template>

            <ng-template appDataTableCell="acciones" let-fila>
              <span class="celda__grupo">
                <app-tooltip position="top" [text]="'pantry.editar_producto' | t">
                  <button
                    type="button"
                    class="celda__accion"
                    [attr.aria-label]="'pantry.editar_producto' | t"
                    (click)="abrir(fila)"
                    [attr.data-test]="'gestor-productos-editar-' + fila.id"
                  >
                    <app-icon name="edit" [size]="16" [label]="null" />
                  </button>
                </app-tooltip>
                <app-tooltip
                  position="top"
                  [text]="
                    fila.inPantry
                      ? ('pantry.error_en_despensa' | t: { cantidad: fila.quantity })
                      : ('pantry.eliminar_producto' | t)
                  "
                >
                  <button
                    type="button"
                    class="celda__accion celda__accion--peligro"
                    [attr.aria-label]="'pantry.eliminar_producto' | t"
                    [disabled]="fila.inPantry || guardando"
                    (click)="borrar(fila)"
                    [attr.data-test]="'gestor-productos-borrar-' + fila.id"
                  >
                    <app-icon name="delete" [size]="16" [label]="null" />
                  </button>
                </app-tooltip>
              </span>
            </ng-template>
          </app-data-table>
        }
      } @else {
        <section class="ficha" data-test="gestor-productos-ficha">
          <div class="ficha__cabecera">
            <h2 class="ficha__titulo">
              {{ (esNueva ? 'pantry.nuevo_producto' : 'pantry.ficha_producto') | t }}
            </h2>
            @if (!esNueva) {
              <button
                type="button"
                class="ficha__enlace"
                (click)="verEnLaDespensa()"
                data-test="gestor-productos-ver-despensa"
              >
                {{ 'pantry.ver_en_la_despensa' | t }}
              </button>
            }
          </div>
          <app-input
            id="gestor-producto-nombre"
            name="gestor-producto-nombre"
            type="text"
            [label]="'pantry.producto_nombre' | t"
            [required]="true"
            [error]="errorNombre"
            [(ngModel)]="formulario.name"
            data-test="gestor-productos-campo-nombre"
          ></app-input>

          <div class="form-row">
            <div class="form-field">
              <span class="ficha__etiqueta">{{ 'pantry.categoria' | t }}</span>
              <app-picker
                [options]="opcionesCategoria()"
                [value]="formulario.category"
                (valueChange)="elegirCategoria($event)"
                data-test="gestor-productos-campo-categoria"
              />
            </div>
            <div class="form-field">
              <span class="ficha__etiqueta">{{ 'pantry.unidad_producto' | t }}</span>
              <app-picker
                [options]="opcionesUnidad"
                [value]="formulario.unit"
                (valueChange)="elegirUnidad($event)"
                data-test="gestor-productos-campo-unidad"
              />
            </div>
          </div>

          <div class="form-row">
            <app-input
              *ngIf="esNueva"
              id="gestor-producto-cantidad"
              name="gestor-producto-cantidad"
              type="number"
              [label]="'pantry.cantidad_inicial' | t"
              [helper]="'pantry.cantidad_inicial_ayuda' | t"
              [(ngModel)]="formulario.quantity"
              data-test="gestor-productos-campo-cantidad"
            ></app-input>

            <app-input
              id="gestor-producto-caducidad"
              name="gestor-producto-caducidad"
              type="date"
              [label]="'pantry.caducidad_producto' | t"
              [(ngModel)]="formulario.expirationDate"
              data-test="gestor-productos-campo-caducidad"
            ></app-input>
          </div>

          <app-input
            id="gestor-producto-nota"
            name="gestor-producto-nota"
            type="text"
            [label]="'pantry.notas_producto' | t"
            [(ngModel)]="formulario.notes"
            data-test="gestor-productos-campo-nota"
          ></app-input>

          <div class="ficha__campo">
            <span class="ficha__etiqueta">{{ 'pantry.aliases' | t }}</span>
            <p class="ficha__ayuda">{{ 'pantry.aliases_ayuda' | t }}</p>
            <div class="alias" *ngIf="formulario.aliases.length > 0">
              @for (alias of formulario.aliases; track alias) {
                <!-- El botoncito de quitar lo nombra el propio tag con su clave ui.remove_tag: no hace falta repetirlo
                   aqui, y un backtick en un comentario de estos cierra el template literal antes de tiempo. -->
                <app-tag [removable]="true" (onRemove)="quitarAlias(alias)">{{ alias }}</app-tag>
              }
            </div>
            <div class="alias__nuevo">
              <app-input
                id="gestor-producto-alias"
                name="gestor-producto-alias"
                type="text"
                [placeholder]="'pantry.anadir_alias' | t"
                [(ngModel)]="aliasNuevo"
              ></app-input>
              <button
                type="button"
                class="boton"
                (click)="anadirAlias()"
                data-test="gestor-productos-anadir-alias"
              >
                {{ 'pantry.anadir_alias' | t }}
              </button>
            </div>
          </div>

          @if (!esNueva) {
            <p class="ficha__cifras" data-test="gestor-productos-impacto">
              <span>{{ 'pantry.lineas_de_cesta' | t: { n: ficha.impact.listLines } }}</span>
              <span>{{
                'pantry.observaciones_precio' | t: { n: ficha.impact.priceObservations }
              }}</span>
              <span *ngIf="ficha.inPantry">{{
                'pantry.en_despensa_cantidad' | t: { cantidad: ficha.quantity + ' ' + ficha.unit }
              }}</span>
            </p>
          }

          @if (error) {
            <p class="ficha__error" role="alert" data-test="gestor-productos-error">{{ error }}</p>
          }

          <div class="ficha__acciones">
            <button
              type="button"
              class="boton boton--primario"
              [disabled]="guardando"
              (click)="guardar()"
              data-test="gestor-productos-guardar"
            >
              {{ (esNueva ? 'pantry.registrar_producto' : 'pantry.guardar_producto') | t }}
            </button>
            @if (!esNueva) {
              <button
                type="button"
                class="boton boton--peligro"
                [disabled]="ficha.inPantry"
                (click)="borrar(ficha)"
                data-test="gestor-productos-eliminar"
              >
                {{ 'pantry.eliminar_producto' | t }}
              </button>
            }
            <button
              type="button"
              class="boton"
              (click)="volver()"
              data-test="gestor-productos-cancelar"
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

      /* Una sola tarjeta con filas separadas por un hilo, en vez de fichitas con dos pixeles de hueco: es lo que
       hace que el ojo recorra la columna de numeros sin perder el sitio. */

      @media (min-width: 860px) {
        /* Y a partir de aqui, columnas de verdad: los numeros se alinean entre filas porque el grid las declara,
         no porque a cada texto le quepa su hueco. */
        .fila__cuerpo {
          display: grid;
          flex-wrap: nowrap;
          gap: var(--space-6);
        }
      }

      /* La ficha es un formulario, no una lista de campos pegados: una tarjeta con padding generoso, campos con
    su microetiqueta y dos columnas cuando el ancho lo permite. */
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

      /* Pistas de la fila: nombre, la linea de etiquetas y el impacto. El nombre no puede comerse el ancho de
       las etiquetas, y el impacto se queda a la derecha del todo en todas las filas. */
      @media (min-width: 860px) {
        .fila__cuerpo {
          grid-template-columns: minmax(0, 0.9fr) minmax(0, 1.6fr) auto;
        }
      }

      /* Cada dato de la fila es una etiqueta, y las etiquetas se pintan igual en las dos pantallas: relleno
       redondeado, numero tabular y un hueco constante entre ellas. */
      @media (min-width: 860px) {
        .fila__impacto {
          margin-left: 0;
        }
      }

      .ficha__cabecera {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: var(--space-2) var(--space-4);
        padding-bottom: var(--space-4);
        border-bottom: 1px solid var(--border-default);
      }
      .ficha__cifras {
        display: flex;
        flex-wrap: wrap;
        gap: var(--space-2) var(--space-4);
        margin: 0;
        color: var(--text-secondary);
        font-size: var(--text-sm);
      }
      .ficha__cifras span {
        padding: var(--space-1) var(--space-3);
        background: var(--bg-tertiary);
        border-radius: var(--radius-full);
      }

      /* El editor de alias: lo que hay dentro, y debajo la forma de anadir uno. Sin relleno, los dos se leen como
       un mismo campo y nadie encuentra el boton. */
      .alias {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--space-2);
      }
      .alias__nuevo {
        display: flex;
        flex-wrap: wrap;
        align-items: end;
        gap: var(--space-2);
        padding: var(--space-3);
        background: var(--bg-tertiary);
        border-radius: var(--radius-lg);
      }
      .alias__nuevo app-input {
        flex: 1 1 200px;
        min-width: 160px;
      }
      .gestor__orden {
        flex: 0 0 auto;
        min-width: 190px;
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

      /* El lote (## 12ac): igual que en el visor y en categorias —una sola barra, tres gestores—. */
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
        font-size: var(--text-xs);
        font-weight: var(--font-semibold);
        color: var(--text-primary);
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

      /* Las celdas proyectadas: nombre con alias, categoria con punto, stock, caducidad y acciones de fila. */
      .celda--nombre {
        display: inline-flex;
        align-items: center;
        gap: var(--space-2);
        min-width: 0;
        flex-wrap: wrap;
      }
      .celda__nombre {
        font-weight: var(--font-medium);
        color: var(--text-primary);
      }
      .celda__alias {
        font-size: var(--text-xs);
        color: var(--text-secondary);
        background: var(--bg-tertiary);
        border-radius: var(--radius-full);
        padding: 1px var(--space-2);
        white-space: nowrap;
      }
      .celda__alias--mas {
        background: none;
        padding: 0;
      }
      .celda--categoria {
        display: inline-flex;
        align-items: center;
        gap: var(--space-2);
        color: var(--text-secondary);
      }
      .celda__punto {
        flex: none;
        width: 8px;
        height: 8px;
        border-radius: var(--radius-full);
        box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.12);
      }
      .celda--stock {
        font-variant-numeric: tabular-nums;
        color: var(--text-primary);
      }
      .celda-caducidad {
        display: inline-flex;
        align-items: center;
        gap: var(--space-2);
        flex-wrap: wrap;
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
export class PantryProductsComponent implements OnInit {
  private readonly pantry = inject(PantryService);
  private readonly i18n = inject(I18nService);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly colorDeCategoria = colorDeCategoria;
  protected readonly aliasVisibles = aliasVisibles;

  /** El catalogo de productos de la casa, completo y una sola vez: la tabla hace el resto (## 12ac). */
  protected readonly lista = signal<PantryProduct[]>([]);
  protected readonly filtro = signal<PantryProductFilter>('staples');
  protected readonly q = signal('');
  protected readonly seleccion = signal<readonly unknown[]>([]);
  protected ficha: PantryProduct | null = null;
  protected esNueva = false;
  protected cargando = true;
  protected guardando = false;
  protected error = '';
  protected errorNombre = '';
  protected aliasNuevo = '';
  protected formulario = {
    name: '',
    category: 'other',
    unit: 'unit' as MeasurementUnit,
    quantity: 0,
    expirationDate: '',
    notes: '',
    aliases: [] as string[]
  };

  protected readonly filtros: {
    value: PantryProductFilter;
    clave:
      | 'pantry.productos_sin_stock'
      | 'pantry.productos_con_stock'
      | 'pantry.productos_todos'
      | 'pantry.productos_caducan';
  }[] = [
    { value: 'staples', clave: 'pantry.productos_sin_stock' },
    { value: 'in-pantry', clave: 'pantry.productos_con_stock' },
    { value: 'all', clave: 'pantry.productos_todos' },
    { value: 'expiring', clave: 'pantry.productos_caducan' }
  ];

  protected readonly opcionesUnidad: PickerOption[] = [
    { value: 'g', label: this.i18n.t('pantry.gramos_g') },
    { value: 'kg', label: this.i18n.t('pantry.kilogramos_kg') },
    { value: 'ml', label: this.i18n.t('pantry.mililitros_ml') },
    { value: 'l', label: this.i18n.t('pantry.litros_l') },
    { value: 'unit', label: this.i18n.t('pantry.unidades') },
    { value: 'cup', label: this.i18n.t('pantry.tazas') },
    { value: 'tbsp', label: this.i18n.t('pantry.cucharadas') },
    { value: 'tsp', label: this.i18n.t('pantry.cucharaditas') }
  ];

  protected get catalogo(): Map<
    string,
    {
      key: string;
      name: string;
      color: string;
      parentKey: string | null;
      parentName: string | null;
    }
  > {
    return new Map(this.pantry.categories().map((fila) => [fila.key, fila]));
  }

  private readonly tablaProd = viewChild<DataTableComponent>('tablaProd');

  /** Chips y busqueda en memoria; la busqueda, ademas, sin acentos y sobre los alias, como la del visor. */
  protected readonly filtradas = computed<PantryProduct[]>(() => {
    const activa = this.filtro();
    const consulta = this.q();
    let filas = this.lista();
    if (activa === 'staples') filas = filas.filter((fila) => fila.quantity === 0);
    else if (activa === 'in-pantry') filas = filas.filter((fila) => fila.quantity > 0);
    else if (activa === 'expiring')
      filas = filas.filter((fila) => caducaEnTresDias(fila.expirationDate));
    if (consulta.trim())
      filas = filas.filter((fila) => coincideGestor([fila.name, ...fila.aliases], consulta));
    return filas;
  });

  /** La linea de la cesta se proyecta: la tabla ordena y filtra por campos, y `impact` viene anidado. */
  protected readonly filasTabla = computed<FilaProducto[]>(() =>
    this.filtradas().map((fila) => ({ ...fila, listLines: fila.impact?.listLines ?? 0 }))
  );

  protected readonly columnas = computed<DataTableColumna[]>(() => {
    this.i18n.changeTick();
    return [
      { clave: 'name', etiqueta: this.i18n.t('pantry.columna_nombre'), celda: 'nombre' },
      {
        clave: 'category',
        etiqueta: this.i18n.t('pantry.categoria'),
        celda: 'categoria',
        etiquetaValor: (v) => this.etiquetaCategoria(String(v))
      },
      { clave: 'unit', etiqueta: this.i18n.t('pantry.unidad') },
      {
        clave: 'inPantry',
        etiqueta: this.i18n.t('pantry.en_despensa'),
        tipo: 'booleano',
        etiquetaValor: (v) =>
          this.i18n.t(
            String(v) === 'true' ? 'pantry.productos_con_stock' : 'pantry.productos_sin_stock'
          )
      },
      {
        clave: 'quantity',
        etiqueta: this.i18n.t('pantry.cantidad'),
        tipo: 'numero',
        celda: 'stock',
        alineacion: 'start'
      },
      {
        clave: 'expirationDate',
        etiqueta: this.i18n.t('pantry.caducidad_producto'),
        tipo: 'fecha',
        celda: 'caducidad'
      },
      { clave: 'listLines', etiqueta: this.i18n.t('pantry.columna_cesta'), tipo: 'numero' },
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

  protected readonly etiquetaFila = (fila: unknown): string => (fila as PantryProduct).name ?? '';

  /** La etiqueta de una clave de categoria: la de fabrica, traducida; la renombrada, tal cual la escribio la casa. */
  protected etiquetaCategoria(clave: string): string {
    const cat = this.catalogo.get(clave);
    return cat ? pantryCategoryLabel(cat, (key) => this.i18n.t(key)) : clave;
  }

  ngOnInit(): void {
    this.pantry.loadCategories();
    // El estado de la lista es la query, y aqui es donde la query vuelve a ser estado: entrar por
    // `/pantry/products?filter=in-pantry` o sobrevivir a un F5 tiene que pintar el filtro y la busqueda que
    // dice la URL. `?sort=` y `?offset=` se jubilaron con la tabla: ordena y corta ella, en memoria.
    const query = this.route.snapshot.queryParamMap;
    this.filtro.set(
      valorDeQuery(query, 'filter', ['all', 'staples', 'in-pantry', 'expiring'] as const, 'staples')
    );
    this.q.set(valorDeQuery(query, 'q', null, ''));
    const id = this.route.snapshot.paramMap.get('id');
    if (id) this.abrirFicha(id);
    else void this.refrescar();
  }

  // ── lista ──

  /**
   * Carga los productos todos de 100 en 100 (tope 2.000, el del visor). La vista `filter` se pide entera y se
   * aplica aqui: si el filtro viaja al server, la tabla vuelve a mentir con sus menus, que es el pecado que la
   * casa perdono una vez y no piensa perdonar dos.
   */
  private async refrescar(): Promise<void> {
    this.cargando = true;
    const filas = await cargarTodasLasPaginas<PantryProduct>(
      (offset, tamano) => this.pantry.listProducts({ filter: 'all', limit: tamano, offset }),
      100,
      2000
    );
    if (filas === null) {
      this.error = this.i18n.t('ui.ha_ocurrido_un_error');
      this.lista.set([]);
    } else {
      this.error = '';
      this.lista.set(filas);
    }
    this.seleccion.set([]);
    this.cargando = false;
  }

  protected cambiarFiltro(value: PantryProductFilter): void {
    this.filtro.set(value);
    this.loteAnular();
    void this.escribirUrl();
  }

  protected buscar(valor: string): void {
    this.q.set(valor ?? '');
    void this.escribirUrl();
  }

  protected loteAnular(): void {
    this.seleccion.set([]);
    this.tablaProd()?.limpiarSeleccion();
  }

  /** Lo mismo que en las categorias: el estado de la pantalla esta en la URL, no solo en el componente. */
  private async escribirUrl(): Promise<void> {
    // `['../']` relativo, desde la LISTA, dependía de cómo Angular subiera un tramo por encima de una ruta sin
    // params: según eso era no-op o era un salto que desmontaba la pantalla —y las dos lecturas explican cosas
    // distintas del CI de la tanda 29, que es justo el problema de navegar «hacia arriba» en vez de «a casa».
    // El estado se escribe sobre la URL propia, absoluta; cerrar la ficha es otro paso (salvar/borrar) y no
    // pasa por aqui desde la Tanda 28.
    await this.router.navigate(['/pantry/products'], {
      relativeTo: this.route,
      queryParams: {
        filter: this.filtro() === 'staples' ? null : this.filtro(),
        q: this.q().trim() || null
      },
      replaceUrl: true
    });
  }

  /** El semaforo de la caducidad, el mismo del visor: la fecha se pinta siempre; el aviso, solo si toca. */
  protected estado(fila: PantryProduct): { variant: 'error' | 'warning'; label: string } | null {
    const dias = this.dias(fila);
    if (dias === null) return null;
    if (dias < 0) return { variant: 'error', label: this.i18n.t('pantry.caducado') };
    if (dias === 0) return { variant: 'warning', label: this.i18n.t('pantry.caduca_hoy') };
    if (dias <= 3)
      return { variant: 'warning', label: this.i18n.t('pantry.caduca_en_dias', { days: dias }) };
    return null;
  }

  private dias(fila: PantryProduct): number | null {
    if (!fila.expirationDate) return null;
    return daysUntil(fila.expirationDate);
  }

  // ── ficha ──

  protected abrir(fila: PantryProduct): void {
    void this.router.navigate([fila.id], { relativeTo: this.route });
  }

  protected abrirNueva(): void {
    void this.router.navigate(['new'], { relativeTo: this.route });
  }

  private abrirFicha(id: string): void {
    this.esNueva = id === 'new';
    if (this.esNueva) {
      // La plantilla decide «lista o ficha» con `@if (!ficha)`, así que el alta necesita una ficha EN BLANCO, no
      // `null`: con `null` el botón de crear volvía a pintar la lista y el formulario del alta no existía. Es el
      // mismo truco que en las categorías, y lo que de una fila inexistente no se puede decir (impacto, pie de
      // ficha, borrado) ya está tapado por `@if (!esNueva)`.
      this.ficha = {
        id: '',
        name: '',
        category: 'other',
        categoryKey: 'other',
        categoryName: '',
        quantity: 0,
        unit: 'unit',
        inPantry: false,
        expirationDate: null,
        location: 'pantry',
        barcode: null,
        notes: null,
        aliases: [],
        createdAt: '',
        updatedAt: '',
        impact: { listLines: 0, priceObservations: 0 }
      };
      this.formulario = {
        name: '',
        category: 'other',
        unit: 'unit',
        quantity: 0,
        expirationDate: '',
        notes: '',
        aliases: []
      };
      return;
    }
    // La ficha viene de la lista que se esta viendo; si se entra directo por URL (F5, enlace) se busca en el
    // server con la busqueda por nombre, que es lo unico que la URL puede transportar.
    const enLista = this.lista().find((fila) => fila.id === id);
    if (enLista) this.usar(enLista);
    else void this.buscarPorId(id);
  }

  private async buscarPorId(id: string): Promise<void> {
    const fila = await this.pantry.getProduct(id);
    if (!fila) {
      await this.router.navigate(['../'], { relativeTo: this.route });
      return;
    }
    this.usar(fila);
  }

  private usar(fila: PantryProduct): void {
    this.ficha = fila;
    this.formulario = {
      name: fila.name,
      category: fila.category,
      unit: fila.unit,
      quantity: fila.quantity,
      expirationDate: fila.expirationDate ?? '',
      notes: fila.notes ?? '',
      aliases: [...fila.aliases]
    };
  }

  protected opcionesCategoria(): PickerOption[] {
    return this.pantry.categories().map((fila) => ({
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

  /** Lleva a la despensa con el nombre escrito en la busqueda: la ficha no es donde se mueve el stock. */
  protected verEnLaDespensa(): void {
    void this.router.navigate(['/pantry'], { queryParams: { buscar: this.ficha?.name ?? '' } });
  }

  protected elegirCategoria(valor: string | null): void {
    this.formulario.category = valor ?? 'other';
  }

  protected elegirUnidad(valor: string | null): void {
    this.formulario.unit = (valor ?? 'unit') as MeasurementUnit;
  }

  protected anadirAlias(): void {
    const resultado = normalizarAlias(
      this.aliasNuevo,
      this.formulario.name,
      this.formulario.aliases
    );
    if (!resultado) {
      this.toast.warning(this.i18n.t('pantry.aliases'), this.i18n.t('pantry.aliases_ayuda'));
      this.aliasNuevo = '';
      return;
    }
    if ('error' in resultado) {
      // `repetido` y `vacio` no merecen un aviso: el alias no se anade y el cuadro se queda como estaba, que es
      // lo que la persona queria decir. `es-el-nombre` si: ahi se esta intentando llamar a la ficha por dos
      // nombres a la vez, y eso hay que decirlo.
      if (resultado.error === 'es-el-nombre') {
        this.error = this.i18n.t('pantry.error_alias_de_otro', { alias: this.aliasNuevo.trim() });
        return;
      }
      this.aliasNuevo = '';
      return;
    }
    this.formulario.aliases = [...this.formulario.aliases, resultado.valor];
    this.aliasNuevo = '';
  }

  protected quitarAlias(alias: string): void {
    this.formulario.aliases = this.formulario.aliases.filter((previo) => previo !== alias);
  }

  protected async guardar(): Promise<void> {
    const nombre = this.formulario.name.trim();
    this.error = '';
    this.errorNombre = '';
    if (!nombre) {
      this.errorNombre = this.i18n.t('pantry.el_nombre_es_requerido');
      return;
    }
    const entrada = {
      name: nombre,
      category: this.formulario.category,
      unit: this.formulario.unit,
      notes: this.formulario.notes.trim() || null,
      aliases: this.formulario.aliases,
      ...(this.formulario.expirationDate
        ? { expirationDate: this.formulario.expirationDate }
        : { expirationDate: null })
    };
    this.guardando = true;
    const resultado = this.esNueva
      ? await this.pantry.createProduct({
          ...entrada,
          quantity: Number(this.formulario.quantity) || 0
        })
      : await this.pantry.updateProduct(this.ficha!.id, entrada);
    this.guardando = false;
    if (!resultado.ok) {
      this.error = this.frase(resultado);
      return;
    }
    this.toast.success(
      this.i18n.t(this.esNueva ? 'pantry.producto_registrado' : 'pantry.producto_guardado')
    );
    await this.volver();
  }

  private frase(resultado: { error: string; message: string; details?: unknown }): string {
    const t = (clave: Parameters<I18nService['t']>[0], params?: Record<string, string | number>) =>
      this.i18n.t(clave, params);
    const detalles = (resultado.details ?? {}) as { alias?: string; quantity?: number };
    switch (resultado.error) {
      case 'PANTRY_PRODUCT_ALIAS_CLASH':
        return t('pantry.error_alias_de_otro', { alias: detalles.alias ?? '' });
      case 'PANTRY_CATEGORY_UNKNOWN':
        return t('pantry.error_categoria_desconocida');
      case 'PANTRY_PRODUCT_IN_PANTRY':
        return t('pantry.error_en_despensa', { cantidad: String(detalles.quantity ?? '') });
      case 'NETWORK':
        return t('ui.sin_conexion');
      default:
        return resultado.message || t('ui.no_se_ha_podido');
    }
  }

  protected async borrar(fila: PantryProduct): Promise<void> {
    const aceptado = await this.confirm.confirm({
      title: this.i18n.t('pantry.eliminar_producto'),
      message: `${this.i18n.t('pantry.confirmar_borrar_producto', { name: fila.name })} ${this.i18n.t('pantry.impacto_borrar_producto')}`,
      confirmText: this.i18n.t('common.delete'),
      cancelText: this.i18n.t('common.cancel'),
      variant: 'danger'
    });
    if (!aceptado) return;
    const resultado = await this.pantry.deleteProduct(fila.id);
    if (!resultado.ok) {
      this.toast.error(this.i18n.t('ui.no_se_ha_podido'), this.frase(resultado));
      return;
    }
    this.toast.success(this.i18n.t('pantry.producto_borrado'));
    if (this.ficha) await this.volver();
    else await this.refrescar();
  }

  /**
   * El lote se anuncia con el impacto del server, no con una cuenta hecha aqui: «4 de los seleccionados tienen
   * stock dentro» tiene que ser verdad en el momento de pulsar, y eso solo lo sabe el server. Si alguno
   * estorba, no se borra ninguno —el contrato de `bulk-delete` es todo-o-nada—, y la pantalla lo dice en vez de
   * dejar una seleccion a medias.
   */
  protected async borrarLote(): Promise<void> {
    const ids = this.seleccion().map((fila) => (fila as FilaProducto).id);
    if (ids.length === 0) return;
    const impacto = await this.pantry.bulkProductImpact(ids);
    if (!impacto) {
      this.toast.error(this.i18n.t('ui.no_se_ha_podido'));
      return;
    }
    if (!impacto.canDelete) {
      this.toast.warning(
        this.i18n.t('pantry.borrar_seleccionados'),
        this.i18n.t('pantry.error_lote_bloqueado', { n: impacto.blocked.length })
      );
      return;
    }
    const aceptado = await this.confirm.confirm({
      title: this.i18n.t('pantry.borrar_seleccionados'),
      message: this.i18n.t('pantry.impacto_borrar_producto'),
      confirmText: this.i18n.t('common.delete'),
      cancelText: this.i18n.t('common.cancel'),
      variant: 'danger'
    });
    if (!aceptado) return;
    const resultado: PantryRequest<{ deleted: number }> = await this.pantry.bulkDeleteProducts(ids);
    if (!resultado.ok) {
      this.toast.error(this.i18n.t('ui.no_se_ha_podido'), this.frase(resultado));
      return;
    }
    this.toast.success(this.i18n.t('pantry.n_productos_borrados', { n: resultado.data.deleted }));
    await this.refrescar();
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
