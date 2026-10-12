import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { HouseholdPlanFloor } from '../../shared/models/household-plan.model';
import { HouseholdPlanPreviewMapComponent } from './household-plan-preview-map.component';

describe('HouseholdPlanPreviewMapComponent', () => {
  let fixture: ComponentFixture<HouseholdPlanPreviewMapComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HouseholdPlanPreviewMapComponent]
    }).compileComponents();
    fixture = TestBed.createComponent(HouseholdPlanPreviewMapComponent);
  });

  it('renders an accessible plan with rooms, structural walls, doors and windows', () => {
    const floor: HouseholdPlanFloor = {
      id: 'floor-0',
      name: 'Planta baja',
      level: 0,
      spaces: [
        {
          id: 'kitchen',
          kind: 'kitchen',
          label: 'Cocina',
          polygon: [
            { x: 1000, y: 1000 },
            { x: 4000, y: 1000 },
            { x: 4000, y: 4000 },
            { x: 1000, y: 4000 }
          ],
          parentSpaceId: null
        }
      ],
      walls: [
        { id: 'north', kind: 'exterior', from: { x: 1000, y: 1000 }, to: { x: 4000, y: 1000 } },
        { id: 'east', kind: 'interior', from: { x: 4000, y: 1000 }, to: { x: 4000, y: 4000 } }
      ],
      openings: [
        {
          id: 'front-door',
          wallId: 'east',
          kind: 'door',
          offset: 500,
          width: 800,
          isMainEntrance: true
        },
        {
          id: 'window',
          wallId: 'north',
          kind: 'window',
          offset: 600,
          width: 1200,
          isMainEntrance: false
        }
      ]
    };

    fixture.componentRef.setInput('floor', floor);
    fixture.componentRef.setInput('ariaLabel', 'Plano propuesto');
    fixture.detectChanges();

    const element: SVGSVGElement = fixture.nativeElement.querySelector('svg.plan-compare-canvas');
    expect(element.getAttribute('aria-label')).toBe('Plano propuesto');
    const viewBox = element.getAttribute('viewBox')?.split(' ').map(Number);
    expect(viewBox).toBeDefined();
    expect(viewBox![0]).toBeLessThan(1000);
    expect(viewBox![1]).toBeLessThan(1000);
    expect(1000 - viewBox![0]).toBeGreaterThanOrEqual(74);
    expect(1000 - viewBox![1]).toBeGreaterThanOrEqual(74);
    expect(viewBox![2]).toBeGreaterThan(3000);
    expect(viewBox![3]).toBeGreaterThan(3000);
    expect(fixture.nativeElement.querySelector('.plan-compare-canvas__paper')).not.toBeNull();
    expect(fixture.nativeElement.querySelectorAll('.plan-compare-canvas__space').length).toBe(1);
    expect(fixture.nativeElement.querySelectorAll('.plan-compare-canvas__wall').length).toBe(2);
    expect(
      fixture.nativeElement.querySelectorAll('.plan-compare-canvas__wall--exterior').length
    ).toBe(1);
    expect(fixture.nativeElement.querySelectorAll('.plan-canvas__door-swing').length).toBe(1);
    expect(fixture.nativeElement.querySelectorAll('.plan-canvas__window-rail').length).toBe(2);
    expect(fixture.nativeElement.querySelector('.plan-canvas__entrance-mark')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('text')?.textContent?.trim()).toBe('Cocina');
  });

  it('keeps the accessible map shell when no plan floor is available', () => {
    fixture.componentRef.setInput('floor', null);
    fixture.componentRef.setInput('ariaLabel', 'Plano vacío');
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('svg.plan-compare-canvas')).not.toBeNull();
    expect(fixture.nativeElement.querySelectorAll('.plan-compare-canvas__space').length).toBe(0);
    expect(fixture.nativeElement.querySelectorAll('.plan-compare-canvas__wall').length).toBe(0);
    expect(
      fixture.nativeElement.querySelector('svg.plan-compare-canvas')?.getAttribute('viewBox')
    ).toBe('0 0 10000 10000');
  });

  it('zooms the plan geometry around the center while keeping the map frame fixed', () => {
    fixture.componentRef.setInput('floor', null);
    fixture.componentRef.setInput('zoom', 120);
    fixture.detectChanges();

    const map = fixture.nativeElement.querySelector('svg.plan-compare-canvas');
    const drawing = fixture.nativeElement.querySelector('.plan-compare-canvas__drawing');
    expect(map.getAttribute('viewBox')).toBe('0 0 10000 10000');
    expect(drawing.getAttribute('transform')).toBe('translate(-1000 -1000) scale(1.2)');
    expect(map.querySelector('.plan-compare-canvas__paper')).not.toBeNull();
  });

  it('draws vertical windows and horizontal doors and skips openings without a wall', () => {
    const floor: HouseholdPlanFloor = {
      id: 'floor-0',
      name: 'Planta baja',
      level: 0,
      spaces: [],
      walls: [
        { id: 'north', kind: 'exterior', from: { x: 0, y: 0 }, to: { x: 3000, y: 0 } },
        { id: 'east', kind: 'exterior', from: { x: 3000, y: 0 }, to: { x: 3000, y: 3000 } }
      ],
      openings: [
        {
          id: 'door',
          wallId: 'north',
          kind: 'door',
          offset: 500,
          width: 800,
          isMainEntrance: false
        },
        {
          id: 'window',
          wallId: 'east',
          kind: 'window',
          offset: 500,
          width: 800,
          isMainEntrance: false
        },
        {
          id: 'orphaned-opening',
          wallId: 'missing-wall',
          kind: 'window',
          offset: 500,
          width: 800,
          isMainEntrance: false
        }
      ]
    };
    fixture.componentRef.setInput('floor', floor);
    fixture.detectChanges();

    const component = fixture.componentInstance;
    expect(component.doorSwing(floor.openings[0])?.arc).toContain('A 800 800 0 0 0');
    expect(component.openingRails(floor.openings[1])).toHaveSize(2);
    expect(component.openingLine(floor.openings[2])).toBeNull();
    expect(component.openingRails(floor.openings[2])).toEqual([]);

    component.floor = null;
    expect(component.openingLine(floor.openings[0])).toBeNull();
  });
});
