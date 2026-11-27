import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import {
  provideRouter,
  type ActivatedRouteSnapshot,
  type RouterStateSnapshot,
  type UrlTree
} from '@angular/router';
import type { Observable } from 'rxjs';
import { firstValueFrom, of } from 'rxjs';
import type { HouseholdMembership, MemberPermissions } from '../../shared/models/household.model';
import { HouseholdService } from '../services/household.service';
import { aiHouseholdSettingsGuard } from './ai-household-settings.guard';

describe('aiHouseholdSettingsGuard', () => {
  const memberships = signal<HouseholdMembership[]>([]);
  const activeHouseholdId = signal<string | null>(null);
  const membershipsFailed = signal(false);

  function permissions(settings: boolean): MemberPermissions {
    return {
      pantry: { view: false, edit: false, manage: false },
      recipes: { view: false, create: false, edit: false, delete: false, generateAI: false },
      calendar: { view: false, edit: false },
      members: { invite: false, kick: false, manageRoles: false },
      settings
    };
  }

  beforeEach(() => {
    memberships.set([]);
    activeHouseholdId.set(null);
    membershipsFailed.set(false);
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        {
          provide: HouseholdService,
          useValue: {
            memberships,
            activeHouseholdId,
            membershipsFailed,
            loadMemberships: () => of(memberships())
          }
        }
      ]
    });
  });

  async function evaluate(queryParams: Record<string, string> = {}): Promise<boolean | string> {
    const result = TestBed.runInInjectionContext(() =>
      aiHouseholdSettingsGuard({ queryParams } as ActivatedRouteSnapshot, {} as RouterStateSnapshot)
    );
    const value = await firstValueFrom(result as Observable<boolean | UrlTree>);
    return typeof value === 'boolean' ? value : value.toString();
  }

  it('allows personal provider settings when the account has no household', async () => {
    expect(await evaluate()).toBeTrue();
  });

  it('allows a member who has settings permission in the selected home', async () => {
    memberships.set([
      { id: 'home-a', name: 'Casa A', role: 'admin', active: true, permissions: permissions(true) }
    ]);
    activeHouseholdId.set('home-a');

    expect(await evaluate()).toBeTrue();
  });

  it('redirects a member without settings permission to the dedicated AI tab', async () => {
    memberships.set([
      {
        id: 'home-a',
        name: 'Casa A',
        role: 'member',
        active: true,
        permissions: permissions(false)
      }
    ]);
    activeHouseholdId.set('home-a');

    expect(await evaluate()).toBe('/household?tab=ai');
  });

  it('preserves unrelated query params while selecting the dedicated AI tab', async () => {
    memberships.set([
      {
        id: 'home-a',
        name: 'Casa A',
        role: 'member',
        active: true,
        permissions: permissions(false)
      }
    ]);
    activeHouseholdId.set('home-a');

    expect(await evaluate({ source: 'calendar', tab: 'settings' })).toBe(
      '/household?source=calendar&tab=ai'
    );
  });

  it('requires a valid active home when there are multiple memberships', async () => {
    memberships.set([
      {
        id: 'home-a',
        name: 'Casa A',
        role: 'admin',
        active: false,
        permissions: permissions(true)
      },
      {
        id: 'home-b',
        name: 'Casa B',
        role: 'member',
        active: false,
        permissions: permissions(true)
      }
    ]);

    expect(await evaluate()).toBe('/household');
  });

  it('fails closed when membership permissions cannot be loaded', async () => {
    membershipsFailed.set(true);

    expect(await evaluate()).toBe('/dashboard');
  });
});
