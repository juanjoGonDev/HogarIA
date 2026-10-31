import { Component, inject } from '@angular/core';
import { ButtonComponent } from './ui/button/button.component';
import { TranslatePipe } from '../../core/pipes/translate.pipe';
import { ServiceWorkerUpdateService } from '../../core/services/service-worker-update.service';

@Component({
  selector: 'app-update-notice',
  standalone: true,
  imports: [ButtonComponent, TranslatePipe],
  template: `
    @if (updateService.updateAvailable()) {
      <section
        class="app-update-notice"
        role="status"
        aria-live="polite"
        data-test="app-update-notice"
      >
        <div class="app-update-notice__content">
          <p>{{ 'ui.app_update_available' | t }}</p>
          @if (updateService.activationFailed()) {
            <p role="alert" class="app-update-notice__error">{{ 'ui.app_update_failed' | t }}</p>
          }
        </div>
        <app-button
          data-test="app-update-action"
          variant="outline"
          size="sm"
          type="button"
          [touchTarget]="true"
          (onClick)="activateUpdate()"
        >
          {{ 'ui.app_update_reload' | t }}
        </app-button>
      </section>
    }
  `,
  styles: `
    :host {
      display: block;
    }

    .app-update-notice {
      box-sizing: border-box;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--space-3);
      width: min(100%, 80rem);
      margin-inline: auto;
      padding: var(--space-3) var(--space-4);
      color: var(--text-primary);
      background: var(--primary-subtle);
      border: 1px solid var(--border-default);
      border-radius: var(--radius-lg);
    }

    .app-update-notice__content {
      display: grid;
      gap: var(--space-1);
      min-width: 0;
    }

    p {
      margin: 0;
    }

    .app-update-notice__error {
      color: var(--error);
    }

    @media (max-width: 480px) {
      .app-update-notice {
        align-items: flex-start;
        flex-direction: column;
        padding-inline: var(--space-3);
      }
    }
  `
})
export class AppUpdateNoticeComponent {
  readonly updateService = inject(ServiceWorkerUpdateService);

  activateUpdate(): void {
    void this.updateService.activateUpdateAndReload();
  }
}
