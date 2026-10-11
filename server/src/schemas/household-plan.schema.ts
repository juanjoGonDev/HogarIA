import { z } from 'zod';
import { createAiResponseFormat } from './ai-response-format.js';

export const HOUSEHOLD_AREA_KINDS = [
  'entrance',
  'foyer',
  'living_room',
  'dining_room',
  'kitchen',
  'pantry',
  'bedroom',
  'primary_bedroom',
  'guest_bedroom',
  'bathroom',
  'toilet',
  'laundry_room',
  'home_office',
  'studio_room',
  'library',
  'playroom',
  'gym',
  'walk_in_closet',
  'hallway',
  'staircase',
  'landing',
  'elevator',
  'storage_room',
  'basement',
  'wine_cellar',
  'attic',
  'garage',
  'parking_space',
  'utility_room',
  'workshop',
  'sunroom',
  'garden',
  'vegetable_garden',
  'plot',
  'balcony',
  'terrace',
  'patio',
  'courtyard',
  'porch',
  'veranda',
  'gallery',
  'roof_terrace',
  'solarium',
  'pool',
  'outdoor_kitchen',
  'shed',
  'greenhouse',
  'driveway',
  'outdoor_parking',
  'path',
  'pet_area',
  'sports_area',
  'common_area',
  'shared_room',
  'storage_area',
  'custom'
] as const;

export const DWELLING_TYPES = [
  'apartment',
  'studio',
  'detached_house',
  'semi_detached_house',
  'terraced_house',
  'townhouse',
  'duplex',
  'shared_home',
  'mobile_home',
  'other'
] as const;

export const PLAN_LIMITS = {
  minFloors: 1,
  maxFloors: 12,
  minLevel: -12,
  maxLevel: 12,
  maxSpacesPerFloor: 80,
  maxWallsPerFloor: 250,
  maxOpeningsPerFloor: 300,
  maxPolygonVertices: 64,
  maxWarnings: 20,
  coordinateMin: 0,
  coordinateMax: 10_000
} as const;

const idSchema = z.string().trim().min(1).max(80);
const labelSchema = z.string().trim().max(100);
const pointSchema = z.object({
  x: z.number().int().min(PLAN_LIMITS.coordinateMin).max(PLAN_LIMITS.coordinateMax),
  y: z.number().int().min(PLAN_LIMITS.coordinateMin).max(PLAN_LIMITS.coordinateMax)
});
const wallSchema = z.object({
  id: idSchema,
  kind: z.enum(['interior', 'exterior']),
  from: pointSchema,
  to: pointSchema
});
const openingSchema = z.object({
  id: idSchema,
  wallId: idSchema,
  kind: z.enum(['door', 'window', 'garage_door']),
  offset: z.number().int().min(0).max(PLAN_LIMITS.coordinateMax),
  width: z.number().int().min(1).max(PLAN_LIMITS.coordinateMax),
  isMainEntrance: z.boolean()
});
const spaceSchema = z.object({
  id: idSchema,
  kind: z.enum(HOUSEHOLD_AREA_KINDS),
  label: labelSchema,
  polygon: z.array(pointSchema).min(3).max(PLAN_LIMITS.maxPolygonVertices),
  parentSpaceId: idSchema.nullable()
});
const floorSchema = z.object({
  id: idSchema,
  name: z.string().trim().min(1).max(80),
  level: z.number().int().min(PLAN_LIMITS.minLevel).max(PLAN_LIMITS.maxLevel),
  walls: z.array(wallSchema).max(PLAN_LIMITS.maxWallsPerFloor),
  openings: z.array(openingSchema).max(PLAN_LIMITS.maxOpeningsPerFloor),
  spaces: z.array(spaceSchema).max(PLAN_LIMITS.maxSpacesPerFloor)
});

/** Structural schema sent to Structured Outputs; semantic rules are validated locally. */
export const householdPlanObjectSchema = z.object({
  schemaVersion: z.literal(1),
  dwellingType: z.enum(DWELLING_TYPES),
  dwellingTypeLabel: z.string().trim().max(80).nullable(),
  summary: z.string().max(500),
  warnings: z.array(z.string().max(300)).max(PLAN_LIMITS.maxWarnings),
  floors: z.array(floorSchema).min(PLAN_LIMITS.minFloors).max(PLAN_LIMITS.maxFloors)
});

export type HouseholdPlan = z.infer<typeof householdPlanObjectSchema>;
export type HouseholdAreaKind = (typeof HOUSEHOLD_AREA_KINDS)[number];
export type DwellingType = (typeof DWELLING_TYPES)[number];

interface SemanticIssue {
  path: Array<string | number>;
  message: string;
}

export const householdPlanSchema = householdPlanObjectSchema.superRefine((plan, context) => {
  for (const issue of findHouseholdPlanIssues(plan)) {
    context.addIssue({ code: 'custom', path: issue.path, message: issue.message });
  }
});

export const HOUSEHOLD_PLAN_RESPONSE_FORMAT = createAiResponseFormat(
  'household_plan',
  householdPlanObjectSchema
);

export function findHouseholdPlanIssues(plan: HouseholdPlan): SemanticIssue[] {
  const issues: SemanticIssue[] = [];
  const allIds = new Set<string>();
  const addId = (id: string, path: Array<string | number>) => {
    if (allIds.has(id)) issues.push({ path, message: 'Plan IDs must be unique.' });
    allIds.add(id);
  };
  const levels = new Set<number>();

  if (plan.dwellingType === 'other' && !plan.dwellingTypeLabel?.trim()) {
    issues.push({
      path: ['dwellingTypeLabel'],
      message: 'A dwelling type label is required for other.'
    });
  }

  plan.floors.forEach((floor, floorIndex) => {
    addId(floor.id, ['floors', floorIndex, 'id']);
    if (levels.has(floor.level)) {
      issues.push({
        path: ['floors', floorIndex, 'level'],
        message: 'Floor levels must be unique.'
      });
    }
    levels.add(floor.level);

    floor.walls.forEach((wall, wallIndex) => {
      addId(wall.id, ['floors', floorIndex, 'walls', wallIndex, 'id']);
      if (!isOrthogonalNonZeroWall(wall.from, wall.to)) {
        issues.push({
          path: ['floors', floorIndex, 'walls', wallIndex],
          message: 'Walls must be non-zero and orthogonal.'
        });
      }
    });

    const wallsById = new Map(floor.walls.map((wall) => [wall.id, wall]));
    floor.openings.forEach((opening, openingIndex) => {
      addId(opening.id, ['floors', floorIndex, 'openings', openingIndex, 'id']);
      const wall = wallsById.get(opening.wallId);
      if (!wall) {
        issues.push({
          path: ['floors', floorIndex, 'openings', openingIndex, 'wallId'],
          message: 'An opening must reference a wall on the same floor.'
        });
      } else if (
        !isOrthogonalNonZeroWall(wall.from, wall.to) ||
        opening.offset + opening.width > wallLength(wall.from, wall.to)
      ) {
        issues.push({
          path: ['floors', floorIndex, 'openings', openingIndex],
          message: 'An opening must fit within its wall.'
        });
      }
      if (opening.isMainEntrance && opening.kind !== 'door') {
        issues.push({
          path: ['floors', floorIndex, 'openings', openingIndex, 'kind'],
          message: 'The main entrance must be a door.'
        });
      }
    });

    const spacesById = new Map<string, (typeof floor.spaces)[number]>();
    floor.spaces.forEach((space, spaceIndex) => {
      addId(space.id, ['floors', floorIndex, 'spaces', spaceIndex, 'id']);
      if (!space.label.trim()) {
        issues.push({
          path: ['floors', floorIndex, 'spaces', spaceIndex, 'label'],
          message:
            space.kind === 'custom'
              ? 'A custom space requires a non-empty label.'
              : 'A space requires a non-empty label.'
        });
      }
      if (isDegeneratePolygon(space.polygon)) {
        issues.push({
          path: ['floors', floorIndex, 'spaces', spaceIndex, 'polygon'],
          message: 'Space polygons must have non-zero area.'
        });
      }
      if (polygonSelfIntersects(space.polygon)) {
        issues.push({
          path: ['floors', floorIndex, 'spaces', spaceIndex, 'polygon'],
          message: 'Space polygons must not self-intersect.'
        });
      }
      if (!spacesById.has(space.id)) spacesById.set(space.id, space);
    });

    let cycleReported = false;
    const visitState = new Map<string, 0 | 1 | 2>();
    const visit = (spaceId: string) => {
      const state = visitState.get(spaceId) ?? 0;
      if (state === 2) return;
      if (state === 1) {
        if (!cycleReported) {
          issues.push({
            path: ['floors', floorIndex, 'spaces'],
            message: 'Space parent relationships must not contain cycles.'
          });
          cycleReported = true;
        }
        return;
      }
      visitState.set(spaceId, 1);
      const parentId = spacesById.get(spaceId)?.parentSpaceId;
      if (parentId && spacesById.has(parentId)) visit(parentId);
      visitState.set(spaceId, 2);
    };

    for (const space of floor.spaces) {
      visit(space.id);
      if (!space.parentSpaceId) continue;
      const parent = spacesById.get(space.parentSpaceId);
      if (!parent) {
        issues.push({
          path: ['floors', floorIndex, 'spaces', floor.spaces.indexOf(space), 'parentSpaceId'],
          message: 'A parent space must exist on the same floor.'
        });
      } else if (
        parent.id !== space.id &&
        isValidPolygon(space.polygon) &&
        isValidPolygon(parent.polygon) &&
        !polygonContainsPolygon(parent.polygon, space.polygon)
      ) {
        issues.push({
          path: ['floors', floorIndex, 'spaces', floor.spaces.indexOf(space), 'polygon'],
          message: 'A child space must be contained by its parent.'
        });
      }
    }
  });

  return issues;
}

function isOrthogonalNonZeroWall(
  from: HouseholdPlan['floors'][number]['walls'][number]['from'],
  to: HouseholdPlan['floors'][number]['walls'][number]['to']
): boolean {
  return (from.x === to.x || from.y === to.y) && (from.x !== to.x || from.y !== to.y);
}

function wallLength(from: { x: number; y: number }, to: { x: number; y: number }): number {
  return Math.abs(to.x - from.x) + Math.abs(to.y - from.y);
}

function isDegeneratePolygon(points: ReadonlyArray<{ x: number; y: number }>): boolean {
  if (new Set(points.map((point) => `${point.x},${point.y}`)).size !== points.length) return true;
  let doubleArea = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    doubleArea += current.x * next.y - next.x * current.y;
  }
  return doubleArea === 0;
}

function isValidPolygon(points: ReadonlyArray<{ x: number; y: number }>): boolean {
  return points.length >= 3 && !isDegeneratePolygon(points) && !polygonSelfIntersects(points);
}

function polygonSelfIntersects(points: ReadonlyArray<{ x: number; y: number }>): boolean {
  for (let first = 0; first < points.length; first += 1) {
    const firstEnd = (first + 1) % points.length;
    for (let second = first + 1; second < points.length; second += 1) {
      const secondEnd = (second + 1) % points.length;
      if (first === second || firstEnd === second || secondEnd === first) continue;
      if (segmentsIntersect(points[first], points[firstEnd], points[second], points[secondEnd])) {
        return true;
      }
    }
  }
  return false;
}

function polygonContainsPolygon(
  parent: ReadonlyArray<{ x: number; y: number }>,
  child: ReadonlyArray<{ x: number; y: number }>
): boolean {
  if (!child.every((point) => pointInPolygonOrBoundary(point, parent))) return false;
  for (let childIndex = 0; childIndex < child.length; childIndex += 1) {
    const start = child[childIndex];
    const end = child[(childIndex + 1) % child.length];
    const cuts = [0, 1];
    for (let parentIndex = 0; parentIndex < parent.length; parentIndex += 1) {
      cuts.push(
        ...segmentIntersectionParameters(
          start,
          end,
          parent[parentIndex],
          parent[(parentIndex + 1) % parent.length]
        )
      );
    }
    cuts.sort((left, right) => left - right);
    for (let cutIndex = 0; cutIndex < cuts.length - 1; cutIndex += 1) {
      const from = cuts[cutIndex];
      const to = cuts[cutIndex + 1];
      if (to - from < 1e-9) continue;
      const t = (from + to) / 2;
      const point = { x: start.x + (end.x - start.x) * t, y: start.y + (end.y - start.y) * t };
      if (!pointInPolygonOrBoundary(point, parent)) return false;
    }
  }
  return true;
}

function pointInPolygonOrBoundary(
  point: { x: number; y: number },
  polygon: ReadonlyArray<{ x: number; y: number }>
): boolean {
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const current = polygon[index];
    const prior = polygon[previous];
    if (pointOnSegment(point, prior, current)) return true;
    const crosses = current.y > point.y !== prior.y > point.y;
    if (
      crosses &&
      point.x < ((prior.x - current.x) * (point.y - current.y)) / (prior.y - current.y) + current.x
    ) {
      inside = !inside;
    }
  }
  return inside;
}

function segmentIntersectionParameters(
  start: { x: number; y: number },
  end: { x: number; y: number },
  otherStart: { x: number; y: number },
  otherEnd: { x: number; y: number }
): number[] {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const otherDx = otherEnd.x - otherStart.x;
  const otherDy = otherEnd.y - otherStart.y;
  const denominator = dx * otherDy - dy * otherDx;
  const deltaX = otherStart.x - start.x;
  const deltaY = otherStart.y - start.y;

  if (denominator !== 0) {
    const t = (deltaX * otherDy - deltaY * otherDx) / denominator;
    const u = (deltaX * dy - deltaY * dx) / denominator;
    return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? [t] : [];
  }
  if (deltaX * dy - deltaY * dx !== 0) return [];
  const denominatorOnAxis = Math.abs(dx) >= Math.abs(dy) ? dx : dy;
  if (denominatorOnAxis === 0) return [];
  const startOnAxis = Math.abs(dx) >= Math.abs(dy) ? start.x : start.y;
  const otherStartOnAxis = Math.abs(dx) >= Math.abs(dy) ? otherStart.x : otherStart.y;
  const otherEndOnAxis = Math.abs(dx) >= Math.abs(dy) ? otherEnd.x : otherEnd.y;
  return [
    (otherStartOnAxis - startOnAxis) / denominatorOnAxis,
    (otherEndOnAxis - startOnAxis) / denominatorOnAxis
  ].filter((parameter) => parameter >= 0 && parameter <= 1);
}

function segmentsIntersect(
  a: { x: number; y: number },
  b: { x: number; y: number },
  c: { x: number; y: number },
  d: { x: number; y: number }
): boolean {
  const abC = orientation(a, b, c);
  const abD = orientation(a, b, d);
  const cdA = orientation(c, d, a);
  const cdB = orientation(c, d, b);
  if (abC * abD < 0 && cdA * cdB < 0) return true;
  return (
    (abC === 0 && pointOnSegment(c, a, b)) ||
    (abD === 0 && pointOnSegment(d, a, b)) ||
    (cdA === 0 && pointOnSegment(a, c, d)) ||
    (cdB === 0 && pointOnSegment(b, c, d))
  );
}

function orientation(
  a: { x: number; y: number },
  b: { x: number; y: number },
  c: { x: number; y: number }
): -1 | 0 | 1 {
  const value = (b.y - a.y) * (c.x - b.x) - (b.x - a.x) * (c.y - b.y);
  return value === 0 ? 0 : value > 0 ? 1 : -1;
}

function pointOnSegment(
  point: { x: number; y: number },
  start: { x: number; y: number },
  end: { x: number; y: number }
): boolean {
  return (
    orientation(start, end, point) === 0 &&
    point.x >= Math.min(start.x, end.x) &&
    point.x <= Math.max(start.x, end.x) &&
    point.y >= Math.min(start.y, end.y) &&
    point.y <= Math.max(start.y, end.y)
  );
}
