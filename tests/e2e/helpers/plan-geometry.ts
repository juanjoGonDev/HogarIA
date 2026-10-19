import type { Locator } from '../fixtures';

export async function tapSvgPolygonInterior(polygonLocator: Locator): Promise<void> {
  await polygonLocator.scrollIntoViewIfNeeded();
  const position = await polygonLocator.evaluate((element) => {
    const polygon = element as SVGPolygonElement;
    const coordinates = (polygon.getAttribute('points') ?? '')
      .trim()
      .split(/[\s,]+/)
      .map(Number);
    const vertices = Array.from({ length: Math.floor(coordinates.length / 2) }, (_, index) => ({
      x: coordinates[index * 2],
      y: coordinates[index * 2 + 1]
    }));
    const bounds = polygon.getBBox();
    const screenMatrix = polygon.getScreenCTM();
    if (vertices.length < 3 || !screenMatrix) {
      throw new Error('The room polygon must provide a valid touch target');
    }

    const distanceToSegment = (
      point: { x: number; y: number },
      start: { x: number; y: number },
      end: { x: number; y: number }
    ): number => {
      const dx = end.x - start.x;
      const dy = end.y - start.y;
      const lengthSquared = dx * dx + dy * dy;
      const projection = lengthSquared
        ? Math.max(
            0,
            Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared)
          )
        : 0;
      return Math.hypot(
        point.x - (start.x + projection * dx),
        point.y - (start.y + projection * dy)
      );
    };

    let bestPoint: DOMPoint | null = null;
    let bestClientPoint: DOMPoint | null = null;
    let bestClearance = -1;
    const divisions = 36;
    for (let row = 1; row < divisions; row++) {
      for (let column = 1; column < divisions; column++) {
        const point = new DOMPoint(
          bounds.x + (column / divisions) * bounds.width,
          bounds.y + (row / divisions) * bounds.height
        );
        if (!polygon.isPointInFill(point)) continue;
        const clientPoint = point.matrixTransform(screenMatrix);
        if (document.elementFromPoint(clientPoint.x, clientPoint.y) !== polygon) continue;
        const clearance = Math.min(
          ...vertices.map((vertex, index) =>
            distanceToSegment(point, vertex, vertices[(index + 1) % vertices.length])
          )
        );
        if (clearance > bestClearance) {
          bestPoint = point;
          bestClientPoint = clientPoint;
          bestClearance = clearance;
        }
      }
    }
    if (!bestPoint || !bestClientPoint) {
      throw new Error('The room polygon has no visible interior touch point');
    }

    return { x: bestClientPoint.x, y: bestClientPoint.y };
  });

  await polygonLocator.page().touchscreen.tap(position.x, position.y);
}
