import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import type {
  HouseholdPlanFloor,
  HouseholdPlanOpening,
  HouseholdPlanPoint,
  HouseholdPlanSpace
} from '../../shared/models/household-plan.model';
import { openingSegment } from './household-plan-editor.utils';
import { HouseholdAreaGlyphComponent } from './household-area-glyph.component';

@Component({
  selector: 'app-household-plan-preview-map',
  standalone: true,
  imports: [CommonModule, HouseholdAreaGlyphComponent],
  templateUrl: './household-plan-preview-map.component.html',
  styleUrl: './household-plan-preview-map.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class HouseholdPlanPreviewMapComponent {
  private currentFloor: HouseholdPlanFloor | null = null;

  @Input()
  set floor(value: HouseholdPlanFloor | null) {
    this.currentFloor = value;
    this.canvasBounds = this.boundsFor(value);
  }

  get floor(): HouseholdPlanFloor | null {
    return this.currentFloor;
  }

  @Input() ariaLabel = '';

  canvasBounds = { x: 0, y: 0, width: 10000, height: 10000 };

  get viewBox(): string {
    const { x, y, width, height } = this.canvasBounds;
    return `${x} ${y} ${width} ${height}`;
  }

  spacePoints(space: HouseholdPlanSpace): string {
    return space.polygon.map((point) => `${point.x},${point.y}`).join(' ');
  }

  spaceCenter(space: HouseholdPlanSpace): HouseholdPlanPoint {
    const xs = space.polygon.map((point) => point.x);
    const ys = space.polygon.map((point) => point.y);
    return {
      x: (Math.min(...xs) + Math.max(...xs)) / 2,
      y: (Math.min(...ys) + Math.max(...ys)) / 2
    };
  }

  openingLine(
    opening: HouseholdPlanOpening
  ): { from: HouseholdPlanPoint; to: HouseholdPlanPoint } | null {
    return openingSegment(this.floor?.walls ?? [], opening);
  }

  openingRails(
    opening: HouseholdPlanOpening
  ): Array<{ from: HouseholdPlanPoint; to: HouseholdPlanPoint }> {
    const segment = this.openingLine(opening);
    if (!segment || opening.kind !== 'window') return [];
    const horizontal = segment.from.y === segment.to.y;
    return [-70, 70].map((offset) =>
      horizontal
        ? {
            from: { x: segment.from.x, y: segment.from.y + offset },
            to: { x: segment.to.x, y: segment.to.y + offset }
          }
        : {
            from: { x: segment.from.x + offset, y: segment.from.y },
            to: { x: segment.to.x + offset, y: segment.to.y }
          }
    );
  }

  doorSwing(opening: HouseholdPlanOpening): {
    hinge: HouseholdPlanPoint;
    leafTip: HouseholdPlanPoint;
    arc: string;
  } | null {
    const segment = this.openingLine(opening);
    if (!segment || opening.kind !== 'door') return null;
    const width = Math.abs(segment.to.x - segment.from.x) + Math.abs(segment.to.y - segment.from.y);
    if (segment.from.y === segment.to.y) {
      const hinge = segment.to;
      const leafTip = { x: hinge.x, y: hinge.y - width };
      return {
        hinge,
        leafTip,
        arc: `M ${leafTip.x} ${leafTip.y} A ${width} ${width} 0 0 0 ${segment.from.x} ${segment.from.y}`
      };
    }
    const hinge = segment.from;
    const leafTip = { x: hinge.x + width, y: hinge.y };
    return {
      hinge,
      leafTip,
      arc: `M ${leafTip.x} ${leafTip.y} A ${width} ${width} 0 0 1 ${segment.to.x} ${segment.to.y}`
    };
  }

  private boundsFor(floor: HouseholdPlanFloor | null): {
    x: number;
    y: number;
    width: number;
    height: number;
  } {
    if (!floor) return { x: 0, y: 0, width: 10000, height: 10000 };

    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    const includePoint = (point: HouseholdPlanPoint): void => {
      if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return;
      minX = Math.min(minX, point.x);
      minY = Math.min(minY, point.y);
      maxX = Math.max(maxX, point.x);
      maxY = Math.max(maxY, point.y);
    };

    for (const space of floor.spaces) {
      for (const point of space.polygon) includePoint(point);
    }
    for (const wall of floor.walls) {
      includePoint(wall.from);
      includePoint(wall.to);
    }
    for (const opening of floor.openings) {
      const line = this.openingLine(opening);
      if (!line) continue;
      includePoint(line.from);
      includePoint(line.to);
      const swing = this.doorSwing(opening);
      if (swing) {
        includePoint(swing.hinge);
        includePoint(swing.leafTip);
      }
      for (const rail of this.openingRails(opening)) {
        includePoint(rail.from);
        includePoint(rail.to);
      }
    }

    if (![minX, minY, maxX, maxY].every(Number.isFinite)) {
      return { x: 0, y: 0, width: 10000, height: 10000 };
    }
    const padding = Math.max(400, Math.max(maxX - minX, maxY - minY) * 0.08);
    return {
      x: minX - padding,
      y: minY - padding,
      width: maxX - minX + padding * 2,
      height: maxY - minY + padding * 2
    };
  }
}
