import {
  Component,
  inject,
  signal,
  OnInit,
  OnDestroy,
  AfterViewChecked,
  ElementRef,
  ViewChild,
  computed
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { clientTimeZone, formatTimePrecise, timeZoneLabel } from '../../core/time';
import { ClipboardService } from '../../core/services/clipboard.service';
import { LogService, LogEntry, LogLevel, LogSource } from '../../core/services/log.service';
import { ToastService } from '../../core/services/toast.service';
import { ConfirmService } from '../../core/services/confirm.service';
import { ButtonComponent } from '../../shared/components/ui/button/button.component';
import { IconComponent } from '../../shared/components/ui/icon/icon.component';
import { TranslatePipe } from '../../core/pipes/translate.pipe';
import type { TranslationKey } from '../../core/i18n';
import { I18nService } from '../../core/services/i18n.service';

interface FilterOption<T extends string> {
  value: T;
  /** Clave del diccionario: lo que se pinta depende del idioma, y el catalogo no lo puede saber. */
  labelKey: TranslationKey;
}

@Component({
  selector: 'app-logs',
  standalone: true,
  imports: [TranslatePipe, CommonModule, FormsModule, ButtonComponent, IconComponent],
  // Keep the established embedded template formatting stable when the formatter runs.
  // prettier-ignore
  template: `
    <div class="logs-page">
      <!-- Toolbar -->
      <div class="logs-toolbar">
        <div class="logs-toolbar__title">
          <h1>
            <app-icon name="description" [size]="18" [label]="null" />
            {{ 'nav.logs' | t }}
          </h1>
          <span
            class="logs-status"
            [class.logs-status--connected]="logService.connected()"
            [class.logs-status--retrying]="logService.streamStatus() === 'retrying'"
            [class.logs-status--disconnected]="logService.streamStatus() === 'closed'"
            data-test="logs-status"
          >
            <span class="logs-status__dot"></span>
            {{ statusLabel() }}
          </span>
          @if (logService.streamStatus() === 'closed') {
            <button type="button" class="logs-reconnect" data-test="logs-reconnect" (click)="reconnect()">{{ 'logs.reintentar_la_conexion' | t }}</button>
          }
          <span class="logs-count">{{ visibleCount() }} / {{ logService.logs().length }}</span>
          <!-- Se ensena LA ZONA porque el server habla UTC: sin esta linea, dudar de si la hora
               del log es la tuya o la del Raspberry es la pregunta obligada. -->
          <span class="logs-timezone" data-test="logs-timezone" [attr.title]="'logs.zona_detectada' | t:{zone: clientZone()}">
            <app-icon name="schedule" [size]="14" [label]="null" />
            {{ 'logs.hora_de' | t:{zone: timeZoneName()} }}
          </span>
        </div>

        <div class="logs-toolbar__filters">
          <select
            class="logs-select"
            [attr.aria-label]="'logs.fuente_filtro_label' | t"
            [ngModel]="logService.sourceFilter()"
            (ngModelChange)="onSourceChange($event)"
          >
            <option *ngFor="let opt of sourceOptions" [value]="opt.value">{{ opt.labelKey | t }}</option>
          </select>

          <select
            class="logs-select"
            [attr.aria-label]="'logs.nivel_filtro_label' | t"
            [ngModel]="logService.levelFilter()"
            (ngModelChange)="onLevelChange($event)"
          >
            <option *ngFor="let opt of levelOptions" [value]="opt.value">{{ opt.labelKey | t }}</option>
          </select>

          <label class="logs-only-errors" data-test="logs-only-errors-control">
            <input
              type="checkbox"
              name="logs-only-errors"
              [ngModel]="logService.onlyErrors()"
              (ngModelChange)="logService.setOnlyErrors($event)"
            />
            <span>{{ 'logs.solo_errores' | t }}</span>
          </label>

          <app-button
            [variant]="logService.paused() ? 'primary' : 'ghost'"
            size="sm"
            (onClick)="logService.togglePause()"
          >
            <app-icon [name]="logService.paused() ? 'play_arrow' : 'pause'" [size]="16" [label]="null" />
            {{ (logService.paused() ? 'ui.reanudar' : 'ui.pausar') | t }}
          </app-button>

          <app-button
            variant="ghost"
            size="sm"
            (onClick)="logService.toggleAutoScroll()"
          >
            {{ 'logs.autoscroll_estado' | t:{state: logService.autoScroll() ? 'ON' : 'OFF'} }}
          </app-button>

          <app-button
            variant="ghost"
            size="sm"
            (onClick)="copyVisible()"
          >
            <app-icon name="content_copy" [size]="16" [label]="null" />
            {{ hasSelection() ? ('logs.copiar_seleccionado' | t:{n: selectedCount()}) : ('logs.copiar_todo' | t) }}
          </app-button>

          <app-button
            *ngIf="hasSelection()"
            variant="ghost"
            size="sm"
            (onClick)="clearSelection()"
          >
            <app-icon name="close" [size]="16" [label]="null" />
            {{ 'logs.limpiar_seleccion' | t }}
          </app-button>

          <app-button
            variant="ghost"
            size="sm"
            (onClick)="clearLogs()"
          >
            <app-icon name="delete_sweep" [size]="16" [label]="null" />
            {{ 'logs.limpiar' | t }}
          </app-button>
        </div>
      </div>

      <!-- Terminal -->
      <div class="terminal" #terminalEl>
        <div class="terminal__header">
          <div class="terminal__controls">
            <span class="terminal__dot terminal__dot--red"></span>
            <span class="terminal__dot terminal__dot--yellow"></span>
            <span class="terminal__dot terminal__dot--green"></span>
          </div>
          <div class="terminal__title">
            {{
              hasSelection()
                ? ('logs.seleccion_en_el_terminal' | t:{n: selectedCount()})
                : ('logs.terminal_de' | t)
            }}
          </div>
          <div class="terminal__spacer"></div>
        </div>
        <div class="terminal__body" #bodyEl>
          <div
            *ngFor="let entry of filtered(); trackBy: trackByEntry; let i = index"
            class="terminal__line"
            data-test="logs-line"
            [class]="'terminal__line--' + entry.level + ' terminal__line--source-' + entry.source"
            [class.terminal__line--selected]="isSelected(entry)"
            (mousedown)="onLineMouseDown($event)"
            (click)="onLineClick($event, entry, i)"
            [attr.title]="'logs.clic_seleccionar_ctrl_cmd' | t"
          >
            <span class="terminal__time" [title]="formatTime(entry.timestamp) + ' · ' + timeZoneName()">{{
              formatTime(entry.timestamp)
            }}</span>
            <span class="terminal__source">{{ entry.source === 'server' ? '[SRV]' : '[CLI]' }}</span>
            <span class="terminal__level">{{ levelTag(entry.level) }}</span>
            <span class="terminal__msg">{{ entry.message }}</span>
            <pre *ngIf="entry.stack" class="terminal__stack">{{ entry.stack }}</pre>
          </div>
          <div *ngIf="filtered().length === 0" class="terminal__empty">
            {{ 'logs.waiting' | t }}
          </div>
        </div>
      </div>
    </div>
  `,
  // prettier-ignore
  styles: [`  /*
     * ── Estados de interaccion (HOGARIA-SPEC 12q-B) ───────────────────────────────────────────
     *
     * Todo lo que se pulsa avisa antes de que se pulse. Va aqui arriba, junto, en lugar de repartido por
     * las reglas de cada control: asi la proxima clase que se anada se compara con esta lista, y el
     * check-ui (regla boton-sin-afecto) no deja a nadie poner un boton sin su hover. Van sin :hover los
     * deshabilitados —un boton apagado que se ilumina es la manera mas rapida de ensenar a desconfiar.
     */
    .logs-reconnect:hover:not(:disabled) {
      background: var(--primary-subtle);
      border-color: var(--primary);
      color: var(--primary-dark);
    }
  

    .logs-page {
      padding-block: var(--container-padding);
      display: flex;
      flex-direction: column;
      gap: var(--space-3);
      height: calc(100vh - 56px - 64px - env(safe-area-inset-bottom));
    }

    @media (min-width: 1024px) {
      .logs-page {
        height: 100vh;
      }
    }

    /* Toolbar */
    .logs-toolbar {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-3);
      align-items: center;
      justify-content: space-between;
    }

    .logs-toolbar__title {
      display: flex;
      align-items: center;
      gap: var(--space-3);

      h1 {
        font-family: var(--font-display);
        font-size: var(--text-2xl);
        font-weight: var(--font-bold);
        margin: 0;
      }
    }

    .logs-toolbar__filters {
      display: flex;
      gap: var(--space-2);
      flex-wrap: wrap;
      align-items: center;
    }

    .logs-only-errors {
      display: inline-flex;
      align-items: center;
      gap: var(--space-2);
      min-height: var(--button-control-height);
      padding-inline: var(--space-2);
      border-radius: var(--radius-md);
      color: var(--text-secondary);
      cursor: pointer;
      user-select: none;
    }

    .logs-only-errors input {
      width: 18px;
      height: 18px;
      accent-color: var(--primary);
    }

    .logs-only-errors input:focus-visible {
      outline: 2px solid var(--primary);
      outline-offset: 3px;
    }

    /* Tres estados, no dos: «reintentando en 5 s» es accionable y «desconectado» a
       secas era el que hacia abrir la terminal del contenedor. */
    .logs-status--retrying .logs-status__dot {
      background: var(--warning);
      animation: logs-pulse 1.2s ease-in-out infinite;
    }
    @keyframes logs-pulse {
      from {
        opacity: 0.35;
      }
      to {
        opacity: 1;
      }
    }
    .logs-reconnect {
      border: 1px solid var(--border-default);
      background: transparent;
      border-radius: var(--radius-md);
      color: var(--text-primary);
      font-size: var(--text-xs);
      padding: var(--space-1) var(--space-2);
      cursor: pointer;
    }
    .logs-status {
      display: inline-flex;
      align-items: center;
      gap: var(--space-1);
      font-size: var(--text-xs);
      font-weight: var(--font-medium);
      padding: var(--space-1) var(--space-2);
      border-radius: var(--radius-full);
      background: var(--error-subtle);
      color: var(--error);

      &--connected {
        background: #dcfce7;
        color: #15803d;
      }
    }

    .logs-status__dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: currentColor;
      animation: pulse 2s infinite;
    }

    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.5; }
    }

    /* La zona detectada, a la vista: «la hora esta bien» se comprueba mirando, no preguntando. */
    .logs-timezone {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      font-size: var(--text-xs);
      color: var(--text-tertiary);
      cursor: help;
    }
    .logs-toolbar__title h1 {
      display: inline-flex;
      align-items: center;
      gap: var(--space-2);
    }
    .logs-count {
      font-size: var(--text-xs);
      color: var(--text-secondary);
    }

    .logs-select {
      padding: var(--space-2) var(--space-3);
      font-family: var(--font-sans);
      font-size: var(--text-sm);
      color: var(--text-primary);
      background: var(--bg-secondary);
      border: 1px solid var(--border-default);
      border-radius: var(--radius-md);
      cursor: pointer;

      &:focus {
        outline: none;
        border-color: var(--primary);
      }
    }

    /* Terminal */
    .terminal {
      flex: 1;
      display: flex;
      flex-direction: column;
      background: #0b1021;
      border-radius: var(--radius-xl);
      overflow: hidden;
      box-shadow: 0 10px 30px rgba(0,0,0,0.25);
      border: 1px solid rgba(255,255,255,0.05);
      min-height: 300px;
    }

    .terminal__header {
      display: flex;
      align-items: center;
      gap: var(--space-3);
      padding: var(--space-2) var(--space-3);
      background: rgba(255,255,255,0.04);
      border-bottom: 1px solid rgba(255,255,255,0.06);
    }

    .terminal__controls {
      display: flex;
      gap: 6px;
    }

    .terminal__dot {
      width: 12px;
      height: 12px;
      border-radius: 50%;
      &--red    { background: #ff5f57; }
      &--yellow { background: #febc2e; }
      &--green  { background: #28c840; }
    }

    .terminal__title {
      flex: 1;
      text-align: center;
      font-size: var(--text-xs);
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      color: rgba(255,255,255,0.6);
    }

    .terminal__spacer {
      width: 54px;
    }

    .terminal__body {
      flex: 1;
      overflow-y: auto;
      padding: var(--space-3);
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 12.5px;
      line-height: 1.5;
      color: #e6edf3;
    }

    .terminal__empty {
      color: rgba(255,255,255,0.4);
      font-style: italic;
      padding: var(--space-4);
      text-align: center;
    }

    .terminal__line {
      display: grid;
      grid-template-columns: 72px 48px 60px 1fr;
      gap: var(--space-2);
      align-items: start;
      padding: 1px 0;
      word-break: break-word;
      white-space: pre-wrap;
      cursor: pointer;
      border-radius: 4px;

      &:hover { background: rgba(255,255,255,0.05); }

      &--selected {
        background: rgba(99,102,241,0.28);
        box-shadow: inset 3px 0 0 #818cf8;
      }

      &--error .terminal__msg { color: #ff6b6b; }
      &--warn  .terminal__msg { color: #ffd166; }
      &--info  .terminal__msg { color: #4fc3f7; }
      &--debug .terminal__msg { color: rgba(255,255,255,0.5); }
    }

    .terminal__time {
      color: rgba(255,255,255,0.4);
      font-size: 11px;
    }

    .terminal__source {
      color: #a5b4fc;
      font-weight: 600;
    }

    .terminal__line--source-browser .terminal__source {
      color: #fca5a5;
    }

    .terminal__level {
      text-transform: uppercase;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.05em;
      color: rgba(255,255,255,0.5);

      .terminal__line--error & { color: #ff6b6b; }
      .terminal__line--warn  & { color: #ffd166; }
      .terminal__line--info  & { color: #4fc3f7; }
    }

    .terminal__msg {
      color: #e6edf3;
    }

    .terminal__stack {
      grid-column: 2 / -1;
      color: rgba(255,255,255,0.5);
      font-size: 11px;
      margin: 0;
      padding-left: var(--space-2);
      border-left: 2px solid rgba(255,107,107,0.4);
    }
  `]
})
export class LogsComponent implements OnInit, OnDestroy, AfterViewChecked {
  private readonly i18n = inject(I18nService);
  private readonly clipboardService = inject(ClipboardService);
  logService = inject(LogService);
  private toastService = inject(ToastService);
  private confirmService = inject(ConfirmService);

  @ViewChild('bodyEl') bodyEl!: ElementRef<HTMLDivElement>;

  /**
   * Los dos filtros de la barra. `labelKey`, no `label`: un catalogo con la frase dentro se pinta tal cual en
   * el `@for` de la plantilla y no hay idioma que lo alcance (HOGARIA-SPEC ## 12u).
   */
  sourceOptions: FilterOption<LogSource | 'all'>[] = [
    { value: 'all', labelKey: 'logs.fuente_todos' },
    { value: 'server', labelKey: 'logs.fuente_servidor' },
    { value: 'browser', labelKey: 'logs.fuente_cliente' }
  ];

  levelOptions: FilterOption<LogLevel | 'all'>[] = [
    { value: 'all', labelKey: 'logs.nivel_todos' },
    { value: 'error', labelKey: 'logs.nivel_error' },
    { value: 'warn', labelKey: 'logs.nivel_warning' },
    { value: 'info', labelKey: 'logs.nivel_info' },
    { value: 'log', labelKey: 'logs.nivel_log' },
    { value: 'debug', labelKey: 'logs.nivel_debug' }
  ];

  filtered = computed<LogEntry[]>(() =>
    this.logService.logs().filter((e) => this.logService.isVisible(e))
  );
  visibleCount = computed(() => this.filtered().length);
  private lastLen = 0;

  // ── Selección de líneas (clic, Ctrl/Cmd + clic, Mayús + clic) ──────────
  private selection = signal<Set<string>>(new Set());
  /** Última línea pulsada: ancla para la selección por rango con Mayús. */
  private anchorIndex = -1;

  selectedCount = computed(() => this.selection().size);
  hasSelection = computed(() => this.selection().size > 0);

  /** Selección en el orden en el que se ve en pantalla, no en el de clic. */
  selectedEntries = computed<LogEntry[]>(() => {
    const selected = this.selection();
    if (selected.size === 0) return [];
    return this.filtered().filter((e) => selected.has(this.keyOf(e)));
  });

  /**
   * Flecha (no metodo): Angular invoca el trackBy con `this` = el differ,
   * asi que una funcion normal no podria usar el componente.
   */
  trackByEntry = (_i: number, entry: LogEntry): string => this.keyOf(entry);

  keyOf(entry: LogEntry): string {
    // El servicio asigna id a cada entrada; el fallback solo es por si acaso.
    return entry.id || `${entry.timestamp}|${entry.source}|${entry.message}`;
  }

  isSelected(entry: LogEntry): boolean {
    return this.selection().has(this.keyOf(entry));
  }

  /**
   * Mayús + clic extiende la selección de texto en el navegador; se evita
   * en mousedown para que el gesto signifique "seleccionar el rango".
   */
  onLineMouseDown(event: MouseEvent): void {
    if (event.shiftKey) event.preventDefault();
  }

  onLineClick(event: MouseEvent, entry: LogEntry, index: number): void {
    // Si el usuario está seleccionando texto a mano (sin Mayús), el clic no
    // altera la selección de líneas.
    const textSelection = window.getSelection();
    if (textSelection && !textSelection.isCollapsed && !event.shiftKey) return;

    const key = this.keyOf(entry);
    const add = event.ctrlKey || event.metaKey;

    if (event.shiftKey && this.anchorIndex >= 0) {
      const from = Math.min(this.anchorIndex, index);
      const to = Math.max(this.anchorIndex, index);
      const range = this.filtered()
        .slice(from, to + 1)
        .map((e) => this.keyOf(e));
      this.selection.update((current) => (add ? new Set([...current, ...range]) : new Set(range)));
      return;
    }

    if (add) {
      this.selection.update((current) => {
        const next = new Set(current);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        return next;
      });
      this.anchorIndex = index;
      return;
    }

    // Clic normal: selecciona solo esa línea (y la suelta si ya era la única).
    const onlyThis = this.selection().size === 1 && this.selection().has(key);
    this.selection.set(onlyThis ? new Set<string>() : new Set([key]));
    this.anchorIndex = index;
  }

  clearSelection(): void {
    this.selection.set(new Set<string>());
    this.anchorIndex = -1;
  }

  // ── Copiar al portapapeles ─────────────────────────────────────────────

  /** Con selección copia solo esas líneas; sin selección, todo lo visible. */
  copyVisible(): void {
    const entries = this.hasSelection() ? this.selectedEntries() : this.filtered();
    if (entries.length === 0) {
      this.toastService.info(
        this.i18n.t('logs.nada_que_copiar'),
        this.i18n.t('logs.no_hay_lineas_visibles')
      );
      return;
    }

    const text = entries.map((e) => this.formatEntry(e)).join('\n');
    this.clipboardService.copy(text).then(
      () =>
        this.toastService.success(
          this.i18n.t('household.copiado'),
          this.i18n.t(
            entries.length === 1 ? 'logs.lineas_copiadas_uno' : 'logs.lineas_copiadas_varios',
            { n: entries.length }
          )
        ),
      () => this.toastService.error(this.i18n.t('ui.error'), this.i18n.t('logs.no_se_pudo_copiar'))
    );
  }

  formatEntry(entry: LogEntry): string {
    const head = [
      this.formatTime(entry.timestamp),
      entry.source === 'server' ? '[SRV]' : '[CLI]',
      this.levelTag(entry.level),
      entry.message
    ].join(' ');
    return entry.stack ? `${head}\n${entry.stack}` : head;
  }

  /** 'En vivo' · 'Reintentando en 5 s' · 'Sin conexion (lo intentaba cada X s)'. */
  statusLabel(): string {
    const status = this.logService.streamStatus();
    if (status === 'live') return this.i18n.t('logs.estado_en_vivo');
    if (status === 'connecting') return this.i18n.t('logs.estado_conectando');
    if (status === 'retrying') {
      const ms = this.logService.retryIn();
      return ms
        ? this.i18n.t('logs.estado_reintentando_en', { seconds: Math.round(ms / 1000) })
        : this.i18n.t('logs.estado_reintentando');
    }
    return this.i18n.t('logs.estado_sinConexion');
  }

  reconnect(): void {
    this.logService.connect();
  }

  ngOnInit(): void {
    this.logService.connect();
  }

  ngOnDestroy(): void {
    this.logService.disconnect();
  }

  ngAfterViewChecked(): void {
    if (!this.bodyEl) return;
    const el = this.bodyEl.nativeElement;
    const logs = this.logService.logs();
    if (this.logService.autoScroll() && logs.length !== this.lastLen) {
      requestAnimationFrame(() => {
        if (el) el.scrollTop = el.scrollHeight;
      });
      this.lastLen = logs.length;
    }
  }

  onSourceChange(v: string): void {
    this.logService.setSourceFilter(v as any);
  }

  onLevelChange(v: string): void {
    this.logService.setLevelFilter(v as any);
  }

  async clearLogs(): Promise<void> {
    const accepted = await this.confirmService.confirm({
      title: this.i18n.t('logs.borrar_logs'),
      message: this.i18n.t('logs.borrar_todos_los_logs'),
      confirmText: this.i18n.t('calendar.borrar')
    });
    if (!accepted) return;

    this.logService.clear().subscribe({
      next: () => this.clearSelection(),
      // The shared HTTP interceptor already announces the failure. Keep the rows and their
      // selection so the user can retry without losing the current context.
      error: () => undefined
    });
  }

  /**
   * La hora del log se formatea en la zona del dispositivo y se ve en el encabezado cual es:
   * si no, contrastar el log del movil con el del server (que habla UTC) es un pasatiempo.
   */
  formatTime(iso: string): string {
    return formatTimePrecise(iso);
  }

  readonly timeZoneName = timeZoneLabel;

  /** El nombre IANA completo, para el `title` de quien lo quiera exacto. */
  clientZone(): string {
    return clientTimeZone();
  }

  levelTag(level: string): string {
    return level.toUpperCase().slice(0, 5);
  }
}
