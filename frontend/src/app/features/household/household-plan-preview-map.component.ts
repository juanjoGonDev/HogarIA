import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import type {
  HouseholdPlanFloor,
  HouseholdPlanOpening,
  HouseholdPlanPoint,
  HouseholdPlanSpace
} from '../../shared/models/household-plan.model';
import {
  PLAN_MAP_DETAIL_MIN_SPAN,
  doorSwing as makeDoorSwing,
  openingRails as makeOpeningRails,
  openingSegment,
  polygonCentroid,
  polygonMinimumSpan
} from './household-plan-editor.utils';
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
  @Input() zoom = 100;

  canvasBounds = { x: 0, y: 0, width: 10000, height: 10000 };

  get viewBox(): string {
    const { x, y, width, height } = this.canvasBounds;
    return `${x} ${y} ${width} ${height}`;
  }

  get drawingTransform(): string {
    const { x, y, width, height } = this.canvasBounds;
    const scale = Math.min(150, Math.max(50, this.zoom)) / 100;
    const centerX = x + width / 2;
    const centerY = y + height / 2;
    const format = (value: number): number => Number(value.toFixed(6));
    return `translate(${format(centerX * (1 - scale))} ${format(centerY * (1 - scale))}) scale(${format(scale)})`;
  }

  spacePoints(space: HouseholdPlanSpace): string {
    return space.polygon.map((point) => `${point.x},${point.y}`).join(' ');
  }

  spaceCenter(space: HouseholdPlanSpace): HouseholdPlanPoint {
    return polygonCentroid(space.polygon);
  }

  spaceGlyphVisible(space: HouseholdPlanSpace): boolean {
    return polygonMinimumSpan(space.polygon) >= PLAN_MAP_DETAIL_MIN_SPAN;
  }

  openingLine(
    opening: HouseholdPlanOpening
  ): { from: HouseholdPlanPoint; to: HouseholdPlanPoint } | null {
    return openingSegment(this.floor?.walls ?? [], opening);
  }

  openingRails(
    opening: HouseholdPlanOpening
  ): Array<{ from: HouseholdPlanPoint; to: HouseholdPlanPoint }> {
    return makeOpeningRails(this.floor?.walls ?? [], opening);
  }

  doorSwing(opening: HouseholdPlanOpening): {
    hinge: HouseholdPlanPoint;
    leafTip: HouseholdPlanPoint;
    arc: string;
  } | null {
    return makeDoorSwing(this.floor?.walls ?? [], opening);
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
    const padding = Math.max(120, Math.max(maxX - minX, maxY - minY) * 0.01);
    return {
      x: minX - padding,
      y: minY - padding,
      width: maxX - minX + padding * 2,
      height: maxY - minY + padding * 2
    };
  }
}
