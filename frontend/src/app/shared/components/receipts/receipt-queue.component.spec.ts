import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { of, Subject } from 'rxjs';
import type { ReceiptJob, ReceiptQueueSnapshot } from '../../../shared/models/receipt.model';
import { ReceiptsService } from '../../../core/services/receipts.service';
import { ReceiptQueueComponent } from './receipt-queue.component';

const snapshot = (jobs: ReceiptJob[] = []): ReceiptQueueSnapshot => ({
  jobs,
  counts: {
    queued: jobs.filter((job) => job.status === 'queued').length,
    running: jobs.filter((job) => job.status === 'running').length,
    failed: jobs.filter((job) => job.status === 'failed').length
  }
});

const job = (status: ReceiptJob['status'], receiptId: string | null = 'receipt-1'): ReceiptJob => ({
  id: `job-${status}`,
  status,
  attempts: 1,
  max_attempts: 3,
  error_code: null,
  created_at: '2026-10-02T00:00:00.000Z',
  receipt_id: receiptId,
  store: null,
  file_name: 'synthetic.png',
  receipt_status: null,
  items: 0
});

describe('ReceiptQueueComponent actions', () => {
  let fixture: ComponentFixture<ReceiptQueueComponent>;
  let component: ReceiptQueueComponent;
  let routerEvents: Subject<unknown>;
  let service: {
    queue: ReturnType<typeof signal<ReceiptQueueSnapshot>>;
    queueBusy: ReturnType<typeof signal<boolean>>;
    watch: jasmine.Spy;
    unwatch: jasmine.Spy;
    stopAll: jasmine.Spy;
    stopJob: jasmine.Spy;
    retryJob: jasmine.Spy;
    refreshQueue: jasmine.Spy;
  };

  beforeEach(async () => {
    routerEvents = new Subject();
    service = {
      queue: signal(snapshot()),
      queueBusy: signal(false),
      watch: jasmine.createSpy('watch'),
      unwatch: jasmine.createSpy('unwatch'),
      stopAll: jasmine.createSpy('stopAll').and.resolveTo(null),
      stopJob: jasmine.createSpy('stopJob').and.resolveTo(null),
      retryJob: jasmine.createSpy('retryJob').and.resolveTo(null),
      refreshQueue: jasmine.createSpy('refreshQueue').and.returnValue(of(null))
    };

    await TestBed.configureTestingModule({
      imports: [ReceiptQueueComponent],
      providers: [
        { provide: ReceiptsService, useValue: service },
        { provide: Router, useValue: { events: routerEvents } }
      ]
    })
      .overrideComponent(ReceiptQueueComponent, { set: { template: '', imports: [] } })
      .compileComponents();

    fixture = TestBed.createComponent(ReceiptQueueComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('watches the singleton while mounted and unwatches on destroy', () => {
    expect(service.watch).toHaveBeenCalledTimes(1);
    fixture.destroy();
    expect(service.unwatch).toHaveBeenCalledTimes(1);
  });

  it('derives busy, error, active and stoppable states from the shared snapshot', () => {
    service.queue.set(snapshot([job('queued'), job('running'), job('failed')]));
    expect(component.procesando()).toBeTrue();
    expect(component.conErrores()).toBeFalse();
    expect(component.activo()).toBe(3);
    expect(component.detenibles().map((item) => item.status)).toEqual(['queued', 'running']);

    service.queue.set(snapshot([job('failed'), job('stopped'), job('done')]));
    expect(component.procesando()).toBeFalse();
    expect(component.conErrores()).toBeTrue();
    expect(component.detenibles()).toEqual([]);
    expect(component.activo()).toBe(3);

    service.queue.set(snapshot());
    expect(component.conErrores()).toBeFalse();
    expect(component.activo()).toBe(0);
  });

  it('opens beside its trigger, recomputes on resize and closes without stale position', () => {
    const sidebar = document.createElement('aside');
    sidebar.className = 'sidebar';
    const trigger = document.createElement('button');
    sidebar.appendChild(trigger);
    sidebar.getBoundingClientRect = () =>
      ({
        left: 0,
        top: 0,
        right: 280,
        bottom: 800,
        width: 280,
        height: 800
      }) as DOMRect;
    let top = 30;
    trigger.getBoundingClientRect = () =>
      ({
        left: 20,
        top,
        right: 64,
        bottom: top + 44,
        width: 44,
        height: 44
      }) as DOMRect;

    component.togglePanel({ currentTarget: trigger } as unknown as MouseEvent);
    expect(component.panelOpen()).toBeTrue();
    const firstPosition = component.panelPosition();
    expect(firstPosition).not.toBeNull();

    top = 100;
    component.repositionPanel();
    expect(component.panelPosition()).not.toEqual(firstPosition);

    component.togglePanel({ currentTarget: trigger } as unknown as MouseEvent);
    expect(component.panelOpen()).toBeFalse();
    expect(component.panelPosition()).toBeNull();
  });

  it('does not calculate a panel position before a trigger exists', () => {
    component.repositionPanel();
    expect(component.panelPosition()).toBeNull();
  });

  it('closes the queue panel only after router navigation completes', () => {
    const trigger = document.createElement('button');
    component.togglePanel({ currentTarget: trigger } as unknown as MouseEvent);
    expect(component.panelOpen()).toBeTrue();

    routerEvents.next(new NavigationEnd(1, '/receipts', '/receipts/receipt-1'));

    expect(component.panelOpen()).toBeFalse();
    expect(component.panelPosition()).toBeNull();
  });

  it('closes from document Escape and restores focus to its trigger', () => {
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);
    trigger.focus();
    component.togglePanel({ currentTarget: trigger } as unknown as MouseEvent);

    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    document.dispatchEvent(event);
    fixture.detectChanges();

    expect(event.defaultPrevented).toBeTrue();
    expect(component.panelOpen()).toBeFalse();
    expect(component.panelPosition()).toBeNull();
    expect(document.activeElement).toBe(trigger);
    trigger.remove();
  });

  it('also closes when Escape already dismissed a parent without stealing its focus', () => {
    const queueTrigger = document.createElement('button');
    const parentTrigger = document.createElement('button');
    document.body.append(queueTrigger, parentTrigger);
    parentTrigger.focus();
    component.togglePanel({ currentTarget: queueTrigger } as unknown as MouseEvent);

    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    event.preventDefault();
    document.dispatchEvent(event);
    fixture.detectChanges();

    expect(component.panelOpen()).toBeFalse();
    expect(component.panelPosition()).toBeNull();
    expect(document.activeElement).toBe(parentTrigger);
    queueTrigger.remove();
    parentTrigger.remove();
  });

  it('stops all visible work and refreshes after the service settles', async () => {
    await component.pararTodo();
    expect(service.stopAll).toHaveBeenCalledTimes(1);
    expect(service.refreshQueue).toHaveBeenCalledTimes(1);
  });

  it('stops queued and running receipt jobs and refreshes after each response', async () => {
    await component.pararUno(job('queued', 'receipt-queued'));
    await component.pararUno(job('running', 'receipt-running'));
    expect(service.stopJob.calls.allArgs()).toEqual([['receipt-queued'], ['receipt-running']]);
    expect(service.refreshQueue).toHaveBeenCalledTimes(2);
  });

  it('retries failed or stopped jobs by receipt id and refreshes the snapshot', async () => {
    await component.reintentarUno(job('failed', 'receipt-failed'));
    await component.reintentarUno(job('stopped', 'receipt-stopped'));
    expect(service.retryJob).toHaveBeenCalledTimes(2);
    expect(service.retryJob).toHaveBeenCalledWith('receipt-failed');
    expect(service.retryJob).toHaveBeenCalledWith('receipt-stopped');
    expect(service.refreshQueue).toHaveBeenCalledTimes(2);
  });

  it('does not call stop/retry APIs for detached jobs without a receipt id', async () => {
    await component.pararUno(job('running', null));
    await component.reintentarUno(job('failed', null));
    expect(service.stopJob).not.toHaveBeenCalled();
    expect(service.retryJob).not.toHaveBeenCalled();
    expect(service.refreshQueue).not.toHaveBeenCalled();
  });
});
