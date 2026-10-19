import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HouseholdAreaGlyphComponent } from './household-area-glyph.component';

describe('HouseholdAreaGlyphComponent', () => {
  let fixture: ComponentFixture<HouseholdAreaGlyphComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HouseholdAreaGlyphComponent]
    }).compileComponents();
    fixture = TestBed.createComponent(HouseholdAreaGlyphComponent);
  });

  it('draws the bathroom symbol as a simple toilet glyph', () => {
    fixture.componentRef.setInput('kind', 'bathroom');
    fixture.detectChanges();

    const paths: SVGPathElement[] = fixture.nativeElement.querySelectorAll('path');
    expect(fixture.nativeElement.querySelectorAll('circle').length).toBe(0);
    expect(paths.length).toBe(1);
    expect(paths[0].getAttribute('d')).toContain('M17 11h15');
    expect(paths[0].getAttribute('d')).toContain('M28 50v6h8v-6');
  });

  it('traces the prototype cooktop and furniture silhouettes as separate SVG symbols', () => {
    fixture.componentRef.setInput('kind', 'kitchen');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('circle')).toHaveSize(4);
    expect(fixture.nativeElement.querySelector('rect')?.getAttribute('rx')).toBe('2');
    const cooktopPath = fixture.nativeElement.querySelector('path')?.getAttribute('d');
    expect(cooktopPath).toContain('M18 27h28');
    expect(cooktopPath).toContain('M18 43h28');

    fixture.componentRef.setInput('kind', 'living_room');
    fixture.detectChanges();
    const sofaPaths: SVGPathElement[] = fixture.nativeElement.querySelectorAll('path');
    expect(sofaPaths).toHaveSize(2);
    expect(sofaPaths[0].getAttribute('d')).toContain('M17 31V21');
    expect(sofaPaths[1].getAttribute('d')).toContain('M14 30');
    expect(sofaPaths[1].getAttribute('d')).toContain('M15 41h34');

    fixture.componentRef.setInput('kind', 'bedroom');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('path')).toHaveSize(1);
    expect(fixture.nativeElement.querySelector('path')?.getAttribute('d')).toContain(
      'M16 17h32a4 4 0 0 1 4 4v13H12V21a4 4 0 0 1 4-4z'
    );

    fixture.componentRef.setInput('kind', 'hallway');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('path')?.getAttribute('d')).toBe(
      'M12 18h40M12 32h40M12 46h40'
    );

    fixture.componentRef.setInput('kind', 'patio');
    fixture.detectChanges();
    const patioPaths: SVGPathElement[] = fixture.nativeElement.querySelectorAll('path');
    expect(patioPaths).toHaveSize(3);
    expect((patioPaths[1].getAttribute('d')?.match(/Z/g) ?? []).length).toBe(2);
  });
});
