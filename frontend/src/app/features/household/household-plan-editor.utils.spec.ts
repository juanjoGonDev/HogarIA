import {
  createHouseholdPlanSpace,
  findGuidedSpacePlacement,
  createHouseholdPlanPolygon,
  createHouseholdPlanWall,
  cloneHouseholdPlan,
  createHouseholdPlanFloor,
  emptyHouseholdPlan,
  moveHouseholdPlanSpace,
  openingSegment,
  openingRails,
  doorSwing,
  polygonCentroid
} from './household-plan-editor.utils';
import type {
  HouseholdPlanFloor,
  HouseholdPlanOpening,
  HouseholdPlanSpace,
  HouseholdPlanWall
} from '../../shared/models/household-plan.model';

function space(overrides: Partial<HouseholdPlanSpace> = {}): HouseholdPlanSpace {
  return {
    id: 'kitchen-1',
    kind: 'kitchen',
    label: 'Cocina',
    parentSpaceId: null,
    polygon: [
      { x: 100, y: 100 },
      { x: 500, y: 100 },
      { x: 500, y: 400 },
      { x: 100, y: 400 }
    ],
    ...overrides
  };
}

function floor(walls: HouseholdPlanWall[] = []): HouseholdPlanFloor {
  return { id: 'floor-0', name: 'Planta baja', level: 0, walls, openings: [], spaces: [] };
}

describe('household plan editor geometry helpers', () => {
  it('starts guided areas at the standard position on an empty floor', () => {
    expect(findGuidedSpacePlacement([])).toEqual({
      start: { x: 700, y: 700 },
      end: { x: 3_300, y: 3_200 }
    });
  });

  it('finds a useful gap without intersecting existing polygon bounds', () => {
    const existingSpaces = [
      space({
        polygon: [
          { x: 300, y: 1_400 },
          { x: 3_600, y: 1_400 },
          { x: 3_600, y: 4_000 },
          { x: 300, y: 4_000 }
        ]
      }),
      space({
        id: 'bathroom',
        polygon: [
          { x: 300, y: 4_000 },
          { x: 3_000, y: 4_000 },
          { x: 3_000, y: 5_600 },
          { x: 300, y: 5_600 }
        ]
      }),
      space({
        id: 'bedroom',
        polygon: [
          { x: 300, y: 5_600 },
          { x: 4_300, y: 5_600 },
          { x: 4_300, y: 8_600 },
          { x: 500, y: 8_600 }
        ]
      })
    ];

    const placement = findGuidedSpacePlacement(existingSpaces);

    expect(placement).not.toBeNull();
    const width = placement!.end.x - placement!.start.x;
    const height = placement!.end.y - placement!.start.y;
    expect(width).toBeGreaterThanOrEqual(700);
    expect(height).toBeGreaterThanOrEqual(700);
    expect(width).toBeLessThanOrEqual(2_600);
    expect(height).toBeLessThanOrEqual(2_500);
    expect(
      existingSpaces.every((candidate) => {
        const xs = candidate.polygon.map((point) => point.x);
        const ys = candidate.polygon.map((point) => point.y);
        return (
          placement!.end.x <= Math.min(...xs) ||
          placement!.start.x >= Math.max(...xs) ||
          placement!.end.y <= Math.min(...ys) ||
          placement!.start.y >= Math.max(...ys)
        );
      })
    ).toBeTrue();
  });

  it('returns no guided placement when all available plan bounds are occupied', () => {
    expect(
      findGuidedSpacePlacement([
        space({
          polygon: [
            { x: 0, y: 0 },
            { x: 10_000, y: 0 },
            { x: 10_000, y: 10_000 },
            { x: 0, y: 10_000 }
          ]
        })
      ])
    ).toBeNull();
  });

  it('starts with one valid floor and the supported dwelling defaults', () => {
    expect(emptyHouseholdPlan('Planta baja')).toEqual({
      schemaVersion: 1,
      dwellingType: 'apartment',
      dwellingTypeLabel: null,
      summary: '',
      warnings: [],
      floors: [floor()]
    });
  });

  it('creates a normalized rectangular space in either drag direction and rejects tiny shapes', () => {
    expect(
      createHouseholdPlanSpace(
        'balcony',
        'Balcón',
        'balcony-1',
        { x: 900, y: 800 },
        { x: 200, y: 100 }
      )
    ).toEqual({
      id: 'balcony-1',
      kind: 'balcony',
      label: 'Balcón',
      parentSpaceId: null,
      polygon: [
        { x: 200, y: 100 },
        { x: 900, y: 100 },
        { x: 900, y: 800 },
        { x: 200, y: 800 }
      ]
    });
    expect(
      createHouseholdPlanSpace('kitchen', 'Cocina', 'tiny', { x: 0, y: 0 }, { x: 20, y: 20 })
    ).toBeNull();
    expect(
      createHouseholdPlanSpace('custom', '', 'custom-1', { x: 10_000, y: 0 }, { x: 0, y: 10_000 })
    ).toBeNull();
  });

  it('preserves diagonal walls, clamps coordinates, and rejects a zero-length line', () => {
    expect(
      createHouseholdPlanWall('wall-1', 'interior', { x: -100, y: 500 }, { x: 900, y: 520 })
    ).toEqual({
      id: 'wall-1',
      kind: 'interior',
      from: { x: 0, y: 500 },
      to: { x: 900, y: 520 }
    });
    expect(
      createHouseholdPlanWall('wall-2', 'exterior', { x: 200, y: 900 }, { x: 210, y: 100 })
    ).toEqual({
      id: 'wall-2',
      kind: 'exterior',
      from: { x: 200, y: 900 },
      to: { x: 210, y: 100 }
    });
    expect(createHouseholdPlanWall('zero', 'interior', { x: 5, y: 5 }, { x: 5, y: 5 })).toBeNull();
  });

  it('creates valid freeform concave and custom polygons but rejects malformed or tiny shapes', () => {
    const points = [
      { x: 100, y: 100 },
      { x: 900, y: 100 },
      { x: 900, y: 400 },
      { x: 500, y: 400 },
      { x: 500, y: 900 },
      { x: 100, y: 900 }
    ];
    expect(createHouseholdPlanPolygon('bedroom', 'Dormitorio', 'bedroom-freeform', points)).toEqual(
      {
        id: 'bedroom-freeform',
        kind: 'bedroom',
        label: 'Dormitorio',
        parentSpaceId: null,
        polygon: points
      }
    );
    expect(
      createHouseholdPlanPolygon('custom', 'Trastero exterior', 'custom-1', [
        { x: 0, y: 0 },
        { x: 800, y: 0 },
        { x: 300, y: 800 }
      ])?.label
    ).toBe('Trastero exterior');
    expect(
      createHouseholdPlanPolygon('custom', '', 'custom-1', [
        { x: 0, y: 0 },
        { x: 800, y: 0 },
        { x: 300, y: 800 }
      ])
    ).toBeNull();
    expect(
      createHouseholdPlanPolygon('kitchen', 'Cocina', 'bow-tie', [
        { x: 100, y: 100 },
        { x: 900, y: 900 },
        { x: 100, y: 900 },
        { x: 900, y: 100 }
      ])
    ).toBeNull();
    expect(
      createHouseholdPlanPolygon('kitchen', 'Cocina', 'tiny', [
        { x: 100, y: 100 },
        { x: 150, y: 100 },
        { x: 150, y: 180 },
        { x: 100, y: 180 }
      ])
    ).toBeNull();
  });

  it('moves a space as one polygon and clamps it inside the normalized canvas', () => {
    expect(moveHouseholdPlanSpace(space(), 300, -200).polygon).toEqual([
      { x: 400, y: 0 },
      { x: 800, y: 0 },
      { x: 800, y: 300 },
      { x: 400, y: 300 }
    ]);
    expect(moveHouseholdPlanSpace(space(), 20_000, 20_000).polygon).toEqual([
      { x: 9_600, y: 9_700 },
      { x: 10_000, y: 9_700 },
      { x: 10_000, y: 10_000 },
      { x: 9_600, y: 10_000 }
    ]);
  });

  it('converts openings to line segments for horizontal and vertical walls', () => {
    const horizontal: HouseholdPlanWall = {
      id: 'h',
      kind: 'exterior',
      from: { x: 100, y: 200 },
      to: { x: 900, y: 200 }
    };
    const vertical: HouseholdPlanWall = {
      id: 'v',
      kind: 'interior',
      from: { x: 300, y: 900 },
      to: { x: 300, y: 100 }
    };
    const door: HouseholdPlanOpening = {
      id: 'door',
      wallId: 'h',
      kind: 'door',
      offset: 200,
      width: 100,
      isMainEntrance: true
    };

    expect(openingSegment([horizontal], door)).toEqual({
      from: { x: 300, y: 200 },
      to: { x: 400, y: 200 }
    });
    expect(openingSegment([vertical], { ...door, wallId: 'v', offset: 100 })).toEqual({
      from: { x: 300, y: 800 },
      to: { x: 300, y: 700 }
    });
    expect(openingSegment([], door)).toBeNull();
  });

  it('positions openings, window rails and door swings on diagonal walls by Euclidean distance', () => {
    const diagonal: HouseholdPlanWall = {
      id: 'diagonal',
      kind: 'exterior',
      from: { x: 100, y: 100 },
      to: { x: 400, y: 500 }
    };
    const opening: HouseholdPlanOpening = {
      id: 'window',
      wallId: 'diagonal',
      kind: 'window',
      offset: 100,
      width: 250,
      isMainEntrance: false
    };
    const segment = openingSegment([diagonal], opening);
    expect(segment).not.toBeNull();
    const diagonalSegment = segment!;
    expect(diagonalSegment).toEqual({ from: { x: 160, y: 180 }, to: { x: 310, y: 380 } });
    const rails = openingRails([diagonal], opening);
    expect(rails).toHaveSize(2);
    expect(rails[0].from.x).not.toBe(diagonalSegment.from.x);
    expect(rails[0].from.y).not.toBe(diagonalSegment.from.y);

    const swing = doorSwing([diagonal], { ...opening, kind: 'door' });
    expect(swing).not.toBeNull();
    expect(
      Math.hypot(swing!.hinge.x - swing!.leafTip.x, swing!.hinge.y - swing!.leafTip.y)
    ).toBeCloseTo(250);
  });

  it('returns an area-weighted center for irregular polygons', () => {
    const center = polygonCentroid([
      { x: 0, y: 0 },
      { x: 800, y: 0 },
      { x: 800, y: 300 },
      { x: 400, y: 300 },
      { x: 400, y: 800 },
      { x: 0, y: 800 }
    ]);
    expect(center.x).toBeCloseTo(309.09, 1);
    expect(center.y).toBeCloseTo(331.82, 1);
  });

  it('creates only supported additional floors and deep-clones drafts', () => {
    const initial = emptyHouseholdPlan('Planta baja');
    const firstAdditional = createHouseholdPlanFloor(initial.floors);
    expect(firstAdditional).toEqual(
      jasmine.objectContaining({ id: 'floor-1', name: 'Planta 1', level: 1 })
    );
    expect(createHouseholdPlanFloor(initial.floors, 'below')).toEqual(
      jasmine.objectContaining({ id: 'floor--1', name: 'Sótano 1', level: -1 })
    );
    expect(
      createHouseholdPlanFloor(
        Array.from({ length: 12 }, (_, level) => ({ ...floor(), level: 0 - level })),
        'below'
      )
    ).toBeNull();
    expect(
      createHouseholdPlanFloor(
        Array.from({ length: 12 }, (_, level) => floor()).map((item, index) => ({
          ...item,
          level: index
        }))
      )
    ).toBeNull();

    const draft = cloneHouseholdPlan(initial);
    draft.floors[0].name = 'Cambio local';
    expect(initial.floors[0].name).toBe('Planta baja');
  });
});
