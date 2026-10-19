import { CommonModule } from '@angular/common';
import { AfterViewInit, Component, ElementRef, EventEmitter, HostListener, Input, OnDestroy, Output, ViewChild, signal, inject} from '@angular/core';

import { CropOffset, MAX_ZOOM, MIN_ZOOM, ZERO_OFFSET, clampZoom, cropRegion, panFromDrag, previewLayout, zoomAround } from '../../core/avatar-crop';
import { AvatarIssue, DecodedAvatar, decodeAvatarFile, renderAvatarDataUrl } from '../../core/avatar-image';
import { ButtonComponent } from '../../shared/components/ui/button/button.component';
import { IconButtonComponent } from '../../shared/components/ui/icon-button/icon-button.component';
import { IconComponent } from '../../shared/components/ui/icon/icon.component';
import { TranslatePipe } from '../../core/pipes/translate.pipe';
import { I18nService } from '../../core/services/i18n.service';

/**
 * El encuadre de la foto de perfil: la imagen se arrastra con el dedo (o con el raton, o con las
 * flechas del teclado) y se acerca con la rueda, el slider o los botones. Lo que se ve dentro del
 * circulo es literalmente lo que se sube: la region la calcula `avatar-crop.ts`, y de ahi sale
 * tanto el estilo del `img` de la vista previa como el `drawImage` del canvas —una sola matematica,
 * dos consumidores.
 *
 * Y si no hay `canvas` (un navegador viejo, un modo privado raro), el error se dice en pantalla y
 * se puede Cancelar: nada de dejar el boton de «Usar imagen» esperando a alguien.
 */
@Component({
  selector: 'app-avatar-editor',
  standalone: true,
  imports: [
    TranslatePipe,
    CommonModule, IconComponent, ButtonComponent, IconButtonComponent],
  template: `
    <div class="crop">
      <div
        #stage
        class="crop__stage"
        [class.crop__stage--dragging]="dragging()"
        tabindex="0"
        role="application"
        [attr.aria-label]="'avatar_editor.mueve_la_foto_con' | t"
        data-test="avatar-stage"
        (pointerdown)="onDown($event)"
        (pointermove)="onMove($event)"
        (pointerup)="onUp()"
        (pointercancel)="onUp()"
        (pointerleave)="onUp()"
        (wheel)="onWheel($event)"
        (keydown)="onKey($event)"
      >
        @if (decoded) {
          <img
            class="crop__image"
            [src]="objectUrl"
            alt=""
            [style.width.px]="layout.widthPx"
            [style.left.px]="layout.leftPx"
            [style.top.px]="layout.topPx"
            draggable="false"
          />
          <span class="crop__guide" aria-hidden="true"></span>
        } @else {
          <span class="crop__loading">{{ error() ? '' : ('avatar_editor.leyendo_la_foto' | t) }}</span>
        }
      </div>

      <p class="crop__hint">
        <app-icon name="drag_indicator" [size]="14" />
        {{ 'avatar_editor.arrastra_para_encuadrar_el' | t }}
      </p>

      <div class="crop__controls">
        <app-icon-button
          icon="remove"
          [label]="'avatar_editor.alejar' | t"
          size="sm"
          variant="ghost"
          data-test="avatar-zoom-out"
          [disabled]="zoom() <= MIN_ZOOM"
          (onClick)="bump(-0.25)"
        />
        <label class="crop__zoom">
          <span class="crop__zoom-label">{{ 'avatar_editor.zoom' | t }}</span>
          <input
            type="range"
            min="1"
            [max]="MAX_ZOOM"
            step="0.02"
            [value]="zoom()"
            [attr.aria-valuetext]="zoomText()"
            data-test="avatar-zoom"
            (input)="setZoom($event)"
          />
        </label>
        <app-icon-button
          icon="add"
          [label]="'avatar_editor.acercar' | t"
          size="sm"
          variant="ghost"
          data-test="avatar-zoom-in"
          [disabled]="zoom() >= MAX_ZOOM"
          (onClick)="bump(0.25)"
        />
        <app-icon-button
          icon="refresh"
          [label]="'avatar_editor.volver_al_centro' | t"
          size="sm"
          variant="ghost"
          data-test="avatar-recenter"
          (onClick)="recenter()"
        />
      </div>

      <p class="crop__error" *ngIf="error()" data-test="avatar-editor-error">{{ error() }}</p>
    </div>

    <div class="crop__footer">
      <app-button variant="ghost" size="md" data-test="avatar-editor-cancel" (onClick)="cancelled.emit()">
        {{ 'common.cancel' | t }}
      </app-button>
      <app-button
        variant="primary"
        size="md"
        [disabled]="!decoded || busy()"
        [loading]="busy()"
        data-test="avatar-editor-use"
        (onClick)="use()"
      >
        {{ 'avatar_editor.usar_imagen' | t }}
      </app-button>
    </div>
  `,
  styles: [`
    .crop {
      display: flex;
      flex-direction: column;
      gap: var(--space-3);
    }

    .crop__stage {
      position: relative;
      width: 100%;
      aspect-ratio: 1;
      overflow: hidden;
      border-radius: var(--radius-2xl);
      border: 1px solid var(--border-default);
      background: var(--bg-primary);
      cursor: grab;
      /* touch-action: none es lo que hace que un arrastre en el movil sea un arrastre y no una
         pagina que se desplaza. Con esto hace falta ademas prevenir la rueda: no la previene. */
      touch-action: none;
      outline: none;
    }

    .crop__stage:focus-visible {
      box-shadow: 0 0 0 2px var(--primary);
    }

    .crop__stage--dragging {
      cursor: grabbing;
    }

    .crop__image {
      position: absolute;
      max-width: none;
      user-select: none;
      -webkit-user-drag: none;
    }

    /* La guia redonda con el exterior oscurecido: el truco es un outline de 100vmax dentro de un
       contenedor con overflow hidden, sin capas extra ni mascaras de recorte. */
    .crop__guide {
      position: absolute;
      inset: 0;
      margin: auto;
      width: min(100%, 320px);
      aspect-ratio: 1;
      border-radius: var(--radius-full);
      outline: 100vmax solid rgba(15, 16, 18, 0.42);
      box-shadow: 0 0 0 1px var(--border-strong);
      pointer-events: none;
    }

    .crop__loading {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: var(--text-sm);
      color: var(--text-tertiary);
    }

    .crop__hint {
      display: flex;
      align-items: center;
      gap: var(--space-2);
      margin: 0;
      font-size: var(--text-xs);
      color: var(--text-tertiary);
    }

    .crop__controls {
      display: flex;
      align-items: center;
      gap: var(--space-2);
    }

    .crop__zoom {
      flex: 1;
      display: flex;
      align-items: center;
      gap: var(--space-3);
      min-width: 0;
    }

    .crop__zoom-label {
      font-size: var(--text-xs);
      color: var(--text-secondary);
      flex-shrink: 0;
    }

    .crop__zoom input {
      flex: 1;
      min-width: 0;
      accent-color: var(--primary);
    }

    .crop__error {
      margin: 0;
      font-size: var(--text-sm);
      color: var(--error);
    }

    .crop__footer {
      display: flex;
      justify-content: flex-end;
      gap: var(--space-2);
      margin-top: var(--space-4);
    }
  `]
})
export class AvatarEditorComponent implements AfterViewInit, OnDestroy {
  private readonly i18n = inject(I18nService);
  /** El fichero elegido. Cambiarlo vuelve a decodificar: es el «elige otra foto» del modal. */
  @Input() set file(value: File | null) {
    void this.load(value);
  }
  @Output() readonly cancelled = new EventEmitter<void>();
  /** El data URL JPEG listo para `POST /api/auth/avatar`. Subirlo no es cosa de este componente. */
  @Output() readonly applied = new EventEmitter<string>();

  protected readonly MIN_ZOOM = MIN_ZOOM;
  protected readonly MAX_ZOOM = MAX_ZOOM;

  protected decoded: DecodedAvatar | null = null;
  protected objectUrl = '';
  readonly zoom = signal<number>(MIN_ZOOM);
  readonly offset = signal<CropOffset>(ZERO_OFFSET);
  readonly busy = signal(false);
  readonly dragging = signal(false);
  readonly error = signal('');
  /**
   * Ancho del cuadro en px de pantalla, medido —no supuesto. Todo el arrastre y el zoom se
   * convierten con el: si se hardcodease, un movil en horizontal moveria la foto a otro ritmo del
   * que se ve, y el recorte subido no cuadraria con lo enmarcado.
   */
  readonly boxPx = signal(280);

  @ViewChild('stage') private stage?: ElementRef<HTMLDivElement>;
  private dragFrom: { x: number; y: number; offset: CropOffset; region: { sx: number; sy: number; size: number } } | null = null;

  ngAfterViewInit(): void {
    this.measure();
  }

  ngOnDestroy(): void {
    this.release();
  }

  /** Y al girar el movil, o al arrastrar la ventana: el cuadro cambia de ancho y el gesto detras. */
  @HostListener('window:resize')
  protected onResize(): void {
    this.measure();
  }

  private measure(): void {
    const width = this.stage?.nativeElement.getBoundingClientRect().width ?? 0;
    if (width > 0) this.boxPx.set(width);
  }

  private get box(): number {
    return this.boxPx();
  }

  private get source() {
    return { width: this.decoded?.width ?? 1, height: this.decoded?.height ?? 1 };
  }

  protected get region() {
    return cropRegion(this.source, this.zoom(), this.offset());
  }

  protected get layout() {
    return previewLayout(this.source, this.region, this.box);
  }

  protected zoomText(): string {
    return `${this.zoom().toFixed(2).replace('.', ',')}x`;
  }

  private async load(file: File | null): Promise<void> {
    this.error.set('');
    this.release();
    if (!file) return;

    this.busy.set(true);
    try {
      const decoded = await decodeAvatarFile(file);
      if (decoded.width < 1 || decoded.height < 1) throw new AvatarIssue('avatar_editor.la_foto_no_tiene');
      this.decoded = decoded;
      // La vista previa es un `img` de verdad (posicionable por px con la misma matematica del
      // recorte), asi que el fichero se sirve por objeto URL mientras el modal esta abierto.
      this.objectUrl = URL.createObjectURL(file);
      this.zoom.set(MIN_ZOOM);
      this.offset.set(ZERO_OFFSET);
      // Con la imagen ya en el DOM el cuadro tiene altura: es el momento de medir.
      this.measure();
    } catch (caught) {
      this.decoded = null;
      // Un problema conocido se traduce por su clave; lo demas (un `fetch` roto, un `SecurityError`)
      // se contesta con el aviso general, que es lo que se puede decir sin inventar.
      this.error.set(
        caught instanceof AvatarIssue
          ? this.i18n.t(caught.clave, caught.params)
          : this.i18n.t('account.la_foto_no_se')
      );
    } finally {
      this.busy.set(false);
    }
  }

  private release(): void {
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
    this.objectUrl = '';
    this.decoded?.release();
    this.decoded = null;
  }

  protected onDown(event: PointerEvent): void {
    if (!this.decoded) return;
    const target = event.currentTarget as HTMLElement | null;
    // Capturar el puntero es lo que hace que el arrastre sobreviva a salirse del cuadro con el
    // dedo: sin eso, el gesto se corta en el borde y la foto se queda a medias.
    target?.setPointerCapture?.(event.pointerId);
    this.dragFrom = { x: event.clientX, y: event.clientY, offset: this.offset(), region: this.region };
    this.dragging.set(true);
  }

  protected onMove(event: PointerEvent): void {
    if (!this.dragFrom) return;
    const dragged = { x: event.clientX - this.dragFrom.x, y: event.clientY - this.dragFrom.y };
    const pan = panFromDrag(dragged, this.box, this.dragFrom.region);
    this.offset.set({ x: this.dragFrom.offset.x + pan.x, y: this.dragFrom.offset.y + pan.y });
  }

  protected onUp(): void {
    this.dragFrom = null;
    this.dragging.set(false);
  }

  protected onWheel(event: WheelEvent): void {
    if (!this.decoded) return;
    event.preventDefault();
    const rect = this.stage?.nativeElement.getBoundingClientRect();
    const at = this.imagePointAt(rect ? event.clientX - rect.left : this.box / 2, rect ? event.clientY - rect.top : this.box / 2);
    this.applyZoom(zoomAround(this.source, { zoom: this.zoom(), offset: this.offset() }, this.zoom() - event.deltaY / 400, at));
  }

  protected bump(delta: number): void {
    // Sin puntero que seguir: el centro del cuadro, que es el punto estable.
    this.applyZoom(zoomAround(this.source, { zoom: this.zoom(), offset: this.offset() }, this.zoom() + delta, this.offset()));
  }

  protected setZoom(event: Event): void {
    const raw = Number((event.target as HTMLInputElement).value);
    this.applyZoom({ zoom: clampZoom(raw), offset: this.offset() });
  }

  protected onKey(event: KeyboardEvent): void {
    const step = event.shiftKey ? 48 : 16;
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step]
    };
    if (moves[event.key]) {
      event.preventDefault();
      const [dx, dy] = moves[event.key];
      // Las flechas mueven EL CUADRO (es lo que hace cualquier editor), el arrastre mueve la foto:
      // de ahi el signo contrario entre los dos gestos.
      const current = this.offset();
      const k = this.region.size / this.box;
      this.offset.set({ x: current.x + dx * k, y: current.y + dy * k });
      return;
    }
    if (event.key === '+' || event.key === '=') {
      event.preventDefault();
      this.bump(0.25);
    } else if (event.key === '-' || event.key === '_') {
      event.preventDefault();
      this.bump(-0.25);
    } else if (event.key === '0') {
      event.preventDefault();
      this.recenter();
    }
  }

  protected recenter(): void {
    this.zoom.set(MIN_ZOOM);
    this.offset.set(ZERO_OFFSET);
  }

  /** Un punto de la pantalla, en px de la imagen desde su centro: lo que necesita el zoom anclado. */
  private imagePointAt(px: number, py: number): CropOffset {
    const region = this.region;
    const box = this.box;
    const k = region.size / box;
    return { x: this.offset().x + (px - box / 2) * k, y: this.offset().y + (py - box / 2) * k };
  }

  private applyZoom(next: { zoom: number; offset: CropOffset }): void {
    this.zoom.set(next.zoom);
    this.offset.set(next.offset);
  }

  /**
   * Se podria recortar aqui y subir un blob, pero el `POST /api/auth/avatar` come un data URL y el
   * dueño de los toasts y de los errores es la pantalla: el editor emite la imagen y se baja del
   * carro.
   */
  protected use(): void {
    if (!this.decoded) return;
    this.busy.set(true);
    try {
      this.applied.emit(renderAvatarDataUrl(this.decoded, this.region));
    } catch (caught) {
      this.error.set(
        caught instanceof AvatarIssue
          ? this.i18n.t(caught.clave, caught.params)
          : this.i18n.t('account.el_navegador_no_pudo')
      );
    } finally {
      this.busy.set(false);
    }
  }
}
