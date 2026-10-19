import { CommonModule } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { TranslatePipe } from '../../core/pipes/translate.pipe';
import { HouseholdService } from '../../core/services/household.service';
import { PickerComponent, type PickerOption } from './ui/picker/picker.component';

@Component({
  selector: 'app-household-switcher',
  standalone: true,
  imports: [CommonModule, PickerComponent, TranslatePipe],
  template: `
    <section
      *ngIf="householdService.memberships().length > 1"
      class="household-switcher"
      [attr.aria-busy]="householdService.switchingHousehold()"
      data-test="household-switcher"
    >
      <app-picker
        id="active-household-select"
        data-test="active-household-select"
        [label]="'household.hogar_activo' | t"
        [placeholder]="'household.selecciona_hogar' | t"
        [options]="pickerOptions()"
        [value]="selectedHouseholdId()"
        [disabled]="householdService.switchingHousehold() || householdService.membershipsLoading()"
        (valueChange)="selectHousehold($event)"
      />
      <p
        *ngIf="householdService.switchingHousehold()"
        role="status"
        class="household-switcher__status"
      >
        {{ 'household.cambiando_hogar' | t }}
      </p>
      <p *ngIf="failed()" role="alert" class="household-switcher__error">
        {{ 'household.no_se_pudo_cambiar_hogar' | t }}
      </p>
    </section>
  `,
  styles: [
    `
      .household-switcher {
        display: grid;
        gap: var(--space-2);
        margin: var(--space-3);
        padding: var(--space-3);
        border: 1px solid var(--border-default);
        border-radius: var(--radius-lg);
        background: var(--bg-secondary);
      }

      .household-switcher__status,
      .household-switcher__error {
        margin: 0;
        font-size: var(--text-sm);
      }

      .household-switcher__error {
        color: var(--error);
      }
    `
  ]
})
export class HouseholdSwitcherComponent {
  readonly householdService = inject(HouseholdService);
  readonly failed = signal(false);
  readonly pickerOptions = computed<PickerOption[]>(() =>
    this.householdService.memberships().map((membership) => ({
      value: membership.id,
      label: membership.name
    }))
  );
  private readonly requestedHouseholdId = signal<string | null>(null);
  readonly selectedHouseholdId = computed(
    () => this.requestedHouseholdId() ?? this.householdService.activeHouseholdId()
  );

  selectHousehold(selectedHouseholdId: string | null): void {
    const householdId = selectedHouseholdId?.trim();
    if (!householdId || householdId === this.householdService.activeHouseholdId()) return;
    if (!this.householdService.memberships().some((membership) => membership.id === householdId)) {
      this.failed.set(true);
      return;
    }

    this.failed.set(false);
    this.requestedHouseholdId.set(householdId);
    this.householdService.selectActiveHousehold(householdId).subscribe({
      next: (selected) => {
        this.failed.set(!selected);
        this.requestedHouseholdId.set(null);
      },
      error: () => {
        this.failed.set(true);
        this.requestedHouseholdId.set(null);
      }
    });
  }
}
