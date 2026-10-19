import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { PageContainerComponent } from './page-container.component';

@Component({
  standalone: true,
  imports: [PageContainerComponent],
  template: `
    <app-page-container [bounded]="bounded" [fullContent]="fullContent">
      <p data-test="projected-content">Contenido de página</p>
    </app-page-container>
  `
})
class HostComponent {
  bounded = false;
  fullContent = true;
}

describe('PageContainerComponent', () => {
  let fixture: ComponentFixture<HostComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [HostComponent] }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
  });

  it('applies the shared gutter host and projects route content exactly once', () => {
    const frame = fixture.nativeElement.querySelector('app-page-container') as HTMLElement;

    expect(frame.classList.contains('page-container')).toBeTrue();
    expect(frame.classList.contains('page-container--full-content')).toBeTrue();
    expect(frame.querySelectorAll('[data-test="projected-content"]').length).toBe(1);
    expect(frame.textContent?.trim()).toBe('Contenido de página');
    expect(frame.classList.contains('page-container--bounded')).toBeFalse();
  });

  it('can bound private content without changing the shared gutter host', () => {
    fixture.componentInstance.bounded = true;
    fixture.detectChanges();
    const frame = fixture.nativeElement.querySelector('app-page-container') as HTMLElement;

    expect(frame.classList.contains('page-container')).toBeTrue();
    expect(frame.classList.contains('page-container--bounded')).toBeTrue();
    expect(frame.querySelector('[data-test="projected-content"]')).not.toBeNull();
  });

  it('can preserve a deliberately narrow card inside a shared frame', () => {
    fixture.componentInstance.fullContent = false;
    fixture.detectChanges();

    const frame = fixture.nativeElement.querySelector('app-page-container') as HTMLElement;
    expect(frame.classList.contains('page-container--full-content')).toBeFalse();
    expect(frame.querySelector('[data-test="projected-content"]')).not.toBeNull();
  });
});
