import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { ActivatedRoute, convertToParamMap, Router, type ParamMap } from '@angular/router';
import { BehaviorSubject, of, Subject, throwError } from 'rxjs';
import { HouseholdComponent } from './household.component';
import { HouseholdService } from '../../core/services/household.service';
import { ConfirmService } from '../../core/services/confirm.service';
import { I18nService } from '../../core/services/i18n.service';
import { ToastService } from '../../core/services/toast.service';
import { AuthService } from '../../core/services/auth.service';
import { HouseholdPlanService } from '../../core/services/household-plan.service';
import { HouseholdTasksService } from '../../core/services/household-tasks.service';
import type { Household } from '../../shared/models/household.model';
import { householdEn, householdEs } from '../../core/i18n/dict/household';

const HOUSEHOLD: Household = {
  id: 'synthetic-home',
  name: 'Casa sintética',
  inviteCode: 'SYNTHETIC1',
  members: [
    {
      id: 'synthetic-membership',
      userId: 'synthetic-user',
      name: 'Ada Synthetic',
      email: 'ada@example.test',
      role: 'admin',
      cookingLevel: 'intermediate',
      isActive: true,
      joinedAt: new Date('2026-01-02T03:04:05.000Z')
    }
  ],
  sharedPantry: true,
  shareRecipes: true,
  shareCalendar: true,
  myRole: 'admin',
  myPermissions: { members: { invite: true, kick: true } } as Household['myPermissions'],
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-02T03:04:05.000Z')
};

describe('HouseholdComponent', () => {
  let fixture: ComponentFixture<HouseholdComponent>;
  let component: HouseholdComponent;
  let service: ReturnType<typeof createHouseholdService>;
  let toast: jasmine.SpyObj<ToastService>;
  let confirm: jasmine.SpyObj<ConfirmService>;
  let router: jasmine.SpyObj<Router>;
  let queryParams: BehaviorSubject<ParamMap>;

  function createHouseholdService() {
    const householdState = signal<Household | null>(null);
    return {
      household: householdState,
      activeHouseholdId: signal<string | null>(null),
      isLoading: signal(false),
      ensureHousehold: jasmine.createSpy('ensureHousehold'),
      loadHousehold: jasmine.createSpy('loadHousehold'),
      isAdmin: jasmine
        .createSpy('isAdmin')
        .and.callFake(() => householdState()?.myRole === 'admin'),
      getInviteLink: jasmine
        .createSpy('getInviteLink')
        .and.callFake((code: string) => `https://app.example.test/invite/${code}`),
      createHousehold: jasmine.createSpy('createHousehold').and.returnValue(of(null)),
      joinHousehold: jasmine.createSpy('joinHousehold').and.returnValue(of(null)),
      updateSettings: jasmine.createSpy('updateSettings').and.returnValue(of(null)),
      setMemberActive: jasmine.createSpy('setMemberActive').and.returnValue(of(null)),
      updateMemberAccess: jasmine.createSpy('updateMemberAccess').and.returnValue(of(null)),
      regenerateInviteCode: jasmine.createSpy('regenerateInviteCode').and.returnValue(of(null)),
      leaveHousehold: jasmine.createSpy('leaveHousehold').and.returnValue(of(false))
    };
  }

  const i18n = {
    resolved: signal<'es' | 'en'>('es'),
    changeTick: signal(0),
    t: (key: string) => key,
    plural: (_count: number, singular: string, plural: string) => (_count === 1 ? singular : plural)
  };

  beforeEach(async () => {
    service = createHouseholdService();
    queryParams = new BehaviorSubject(convertToParamMap({}));
    router = jasmine.createSpyObj<Router>('Router', ['navigate']);
    router.navigate.and.resolveTo(true);
    toast = jasmine.createSpyObj<ToastService>('ToastService', ['success', 'error']);
    confirm = jasmine.createSpyObj<ConfirmService>('ConfirmService', ['confirm']);
    confirm.confirm.and.resolveTo(true);

    await TestBed.configureTestingModule({
      imports: [HouseholdComponent],
      providers: [
        { provide: HouseholdService, useValue: service },
        { provide: ToastService, useValue: toast },
        { provide: ConfirmService, useValue: confirm },
        { provide: AuthService, useValue: { currentUser: () => ({ id: 'synthetic-admin' }) } },
        { provide: I18nService, useValue: i18n },
        {
          provide: HouseholdPlanService,
          useValue: {
            load: jasmine.createSpy('loadPlan').and.returnValue(of({ version: 0, plan: null }))
          }
        },
        {
          provide: HouseholdTasksService,
          useValue: {
            load: jasmine
              .createSpy('loadTasks')
              .and.returnValue(of({ weekStart: '2026-10-05', version: 0, tasks: [] })),
            save: jasmine
              .createSpy('saveTasks')
              .and.returnValue(of({ weekStart: '2026-10-05', version: 1, tasks: [] }))
          }
        },
        {
          provide: ActivatedRoute,
          useValue: { queryParamMap: queryParams.asObservable() }
        },
        { provide: Router, useValue: router }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(HouseholdComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('only confirms copying the invite link after the clipboard write resolves', async () => {
    const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    let confirmWrite!: () => void;
    const writeText = jasmine.createSpy('writeText').and.returnValue(
      new Promise<void>((resolve) => {
        confirmWrite = resolve;
      })
    );
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText }
    });

    try {
      service.household.set(HOUSEHOLD);
      fixture.detectChanges();
      component.copyLink();

      expect(writeText).toHaveBeenCalledWith('https://app.example.test/invite/SYNTHETIC1');
      expect(toast.success).not.toHaveBeenCalled();

      confirmWrite();
      await Promise.resolve();
      await Promise.resolve();

      expect(toast.success).toHaveBeenCalledWith(
        'household.copiado',
        'household.enlace_de_invitacion_copiado'
      );
      expect(toast.error).not.toHaveBeenCalled();
    } finally {
      confirmWrite();
      if (originalClipboard) Object.defineProperty(navigator, 'clipboard', originalClipboard);
      else Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
    }
  });

  it('shows the translated copy error when the browser denies access to the clipboard', async () => {
    const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: jasmine.createSpy('writeText').and.returnValue(Promise.reject()) }
    });

    try {
      service.household.set(HOUSEHOLD);
      fixture.detectChanges();
      component.copyLink();
      await Promise.resolve();
      await Promise.resolve();

      expect(toast.success).not.toHaveBeenCalled();
      expect(toast.error).toHaveBeenCalledWith('ui.error', 'household.no_se_pudo_copiar');
      expect(householdEs['household.no_se_pudo_copiar']).toContain('manualmente');
      expect(householdEn['household.no_se_pudo_copiar']).toContain('manually');
    } finally {
      if (originalClipboard) Object.defineProperty(navigator, 'clipboard', originalClipboard);
      else Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
    }
  });

  it('keeps create open and retryable when the service emits its failure sentinel', () => {
    service.createHousehold.and.returnValues(of(null), of(HOUSEHOLD));
    component.openCreateModal();
    component.createForm.name = 'Casa pendiente';

    component.createHousehold();

    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith('ui.error', 'household.no_se_pudo_crear');
    expect(component.isCreateModalOpen()).toBeTrue();
    expect(component.createForm.name).toBe('Casa pendiente');
    expect(component.isSaving()).toBeFalse();

    component.createHousehold();
    expect(toast.success).toHaveBeenCalledTimes(1);
    expect(component.isCreateModalOpen()).toBeFalse();
  });

  it('keeps join open and retryable when the service emits its failure sentinel', () => {
    service.joinHousehold.and.returnValues(of(null), of({ success: true }));
    component.openJoinModal();
    component.joinForm.inviteCode = 'SYNTHETIC1';

    component.joinHousehold();

    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith('ui.error', 'household.codigo_invalido_o_ya');
    expect(component.isJoinModalOpen()).toBeTrue();
    expect(component.joinForm.inviteCode).toBe('SYNTHETIC1');
    expect(component.isSaving()).toBeFalse();

    component.joinHousehold();
    expect(toast.success).toHaveBeenCalledTimes(1);
    expect(component.isJoinModalOpen()).toBeFalse();
  });

  it('rejects duplicate create and join submissions while their request is pending', () => {
    const pendingCreate = new Subject<Household | null>();
    service.createHousehold.and.returnValue(pendingCreate);
    component.createForm.name = 'Casa pendiente';
    component.createHousehold();
    component.createHousehold();
    expect(service.createHousehold).toHaveBeenCalledTimes(1);
    pendingCreate.next(null);
    pendingCreate.complete();
    expect(component.isSaving()).toBeFalse();

    const pendingJoin = new Subject<unknown>();
    service.joinHousehold.and.returnValue(pendingJoin);
    component.joinForm.inviteCode = 'SYNTHETIC1';
    component.joinHousehold();
    component.joinHousehold();
    expect(service.joinHousehold).toHaveBeenCalledTimes(1);
    pendingJoin.next(null);
    pendingJoin.complete();
    expect(component.isSaving()).toBeFalse();
  });

  it('reports settings sentinels as failures without replacing confirmed household state', () => {
    const updated = { ...HOUSEHOLD, shareRecipes: false };
    service.household.set(HOUSEHOLD);
    service.updateSettings.and.returnValues(of(null), of(updated));
    component.selectTab('settings');
    fixture.detectChanges();
    const checkbox = fixture.nativeElement.querySelectorAll(
      '.settings-section input[type="checkbox"]'
    )[1] as HTMLInputElement;
    checkbox.checked = false;
    checkbox.dispatchEvent(new Event('change', { bubbles: true }));

    expect(checkbox.checked).toBeTrue();
    expect(service.household()).toBe(HOUSEHOLD);
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith('ui.error', 'household.no_se_pudo_actualizar');

    component.toggleSetting('shareRecipes', false);
    expect(toast.success).toHaveBeenCalledTimes(1);
  });

  it('synchronizes direct URL changes and tab selection without discarding unrelated query params', () => {
    service.household.set(HOUSEHOLD);
    fixture.detectChanges();

    expect(component.activeTab()).toBe('home');
    expect(
      fixture.nativeElement.querySelector('[data-test="household-panel-home"]')
    ).not.toBeNull();
    expect(
      fixture.nativeElement.querySelector('[data-test="household-panel-members"]')?.hidden
    ).toBeTrue();

    component.selectTab('members');
    expect(component.activeTab()).toBe('members');
    expect(router.navigate).toHaveBeenCalledWith([], {
      relativeTo: TestBed.inject(ActivatedRoute),
      queryParams: { tab: 'members' },
      queryParamsHandling: 'merge'
    });

    queryParams.next(convertToParamMap({ tab: 'permissions', source: 'shared-link' }));
    fixture.detectChanges();
    expect(component.activeTab()).toBe('permissions');
    expect(
      fixture.nativeElement.querySelector('[data-test="household-panel-permissions"]')?.hidden
    ).toBeFalse();

    component.selectTab('home');
    expect(router.navigate).toHaveBeenCalledWith([], {
      relativeTo: TestBed.inject(ActivatedRoute),
      queryParams: { tab: null },
      queryParamsHandling: 'merge'
    });
  });

  it('keeps the selected tab in view after a narrow-screen layout changes', () => {
    service.household.set(HOUSEHOLD);
    fixture.detectChanges();
    const settingsTab = fixture.nativeElement.querySelector(
      '#household-tab-settings'
    ) as HTMLButtonElement;
    const scrollIntoView = jasmine.createSpy('scrollIntoView');
    settingsTab.scrollIntoView = scrollIntoView;
    spyOn(window, 'requestAnimationFrame').and.callFake((callback: FrameRequestCallback) => {
      callback(0);
      return 0;
    });

    component.selectTab('settings');

    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest', inline: 'nearest' });
  });

  it('cleans invalid tab URLs with replace while preserving other query parameters', () => {
    queryParams.next(convertToParamMap({ tab: 'unknown', source: 'bookmark' }));
    fixture.detectChanges();

    expect(component.activeTab()).toBe('home');
    expect(router.navigate).toHaveBeenCalledWith([], {
      relativeTo: TestBed.inject(ActivatedRoute),
      queryParams: { tab: null },
      queryParamsHandling: 'merge',
      replaceUrl: true
    });
  });

  it('resets the selected tab when the active household changes', async () => {
    service.activeHouseholdId.set('first-household');
    queryParams.next(convertToParamMap({ tab: 'settings', source: 'shared-link' }));
    fixture.detectChanges();
    await fixture.whenStable();
    expect(component.activeTab()).toBe('settings');

    service.activeHouseholdId.set('second-household');
    fixture.detectChanges();
    await fixture.whenStable();

    expect(component.activeTab()).toBe('home');
    expect(router.navigate).toHaveBeenCalledWith([], {
      relativeTo: TestBed.inject(ActivatedRoute),
      queryParams: { tab: null, space: null },
      queryParamsHandling: 'merge',
      replaceUrl: true
    });
  });

  it('supports all tab keyboard shortcuts and ignores unrelated keys', () => {
    service.household.set(HOUSEHOLD);
    fixture.detectChanges();
    const homeTab = fixture.nativeElement.querySelector(
      '[data-test="household-tab-home"]'
    ) as HTMLButtonElement;

    const press = (key: string) => {
      homeTab.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
      fixture.detectChanges();
    };

    press('End');
    expect(component.activeTab()).toBe('settings');
    press('ArrowLeft');
    expect(component.activeTab()).toBe('permissions');
    press('Home');
    expect(component.activeTab()).toBe('home');

    router.navigate.calls.reset();
    press('Tab');
    expect(router.navigate).not.toHaveBeenCalled();
  });

  it('saves a trimmed household name through the existing household update endpoint', () => {
    service.household.set(HOUSEHOLD);
    service.updateSettings.and.returnValue(of({ ...HOUSEHOLD, name: 'Casa nueva' }));
    fixture.detectChanges();
    component.householdNameDraft.set('  Casa nueva  ');

    component.saveHouseholdName();

    expect(service.updateSettings).toHaveBeenCalledOnceWith({ name: 'Casa nueva' });
    expect(component.householdNameDraft()).toBe('Casa nueva');
    expect(toast.success).toHaveBeenCalledWith(
      'household.ajustes_del_hogar_guardados',
      'Casa nueva'
    );
  });

  it('preserves a failed household-name draft so the admin can retry it', () => {
    service.household.set(HOUSEHOLD);
    service.updateSettings.and.returnValue(of(null));
    fixture.detectChanges();
    component.householdNameDraft.set('Nombre actualizado');

    component.saveHouseholdName();
    fixture.detectChanges();

    expect(component.savingName()).toBeFalse();
    expect(component.householdNameDraft()).toBe('Nombre actualizado');
    expect(service.household()?.name).toBe('Casa sintética');
  });

  it('preserves a dirty draft on refresh and synchronizes an untouched name', () => {
    service.household.set(HOUSEHOLD);
    fixture.detectChanges();
    component.householdNameDraft.set('Borrador local');

    service.household.set({ ...HOUSEHOLD, name: 'Nombre remoto' });
    fixture.detectChanges();
    expect(component.householdNameDraft()).toBe('Borrador local');

    component.householdNameDraft.set('Nombre remoto');
    service.household.set({ ...HOUSEHOLD, name: 'Nombre confirmado' });
    fixture.detectChanges();
    expect(component.householdNameDraft()).toBe('Nombre confirmado');
  });

  it('replaces the draft when a different household is confirmed', () => {
    service.household.set(HOUSEHOLD);
    fixture.detectChanges();
    component.householdNameDraft.set('Borrador del hogar anterior');

    service.household.set({ ...HOUSEHOLD, id: 'other-household', name: 'Otro hogar' });
    fixture.detectChanges();

    expect(component.householdNameDraft()).toBe('Otro hogar');
  });

  it('releases the saving state after a rejected name or permission update', () => {
    const target = {
      ...HOUSEHOLD.members[0],
      id: 'synthetic-target-membership',
      userId: 'synthetic-target-user',
      role: 'member' as const
    };
    service.household.set({ ...HOUSEHOLD, members: [...HOUSEHOLD.members, target] });
    service.updateSettings.and.returnValue(throwError(() => new Error('synthetic failure')));
    service.updateMemberAccess.and.returnValue(
      throwError(() => new Error('synthetic permission failure'))
    );
    fixture.detectChanges();

    component.householdNameDraft.set('Nombre actualizado');
    component.saveHouseholdName();
    expect(component.savingName()).toBeFalse();

    component.selectPermissionMember(target.id);
    component.saveMemberAccess(target);
    expect(component.savingAccess()).toBeFalse();
    expect(toast.error).toHaveBeenCalledWith('ui.error', 'household.no_se_pudo_actualizar_miembro');
  });

  it('allows an admin to save a member role and explicit permission matrix', () => {
    const target = {
      ...HOUSEHOLD.members[0],
      id: 'synthetic-target-membership',
      userId: 'synthetic-target-user',
      role: 'member' as const
    };
    const household = { ...HOUSEHOLD, members: [...HOUSEHOLD.members, target] };
    service.household.set(household);
    service.updateMemberAccess.and.returnValue(of(household));
    fixture.detectChanges();

    component.selectPermissionMember(target.id);
    component.setPermissionsRole('child');
    const calendarEdit = component.permissionFields.find(
      (field) => field.group === 'calendar' && field.key === 'edit'
    )!;
    component.setPermission(calendarEdit, true);
    component.saveMemberAccess(target);

    expect(service.updateMemberAccess).toHaveBeenCalledOnceWith(
      target.id,
      'child',
      jasmine.objectContaining({ calendar: { view: true, edit: true } })
    );
    expect(toast.success).toHaveBeenCalledWith(
      'household.permissions_saved',
      'household.ajustes_del_hogar_guardados'
    );
  });

  it('completes partial permission matrices and ignores invalid member or role selections', () => {
    const target = {
      ...HOUSEHOLD.members[0],
      id: 'synthetic-partial-permissions',
      userId: 'other-synthetic-user',
      role: 'member' as const,
      permissions: {
        pantry: { view: false },
        settings: true
      } as Household['myPermissions']
    };
    service.household.set({ ...HOUSEHOLD, members: [...HOUSEHOLD.members, target] });
    fixture.detectChanges();

    component.selectPermissionMember(target.id);
    expect(component.permissionDraft().pantry).toEqual({ view: false, edit: true, manage: false });
    expect(component.permissionDraft().recipes).toEqual({
      view: true,
      create: true,
      edit: false,
      delete: false,
      generateAI: true
    });
    expect(component.permissionDraft().settings).toBeTrue();

    component.setPermissionsRole('admin');
    expect(component.permissionRole()).toBe('admin');
    expect(component.permissionDraft().settings).toBeTrue();
    component.setPermissionsRole('member');
    expect(component.permissionRole()).toBe('member');
    component.setPermissionsRole('invalid');
    expect(component.permissionRole()).toBe('member');

    component.selectPermissionMember('unknown-member');
    expect(component.selectedPermissionMember()).toBeUndefined();
  });

  it('guards permission saves by admin/loading state and reports an empty response', () => {
    const target = {
      ...HOUSEHOLD.members[0],
      id: 'synthetic-save-target',
      userId: 'other-synthetic-user',
      role: 'member' as const
    };
    service.household.set({ ...HOUSEHOLD, members: [...HOUSEHOLD.members, target] });
    fixture.detectChanges();
    component.selectPermissionMember(target.id);

    service.household.set({ ...service.household()!, myRole: 'member' });
    component.saveMemberAccess(target);
    expect(service.updateMemberAccess).not.toHaveBeenCalled();

    service.household.set({ ...service.household()!, myRole: 'admin' });
    component.savingAccess.set(true);
    component.saveMemberAccess(target);
    expect(service.updateMemberAccess).not.toHaveBeenCalled();

    component.savingAccess.set(false);
    service.updateMemberAccess.and.returnValue(of(null));
    component.saveMemberAccess(target);
    expect(toast.error).toHaveBeenCalledWith('ui.error', 'household.no_se_pudo_actualizar_miembro');
  });

  it('guards household rename when read-only, blank, or already saving', () => {
    service.household.set({ ...HOUSEHOLD, myRole: 'member' });
    component.householdNameDraft.set('Nombre no autorizado');
    component.saveHouseholdName();
    expect(service.updateSettings).not.toHaveBeenCalled();

    service.household.set(HOUSEHOLD);
    component.householdNameDraft.set('   ');
    component.saveHouseholdName();
    expect(service.updateSettings).not.toHaveBeenCalled();

    component.householdNameDraft.set('Nombre nuevo');
    component.savingName.set(true);
    component.saveHouseholdName();
    expect(service.updateSettings).not.toHaveBeenCalled();
  });

  it('does not render household mutations for a non-admin in the settings tab', () => {
    service.household.set({ ...HOUSEHOLD, myRole: 'member' });
    component.selectTab('settings');
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[data-test="household-name-input"]')).toBeNull();
    expect(fixture.nativeElement.querySelector('.settings-section')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('.settings-section')?.textContent).toContain(
      'household.settings_admin_only'
    );
  });

  it('does not let an admin toggle a member when members.kick is explicitly disabled', () => {
    const target = {
      ...HOUSEHOLD.members[0],
      id: 'member-without-kick',
      userId: 'other-user',
      role: 'member' as const,
      isActive: true
    };
    service.household.set({
      ...HOUSEHOLD,
      members: [...HOUSEHOLD.members, target],
      myPermissions: { members: { invite: true, kick: false } } as Household['myPermissions']
    });

    expect(component.canToggleMember(target)).toBeFalse();
  });

  it('confirms member deactivation and sends a reversible status update', async () => {
    const target = {
      ...HOUSEHOLD.members[0],
      id: 'member-to-pause',
      userId: 'other-user',
      role: 'member' as const,
      isActive: true
    };
    const householdWithTarget = { ...HOUSEHOLD, members: [...HOUSEHOLD.members, target] };
    service.household.set(householdWithTarget);
    service.setMemberActive.and.returnValue(
      of({
        ...householdWithTarget,
        members: householdWithTarget.members.map((member) =>
          member.id === target.id ? { ...member, isActive: false } : member
        )
      })
    );
    fixture.detectChanges();

    await component.toggleMemberActive(target);

    expect(confirm.confirm).toHaveBeenCalled();
    expect(service.setMemberActive).toHaveBeenCalledOnceWith(target.id, false);
    expect(toast.success).toHaveBeenCalledWith(
      'household.miembro_desactivado',
      'household.ajustes_del_hogar_guardados'
    );
    expect(component.savingMemberId()).toBeNull();
  });

  it('reports invite regeneration failure and only confirms a returned code', () => {
    service.regenerateInviteCode.and.returnValues(of(null), of('SYNTHETIC2'));

    component.regenerateCode();

    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith('ui.error', 'household.no_se_pudo_regenerar');

    component.regenerateCode();
    expect(toast.success).toHaveBeenCalledTimes(1);
  });

  it('does not leave after cancellation and treats a false leave sentinel as an error', async () => {
    confirm.confirm.and.resolveTo(false);
    await component.leaveHousehold();
    expect(service.leaveHousehold).not.toHaveBeenCalled();

    confirm.confirm.and.resolveTo(true);
    service.leaveHousehold.and.returnValues(of(false), of(true));
    await component.leaveHousehold();
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith('ui.error', 'household.no_se_pudo_salir');

    await component.leaveHousehold();
    expect(toast.success).toHaveBeenCalledTimes(1);
  });

  it('passes accessible titles to all three household dialogs', () => {
    component.openCreateModal();
    fixture.detectChanges();
    expect(dialogName()).toBe('household.crear_hogar');

    component.closeCreateModal();
    component.openJoinModal();
    fixture.detectChanges();
    expect(dialogName()).toBe('household.unirse_a_un_hogar');

    component.closeJoinModal();
    component.openInviteModal();
    fixture.detectChanges();
    expect(dialogName()).toBe('household.invitar_miembro');
  });

  it('provides translated error messages in Spanish and English', () => {
    const es = householdEs as Record<string, string>;
    const en = householdEn as Record<string, string>;
    expect(es['household.no_se_pudo_regenerar']).toContain('regenerar');
    expect(en['household.no_se_pudo_regenerar']).toContain('regenerate');
    expect(es['household.no_se_pudo_salir']).toContain('salir');
    expect(en['household.no_se_pudo_salir']).toContain('leave');
  });

  it('renders the confirmed household and resolves role/permission labels', () => {
    service.household.set(HOUSEHOLD);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.household-info__name')?.textContent).toContain(
      HOUSEHOLD.name
    );
    expect(component.miembrosLabel(1)).toBe('household.n_miembros_uno');
    expect(component.miembrosLabel(2)).toBe('household.n_miembros_varios');
    expect(component.isAdmin()).toBeTrue();
    expect(component.canInvite()).toBeTrue();
    expect(component.getRoleVariant('admin')).toBe('primary');
    expect(component.getRoleVariant('member')).toBe('secondary');
    expect(component.getRoleVariant('child')).toBe('neutral');
    expect(component.getRoleLabel('admin')).toBe('household.rol_admin');
    expect(component.getRoleLabel('member')).toBe('household.rol_miembro');
    expect(component.getRoleLabel('child')).toBe('household.rol_nino');
    expect(component.getRoleLabel('unknown')).toBe('unknown');
    expect(component.getLevelLabel('intermediate')).toBe('auth.intermediate');
  });

  it('lets a current household add another home through join or create actions', () => {
    service.household.set(HOUSEHOLD);
    fixture.detectChanges();

    const join = fixture.nativeElement.querySelector(
      '[data-test="household-add-home"] button'
    ) as HTMLButtonElement;
    const create = fixture.nativeElement.querySelector(
      '[data-test="household-create-home"] button'
    ) as HTMLButtonElement;
    expect(join).not.toBeNull();
    expect(create).not.toBeNull();

    join.click();
    fixture.detectChanges();
    expect(dialogName()).toBe('household.unirse_a_un_hogar');

    component.closeJoinModal();
    create.click();
    fixture.detectChanges();
    expect(dialogName()).toBe('household.crear_hogar');
  });

  function dialogName(): string | null {
    return (
      fixture.nativeElement.querySelector('[role="dialog"]')?.getAttribute('aria-label') ?? null
    );
  }
});
