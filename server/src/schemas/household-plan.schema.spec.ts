import { describe, expect, it } from 'vitest';
import {
  HOUSEHOLD_AREA_KINDS,
  HOUSEHOLD_PLAN_RESPONSE_FORMAT,
  PLAN_LIMITS,
  householdPlanSchema
} from './household-plan.schema.js';
import type { HouseholdPlan } from './household-plan.schema.js';

function makeValidPlan(): HouseholdPlan {
  return {
    schemaVersion: 1,
    dwellingType: 'apartment',
    dwellingTypeLabel: null,
    summary: 'Boceto inicial',
    warnings: [],
    floors: [
      {
        id: 'floor-ground',
        name: 'Planta baja',
        level: 0,
        walls: [
          { id: 'wall-north', kind: 'exterior', from: { x: 100, y: 100 }, to: { x: 900, y: 100 } },
          { id: 'wall-east', kind: 'exterior', from: { x: 900, y: 100 }, to: { x: 900, y: 900 } },
          { id: 'wall-south', kind: 'exterior', from: { x: 900, y: 900 }, to: { x: 100, y: 900 } },
          { id: 'wall-west', kind: 'exterior', from: { x: 100, y: 900 }, to: { x: 100, y: 100 } }
        ],
        openings: [
          {
            id: 'opening-main',
            wallId: 'wall-north',
            kind: 'door',
            offset: 50,
            width: 100,
            isMainEntrance: true
          }
        ],
        spaces: [
          {
            id: 'space-garden',
            kind: 'garden',
            label: 'Jardín',
            polygon: [
              { x: 150, y: 150 },
              { x: 850, y: 150 },
              { x: 850, y: 850 },
              { x: 150, y: 850 }
            ],
            parentSpaceId: null
          },
          {
            id: 'space-pool',
            kind: 'pool',
            label: 'Piscina',
            polygon: [
              { x: 300, y: 300 },
              { x: 400, y: 300 },
              { x: 400, y: 400 },
              { x: 300, y: 400 }
            ],
            parentSpaceId: 'space-garden'
          }
        ]
      }
    ]
  };
}

function messagesFor(input: unknown): string[] {
  const result = householdPlanSchema.safeParse(input);
  return result.success ? [] : result.error.issues.map((issue) => issue.message);
}

function expectTooBig(input: unknown, path: Array<string | number>): void {
  const result = householdPlanSchema.safeParse(input);
  expect(result.success).toBe(false);
  if (!result.success) {
    expect(
      result.error.issues.some(
        (issue) => issue.code === 'too_big' && JSON.stringify(issue.path) === JSON.stringify(path)
      )
    ).toBe(true);
  }
}

describe('household plan schema and geometry contract', () => {
  it('accepts a bounded multi-entity plan, including nested exterior spaces', () => {
    expect(householdPlanSchema.safeParse(makeValidPlan()).success).toBe(true);
  });

  it('accepts a custom dwelling and custom space only with visible labels', () => {
    const plan = makeValidPlan();
    plan.dwellingType = 'other';
    plan.dwellingTypeLabel = 'Casa flotante';
    plan.floors[0].spaces[1].kind = 'custom';
    plan.floors[0].spaces[1].label = 'Zona para mascotas';
    expect(householdPlanSchema.safeParse(plan).success).toBe(true);

    plan.dwellingTypeLabel = null;
    expect(messagesFor(plan)).toContain('A dwelling type label is required for other.');
    plan.dwellingTypeLabel = 'Casa flotante';
    plan.floors[0].spaces[1].label = ' ';
    expect(messagesFor(plan)).toContain('A custom space requires a non-empty label.');
  });

  it('contains the broad home-area catalogue with stable exterior and custom identifiers', () => {
    expect(HOUSEHOLD_AREA_KINDS).toEqual(
      expect.arrayContaining([
        'garden',
        'vegetable_garden',
        'balcony',
        'terrace',
        'patio',
        'pool',
        'garage',
        'outdoor_kitchen',
        'pet_area',
        'custom'
      ])
    );
  });

  it('rejects non-normalized and fractional coordinates structurally', () => {
    const plan = makeValidPlan();
    plan.floors[0].spaces[0].polygon[0].x = 10_001;
    expect(householdPlanSchema.safeParse(plan).success).toBe(false);

    plan.floors[0].spaces[0].polygon[0].x = 150.5;
    expect(householdPlanSchema.safeParse(plan).success).toBe(false);
  });

  it('enforces floor, wall, space, opening, warning and polygon-size limits', () => {
    expect(PLAN_LIMITS).toMatchObject({
      maxFloors: 12,
      maxWallsPerFloor: 250,
      maxSpacesPerFloor: 80
    });

    const tooManyFloors = makeValidPlan();
    tooManyFloors.floors = Array.from({ length: 13 }, (_, index) => ({
      ...structuredClone(tooManyFloors.floors[0]),
      id: `floor-${index}`,
      level: index - 6
    }));
    expectTooBig(tooManyFloors, ['floors']);

    const tooManySpaces = makeValidPlan();
    tooManySpaces.floors[0].spaces = Array.from({ length: 81 }, (_, index) => ({
      ...structuredClone(tooManySpaces.floors[0].spaces[0]),
      id: `space-${index}`,
      parentSpaceId: null
    }));
    expectTooBig(tooManySpaces, ['floors', 0, 'spaces']);

    const tooManyWalls = makeValidPlan();
    tooManyWalls.floors[0].walls = Array.from({ length: 251 }, (_, index) => ({
      ...structuredClone(tooManyWalls.floors[0].walls[0]),
      id: `wall-${index}`
    }));
    expectTooBig(tooManyWalls, ['floors', 0, 'walls']);

    const tooManyOpenings = makeValidPlan();
    tooManyOpenings.floors[0].openings = Array.from({ length: 301 }, (_, index) => ({
      ...structuredClone(tooManyOpenings.floors[0].openings[0]),
      id: `opening-${index}`
    }));
    expectTooBig(tooManyOpenings, ['floors', 0, 'openings']);

    const tooManyWarnings = makeValidPlan();
    tooManyWarnings.warnings = Array(21).fill('warning');
    expectTooBig(tooManyWarnings, ['warnings']);

    const tooManyVertices = makeValidPlan();
    tooManyVertices.floors[0].spaces[0].polygon = Array.from({ length: 65 }, (_, index) => ({
      x: 100 + index,
      y: 100
    }));
    expectTooBig(tooManyVertices, ['floors', 0, 'spaces', 0, 'polygon']);
  });

  it('rejects duplicate IDs and duplicate floor levels', () => {
    const plan = makeValidPlan();
    plan.floors[0].spaces[1].id = 'space-garden';
    plan.floors.push({
      ...structuredClone(plan.floors[0]),
      id: 'floor-upper',
      name: 'Primera planta'
    });
    expect(messagesFor(plan)).toContain('Plan IDs must be unique.');
    expect(messagesFor(plan)).toContain('Floor levels must be unique.');
  });

  it('rejects zero-length and diagonal walls', () => {
    const plan = makeValidPlan();
    plan.floors[0].walls[0].to = { x: 100, y: 100 };
    plan.floors[0].walls[1].to = { x: 700, y: 700 };
    expect(messagesFor(plan)).toContain('Walls must be non-zero and orthogonal.');
  });

  it('rejects degenerate and self-intersecting space polygons', () => {
    const plan = makeValidPlan();
    plan.floors[0].spaces[0].polygon = [
      { x: 200, y: 200 },
      { x: 400, y: 400 },
      { x: 600, y: 600 }
    ];
    expect(messagesFor(plan)).toContain('Space polygons must have non-zero area.');

    plan.floors[0].spaces[0].polygon = [
      { x: 200, y: 200 },
      { x: 800, y: 800 },
      { x: 200, y: 800 },
      { x: 800, y: 200 }
    ];
    expect(messagesFor(plan)).toContain('Space polygons must not self-intersect.');
  });

  it('rejects missing parent references, cycles and child geometry outside its parent', () => {
    const plan = makeValidPlan();
    plan.floors[0].spaces[1].parentSpaceId = 'missing-space';
    expect(messagesFor(plan)).toContain('A parent space must exist on the same floor.');

    plan.floors[0].spaces[1].parentSpaceId = 'space-garden';
    plan.floors[0].spaces[0].parentSpaceId = 'space-pool';
    expect(messagesFor(plan)).toContain('Space parent relationships must not contain cycles.');

    plan.floors[0].spaces[0].parentSpaceId = null;
    plan.floors[0].spaces[1].polygon[0] = { x: 50, y: 50 };
    expect(messagesFor(plan)).toContain('A child space must be contained by its parent.');
  });

  it('rejects broken opening references, openings past wall bounds and non-door main entrances', () => {
    const plan = makeValidPlan();
    plan.floors[0].openings[0].wallId = 'missing-wall';
    expect(messagesFor(plan)).toContain('An opening must reference a wall on the same floor.');

    plan.floors[0].openings[0].wallId = 'wall-north';
    plan.floors[0].openings[0].offset = 750;
    expect(messagesFor(plan)).toContain('An opening must fit within its wall.');

    plan.floors[0].openings[0].offset = 50;
    plan.floors[0].openings[0].kind = 'window';
    expect(messagesFor(plan)).toContain('The main entrance must be a door.');
  });

  it('emits a strict, closed Structured Outputs object schema', () => {
    const format = HOUSEHOLD_PLAN_RESPONSE_FORMAT;
    const schema = format.json_schema.schema as Record<string, any>;
    expect(format).toMatchObject({ type: 'json_schema', json_schema: { strict: true } });
    expect(schema.type).toBe('object');
    expect(schema.anyOf).toBeUndefined();
    expect(schema.required).toEqual(Object.keys(schema.properties));
    expect(schema.additionalProperties).toBe(false);
    const visit = (node: any) => {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) return node.forEach(visit);
      if (node.type === 'object' || node.properties) {
        expect(node.additionalProperties).toBe(false);
        expect(node.required).toEqual(Object.keys(node.properties));
      }
      Object.values(node).forEach(visit);
    };
    visit(schema);
  });
});
