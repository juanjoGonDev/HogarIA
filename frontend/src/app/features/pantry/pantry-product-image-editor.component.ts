import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, OnInit, Output, computed, inject, signal } from '@angular/core';
import { HouseholdService } from '../../core/services/household.service';
import { I18nService } from '../../core/services/i18n.service';
import { PantryService } from '../../core/services/pantry.service';
import { ToastService } from '../../core/services/toast.service';
import { TranslatePipe } from '../../core/pipes/translate.pipe';
import { ButtonComponent } from '../../shared/components/ui/button/button.component';
import { IconComponent } from '../../shared/components/ui/icon/icon.component';
import { CatalogLabelPipe } from '../../shared/pipes/catalog-label.pipe';
import type { PantryProduct, ProductImageSearchView } from '../../shared/models/pantry.model';

type ImageProduct = Pick<PantryProduct, 'id' | 'name' | 'image'>;

@Component({
  selector: 'app-pantry-product-image-editor',
  standalone: true,
  imports: [CommonModule, TranslatePipe, ButtonComponent, IconComponent, CatalogLabelPipe],
  template: `
    <section class="item__imagen" aria-labelledby="item-imagen-titulo" data-test="item-imagen">
      <div class="item__imagen-cabecera">
        <div>
          <h2 id="item-imagen-titulo" class="item__grafica-titulo">{{ 'pantry.item_image_title' | t }}</h2>
          <p class="item__imagen-ayuda">{{ 'pantry.item_image_help' | t }}</p>
        </div>
        @if (producto.image) {
          <img class="item__imagen-actual" [src]="producto.image" [alt]="producto.name | catalog" loading="lazy" />
        } @else {
          <div class="item__imagen-vacia" aria-hidden="true">
            <app-icon name="image" [size]="24" [label]="null" />
          </div>
        }
      </div>

      @if (puedeEditar()) {
        <div class="item__imagen-acciones">
          @if (estadoImagen().status === 'queued' || estadoImagen().status === 'running') {
            <span class="item__imagen-estado" role="status">{{ 'pantry.item_image_busy' | t }}</span>
            <app-button size="sm" variant="outline" (onClick)="cancelarBusquedaImagen()">
              {{ 'pantry.item_image_cancel' | t }}
            </app-button>
          } @else {
            <app-button size="sm" variant="outline" (onClick)="buscarImagenes()">
              {{ estadoImagen().status === 'failed' || estadoImagen().status === 'cancelled' ? ('pantry.item_image_retry' | t) : ('pantry.item_image_search' | t) }}
            </app-button>
          }
          <app-button size="sm" variant="outline" (onClick)="imageUpload.click()">
            {{ 'pantry.item_image_upload' | t }}
          </app-button>
          <input
            #imageUpload
            type="file"
            accept="image/jpeg,image/png,image/webp"
            class="item__imagen-archivo"
            (change)="subirImagen($event)"
            [attr.aria-label]="'pantry.item_image_upload' | t"
          />
        </div>
      }

      @if (estadoImagen().status === 'failed') {
        <p class="item__imagen-error" role="status">{{ 'pantry.item_image_failed' | t }}</p>
      } @else if (estadoImagen().status === 'complete' && estadoImagen().candidates.length === 0) {
        <p class="item__imagen-ayuda" role="status">{{ 'pantry.item_image_empty' | t }}</p>
      }

      @if (estadoImagen().candidates.length > 0) {
        <ul class="item__imagen-resultados" [attr.aria-label]="'pantry.item_image_results' | t">
          @for (candidate of estadoImagen().candidates; track candidate.id) {
            <li class="item__imagen-candidato">
              <img [src]="candidate.previewUrl" [alt]="candidate.altText" loading="lazy" />
              <p class="item__imagen-autor">{{ candidate.author }} · {{ candidate.licenseName }}</p>
              <div class="item__imagen-enlaces">
                <a [href]="candidate.sourceUrl" target="_blank" rel="noopener noreferrer">{{ 'pantry.item_image_source' | t }}</a>
                @if (puedeEditar()) {
                  <app-button size="sm" variant="primary" (onClick)="seleccionarImagen(candidate.id)">
                    {{ 'pantry.item_image_select' | t }}
                  </app-button>
                }
              </div>
            </li>
          }
        </ul>
      }
    </section>
  `,
  styles: [`
    .item__imagen h2 { margin: 0; font-size: var(--text-lg); }
    .item__imagen {
      display: flex;
      flex-direction: column;
      gap: var(--space-3);
      border: 1px solid var(--border-default);
      border-radius: var(--radius-lg);
      padding: var(--space-4);
      background: var(--bg-secondary);
    }
    .item__imagen-cabecera {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: var(--space-4);
    }
    .item__imagen-ayuda,
    .item__imagen-estado,
    .item__imagen-error,
    .item__imagen-autor {
      margin: var(--space-1) 0 0;
      color: var(--text-secondary);
      font-size: var(--text-sm);
    }
    .item__imagen-error { color: var(--error); }
    .item__imagen-actual {
      width: min(180px, 36%);
      max-height: 132px;
      object-fit: cover;
      border: 1px solid var(--border-default);
      border-radius: var(--radius-md);
    }
    .item__imagen-vacia {
      width: 64px;
      height: 64px;
      display: grid;
      place-items: center;
      color: var(--text-tertiary);
      background: var(--bg-tertiary);
      border-radius: var(--radius-md);
    }
    .item__imagen-acciones,
    .item__imagen-enlaces {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--space-2);
    }
    .item__imagen-archivo { display: none; }
    .item__imagen-resultados {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
      gap: var(--space-3);
      padding: 0;
      margin: 0;
      list-style: none;
    }
    .item__imagen-candidato {
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: var(--space-2);
      padding: var(--space-2);
      border: 1px solid var(--border-default);
      border-radius: var(--radius-md);
      background: var(--bg-primary);
    }
    .item__imagen-candidato > img {
      width: 100%;
      aspect-ratio: 4 / 3;
      object-fit: cover;
      border-radius: var(--radius-sm);
    }
    .item__imagen-autor { overflow-wrap: anywhere; }
  `]
})
export class PantryProductImageEditorComponent implements OnInit {
  @Input({ required: true }) producto!: ImageProduct;
  @Output() readonly imageChange = new EventEmitter<string>();

  private readonly pantry = inject(PantryService);
  private readonly household = inject(HouseholdService);
  private readonly toast = inject(ToastService);
  private readonly i18n = inject(I18nService);

  readonly estadoImagen = signal<ProductImageSearchView>({
    status: 'idle', jobId: null, candidates: [], errorCode: null
  });
  readonly imagenOcupada = signal(false);
  readonly puedeEditar = computed(() => this.household.household()?.myPermissions?.pantry?.edit !== false);

  ngOnInit(): void {
    void this.cargar(this.producto.id);
  }

  async buscarImagenes(): Promise<void> {
    if (this.imagenOcupada()) return;
    this.imagenOcupada.set(true);
    try {
      this.estadoImagen.set(await this.pantry.retryProductImageSearch(this.producto.id));
      await this.esperarBusqueda(this.producto.id);
    } catch {
      this.toast.error(this.i18n.t('ui.error'), this.i18n.t('pantry.item_image_failed'));
    } finally {
      this.imagenOcupada.set(false);
    }
  }

  async cancelarBusquedaImagen(): Promise<void> {
    try {
      this.estadoImagen.set(await this.pantry.cancelProductImageSearch(this.producto.id));
    } catch {
      this.toast.error(this.i18n.t('ui.error'), this.i18n.t('pantry.item_image_failed'));
    }
  }

  async seleccionarImagen(photoId: string): Promise<void> {
    try {
      const saved = await this.pantry.selectProductImage(this.producto.id, photoId);
      this.imageChange.emit(saved.image);
      this.toast.success(this.i18n.t('pantry.item_image_title'), this.i18n.t('pantry.item_image_saved'));
    } catch {
      this.toast.error(this.i18n.t('ui.error'), this.i18n.t('pantry.item_image_failed'));
    }
  }

  async subirImagen(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 2 * 1024 * 1024) {
      this.toast.error(this.i18n.t('ui.error'), this.i18n.t('pantry.item_image_invalid'));
      return;
    }
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Invalid image'));
        reader.onerror = () => reject(new Error('Unable to read image'));
        reader.readAsDataURL(file);
      });
      const saved = await this.pantry.uploadProductImage(this.producto.id, dataUrl);
      this.imageChange.emit(saved.image);
      this.toast.success(this.i18n.t('pantry.item_image_title'), this.i18n.t('pantry.item_image_saved'));
    } catch {
      this.toast.error(this.i18n.t('ui.error'), this.i18n.t('pantry.item_image_failed'));
    }
  }

  private async cargar(productId: string): Promise<void> {
    try {
      this.estadoImagen.set(await this.pantry.getProductImageSearch(productId));
      await this.esperarBusqueda(productId);
    } catch {
      this.estadoImagen.set({ status: 'idle', jobId: null, candidates: [], errorCode: null });
    }
  }

  private async esperarBusqueda(productId: string): Promise<void> {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      if (!['queued', 'running'].includes(this.estadoImagen().status)) return;
      await new Promise((resolve) => setTimeout(resolve, 500));
      try {
        this.estadoImagen.set(await this.pantry.getProductImageSearch(productId));
      } catch {
        return;
      }
    }
  }
}
