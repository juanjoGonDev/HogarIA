import { Component, Input, Output, EventEmitter, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ButtonComponent } from '../button/button.component';
import { TranslatePipe } from '../../../../core/pipes/translate.pipe';

export type TimerState = 'idle' | 'running' | 'paused' | 'finished';

@Component({
  selector: 'app-timer',
  standalone: true,
  imports: [TranslatePipe, CommonModule, ButtonComponent],
  template: `
    <div
      [class]="getClasses()"
      [class.timer--compact]="compact"
      role="timer"
      [attr.aria-label]="label || null"
      aria-live="off"
    >
      <span *ngIf="label" class="timer__label">{{ label }}</span>

      <div class="timer__display">
        {{ formatTime(currentTime) }}
      </div>

      <div class="timer__progress">
        <div class="timer__progress-bar" [style.width.%]="progress"></div>
      </div>

      <div class="timer__controls">
        <app-button
          *ngIf="state === 'idle' || state === 'paused'"
          [variant]="compact ? 'outline' : 'primary'"
          size="sm"
          (onClick)="start()"
        >
          {{ (state === 'paused' ? 'ui.reanudar' : 'ui.iniciar') | t }}
        </app-button>

        <app-button *ngIf="state === 'running'" variant="outline" size="sm" (onClick)="pause()">
          {{ 'ui.pausar' | t }}
        </app-button>

        <app-button *ngIf="state !== 'idle'" variant="ghost" size="sm" (onClick)="reset()">
          {{ 'ui.reiniciar' | t }}
        </app-button>
      </div>
    </div>
  `,
  styles: [
    `
      .timer {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: var(--space-4);
        padding: var(--space-6);
        background: var(--bg-secondary);
        border-radius: var(--radius-2xl);
        box-shadow: var(--shadow-lg);
      }

      .timer__label {
        font-size: var(--text-sm);
        color: var(--text-secondary);
        text-align: center;
      }

      .timer__display {
        font-family: var(--font-mono);
        font-size: var(--text-5xl);
        font-weight: var(--font-bold);
        color: var(--text-primary);
        letter-spacing: var(--tracking-wide);
      }

      .timer__progress {
        width: 100%;
        height: 4px;
        background: var(--bg-tertiary);
        border-radius: var(--radius-full);
        overflow: hidden;
      }

      .timer__progress-bar {
        height: 100%;
        background: var(--primary);
        border-radius: var(--radius-full);
        transition: width 1s linear;
      }

      .timer__controls {
        display: flex;
        gap: var(--space-3);
      }

      .timer--compact {
        align-items: stretch;
        gap: var(--space-2);
        padding: var(--space-3);
        border: 1px solid var(--border-default);
        border-radius: var(--radius-md);
        background: var(--bg-secondary);
        box-shadow: none;
      }

      .timer--compact .timer__label {
        text-align: left;
      }

      .timer--compact .timer__display {
        font-size: var(--text-2xl);
        letter-spacing: normal;
        text-align: center;
      }

      .timer--compact .timer__controls {
        flex-wrap: wrap;
        justify-content: center;
        gap: var(--space-2);
      }

      /* States */
      .timer--running .timer__display {
        color: var(--primary);
      }

      .timer--paused .timer__display {
        color: var(--warning);
      }

      .timer--finished .timer__display {
        color: var(--success);
        animation: pulse 1s infinite;
      }

      .timer--compact .timer__progress-bar {
        background: var(--color-primary-700);
      }

      :host-context([data-theme='dark']) .timer--compact .timer__progress-bar {
        background: var(--color-primary-300);
      }

      .timer--compact.timer--running .timer__display,
      .timer--compact.timer--paused .timer__display,
      .timer--compact.timer--finished .timer__display {
        color: var(--text-primary);
      }

      .timer--compact.timer--finished .timer__display {
        animation: none;
      }

      @keyframes pulse {
        0%,
        100% {
          opacity: 1;
        }
        50% {
          opacity: 0.5;
        }
      }
    `
  ]
})
export class TimerComponent implements OnInit, OnDestroy {
  @Input() duration = 0; // in seconds
  @Input() label = '';
  @Input() autoStart = false;
  @Input() compact = false;

  @Output() timerStart = new EventEmitter<void>();
  @Output() timerPause = new EventEmitter<void>();
  @Output() timerComplete = new EventEmitter<void>();
  @Output() timerReset = new EventEmitter<void>();
  @Output() timerTick = new EventEmitter<number>();

  currentTime = 0;
  state: TimerState = 'idle';
  progress = 0;

  private intervalId: ReturnType<typeof setInterval> | null = null;
  private deadline: number | null = null;

  ngOnInit(): void {
    this.currentTime = this.duration;
    this.calculateProgress();

    if (this.autoStart) {
      this.start();
    }
  }

  ngOnDestroy(): void {
    this.stopInterval();
  }

  start(): void {
    if (this.state === 'finished') {
      this.reset();
    }

    this.state = 'running';
    this.deadline = Date.now() + this.currentTime * 1000;
    this.timerStart.emit();

    this.intervalId = setInterval(() => {
      this.updateFromClock();
    }, 1000);
  }

  pause(): void {
    if (this.state === 'running') {
      if (this.updateFromClock()) return;
    }
    this.state = 'paused';
    this.deadline = null;
    this.stopInterval();
    this.timerPause.emit();
  }

  reset(): void {
    this.stopInterval();
    this.deadline = null;
    this.currentTime = this.duration;
    this.state = 'idle';
    this.calculateProgress();
    this.timerReset.emit();
  }

  complete(): void {
    this.stopInterval();
    this.deadline = null;
    this.state = 'finished';
    this.progress = 100;
    this.timerComplete.emit();
  }

  formatTime(seconds: number): string {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }

  getClasses(): string {
    return `timer timer--${this.state}`;
  }

  private calculateProgress(): void {
    if (this.duration === 0) {
      this.progress = 0;
      return;
    }
    this.progress = ((this.duration - this.currentTime) / this.duration) * 100;
  }

  private updateFromClock(): boolean {
    if (this.deadline === null || this.state !== 'running') return false;
    const remaining = Math.max(0, Math.ceil((this.deadline - Date.now()) / 1000));
    if (remaining === this.currentTime) return false;

    this.currentTime = remaining;
    this.calculateProgress();
    this.timerTick.emit(this.currentTime);
    if (remaining === 0) {
      this.complete();
      return true;
    }
    return false;
  }

  private stopInterval(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }
}
