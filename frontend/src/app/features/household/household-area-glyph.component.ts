import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import type { HouseholdAreaKind } from '../../shared/models/household-plan.model';
import { getHouseholdAreaGlyph, type HouseholdAreaGlyph } from './household-area-catalog';

@Component({
  selector: 'svg[householdAreaGlyph]',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './household-area-glyph.component.html',
  styleUrl: './household-area-glyph.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class HouseholdAreaGlyphComponent {
  @Input({ required: true }) kind!: HouseholdAreaKind;

  get glyph(): HouseholdAreaGlyph {
    return getHouseholdAreaGlyph(this.kind);
  }
}
