import { ComponentFixture, TestBed } from '@angular/core/testing';
import { AvatarComponent } from './avatar.component';

describe('AvatarComponent', () => {
  let fixture: ComponentFixture<AvatarComponent>;
  let component: AvatarComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [AvatarComponent] }).compileComponents();
    fixture = TestBed.createComponent(AvatarComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('shows the initials fallback and emits when the image fails', () => {
    const imageUrl = 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=';
    const imageError = jasmine.createSpy('imageError');
    component.imageError.subscribe(imageError);

    fixture.componentRef.setInput('name', 'Ada Lovelace');
    fixture.componentRef.setInput('src', imageUrl);
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    const image = host.querySelector('.avatar__image') as HTMLImageElement;
    image.dispatchEvent(new Event('error'));
    fixture.detectChanges();

    expect(component.broken()).toBe(true);
    expect(imageError).toHaveBeenCalledOnceWith(imageUrl);
    expect(host.querySelector('.avatar__initials--fallback')?.textContent?.trim()).toBe('AL');
  });

  it('keeps the fallback for the same source and clears it for a new source', () => {
    const imageUrl = 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=';
    const replacementUrl =
      'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
    fixture.componentRef.setInput('src', imageUrl);
    fixture.detectChanges();

    component.broken.set(true);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.avatar__initials--fallback')).not.toBeNull();

    component.src = imageUrl;
    fixture.detectChanges();
    expect(component.broken()).toBe(true);
    expect(fixture.nativeElement.querySelector('.avatar__initials--fallback')).not.toBeNull();

    component.src = replacementUrl;
    fixture.detectChanges();

    expect(component.broken()).toBe(false);
    expect(fixture.nativeElement.querySelector('.avatar__initials--fallback')).toBeNull();
    expect(
      (fixture.nativeElement.querySelector('.avatar__image') as HTMLImageElement).getAttribute(
        'src'
      )
    ).toBe(replacementUrl);
  });
});
