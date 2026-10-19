import { Component, computed, effect, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';
import { ShoppingService } from '../../core/services/shopping.service';
import { ToastService } from '../../core/services/toast.service';
import { passwordChangeErrorKey } from './account-password-error';
import { timeZoneLabel } from '../../core/time';
import { cookingLevelWord } from '../../shared/models/home-profile';
import { syncTabWithUrl } from '../../core/utils/tab-url';
import { avatarFileError } from '../../core/avatar-image';
import { AvatarEditorComponent } from './avatar-editor.component';
import { ModalComponent } from '../../shared/components/ui/modal/modal.component';
import { formatBytes, pendingLabelKey, shortId, storageUsage } from './account-info';
import { AvatarIssue } from '../../core/avatar-image';
import { ButtonComponent } from '../../shared/components/ui/button/button.component';
import { AvatarComponent } from '../../shared/components/ui/avatar/avatar.component';
import { IconComponent } from '../../shared/components/ui/icon/icon.component';
import type { IconName } from '../../shared/components/ui/icon/icon-paths';
import { environment } from '../../../environments/environment';
import { TranslatePipe } from '../../core/pipes/translate.pipe';
import type { TranslationKey } from '../../core/i18n';
import { I18nService } from '../../core/services/i18n.service';
import { MAX_BCRYPT_PASSWORD_BYTES, newPasswordIssue } from '../../core/utils/password-policy';
import { nameDraftIsDirty } from './account-name-draft';
import { FocusErrorDirective } from './focus-error.directive';

/**
 * La cuenta de la persona, en su propia pagina (HOGARIA-SPEC §12l).
 *
 * Estaba dentro de Preferencias, y Preferencias habla del comensal: alergias, gustos, objetivo.
 * Son dos personas distintas en la misma pantalla —quien cocina y quien eres— y al pulsar tu cara
 * en el menu lo que se quiere tocar es la cara, no el ajo. Tres sub-secciones, una por asunto que
 * se puede estropear de una manera distinta: como te llamas y tu foto (aqui), tu contrasena y tu
 * sesion (aqui, y nada mas), y lo que la app tiene guardado en este navegador (aqui, porque antes
 * no habia donde mirarlo).
 */
type AccountTab = 'account' | 'security' | 'info';

const PASSWORD_DESCRIPTION_IDS = {
  current: 'account-password-hint',
  new: 'account-password-new-hint',
  currentWithError: 'account-password-hint account-password-error',
  newWithError: 'account-password-new-hint account-password-error'
} as const;

const ACCOUNT_TABS = ['account', 'security', 'info'] as const;

@Component({
  selector: 'app-account',
  standalone: true,
  imports: [
    TranslatePipe,
    CommonModule,
    FormsModule,
    RouterLink,
    AvatarComponent,
    ButtonComponent,
    IconComponent,
    ModalComponent,
    AvatarEditorComponent,
    FocusErrorDirective
  ],
  template: `
    <div class="account-page">
      <header class="account__head">
        <div>
          <p class="account__eyebrow">{{ 'nav.household' | t }}</p>
          <h1 class="page-heading account__title">{{ 'account.mi_cuenta' | t }}</h1>
          <p class="account__subtitle">
            {{ 'account.tu_nombre_tu_foto' | t }}
            <a routerLink="/preferences" class="account__inline-link">{{ 'nav.preferences' | t }}</a
            >{{ 'account.y_lo_de_la' | t }}
            <a routerLink="/household" class="account__inline-link">{{ 'nav.household' | t }}</a
            >.
          </p>
        </div>
      </header>

      <div class="account__tabs" role="tablist" data-test="account-tabs">
        <button
          *ngFor="let tab of tabs"
          type="button"
          class="tab"
          role="tab"
          [attr.aria-selected]="activeTab() === tab.id"
          [class.tab--active]="activeTab() === tab.id"
          [attr.data-test]="'account-tab-' + tab.id"
          (click)="switchTab(tab.id)"
        >
          <app-icon [name]="tab.icon" [size]="16" />
          {{ tab.labelKey | t }}
        </button>
      </div>

      <section class="account__panel" [ngSwitch]="activeTab()">
        <!-- ── Como te llaman en casa ── -->
        <ng-container *ngSwitchCase="'account'">
          <div class="account__identity">
            <button
              type="button"
              class="account__face"
              data-test="account-avatar-button"
              [attr.aria-label]="
                avatarUrl()
                  ? ('account.cambiar_la_foto_de' | t: { name: displayName() })
                  : ('account.subir_una_foto_para' | t: { name: displayName() })
              "
              (click)="openAvatarModal()"
            >
              <app-avatar
                [name]="auth.userName() || 'H'"
                [src]="avatarUrl() ?? undefined"
                size="xl"
                data-test="account-avatar"
                (imageError)="photoBroken.set(true)"
              />
              <span class="account__face-edit" data-test="account-avatar-edit" aria-hidden="true">
                <app-icon name="edit" [size]="0" />
              </span>
            </button>
            <div class="account__identity-text">
              <p class="account__identity-name">{{ auth.userName() }}</p>
              <p class="account__identity-hint">
                {{ 'account.pulsa_tu_cara_para' | t }}
              </p>
            </div>
          </div>

          <div class="account__field">
            <label class="account__label" for="account-name">{{ 'auth.name' | t }}</label>
            <input
              id="account-name"
              class="account__input"
              type="text"
              maxlength="100"
              autocomplete="name"
              [placeholder]="'account.como_te_llamas_en' | t"
              [attr.aria-describedby]="nameError() ? 'account-name-error' : null"
              data-test="account-name"
              [(ngModel)]="nameDraft"
              (ngModelChange)="onNameInput()"
            />
            <p class="account__hint">
              {{ 'account.aparece_en_el_historial' | t }}
            </p>
            <p
              class="account__error"
              *ngIf="nameError()"
              id="account-name-error"
              role="alert"
              data-test="account-name-error"
            >
              {{ nameError() }}
            </p>
            <div class="account__field-actions">
              <app-button
                variant="primary"
                size="sm"
                [loading]="savingName()"
                [disabled]="!nameDirty()"
                data-test="account-name-save"
                (onClick)="saveName()"
              >
                {{ 'account.guardar_el_nombre' | t }}
              </app-button>
              <app-button
                *ngIf="nameDirty()"
                variant="ghost"
                size="sm"
                data-test="account-name-cancel"
                (onClick)="cancelName()"
              >
                {{ 'common.cancel' | t }}
              </app-button>
            </div>
          </div>
        </ng-container>

        <!-- ── La contrasena y la sesion ── -->
        <ng-container *ngSwitchCase="'security'">
          <div class="account__field">
            <span class="account__label">{{ 'account.contrasena' | t }}</span>
            <p class="account__hint" id="account-password-hint">
              {{ 'account.seis_caracteres_como_minimo' | t }}
            </p>
            <input
              class="account__input"
              type="password"
              autocomplete="current-password"
              [placeholder]="'account.contrasena_actual' | t"
              [attr.aria-describedby]="
                passwordError()
                  ? passwordDescriptionIds.currentWithError
                  : passwordDescriptionIds.current
              "
              data-test="account-password-current"
              [(ngModel)]="passwordDraft.current"
            />
            <p class="account__hint" id="account-password-new-hint">
              {{ 'account.password_max_72_bytes_hint' | t }}
            </p>
            <input
              class="account__input"
              type="password"
              autocomplete="new-password"
              [placeholder]="'account.nueva_contrasena' | t"
              [attr.maxlength]="passwordMaxLength"
              [attr.aria-describedby]="
                passwordError() ? passwordDescriptionIds.newWithError : passwordDescriptionIds.new
              "
              data-test="account-password-new"
              [(ngModel)]="passwordDraft.fresh"
            />
            <input
              class="account__input"
              type="password"
              autocomplete="new-password"
              [placeholder]="'account.repite_la_nueva_contrasena' | t"
              [attr.maxlength]="passwordMaxLength"
              [attr.aria-describedby]="
                passwordError() ? passwordDescriptionIds.newWithError : passwordDescriptionIds.new
              "
              data-test="account-password-repeat"
              [(ngModel)]="passwordDraft.repeat"
            />
            <div class="account__strength" *ngIf="passwordDraft.fresh">
              <span
                *ngFor="let level of [1, 2, 3, 4]"
                class="account__strength-dot"
                [class.account__strength-dot--on]="passwordStrength() >= level"
              ></span>
              <span class="account__strength-text">{{ passwordStrengthLabel() }}</span>
            </div>
            <p
              class="account__error"
              *ngIf="passwordError()"
              id="account-password-error"
              role="alert"
              [appFocusError]="!!passwordError()"
              data-test="account-password-error"
            >
              {{ passwordError() }}
            </p>
            <div class="account__field-actions">
              <app-button
                variant="primary"
                size="sm"
                [loading]="savingPassword()"
                [disabled]="!passwordDirty()"
                data-test="account-password-save"
                (onClick)="savePassword()"
              >
                {{ 'account.cambiar_la_contrasena' | t }}
              </app-button>
              <app-button
                *ngIf="passwordDirty()"
                variant="ghost"
                size="sm"
                data-test="account-password-cancel"
                (onClick)="cancelPassword()"
              >
                {{ 'common.cancel' | t }}
              </app-button>
            </div>
          </div>

          <div class="account__field">
            <span class="account__label">{{ 'account.esta_sesion' | t }}</span>
            <p class="account__hint">
              {{ 'account.la_contrasena_se_guarda' | t }}
            </p>
            <div class="account__field-actions">
              <app-button
                variant="ghost"
                size="sm"
                data-test="account-logout"
                (onClick)="endSession()"
              >
                <app-icon name="logout" [size]="16" />
                {{ 'account.cerrar_sesion_en_este' | t }}
              </app-button>
            </div>
          </div>
        </ng-container>

        <!-- ── Lo que la app guarda de ti ── -->
        <ng-container *ngSwitchCase="'info'">
          <dl class="account__facts">
            <div class="account__fact">
              <dt>{{ 'account.correo' | t }}</dt>
              <dd data-test="account-email">{{ email() }}</dd>
              <p class="account__fact-note">
                {{ 'account.con_el_que_entras' | t }}
              </p>
            </div>
            <div class="account__fact">
              <dt>{{ 'auth.cookingLevel' | t }}</dt>
              <dd>
                <a
                  routerLink="/preferences?tab=profile"
                  class="account__inline-link"
                  data-test="account-level-link"
                >
                  {{ cookingLevelLabel() }}
                </a>
              </dd>
              <p class="account__fact-note">{{ 'account.cuan_larga_o_cuan' | t }}</p>
            </div>
            <div class="account__fact">
              <dt>{{ 'household_event.home' | t }}</dt>
              <dd>
                <a
                  *ngIf="householdId(); else noHousehold"
                  routerLink="/household"
                  class="account__inline-link"
                  >{{ 'account.personas_de_la_casa' | t }}</a
                >
                <ng-template #noHousehold>{{ 'account.sin_casa_solo_lo' | t }}</ng-template>
              </dd>
              <p class="account__fact-note">{{ 'account.las_listas_y_la' | t }}</p>
            </div>
            <div class="account__fact">
              <dt>{{ 'account.en_este_navegador' | t }}</dt>
              <dd data-test="account-storage">{{ storageText() }}</dd>
              <p class="account__fact-note" data-test="account-pending">{{ pendingText() }}</p>
            </div>
            <div class="account__fact">
              <dt>{{ 'account.version' | t }}</dt>
              <dd data-test="account-version">{{ version() }}</dd>
              <p class="account__fact-note">
                {{ 'account.la_hora_se_muestra_en' | t: { tz: timezone() } }}
              </p>
            </div>
            <div class="account__fact">
              <dt>{{ 'account.identificador' | t }}</dt>
              <dd class="account__mono" [title]="accountId()">{{ shortAccountId() }}</dd>
              <p class="account__fact-note">{{ 'account.para_nombrar_un_problema' | t }}</p>
            </div>
          </dl>
        </ng-container>
      </section>

      <!-- La foto, en dos pasos dentro del mismo modal: que hacer con la actual, y encuadrar la
           nueva. Dos modales apilados serian dos teclados de escape que cerrar. -->
      <app-modal
        [isOpen]="avatarModalOpen()"
        (isOpenChange)="onAvatarModalOpenChange($event)"
        [title]="
          avatarStep() === 'crop' ? ('account.encuadrar_la_foto' | t) : ('account.tu_foto' | t)
        "
        size="sm"
      >
        @if (avatarStep() === 'crop') {
          <app-avatar-editor
            [file]="pendingPhoto()"
            (cancelled)="backToChoose()"
            (applied)="onCropped($event)"
          />
          <p
            class="account__error"
            *ngIf="photoError()"
            role="alert"
            data-test="account-photo-error"
          >
            {{ photoError() }}
          </p>
        } @else {
          <div class="avatar-choose">
            <div class="avatar-choose__preview">
              <app-avatar
                [name]="auth.userName() || 'H'"
                [src]="avatarUrl() ?? undefined"
                size="xl"
                (imageError)="photoBroken.set(true)"
              />
            </div>
            <p class="avatar-choose__hint" *ngIf="!avatarUrl()">
              {{ 'account.todavia_no_tienes_foto' | t }}
            </p>
            <p class="avatar-choose__broken" *ngIf="photoBroken()" data-test="avatar-broken">
              {{ 'account.la_foto_guardada_ya' | t }}
            </p>
            <div class="avatar-choose__actions">
              <label class="account__file" for="account-photo" data-test="account-photo-label">
                <app-icon name="add_a_photo" [size]="16" />
                {{
                  avatarUrl() ? ('account.sustituir_la_foto' | t) : ('account.subir_una_foto' | t)
                }}
                <input
                  id="account-photo"
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  data-test="account-photo"
                  [disabled]="uploading()"
                  (change)="onPhotoPicked($event)"
                />
              </label>
              <app-button
                *ngIf="avatarUrl()"
                variant="ghost"
                size="sm"
                [disabled]="uploading()"
                data-test="account-photo-remove"
                (onClick)="removePhoto()"
              >
                {{ 'account.quitar_la_foto' | t }}
              </app-button>
            </div>
            <p
              class="account__error"
              *ngIf="photoError()"
              role="alert"
              data-test="account-photo-error"
            >
              {{ photoError() }}
            </p>
            <p class="avatar-choose__busy" *ngIf="uploading()">
              {{ 'account.subiendo_la_foto' | t }}
            </p>
          </div>
        }
      </app-modal>
    </div>
  `,
  styles: [
    `
      .account-page {
        padding-block: var(--container-padding);
        max-width: 720px;
        margin: 0 auto;
        display: flex;
        flex-direction: column;
        gap: var(--space-5);
      }

      .account__eyebrow {
        font-size: var(--text-xs);
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--text-tertiary);
      }
      .account__subtitle {
        margin-top: var(--space-1);
        font-size: var(--text-sm);
        color: var(--text-secondary);
        max-width: 62ch;
      }
      .account__inline-link {
        color: var(--primary);
      }

      .account__tabs {
        display: flex;
        gap: var(--space-2);
        border-bottom: 1px solid var(--border-default);
      }
      .tab {
        min-height: 44px;
        background: none;
        border: none;
        padding: var(--space-3) var(--space-4);
        font-family: var(--font-sans);
        font-size: var(--text-sm);
        font-weight: var(--font-medium);
        color: var(--text-secondary);
        cursor: pointer;
        border-bottom: 2px solid transparent;
        display: inline-flex;
        align-items: center;
        gap: var(--space-2);
        transition: var(--transition-fast);
        &:hover {
          color: var(--text-primary);
        }
        &--active {
          color: var(--primary);
          border-bottom-color: var(--primary);
        }
      }

      .account__panel {
        display: flex;
        flex-direction: column;
        gap: var(--space-5);
      }

      .account__identity {
        display: flex;
        align-items: center;
        gap: var(--space-4);
        flex-wrap: wrap;
      }
      .account__identity-name {
        font-size: var(--text-base);
        font-weight: var(--font-semibold);
        color: var(--text-primary);
      }
      .account__identity-hint {
        font-size: var(--text-xs);
        color: var(--text-secondary);
        max-width: 46ch;
      }

      /* La cara es el control: al pasar el dedo o el puntero se ve que se puede tocar. En una
         pantalla sin hover la etiqueta sale siempre, porque ahi no hay puntero que avise. */
      .account__face {
        position: relative;
        display: inline-flex;
        padding: 0;
        border: none;
        background: none;
        border-radius: var(--radius-full);
        cursor: pointer;
      }
      .account__face:focus-visible {
        outline: none;
        box-shadow: 0 0 0 2px var(--primary);
      }
      /* Solo el icono, grande y centrado. El relleno es en porcentaje del propio disco: si manana
         la cara mide 96 px, el icono no se come el borde —que es exactamente como se rompe un
         hover asi cuando alguien cambia una talla en otro sitio. */
      .account__face-edit {
        position: absolute;
        inset: 0;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        box-sizing: border-box;
        padding: 18%;
        border-radius: var(--radius-full);
        background: rgba(15, 16, 18, 0.6);
        color: var(--text-inverse);
        /* Con size = 0 el icono vale 1em: se manda desde aqui y no con un numero fijo. */
        font-size: 26px;
        opacity: 0;
        pointer-events: none;
        transform: scale(0.88);
        transition: var(--transition-fast);
      }
      .account__face-edit app-icon {
        display: block;
        max-width: 100%;
        max-height: 100%;
      }
      .account__face:hover .account__face-edit,
      .account__face:focus-visible .account__face-edit {
        opacity: 1;
        transform: scale(1);
      }
      @media (hover: none) {
        /* Sin puntero que avise, el boton se ensena solo: un cuadrado con una foto dentro no dice
           «tocable» a nadie, y aqui no hay texto que lo diga. */
        .account__face-edit {
          opacity: 1;
          background: rgba(15, 16, 18, 0.34);
        }
      }

      .avatar-choose {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: var(--space-3);
      }
      .avatar-choose__preview {
        align-self: center;
      }
      .avatar-choose__hint {
        margin: 0;
        font-size: var(--text-xs);
        color: var(--text-secondary);
      }
      .avatar-choose__broken {
        margin: 0;
        padding: var(--space-2) var(--space-3);
        border-radius: var(--radius-md);
        background: var(--warning-subtle);
        color: var(--text-primary);
        font-size: var(--text-xs);
      }
      .avatar-choose__actions {
        display: flex;
        align-items: center;
        gap: var(--space-3);
        flex-wrap: wrap;
      }
      .avatar-choose__busy {
        margin: 0;
        font-size: var(--text-xs);
        color: var(--text-tertiary);
      }
      /* El input[type=file] nativo es un boton feo con un texto largo dentro: se tapa y se pinta
         el label. Sigue enfocable, y el anillo se lo ponemos al label. */
      .account__file {
        position: relative;
        display: inline-flex;
        align-items: center;
        gap: var(--space-2);
        padding: var(--space-2) var(--space-3);
        border: 1px solid var(--border-default);
        border-radius: var(--radius-full);
        background: var(--bg-secondary);
        color: var(--text-primary);
        font-size: var(--text-sm);
        font-weight: var(--font-medium);
        cursor: pointer;
        transition: var(--transition-fast);
      }
      .account__file:hover {
        border-color: var(--primary);
        color: var(--primary);
      }
      .account__file:has(input:focus-visible) {
        outline: 2px solid var(--primary);
        outline-offset: 2px;
      }
      .account__file input {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        opacity: 0;
        cursor: pointer;
      }
      .account__file input:disabled {
        cursor: wait;
      }

      .account__field {
        display: flex;
        flex-direction: column;
        gap: var(--space-1);
        max-width: 420px;
        padding-top: var(--space-3);
        border-top: 1px solid var(--border-default);
      }
      .account__label {
        font-size: var(--text-sm);
        font-weight: var(--font-medium);
        line-height: var(--leading-normal);
        color: var(--text-primary);
      }
      .account__input {
        width: 100%;
        padding: var(--space-2) var(--space-3);
        border: 1px solid var(--border-default);
        border-radius: var(--radius-lg);
        background: var(--bg-primary);
        color: var(--text-primary);
        font-family: var(--font-sans);
        font-size: var(--text-base);
        font-weight: var(--font-normal);
        line-height: var(--leading-normal);
        transition: var(--transition-fast);
      }
      .account__input:focus {
        outline: none;
        border-color: var(--primary);
        box-shadow: 0 0 0 3px var(--primary-subtle);
      }
      .account__hint {
        font-size: var(--text-xs);
        color: var(--text-secondary);
      }
      .account__error {
        font-size: var(--text-xs);
        color: var(--error);
      }
      .account__field-actions {
        display: flex;
        align-items: center;
        gap: var(--space-2);
        flex-wrap: wrap;
      }

      /* Medidor de contrasena: cuatro puntos, sin numeritos ni porcentajes. */
      .account__strength {
        display: flex;
        align-items: center;
        gap: var(--space-1);
      }
      .account__strength-dot {
        width: 22px;
        height: 4px;
        border-radius: var(--radius-full);
        background: var(--border-default);
        transition: var(--transition-fast);
      }
      .account__strength-dot--on {
        background: var(--primary);
      }
      .account__strength-text {
        font-size: var(--text-xs);
        color: var(--text-secondary);
        margin-left: var(--space-2);
      }

      /* Los datos de la cuenta son un diccionario, no un formulario: aqui no se toca nada. */
      .account__facts {
        display: grid;
        gap: var(--space-3);
        margin: 0;
      }
      .account__fact {
        display: grid;
        grid-template-columns: minmax(120px, 30%) 1fr;
        gap: 0 var(--space-4);
        align-items: baseline;
        padding-bottom: var(--space-3);
        border-bottom: 1px solid var(--border-default);
      }
      .account__fact dt {
        font-size: var(--text-sm);
        font-weight: var(--font-semibold);
        color: var(--text-primary);
      }
      .account__fact dd {
        margin: 0;
        font-size: var(--text-sm);
        color: var(--text-secondary);
      }
      .account__fact-note {
        grid-column: 2;
        margin: 2px 0 0;
        font-size: var(--text-xs);
        color: var(--text-tertiary);
      }
      .account__mono {
        font-family: var(--font-mono);
        font-size: var(--text-xs);
      }

      @media (max-width: 560px) {
        .account__tabs {
          min-width: 0;
          max-width: 100%;
          flex-wrap: nowrap;
          overflow-x: auto;
          overflow-y: hidden;
          overscroll-behavior-inline: contain;
          scrollbar-width: thin;
        }
        .tab {
          flex: 0 0 auto;
          white-space: nowrap;
        }
        .account__fact {
          grid-template-columns: 1fr;
          gap: 2px;
        }
        .account__fact-note {
          grid-column: 1;
        }
      }
    `
  ]
})
export class AccountComponent {
  /**
   * Como se llama aqui dentro, con el «tu cuenta» de relleno ya traducido: en la plantilla no se puede
   * encadenar una pipe dentro del argumento de otra pipe, y ese limite es lo que empuja este metodo a
   * existir (y lo que hace que el texto se re-traduce solo, porque `t()` lee la senal de idioma).
   */
  displayName(): string {
    return this.auth.userName() || this.i18n.t('account.tu_cuenta');
  }
  private readonly i18n = inject(I18nService);

  /** Publico: la plantilla lee el usuario de la misma senal que el menu, no una copia. */
  readonly auth = inject(AuthService);
  private readonly shopping = inject(ShoppingService);
  private readonly toastService = inject(ToastService);

  /** Las tres secciones de la pantalla, con clave: pintar `tab.label` era pintar espanol fijo (## 12u). */
  readonly tabs: Array<{ id: AccountTab; labelKey: TranslationKey; icon: IconName }> = [
    { id: 'account', labelKey: 'account.pestanja_cuenta', icon: 'account_circle' },
    { id: 'security', labelKey: 'account.pestanja_seguridad', icon: 'settings' },
    { id: 'info', labelKey: 'account.pestanja_informacion', icon: 'description' }
  ];
  readonly activeTab = signal<AccountTab>('account');
  readonly passwordDescriptionIds = PASSWORD_DESCRIPTION_IDS;

  /** Borradores locales: nada viaja al servidor hasta pulsar el boton de su bloque. */
  nameDraft = '';
  passwordDraft = { current: '', fresh: '', repeat: '' };
  readonly uploading = signal(false);
  readonly savingName = signal(false);
  readonly savingPassword = signal(false);
  readonly photoError = signal('');
  readonly nameError = signal('');
  readonly passwordError = signal('');
  readonly passwordMaxLength = MAX_BCRYPT_PASSWORD_BYTES;
  readonly avatarUrl = signal<string | null>(null);
  /** Si la URL guardada no carga, eso es un estado que se puede arreglar: se dice, no se calla. */
  readonly photoBroken = signal(false);
  readonly avatarModalOpen = signal(false);
  /** Los dos pasos de la foto: que hacer con la actual, y encuadrar la nueva. */
  readonly avatarStep = signal<'choose' | 'crop'>('choose');
  readonly pendingPhoto = signal<File | null>(null);
  /** Si se toco el campo, ya no se pisa con lo guardado: quien escribe tiene la razon. */
  private readonly nameTouched = signal(false);

  constructor() {
    // La foto es un fichero en el servidor: la URL vive en el usuario. Y el usuario puede llegar
    // del cache o estar refrescandose justo cuando se abre la pantalla, asi que el borrador del
    // nombre y la URL del avatar se sincronizan con la senal mientras nadie haya escrito.
    effect(() => {
      if (this.nameTouched()) return;
      const user = this.auth.currentUser();
      this.nameDraft = user?.name ?? '';
      this.avatarUrl.set(user?.avatar ?? null);
      // Una foto nueva (o quitada) borra el aviso de foto rota: si no, el aviso se quedaria
      // pegado despues de arreglar justo lo que avisaba.
      this.photoBroken.set(false);
    });

    syncTabWithUrl<AccountTab>({
      param: 'tab',
      values: ACCOUNT_TABS,
      fallback: 'account',
      current: () => this.activeTab(),
      onChange: (tab) => this.activeTab.set(tab)
    });
  }

  switchTab(tab: AccountTab): void {
    this.activeTab.set(tab);
  }

  // ── La cara y el nombre ────────────────────────────────────────────────

  openAvatarModal(): void {
    this.avatarStep.set('choose');
    this.photoError.set('');
    this.avatarModalOpen.set(true);
  }

  /** El modal se cierra tambien con Escape y con el fondo: los tres caminos pasan por aqui. */
  onAvatarModalOpenChange(open: boolean): void {
    if (open) this.openAvatarModal();
    else this.closeAvatarModal();
  }

  closeAvatarModal(): void {
    this.avatarModalOpen.set(false);
    this.pendingPhoto.set(null);
    this.avatarStep.set('choose');
    this.photoError.set('');
  }

  backToChoose(): void {
    this.avatarStep.set('choose');
    this.pendingPhoto.set(null);
    this.photoError.set('');
  }

  /**
   * Elegir el archivo NO sube nada: abre el encuadre. La foto del movil enteras son 4 MB y un
   * cuadrado de 128 px son veinte kilobytes, y entre las dos esta el gesto de decir donde esta la
   * cara —que antes no existia y por eso salian frentes cortadas.
   */
  onPhotoPicked(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = ''; // el mismo fichero dos veces seguidas debe volver a disparar el change
    if (!file) return;

    const problem = avatarFileError(file);
    if (problem) {
      // El modulo puro devuelve la clave, no la frase: quien la traduce es la pantalla (12t-i18n).
      this.photoError.set(this.i18n.t(problem.clave, problem.params));
      return;
    }
    this.photoError.set('');
    this.pendingPhoto.set(file);
    this.avatarStep.set('crop');
  }

  /** Lo que emite el editor: la imagen ya recortada. Subirla es decision de esta pantalla. */
  async onCropped(dataUrl: string): Promise<void> {
    this.uploading.set(true);
    this.photoError.set('');
    try {
      const avatar = await this.auth.uploadAvatar(dataUrl).toPromise();
      this.avatarUrl.set(avatar ?? null);
      this.photoBroken.set(false);
      this.toastService.success(this.i18n.t('account.imagen_cambiada'));
      this.closeAvatarModal();
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      // Se dice el fallo sin cerrar el modal: la foto ya esta encuadrada y perder el encuadre por
      // un reintentar seria obligar a recortar otra vez.
      // El `message` del server esta escrito por el server, en su idioma, y un fallo de red no es un
      // mensaje: es «Http failure response for ...». Con el heuristic de antes salia a pantalla texto sin
      // traducir o ruido. Lo que se pinta es lo que la app sabe decir en los dos idiomas.
      if (message.includes('UPLOAD_WRITE_FAILED')) {
        this.photoError.set(this.i18n.t('account.la_imagen_ha_llegado'));
      } else if (error instanceof AvatarIssue) {
        this.photoError.set(this.i18n.t(error.clave, error.params));
      } else {
        this.photoError.set(this.i18n.t('account.no_se_pudo_subir'));
      }
    } finally {
      this.uploading.set(false);
    }
  }

  async removePhoto(): Promise<void> {
    this.uploading.set(true);
    try {
      await this.auth.removeAvatar().toPromise();
      this.avatarUrl.set(null);
      this.photoError.set('');
      this.photoBroken.set(false);
      this.toastService.success(this.i18n.t('account.imagen_quitada'));
      this.closeAvatarModal();
    } catch {
      this.photoError.set(this.i18n.t('account.no_se_pudo_quitar'));
    } finally {
      this.uploading.set(false);
    }
  }

  onNameInput(): void {
    this.nameTouched.set(true);
    this.nameError.set('');
  }

  get savedName(): string {
    return this.auth.currentUser()?.name ?? '';
  }

  nameDirty(): boolean {
    return nameDraftIsDirty(this.nameDraft, this.savedName);
  }

  saveName(): void {
    const name = this.nameDraft.trim();
    // La regla minima es la del servidor (2 caracteres); decirla aqui ahorra un viaje en balde.
    if (name.length < 2) {
      this.nameError.set(this.i18n.t('account.escribe_al_menos_dos'));
      return;
    }
    this.savingName.set(true);
    this.auth.updateProfile({ name }).subscribe({
      next: () => {
        this.savingName.set(false);
        this.nameError.set('');
        // Si se ha escrito otro nombre mientras volaba el PATCH, se conserva como borrador;
        // el effect solo resincroniza cuando ya no queda texto distinto del valor guardado.
        this.nameTouched.set(nameDraftIsDirty(this.nameDraft, this.savedName));
        this.toastService.success(this.i18n.t('account.nombre_guardado'));
      },
      error: () => {
        this.savingName.set(false);
        this.nameError.set(this.i18n.t('account.no_se_pudo_guardar'));
      }
    });
  }

  cancelName(): void {
    this.nameTouched.set(false);
    this.nameDraft = this.savedName;
    this.nameError.set('');
  }

  // ── La contrasena ──────────────────────────────────────────────────────

  passwordDirty(): boolean {
    return Boolean(
      this.passwordDraft.current || this.passwordDraft.fresh || this.passwordDraft.repeat
    );
  }

  /** La misma regla que el servidor, contada en puntos para no mandar una contrasena floja. */
  passwordStrength(): number {
    const value = this.passwordDraft.fresh;
    let score = 0;
    if (value.length >= 6) score++;
    if (value.length >= 10) score++;
    if (/[A-Z]/.test(value) && /[0-9]/.test(value)) score++;
    if (/[^A-Za-z0-9]/.test(value) || value.length >= 14) score++;
    return score;
  }

  passwordStrengthLabel(): string {
    // Cinco claves, no cinco palabras escritas: quien pinta esto es la pantalla, y la pantalla tiene idioma.
    const clave =
      PASSWORD_STRENGTH_KEYS[Math.min(this.passwordStrength(), PASSWORD_STRENGTH_KEYS.length - 1)];
    return this.i18n.t(clave);
  }

  savePassword(): void {
    const { current, fresh, repeat } = this.passwordDraft;
    if (!current) {
      this.passwordError.set(this.i18n.t('account.falta_la_contrasena_actual'));
      return;
    }
    const passwordIssue = newPasswordIssue(fresh);
    if (passwordIssue === 'tooLongBytes') {
      this.passwordError.set(this.i18n.t('account.password_max_72_bytes'));
      return;
    }
    if (passwordIssue) {
      this.passwordError.set(this.i18n.t('account.la_nueva_contrasena_necesita'));
      return;
    }
    if (fresh !== repeat) {
      this.passwordError.set(this.i18n.t('account.las_dos_contrasenas_nuevas'));
      return;
    }
    this.passwordError.set('');
    this.savingPassword.set(true);
    this.auth.changePassword(current, fresh).subscribe({
      next: () => {
        this.savingPassword.set(false);
        this.passwordError.set('');
        this.cancelPassword();
        this.toastService.success(
          this.i18n.t('account.contrasena_cambiada'),
          this.i18n.t('account.la_proxima_vez_entra')
        );
      },
      error: (error) => {
        this.savingPassword.set(false);
        this.passwordError.set(this.i18n.t(passwordChangeErrorKey(error)));
      }
    });
  }

  /** Cancelar limpia los tres campos: una contrasena no se queda escrita en la pantalla. */
  cancelPassword(): void {
    this.passwordDraft = { current: '', fresh: '', repeat: '' };
    this.passwordError.set('');
  }

  endSession(): void {
    this.auth.logout();
  }

  // ── Lo que la app guarda ───────────────────────────────────────────────

  readonly email = computed(() => this.auth.currentUser()?.email ?? '—');
  readonly accountId = computed(() => this.auth.userId());
  readonly householdId = computed(() => this.auth.currentUser()?.householdId ?? '');
  /** El nivel, con su nombre: la pantalla no imprime valores internos ni claves del diccionario. */
  readonly cookingLevelLabel = computed(() =>
    cookingLevelWord(
      this.auth.currentUser()?.cookingLevel,
      (clave) => this.i18n.t(clave),
      this.i18n.t('account.sin_nivel')
    )
  );
  readonly version = computed(() => `${environment.appName} ${environment.version}`);
  readonly timezone = computed(() => timeZoneLabel());

  /** Corto y largo: los dos extremos, porque el id entero no cabe en una linea. */
  readonly shortAccountId = computed(() => shortId(this.accountId()));

  /** Lo que la app ocupa en este navegador, contando las claves propias de verdad. */
  readonly usage = computed(() => {
    const keys: string[] = [];
    for (let index = 0; index < localStorage.length; index++) {
      const key = localStorage.key(index);
      if (key) keys.push(key);
    }
    return storageUsage(
      keys,
      (key) => localStorage.getItem(key) ?? '',
      this.shopping.pendingWrites()
    );
  });

  /** El inventario del almacenamiento, en el idioma de la app: la frase la arma el diccionario. */
  storageText(): string {
    const usage = this.usage();
    if (!usage.entries) return this.i18n.t('account.nada_guardado_en');
    return this.i18n.t('account.bytes_en_entradas', {
      bytes: formatBytes(usage.bytes),
      n: usage.entries
    });
  }

  pendingText(): string {
    const pendientes = this.shopping.pendingWrites();
    return this.i18n.t(pendingLabelKey(pendientes), { n: pendientes });
  }
}

/** Las cinco etiquetas del medidor de contrasena, por clave de diccionario (HOGARIA-SPEC ## 12v). */
const PASSWORD_STRENGTH_KEYS: readonly TranslationKey[] = [
  'account.pw_muy_corta',
  'account.pw_justa',
  'account.pw_razonable',
  'account.pw_buena',
  'account.pw_fuerte'
];
