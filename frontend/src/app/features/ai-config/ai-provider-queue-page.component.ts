import { CommonModule } from '@angular/common';
import { Component, computed, inject, OnInit } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { map } from 'rxjs';
import { AiService } from '../../core/services/ai.service';
import { TranslatePipe } from '../../core/pipes/translate.pipe';
import { ButtonComponent } from '../../shared/components/ui/button/button.component';
import { IconComponent } from '../../shared/components/ui/icon/icon.component';
import { AIProviderConfig } from '../../shared/models/ai-config.model';
import { AiProviderQueueComponent } from './ai-provider-queue.component';

@Component({
  selector: 'app-ai-provider-queue-page',
  standalone: true,
  imports: [
    CommonModule,
    RouterLink,
    TranslatePipe,
    ButtonComponent,
    IconComponent,
    AiProviderQueueComponent
  ],
  template: `
    <main class="ai-queue-page">
      @let providerConfig = provider();
      <a class="ai-queue-page__back" routerLink="/ai-config" data-test="queue-back-link">
        <app-icon name="chevron_left" [size]="18" [label]="null" />
        {{ 'ai_config.queue_back_to_providers' | t }}
      </a>

      @if (aiService.configsLoading() && !providerConfig) {
        <p class="ai-queue-page__state" role="status" aria-live="polite">
          {{ 'ai_config.queue_page_loading' | t }}
        </p>
      } @else if (aiService.configsError()) {
        <section class="ai-queue-page__notice" role="alert">
          <p>{{ 'ai_config.configs_load_error' | t }}</p>
          <app-button
            variant="outline"
            type="button"
            [touchTarget]="true"
            [disabled]="aiService.configsLoading()"
            (onClick)="aiService.loadConfigs()"
          >
            <app-icon name="refresh" [size]="16" [label]="null" />
            {{ 'ai_config.retry' | t }}
          </app-button>
        </section>
      } @else if (providerConfig) {
        <header class="ai-queue-page__header">
          <div>
            <h1>{{ 'ai_config.queue_page_title' | t: { provider: providerConfig.name } }}</h1>
            <p>{{ providerConfig.provider }} · {{ providerConfig.model }}</p>
          </div>
          <span class="ai-queue-page__limit">
            {{ 'ai_config.concurrencia' | t }}: {{ providerConfig.concurrency }}
          </span>
        </header>

        @if (providerConfig.concurrency > 0) {
          <app-ai-provider-queue [config]="providerConfig" />
        } @else {
          <p class="ai-queue-page__state" role="status">
            {{ 'ai_config.queue_unavailable_unlimited' | t }}
          </p>
        }
      } @else {
        <section class="ai-queue-page__notice" role="alert">
          <h1>{{ 'ai_config.queue_provider_not_found' | t }}</h1>
        </section>
      }
    </main>
  `,
  styles: [
    `
      .ai-queue-page {
        width: min(100%, 800px);
        min-width: 0;
        margin: 0 auto;
        padding-block: var(--container-padding);
      }

      .ai-queue-page__back {
        display: inline-flex;
        align-items: center;
        gap: var(--space-1);
        min-height: 44px;
        margin-bottom: var(--space-4);
        color: var(--text-secondary);
        font-size: var(--text-sm);
        text-decoration: none;
      }

      .ai-queue-page__back:hover {
        color: var(--text-primary);
        text-decoration: underline;
      }

      .ai-queue-page__back:focus-visible {
        outline: 2px solid var(--primary);
        outline-offset: 2px;
      }

      .ai-queue-page__header {
        display: flex;
        flex-wrap: wrap;
        align-items: flex-start;
        justify-content: space-between;
        gap: var(--space-3);
        margin-bottom: var(--space-4);
      }

      .ai-queue-page__header h1,
      .ai-queue-page__header p,
      .ai-queue-page__notice h1,
      .ai-queue-page__notice p {
        margin: 0;
      }

      .ai-queue-page__header h1,
      .ai-queue-page__notice h1 {
        font-size: var(--text-xl);
        font-weight: var(--font-semibold);
      }

      .ai-queue-page__header p {
        margin-top: var(--space-1);
        color: var(--text-secondary);
        font-size: var(--text-sm);
      }

      .ai-queue-page__limit {
        color: var(--text-secondary);
        font-size: var(--text-sm);
      }

      .ai-queue-page__state,
      .ai-queue-page__notice {
        margin: 0;
        padding: var(--space-4);
        border: 1px solid var(--border-default);
        border-radius: var(--radius-md);
        font-size: var(--text-sm);
      }

      .ai-queue-page__notice {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: var(--space-3);
        border-color: var(--error);
        background: var(--error-subtle);
      }
    `
  ]
})
export class AiProviderQueuePageComponent implements OnInit {
  readonly aiService = inject(AiService);
  private readonly route = inject(ActivatedRoute);
  private readonly configId = toSignal(
    this.route.paramMap.pipe(map((params) => params.get('configId') ?? '')),
    { initialValue: this.route.snapshot.paramMap.get('configId') ?? '' }
  );
  readonly provider = computed<AIProviderConfig | undefined>(() =>
    this.aiService.configs().find((config) => config.id === this.configId())
  );

  ngOnInit(): void {
    this.aiService.loadConfigs();
  }
}
