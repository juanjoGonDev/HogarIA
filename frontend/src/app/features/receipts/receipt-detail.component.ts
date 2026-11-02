import { Component, computed, effect, inject, OnDestroy, OnInit, signal } from '@angular/core';
import { CommonModule, DatePipe, DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { interval } from 'rxjs';
import { switchMap, takeWhile } from 'rxjs/operators';
import { ReceiptsService } from '../../core/services/receipts.service';
import { PantryService } from '../../core/services/pantry.service';
import { ToastService } from '../../core/services/toast.service';
import { ConfirmService } from '../../core/services/confirm.service';
import { I18nService } from '../../core/services/i18n.service';
import { ClipboardService } from '../../core/services/clipboard.service';
import { IconComponent } from '../../shared/components/ui/icon/icon.component';
import { ButtonComponent } from '../../shared/components/ui/button/button.component';
import { BadgeComponent } from '../../shared/components/ui/badge/badge.component';
import { InputComponent } from '../../shared/components/ui/input/input.component';
import { PickerComponent } from '../../shared/components/ui/picker/picker.component';
import { LoadingComponent } from '../../shared/components/ui/loading/loading.component';
import { TranslatePipe } from '../../core/pipes/translate.pipe';
import type { TranslationKey } from '../../core/i18n';
import type { ReceiptItem, ReceiptJob, ReceiptStatus } from '../../shared/models/receipt.model';
import { revisable, sumaDeLineas } from '../../shared/models/receipt.model';

/**
 * La ficha del ticket (HOGARIA-SPEC ## 12aj): donde la lectura de la IA se vuelve compra de
 * verdad, en tres actos.
 *
 *  1. **En marcha** (queued/analyzing): el detalle se refresca cada segundo y las líneas se
 *     ven LLEGAR —lo que el modelo va soltando, no un circulo mudo—. Un anillo gira en la
 *     cabecera del bloque y «parar» corta la lectura.
 *  2. **Revisión** (review, o failed/stopped rescatado a mano): CADA línea es editable en
 *     todas sus propiedades —nombre, cantidad, unidad, categoría de la despensa, precio,
 *     oferta, nota— con guardado por línea al cambiar. Se pueden añadir y quitar líneas.
 *  3. **Confirmar**: tienda registrada si no existía, precios apuntados con su tienda y la
 *     compra subida al inventario con la categoría revisada (no la de la reserva).
 */

const ESTADO_VARIANTE: Record<
  ReceiptStatus,
  'primary' | 'secondary' | 'success' | 'warning' | 'error' | 'neutral'
> = {
  queued: 'primary',
  analyzing: 'primary',
  review: 'warning',
  confirmed: 'success',
  failed: 'error',
  stopped: 'neutral'
};

interface LineaEnPantalla extends ReceiptItem {
  /** Borrador de edición: lo que el input enseña hasta que se guarda. */
  precioTexto: string;
  cantidadTexto: string;
}

const SAFE_DIAGNOSTIC_ERRORS = new Set([
  'NO_CONFIG',
  'BAD_JSON',
  'TIMEOUT',
  'PROVIDER',
  'FILE_MISSING',
  'CANCELLED',
  'INPUT_EXPIRED',
  'JOB_SCOPE_MISMATCH',
  'CONFIG_DISABLED',
  'CONFIG_UNAVAILABLE',
  'RECEIPT_NOT_FOUND'
]);
const SAFE_DIAGNOSTIC_STAGES = new Set([
  'submitting',
  'queued',
  'polling',
  'completed',
  'failed',
  'timed_out',
  'cancelled',
  'fallback'
]);
const SAFE_DIAGNOSTIC_TRANSPORTS = new Set(['responses_background', 'chat_completions']);
const SAFE_JOB_STATUSES = new Set(['queued', 'running', 'done', 'failed', 'stopped']);
const SAFE_PROVIDER_ERROR_TYPES = new Set([
  'api_error',
  'invalid_request_error',
  'authentication_error',
  'permission_error',
  'rate_limit_error',
  'server_error',
  'insufficient_quota'
]);
const SAFE_PROVIDER_ERROR_CODES = new Set([
  'unsupported_parameter',
  'unsupported_value',
  'invalid_value',
  'invalid_type',
  'model_not_found',
  'context_length_exceeded',
  'insufficient_quota',
  'rate_limit_exceeded',
  'invalid_api_key',
  'invalid_prompt',
  'responses_not_supported',
  'responses_endpoint_not_supported',
  'background_not_supported'
]);
const SAFE_PROVIDER_ERROR_PARAMS = new Set([
  'model',
  'temperature',
  'top_p',
  'max_output_tokens',
  'input',
  'input_image',
  'input_file',
  'text.format',
  'text.format.type',
  'background',
  'store',
  'reasoning.effort'
]);

@Component({
  selector: 'app-receipt-detail',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterLink,
    DatePipe,
    DecimalPipe,
    IconComponent,
    ButtonComponent,
    BadgeComponent,
    InputComponent,
    PickerComponent,
    LoadingComponent,
    TranslatePipe
  ],
  template: `
    <div class="ficha">
      @if (ticket(); as t) {
        <header class="ficha__head">
          <a class="ficha__volver" routerLink="/receipts">
            <app-icon name="chevron_left" [size]="18" [label]="null" />
            <span>{{ 'receipts.volver_a_tickets' | t }}</span>
          </a>
          <div class="ficha__titular">
            <h1 class="ficha__titulo">
              {{ t.store || t.fileName || ('receipts.abrir_ticket' | t) }}
            </h1>
            <div class="ficha__meta">
              <app-badge [variant]="variante(t.status)">{{ estado(t.status) | t }}</app-badge>
              <span class="ficha__fecha">
                {{ 'receipts.fecha_compra' | t }}:
                {{ t.purchaseDate || ('receipts.fecha_no_detectada' | t) }}
              </span>
              <span class="ficha__fecha"
                >{{ 'receipts.subido' | t }}: {{ t.createdAt | date: 'short' }}</span
              >
              <a class="ficha__fichero" [href]="t.fileUrl" target="_blank" rel="noopener">
                <app-icon
                  [name]="t.fileKind === 'pdf' ? 'description' : 'receipt_long'"
                  [size]="14"
                  [label]="null"
                />
                {{ 'receipts.ver_el_fichero' | t }}
              </a>
            </div>
          </div>

          <div class="ficha__acciones">
            @if (enMarcha()) {
              <app-button variant="outline" size="sm" type="button" (onClick)="parar()">
                {{ 'receipts.parar' | t }}
              </app-button>
            }
            @if (t.status === 'failed' || t.status === 'stopped') {
              <app-button variant="outline" size="sm" type="button" (onClick)="reintentar()">
                {{ 'receipts.reintentar' | t }}
              </app-button>
            }
            @if (t.status !== 'confirmed') {
              <app-button variant="ghost" size="sm" type="button" (onClick)="borrar()">
                {{ 'receipts.borrar' | t }}
              </app-button>
            }
          </div>
        </header>

        @if (t.error || t.job?.error_code) {
          <div class="ficha__error" data-test="ticket-error">
            <app-icon name="error_outline" [size]="18" [label]="null" />
            <div class="ficha__error-content">
              <p class="ficha__error-message">
                {{ textoDeError(t.job?.error_code || t.error, t.job) }}
              </p>
              @if (t.status === 'failed' && t.job) {
                <app-button
                  variant="outline"
                  size="sm"
                  [touchTarget]="true"
                  type="button"
                  data-test="receipt-copy-diagnostic"
                  (onClick)="copyDiagnostic(t.job)"
                >
                  <app-icon name="content_copy" [size]="16" [label]="null" />
                  {{ 'receipts.copy_diagnostic' | t }}
                </app-button>
                <span
                  class="ficha__error-feedback"
                  role="status"
                  aria-live="polite"
                  aria-atomic="true"
                >
                  @if (diagnosticCopyStatus()) {
                    {{ diagnosticCopyFeedback() | t }}
                  }
                </span>
              }
            </div>
          </div>
        }

        @if (t.warnings.length > 0) {
          <details class="ficha__avisos">
            <summary>{{ 'receipts.avisos' | t }}</summary>
            <ul>
              @for (aviso of t.warnings; track aviso) {
                <li>{{ aviso }}</li>
              }
            </ul>
          </details>
        }

        <!-- Acto 1: la lectura en directo. -->
        @if (enMarcha()) {
          <section class="ficha__lectura" data-test="ticket-reading">
            <span class="ficha__anillo" aria-hidden="true"></span>
            <div class="ficha__lectura-texto">
              <span class="ficha__lectura-titulo">{{ 'receipts.leyendo_el_ticket' | t }}</span>
              <span class="ficha__lectura-hint">{{ 'receipts.leyendo_hint' | t }}</span>
            </div>
            <span class="ficha__lectura-lineas">
              {{
                t.lines.length === 1
                  ? ('receipts.una_linea' | t)
                  : ('receipts.lineas' | t: { n: t.lines.length })
              }}
            </span>
          </section>
        }

        <!-- Tienda y fecha siguen corregibles en el historial; las notas solo en revisión. -->
        @if (metadatosEditables(t.status)) {
          <section class="ficha__cabecera">
            <div class="ficha__campo">
              <app-input
                id="ticket-tienda"
                name="store"
                type="text"
                [label]="'receipts.tienda' | t"
                [placeholder]="'receipts.tienda_no_detectada' | t"
                [ngModel]="tiendaDraft()"
                (ngModelChange)="cambiarTienda($event)"
              />
            </div>
            <div class="ficha__campo">
              <app-input
                id="ticket-fecha-compra"
                name="purchaseDate"
                type="date"
                [label]="'receipts.fecha_compra' | t"
                [ngModel]="fechaCompraDraft()"
                (ngModelChange)="cambiarFechaCompra($event)"
              />
            </div>
            @if (revisable(t.status)) {
              <div class="ficha__campo">
                <app-input
                  id="ticket-notas"
                  name="notes"
                  type="text"
                  [label]="'receipts.notas' | t"
                  [ngModel]="t.notes ?? ''"
                  (ngModelChange)="guardarNotas($event)"
                />
              </div>
            }
            <div class="ficha__metadatos-acciones">
              <app-button
                variant="outline"
                type="button"
                [disabled]="!metadatosCambiados() || metadatosGuardando()"
                [loading]="metadatosGuardando()"
                (onClick)="guardarMetadatos()"
                data-test="save-receipt-metadata"
              >
                {{ 'receipts.guardar_metadatos' | t }}
              </app-button>
              @if (metadatosGuardados()) {
                <span role="status" class="ficha__metadatos-estado">
                  {{ 'receipts.metadatos_guardados' | t }}
                </span>
              }
              @if (errorMetadatos()) {
                <span role="alert" class="ficha__metadatos-error">
                  {{ 'receipts.metadatos_error' | t }}
                </span>
              }
            </div>
          </section>
        } @else if (t.store) {
          <p class="ficha__tienda-fija">
            {{ 'receipts.tienda' | t }}: <strong>{{ t.store }}</strong>
          </p>
        }

        <!-- Acto 2: las líneas. -->
        @if (t.lines.length > 0 || revisable(t.status)) {
          <section class="ficha__lineas">
            @if (revisable(t.status)) {
              <p class="ficha__hint">{{ 'receipts.lineas_editables_hint' | t }}</p>
            }
            <div class="tabla" role="table">
              <div class="tabla__head" role="row">
                <span class="tabla__celda tabla__celda--nombre" role="columnheader">{{
                  'receipts.nombre' | t
                }}</span>
                <span class="tabla__celda tabla__celda--num" role="columnheader">{{
                  'receipts.cantidad' | t
                }}</span>
                <span class="tabla__celda tabla__celda--unidad" role="columnheader">{{
                  'receipts.unidad' | t
                }}</span>
                <span class="tabla__celda tabla__celda--categoria" role="columnheader">{{
                  'receipts.categoria' | t
                }}</span>
                <span class="tabla__celda tabla__celda--num" role="columnheader">{{
                  'receipts.precio' | t
                }}</span>
                <span class="tabla__celda tabla__celda--oferta" role="columnheader">{{
                  'receipts.oferta' | t
                }}</span>
                @if (revisable(t.status)) {
                  <span class="tabla__celda tabla__celda--quitar" role="columnheader"></span>
                }
              </div>
              @for (linea of lineas(); track linea.id) {
                <div
                  class="tabla__fila"
                  role="row"
                  [class.tabla__fila--nueva]="linea.id === ultimaNueva()"
                >
                  <span class="tabla__celda tabla__celda--nombre" role="cell">
                    @if (revisable(t.status)) {
                      <input
                        class="linea__input"
                        type="text"
                        [attr.id]="'linea-' + linea.id + '-nombre'"
                        [value]="linea.name"
                        (change)="editarLinea(linea, { name: $any($event.target).value })"
                      />
                    } @else {
                      <span class="linea__nombre">{{ linea.name }}</span>
                    }
                    @if (revisable(t.status)) {
                      <input
                        class="linea__input linea__input--nota"
                        type="text"
                        [attr.id]="'linea-' + linea.id + '-nota'"
                        [attr.aria-label]="('receipts.nota_linea' | t) + ' ' + linea.name"
                        [value]="linea.note ?? ''"
                        [placeholder]="'receipts.nota_vacia' | t"
                        (change)="
                          editarLinea(linea, { note: $any($event.target).value.trim() || null })
                        "
                      />
                    } @else if (linea.note) {
                      <span class="linea__nota">{{ linea.note }}</span>
                    }
                  </span>
                  <span class="tabla__celda tabla__celda--num" role="cell">
                    @if (revisable(t.status)) {
                      <input
                        class="linea__input linea__input--num"
                        type="number"
                        min="0.01"
                        step="any"
                        inputmode="decimal"
                        [attr.id]="'linea-' + linea.id + '-cantidad'"
                        [attr.aria-label]="('receipts.cantidad_accesible' | t) + ': ' + linea.name"
                        [value]="linea.cantidadTexto"
                        (change)="
                          editarLinea(linea, { quantity: numeroDe($any($event.target).value) })
                        "
                      />
                    } @else {
                      {{ linea.quantity | number: '1.0-2' }}
                    }
                  </span>
                  <span class="tabla__celda tabla__celda--unidad" role="cell">
                    @if (revisable(t.status)) {
                      <input
                        class="linea__input"
                        type="text"
                        [attr.id]="'linea-' + linea.id + '-unidad'"
                        [attr.aria-label]="('receipts.unidad' | t) + ': ' + linea.name"
                        [value]="linea.unit ?? ''"
                        (change)="editarLinea(linea, { unit: $any($event.target).value || null })"
                      />
                    } @else {
                      {{ linea.unit || '—' }}
                    }
                  </span>
                  <span class="tabla__celda tabla__celda--categoria" role="cell">
                    @if (revisable(t.status)) {
                      <app-picker
                        [options]="opcionesCategoria()"
                        [value]="linea.category"
                        (valueChange)="editarLinea(linea, { category: $event ?? 'other' })"
                      />
                    } @else {
                      {{ nombreCategoria(linea.category) }}
                    }
                  </span>
                  <span class="tabla__celda tabla__celda--num" role="cell">
                    @if (revisable(t.status)) {
                      <input
                        class="linea__input linea__input--num"
                        type="number"
                        min="0"
                        step="0.01"
                        inputmode="decimal"
                        [attr.id]="'linea-' + linea.id + '-precio'"
                        [attr.aria-label]="('receipts.precio' | t) + ': ' + linea.name"
                        [value]="linea.precioTexto"
                        (change)="
                          editarLinea(linea, { priceMinor: centimosDe($any($event.target).value) })
                        "
                      />
                    } @else if (linea.priceMinor !== null) {
                      {{ linea.priceMinor / 100 | number: '1.2-2' }} €
                    } @else {
                      —
                    }
                  </span>
                  <span class="tabla__celda tabla__celda--oferta" role="cell">
                    @if (revisable(t.status)) {
                      <input
                        class="linea__input linea__input--oferta"
                        type="text"
                        [attr.id]="'linea-' + linea.id + '-oferta'"
                        [attr.aria-label]="('receipts.oferta' | t) + ': ' + linea.name"
                        placeholder="3x2"
                        [value]="ofertaTexto(linea)"
                        (change)="editarOferta(linea, $any($event.target).value)"
                      />
                    } @else if (linea.offer) {
                      {{ linea.offer.buy }}x{{ linea.offer.take }}
                    } @else {
                      —
                    }
                  </span>
                  @if (revisable(t.status)) {
                    <span class="tabla__celda tabla__celda--quitar" role="cell">
                      <button
                        type="button"
                        class="linea__quitar"
                        [attr.aria-label]="'receipts.borrar_linea' | t"
                        [attr.data-test]="'quitar-linea'"
                        (click)="quitarLinea(linea)"
                      >
                        <app-icon name="close" [size]="14" [label]="null" />
                      </button>
                    </span>
                  }
                </div>
              }
            </div>

            @if (revisable(t.status)) {
              <app-button
                variant="ghost"
                size="sm"
                type="button"
                (onClick)="anadirLinea()"
                data-test="anadir-linea"
              >
                <app-icon name="add" [size]="16" [label]="null" />
                {{ 'receipts.anadir_linea' | t }}
              </app-button>
            }

            <div class="ficha__totales">
              <div class="ficha__total">
                <span class="ficha__total-etiqueta">{{ 'receipts.suma_de_lineas' | t }}</span>
                <span class="ficha__total-importe">{{ suma() / 100 | number: '1.2-2' }} €</span>
              </div>
              @if (t.totalMinor !== null) {
                <div class="ficha__total">
                  <span class="ficha__total-etiqueta">{{ 'receipts.total_del_ticket' | t }}</span>
                  <span class="ficha__total-importe" [class.ficha__total-importe--mal]="!cuadra()"
                    >{{ t.totalMinor / 100 | number: '1.2-2' }} €</span
                  >
                  @if (!cuadra()) {
                    <span class="ficha__no-cuadra">{{ 'receipts.no_cuadra' | t }}</span>
                  }
                </div>
              }
            </div>
          </section>
        }

        <!-- Acto 3: confirmar. -->
        @if (t.status === 'confirmed') {
          <section class="ficha__confirmada" data-test="ticket-confirmed">
            <app-icon name="check_circle" [size]="22" [label]="null" />
            <div>
              <span class="ficha__confirmada-titulo">{{ 'receipts.confirmado' | t }}</span>
              <span class="ficha__confirmada-detalle">
                {{
                  'receipts.confirmado_detalle'
                    | t
                      : {
                          precios: resultado()?.pricesRecorded ?? 0,
                          nuevas: resultado()?.pantryMoved ?? 0,
                          sumadas: resultado()?.pantryMerged ?? 0
                        }
                }}
              </span>
            </div>
            <app-button variant="outline" size="sm" type="button" routerLink="/pantry">
              {{ 'receipts.ver_inventario' | t }}
            </app-button>
          </section>
        } @else if (revisable(t.status)) {
          <footer class="ficha__pie">
            <app-button
              variant="primary"
              type="button"
              [disabled]="t.lines.length === 0"
              [loading]="confirmando()"
              (onClick)="confirmar()"
              data-test="confirmar-ticket"
            >
              {{ 'receipts.confirmar' | t }}
            </app-button>
          </footer>
        }
      } @else {
        <app-loading />
      }
    </div>
  `,
  styles: [
    `
      .ficha {
        display: grid;
        gap: var(--space-4, 16px);
        max-width: 860px;
        margin: 0 auto;
        padding-block: var(--container-padding);
      }

      .ficha__head {
        display: grid;
        gap: var(--space-2, 8px);
      }

      .ficha__volver {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        font-size: var(--text-sm, 14px);
        color: var(--text-secondary);
        text-decoration: none;
        width: fit-content;
      }

      .ficha__volver:hover {
        color: var(--text-primary);
      }

      .ficha__titular {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: var(--space-2, 8px);
      }

      .ficha__titulo {
        margin: 0;
        font-size: var(--text-2xl, 24px);
        font-weight: var(--font-bold, 700);
        color: var(--text-primary);
      }

      .ficha__acciones {
        display: flex;
        gap: var(--space-2, 8px);
      }

      .ficha__meta {
        display: flex;
        align-items: center;
        gap: var(--space-2, 8px);
        flex-wrap: wrap;
      }

      .ficha__fecha,
      .ficha__fichero {
        font-size: var(--text-xs, 12px);
        color: var(--text-secondary);
      }

      .ficha__metadatos-acciones {
        grid-column: 1 / -1;
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: var(--space-2, 8px);
      }

      .ficha__metadatos-estado,
      .ficha__metadatos-error {
        font-size: var(--text-sm, 14px);
      }

      .ficha__metadatos-estado {
        color: var(--success, #3e9e5b);
      }

      .ficha__metadatos-error {
        color: var(--danger, #d64545);
      }

      .ficha__fichero {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        color: var(--primary, #4f7df9);
        text-decoration: none;
      }

      .ficha__fichero:hover {
        text-decoration: underline;
      }

      .ficha__error {
        display: flex;
        align-items: flex-start;
        gap: var(--space-2, 8px);
        padding: var(--space-3, 12px);
        border-radius: var(--radius-md, 10px);
        background: color-mix(in srgb, var(--danger, #d64545) 10%, transparent);
        color: var(--danger, #d64545);
        font-size: var(--text-sm, 14px);
      }

      .ficha__error-content {
        display: flex;
        flex: 1;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--space-2, 8px) var(--space-3, 12px);
        min-width: 0;
      }

      .ficha__error-message {
        flex: 1 1 220px;
        min-width: 0;
        margin: 0;
      }

      .ficha__error-content app-button {
        display: inline-flex;
        flex: 0 0 auto;
      }

      .ficha__error-feedback {
        flex: 1 0 100%;
        color: var(--text-secondary, #5b6470);
        font-size: var(--text-xs, 12px);
      }

      .ficha__avisos {
        padding: var(--space-2, 8px) var(--space-3, 12px);
        border: 1px solid var(--border-default, #e2e5ea);
        border-radius: var(--radius-md, 10px);
        font-size: var(--text-sm, 14px);
        color: var(--text-secondary);
      }

      .ficha__avisos summary {
        cursor: pointer;
        font-weight: var(--font-medium, 500);
        color: var(--text-primary);
      }

      .ficha__lectura {
        display: flex;
        align-items: center;
        gap: var(--space-3, 12px);
        padding: var(--space-4, 16px);
        border: 1px solid color-mix(in srgb, var(--primary, #4f7df9) 30%, transparent);
        border-radius: var(--radius-lg, 12px);
        background: color-mix(in srgb, var(--primary, #4f7df9) 6%, var(--bg-primary, #fff));
      }

      .ficha__anillo {
        width: 22px;
        height: 22px;
        flex: none;
        border-radius: 999px;
        border: 3px solid color-mix(in srgb, var(--primary, #4f7df9) 25%, transparent);
        border-top-color: var(--primary, #4f7df9);
        animation: ficha-girar 0.9s linear infinite;
      }

      @keyframes ficha-girar {
        to {
          transform: rotate(360deg);
        }
      }

      .ficha__lectura-texto {
        flex: 1;
        display: grid;
        gap: 2px;
      }

      .ficha__lectura-titulo {
        font-size: var(--text-base, 16px);
        font-weight: var(--font-medium, 500);
        color: var(--text-primary);
      }

      .ficha__lectura-hint {
        font-size: var(--text-xs, 12px);
        color: var(--text-secondary);
      }

      .ficha__lectura-lineas {
        font-size: var(--text-sm, 14px);
        font-weight: var(--font-semibold, 600);
        color: var(--primary, #4f7df9);
      }

      .ficha__cabecera {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
        gap: var(--space-3, 12px);
      }

      .ficha__tienda-fija {
        margin: 0;
        font-size: var(--text-sm, 14px);
        color: var(--text-secondary);
      }

      .ficha__lineas {
        display: grid;
        gap: var(--space-2, 8px);
      }

      .ficha__hint {
        margin: 0;
        font-size: var(--text-xs, 12px);
        color: var(--text-tertiary, #9aa1ab);
      }

      .tabla {
        border: 1px solid var(--border-default, #e2e5ea);
        border-radius: var(--radius-lg, 12px);
        overflow: hidden;
      }

      .tabla__head,
      .tabla__fila {
        display: grid;
        grid-template-columns: minmax(140px, 2fr) 64px 72px minmax(130px, 1.4fr) 84px 64px 36px;
        gap: var(--space-2, 8px);
        align-items: center;
        padding: var(--space-2, 8px) var(--space-3, 12px);
      }

      .tabla__head {
        background: var(--bg-tertiary, #eef0f3);
        font-size: var(--text-xs, 12px);
        font-weight: var(--font-semibold, 600);
        text-transform: uppercase;
        letter-spacing: 0.03em;
        color: var(--text-secondary);
      }

      .tabla__fila {
        border-top: 1px solid var(--border-default, #eef0f3);
        background: var(--bg-primary, #fff);
      }

      /* La linea recien llegada por el stream entra deslizandose: es lo que hace visible
         el «poco a poco» de la lectura. */
      .tabla__fila--nueva {
        animation: ficha-entrar 0.35s ease;
      }

      @keyframes ficha-entrar {
        from {
          opacity: 0;
          transform: translateY(-4px);
        }
      }

      .tabla__celda {
        min-width: 0;
        display: grid;
        gap: 2px;
        font-size: var(--text-sm, 14px);
        color: var(--text-primary);
      }

      .tabla__celda--num {
        text-align: right;
        justify-items: end;
      }

      .linea__nombre {
        font-weight: var(--font-medium, 500);
        overflow-wrap: anywhere;
      }

      .linea__nota {
        font-size: var(--text-xs, 12px);
        color: var(--text-tertiary, #9aa1ab);
      }

      .linea__input {
        width: 100%;
        padding: 5px 8px;
        border: 1px solid transparent;
        border-radius: 6px;
        background: transparent;
        font: inherit;
        font-size: var(--text-sm, 14px);
        color: var(--text-primary);
      }

      .linea__input:hover {
        border-color: var(--border-default, #e2e5ea);
      }

      .linea__input:focus {
        outline: none;
        border-color: var(--primary, #4f7df9);
        background: var(--bg-primary, #fff);
      }

      .linea__input--nota {
        font-size: var(--text-xs, 12px);
        color: var(--text-secondary);
      }

      .linea__input--nota::placeholder {
        color: var(--text-secondary);
        opacity: 1;
      }

      .linea__input--nota:focus {
        color: var(--text-primary);
      }

      .linea__input--num {
        text-align: right;
      }

      .linea__quitar {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 28px;
        height: 28px;
        border: none;
        border-radius: 999px;
        background: transparent;
        color: var(--text-tertiary, #9aa1ab);
        cursor: pointer;
      }

      .linea__quitar:hover {
        background: color-mix(in srgb, var(--danger, #d64545) 12%, transparent);
        color: var(--danger, #d64545);
      }

      .ficha__totales {
        display: flex;
        flex-wrap: wrap;
        gap: var(--space-4, 16px);
        justify-content: flex-end;
        padding-top: var(--space-2, 8px);
      }

      .ficha__total {
        display: grid;
        gap: 2px;
        justify-items: end;
      }

      .ficha__total-etiqueta {
        font-size: var(--text-xs, 12px);
        color: var(--text-secondary);
      }

      .ficha__total-importe {
        font-size: var(--text-lg, 18px);
        font-weight: var(--font-bold, 700);
        color: var(--text-primary);
      }

      .ficha__total-importe--mal {
        color: var(--danger, #d64545);
      }

      .ficha__no-cuadra {
        font-size: var(--text-xs, 12px);
        color: var(--danger, #d64545);
      }

      .ficha__confirmada {
        display: flex;
        align-items: center;
        gap: var(--space-3, 12px);
        padding: var(--space-4, 16px);
        border-radius: var(--radius-lg, 12px);
        background: color-mix(in srgb, var(--success, #3e9e5b) 10%, transparent);
        color: var(--success, #3e9e5b);
      }

      .ficha__confirmada > div {
        flex: 1;
        display: grid;
        gap: 2px;
      }

      .ficha__confirmada-titulo {
        font-size: var(--text-base, 16px);
        font-weight: var(--font-semibold, 600);
        color: var(--text-primary);
      }

      .ficha__confirmada-detalle {
        font-size: var(--text-xs, 12px);
        color: var(--text-secondary);
      }

      .ficha__pie {
        display: flex;
        justify-content: flex-end;
        padding-bottom: var(--space-4, 16px);
      }

      .ficha__vacio {
        padding: var(--space-8, 40px) 0;
        text-align: center;
        color: var(--text-secondary);
      }

      /* Movil: la tabla se vuelve una tarjeta por linea —siete columnas no caben en 380px
         ni de broma. Las celdas se colocan por posicion (nth-child) porque «cantidad» y
         «precio» comparten clase y el area es lo unico que las distingue. */
      @media (max-width: 640px) {
        .tabla__head {
          display: none;
        }

        .tabla__fila {
          grid-template-columns: repeat(3, minmax(0, 1fr));
          grid-template-areas:
            'nombre nombre precio'
            'nombre nombre quitar'
            'cantidad unidad oferta'
            'categoria categoria categoria';
          row-gap: var(--space-2, 8px);
          padding: var(--space-3, 12px);
        }

        .tabla__fila > :nth-child(1) {
          grid-area: nombre;
        }

        .tabla__fila > :nth-child(2) {
          grid-area: cantidad;
          justify-self: start;
        }

        .tabla__fila > :nth-child(3) {
          grid-area: unidad;
        }

        .tabla__fila > :nth-child(4) {
          grid-area: categoria;
        }

        .tabla__fila > :nth-child(5) {
          grid-area: precio;
          justify-self: end;
        }

        .tabla__fila > :nth-child(6) {
          grid-area: oferta;
          justify-self: end;
        }

        .tabla__fila > :nth-child(7) {
          grid-area: quitar;
          justify-self: end;
          align-self: end;
        }

        .tabla__celda--num {
          text-align: left;
        }

        .linea__input {
          min-height: 44px;
          min-width: 44px;
        }

        .linea__quitar {
          width: 44px;
          height: 44px;
        }
      }
    `
  ]
})
export class ReceiptDetailComponent implements OnInit, OnDestroy {
  readonly service = inject(ReceiptsService);
  private readonly pantry = inject(PantryService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmService);
  private readonly i18n = inject(I18nService);
  private readonly clipboard = inject(ClipboardService);

  readonly confirmando = signal(false);
  readonly tiendaDraft = signal('');
  readonly fechaCompraDraft = signal('');
  readonly metadatosGuardando = signal(false);
  readonly metadatosGuardados = signal(false);
  readonly errorMetadatos = signal(false);
  readonly resultado = signal<{
    pricesRecorded: number;
    pantryMoved: number;
    pantryMerged: number;
  } | null>(null);
  readonly ultimaNueva = signal<string | null>(null);
  readonly diagnosticCopyStatus = signal<'copied' | 'failed' | null>(null);

  readonly ticket = this.service.receipt;
  readonly lineas = computed<LineaEnPantalla[]>(() =>
    (this.service.receipt()?.lines ?? []).map((linea) => ({
      ...linea,
      precioTexto: linea.priceMinor === null ? '' : (linea.priceMinor / 100).toFixed(2),
      cantidadTexto: String(linea.quantity)
    }))
  );
  readonly enMarcha = computed(() => {
    const estado = this.service.receipt()?.status;
    return estado === 'queued' || estado === 'analyzing';
  });
  readonly suma = computed(() => sumaDeLineas(this.service.receipt()?.lines ?? []));
  readonly cuadra = computed(() => {
    const t = this.service.receipt();
    if (!t || t.totalMinor === null) return true;
    return t.totalMinor === this.suma();
  });
  readonly metadatosCambiados = computed(() => {
    const receipt = this.ticket();
    if (!receipt) return false;
    return (
      (this.tiendaDraft().trim() || null) !== receipt.store ||
      (this.fechaCompraDraft() || null) !== receipt.purchaseDate
    );
  });

  /** Categorias de la despensa: el vocabulario de la revision. */
  readonly opcionesCategoria = computed(() =>
    this.pantry.categories().map((categoria) => ({
      value: categoria.key,
      label: categoria.name,
      color: categoria.color
    }))
  );

  private readonly id: string;
  private pollActivo = false;
  private lineasPrevias = 0;
  private metadatosInicializadosPara: string | null = null;

  constructor() {
    this.id = String(this.route.snapshot.paramMap.get('id') ?? '');
    effect(() => {
      const receipt = this.service.receipt();
      if (!receipt || receipt.id !== this.id || this.metadatosInicializadosPara === receipt.id)
        return;
      this.metadatosInicializadosPara = receipt.id;
      this.tiendaDraft.set(receipt.store ?? '');
      this.fechaCompraDraft.set(receipt.purchaseDate ?? '');
    });
  }

  ngOnInit(): void {
    this.service.watch();
    this.pantry.loadCategories();
    this.service.loadReceipt(this.id);
    this.arrancarPoll();
  }

  ngOnDestroy(): void {
    this.service.unwatch();
    this.pollActivo = false;
  }

  variante(estado: ReceiptStatus) {
    return ESTADO_VARIANTE[estado];
  }

  estado(estado: ReceiptStatus): TranslationKey {
    const claves: Record<ReceiptStatus, TranslationKey> = {
      queued: 'receipts.estado.queued',
      analyzing: 'receipts.estado.analyzing',
      review: 'receipts.estado.review',
      confirmed: 'receipts.estado.confirmed',
      failed: 'receipts.estado.failed',
      stopped: 'receipts.estado.stopped'
    };
    return claves[estado];
  }

  textoDeError(codigo: string | null | undefined, job?: ReceiptJob | null): string {
    if (codigo === 'FILE_MISSING') return this.i18n.t('receipts.error.FILE_MISSING');
    if (codigo === 'TIMEOUT' || job?.diagnostic_stage === 'timed_out') {
      return this.i18n.t('receipts.error.TIMEOUT');
    }
    if (codigo === 'PROVIDER') {
      const status = job?.provider_http_status;
      if (
        status === 400 &&
        ['input_file', 'input_image'].includes(job?.provider_error_param ?? '')
      ) {
        return this.i18n.t('receipts.error.PROVIDER_FILE_INPUT');
      }
      if (
        status === 400 &&
        job?.provider_error_code === 'unsupported_parameter' &&
        ['temperature', 'top_p'].includes(job.provider_error_param ?? '')
      ) {
        return this.i18n.t('receipts.error.PROVIDER_UNSUPPORTED_PARAMETER');
      }
      if (status === 401 || status === 403) {
        return this.i18n.t('receipts.error.PROVIDER_AUTH');
      }
      if (status === 429) return this.i18n.t('receipts.error.PROVIDER_RATE_LIMIT');
      if (typeof status === 'number' && status >= 500 && status <= 599) {
        return this.i18n.t('receipts.error.PROVIDER_SERVER');
      }
    }
    const claves: Record<string, TranslationKey> = {
      NO_CONFIG: 'receipts.error.NO_CONFIG',
      BAD_JSON: 'receipts.error.BAD_JSON',
      TIMEOUT: 'receipts.error.TIMEOUT',
      PROVIDER: 'receipts.error.PROVIDER'
    };
    return this.i18n.t(claves[codigo ?? ''] ?? 'receipts.error.PROVIDER');
  }

  diagnosticCopyFeedback(): TranslationKey {
    return this.diagnosticCopyStatus() === 'copied'
      ? 'receipts.copy_diagnostic_success'
      : 'receipts.copy_diagnostic_failed';
  }

  async copyDiagnostic(job: ReceiptJob | null | undefined): Promise<void> {
    if (!job) return;
    this.diagnosticCopyStatus.set(null);
    try {
      await this.clipboard.copy(JSON.stringify(this.safeDiagnosticFor(job), null, 2));
      this.diagnosticCopyStatus.set('copied');
    } catch {
      this.diagnosticCopyStatus.set('failed');
    }
  }

  private safeDiagnosticFor(job: ReceiptJob): Record<string, unknown> {
    const diagnostic: Record<string, unknown> = {
      jobId: this.safeIdentifier(job.id),
      kind: 'receipt',
      status: SAFE_JOB_STATUSES.has(job.status) ? job.status : 'unknown',
      attempts: this.safeCount(job.attempts),
      maxAttempts: this.safeCount(job.max_attempts),
      createdAt: this.safeTimestamp(job.created_at),
      error: SAFE_DIAGNOSTIC_ERRORS.has(job.error_code ?? '') ? job.error_code : null
    };

    if (job.diagnostic_stage && SAFE_DIAGNOSTIC_STAGES.has(job.diagnostic_stage)) {
      diagnostic['diagnosticStage'] = job.diagnostic_stage;
    }

    const responseId = this.safeResponseId(job.provider_response_id);
    if (responseId) diagnostic['providerResponseId'] = responseId;

    if (job.provider_transport && SAFE_DIAGNOSTIC_TRANSPORTS.has(job.provider_transport)) {
      diagnostic['providerTransport'] = job.provider_transport;
    }

    if (job.provider_error_type && SAFE_PROVIDER_ERROR_TYPES.has(job.provider_error_type)) {
      diagnostic['providerErrorType'] = job.provider_error_type;
    }

    if (job.provider_error_code && SAFE_PROVIDER_ERROR_CODES.has(job.provider_error_code)) {
      diagnostic['providerErrorCode'] = job.provider_error_code;
    }

    if (job.provider_error_param && SAFE_PROVIDER_ERROR_PARAMS.has(job.provider_error_param)) {
      diagnostic['providerErrorParam'] = job.provider_error_param;
    }

    if (
      Number.isInteger(job.provider_http_status) &&
      Number(job.provider_http_status) >= 100 &&
      Number(job.provider_http_status) <= 599
    ) {
      diagnostic['providerHttpStatus'] = job.provider_http_status;
    }

    if (Number.isSafeInteger(job.elapsed_ms) && Number(job.elapsed_ms) >= 0) {
      diagnostic['elapsedMs'] = job.elapsed_ms;
    }

    return diagnostic;
  }

  private safeIdentifier(value: unknown): string | null {
    return typeof value === 'string' && value.length <= 128 && /^[-A-Za-z0-9._:]+$/.test(value)
      ? value
      : null;
  }

  private safeResponseId(value: unknown): string | null {
    return typeof value === 'string' && /^resp_[A-Za-z0-9_-]{1,128}$/.test(value) ? value : null;
  }

  private safeCount(value: unknown): number | null {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 1000
      ? value
      : null;
  }

  private safeTimestamp(value: unknown): string | null {
    return typeof value === 'string' &&
      value.length <= 40 &&
      /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:?\d{2})?$/.test(value) &&
      !Number.isNaN(Date.parse(value))
      ? value
      : null;
  }

  revisable = revisable;

  metadatosEditables(status: ReceiptStatus): boolean {
    return (
      status === 'queued' ||
      status === 'analyzing' ||
      status === 'review' ||
      status === 'confirmed' ||
      status === 'failed' ||
      status === 'stopped'
    );
  }

  nombreCategoria(clave: string): string {
    return this.pantry.categories().find((categoria) => categoria.key === clave)?.name ?? clave;
  }

  /** El latido de la ficha: mientras el ticket corre, un refresco por segundo. */
  private arrancarPoll(): void {
    if (this.pollActivo) return;
    this.pollActivo = true;
    this.lineasPrevias = this.service.receipt()?.lines.length ?? 0;
    interval(1000)
      .pipe(
        switchMap(() => this.service.refreshReceipt(this.id)),
        takeWhile(() => this.pollActivo)
      )
      .subscribe({
        next: () => {
          const t = this.service.receipt();
          const ahora = t?.lines.length ?? 0;
          if (ahora > this.lineasPrevias) this.ultimaNueva.set(t!.lines[ahora - 1]?.id ?? null);
          this.lineasPrevias = ahora;
          // Parado el trabajo (review/failed/stopped/confirmed), el latido se apaga solo.
          if (t && t.status !== 'queued' && t.status !== 'analyzing') this.pollActivo = false;
        }
      });
  }

  // ------------------------------------------------------------ ediciones

  private cambiarMetadatos(): void {
    this.metadatosGuardados.set(false);
    this.errorMetadatos.set(false);
  }

  cambiarTienda(valor: string): void {
    this.tiendaDraft.set(valor);
    this.cambiarMetadatos();
  }

  cambiarFechaCompra(valor: string): void {
    this.fechaCompraDraft.set(valor);
    this.cambiarMetadatos();
  }

  async guardarMetadatos(): Promise<void> {
    const current = this.ticket();
    if (!current || !this.metadatosCambiados() || this.metadatosGuardando()) return;
    const input: { store?: string | null; purchaseDate?: string | null } = {};
    const store = this.tiendaDraft().trim() || null;
    const purchaseDate = this.fechaCompraDraft() || null;
    if (store !== current.store) input.store = store;
    if (purchaseDate !== current.purchaseDate) input.purchaseDate = purchaseDate;

    this.metadatosGuardando.set(true);
    this.metadatosGuardados.set(false);
    this.errorMetadatos.set(false);
    const updated = await this.service.updateReceipt(this.id, input);
    this.metadatosGuardando.set(false);
    if (!updated) {
      this.errorMetadatos.set(true);
      return;
    }
    this.metadatosGuardados.set(true);
  }

  async guardarNotas(valor: string): Promise<void> {
    await this.service.updateReceipt(this.id, { notes: valor.trim() || null });
  }

  async editarLinea(linea: LineaEnPantalla, cambios: Partial<ReceiptItem>): Promise<void> {
    const actualizada = await this.service.updateLine(this.id, linea.id, cambios);
    if (!actualizada) return;
    this.service.loadReceipt(this.id);
  }

  /** La oferta se escribe como se lee: «3x2». Vacio la quita. */
  async editarOferta(linea: LineaEnPantalla, texto: string): Promise<void> {
    const pareja = texto.trim().match(/^(\d+)\s*[xX]\s*(\d+)$/);
    const oferta = pareja ? { buy: Number(pareja[1]), take: Number(pareja[2]) } : null;
    await this.editarLinea(linea, { offer: oferta });
  }

  ofertaTexto(linea: ReceiptItem): string {
    return linea.offer ? `${linea.offer.buy}x${linea.offer.take}` : '';
  }

  async quitarLinea(linea: LineItem): Promise<void> {
    // Borrar una linea pasa por el dialogo de la casa (regla de check:ui): un clic en la
    // crucecita no puede perder una lectura de la IA sin pregunta.
    const aceptado = await this.confirm.confirm({
      title: this.i18n.t('receipts.borrar_linea'),
      message: linea.name,
      confirmText: this.i18n.t('common.delete'),
      variant: 'danger'
    });
    if (!aceptado) return;
    await this.service.deleteLine(this.id, linea.id);
    this.service.loadReceipt(this.id);
  }

  async anadirLinea(): Promise<void> {
    const creada = await this.service.addLine(this.id, {
      name: this.i18n.t('receipts.nombre'),
      quantity: 1,
      category: 'other'
    });
    this.service.loadReceipt(this.id);
    if (creada) this.ultimaNueva.set(creada.id);
  }

  // ------------------------------------------------------- parar / borrar

  async parar(): Promise<void> {
    await this.service.stopJob(this.id);
    this.service.loadReceipt(this.id);
  }

  async reintentar(): Promise<void> {
    await this.service.retryJob(this.id);
    this.service.loadReceipt(this.id);
    this.arrancarPoll();
  }

  async borrar(): Promise<void> {
    const aceptado = await this.confirm.confirm({
      title: this.i18n.t('receipts.borrar_el_ticket'),
      message: this.ticket()?.store ?? this.ticket()?.fileName ?? '',
      confirmText: this.i18n.t('common.delete'),
      variant: 'danger'
    });
    if (!aceptado) return;
    await this.service.deleteReceipt(this.id);
    this.toast.info(this.i18n.t('receipts.ticket_borrado'));
    void this.router.navigate(['/receipts']);
  }

  // ------------------------------------------------------------- confirmar

  async confirmar(): Promise<void> {
    if (this.confirmando()) return;
    this.confirmando.set(true);
    const resultado = await this.service.confirm(this.id);
    this.confirmando.set(false);
    if (resultado) {
      this.resultado.set(resultado);
      this.service.loadReceipt(this.id);
      this.toast.success(
        this.i18n.t('receipts.confirmado'),
        this.i18n.t('receipts.ver_inventario')
      );
    }
  }

  // ------------------------------------------------------------------ utils

  centimosDe(texto: string): number | null {
    if (!texto.trim()) return null;
    const valor = Number(texto.replace(',', '.'));
    return Number.isFinite(valor) ? Math.round(valor * 100) : null;
  }

  numeroDe(texto: string): number {
    const valor = Number(texto.replace(',', '.'));
    return Number.isFinite(valor) && valor > 0 ? valor : 1;
  }
}

type LineItem = ReceiptItem;
