import {
  Component,
  EventEmitter,
  Input,
  OnChanges,
  Output,
  SimpleChanges,
  inject,
  signal
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ShoppingService } from '../../core/services/shopping.service';
import { ButtonComponent } from '../../shared/components/ui/button/button.component';
import { ModalComponent } from '../../shared/components/ui/modal/modal.component';
import { TranslatePipe } from '../../core/pipes/translate.pipe';
import type { TranslationKey } from '../../core/i18n';
import type {
  ShoppingLocationCandidate,
  ShoppingLocationSelection
} from '../../shared/models/shopping.model';

type FlowStage = 'prompt' | 'results' | 'manual';
type FlowMode = 'prompt' | 'edit';

@Component({
  selector: 'app-shopping-location-flow',
  standalone: true,
  imports: [CommonModule, FormsModule, ButtonComponent, ModalComponent, TranslatePipe],
  template: `
    <app-modal
      [isOpen]="isOpen"
      [title]="
        (initialMode === 'prompt'
          ? 'shopping_list_detail.anadir_ubicacion_producto'
          : 'shopping_list_detail.editar_ubicacion_producto'
        ) | t
      "
      descriptionId="shopping-location-description"
      size="md"
      [closable]="!saving()"
      [closeOnOverlay]="false"
      [adaptToVisualViewport]="true"
      [safeAreaAware]="true"
      (onClose)="close()"
    >
      @if (stage() === 'prompt') {
        <div class="location-flow__content" data-test="location-prompt">
          <p id="shopping-location-description" class="location-flow__copy">
            {{ 'shopping_list_detail.ubicacion_consentimiento' | t }}
          </p>
          <div class="location-flow__actions">
            <app-button
              data-test="location-skip"
              [fullWidth]="true"
              [touchTarget]="true"
              variant="ghost"
              (onClick)="close()"
            >
              {{ 'shopping_list_detail.ahora_no' | t }}
            </app-button>
            <app-button
              data-test="location-accept"
              [fullWidth]="true"
              [touchTarget]="true"
              variant="primary"
              (onClick)="detectNearby()"
            >
              {{ 'shopping_list_detail.buscar_establecimientos_cerca' | t }}
            </app-button>
          </div>
        </div>
      } @else if (stage() === 'results') {
        <div class="location-flow__content" data-test="location-results">
          <p id="shopping-location-description" class="location-flow__copy">
            {{ 'shopping_list_detail.selecciona_el_establecimiento' | t }}
          </p>
          @if (finding()) {
            <p class="location-flow__status" role="status" aria-live="polite">
              {{ 'shopping_list_detail.buscando_establecimientos' | t }}
            </p>
          }
          <ul class="location-flow__candidates">
            @for (candidate of candidates(); track candidate.id) {
              <li>
                <button
                  type="button"
                  class="location-flow__candidate"
                  [disabled]="saving()"
                  [attr.aria-label]="candidate.name + ', ' + candidate.distanceMeters + ' m'"
                  data-test="location-candidate"
                  (click)="choose(candidate)"
                >
                  <span class="location-flow__candidate-name">{{ candidate.name }}</span>
                  @if (candidate.address) {
                    <span class="location-flow__candidate-address">{{ candidate.address }}</span>
                  }
                  <span class="location-flow__candidate-distance">
                    {{
                      'shopping_list_detail.distancia_establecimiento'
                        | t: { distance: candidate.distanceMeters }
                    }}
                  </span>
                </button>
              </li>
            }
          </ul>
          @if (openStreetMapAttribution(); as attribution) {
            <p class="location-flow__attribution">
              <a [href]="attribution.url" target="_blank" rel="noopener noreferrer">
                {{ attribution.text }}
              </a>
            </p>
          }
          <div class="location-flow__actions">
            <app-button
              data-test="location-manual"
              [fullWidth]="true"
              [touchTarget]="true"
              variant="secondary"
              (onClick)="openManual()"
            >
              {{ 'shopping_list_detail.escribir_establecimiento' | t }}
            </app-button>
            <app-button
              data-test="location-cancel"
              [fullWidth]="true"
              [touchTarget]="true"
              variant="ghost"
              (onClick)="close()"
            >
              {{ 'common.cancel' | t }}
            </app-button>
          </div>
        </div>
      } @else {
        <form
          class="location-flow__content"
          data-test="location-manual-form"
          (ngSubmit)="saveManual()"
        >
          <p id="shopping-location-description" class="location-flow__copy">
            {{ 'shopping_list_detail.ubicacion_manual_pista' | t }}
          </p>
          @if (errorKey()) {
            <p class="location-flow__notice" role="status" data-test="location-fallback">
              {{ errorKey()! | t }}
            </p>
          }
          <label class="location-flow__field" for="shopping-location-name">
            <span>{{ 'shopping_list_detail.nombre_establecimiento' | t }}</span>
            <input
              id="shopping-location-name"
              name="locationName"
              type="text"
              maxlength="120"
              required
              [value]="name"
              (input)="name = inputValue($event)"
              data-test="location-name"
            />
          </label>
          <label class="location-flow__field" for="shopping-location-address">
            <span>{{ 'shopping_list_detail.direccion_establecimiento' | t }}</span>
            <input
              id="shopping-location-address"
              name="locationAddress"
              type="text"
              maxlength="240"
              [value]="address"
              (input)="address = inputValue($event)"
              data-test="location-address"
            />
          </label>
          <div class="location-flow__actions location-flow__actions--stack">
            <app-button
              type="submit"
              data-test="location-save-manual"
              [fullWidth]="true"
              [touchTarget]="true"
              variant="primary"
              [disabled]="!name.trim() || saving()"
              [loading]="saving()"
            >
              {{ 'shopping_list_detail.guardar_ubicacion' | t }}
            </app-button>
            <app-button
              data-test="location-detect-manual"
              [fullWidth]="true"
              [touchTarget]="true"
              variant="secondary"
              [disabled]="finding() || saving()"
              [loading]="finding()"
              (onClick)="detectNearby()"
            >
              {{ 'shopping_list_detail.detectar_establecimiento_cerca' | t }}
            </app-button>
            <app-button
              data-test="location-cancel"
              [fullWidth]="true"
              [touchTarget]="true"
              variant="ghost"
              (onClick)="close()"
            >
              {{ 'common.cancel' | t }}
            </app-button>
          </div>
        </form>
      }
    </app-modal>
  `,
  styles: [
    `
      .location-flow__content {
        display: grid;
        gap: var(--space-4);
        min-width: 0;
      }

      .location-flow__copy,
      .location-flow__status,
      .location-flow__notice {
        margin: 0;
        color: var(--text-secondary);
        font-size: var(--text-sm);
        line-height: var(--leading-relaxed);
      }

      .location-flow__field {
        display: grid;
        gap: var(--space-1);
        color: var(--text-secondary);
        font-size: var(--text-sm);
      }

      .location-flow__field input {
        box-sizing: border-box;
        width: 100%;
        min-width: 0;
        min-height: 48px;
        padding: var(--space-3);
        border: 1px solid var(--border-default);
        border-radius: var(--radius-lg);
        background: var(--bg-primary);
        color: var(--text-primary);
        font: inherit;
      }

      .location-flow__field input:focus-visible {
        outline: 2px solid var(--primary);
        outline-offset: 2px;
      }

      .location-flow__notice {
        border-radius: var(--radius-md);
        padding: var(--space-3);
        background: var(--warning-subtle);
        color: var(--text-primary);
      }

      .location-flow__actions {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        align-items: stretch;
        gap: var(--space-2);
      }

      .location-flow__actions app-button {
        min-width: 0;
      }

      .location-flow__candidates {
        display: grid;
        gap: var(--space-2);
        list-style: none;
        margin: 0;
        padding: 0;
      }

      .location-flow__candidate {
        display: grid;
        gap: var(--space-1);
        width: 100%;
        min-height: 56px;
        padding: var(--space-3);
        border: 1px solid var(--border-default);
        border-radius: var(--radius-lg);
        color: var(--text-primary);
        background: var(--bg-primary);
        text-align: left;
        cursor: pointer;
      }

      .location-flow__candidate:hover:not(:disabled) {
        border-color: var(--primary);
        background: var(--primary-subtle);
      }

      .location-flow__candidate:focus-visible {
        outline: 2px solid var(--primary);
        outline-offset: 2px;
      }

      .location-flow__candidate-name {
        font-weight: var(--font-semibold);
      }

      .location-flow__candidate-address,
      .location-flow__candidate-distance,
      .location-flow__attribution {
        color: var(--text-tertiary);
        font-size: var(--text-xs);
      }

      .location-flow__attribution {
        margin: 0;
      }

      .location-flow__attribution a {
        color: inherit;
        text-decoration: underline;
        text-underline-offset: 2px;
      }

      .location-flow__actions--stack {
        grid-template-columns: 1fr;
      }

      @media (max-width: 420px) {
        .location-flow__actions {
          grid-template-columns: 1fr;
        }
      }
    `
  ]
})
export class ShoppingLocationFlowComponent implements OnChanges {
  @Input() listId = '';
  @Input() itemIds: string[] = [];
  @Input() isOpen = false;
  @Input() initialMode: FlowMode = 'prompt';
  @Input() currentName = '';
  @Input() currentAddress = '';
  @Output() closed = new EventEmitter<void>();
  @Output() saved = new EventEmitter<void>();

  private readonly shopping = inject(ShoppingService);
  readonly stage = signal<FlowStage>('prompt');
  readonly finding = signal(false);
  readonly saving = signal(false);
  readonly candidates = signal<ShoppingLocationCandidate[]>([]);
  readonly errorKey = signal<TranslationKey | null>(null);
  name = '';
  address = '';
  private flowActive = false;

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['isOpen']?.currentValue === true || (changes['initialMode'] && this.isOpen)) {
      this.resetFlow();
      return;
    }
    if (changes['currentName'] && this.isOpen) this.name = this.currentName;
    if (changes['currentAddress'] && this.isOpen) this.address = this.currentAddress;
  }

  async detectNearby(): Promise<void> {
    if (this.finding() || this.saving()) return;
    this.errorKey.set(null);
    this.candidates.set([]);
    const geolocation = globalThis.navigator?.geolocation;
    if (!geolocation) {
      this.openManualWithError('shopping_list_detail.geolocalizacion_no_disponible');
      return;
    }

    this.finding.set(true);
    try {
      geolocation.getCurrentPosition(
        (position) => {
          void this.lookup(position.coords.latitude, position.coords.longitude);
        },
        () => {
          this.finding.set(false);
          if (this.flowActive) {
            this.openManualWithError('shopping_list_detail.geolocalizacion_no_autorizada');
          }
        },
        { enableHighAccuracy: false, timeout: 8000, maximumAge: 60_000 }
      );
    } catch {
      this.finding.set(false);
      this.openManualWithError('shopping_list_detail.geolocalizacion_no_disponible');
    }
  }

  openManual(): void {
    this.errorKey.set(null);
    this.stage.set('manual');
  }

  async choose(candidate: ShoppingLocationCandidate): Promise<void> {
    if (candidate.source === 'registered') {
      await this.persist({ source: 'registered', id: candidate.id });
    } else {
      await this.persist({
        source: 'openstreetmap',
        name: candidate.name,
        address: candidate.address,
        latitude: candidate.latitude,
        longitude: candidate.longitude
      });
    }
  }

  async saveManual(): Promise<void> {
    const name = this.name.trim();
    if (!name || this.saving()) return;
    await this.persist({
      source: 'manual',
      name,
      address: this.address.trim() || null
    });
  }

  close(): void {
    this.flowActive = false;
    this.finding.set(false);
    this.closed.emit();
  }

  inputValue(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }

  openStreetMapAttribution(): { text: string; url: string } | null {
    const candidate = this.candidates().find((entry) => entry.attribution && entry.attributionUrl);
    return candidate ? { text: candidate.attribution!, url: candidate.attributionUrl! } : null;
  }

  private resetFlow(): void {
    this.flowActive = true;
    this.stage.set(this.initialMode === 'prompt' ? 'prompt' : 'manual');
    this.finding.set(false);
    this.saving.set(false);
    this.candidates.set([]);
    this.errorKey.set(null);
    this.name = this.currentName;
    this.address = this.currentAddress;
  }

  private async lookup(latitude: number, longitude: number): Promise<void> {
    if (!this.flowActive) return;
    const result = await this.shopping.searchNearbyStores(this.listId, latitude, longitude, 500);
    this.finding.set(false);
    if (!this.flowActive) return;
    if (result?.status === 'ok' && result.candidates.length) {
      this.candidates.set(result.candidates);
      this.stage.set('results');
      return;
    }
    const key =
      result?.status === 'ok'
        ? 'shopping_list_detail.no_se_encontraron_establecimientos'
        : 'shopping_list_detail.deteccion_no_disponible';
    this.openManualWithError(key);
  }

  private openManualWithError(key: TranslationKey): void {
    this.finding.set(false);
    this.errorKey.set(key);
    this.stage.set('manual');
  }

  private async persist(store: ShoppingLocationSelection): Promise<void> {
    if (this.saving() || !this.flowActive) return;
    this.saving.set(true);
    const result = await this.shopping.saveItemLocations(this.listId, this.itemIds, store);
    this.saving.set(false);
    if (!this.flowActive) return;
    if (result === null) {
      this.errorKey.set('shopping_list_detail.no_se_pudo_guardar_ubicacion');
      this.stage.set('manual');
      return;
    }
    this.flowActive = false;
    this.saved.emit();
    this.closed.emit();
  }
}
