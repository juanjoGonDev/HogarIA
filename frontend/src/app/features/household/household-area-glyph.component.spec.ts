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
    expect(paths[0].getAttribute('d')).toContain('M19 10h19');
  });

  it('traces the prototype cooktop and furniture silhouettes as separate SVG symbols', () => {
    fixture.componentRef.setInput('kind', 'kitchen');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('circle')).toHaveSize(4);
    expect(fixture.nativeElement.querySelector('rect')?.getAttribute('rx')).toBe('2');

    fixture.componentRef.setInput('kind', 'living_room');
    fixture.detectChanges();
    const sofaPaths: SVGPathElement[] = fixture.nativeElement.querySelectorAll('path');
    expect(sofaPaths).toHaveSize(2);
    expect(sofaPaths[1].getAttribute('d')).toContain('M14 30');

    fixture.componentRef.setInput('kind', 'bedroom');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('path')).toHaveSize(1);
    expect(fixture.nativeElement.querySelector('path')?.getAttribute('d')).toContain('M15 24h14');
  });
});
