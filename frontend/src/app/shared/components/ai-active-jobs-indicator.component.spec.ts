import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { AiActiveJobsIndicatorComponent } from './ai-active-jobs-indicator.component';
import { AiActiveJobsService } from '../../core/services/ai-active-jobs.service';
import { I18nService } from '../../core/services/i18n.service';
import type { AiActiveJob } from '../models/ai-active-job.model';

const job = (id: string, status: AiActiveJob['status'], kind = 'recipe'): AiActiveJob => ({
  id,
  kind,
  status,
  createdAt: '2026-11-01T12:00:00.000Z',
  startedAt: status === 'running' ? '2026-11-01T12:00:01.000Z' : null
});

describe('AiActiveJobsIndicatorComponent', () => {
  let fixture: ComponentFixture<AiActiveJobsIndicatorComponent>;
  let jobs: ReturnType<typeof signal<AiActiveJob[]>>;
  let service: { jobs: typeof jobs; watch: jasmine.Spy };
  let translate: jasmine.Spy;
  let stopWatching: jasmine.Spy;

  beforeEach(async () => {
    jobs = signal<AiActiveJob[]>([]);
    stopWatching = jasmine.createSpy('stopWatching');
    service = {
      jobs,
      watch: jasmine.createSpy('watch').and.returnValue(stopWatching)
    };
    translate = jasmine
      .createSpy('translate')
      .and.callFake(
        (_key, params) =>
          `${params.total} AI jobs active: ${params.queued} queued, ${params.running} running`
      );

    await TestBed.configureTestingModule({
      imports: [AiActiveJobsIndicatorComponent],
      providers: [
        { provide: AiActiveJobsService, useValue: service },
        { provide: I18nService, useValue: { changeTick: signal(0), t: translate } }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(AiActiveJobsIndicatorComponent);
    fixture.detectChanges();
  });

  afterEach(() => fixture.destroy());

  it('starts shared polling when mounted, hides when empty, and releases its watcher on destroy', () => {
    expect(service.watch).toHaveBeenCalledTimes(1);
    expect(
      fixture.nativeElement.querySelector('[data-test="ai-active-jobs-indicator"]')
    ).toBeNull();
    expect(fixture.nativeElement.querySelectorAll('[role="status"]').length).toBe(0);

    fixture.destroy();
    expect(stopWatching).toHaveBeenCalledTimes(1);
  });

  it('announces queued and running job counts without exposing a fake interactive control', () => {
    jobs.set([job('queued-1', 'queued'), job('running-1', 'running')]);
    fixture.detectChanges();

    const indicator = fixture.nativeElement.querySelector(
      '[data-test="ai-active-jobs-indicator"]'
    ) as HTMLElement;
    const status = fixture.nativeElement.querySelector('[role="status"]') as HTMLElement;
    expect(status.getAttribute('aria-live')).toBe('polite');
    expect(status.textContent?.trim()).toBe('2 AI jobs active: 1 queued, 1 running');
    expect(indicator.querySelector('.ai-active-jobs__count')?.textContent?.trim()).toBe('2');
    expect(indicator.querySelector('button, a')).toBeNull();
    expect(translate).toHaveBeenCalledWith('ai_activity.active_jobs_label', {
      total: 2,
      queued: 1,
      running: 1
    });
  });

  it('removes the indicator after the final job reaches a terminal state', () => {
    jobs.set([job('running-1', 'running')]);
    fixture.detectChanges();
    expect(
      fixture.nativeElement.querySelector('[data-test="ai-active-jobs-indicator"]')
    ).not.toBeNull();
    expect(fixture.nativeElement.querySelector('[role="status"]')?.textContent?.trim()).not.toBe(
      ''
    );

    jobs.set([]);
    fixture.detectChanges();
    expect(
      fixture.nativeElement.querySelector('[data-test="ai-active-jobs-indicator"]')
    ).toBeNull();
    expect(fixture.nativeElement.querySelectorAll('[role="status"]').length).toBe(0);
  });

  it('does not mislabel a connection test as an assistant job', () => {
    jobs.set([job('connection-test-1', 'running', 'connection_test')]);
    fixture.detectChanges();

    const status = fixture.nativeElement.querySelector('[role="status"]') as HTMLElement;
    expect(status.textContent?.trim()).toBe('1 AI jobs active: 0 queued, 1 running');
    expect(status.textContent).not.toContain('assistant');
  });
});
