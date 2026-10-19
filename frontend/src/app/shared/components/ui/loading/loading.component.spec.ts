import { ComponentFixture, TestBed } from '@angular/core/testing';
import { LoadingComponent } from './loading.component';

describe('LoadingComponent', () => {
  let fixture: ComponentFixture<LoadingComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [LoadingComponent] }).compileComponents();
    fixture = TestBed.createComponent(LoadingComponent);
    fixture.detectChanges();
  });

  it('renders the default medium spinner without a message or layout modifiers', () => {
    const host = fixture.nativeElement as HTMLElement;
    const container = host.querySelector('.loading-container');
    const spinner = host.querySelector('.spinner');

    expect(container).not.toBeNull();
    expect(container?.classList.contains('loading-container--fullscreen')).toBe(false);
    expect(container?.classList.contains('loading-container--inline')).toBe(false);
    expect(spinner?.classList.contains('spinner--md')).toBe(true);
    expect(host.querySelector('.loading__message')).toBeNull();
  });

  it('renders the selected size and message', () => {
    const host = fixture.nativeElement as HTMLElement;

    fixture.componentRef.setInput('size', 'sm');
    fixture.componentRef.setInput('message', 'Cargando datos');
    fixture.detectChanges();

    expect(host.querySelector('.spinner')?.classList.contains('spinner--sm')).toBe(true);
    expect(host.querySelector('.loading__message')?.textContent?.trim()).toBe('Cargando datos');
  });

  it('combines fullscreen and inline container modifiers', () => {
    const host = fixture.nativeElement as HTMLElement;

    fixture.componentRef.setInput('size', 'lg');
    fixture.componentRef.setInput('fullscreen', true);
    fixture.componentRef.setInput('inline', true);
    fixture.detectChanges();

    const container = host.querySelector('.loading-container');
    expect(container?.classList.contains('loading-container--fullscreen')).toBe(true);
    expect(container?.classList.contains('loading-container--inline')).toBe(true);
    expect(host.querySelector('.spinner')?.classList.contains('spinner--lg')).toBe(true);
  });
});
