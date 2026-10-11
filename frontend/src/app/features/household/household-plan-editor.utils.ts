import type {
  HouseholdAreaKind,
  HouseholdPlan,
  HouseholdPlanFloor,
  HouseholdPlanOpening,
  HouseholdPlanPoint,
  HouseholdPlanSpace,
  HouseholdPlanWall
} from '../../shared/models/household-plan.model';

const COORDINATE_MIN = 0;
const COORDINATE_MAX = 10_000;
const MIN_SHAPE_EDGE = 100;

export function emptyHouseholdPlan(defaultFloorName: string): HouseholdPlan {
  return {
    schemaVersion: 1,
    dwellingType: 'apartment',
    dwellingTypeLabel: null,
    summary: '',
    warnings: [],
    floors: [
      {
        id: 'floor-0',
        name: defaultFloorName,
        level: 0,
        walls: [],
        openings: [],
        spaces: []
      }
    ]
  };
}

export function createHouseholdPlanSpace(
  kind: HouseholdAreaKind,
  label: string,
  id: string,
  start: HouseholdPlanPoint,
  end: HouseholdPlanPoint
): HouseholdPlanSpace | null {
  const x1 = clampCoordinate(start.x);
  const y1 = clampCoordinate(start.y);
  const x2 = clampCoordinate(end.x);
  const y2 = clampCoordinate(end.y);
  const left = Math.min(x1, x2);
  const right = Math.max(x1, x2);
  const top = Math.min(y1, y2);
  const bottom = Math.max(y1, y2);
  const normalizedLabel = label.trim();

  if (
    right - left < MIN_SHAPE_EDGE ||
    bottom - top < MIN_SHAPE_EDGE ||
    !id.trim() ||
    (kind === 'custom' && !normalizedLabel)
  ) {
    return null;
  }

  return {
    id: id.trim(),
    kind,
    label: normalizedLabel,
    parentSpaceId: null,
    polygon: [
      { x: left, y: top },
      { x: right, y: top },
      { x: right, y: bottom },
      { x: left, y: bottom }
    ]
  };
}

export function createHouseholdPlanWall(
  id: string,
  kind: HouseholdPlanWall['kind'],
  start: HouseholdPlanPoint,
  end: HouseholdPlanPoint
): HouseholdPlanWall | null {
  const from = { x: clampCoordinate(start.x), y: clampCoordinate(start.y) };
  const to = { x: clampCoordinate(end.x), y: clampCoordinate(end.y) };
  const deltaX = to.x - from.x;
  const deltaY = to.y - from.y;
  const length = Math.max(Math.abs(deltaX), Math.abs(deltaY));
  if (!id.trim() || length < MIN_SHAPE_EDGE) return null;

  if (Math.abs(deltaX) >= Math.abs(deltaY)) to.y = from.y;
  else to.x = from.x;

  return { id: id.trim(), kind, from, to };
}

export function moveHouseholdPlanSpace(
  space: HouseholdPlanSpace,
  offsetX: number,
  offsetY: number
): HouseholdPlanSpace {
  if (!space.polygon.length) return space;
  const xs = space.polygon.map((point) => point.x);
  const ys = space.polygon.map((point) => point.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const dx = clampOffset(Math.round(offsetX), -minX, COORDINATE_MAX - maxX);
  const dy = clampOffset(Math.round(offsetY), -minY, COORDINATE_MAX - maxY);

  return {
    ...space,
    polygon: space.polygon.map((point) => ({ x: point.x + dx, y: point.y + dy }))
  };
}

export function openingSegment(
  walls: readonly HouseholdPlanWall[],
  opening: HouseholdPlanOpening
): { from: HouseholdPlanPoint; to: HouseholdPlanPoint } | null {
  const wall = walls.find((candidate) => candidate.id === opening.wallId);
  if (!wall || opening.offset < 0 || opening.width <= 0) return null;
  const deltaX = wall.to.x - wall.from.x;
  const deltaY = wall.to.y - wall.from.y;
  const length = Math.abs(deltaX) + Math.abs(deltaY);
  if (opening.offset + opening.width > length) return null;

  const directionX = Math.sign(deltaX);
  const directionY = Math.sign(deltaY);
  const from = {
    x: wall.from.x + directionX * opening.offset,
    y: wall.from.y + directionY * opening.offset
  };
  return {
    from,
    to: {
      x: from.x + directionX * opening.width,
      y: from.y + directionY * opening.width
    }
  };
}

export function cloneHouseholdPlan(plan: HouseholdPlan): HouseholdPlan {
  return structuredClone(plan);
}

export function createHouseholdPlanFloor(
  floors: readonly HouseholdPlanFloor[],
  direction: 'above' | 'below' = 'above',
  id?: string
): HouseholdPlanFloor | null {
  if (floors.length >= 12) return null;
  const level =
    direction === 'above'
      ? Math.max(0, ...floors.map((floor) => floor.level)) + 1
      : Math.min(0, ...floors.map((floor) => floor.level)) - 1;
  if (level > 12 || level < -12) return null;
  return {
    id: id ?? `floor-${level}`,
    name: level < 0 ? `Sótano ${Math.abs(level)}` : `Planta ${level}`,
    level,
    walls: [],
    openings: [],
    spaces: []
  };
}

export function clampCoordinate(value: number): number {
  return Math.max(COORDINATE_MIN, Math.min(COORDINATE_MAX, Math.round(value)));
}

function clampOffset(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}
