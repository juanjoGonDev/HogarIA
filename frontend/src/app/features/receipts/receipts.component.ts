import { Component, effect, inject, signal, OnInit, OnDestroy } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { formatDateTime, formatShortDay } from '../../core/time';
import { ReceiptsService } from '../../core/services/receipts.service';
import { I18nService } from '../../core/services/i18n.service';
import { IconComponent } from '../../shared/components/ui/icon/icon.component';
import { ButtonComponent } from '../../shared/components/ui/button/button.component';
import { BadgeComponent } from '../../shared/components/ui/badge/badge.component';
import { LoadingComponent } from '../../shared/components/ui/loading/loading.component';
import { TranslatePipe } from '../../core/pipes/translate.pipe';
import type { TranslationKey } from '../../core/i18n';
import type { Receipt, ReceiptStatus } from '../../shared/models/receipt.model';

/**
 * La bandeja de tickets (HOGARIA-SPEC ## 12aj).
 *
 * Subir es lo primero: un recuadro grande que acepta arrastrar o elegir —imagen o PDF, que
 * la firma la valida el server— y al soltar el ticket YA está en la cola local de IA; la
 * bandeja lo enseña con su estado del pipeline y el icono de la cabecera empieza a girar.
 * El resto (líneas, tienda, confirmar) vive en la ficha.
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

@Component({
  selector: 'app-receipts',
  standalone: true,
  imports: [
    CommonModule,
    RouterLink,
    DatePipe,
    IconComponent,
    ButtonComponent,
    BadgeComponent,
    LoadingComponent,
    TranslatePipe
  ],
  template: `
    <div class="tickets">
      <header class="tickets__head">
        <h1 class="tickets__title">{{ 'receipts.titulo' | t }}</h1>
        <p class="tickets__subtitle">{{ 'receipts.subtitulo' | t }}</p>
      </header>

      <!-- La subida: arrastrar o elegir. La firma del fichero (png/jpg/webp/pdf) la valida el
           server; aqui solo se mira el tamano para no subir diez megas en balde. -->
      <label
        class="tickets__drop"
        [class.tickets__drop--over]="arrastrando()"
        [class.tickets__drop--busy]="subiendo()"
        data-test="ticket-drop"
        (dragover)="alArrastrar($event, true)"
        (dragleave)="alArrastrar($event, false)"
        (drop)="alSoltar($event)"
      >
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp,application/pdf"
          name="ticketFile"
          [disabled]="subiendo()"
          (change)="elegir($event)"
        />
        <app-icon name="description" [size]="28" [label]="null" />
        <span class="tickets__drop-title">
          @if (subiendo()) {
            {{ 'receipts.subiendo' | t }}
          } @else {
            {{ 'receipts.suelta_el_ticket_aqui' | t }} — {{ 'receipts.o_elige_el_fichero' | t }}
          }
        </span>
        <span class="tickets__drop-hint">{{ 'receipts.formatos_y_tamano' | t }}</span>
      </label>

      @if (errorSubida()) {
        <p class="tickets__error" data-test="ticket-upload-error">{{ errorSubida() }}</p>
      }

      @if (
        !service.loading() &&
        !service.historyLoading() &&
        service.receipts().length === 0 &&
        service.history().length === 0
      ) {
        <div class="tickets__vacio">
          <span class="tickets__vacio-title">{{ 'receipts.sin_tickets' | t }}</span>
          <span class="tickets__vacio-hint">{{ 'receipts.sin_tickets_hint' | t }}</span>
        </div>
      }

      @if (service.receipts().length > 0) {
        <section class="tickets__seccion" aria-labelledby="tickets-active-heading">
          <h2 class="tickets__section-title" id="tickets-active-heading">
            {{ 'receipts.en_curso' | t }}
          </h2>
          <ul class="tickets__lista">
            @for (ticket of service.receipts(); track ticket.id) {
              <li class="ticket" [attr.data-test]="'ticket-' + ticket.status">
                <a class="ticket__main" [routerLink]="['/receipts', ticket.id]">
                  <span class="ticket__icono">
                    <app-icon
                      [name]="ticket.fileKind === 'pdf' ? 'description' : 'receipt_long'"
                      [size]="20"
                      [label]="null"
                    />
                  </span>
                  <span class="ticket__datos">
                    <span class="ticket__nombre">{{
                      ticket.store || ticket.fileName || ('receipts.abrir_ticket' | t)
                    }}</span>
                    <span class="ticket__meta">
                      {{ 'receipts.subido' | t }}: {{ ticket.createdAt | date: 'short' }} ·
                      {{
                        ticket.items === 1
                          ? ('receipts.una_linea' | t)
                          : ('receipts.lineas' | t: { n: ticket.items })
                      }}
                    </span>
                  </span>
                </a>
                <div class="ticket__lado">
                  @if (ticket.totalMinor !== null) {
                    <span class="ticket__total"
                      >{{ ticket.totalMinor / 100 | number: '1.2-2' }} €</span
                    >
                  }
                  <app-badge [variant]="variante(ticket.status)">{{
                    estado(ticket.status) | t
                  }}</app-badge>
                </div>
              </li>
            }
          </ul>
        </section>
      }

      <section
        class="tickets__seccion"
        aria-labelledby="tickets-history-heading"
        data-test="receipt-history"
      >
        <h2 class="tickets__section-title" id="tickets-history-heading">
          {{ 'receipts.historial' | t }}
        </h2>
        @if (service.history().length > 0) {
          <ul class="tickets__lista">
            @for (ticket of service.history(); track ticket.id) {
              <li class="ticket" data-test="ticket-history-item">
                <a class="ticket__main" [routerLink]="['/receipts', ticket.id]">
                  <span class="ticket__icono">
                    <app-icon
                      [name]="ticket.fileKind === 'pdf' ? 'description' : 'receipt_long'"
                      [size]="20"
                      [label]="null"
                    />
                  </span>
                  <span class="ticket__datos">
                    <span class="ticket__nombre">{{
                      ticket.store || ticket.fileName || ('receipts.abrir_ticket' | t)
                    }}</span>
                    <span class="ticket__meta">
                      {{ 'receipts.fecha_compra' | t }}:
                      {{
                        ticket.purchaseDate
                          ? formatPurchaseDate(ticket.purchaseDate)
                          : ('receipts.fecha_no_detectada' | t)
                      }}
                      · {{ 'receipts.subido' | t }}: {{ formatUploadDate(ticket.createdAt) }} ·
                      {{
                        ticket.items === 1
                          ? ('receipts.una_linea' | t)
                          : ('receipts.lineas' | t: { n: ticket.items })
                      }}
                    </span>
                  </span>
                </a>
                <div class="ticket__lado">
                  @if (ticket.totalMinor !== null) {
                    <span class="ticket__total"
                      >{{ ticket.totalMinor / 100 | number: '1.2-2' }} €</span
                    >
                  }
                  <app-badge [variant]="variante(ticket.status)">{{
                    estado(ticket.status) | t
                  }}</app-badge>
                </div>
              </li>
            }
          </ul>
        } @else if (!service.historyLoading() && !service.historyError()) {
          <p class="tickets__history-empty">{{ 'receipts.historial_vacio' | t }}</p>
        }
        @if (service.historyError()) {
          <div class="tickets__history-error" role="alert">
            <span>{{ 'receipts.historial_error' | t }}</span>
            <app-button
              variant="outline"
              size="sm"
              type="button"
              (onClick)="service.retryHistory()"
            >
              {{ 'receipts.reintentar_historial' | t }}
            </app-button>
          </div>
        }
        @if (service.historyHasMore()) {
          <app-button
            variant="outline"
            type="button"
            [loading]="service.historyLoading()"
            (onClick)="service.loadMoreHistory()"
            data-test="load-more-history"
          >
            {{ 'receipts.cargar_mas_historial' | t }}
          </app-button>
        }
      </section>

      @if (
        (service.loading() && service.receipts().length === 0) ||
        (service.historyLoading() && service.history().length === 0)
      ) {
        <app-loading />
      }
    </div>
  `,
  styles: [
    `
      .tickets {
        display: grid;
        gap: var(--space-4, 16px);
        max-width: 760px;
        margin: 0 auto;
        padding-block: var(--container-padding);
      }

      .tickets__head {
        display: grid;
        gap: 4px;
      }

      .tickets__seccion {
        display: grid;
        gap: var(--space-3, 12px);
      }

      .tickets__section-title {
        margin: 0;
        font-size: var(--text-lg, 18px);
        font-weight: var(--font-semibold, 600);
        color: var(--text-primary);
      }

      .tickets__title {
        margin: 0;
        font-size: var(--text-2xl, 24px);
        font-weight: var(--font-bold, 700);
        color: var(--text-primary);
      }

      .tickets__subtitle {
        margin: 0;
        font-size: var(--text-sm, 14px);
        color: var(--text-secondary);
      }

      .tickets__drop {
        display: grid;
        justify-items: center;
        gap: 6px;
        padding: var(--space-6, 28px) var(--space-4, 16px);
        border: 2px dashed var(--border-default, #d5d9e0);
        border-radius: var(--radius-lg, 14px);
        background: var(--bg-secondary, #f7f8fa);
        color: var(--text-secondary);
        cursor: pointer;
        text-align: center;
        transition:
          border-color 0.15s ease,
          background 0.15s ease;
      }

      .tickets__drop:hover,
      .tickets__drop--over {
        border-color: var(--primary, #4f7df9);
        background: color-mix(in srgb, var(--primary, #4f7df9) 6%, var(--bg-secondary, #f7f8fa));
      }

      .tickets__drop--busy {
        opacity: 0.7;
        pointer-events: none;
      }

      .tickets__drop input {
        position: absolute;
        width: 1px;
        height: 1px;
        opacity: 0;
        pointer-events: none;
      }

      .tickets__drop-title {
        font-size: var(--text-base, 16px);
        font-weight: var(--font-medium, 500);
        color: var(--text-primary);
      }

      .tickets__drop-hint {
        font-size: var(--text-xs, 12px);
        color: var(--text-tertiary, #9aa1ab);
      }

      .tickets__error {
        margin: 0;
        padding: var(--space-2, 8px) var(--space-3, 12px);
        border-radius: var(--radius-md, 10px);
        background: color-mix(in srgb, var(--danger, #d64545) 10%, transparent);
        color: var(--danger, #d64545);
        font-size: var(--text-sm, 14px);
      }

      .tickets__vacio {
        display: grid;
        gap: 4px;
        padding: var(--space-6, 28px) 0;
        text-align: center;
      }

      .tickets__vacio-title {
        font-size: var(--text-base, 16px);
        font-weight: var(--font-medium, 500);
        color: var(--text-primary);
      }

      .tickets__vacio-hint {
        font-size: var(--text-sm, 14px);
        color: var(--text-secondary);
      }

      .tickets__history-empty,
      .tickets__history-error {
        margin: 0;
        font-size: var(--text-sm, 14px);
        color: var(--text-secondary);
      }

      .tickets__history-error {
        display: flex;
        align-items: center;
        justify-content: space-between;
        flex-wrap: wrap;
        gap: var(--space-2, 8px);
        color: var(--danger, #d64545);
      }

      .tickets__lista {
        list-style: none;
        margin: 0;
        padding: 0;
        display: grid;
        gap: var(--space-2, 8px);
      }

      .ticket {
        display: flex;
        align-items: center;
        gap: var(--space-3, 12px);
        padding: var(--space-3, 12px);
        border: 1px solid var(--border-default, #e2e5ea);
        border-radius: var(--radius-lg, 12px);
        background: var(--bg-primary, #fff);
      }

      .ticket__main {
        flex: 1;
        min-width: 0;
        display: flex;
        align-items: center;
        gap: var(--space-3, 12px);
        text-decoration: none;
        color: inherit;
      }

      .ticket__icono {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 40px;
        height: 40px;
        flex: none;
        border-radius: var(--radius-md, 10px);
        background: var(--bg-tertiary, #eef0f3);
        color: var(--text-secondary);
      }

      .ticket__datos {
        display: grid;
        gap: 2px;
        min-width: 0;
      }

      .ticket__nombre {
        font-size: var(--text-base, 16px);
        font-weight: var(--font-medium, 500);
        color: var(--text-primary);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .ticket__meta {
        font-size: var(--text-xs, 12px);
        color: var(--text-secondary);
      }

      .ticket__lado {
        display: flex;
        align-items: center;
        gap: var(--space-2, 8px);
        flex: none;
      }

      .ticket__total {
        font-size: var(--text-sm, 14px);
        font-weight: var(--font-semibold, 600);
        color: var(--text-primary);
      }

      @media (max-width: 480px) {
        .ticket__lado {
          flex-direction: column;
          align-items: flex-end;
          gap: 4px;
        }
      }
    `
  ]
})
export class ReceiptsComponent implements OnInit, OnDestroy {
  readonly service = inject(ReceiptsService);

  formatPurchaseDate(value: string | null): string {
    return formatShortDay(value);
  }

  formatUploadDate(value: string): string {
    return formatDateTime(value);
  }

  /**
   * La bandeja se repinta sola cuando la cola se mueve: al fallar o terminar una lectura, el
   * estado del ticket en la lista cambia («En cola» → «Falló») sin que nadie recargue. La
   * firma (id:estado de cada trabajo) es lo que detecta el movimiento —que haya fallado uno
   * no cambia el numero de trabajos, cambia su estado—. El effect va en el constructor, que
   * es donde vive el contexto de inyeccion.
   */
  private firmaDeCola = '';
  private readonly vigilante = effect(() => {
    const firma = this.service
      .queue()
      .jobs.map((trabajo) => `${trabajo.id}:${trabajo.status}`)
      .join('|');
    if (firma === this.firmaDeCola) return;
    const primera = this.firmaDeCola === '';
    this.firmaDeCola = firma;
    // La primera foto de la cola no dispara una recarga: ambas secciones ya se están cargando.
    if (!primera) {
      this.service.loadReceipts();
      this.service.loadHistory();
    }
  });

  readonly arrastrando = signal(false);
  readonly subiendo = signal(false);
  readonly errorSubida = signal<string | null>(null);

  ngOnInit(): void {
    this.service.watch();
    this.service.loadReceipts();
    this.service.loadHistory();
  }

  ngOnDestroy(): void {
    this.service.unwatch();
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

  alArrastrar(event: DragEvent, encima: boolean): void {
    event.preventDefault();
    this.arrastrando.set(encima);
  }

  alSoltar(event: DragEvent): void {
    event.preventDefault();
    this.arrastrando.set(false);
    const fichero = event.dataTransfer?.files?.[0];
    if (fichero) void this.subir(fichero);
  }

  elegir(event: Event): void {
    const input = event.target as HTMLInputElement;
    const fichero = input.files?.[0];
    if (fichero) void this.subir(fichero);
    input.value = '';
  }

  private async subir(fichero: File): Promise<void> {
    this.errorSubida.set(null);
    if (!/^(image\/(png|jpe?g|webp)|application\/pdf)$/.test(fichero.type)) {
      this.errorSubida.set(this.translate('receipts.eso_no_es_un_ticket'));
      return;
    }
    if (fichero.size > 10 * 1024 * 1024) {
      this.errorSubida.set(this.translate('receipts.pesa_demasiado'));
      return;
    }
    this.subiendo.set(true);
    const subido = await this.service.upload(fichero);
    this.subiendo.set(false);
    if (subido) {
      this.service.loadReceipts();
      // La primera lectura de la cola puede llegar cuando el trabajo ya está creado y no
      // dispara el efecto de cambios; recarga también el historial tras aceptar el fichero.
      this.service.loadHistory();
      void this.service.refreshQueue().subscribe(() => undefined);
    } else {
      this.errorSubida.set(this.translate('receipts.no_se_ha_podido'));
    }
  }

  private readonly i18n = inject(I18nService);

  private translate(
    key: 'receipts.eso_no_es_un_ticket' | 'receipts.pesa_demasiado' | 'receipts.no_se_ha_podido'
  ): string {
    return this.i18n.t(key);
  }
}
