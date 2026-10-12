import { cookingLevelWord } from '../../shared/models';
import type {
  HouseholdMember,
  MemberPermissions,
  MemberRole
} from '../../shared/models/household.model';
import { Component, DestroyRef, effect, inject, OnInit, signal, untracked } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { finalize } from 'rxjs';
import { HouseholdService } from '../../core/services/household.service';
import { ClipboardService } from '../../core/services/clipboard.service';
import { ToastService } from '../../core/services/toast.service';
import { ConfirmService } from '../../core/services/confirm.service';
import { ButtonComponent } from '../../shared/components/ui/button/button.component';
import { InputComponent } from '../../shared/components/ui/input/input.component';
import { BadgeComponent } from '../../shared/components/ui/badge/badge.component';
import { AvatarComponent } from '../../shared/components/ui/avatar/avatar.component';
import { ModalComponent } from '../../shared/components/ui/modal/modal.component';
import {
  PickerComponent,
  type PickerOption
} from '../../shared/components/ui/picker/picker.component';
import { LoadingComponent } from '../../shared/components/ui/loading/loading.component';
import { IconComponent } from '../../shared/components/ui/icon/icon.component';
import { TranslatePipe } from '../../core/pipes/translate.pipe';
import { I18nService } from '../../core/services/i18n.service';
import { AuthService } from '../../core/services/auth.service';
import type { TranslationKey } from '../../core/i18n';
import {
  householdTabQueryValue,
  isCanonicalHouseholdTabQuery,
  resolveHouseholdTab,
  type HouseholdTab
} from './household-tabs.util';
import { HouseholdPlanEditorComponent } from './household-plan-editor.component';
import { HouseholdTasksComponent } from './household-tasks.component';

type PermissionGroup = 'pantry' | 'recipes' | 'calendar' | 'members' | 'settings';
interface PermissionField {
  group: PermissionGroup;
  key: string;
  label: TranslationKey;
}

function defaultMemberPermissions(role: MemberRole): MemberPermissions {
  if (role === 'admin') {
    return {
      pantry: { view: true, edit: true, manage: true },
      recipes: { view: true, create: true, edit: true, delete: true, generateAI: true },
      calendar: { view: true, edit: true },
      members: { invite: true, kick: true, manageRoles: true },
      settings: true
    };
  }
  if (role === 'child') {
    return {
      pantry: { view: true, edit: false, manage: false },
      recipes: { view: true, create: false, edit: false, delete: false, generateAI: false },
      calendar: { view: true, edit: false },
      members: { invite: false, kick: false, manageRoles: false },
      settings: false
    };
  }
  return {
    pantry: { view: true, edit: true, manage: false },
    recipes: { view: true, create: true, edit: false, delete: false, generateAI: true },
    calendar: { view: true, edit: true },
    members: { invite: false, kick: false, manageRoles: false },
    settings: false
  };
}

function completeMemberPermissions(value: unknown, role: MemberRole): MemberPermissions {
  const fallback = defaultMemberPermissions(role);
  if (!value || typeof value !== 'object') return fallback;
  const supplied = value as Partial<MemberPermissions>;
  return {
    pantry: { ...fallback.pantry, ...(supplied.pantry ?? {}) },
    recipes: { ...fallback.recipes, ...(supplied.recipes ?? {}) },
    calendar: { ...fallback.calendar, ...(supplied.calendar ?? {}) },
    members: { ...fallback.members, ...(supplied.members ?? {}) },
    settings: typeof supplied.settings === 'boolean' ? supplied.settings : fallback.settings
  };
}

@Component({
  selector: 'app-household',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    TranslatePipe,
    ButtonComponent,
    InputComponent,
    BadgeComponent,
    AvatarComponent,
    ModalComponent,
    PickerComponent,
    LoadingComponent,
    IconComponent,
    HouseholdPlanEditorComponent,
    HouseholdTasksComponent
  ],
  template: `
    <div class="household">
      <!-- Header -->
      <div
        class="household__header"
        [class.household__header--plan-flow]="activeTab() === 'plan' || activeTab() === 'tasks'"
      >
        <h1 class="household__title">
          <app-icon name="group" [size]="24" [label]="null" />
          <span>{{ 'household.hogar' | t }}</span>
        </h1>
        <div *ngIf="householdService.household()" class="household__header-actions">
          <app-button
            variant="outline"
            size="sm"
            data-test="household-add-home"
            (onClick)="openJoinModal()"
          >
            {{ 'household.unirse_a_otro_hogar' | t }}
          </app-button>
          <app-button
            variant="outline"
            size="sm"
            data-test="household-create-home"
            (onClick)="openCreateModal()"
          >
            {{ 'household.crear_otro_hogar' | t }}
          </app-button>
        </div>
      </div>

      <!-- Loading -->
      <app-loading
        *ngIf="householdService.isLoading()"
        [message]="'common.loading' | t"
      ></app-loading>

      <!-- No Household -->
      <div
        *ngIf="!householdService.isLoading() && !householdService.household()"
        class="no-household"
      >
        <div class="no-household__content">
          <app-icon class="no-household__icon" name="home" [size]="56" [label]="null" />
          <h2 class="no-household__title">{{ 'household.no_tienes_un_hogar' | t }}</h2>
          <p class="no-household__text">
            {{ 'household.crea_un_hogar_o' | t }}
          </p>

          <div class="no-household__actions">
            <app-button variant="primary" (onClick)="openCreateModal()">
              {{ 'household.crear_hogar_2' | t }}
            </app-button>
            <app-button variant="outline" (onClick)="openJoinModal()">
              {{ 'household.unirse_con_codigo' | t }}
            </app-button>
          </div>
        </div>
      </div>

      <!-- Household Content -->
      <div
        *ngIf="householdService.household() as household"
        class="household__content"
        [class.household--wide]="activeTab() === 'plan' || activeTab() === 'tasks'"
        [class.household__content--plan-flow]="activeTab() === 'plan' || activeTab() === 'tasks'"
      >
        <nav class="household-tabs" role="tablist" [attr.aria-label]="'household.hogar' | t">
          <button
            *ngFor="let tab of tabOptions"
            type="button"
            role="tab"
            class="household-tabs__tab"
            [id]="'household-tab-' + tab.value"
            [attr.aria-selected]="activeTab() === tab.value"
            [attr.aria-controls]="'household-panel-' + tab.value"
            [attr.tabindex]="activeTab() === tab.value ? 0 : -1"
            [attr.data-test]="'household-tab-' + tab.value"
            (click)="selectTab(tab.value)"
            (keydown)="onTabKeydown($event)"
          >
            {{ tab.label | t }}
          </button>
        </nav>

        <section
          [hidden]="activeTab() !== 'home'"
          id="household-panel-home"
          class="household-tab-panel"
          role="tabpanel"
          aria-labelledby="household-tab-home"
          tabindex="0"
          data-test="household-panel-home"
        >
          <!-- Household Info -->
          <div class="household-info">
            <div class="household-info__header">
              <div>
                <h2 class="household-info__name">{{ household.name }}</h2>
                <span class="household-info__members">{{
                  miembrosLabel(activeMemberCount(household.members))
                }}</span>
              </div>
              <app-badge variant="primary">
                {{
                  household.sharedPantry
                    ? ('household.despensa_compartida' | t)
                    : ('household.despensa_individual' | t)
                }}
              </app-badge>
            </div>

            <!-- Invite Code -->
            <div class="invite-card">
              <div class="invite-card__content">
                <span class="invite-card__label">{{ 'household.enlace_de_invitacion' | t }}</span>
                <span class="invite-card__code">{{ inviteLink() }}</span>
              </div>
              <div class="invite-card__actions">
                <app-button variant="outline" size="sm" (onClick)="copyLink()">
                  <app-icon name="content_copy" [size]="16" [label]="null" />
                  {{ 'household.copiar_enlace' | t }}
                </app-button>
                <app-button
                  variant="ghost"
                  size="sm"
                  (onClick)="regenerateCode()"
                  *ngIf="canInvite()"
                >
                  <app-icon name="refresh" [size]="16" [label]="null" />
                  {{ 'household.regenerar' | t }}
                </app-button>
              </div>
            </div>
          </div>
        </section>

        <section
          [hidden]="activeTab() !== 'members'"
          id="household-panel-members"
          class="household-tab-panel"
          role="tabpanel"
          aria-labelledby="household-tab-members"
          tabindex="0"
          data-test="household-panel-members"
        >
          <!-- Members -->
          <div class="members-section">
            <div class="members-section__header">
              <h3>{{ 'dashboard.members' | t }}</h3>
              <app-button
                *ngIf="canInvite()"
                variant="outline"
                size="sm"
                (onClick)="openInviteModal()"
              >
                {{ 'household.invitar' | t }}
              </app-button>
            </div>

            <div class="members-list">
              <div *ngFor="let member of household.members" class="member-card">
                <app-avatar [name]="member.name" size="md"></app-avatar>

                <div class="member-card__info">
                  <span class="member-card__name">{{ member.name }}</span>
                  <span class="member-card__email">{{ member.email }}</span>
                </div>

                <div class="member-card__meta">
                  <app-badge [variant]="getRoleVariant(member.role)" size="sm">
                    {{ getRoleLabel(member.role) }}
                  </app-badge>
                  <app-badge variant="neutral" size="sm">
                    {{ getLevelLabel(member.cookingLevel) }}
                  </app-badge>
                  <app-badge [variant]="member.isActive ? 'success' : 'neutral'" size="sm">
                    {{
                      member.isActive
                        ? ('household.miembro_activo' | t)
                        : ('household.miembro_inactivo' | t)
                    }}
                  </app-badge>
                </div>

                <app-button
                  *ngIf="canToggleMember(member)"
                  variant="outline"
                  size="sm"
                  [disabled]="savingMemberId() !== null"
                  [attr.data-test]="'member-active-' + member.id"
                  (onClick)="toggleMemberActive(member)"
                >
                  {{
                    member.isActive
                      ? ('household.desactivar_miembro' | t)
                      : ('household.activar_miembro' | t)
                  }}
                </app-button>
              </div>
            </div>
          </div>
        </section>

        <section
          [hidden]="activeTab() !== 'permissions'"
          id="household-panel-permissions"
          class="household-tab-panel"
          role="tabpanel"
          aria-labelledby="household-tab-permissions"
          tabindex="0"
          data-test="household-panel-permissions"
        >
          <div *ngIf="isAdmin(); else permissionsReadOnly" class="permissions-section">
            <h2>{{ 'household.permisos_de_miembro' | t }}</h2>
            <span>{{ 'household.seleccionar_miembro' | t }}</span>
            <app-picker
              [label]="'household.seleccionar_miembro' | t"
              [placeholder]="'household.seleccionar_miembro' | t"
              [options]="permissionMemberPickerOptions()"
              [value]="permissionMemberId() || null"
              [filterFrom]="8"
              (valueChange)="selectPermissionMember($event ?? '')"
              data-test="permissions-member-select"
            />

            <p *ngIf="permissionMemberOptions().length === 0" class="permissions-section__hint">
              {{ 'household.member_settings_select' | t }}
            </p>

            <div *ngIf="selectedPermissionMember() as member" class="permissions-editor">
              <span>{{ 'household.rol' | t }}</span>
              <app-picker
                [label]="'household.rol' | t"
                [options]="permissionRolePickerOptions()"
                [value]="permissionRole()"
                (valueChange)="setPermissionsRole($event ?? '')"
                data-test="permissions-role"
              />

              <div class="permissions-editor__fields">
                <label *ngFor="let field of permissionFields" class="setting-toggle">
                  <input
                    type="checkbox"
                    [checked]="permissionValue(field)"
                    [attr.data-test]="'permission-' + field.group + '-' + field.key"
                    (change)="setPermission(field, $any($event.target).checked)"
                  />
                  <span>{{ field.label | t }}</span>
                </label>
              </div>
              <div class="form-actions">
                <app-button
                  variant="primary"
                  [loading]="savingAccess()"
                  [disabled]="savingAccess()"
                  data-test="permissions-save"
                  (onClick)="saveMemberAccess(member)"
                >
                  {{ 'common.save' | t }}
                </app-button>
              </div>
            </div>
          </div>
          <ng-template #permissionsReadOnly>
            <p class="permissions-section__hint">{{ 'household.permissions_admin_only' | t }}</p>
          </ng-template>
        </section>

        <section
          [hidden]="activeTab() !== 'settings'"
          id="household-panel-settings"
          class="household-tab-panel"
          role="tabpanel"
          aria-labelledby="household-tab-settings"
          tabindex="0"
          data-test="household-panel-settings"
        >
          <section class="settings-section" *ngIf="isAdmin()">
            <h2 class="settings-section__title">{{ 'household.tab_settings' | t }}</h2>
            <label class="household-name-field" for="household-name-input">
              {{ 'household.nombre_del_hogar' | t }}
              <input
                id="household-name-input"
                type="text"
                maxlength="100"
                [ngModel]="householdNameDraft()"
                (ngModelChange)="householdNameDraft.set($event)"
                data-test="household-name-input"
              />
            </label>
            <app-button
              variant="outline"
              [loading]="savingName()"
              [disabled]="
                savingName() ||
                !householdNameDraft().trim() ||
                householdNameDraft().trim() === household.name
              "
              data-test="household-name-save"
              (onClick)="saveHouseholdName()"
            >
              {{ 'household.guardar_nombre' | t }}
            </app-button>
          </section>

          <!-- Sharing & Settings (admins only) -->
          <section class="settings-section" *ngIf="isAdmin()">
            <h3 class="settings-section__title">
              <app-icon name="link" [size]="18" [label]="null" />
              <span>{{ 'household.compartir_en_el_hogar' | t }}</span>
            </h3>
            <div class="settings-section__options">
              <label class="setting-toggle">
                <input
                  type="checkbox"
                  [checked]="household.sharedPantry"
                  (change)="toggleSetting('sharedPantry', $any($event.target).checked, $event)"
                />
                <span>{{ 'household.despensa_compartida' | t }}</span>
              </label>
              <label class="setting-toggle">
                <input
                  type="checkbox"
                  [checked]="household.shareRecipes"
                  (change)="toggleSetting('shareRecipes', $any($event.target).checked, $event)"
                />
                <span>{{ 'household.recetas_compartidas' | t }}</span>
              </label>
              <label class="setting-toggle">
                <input
                  type="checkbox"
                  [checked]="household.shareCalendar"
                  (change)="toggleSetting('shareCalendar', $any($event.target).checked, $event)"
                />
                <span>{{ 'household.calendario_compartido' | t }}</span>
              </label>
            </div>
          </section>

          <section class="settings-section" *ngIf="!isAdmin()">
            <h2 class="settings-section__title">{{ 'household.tab_settings' | t }}</h2>
            <p class="permissions-section__hint">{{ 'household.settings_admin_only' | t }}</p>
          </section>

          <!-- Actions -->
          <div class="household__actions">
            <app-button variant="danger" (onClick)="leaveHousehold()">
              <app-icon name="logout" [size]="16" [label]="null" />
              {{ 'household.salir_del_hogar' | t }}
            </app-button>
          </div>
        </section>

        <section
          [hidden]="activeTab() !== 'plan'"
          id="household-panel-plan"
          class="household-tab-panel"
          role="tabpanel"
          aria-labelledby="household-tab-plan"
          tabindex="0"
          data-test="household-panel-plan"
        >
          <app-household-plan-editor
            [householdId]="household.id"
            [canEdit]="household.myPermissions?.settings ?? household.myRole === 'admin'"
            [members]="household.members"
            (planSaved)="refreshTasksAfterPlanOrAssignmentSave()"
            (assignmentSaved)="refreshTasksAfterPlanOrAssignmentSave()"
            (zoneTasksSelected)="openTasksForZone($event)"
          />
        </section>

        <section
          [hidden]="activeTab() !== 'tasks'"
          id="household-panel-tasks"
          class="household-tab-panel"
          role="tabpanel"
          aria-labelledby="household-tab-tasks"
          tabindex="0"
          data-test="household-panel-tasks"
        >
          <app-household-tasks
            [householdId]="household.id"
            [canEdit]="household.myPermissions?.calendar?.edit ?? household.myRole === 'admin'"
            [members]="household.members"
            [selectedSpaceId]="selectedTaskSpaceId()"
            [refreshToken]="tasksRefreshToken()"
          />
        </section>
      </div>

      <!-- Create Modal -->
      <app-modal
        [isOpen]="isCreateModalOpen()"
        [title]="'household.crear_hogar' | t"
        size="md"
        (onClose)="closeCreateModal()"
      >
        <form (ngSubmit)="createHousehold()" class="create-form">
          <app-input
            id="householdName"
            name="householdName"
            [label]="'household.nombre_del_hogar' | t"
            [placeholder]="'household.ej_mi_hogar' | t"
            [(ngModel)]="createForm.name"
            [required]="true"
          ></app-input>

          <div class="form-field">
            <label class="form-checkbox">
              <input type="checkbox" [(ngModel)]="createForm.sharedPantry" name="sharedPantry" />
              <span>{{ 'household.compartir_despensa_entre_miembros' | t }}</span>
            </label>
          </div>

          <div class="form-actions">
            <app-button
              variant="ghost"
              type="button"
              [touchTarget]="true"
              (onClick)="closeCreateModal()"
              >{{ 'common.cancel' | t }}</app-button
            >
            <app-button
              variant="primary"
              type="submit"
              [touchTarget]="true"
              [loading]="isSaving()"
              >{{ 'common.create' | t }}</app-button
            >
          </div>
        </form>
      </app-modal>

      <!-- Join Modal -->
      <app-modal
        [isOpen]="isJoinModalOpen()"
        [title]="'household.unirse_a_un_hogar' | t"
        size="md"
        (onClose)="closeJoinModal()"
      >
        <form (ngSubmit)="joinHousehold()" class="join-form">
          <p class="join-form__description">
            {{ 'household.introduce_el_codigo_de' | t }}
          </p>

          <app-input
            id="inviteCode"
            name="inviteCode"
            [label]="'household.codigo_de_invitacion' | t"
            [placeholder]="'household.ej_abc12345' | t"
            [(ngModel)]="joinForm.inviteCode"
            [required]="true"
          ></app-input>

          <div class="form-actions">
            <app-button
              variant="ghost"
              type="button"
              [touchTarget]="true"
              (onClick)="closeJoinModal()"
              >{{ 'common.cancel' | t }}</app-button
            >
            <app-button
              variant="primary"
              type="submit"
              [touchTarget]="true"
              [loading]="isSaving()"
              >{{ 'household.unirse' | t }}</app-button
            >
          </div>
        </form>
      </app-modal>

      <!-- Invite Modal -->
      <app-modal
        [isOpen]="isInviteModalOpen()"
        [title]="'household.invitar_miembro' | t"
        size="md"
        (onClose)="closeInviteModal()"
      >
        <div class="invite-modal">
          <p>{{ 'household.comparte_este_codigo_con' | t }}</p>

          <div class="invite-code-display">
            <span class="invite-code-display__code">{{
              householdService.household()?.inviteCode
            }}</span>
            <app-button variant="primary" [touchTarget]="true" (onClick)="copyCode()">
              <app-icon name="content_copy" [size]="16" [label]="null" />
              {{ 'household.copiar' | t }}
            </app-button>
          </div>
        </div>
      </app-modal>
    </div>
  `,
  styles: [
    `
      .household {
        padding-block: var(--container-padding);
        max-width: 800px;
        margin: 0 auto;
      }

      .household.household--wide {
        max-width: 1280px;
      }

      .household__header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--space-3);
        flex-wrap: wrap;
        margin-bottom: var(--space-6);
      }

      .household__header--plan-flow {
        position: absolute;
        width: 1px;
        height: 1px;
        padding: 0;
        margin: -1px;
        overflow: hidden;
        clip: rect(0, 0, 0, 0);
        white-space: nowrap;
        border: 0;
      }

      .household__content--plan-flow {
        padding-top: 0;
      }

      .household__header-actions {
        display: flex;
        align-items: center;
        gap: var(--space-2);
        flex-wrap: wrap;
      }

      @media (max-width: 480px) {
        .household__header-actions {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          width: 100%;
        }
      }

      @media (max-width: 767px) {
        .household__content--plan-flow {
          margin-inline: -6px;
        }
      }

      .household-tabs {
        display: flex;
        gap: var(--space-2);
        min-width: 0;
        max-width: 100%;
        margin-bottom: var(--space-5);
        overflow-x: auto;
        overflow-y: hidden;
        overscroll-behavior-inline: contain;
        scrollbar-width: thin;
        border-bottom: 1px solid var(--border-default);
      }

      .household-tabs__tab {
        flex: 0 0 auto;
        white-space: nowrap;
        padding: var(--space-3) var(--space-4);
        border: none;
        border-bottom: 2px solid transparent;
        background: none;
        font-family: var(--font-sans);
        font-size: var(--text-sm);
        font-weight: var(--font-medium);
        color: var(--text-secondary);
        cursor: pointer;
        transition: var(--transition-fast);
      }

      .household-tabs__tab:hover {
        color: var(--text-primary);
      }

      .household-tabs__tab[aria-selected='true'] {
        border-bottom-color: var(--primary);
        color: var(--primary);
      }

      .household-tabs__tab:focus-visible,
      .household-tab-panel:focus-visible {
        outline: 2px solid var(--primary);
        outline-offset: 2px;
      }

      @media (max-width: 767px) {
        .household__content--plan-flow .household-tabs {
          margin-bottom: var(--space-3);
          gap: 0;
          overflow-x: hidden;
        }

        .household__content--plan-flow .household-tabs__tab {
          min-width: 0;
          flex: 1 1 0;
          padding-right: 2px;
          padding-left: 2px;
          font-size: 0.7rem;
          text-align: center;
        }
      }

      @media (max-width: 389px) {
        .household__content--plan-flow .household-tabs,
        .household-tabs {
          gap: 0;
          justify-content: flex-start;
          overflow-x: auto;
        }

        .household__content--plan-flow .household-tabs::after,
        .household-tabs::after {
          content: '';
          flex: 0 0 20px;
        }

        .household__content--plan-flow .household-tabs__tab,
        .household-tabs__tab {
          min-width: 0;
          flex: 0 0 auto;
          padding-right: 3px;
          padding-left: 3px;
          font-size: 0.62rem;
        }
      }

      @media (max-width: 339px) {
        .household__content--plan-flow .household-tabs,
        .household-tabs {
          gap: 4px;
        }
      }

      .household-tab-panel {
        min-width: 0;
      }

      .household-tab-panel[hidden] {
        display: none;
      }

      .household-name-field {
        display: grid;
        max-width: 420px;
        gap: var(--space-2);
        margin-bottom: var(--space-3);
        font-size: var(--text-sm);
      }

      .household-name-field input,
      .permissions-section app-picker {
        box-sizing: border-box;
        width: 100%;
        max-width: 420px;
      }

      .household-name-field input {
        min-height: 40px;
        padding: 8px 10px;
        border: 1px solid var(--border-default);
        border-radius: var(--radius-sm);
        background: var(--bg-primary);
        color: var(--text-primary);
        font: inherit;
      }

      .permissions-section {
        display: grid;
        max-width: 680px;
        gap: var(--space-3);
      }

      .permissions-section h2 {
        margin: 0;
        font-size: var(--text-lg);
      }

      .permissions-section__hint {
        margin: 0;
        color: var(--text-secondary);
        font-size: var(--text-sm);
      }

      .permissions-editor {
        display: grid;
        gap: var(--space-2);
      }

      .permissions-editor__fields {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: var(--space-2) var(--space-4);
        margin-top: var(--space-2);
      }

      .permissions-editor__fields .setting-toggle {
        min-width: 0;
      }

      .household-name-field input:focus-visible {
        outline: 2px solid var(--primary);
        outline-offset: 2px;
      }

      .household__title {
        display: flex;
        align-items: center;
        gap: var(--space-2);
        font-family: var(--font-display);
        font-size: var(--text-2xl);
        font-weight: var(--font-bold);
      }

      /* No Household */
      .no-household {
        display: flex;
        align-items: center;
        justify-content: center;
        min-height: 60vh;
      }

      .no-household__content {
        text-align: center;
        max-width: 400px;
      }

      .no-household__icon {
        display: block;
        margin-bottom: var(--space-4);
        color: var(--primary);
      }

      .no-household__title {
        font-family: var(--font-display);
        font-size: var(--text-2xl);
        font-weight: var(--font-bold);
        margin-bottom: var(--space-2);
      }

      .no-household__text {
        font-size: var(--text-sm);
        color: var(--text-secondary);
        margin-bottom: var(--space-6);
      }

      .no-household__actions {
        display: flex;
        gap: var(--space-3);
        justify-content: center;
      }

      /* Household Info */
      .household-info {
        margin-bottom: var(--space-6);
      }

      .household-info__header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: var(--space-4);
      }

      .household-info__name {
        font-family: var(--font-display);
        font-size: var(--text-xl);
        font-weight: var(--font-semibold);
      }

      .household-info__members {
        font-size: var(--text-sm);
        color: var(--text-secondary);
      }

      /* Invite Card */
      .invite-card {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: var(--space-4);
        background: var(--bg-tertiary);
        border-radius: var(--radius-lg);
      }

      .invite-card__content {
        display: flex;
        flex-direction: column;
      }

      .invite-card__label {
        font-size: var(--text-xs);
        color: var(--text-secondary);
      }

      .invite-card__code {
        font-family: var(--font-mono);
        font-size: var(--text-xl);
        font-weight: var(--font-bold);
        letter-spacing: var(--tracking-wider);
      }

      .invite-card__actions {
        display: flex;
        gap: var(--space-2);
      }

      /* Members */
      .members-section {
        margin-bottom: var(--space-6);
      }

      .members-section__header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: var(--space-4);

        h3 {
          font-size: var(--text-lg);
          font-weight: var(--font-semibold);
        }
      }

      .members-list {
        display: flex;
        flex-direction: column;
        gap: var(--space-2);
      }

      .member-card {
        display: flex;
        align-items: center;
        gap: var(--space-3);
        padding: var(--space-3);
        background: var(--bg-secondary);
        border-radius: var(--radius-lg);
        border: 1px solid var(--border-default);
      }

      .member-card__info {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;
      }

      .member-card__name {
        font-size: var(--text-sm);
        font-weight: var(--font-medium);
      }

      .member-card__email {
        font-size: var(--text-xs);
        color: var(--text-secondary);
      }

      .member-card__meta {
        display: flex;
        gap: var(--space-2);
      }

      @media (max-width: 767px) {
        .member-card {
          display: grid;
          grid-template-columns: auto minmax(0, 1fr);
        }

        .member-card__name,
        .member-card__email {
          overflow-wrap: anywhere;
        }

        .member-card__meta {
          grid-column: 1 / -1;
          flex-wrap: wrap;
        }

        .member-card > app-button {
          grid-column: 1 / -1;
          justify-self: start;
        }

        .permissions-editor__fields {
          grid-template-columns: minmax(0, 1fr);
        }
      }

      /* Settings section */
      .settings-section {
        margin-bottom: var(--space-6);
        padding: var(--space-4);
        background: var(--bg-secondary);
        border-radius: var(--radius-xl);
        border: 1px solid var(--border-default);
      }
      .settings-section__title {
        display: flex;
        align-items: center;
        gap: var(--space-2);
        font-size: var(--text-base);
        font-weight: var(--font-semibold);
        margin: 0 0 var(--space-3) 0;
      }
      .settings-section__options {
        display: flex;
        flex-direction: column;
        gap: var(--space-2);
      }
      .setting-toggle {
        display: flex;
        align-items: center;
        gap: var(--space-2);
        font-size: var(--text-sm);
        cursor: pointer;
        input[type='checkbox'] {
          width: 18px;
          height: 18px;
        }
      }

      /* Actions */
      .household__actions {
        display: flex;
        gap: var(--space-3);
        justify-content: flex-end;
      }

      /* Forms */
      .create-form,
      .join-form {
        display: flex;
        flex-direction: column;
        gap: var(--space-4);
      }

      .join-form__description {
        font-size: var(--text-sm);
        color: var(--text-secondary);
      }

      .form-field {
        display: flex;
        flex-direction: column;
        gap: var(--space-2);
      }

      .form-checkbox {
        display: flex;
        align-items: center;
        gap: var(--space-2);
        font-size: var(--text-sm);
        cursor: pointer;

        input[type='checkbox'] {
          width: 18px;
          height: 18px;
          cursor: pointer;
        }
      }

      .form-actions {
        display: flex;
        justify-content: flex-end;
        gap: var(--space-3);
        margin-top: var(--space-4);
      }

      /* Invite Modal */
      .invite-modal {
        display: flex;
        flex-direction: column;
        gap: var(--space-4);

        p {
          font-size: var(--text-sm);
          color: var(--text-secondary);
        }
      }

      .invite-code-display {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: var(--space-4);
        background: var(--bg-tertiary);
        border-radius: var(--radius-lg);
      }

      .invite-code-display__code {
        font-family: var(--font-mono);
        font-size: var(--text-2xl);
        font-weight: var(--font-bold);
      }

      @media (max-width: 767px) {
        .invite-card {
          align-items: stretch;
          flex-direction: column;
          gap: var(--space-3);
        }

        .invite-card__content {
          min-width: 0;
        }

        .invite-card__code {
          max-width: 100%;
          overflow-wrap: anywhere;
          font-size: var(--text-base);
          letter-spacing: normal;
        }

        .invite-card__actions {
          flex-wrap: wrap;
        }
      }
    `
  ]
})
export class HouseholdComponent implements OnInit {
  private readonly i18n = inject(I18nService);
  private readonly clipboardService = inject(ClipboardService);
  private readonly authService = inject(AuthService);

  /** «4 miembros» / «1 miembro»: el contador de la casa, con su sustantivo en el diccionario. */
  miembrosLabel(cantidad: number): string {
    return this.i18n.plural(cantidad, 'household.n_miembros_uno', 'household.n_miembros_varios', {
      count: cantidad
    });
  }

  activeMemberCount(members: readonly HouseholdMember[]): number {
    return members.filter((member) => member.isActive).length;
  }

  householdService = inject(HouseholdService);
  private toastService = inject(ToastService);
  private confirmService = inject(ConfirmService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  readonly activeTab = signal<HouseholdTab>('home');
  readonly selectedTaskSpaceId = signal<string | null>(null);
  readonly tasksRefreshToken = signal(0);
  readonly tabOptions: Array<{ value: HouseholdTab; label: TranslationKey }> = [
    { value: 'home', label: 'household.tab_home' },
    { value: 'plan', label: 'household.tab_plan' },
    { value: 'tasks', label: 'household.tab_tasks' },
    { value: 'members', label: 'household.tab_members' },
    { value: 'permissions', label: 'household.tab_permissions' },
    { value: 'settings', label: 'household.tab_settings' }
  ];
  readonly permissionFields: PermissionField[] = [
    { group: 'pantry', key: 'view', label: 'household.permission_pantry_view' },
    { group: 'pantry', key: 'edit', label: 'household.permission_pantry_edit' },
    { group: 'pantry', key: 'manage', label: 'household.permission_pantry_manage' },
    { group: 'recipes', key: 'view', label: 'household.permission_recipes_view' },
    { group: 'recipes', key: 'create', label: 'household.permission_recipes_create' },
    { group: 'recipes', key: 'edit', label: 'household.permission_recipes_edit' },
    { group: 'recipes', key: 'delete', label: 'household.permission_recipes_delete' },
    { group: 'recipes', key: 'generateAI', label: 'household.permission_recipes_generateAI' },
    { group: 'calendar', key: 'view', label: 'household.permission_calendar_view' },
    { group: 'calendar', key: 'edit', label: 'household.permission_calendar_edit' },
    { group: 'members', key: 'invite', label: 'household.permission_members_invite' },
    { group: 'members', key: 'kick', label: 'household.permission_members_kick' },
    { group: 'members', key: 'manageRoles', label: 'household.permission_members_manageRoles' },
    { group: 'settings', key: 'settings', label: 'household.permission_settings' }
  ];

  isCreateModalOpen = signal(false);
  isJoinModalOpen = signal(false);
  isInviteModalOpen = signal(false);
  isSaving = signal(false);
  savingMemberId = signal<string | null>(null);
  savingName = signal(false);
  savingAccess = signal(false);
  householdNameDraft = signal('');
  permissionMemberId = signal('');
  permissionRole = signal<MemberRole>('member');
  permissionDraft = signal<MemberPermissions>(defaultMemberPermissions('member'));

  createForm = {
    name: '',
    sharedPantry: true
  };

  joinForm = {
    inviteCode: ''
  };

  inviteLink = signal('');
  private syncedHouseholdName: { id: string; name: string } | null = null;

  constructor() {
    let previousHouseholdId = this.householdService.activeHouseholdId();
    effect(() => {
      const activeHouseholdId = this.householdService.activeHouseholdId();
      if (previousHouseholdId !== null && activeHouseholdId !== previousHouseholdId) {
        this.activeTab.set('home');
        this.selectedTaskSpaceId.set(null);
        void this.router.navigate([], {
          relativeTo: this.route,
          queryParams: { tab: null, space: null },
          queryParamsHandling: 'merge',
          replaceUrl: true
        });
      }
      previousHouseholdId = activeHouseholdId;
    });

    effect(() => {
      const h = this.householdService.household();
      const previous = this.syncedHouseholdName;
      if (!h) {
        this.syncedHouseholdName = null;
        return;
      }

      if (h?.inviteCode) this.inviteLink.set(this.householdService.getInviteLink(h.inviteCode));
      const draft = untracked(() => this.householdNameDraft());
      if (!previous || previous.id !== h.id || draft === previous.name) {
        this.householdNameDraft.set(h.name);
      }
      this.syncedHouseholdName = { id: h.id, name: h.name };
    });
  }

  ngOnInit(): void {
    this.householdService.ensureHousehold();
    this.route.queryParamMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
      const queryTab = params.get('tab');
      this.activeTab.set(resolveHouseholdTab(queryTab));
      this.selectedTaskSpaceId.set(params.get('space'));
      if (!isCanonicalHouseholdTabQuery(queryTab)) {
        void this.router.navigate([], {
          relativeTo: this.route,
          queryParams: { tab: null },
          queryParamsHandling: 'merge',
          replaceUrl: true
        });
      }
    });
  }

  selectTab(tab: HouseholdTab): void {
    this.activeTab.set(tab);
    void this.router
      .navigate([], {
        relativeTo: this.route,
        queryParams: { tab: householdTabQueryValue(tab) },
        queryParamsHandling: 'merge'
      })
      .then(() => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            this.revealHouseholdTab(tab);
            window.setTimeout(() => this.revealHouseholdTab(tab), 80);
          });
        });
      });
  }

  private revealHouseholdTab(tab: HouseholdTab): void {
    const tabElement = document.getElementById(`household-tab-${tab}`);
    const tabList = tabElement?.closest<HTMLElement>('.household-tabs');
    if (!tabElement || !tabList) return;

    tabList.style.scrollBehavior = 'auto';
    const listBounds = tabList.getBoundingClientRect();
    const tabBounds = tabElement.getBoundingClientRect();
    const leftOverflow = Math.max(0, listBounds.left - tabBounds.left);
    const rightOverflow = Math.max(0, tabBounds.right - listBounds.right);
    if (leftOverflow > 1) tabList.scrollLeft = 0;
    else if (rightOverflow > 1) tabList.scrollLeft = tabList.scrollWidth - tabList.clientWidth;
  }

  openTasksForZone(spaceId: string): void {
    this.selectedTaskSpaceId.set(spaceId);
    this.activeTab.set('tasks');
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { tab: 'tasks', space: spaceId },
      queryParamsHandling: 'merge'
    });
  }

  refreshTasksAfterPlanOrAssignmentSave(): void {
    this.tasksRefreshToken.update((token) => token + 1);
  }

  onTabKeydown(event: KeyboardEvent): void {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const currentIndex = this.tabOptions.findIndex((tab) => tab.value === this.activeTab());
    const nextIndex =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? this.tabOptions.length - 1
          : (currentIndex + (event.key === 'ArrowRight' ? 1 : -1) + this.tabOptions.length) %
            this.tabOptions.length;
    const next = this.tabOptions[nextIndex];
    const nextTab = (event.currentTarget as HTMLElement | null)?.parentElement
      ?.querySelectorAll<HTMLButtonElement>('[role="tab"]')
      .item(nextIndex);
    nextTab?.focus({ preventScroll: true });
    this.selectTab(next.value);
  }

  permissionMemberOptions(): HouseholdMember[] {
    const currentUserId = this.authService.currentUser()?.id;
    return (this.householdService.household()?.members ?? []).filter(
      (member) => member.userId !== currentUserId
    );
  }

  permissionMemberPickerOptions(): PickerOption[] {
    return this.permissionMemberOptions().map((member) => ({
      value: member.id,
      label: `${member.name} · ${this.getRoleLabel(member.role)}`
    }));
  }

  permissionRolePickerOptions(): PickerOption[] {
    return [
      { value: 'admin', label: this.i18n.t('household.rol_admin') },
      { value: 'member', label: this.i18n.t('household.rol_miembro') },
      { value: 'child', label: this.i18n.t('household.rol_nino') }
    ];
  }

  selectedPermissionMember(): HouseholdMember | undefined {
    return this.permissionMemberOptions().find((member) => member.id === this.permissionMemberId());
  }

  selectPermissionMember(memberId: string): void {
    this.permissionMemberId.set(memberId);
    const member = this.permissionMemberOptions().find((item) => item.id === memberId);
    if (!member) return;
    this.permissionRole.set(member.role);
    this.permissionDraft.set(completeMemberPermissions(member.permissions, member.role));
  }

  setPermissionsRole(role: string): void {
    if (!['admin', 'member', 'child'].includes(role)) return;
    this.permissionRole.set(role as MemberRole);
    this.permissionDraft.set(defaultMemberPermissions(role as MemberRole));
  }

  permissionValue(field: PermissionField): boolean {
    if (field.group === 'settings') return this.permissionDraft().settings;
    const group = this.permissionDraft()[field.group] as unknown as Record<string, boolean>;
    return group[field.key] === true;
  }

  setPermission(field: PermissionField, enabled: boolean): void {
    this.permissionDraft.update((current) => {
      if (field.group === 'settings') return { ...current, settings: enabled };
      const group = current[field.group] as unknown as Record<string, boolean>;
      return {
        ...current,
        [field.group]: { ...group, [field.key]: enabled }
      } as MemberPermissions;
    });
  }

  saveMemberAccess(member: HouseholdMember): void {
    if (!this.isAdmin() || this.savingAccess()) return;
    this.savingAccess.set(true);
    this.householdService
      .updateMemberAccess(member.id, this.permissionRole(), this.permissionDraft())
      .pipe(finalize(() => this.savingAccess.set(false)))
      .subscribe({
        next: (updated) => {
          if (!updated) {
            this.notifyMutationError('household.no_se_pudo_actualizar_miembro');
            return;
          }
          this.toastService.success(
            this.i18n.t('household.permissions_saved'),
            this.i18n.t('household.ajustes_del_hogar_guardados')
          );
        },
        error: () => this.notifyMutationError('household.no_se_pudo_actualizar_miembro')
      });
  }

  saveHouseholdName(): void {
    const name = this.householdNameDraft().trim();
    if (!this.isAdmin() || !name || this.savingName()) return;
    this.savingName.set(true);
    this.householdService
      .updateSettings({ name })
      .pipe(finalize(() => this.savingName.set(false)))
      .subscribe({
        next: (updated) => {
          if (!updated) {
            this.notifyMutationError('household.no_se_pudo_actualizar');
            return;
          }
          this.householdNameDraft.set(updated.name);
          this.toastService.success(
            this.i18n.t('household.ajustes_del_hogar_guardados'),
            updated.name
          );
        },
        error: () => this.notifyMutationError('household.no_se_pudo_actualizar')
      });
  }

  isAdmin(): boolean {
    return this.householdService.isAdmin();
  }

  canInvite(): boolean {
    return !!this.householdService.household()?.myPermissions?.members?.invite || this.isAdmin();
  }

  canToggleMember(member: HouseholdMember): boolean {
    const household = this.householdService.household();
    const configuredPermission = household?.myPermissions?.members?.kick;
    const canKick =
      typeof configuredPermission === 'boolean'
        ? configuredPermission
        : household?.myRole === 'admin';
    return Boolean(
      member.userId !== this.authService.currentUser()?.id &&
      canKick &&
      (household?.members ?? []).some((item) => item.id === member.id)
    );
  }

  async toggleMemberActive(member: HouseholdMember): Promise<void> {
    if (!this.canToggleMember(member) || this.savingMemberId()) return;
    const nextActive = !member.isActive;
    if (!nextActive) {
      const accepted = await this.confirmService.confirm({
        title: this.i18n.t('household.desactivar_miembro'),
        message: this.i18n.t('household.confirmar_desactivar_miembro'),
        confirmText: this.i18n.t('household.desactivar')
      });
      if (!accepted) return;
    }

    this.savingMemberId.set(member.id);
    this.householdService.setMemberActive(member.id, nextActive).subscribe({
      next: (updated) => {
        if (!updated) {
          this.notifyMutationError('household.no_se_pudo_actualizar_miembro');
          return;
        }
        this.toastService.success(
          this.i18n.t(nextActive ? 'household.miembro_activado' : 'household.miembro_desactivado'),
          this.i18n.t('household.ajustes_del_hogar_guardados')
        );
      },
      error: () => {
        this.savingMemberId.set(null);
        this.notifyMutationError('household.no_se_pudo_actualizar_miembro');
      },
      complete: () => this.savingMemberId.set(null)
    });
  }

  copyLink(): void {
    this.clipboardService.copy(this.inviteLink()).then(
      () =>
        this.toastService.success(
          this.i18n.t('household.copiado'),
          this.i18n.t('household.enlace_de_invitacion_copiado')
        ),
      () => this.notifyMutationError('household.no_se_pudo_copiar')
    );
  }

  toggleSetting(
    key: 'sharedPantry' | 'shareRecipes' | 'shareCalendar',
    value: boolean,
    event?: Event
  ): void {
    const input = event?.target as HTMLInputElement | null;
    const confirmedHousehold = this.householdService.household();
    if (input && confirmedHousehold) input.checked = confirmedHousehold[key];

    this.householdService.updateSettings({ [key]: value }).subscribe({
      next: (updated) => {
        if (!updated) {
          this.notifyMutationError('household.no_se_pudo_actualizar');
          return;
        }
        this.toastService.success(
          this.i18n.t('ai_config.actualizado'),
          this.i18n.t('household.ajustes_del_hogar_guardados')
        );
      },
      error: () => this.notifyMutationError('household.no_se_pudo_actualizar')
    });
  }

  openCreateModal(): void {
    this.createForm = { name: '', sharedPantry: true };
    this.isCreateModalOpen.set(true);
  }

  closeCreateModal(): void {
    this.isCreateModalOpen.set(false);
  }

  openJoinModal(): void {
    this.joinForm = { inviteCode: '' };
    this.isJoinModalOpen.set(true);
  }

  closeJoinModal(): void {
    this.isJoinModalOpen.set(false);
  }

  openInviteModal(): void {
    this.isInviteModalOpen.set(true);
  }

  closeInviteModal(): void {
    this.isInviteModalOpen.set(false);
  }

  openSettingsModal(): void {
    // TODO
  }

  createHousehold(): void {
    if (!this.createForm.name || this.isSaving()) return;

    this.isSaving.set(true);
    this.householdService
      .createHousehold(this.createForm.name, this.createForm.sharedPantry)
      .subscribe({
        next: (household) => {
          if (!household) {
            this.notifyMutationError('household.no_se_pudo_crear');
            this.isSaving.set(false);
            return;
          }
          this.toastService.success(
            this.i18n.t('household.creado'),
            this.i18n.t('household.tu_hogar_ha_sido')
          );
          this.closeCreateModal();
          this.isSaving.set(false);
        },
        error: () => {
          this.notifyMutationError('household.no_se_pudo_crear');
          this.isSaving.set(false);
        }
      });
  }

  joinHousehold(): void {
    if (!this.joinForm.inviteCode || this.isSaving()) return;

    this.isSaving.set(true);
    this.householdService.joinHousehold(this.joinForm.inviteCode).subscribe({
      next: (result) => {
        if (result?.success !== true) {
          this.notifyMutationError('household.codigo_invalido_o_ya');
          this.isSaving.set(false);
          return;
        }
        this.toastService.success(
          this.i18n.t('household.te_has_unido'),
          this.i18n.t('household.ahora_eres_miembro_del')
        );
        this.closeJoinModal();
        this.isSaving.set(false);
      },
      error: () => {
        this.notifyMutationError('household.codigo_invalido_o_ya');
        this.isSaving.set(false);
      }
    });
  }

  copyCode(): void {
    this.copyLink();
  }

  regenerateCode(): void {
    this.householdService.regenerateInviteCode().subscribe({
      next: (inviteCode) => {
        if (!inviteCode) {
          this.notifyMutationError('household.no_se_pudo_regenerar');
          return;
        }
        this.toastService.success(
          this.i18n.t('household.regenerado'),
          this.i18n.t('household.nuevo_codigo_de_invitacion')
        );
      },
      error: () => this.notifyMutationError('household.no_se_pudo_regenerar')
    });
  }

  async leaveHousehold(): Promise<void> {
    const accepted = await this.confirmService.confirm({
      title: this.i18n.t('household.salir_del_hogar'),
      message: this.i18n.t('household.estas_seguro_de_salir'),
      confirmText: this.i18n.t('household.salir')
    });
    if (!accepted) return;

    this.householdService.leaveHousehold().subscribe({
      next: (left) => {
        if (left !== true) {
          this.notifyMutationError('household.no_se_pudo_salir');
          return;
        }
        this.toastService.success(
          this.i18n.t('household.saliste'),
          this.i18n.t('household.has_salido_del_hogar')
        );
      },
      error: () => this.notifyMutationError('household.no_se_pudo_salir')
    });
  }

  private notifyMutationError(message: TranslationKey): void {
    this.toastService.error(this.i18n.t('ui.error'), this.i18n.t(message));
  }

  getRoleVariant(role: string): 'primary' | 'secondary' | 'neutral' {
    switch (role) {
      case 'admin':
        return 'primary';
      case 'member':
        return 'secondary';
      default:
        return 'neutral';
    }
  }

  getRoleLabel(role: string): string {
    const labelKeys: Record<string, TranslationKey> = {
      admin: 'household.rol_admin',
      member: 'household.rol_miembro',
      child: 'household.rol_nino'
    };
    const key = labelKeys[role];
    return key ? this.i18n.t(key) : role;
  }

  getLevelLabel(level: string): string {
    return cookingLevelWord(level, (clave) => this.i18n.t(clave), level);
  }
}
