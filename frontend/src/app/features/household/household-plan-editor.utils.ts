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
const GUIDED_SPACE_MAX_WIDTH = 2_600;
const GUIDED_SPACE_MAX_HEIGHT = 2_500;
const GUIDED_SPACE_MIN_EDGE = 700;

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
  return createHouseholdPlanPolygon(kind, label, id, [
    { x: left, y: top },
    { x: right, y: top },
    { x: right, y: bottom },
    { x: left, y: bottom }
  ]);
}

export function createHouseholdPlanPolygon(
  kind: HouseholdAreaKind,
  label: string,
  id: string,
  inputPoints: readonly HouseholdPlanPoint[]
): HouseholdPlanSpace | null {
  const points = inputPoints.map((point) => ({
    x: clampCoordinate(point.x),
    y: clampCoordinate(point.y)
  }));
  if (points.length > 1 && samePoint(points[0], points[points.length - 1])) points.pop();
  const normalizedPoints = points.filter(
    (point, index) => index === 0 || !samePoint(point, points[index - 1])
  );
  const normalizedLabel = label.trim();
  if (
    !id.trim() ||
    normalizedPoints.length < 3 ||
    normalizedPoints.length > 64 ||
    (kind === 'custom' && !normalizedLabel)
  ) {
    return null;
  }

  const xs = normalizedPoints.map((point) => point.x);
  const ys = normalizedPoints.map((point) => point.y);
  if (
    Math.max(...xs) - Math.min(...xs) < MIN_SHAPE_EDGE ||
    Math.max(...ys) - Math.min(...ys) < MIN_SHAPE_EDGE ||
    !hasNonZeroArea(normalizedPoints) ||
    hasSelfIntersection(normalizedPoints) ||
    new Set(normalizedPoints.map((point) => `${point.x},${point.y}`)).size !==
      normalizedPoints.length
  ) {
    return null;
  }

  return {
    id: id.trim(),
    kind,
    label: normalizedLabel,
    parentSpaceId: null,
    polygon: normalizedPoints
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
  const length = Math.hypot(deltaX, deltaY);
  if (!id.trim() || length < MIN_SHAPE_EDGE) return null;

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

export function findGuidedSpacePlacement(
  spaces: readonly HouseholdPlanSpace[]
): { start: HouseholdPlanPoint; end: HouseholdPlanPoint } | null {
  const boxes = spaces
    .filter((space) => space.polygon.length >= 3)
    .map((space) => ({
      minX: Math.min(...space.polygon.map((point) => point.x)),
      maxX: Math.max(...space.polygon.map((point) => point.x)),
      minY: Math.min(...space.polygon.map((point) => point.y)),
      maxY: Math.max(...space.polygon.map((point) => point.y))
    }));
  if (spaces.length === 0) {
    return { start: { x: 700, y: 700 }, end: { x: 3_300, y: 3_200 } };
  }
  if (boxes.length === 0) return null;

  const xs = [...new Set(boxes.flatMap((box) => [box.minX, box.maxX]))].sort((a, b) => a - b);
  const ys = [...new Set(boxes.flatMap((box) => [box.minY, box.maxY]))].sort((a, b) => a - b);
  if (xs.length < 2 || ys.length < 2) return null;

  const freeRows = ys.slice(0, -1).map((top, rowIndex) =>
    xs.slice(0, -1).map((left, columnIndex) => {
      const right = xs[columnIndex + 1];
      const bottom = ys[rowIndex + 1];
      return !boxes.some(
        (box) => box.minX < right && box.maxX > left && box.minY < bottom && box.maxY > top
      );
    })
  );

  let best: { start: HouseholdPlanPoint; end: HouseholdPlanPoint; area: number } | null = null;
  for (let topIndex = 0; topIndex < freeRows.length; topIndex += 1) {
    const freeColumns = xs.slice(0, -1).map(() => true);
    for (let bottomIndex = topIndex; bottomIndex < freeRows.length; bottomIndex += 1) {
      const rawHeight = ys[bottomIndex + 1] - ys[topIndex];
      for (let columnIndex = 0; columnIndex < freeColumns.length; columnIndex += 1) {
        freeColumns[columnIndex] &&= freeRows[bottomIndex][columnIndex];
      }
      const height = Math.min(rawHeight, GUIDED_SPACE_MAX_HEIGHT);
      if (height >= GUIDED_SPACE_MIN_EDGE) {
        const freeRunEnd = freeColumns.map(() => -1);
        for (let columnIndex = freeColumns.length - 1; columnIndex >= 0; columnIndex -= 1) {
          if (freeColumns[columnIndex]) {
            freeRunEnd[columnIndex] =
              freeColumns[columnIndex + 1] && columnIndex + 1 < freeColumns.length
                ? freeRunEnd[columnIndex + 1]
                : columnIndex;
          }
        }
        for (let startIndex = 0; startIndex < freeColumns.length; startIndex += 1) {
          const lastFreeIndex = freeRunEnd[startIndex];
          if (lastFreeIndex < startIndex) continue;
          const rawWidth = xs[lastFreeIndex + 1] - xs[startIndex];
          const width = Math.min(rawWidth, GUIDED_SPACE_MAX_WIDTH);
          if (width < GUIDED_SPACE_MIN_EDGE) continue;
          const area = width * height;
          if (!best || area > best.area) {
            const left = xs[startIndex];
            const top = ys[topIndex];
            best = {
              start: { x: left, y: top },
              end: { x: left + width, y: top + height },
              area
            };
          }
        }
      }
      if (rawHeight >= GUIDED_SPACE_MAX_HEIGHT) break;
    }
  }
  return best ? { start: best.start, end: best.end } : null;
}

export function openingSegment(
  walls: readonly HouseholdPlanWall[],
  opening: HouseholdPlanOpening
): { from: HouseholdPlanPoint; to: HouseholdPlanPoint } | null {
  const wall = walls.find((candidate) => candidate.id === opening.wallId);
  if (!wall || opening.offset < 0 || opening.width <= 0) return null;
  const deltaX = wall.to.x - wall.from.x;
  const deltaY = wall.to.y - wall.from.y;
  const length = Math.hypot(deltaX, deltaY);
  if (opening.offset + opening.width > length) return null;

  const directionX = deltaX / length;
  const directionY = deltaY / length;
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

export function openingRails(
  walls: readonly HouseholdPlanWall[],
  opening: HouseholdPlanOpening,
  railOffset = 70
): Array<{ from: HouseholdPlanPoint; to: HouseholdPlanPoint }> {
  const segment = openingSegment(walls, opening);
  if (!segment || opening.kind !== 'window') return [];
  const deltaX = segment.to.x - segment.from.x;
  const deltaY = segment.to.y - segment.from.y;
  const length = Math.hypot(deltaX, deltaY);
  if (segment.from.y === segment.to.y) {
    return [-railOffset, railOffset].map((offset) => ({
      from: { x: segment.from.x, y: segment.from.y + offset },
      to: { x: segment.to.x, y: segment.to.y + offset }
    }));
  }
  if (segment.from.x === segment.to.x) {
    return [-railOffset, railOffset].map((offset) => ({
      from: { x: segment.from.x + offset, y: segment.from.y },
      to: { x: segment.to.x + offset, y: segment.to.y }
    }));
  }
  const normalX = deltaY / length;
  const normalY = -deltaX / length;
  return [-railOffset, railOffset].map((offset) => ({
    from: { x: segment.from.x + normalX * offset, y: segment.from.y + normalY * offset },
    to: { x: segment.to.x + normalX * offset, y: segment.to.y + normalY * offset }
  }));
}

export function doorSwing(
  walls: readonly HouseholdPlanWall[],
  opening: HouseholdPlanOpening
): { hinge: HouseholdPlanPoint; leafTip: HouseholdPlanPoint; arc: string } | null {
  const segment = openingSegment(walls, opening);
  if (!segment || opening.kind !== 'door') return null;
  const deltaX = segment.to.x - segment.from.x;
  const deltaY = segment.to.y - segment.from.y;
  const width = Math.hypot(deltaX, deltaY);
  if (segment.from.y === segment.to.y) {
    const hinge = segment.to;
    const leafTip = { x: hinge.x, y: hinge.y - width };
    return {
      hinge,
      leafTip,
      arc: `M ${leafTip.x} ${leafTip.y} A ${width} ${width} 0 0 0 ${segment.from.x} ${segment.from.y}`
    };
  }
  if (segment.from.x === segment.to.x) {
    const hinge = segment.from;
    const leafTip = { x: hinge.x + width, y: hinge.y };
    return {
      hinge,
      leafTip,
      arc: `M ${leafTip.x} ${leafTip.y} A ${width} ${width} 0 0 1 ${segment.to.x} ${segment.to.y}`
    };
  }
  const hinge = segment.to;
  const normalX = deltaY / width;
  const normalY = -deltaX / width;
  const leafTip = { x: hinge.x + normalX * width, y: hinge.y + normalY * width };
  return {
    hinge,
    leafTip,
    arc: `M ${leafTip.x} ${leafTip.y} A ${width} ${width} 0 0 0 ${segment.from.x} ${segment.from.y}`
  };
}

export function polygonCentroid(points: readonly HouseholdPlanPoint[]): HouseholdPlanPoint {
  let doubleArea = 0;
  let xTotal = 0;
  let yTotal = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    const cross = current.x * next.y - next.x * current.y;
    doubleArea += cross;
    xTotal += (current.x + next.x) * cross;
    yTotal += (current.y + next.y) * cross;
  }
  if (!doubleArea) return { x: 0, y: 0 };
  return { x: xTotal / (3 * doubleArea), y: yTotal / (3 * doubleArea) };
}

function samePoint(first: HouseholdPlanPoint, second: HouseholdPlanPoint): boolean {
  return first.x === second.x && first.y === second.y;
}

function hasNonZeroArea(points: readonly HouseholdPlanPoint[]): boolean {
  let doubleArea = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    doubleArea += current.x * next.y - next.x * current.y;
  }
  return doubleArea !== 0;
}

function hasSelfIntersection(points: readonly HouseholdPlanPoint[]): boolean {
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

function segmentsIntersect(
  a: HouseholdPlanPoint,
  b: HouseholdPlanPoint,
  c: HouseholdPlanPoint,
  d: HouseholdPlanPoint
): boolean {
  const orient = (p1: HouseholdPlanPoint, p2: HouseholdPlanPoint, p3: HouseholdPlanPoint) =>
    (p2.x - p1.x) * (p3.y - p1.y) - (p2.y - p1.y) * (p3.x - p1.x);
  const onSegment = (p1: HouseholdPlanPoint, p2: HouseholdPlanPoint, p3: HouseholdPlanPoint) =>
    p2.x >= Math.min(p1.x, p3.x) &&
    p2.x <= Math.max(p1.x, p3.x) &&
    p2.y >= Math.min(p1.y, p3.y) &&
    p2.y <= Math.max(p1.y, p3.y);
  const abC = orient(a, b, c);
  const abD = orient(a, b, d);
  const cdA = orient(c, d, a);
  const cdB = orient(c, d, b);
  if (abC === 0 && onSegment(a, c, b)) return true;
  if (abD === 0 && onSegment(a, d, b)) return true;
  if (cdA === 0 && onSegment(c, a, d)) return true;
  if (cdB === 0 && onSegment(c, b, d)) return true;
  return abC > 0 !== abD > 0 && cdA > 0 !== cdB > 0;
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
