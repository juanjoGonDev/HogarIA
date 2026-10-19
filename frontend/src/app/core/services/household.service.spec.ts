import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { Observable } from 'rxjs';
import { SILENT_TOAST } from '../interceptors/error.interceptor';
import type {
  Household,
  HouseholdMember,
  InvitePreview,
  MemberPermissions,
  MemberRole
} from '../../shared/models/household.model';
import { HouseholdService } from './household.service';
import { STORAGE_KEYS } from './storage.service';

const API_URL = '/api/household';
const PERMISSIONS: MemberPermissions = {
  pantry: { view: true, edit: true, manage: true },
  recipes: { view: true, create: true, edit: true, delete: true, generateAI: true },
  calendar: { view: true, edit: true },
  members: { invite: true, kick: true, manageRoles: true },
  settings: true
};

type RawMember = Omit<HouseholdMember, 'avatar'> & { avatar?: string | null };

function member(overrides: Partial<RawMember> = {}): RawMember {
  return {
    id: 'membership-1',
    userId: 'current-user',
    name: 'Ada Lovelace',
    email: 'ada@example.test',
    role: 'admin',
    cookingLevel: 'intermediate',
    isActive: true,
    avatar: null,
    joinedAt: '2026-01-02T03:04:05.000Z' as unknown as Date,
    permissions: PERMISSIONS,
    ...overrides
  };
}

function household(overrides: Record<string, unknown> = {}) {
  return {
    id: 'home-1',
    name: 'Casa sintética',
    inviteCode: 'ABC12345',
    members: [member()],
    sharedPantry: true,
    shareRecipes: true,
    shareCalendar: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    ...overrides
  };
}

describe('HouseholdService', () => {
  let service: HouseholdService;
  let http: HttpTestingController;
  let originalClipboard: PropertyDescriptor | undefined;

  beforeEach(() => {
    localStorage.removeItem(STORAGE_KEYS.currentUser);
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [HouseholdService]
    });
    service = TestBed.inject(HouseholdService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
    localStorage.removeItem(STORAGE_KEYS.currentUser);
    if (originalClipboard) {
      Object.defineProperty(navigator, 'clipboard', originalClipboard);
      originalClipboard = undefined;
    } else {
      delete (navigator as unknown as { clipboard?: Clipboard }).clipboard;
    }
  });

  it('deduplicates ensure requests and caches a successful empty household response', () => {
    service.ensureHousehold();
    expect(service.isLoading()).toBeTrue();

    service.ensureHousehold();
    const request = http.expectOne(API_URL);
    expect(request.request.method).toBe('GET');
    request.flush({ success: true, data: null });

    expect(service.isLoading()).toBeFalse();
    expect(service.household()).toBeNull();
    service.ensureHousehold();
    http.expectNone(API_URL);
  });

  it('maps the matching member, permission flags and defaults, then avoids another ensure request', () => {
    localStorage.setItem(STORAGE_KEYS.currentUser, JSON.stringify({ id: 'current-user' }));
    const other = member({
      id: 'membership-2',
      userId: 'other-user',
      name: 'Grace Hopper',
      role: 'member',
      avatar: 'https://example.test/avatar.png'
    });
    const current = member({ id: 'membership-3', avatar: null });
    const raw = household({
      members: [other, current],
      sharedPantry: 1,
      shareRecipes: false,
      shareCalendar: undefined
    });

    service.ensureHousehold();
    http.expectOne(API_URL).flush({ success: true, data: raw });

    const loaded = service.household();
    expect(loaded).toEqual(
      jasmine.objectContaining({
        id: 'home-1',
        inviteCode: 'ABC12345',
        sharedPantry: true,
        shareRecipes: false,
        shareCalendar: true,
        myRole: 'admin',
        myPermissions: PERMISSIONS,
        members: [
          jasmine.objectContaining({
            userId: 'other-user',
            avatar: 'https://example.test/avatar.png'
          }),
          jasmine.objectContaining({ userId: 'current-user', avatar: undefined })
        ]
      })
    );
    expect(service.isAdmin()).toBeTrue();

    service.ensureHousehold();
    http.expectNone(API_URL);
  });

  it('falls back to the first member and survives corrupt local user JSON', () => {
    localStorage.setItem(STORAGE_KEYS.currentUser, '{not-json');
    const first = member({ userId: 'first-user', role: 'member', permissions: undefined });
    const raw = household({
      members: [first, member({ userId: 'second-user', role: 'child' })],
      sharedPantry: false,
      shareRecipes: undefined,
      shareCalendar: false
    });

    service.loadHousehold();
    http.expectOne(API_URL).flush({ data: raw });

    expect(service.household()).toEqual(
      jasmine.objectContaining({
        sharedPantry: false,
        shareRecipes: true,
        shareCalendar: false,
        myRole: 'member',
        myPermissions: undefined,
        members: jasmine.arrayContaining([
          jasmine.objectContaining({ userId: 'first-user', avatar: undefined }),
          jasmine.objectContaining({ userId: 'second-user' })
        ])
      })
    );
    expect(service.isAdmin()).toBeFalse();
  });

  it('maps households with missing members and no stored user', () => {
    service.loadHousehold();
    http.expectOne(API_URL).flush({ data: household({ members: undefined }) });

    expect(service.household()).toEqual(
      jasmine.objectContaining({
        members: [],
        myRole: undefined,
        myPermissions: undefined
      })
    );
    expect(service.isAdmin()).toBeFalse();
  });

  it('defaults new dishes to active household members, excluding inactive memberships', () => {
    expect(service.defaultServings()).toBe(2);
    service.loadHousehold();
    http.expectOne(API_URL).flush({
      data: household({
        members: [
          member({ userId: 'current-user', isActive: true }),
          member({ id: 'active-2', userId: 'another-user', isActive: true }),
          member({ id: 'active-3', userId: 'third-user', isActive: true }),
          member({ id: 'inactive-4', userId: 'inactive-user', isActive: false })
        ]
      })
    });

    expect(service.defaultServings()).toBe(3);
    service.loadHousehold();
    http.expectOne(API_URL).flush({
      data: household({ members: [member({ isActive: false })] })
    });
    expect(service.defaultServings()).toBe(2);
  });

  it('clears loading after a failed ensure and retries successfully on the next ensure', () => {
    service.ensureHousehold();
    http
      .expectOne(API_URL)
      .flush({ message: 'Unauthorized' }, { status: 401, statusText: 'Unauthorized' });

    expect(service.household()).toBeNull();
    expect(service.isLoading()).toBeFalse();

    service.ensureHousehold();
    expect(service.isLoading()).toBeTrue();
    http.expectOne(API_URL).flush({ data: household() });
    expect(service.household()?.id).toBe('home-1');
    expect(service.isLoading()).toBeFalse();
  });

  it('returns invite data rather than the HTTP envelope and returns null for empty/error responses', () => {
    const preview: InvitePreview = {
      householdId: 'home-1',
      householdName: 'Casa sintética',
      memberCount: 2,
      alreadyMember: false
    };
    let emitted: InvitePreview | null | undefined;

    service.previewInvite('ABC12345').subscribe((value) => (emitted = value));
    http.expectOne(`${API_URL}/invite/ABC12345`).flush({ success: true, data: preview });
    expect(emitted).toEqual(preview);

    emitted = undefined;
    service.previewInvite('EMPTY').subscribe((value) => (emitted = value));
    http.expectOne(`${API_URL}/invite/EMPTY`).flush(null);
    expect(emitted).toBeNull();

    emitted = undefined;
    service.previewInvite('INVALID').subscribe((value) => (emitted = value));
    http.expectOne(`${API_URL}/invite/INVALID`).flush({}, { status: 404, statusText: 'Not Found' });
    expect(emitted).toBeNull();
  });

  it('creates households with the declared entity contract, default, false flag and error handling', () => {
    localStorage.setItem(STORAGE_KEYS.currentUser, JSON.stringify({ id: 'current-user' }));
    const raw = household();
    let created: Household | null | undefined;

    service.createHousehold('Casa sintética').subscribe((value) => (created = value));
    const create = http.expectOne(API_URL);
    expect(create.request.method).toBe('POST');
    expect(create.request.body).toEqual({ name: 'Casa sintética', sharedPantry: true });
    expect(create.request.context.get(SILENT_TOAST)).toBeTrue();
    create.flush({ success: true, data: raw });
    http.expectOne(`${API_URL}/memberships`).flush({
      success: true,
      data: {
        activeHouseholdId: 'home-1',
        memberships: [
          {
            id: 'home-1',
            name: 'Casa sintética',
            role: 'admin',
            permissions: PERMISSIONS,
            active: true
          }
        ]
      }
    });
    expect(created).toEqual(jasmine.objectContaining({ id: 'home-1', inviteCode: 'ABC12345' }));
    expect(service.household()?.name).toBe('Casa sintética');
    expect(service.activeHouseholdId()).toBe('home-1');
    expect(service.memberships().map((membership) => membership.id)).toContain('home-1');

    let noData: Household | null | undefined;
    service
      .createHousehold('Sin despensa compartida', false)
      .subscribe((value) => (noData = value));
    const createWithoutPantry = http.expectOne(API_URL);
    expect(createWithoutPantry.request.body).toEqual({
      name: 'Sin despensa compartida',
      sharedPantry: false
    });
    createWithoutPantry.flush({ success: true, data: null });
    expect(noData).toBeNull();
    expect(service.household()?.name).toBe('Casa sintética');

    let failed: Household | null | undefined;
    service.createHousehold('No creada').subscribe((value) => (failed = value));
    http.expectOne(API_URL).flush({}, { status: 503, statusText: 'Unavailable' });
    expect(failed).toBeNull();
  });

  it('joins by path code, reloads the household and propagates join errors', () => {
    let joined: unknown;
    service.joinByCode('ABC12345').subscribe((value) => (joined = value));
    const join = http.expectOne(`${API_URL}/join/ABC12345`);
    expect(join.request.method).toBe('POST');
    expect(join.request.body).toEqual({});
    expect(join.request.context.get(SILENT_TOAST)).toBeFalse();
    join.flush({ success: true, message: 'Joined household' });
    http.expectOne(`${API_URL}/memberships`).flush({
      success: true,
      data: {
        activeHouseholdId: 'home-1',
        memberships: [
          {
            id: 'home-1',
            name: 'Casa sintética',
            role: 'member',
            permissions: PERMISSIONS,
            active: true
          }
        ]
      }
    });
    http.expectOne(API_URL).flush({ data: household() });
    expect(joined).toEqual({ success: true, message: 'Joined household' });
    expect(service.household()?.id).toBe('home-1');

    let joinError: unknown;
    service.joinByCode('BADCODE').subscribe({ error: (error) => (joinError = error) });
    http.expectOne(`${API_URL}/join/BADCODE`).flush({}, { status: 404, statusText: 'Not Found' });
    expect(joinError).toBeTruthy();
  });

  it('can silence the global error toast for a caller that renders its own error', () => {
    const joinByCode = service.joinByCode as unknown as (
      inviteCode: string,
      options: { silentToast: true }
    ) => Observable<unknown>;
    joinByCode.call(service, 'INVITE123', { silentToast: true }).subscribe();

    const join = http.expectOne(`${API_URL}/join/INVITE123`);
    expect(join.request.method).toBe('POST');
    expect(join.request.context.get(SILENT_TOAST)).toBeTrue();
    join.flush({ success: true, message: 'Joined household' });
    http.expectOne(`${API_URL}/memberships`).flush({
      success: true,
      data: {
        activeHouseholdId: 'home-1',
        memberships: [
          {
            id: 'home-1',
            name: 'Casa sintética',
            role: 'member',
            permissions: PERMISSIONS,
            active: true
          }
        ]
      }
    });
    http.expectOne(API_URL).flush({ data: household() });
  });

  it('joins by request body, reloads on success and returns null on failure', () => {
    let joined: unknown;
    service.joinHousehold('JOINCODE').subscribe((value) => (joined = value));
    const join = http.expectOne(`${API_URL}/join`);
    expect(join.request.method).toBe('POST');
    expect(join.request.body).toEqual({ inviteCode: 'JOINCODE' });
    expect(join.request.context.get(SILENT_TOAST)).toBeTrue();
    join.flush({ success: true, message: 'Joined household' });
    http.expectOne(`${API_URL}/memberships`).flush({
      success: true,
      data: {
        activeHouseholdId: 'home-1',
        memberships: [
          {
            id: 'home-1',
            name: 'Casa sintética',
            role: 'member',
            permissions: PERMISSIONS,
            active: true
          }
        ]
      }
    });
    http.expectOne(API_URL).flush({ data: null });
    expect(joined).toEqual({ success: true, message: 'Joined household' });

    let failed: unknown;
    service.joinHousehold('BADCODE').subscribe((value) => (failed = value));
    http.expectOne(`${API_URL}/join`).flush({}, { status: 404, statusText: 'Not Found' });
    expect(failed).toBeNull();
  });

  it('refreshes membership selection and household data after joining another home', () => {
    service.loadMemberships().subscribe();
    http.expectOne(`${API_URL}/memberships`).flush({
      success: true,
      data: {
        activeHouseholdId: 'home-1',
        memberships: [
          { id: 'home-1', name: 'Casa uno', role: 'admin', permissions: PERMISSIONS, active: true }
        ]
      }
    });
    service.loadHousehold();
    http.expectOne(API_URL).flush({ data: household({ id: 'home-1', name: 'Casa uno' }) });

    let joined: unknown;
    service.joinHousehold('SECONDHOME').subscribe((value) => (joined = value));
    http.expectOne(`${API_URL}/join`).flush({ success: true, message: 'Joined household' });
    http.expectOne(`${API_URL}/memberships`).flush({
      success: true,
      data: {
        activeHouseholdId: 'home-2',
        memberships: [
          {
            id: 'home-1',
            name: 'Casa uno',
            role: 'admin',
            permissions: PERMISSIONS,
            active: false
          },
          { id: 'home-2', name: 'Casa dos', role: 'member', permissions: PERMISSIONS, active: true }
        ]
      }
    });
    http.expectOne(API_URL).flush({ data: household({ id: 'home-2', name: 'Casa dos' }) });

    expect(joined).toEqual({ success: true, message: 'Joined household' });
    expect(service.activeHouseholdId()).toBe('home-2');
    expect(service.household()?.name).toBe('Casa dos');
    expect(service.memberships().map((membership) => membership.id)).toEqual(['home-1', 'home-2']);
  });

  it('updates settings and emits the mapped household, with null on an empty response or error', () => {
    localStorage.setItem(STORAGE_KEYS.currentUser, JSON.stringify({ id: 'current-user' }));
    const settings = {
      name: 'Casa renovada',
      sharedPantry: false,
      shareRecipes: false,
      shareCalendar: true
    };
    let updated: Household | null | undefined;

    service.updateSettings(settings).subscribe((value) => (updated = value));
    const update = http.expectOne(API_URL);
    expect(update.request.method).toBe('PATCH');
    expect(update.request.body).toEqual(settings);
    expect(update.request.context.get(SILENT_TOAST)).toBeTrue();
    update.flush({ success: true, data: household({ ...settings, inviteCode: 'NEWCODE' }) });
    expect(updated).toEqual(
      jasmine.objectContaining({ id: 'home-1', inviteCode: 'NEWCODE', name: 'Casa renovada' })
    );
    expect(service.household()?.sharedPantry).toBeFalse();

    let empty: Household | null | undefined;
    service.updateSettings({ shareCalendar: false }).subscribe((value) => (empty = value));
    http.expectOne(API_URL).flush({ success: true, data: null });
    expect(empty).toBeNull();

    let failed: Household | null | undefined;
    service.updateSettings({ name: 'Error' }).subscribe((value) => (failed = value));
    http.expectOne(API_URL).flush({}, { status: 403, statusText: 'Forbidden' });
    expect(failed).toBeNull();
  });

  it('sends a selected member role and permission matrix as one household update', () => {
    const permissions: MemberPermissions = {
      ...PERMISSIONS,
      calendar: { view: true, edit: false },
      settings: false
    };
    const role: MemberRole = 'child';
    let updated: Household | null | undefined;

    service.updateMemberAccess('member-target', role, permissions).subscribe((value) => {
      updated = value;
    });

    const request = http.expectOne(API_URL);
    expect(request.request.method).toBe('PATCH');
    expect(request.request.body).toEqual({
      memberId: 'member-target',
      memberRole: role,
      memberPermissions: permissions
    });
    expect(request.request.context.get(SILENT_TOAST)).toBeTrue();
    request.flush({
      success: true,
      data: household({
        members: [member({ id: 'member-target', role, permissions })]
      })
    });

    expect(updated?.members[0].role).toBe(role);
    expect(updated?.members[0].permissions).toEqual(permissions);
    expect(service.household()?.members[0].permissions).toEqual(permissions);
  });

  it('regenerates and emits the invite code, preserves a null household, and catches errors', () => {
    service.loadHousehold();
    http.expectOne(API_URL).flush({ data: household() });

    let code: string | null | undefined;
    service.regenerateInviteCode().subscribe((value) => (code = value));
    const regenerate = http.expectOne(`${API_URL}/regenerate-invite`);
    expect(regenerate.request.method).toBe('POST');
    expect(regenerate.request.body).toEqual({});
    expect(regenerate.request.context.get(SILENT_TOAST)).toBeTrue();
    regenerate.flush({ success: true, data: { inviteCode: 'NEWCODE' } });
    expect(code).toBe('NEWCODE');
    expect(service.household()?.inviteCode).toBe('NEWCODE');

    service.leaveHousehold().subscribe();
    http.expectOne(`${API_URL}/leave`).flush({ success: true });
    expect(service.household()).toBeNull();

    let codeWithoutHouse: string | null | undefined;
    service.regenerateInviteCode().subscribe((value) => (codeWithoutHouse = value));
    http
      .expectOne(`${API_URL}/regenerate-invite`)
      .flush({ success: true, data: { inviteCode: 'UNATTACHED' } });
    expect(codeWithoutHouse).toBe('UNATTACHED');
    expect(service.household()).toBeNull();

    let failed: string | null | undefined;
    service.regenerateInviteCode().subscribe((value) => (failed = value));
    http
      .expectOne(`${API_URL}/regenerate-invite`)
      .flush({}, { status: 403, statusText: 'Forbidden' });
    expect(failed).toBeNull();
  });

  it('leaves the household, emits true on success and false on error', () => {
    service.loadHousehold();
    http.expectOne(API_URL).flush({ data: household() });
    let left: boolean | undefined;

    service.leaveHousehold().subscribe((value) => (left = value));
    const leave = http.expectOne(`${API_URL}/leave`);
    expect(leave.request.method).toBe('DELETE');
    expect(leave.request.context.get(SILENT_TOAST)).toBeTrue();
    leave.flush({ success: true, message: 'Left household' });
    expect(left).toBeTrue();
    expect(service.household()).toBeNull();

    let failed: boolean | undefined;
    service.leaveHousehold().subscribe((value) => (failed = value));
    http.expectOne(`${API_URL}/leave`).flush({}, { status: 404, statusText: 'Not Found' });
    expect(failed).toBeFalse();
  });

  it('loads only the current user memberships and marks the server-selected household', () => {
    const data = {
      activeHouseholdId: 'home-2',
      memberships: [
        {
          id: 'home-1',
          name: 'Casa uno',
          role: 'member' as const,
          permissions: PERMISSIONS,
          active: false
        },
        {
          id: 'home-2',
          name: 'Casa dos',
          role: 'admin' as const,
          permissions: PERMISSIONS,
          active: true
        }
      ]
    };
    let result: unknown;

    service.loadMemberships().subscribe((value) => (result = value));
    const request = http.expectOne(`${API_URL}/memberships`);
    expect(request.request.method).toBe('GET');
    request.flush({ success: true, data });

    expect(result).toEqual(data.memberships);
    expect(service.memberships()).toEqual(data.memberships);
    expect(service.activeHouseholdId()).toBe('home-2');
  });

  it('reuses server-validated memberships for shell readers and refreshes on demand', () => {
    const memberships = [
      {
        id: 'home-1',
        name: 'Casa uno',
        role: 'admin' as const,
        permissions: PERMISSIONS,
        active: true
      }
    ];
    service.loadMemberships().subscribe();
    http.expectOne(`${API_URL}/memberships`).flush({
      success: true,
      data: { activeHouseholdId: 'home-1', memberships }
    });

    let cachedResult: unknown;
    service.ensureMemberships().subscribe((value) => (cachedResult = value));
    expect(cachedResult).toEqual(memberships);
    http.expectNone(`${API_URL}/memberships`);

    let refreshedResult: unknown;
    service.ensureMemberships(true).subscribe((value) => (refreshedResult = value));
    http.expectOne(`${API_URL}/memberships`).flush({
      success: true,
      data: { activeHouseholdId: 'home-1', memberships }
    });
    expect(refreshedResult).toEqual(memberships);
  });

  it('shares an in-flight membership validation between the route guard and shell', () => {
    let guardedResult: unknown;
    let shellResult: unknown;

    service.loadMemberships().subscribe((value) => (guardedResult = value));
    service.ensureMemberships().subscribe((value) => (shellResult = value));

    const requests = http.match(`${API_URL}/memberships`);
    expect(requests.length).toBe(1);
    requests[0].flush({
      success: true,
      data: { activeHouseholdId: null, memberships: [] }
    });

    expect(guardedResult).toEqual([]);
    expect(shellResult).toEqual([]);
  });

  it('reuses one membership validation within a navigation but refreshes on the next one', () => {
    service.loadMembershipsForNavigation(10).subscribe();
    http.expectOne(`${API_URL}/memberships`).flush({
      success: true,
      data: {
        activeHouseholdId: 'home-1',
        memberships: [{ id: 'home-1', name: 'Casa uno', role: 'admin', permissions: PERMISSIONS }]
      }
    });

    let repeatedResult: unknown;
    service.loadMembershipsForNavigation(10).subscribe((value) => (repeatedResult = value));
    expect((repeatedResult as { id: string }[]).map(({ id }) => id)).toEqual(['home-1']);
    expect(service.activeHouseholdId()).toBe('home-1');
    http.expectNone(`${API_URL}/memberships`);

    service.loadMembershipsForNavigation(11).subscribe();
    http.expectOne(`${API_URL}/memberships`).flush({
      success: true,
      data: { activeHouseholdId: null, memberships: [] }
    });
  });

  it('does not share or apply a pending membership response across user changes', () => {
    localStorage.setItem(STORAGE_KEYS.currentUser, JSON.stringify({ id: 'user-1' }));
    service.loadMemberships().subscribe();

    localStorage.setItem(STORAGE_KEYS.currentUser, JSON.stringify({ id: 'user-2' }));
    service.ensureMemberships().subscribe();

    const requests = http.match(`${API_URL}/memberships`);
    expect(requests.length).toBe(2);
    requests[1].flush({
      success: true,
      data: {
        activeHouseholdId: 'home-2',
        memberships: [{ id: 'home-2', name: 'Casa dos', role: 'member', permissions: PERMISSIONS }]
      }
    });
    requests[0].flush({
      success: true,
      data: {
        activeHouseholdId: 'home-1',
        memberships: [{ id: 'home-1', name: 'Casa uno', role: 'admin', permissions: PERMISSIONS }]
      }
    });

    expect(service.activeHouseholdId()).toBe('home-2');
    expect(service.memberships().map(({ id }) => id)).toEqual(['home-2']);
  });

  it('retries ensureMemberships after a failed initial membership load', () => {
    service.ensureMemberships().subscribe();
    http.expectOne(`${API_URL}/memberships`).flush({}, { status: 503, statusText: 'Unavailable' });

    let result: unknown;
    service.ensureMemberships().subscribe((value) => (result = value));
    http.expectOne(`${API_URL}/memberships`).flush({
      success: true,
      data: { activeHouseholdId: null, memberships: [] }
    });

    expect(result).toEqual([]);
    expect(service.membershipsFailed()).toBeFalse();
  });

  it('clears an obsolete loading state and reloads after memberships resolve the active home', () => {
    service.loadHousehold();
    const staleRequest = http.expectOne(API_URL);
    expect(service.isLoading()).toBeTrue();

    service.loadMemberships().subscribe();
    http.expectOne(`${API_URL}/memberships`).flush({
      success: true,
      data: {
        activeHouseholdId: 'home-1',
        memberships: [
          { id: 'home-1', name: 'Casa uno', role: 'admin', permissions: PERMISSIONS, active: true }
        ]
      }
    });
    expect(service.isLoading()).toBeFalse();

    service.ensureHousehold();
    const currentRequest = http.expectOne(API_URL);
    staleRequest.flush({ data: household({ id: 'home-1', name: 'Casa obsoleta' }) });
    expect(service.household()).toBeNull();
    expect(service.isLoading()).toBeTrue();

    currentRequest.flush({ data: household({ id: 'home-1', name: 'Casa uno' }) });
    expect(service.household()?.name).toBe('Casa uno');
    expect(service.isLoading()).toBeFalse();
  });

  it('changes the active household only after server validation, clears old data and loads the new one', () => {
    service.loadMemberships().subscribe();
    http.expectOne(`${API_URL}/memberships`).flush({
      success: true,
      data: {
        activeHouseholdId: 'home-1',
        memberships: [
          {
            id: 'home-1',
            name: 'Casa uno',
            role: 'member',
            permissions: PERMISSIONS,
            active: true
          },
          { id: 'home-2', name: 'Casa dos', role: 'admin', permissions: PERMISSIONS, active: false }
        ]
      }
    });
    service.loadHousehold();
    http.expectOne(API_URL).flush({ success: true, data: household({ id: 'home-1' }) });

    let changed: boolean | undefined;
    service.selectActiveHousehold('home-2').subscribe((value) => (changed = value));
    const select = http.expectOne(`${API_URL}/active`);
    expect(select.request.method).toBe('POST');
    expect(select.request.body).toEqual({ householdId: 'home-2' });
    select.flush({ success: true, data: { activeHouseholdId: 'home-2' } });

    expect(service.activeHouseholdId()).toBe('home-2');
    expect(service.household()).toBeNull();
    http
      .expectOne(API_URL)
      .flush({ success: true, data: household({ id: 'home-2', name: 'Casa dos' }) });

    expect(changed).toBeTrue();
    expect(service.household()?.id).toBe('home-2');
    expect(service.memberships().find((item) => item.id === 'home-2')?.active).toBeTrue();
  });

  it('keeps the previous household selection and data when the server rejects a selection', () => {
    service.loadMemberships().subscribe();
    http.expectOne(`${API_URL}/memberships`).flush({
      success: true,
      data: {
        activeHouseholdId: 'home-1',
        memberships: [
          { id: 'home-1', name: 'Casa uno', role: 'admin', permissions: PERMISSIONS, active: true },
          {
            id: 'home-2',
            name: 'Casa dos',
            role: 'member',
            permissions: PERMISSIONS,
            active: false
          }
        ]
      }
    });
    service.loadHousehold();
    http.expectOne(API_URL).flush({ success: true, data: household({ id: 'home-1' }) });

    let changed: boolean | undefined;
    service.selectActiveHousehold('foreign-home').subscribe((value) => (changed = value));
    http.expectOne(`${API_URL}/active`).flush({}, { status: 404, statusText: 'Not Found' });
    http.expectOne(`${API_URL}/memberships`).flush({
      success: true,
      data: {
        activeHouseholdId: 'home-1',
        memberships: [
          { id: 'home-1', name: 'Casa uno', role: 'admin', permissions: PERMISSIONS, active: true },
          {
            id: 'home-2',
            name: 'Casa dos',
            role: 'member',
            permissions: PERMISSIONS,
            active: false
          }
        ]
      }
    });
    http.expectOne(API_URL).flush({ success: true, data: household({ id: 'home-1' }) });

    expect(changed).toBeFalse();
    expect(service.activeHouseholdId()).toBe('home-1');
    expect(service.household()?.id).toBe('home-1');
  });

  it('ignores a delayed response from the old household after a successful selection', () => {
    service.loadMemberships().subscribe();
    http.expectOne(`${API_URL}/memberships`).flush({
      success: true,
      data: {
        activeHouseholdId: 'home-1',
        memberships: [
          {
            id: 'home-1',
            name: 'Casa uno',
            role: 'member',
            permissions: PERMISSIONS,
            active: true
          },
          { id: 'home-2', name: 'Casa dos', role: 'admin', permissions: PERMISSIONS, active: false }
        ]
      }
    });

    service.loadHousehold();
    const oldHouseholdRequest = http.expectOne(API_URL);
    let changed: boolean | undefined;
    service.selectActiveHousehold('home-2').subscribe((value) => (changed = value));
    http.expectOne(`${API_URL}/active`).flush({
      success: true,
      data: { activeHouseholdId: 'home-2' }
    });
    const newHouseholdRequest = http.expectOne(API_URL);

    oldHouseholdRequest.flush({ success: true, data: household({ id: 'home-1' }) });
    expect(service.household()).toBeNull();
    newHouseholdRequest.flush({
      success: true,
      data: household({ id: 'home-2', name: 'Casa dos' })
    });

    expect(changed).toBeTrue();
    expect(service.household()?.id).toBe('home-2');
  });

  it('copies a current invite URL and covers explicit/fallback link and admin states', () => {
    const writeText = jasmine.createSpy('writeText').and.returnValue(Promise.resolve());
    originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText }
    });

    expect(service.isAdmin()).toBeFalse();
    expect(service.getInviteLink('EXPLICIT')).toBe(`${window.location.origin}/invite/EXPLICIT`);
    expect(service.getInviteLink()).toBe(`${window.location.origin}/invite/undefined`);
    service.copyInviteCode();
    expect(writeText).not.toHaveBeenCalled();

    service.loadHousehold();
    http.expectOne(API_URL).flush({ data: household() });
    expect(service.isAdmin()).toBeTrue();
    expect(service.getInviteLink()).toBe(`${window.location.origin}/invite/ABC12345`);
    service.copyInviteCode();
    expect(writeText).toHaveBeenCalledOnceWith(`${window.location.origin}/invite/ABC12345`);
  });
});
