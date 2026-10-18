import {
  afterNextRender,
  Component,
  DestroyRef,
  ElementRef,
  computed,
  effect,
  inject,
  Injector,
  OnInit,
  signal,
  ViewChild
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { CalendarService } from '../../core/services/calendar.service';
import { RouteFeatureStylesService } from '../../core/services/route-feature-styles.service';
import { RecipeService } from '../../core/services/recipe.service';
import { ToastService } from '../../core/services/toast.service';
import { ConfirmService } from '../../core/services/confirm.service';
import { TasteProfileService } from '../../core/services/taste-profile.service';
import { GOAL_OPTIONS, TasteGoal, toggleTasteGoal } from '../../shared/models/taste-profile';
import { ModalComponent } from '../../shared/components/ui/modal/modal.component';
import {
  CalendarDayView,
  CalendarRecurrenceFrequency,
  CalendarRecurrenceRule,
  CalendarMeal,
  CalendarView,
  CALENDAR_DATE_PARAM,
  CALENDAR_VIEWS,
  CALENDAR_VIEW_LABELS,
  CALENDAR_VIEW_PARAM,
  GOAL_TYPE_LABELS,
  GoalType,
  MealType,
  MEAL_ORDER,
  MEAL_TYPE_META
} from '../../shared/models/calendar.model';
import { clearTabParam, readTabParam, writeTabParam } from '../../core/utils/tab-url';
import {
  mealAnchors as anchorsFor,
  mealTimeOf,
  plannedMealTypes,
  selectedMealTypes
} from '../../core/meal-times';
import {
  addDays,
  addMonths,
  formatNumber,
  labels,
  parseISODate,
  startOfDay,
  startOfWeek,
  toISODate
} from './calendar.util';
import { CalendarMonthComponent } from './calendar-month.component';
import { CalendarTimelineComponent } from './calendar-timeline.component';
import { IconComponent } from '../../shared/components/ui/icon/icon.component';
import { AvatarComponent } from '../../shared/components/ui/avatar/avatar.component';
import {
  attendeeIdsPayload,
  inviteCandidates,
  selectedInvitees
} from '../../core/event-invitations';
import { PickerComponent, PickerOption } from '../../shared/components/ui/picker/picker.component';
import { CheckboxComponent } from '../../shared/components/ui/checkbox/checkbox.component';
import { CalendarHouseholdEventsComponent } from './calendar-household-events.component';
import { HouseholdService } from '../../core/services/household.service';
import { AiService } from '../../core/services/ai.service';
import { PantryService } from '../../core/services/pantry.service';
import { AuthService } from '../../core/services/auth.service';
import { ModulesService } from '../../core/services/modules.service';
import {
  HOUSEHOLD_EVENT_COLORS,
  HOUSEHOLD_EVENT_KINDS,
  HOUSEHOLD_EVENT_META,
  HouseholdEvent,
  HouseholdRecurrence,
  HouseholdEventKind,
  eventTimeLabel
} from '../../shared/models/calendar.model';
import { TranslatePipe } from '../../core/pipes/translate.pipe';
import { I18nService } from '../../core/services/i18n.service';
import { MEAL_LABEL_KEYS } from '../../core/i18n/labels';
import { dateLocale } from '../../core/time';
import type {
  AIGuestPreferences,
  AIReplacementCandidate
} from '../../shared/models/ai-config.model';
import { calendarViewDates, calendarViewRange, shiftCalendarAnchor } from './calendar-view.util';
import { CalendarMiniMonthComponent } from './calendar-mini-month.component';
import { CalendarYearComponent } from './calendar-year.component';
import { CalendarAgendaViewComponent } from './calendar-agenda-view.component';
import { AiParticipantsComponent } from '../../shared/components/ai-participants.component';
import { CalendarReplanComponent } from './calendar-replan.component';
import { CalendarMealCompletionComponent } from './calendar-meal-completion.component';
import { CalendarMealConsumptionComponent } from './calendar-meal-consumption.component';

interface MealDraft {
  id: string | null;
  date: string;
  mealType: MealType;
  customMeal: string;
  recipeId: string;
  time: string;
  servings: number;
  notes: string;
}

type EventRecurrencePreset =
  'none' | 'daily' | 'weekdays' | 'weekly' | 'monthly' | 'yearly' | 'custom';
type RecurrenceEndType = 'never' | 'date' | 'count';

const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const;

const emptyDraft = (date: string, mealType: MealType): MealDraft => ({
  id: null,
  date,
  mealType,
  customMeal: '',
  recipeId: '',
  time: '',
  servings: 1,
  notes: ''
});

/**
 * Calendario de hogar con vistas de día, cuatro días, semana, mes, año y agenda
 * inspirado en Google Calendar: navegación enlazable, mini-calendario, selector
 * de vistas y superficies con líneas finas donde cada comida/evento se distingue.
 *
 * Tres cosas mandan en el diseño:
 *  - **Lo que se ve es lo que hay.** La rejilla se deriva de `GET /api/calendar/range`
 *    para el rango visible; antes se pintaban huecos vacíos y las comidas
 *    guardadas no llegaban nunca a la pantalla.
 *  - **La vista y la fecha viajan en la URL** (`?view=month&date=2026-09-16`),
 *    como el resto de pestañas de la app: se puede enlazar, recargar y volver
 *    atrás. `?view=week` y la fecha de hoy se omiten para que `/calendar` siga
 *    siendo limpio.
 *  - **Atajos de teclado** (← →, T, D/S/M) para moverse sin buscar el ratón.
 */
@Component({
  selector: 'app-calendar',
  standalone: true,
  imports: [
    TranslatePipe,

    IconComponent,
    AvatarComponent,
    PickerComponent,
    CheckboxComponent,
    CalendarHouseholdEventsComponent,

    CommonModule,
    FormsModule,
    ModalComponent,
    CalendarMonthComponent,
    CalendarTimelineComponent,
    CalendarMiniMonthComponent,
    CalendarYearComponent,
    CalendarAgendaViewComponent,
    AiParticipantsComponent,
    CalendarReplanComponent,
    CalendarMealCompletionComponent,
    CalendarMealConsumptionComponent
  ],
  host: {
    '(window:keydown)': 'onKeydown($event)'
  },
  template: `
    <div class="calendar">
      <aside class="calendar__sidebar">
        <app-calendar-mini-month
          [anchorDate]="anchor()"
          [selectedDate]="anchorIso()"
          (selectDate)="jumpTo($event)"
          (shiftMonth)="shiftMiniMonth($event)"
          (goToday)="goToToday()"
        />
      </aside>
      <section class="calendar__panel">
        <!-- ══ Cabecera ══ -->
        <header class="cal-top">
          <div class="cal-top__title">
            <span class="cal-top__eyebrow">{{ 'calendar.planificacion' | t }}</span>
            <h1 class="calendar__title">{{ periodLabel() }}</h1>
          </div>

          <div class="cal-top__nav">
            <button
              type="button"
              class="cal-icon-btn"
              [attr.aria-label]="'calendar.periodo_anterior' | t"
              [attr.title]="'calendar.periodo_anterior_2' | t"
              (click)="shift(-1)"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>
            </button>
            <button
              type="button"
              class="cal-pill"
              [attr.title]="'calendar.ir_a_hoy_t' | t"
              (click)="goToToday()"
            >
              {{ 'calendar.hoy' | t }}
            </button>
            <button
              type="button"
              class="cal-icon-btn"
              [attr.aria-label]="'calendar.periodo_siguiente' | t"
              [attr.title]="'calendar.periodo_siguiente_2' | t"
              (click)="shift(1)"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7" /></svg>
            </button>

            <label class="cal-jump" [attr.title]="'calendar.ir_a_una_fecha_2' | t">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path
                  d="M7 3v2M17 3v2M4 9h16M5 5h14a1 1 0 011 1v13a1 1 0 01-1 1H5a1 1 0 01-1-1V6a1 1 0 011-1z"
                />
              </svg>
              <input
                type="date"
                [value]="anchorIso()"
                (change)="jumpTo(input.value)"
                #input
                [attr.aria-label]="'calendar.ir_a_una_fecha' | t"
              />
            </label>
          </div>

          <div class="cal-top__right">
            <app-picker
              class="cal-view-picker"
              [label]="'calendar.vista_del_calendario' | t"
              [options]="viewPickerOptions()"
              [value]="view()"
              [attr.data-view]="view()"
              [filterFrom]="99"
              data-test="calendar-view-select"
              (valueChange)="setViewFromPicker($event)"
            />

            @if (kitchen()) {
              <button
                type="button"
                class="cal-pill"
                (click)="openGoalsModal()"
                [attr.aria-label]="goalAriaLabel()"
                [attr.title]="goalAriaLabel()"
              >
                {{ 'calendar.objetivo' | t }}
                @if (goalCount() > 0) {
                  <span class="cal-goal-count" aria-hidden="true">{{ goalCount() }}</span>
                }
              </button>
              <button
                type="button"
                class="cal-btn"
                data-test="calendar-replan-open"
                (click)="openReplanModal()"
              >
                {{ 'calendar.replan_open' | t }}
              </button>
              <button type="button" class="cal-btn cal-btn--primary" (click)="openGenerateModal()">
                {{ 'calendar.planificar_ia' | t }}
              </button>
            }
            <button
              type="button"
              class="cal-pill cal-pill--add"
              data-test="event-add"
              (click)="openEventModal()"
            >
              <app-icon name="add" [size]="16" [label]="null" />
              <span>{{ 'calendar.evento' | t }}</span>
            </button>
          </div>
        </header>

        <!-- ══ Capas: que se pinta hoy en la rejilla ══ -->
        <div
          class="cal-layers"
          role="group"
          [attr.aria-label]="'calendar.que_se_muestra_en' | t"
          data-test="calendar-layers"
        >
          @if (kitchen()) {
            <button
              type="button"
              class="cal-layer"
              [class.is-on]="showMeals()"
              [attr.aria-pressed]="showMeals()"
              data-test="layer-meals"
              (click)="showMeals.set(!showMeals())"
            >
              <span class="cal-layer__dot" style="background: var(--primary)"></span>
              {{ 'calendar.comidas' | t }}
            </button>
          }
          @if (householdService.activeHouseholdId()) {
            <button
              type="button"
              class="cal-layer"
              [class.is-on]="showTasks()"
              [attr.aria-pressed]="showTasks()"
              data-test="layer-tasks"
              (click)="showTasks.set(!showTasks()); writeLayers()"
            >
              <span class="cal-layer__dot" style="background: var(--secondary)"></span>
              {{ 'calendar.household_tasks' | t }}
              @if (calendarService.tasks().length > 0) {
                <span class="cal-layer__count">{{ calendarService.tasks().length }}</span>
              }
            </button>
          }
          @for (kind of eventKinds; track kind) {
            <button
              type="button"
              class="cal-layer"
              [class.is-on]="isKindVisible(kind)"
              [attr.aria-pressed]="isKindVisible(kind)"
              [attr.data-test]="'layer-' + kind"
              (click)="toggleKind(kind)"
            >
              <span class="cal-layer__dot" [style.background]="metaOf(kind).color"></span>
              {{ metaOf(kind).labelKey | t }}
              @if (countOf(kind) > 0) {
                <span class="cal-layer__count">{{ countOf(kind) }}</span>
              }
            </button>
          }
        </div>

        <!-- ══ Resumen del periodo ══ -->
        <div class="cal-strip" [class.cal-strip--bare]="!kitchen()">
          @if (kitchen() && !calendarService.error()) {
            <div class="cal-strip__item">
              <span class="cal-strip__label">{{ 'calendar.comidas' | t }}</span>
              <span class="cal-strip__value">
                {{ plannedCount() }}<small> / {{ expectedMeals() }}</small>
              </span>
            </div>
            <div
              class="cal-strip__track"
              [title]="'calendar.planned_in' | t: { period: periodLabel() }"
            >
              <span class="cal-strip__fill" [style.width.%]="plannedPercent()"></span>
            </div>

            <div class="cal-strip__item" *ngIf="hasNutrition()">
              <span class="cal-strip__label">{{ 'calendar.energia' | t }}</span>
              <span class="cal-strip__value">
                {{ fmt(calories())
                }}<small>{{
                  'calendar.kcal_of_target' | t: { target: fmt(calendarService.targetCalories()) }
                }}</small>
              </span>
            </div>
            <div class="cal-strip__track" *ngIf="hasNutrition()">
              <span
                class="cal-strip__fill cal-strip__fill--kcal"
                [style.width.%]="caloriePercent()"
              ></span>
            </div>

            <span class="cal-strip__done" *ngIf="doneCount() > 0">
              {{ doneCount() }} {{ (doneCount() === 1 ? 'calendar.hecha' : 'calendar.hechas') | t }}
            </span>

            <span class="cal-strip__spacer"></span>

            <span class="cal-strip__hint" *ngIf="plannedCount() === 0 && !isLoading()">
              {{ 'calendar.nothing_planned' | t: { period: periodShortLabel() } }}
              <button type="button" class="cal-link" (click)="openGenerateModal()">
                {{ 'calendar.que_lo_haga_la' | t }}
              </button>
              <span aria-hidden="true">·</span>
              <button type="button" class="cal-link" (click)="openAddModal(anchorIso(), 'lunch')">
                {{ 'calendar.empezar_por_el_almuerzo' | t }}
              </button>
            </span>
          }

          <span class="cal-strip__hint" *ngIf="calendarService.error()" role="alert">
            {{ calendarService.error() }}
            <button type="button" class="cal-link" (click)="reload()">
              {{ 'calendar.reintentar' | t }}
            </button>
          </span>
        </div>

        <!-- ══ Rejilla ══ -->
        <div class="cal-body" [class.is-loading]="isLoading()" [attr.aria-busy]="isLoading()">
          <div class="cal-skeleton" *ngIf="showSkeleton()" aria-hidden="true">
            <span *ngFor="let row of [0, 1, 2]"></span>
          </div>

          <ng-container [ngSwitch]="view()" *ngIf="!showSkeleton()">
            <app-calendar-month
              *ngSwitchCase="'month'"
              [days]="days()"
              [kitchen]="kitchen()"
              [anchorIso]="anchorIso()"
              (addMeal)="openAddModal($event.date, $event.mealType)"
              (openMeal)="openEditModal($event)"
              (openDay)="openDayFor($event)"
              (editEvent)="openEventModal(undefined, $event)"
            ></app-calendar-month>

            <app-calendar-year
              *ngSwitchCase="'year'"
              [days]="days()"
              [year]="anchor().getFullYear()"
              (openDay)="openDayFor($event)"
              (openMonth)="openMonthFor($event)"
            />

            <app-calendar-agenda-view
              *ngSwitchCase="'agenda'"
              [days]="days()"
              (openDay)="openDayFor($event)"
              (openMeal)="openMealFromAgenda($event)"
              (editEvent)="openEventModal(undefined, $event)"
              (addEvent)="openEventModal({ iso: $event })"
            />

            <!-- Día, 4 días y semana comparten el timeline completo 00:00–24:00. -->
            <app-calendar-timeline
              *ngSwitchDefault
              [kitchen]="kitchen()"
              [days]="days()"
              [targetCalories]="calendarService.targetCalories()"
              [mealAnchors]="gridMealAnchors()"
              (addMeal)="onTimelineAddMeal($event)"
              (addEvent)="onTimelineAddEvent($event)"
              (openMeal)="openEditModal($event)"
              (toggleMeal)="toggleMeal($event)"
              (removeMeal)="removeMeal($event)"
              (openDay)="openDayFor($event)"
              (editEvent)="openEventModal(undefined, $event)"
            ></app-calendar-timeline>
          </ng-container>
        </div>

        <!-- ══ Agenda del día señalado ══ -->
        <!-- Un solo boton para anadir, arriba, y ya apunta al dia que se esta mirando
           (openEventModal usa anchorIso() cuando no le llega dia): dos botones de
           «anadir» a seis lineas de distancia son dos formas de preguntar lo mismo, y la
           de abajo se comia el encabezado de una seccion que va de lista en lista.
           OJO: dentro de este literal no pueden aparecer backticks, cierran el string. -->
        <section
          class="cal-agenda"
          *ngIf="view() !== 'agenda' && view() !== 'year'"
          data-test="agenda"
          [attr.aria-label]="'calendar.agenda_del_dia' | t"
        >
          <header class="cal-agenda__head">
            <div class="cal-agenda__who">
              <p class="cal-agenda__eyebrow">{{ 'calendar.agenda' | t }}</p>
              <h3 class="cal-agenda__title">{{ anchorLabel() }}</h3>
            </div>
            @if (agendaDay().isToday) {
              <span class="cal-agenda__today" data-test="agenda-today">{{
                'calendar.hoy' | t
              }}</span>
            }
            @if (agendaDay().events.length) {
              <span class="cal-agenda__count"
                >{{ agendaDay().events.length }}
                {{
                  (agendaDay().events.length === 1 ? 'calendar.plan' : 'calendar.planes') | t
                }}</span
              >
            }
          </header>

          @if (agendaDay().events.length) {
            <div class="cal-agenda__list">
              <app-calendar-household-events
                [events]="agendaDay().events"
                appearance="agenda"
                (edit)="openEventModal(undefined, $event)"
              />
            </div>
          } @else {
            <p class="cal-agenda__empty">
              <app-icon name="event_note" [size]="18" [label]="null" />
              <span>{{ 'calendar.nada_mas_apuntado_ese' | t }}</span>
              <small>{{ 'calendar.evento_arriba_lo_anade' | t }}</small>
            </p>
          }
        </section>
      </section>

      <!-- ══ Suelta de la casa ══ -->
      <app-modal
        class="calendar-event-modal"
        [isOpen]="isEventModalOpen()"
        [title]="eventDraft.id ? ('calendar.edit_event' | t) : ('calendar.new_event' | t)"
        size="md"
        (onClose)="closeEventModal()"
      >
        <div class="meal-form">
          <div class="meal-form__field meal-form__field--text cal-event-title-field">
            <label for="event-title">{{ 'calendar.event_title_label' | t }}</label>
            <input
              id="event-title"
              name="eventTitle"
              class="cal-input cal-input--text cal-input--event-title"
              maxlength="120"
              [(ngModel)]="eventDraft.title"
              data-test="event-title"
              [placeholder]="'calendar.event_title_placeholder' | t"
            />
          </div>

          <div class="cal-event-when">
            <app-icon class="cal-event-row__icon" name="schedule" [size]="20" [label]="null" />
            <div class="cal-event-when__fields">
              <label class="cal-event-date-chip" for="event-date">
                <span class="cal-event-date__full" data-test="event-date-label">{{
                  eventDateLabel()
                }}</span>
                <span class="cal-event-date__compact" aria-hidden="true">{{
                  eventDateCompactLabel()
                }}</span>
                <app-icon name="calendar_today" [size]="16" [label]="null" />
                <input
                  id="event-date"
                  name="eventDate"
                  type="date"
                  [attr.aria-label]="('calendar.dia' | t) + ': ' + eventDateLabel()"
                  [(ngModel)]="eventDraft.date"
                />
              </label>
              @if (!eventDraft.allDay) {
                <div class="meal-form__field meal-form__field--sm">
                  <label class="cal-visually-hidden" for="event-start">{{
                    'calendar.desde' | t
                  }}</label>
                  <input
                    id="event-start"
                    name="eventStart"
                    type="time"
                    class="cal-input"
                    [(ngModel)]="eventDraft.startTime"
                  />
                </div>
                <span class="cal-event-when__dash" aria-hidden="true">–</span>
                <div class="meal-form__field meal-form__field--sm">
                  <label class="cal-visually-hidden" for="event-end">{{
                    'calendar.hasta' | t
                  }}</label>
                  <input
                    id="event-end"
                    name="eventEnd"
                    type="time"
                    class="cal-input"
                    [(ngModel)]="eventDraft.endTime"
                  />
                </div>
              }
            </div>
          </div>

          <app-checkbox
            [label]="'calendar.todo_el_dia' | t"
            name="eventAllDay"
            [checked]="eventDraft.allDay"
            (checkedChange)="setAllDay($event)"
          />

          <div class="cal-event-repeat-row">
            <app-icon class="cal-event-row__icon" name="repeat" [size]="20" [label]="null" />
            <div class="meal-form__field cal-event-repeat">
              <app-picker
                [label]="'calendar.cada_cuanto' | t"
                [options]="eventRecurrenceOptions()"
                [value]="eventDraft.repeatPreset"
                [filterFrom]="99"
                [floatingPanel]="true"
                [floatingPanelMinWidth]="380"
                data-test="event-recurrence"
                (valueChange)="setRecurrence($event)"
              />
            </div>
          </div>

          <p class="cal-note" *ngIf="eventDraft.recurrence !== 'none'">
            {{ (eventDraft.id ? 'calendar.los_cambios_afectan' : 'calendar.se_repite_desde') | t }}
          </p>

          <button
            type="button"
            class="cal-event-more"
            [attr.aria-expanded]="eventMoreOptions()"
            data-test="event-more-options"
            (click)="toggleEventMoreOptions()"
          >
            {{ (eventMoreOptions() ? 'calendar.fewer_options' : 'calendar.more_options') | t }}
          </button>

          @if (eventMoreOptions()) {
            <div class="cal-event-advanced">
              <div class="meal-form__row">
                <div class="meal-form__field meal-form__field--sm">
                  <span class="cal-field-label">{{ 'calendar.tipo' | t }}</span>
                  <app-picker
                    [label]="'calendar.tipo_de_evento' | t"
                    [options]="kindOptions()"
                    [value]="eventDraft.kind"
                    [filterFrom]="99"
                    data-test="event-kind"
                    (valueChange)="setEventKind($event)"
                  />
                </div>
              </div>

              <div class="meal-form__field">
                <label>{{ 'calendar.color' | t }}</label>
                <div
                  class="cal-swatches"
                  role="group"
                  [attr.aria-label]="'calendar.color_del_evento' | t"
                >
                  @for (color of eventColors; track color) {
                    <button
                      type="button"
                      class="cal-swatch"
                      [class.is-active]="
                        (eventDraft.color ?? metaOf(eventDraft.kind).color) === color
                      "
                      [style.background]="color"
                      [attr.aria-label]="'calendar.color_value' | t: { color: color }"
                      (click)="eventDraft.color = color; eventDraft.colorTouched = true"
                    ></button>
                  }
                </div>
              </div>

              <div class="meal-form__field">
                <label for="event-place">{{ 'calendar.sitio_opcional' | t }}</label>
                <input
                  id="event-place"
                  name="eventPlace"
                  class="cal-input"
                  maxlength="120"
                  [(ngModel)]="eventDraft.location"
                  [placeholder]="'calendar.tienda_de_la_calle' | t"
                />
              </div>

              <div class="meal-form__field">
                <label for="event-notes">{{ 'calendar.notas_opcional' | t }}</label>
                <textarea
                  id="event-notes"
                  name="eventNotes"
                  class="cal-input"
                  rows="2"
                  maxlength="500"
                  [(ngModel)]="eventDraft.notes"
                ></textarea>
              </div>

              @if (hasHousehold()) {
                <app-checkbox
                  [label]="'calendar.que_lo_vea_mi' | t"
                  name="eventShared"
                  [checked]="eventDraft.sharedWithHousehold"
                  (checkedChange)="eventDraft.sharedWithHousehold = $event"
                />

                <div class="meal-form__field">
                  <label id="event-people-label">{{ 'calendar.quien_viene_opcional' | t }}</label>
                  <div
                    class="cal-people"
                    role="group"
                    aria-labelledby="event-people-label"
                    data-test="event-attendees"
                  >
                    @for (person of householdPeople(); track person.userId) {
                      <button
                        type="button"
                        class="cal-person"
                        [class.is-on]="eventDraft.attendeeIds.includes(person.userId)"
                        [attr.aria-pressed]="eventDraft.attendeeIds.includes(person.userId)"
                        (click)="toggleAttendee(person.userId)"
                      >
                        <app-avatar [name]="person.name" [src]="person.avatar" size="xs" />
                        <span>{{ person.name }}</span>
                        @if (eventDraft.attendeeIds.includes(person.userId)) {
                          <app-icon name="check" class="cal-person__check" />
                        }
                      </button>
                    }
                  </div>
                  @if (!householdPeople().length) {
                    <p class="cal-note" data-test="event-no-people">
                      {{ 'calendar.eres_la_unica_persona' | t }}
                      <button type="button" class="cal-link" (click)="openHouseholdPage()">
                        {{ 'calendar.invitar_a_alguien' | t }}
                      </button>
                    </p>
                  } @else {
                    <p class="cal-note">{{ 'calendar.solo_cambia_tu_visibilidad' | t }}</p>
                  }
                </div>
              }
            </div>
          }
          <p class="cal-note" *ngIf="calendarService.eventsError()" role="alert">
            {{ calendarService.eventsError() }}
          </p>

          <div class="meal-form__actions calendar-event-actions" data-test="event-actions">
            @if (eventDraft.id) {
              <button
                type="button"
                class="cal-btn cal-btn--ghost cal-btn--danger"
                (click)="removeEvent()"
              >
                {{ 'calendar.borrar' | t }}
              </button>
              @if (eventDraft.recurrence !== 'none') {
                <button
                  type="button"
                  class="cal-btn cal-btn--ghost"
                  data-test="event-skip-day"
                  [attr.aria-label]="'calendar.quitar_solo_este_dia' | t"
                  [title]="'calendar.quitar_solo_este_dia' | t"
                  (click)="removeOccurrence()"
                >
                  {{ 'calendar.quitar_dia' | t }}
                </button>
              }
            }
            <button type="button" class="cal-btn cal-btn--ghost" (click)="closeEventModal()">
              {{ 'common.cancel' | t }}
            </button>
            <button
              type="button"
              class="cal-btn cal-btn--primary"
              data-test="event-save"
              [disabled]="!eventDraft.title.trim() || calendarService.creatingEvent()"
              (click)="saveEvent()"
            >
              {{ (calendarService.creatingEvent() ? 'ui.guardando' : 'common.save') | t }}
            </button>
          </div>
        </div>
      </app-modal>

      <app-modal
        class="calendar-recurrence-modal"
        [isOpen]="isRecurrenceModalOpen()"
        [title]="'calendar.repeat_custom_title' | t"
        size="sm"
        (onClose)="cancelCustomRecurrence()"
      >
        <div class="recurrence-editor" data-test="custom-recurrence">
          <div class="recurrence-editor__interval">
            <label for="recurrence-interval">{{ 'calendar.repeat_every' | t }}</label>
            <input
              id="recurrence-interval"
              type="number"
              min="1"
              max="99"
              inputmode="numeric"
              [(ngModel)]="customRecurrenceDraft.interval"
              [attr.aria-label]="'calendar.repeat_interval' | t"
            />
            <app-picker
              [label]="'calendar.repeat_frequency' | t"
              [options]="recurrenceFrequencyOptions()"
              [value]="customRecurrenceDraft.frequency"
              [filterFrom]="99"
              data-test="recurrence-frequency"
              (valueChange)="setCustomFrequency($event)"
            />
          </div>

          @if (customRecurrenceDraft.frequency === 'weekly') {
            <fieldset class="recurrence-editor__days">
              <legend>{{ 'calendar.repeat_on' | t }}</legend>
              @for (weekday of recurrenceWeekdays; track weekday.value) {
                <button
                  type="button"
                  class="recurrence-editor__day"
                  [class.is-selected]="customRecurrenceDraft.weekdays?.includes(weekday.value)"
                  [attr.aria-pressed]="customRecurrenceDraft.weekdays?.includes(weekday.value)"
                  [attr.aria-label]="weekday.label"
                  (click)="toggleCustomWeekday(weekday.value)"
                >
                  {{ weekday.short }}
                </button>
              }
            </fieldset>
          }

          <fieldset class="recurrence-editor__ends">
            <legend>{{ 'calendar.repeat_ends' | t }}</legend>
            <label
              ><input
                type="radio"
                name="recurrenceEnd"
                [(ngModel)]="customEndType"
                value="never"
              />{{ 'calendar.repeat_never' | t }}</label
            >
            <label
              ><input
                type="radio"
                name="recurrenceEnd"
                [(ngModel)]="customEndType"
                value="date"
              />{{ 'calendar.repeat_end_date' | t }}</label
            >
            <input
              type="date"
              class="cal-input"
              [(ngModel)]="customEndDate"
              [min]="eventDraft.date"
              [disabled]="customEndType !== 'date'"
              [attr.aria-label]="'calendar.repeat_end_date' | t"
            />
            <label
              ><input
                type="radio"
                name="recurrenceEnd"
                [(ngModel)]="customEndType"
                value="count"
              />{{ 'calendar.repeat_after' | t }}</label
            >
            <div class="recurrence-editor__count">
              <input
                type="number"
                min="1"
                max="999"
                inputmode="numeric"
                [(ngModel)]="customEndCount"
                [disabled]="customEndType !== 'count'"
                [attr.aria-label]="'calendar.repeat_occurrences' | t"
              />
              <span>{{ 'calendar.repeat_occurrences' | t }}</span>
            </div>
          </fieldset>

          <p *ngIf="customRecurrenceError" class="cal-note" role="alert">
            {{ customRecurrenceError }}
          </p>
          <div class="meal-form__actions">
            <span class="meal-form__grow"></span>
            <button type="button" class="cal-btn cal-btn--ghost" (click)="cancelCustomRecurrence()">
              {{ 'common.cancel' | t }}
            </button>
            <button
              type="button"
              class="cal-btn cal-btn--primary"
              data-test="recurrence-done"
              (click)="applyCustomRecurrence()"
            >
              {{ 'calendar.done' | t }}
            </button>
          </div>
        </div>
      </app-modal>

      <!-- ══ Añadir / editar comida ══ -->
      <app-modal
        [isOpen]="isMealModalOpen()"
        [title]="draft.id ? ('calendar.edit_meal' | t) : ('calendar.add_meal_title' | t)"
        size="md"
        (onClose)="closeMealModal()"
      >
        <div class="meal-form">
          <div
            *ngIf="mealDeletionFailed()"
            #mealDeletionAlert
            class="meal-form__error"
            data-test="meal-deletion-error"
            role="alert"
            aria-live="assertive"
            aria-atomic="true"
            tabindex="-1"
          >
            <strong>{{ 'ui.error' | t }}</strong>
            <span>{{ 'calendar.no_se_pudo_quitar_comida' | t }}</span>
          </div>
          <div class="meal-form__when">
            <span
              class="meal-form__band"
              [attr.data-meal]="draft.mealType"
              aria-hidden="true"
            ></span>
            <strong>{{ mealLabel(draft.mealType) }}</strong>
            <span class="meal-form__date">{{ draftDateLabel() }}</span>
            <div
              class="meal-form__tabs"
              role="tablist"
              [attr.aria-label]="'calendar.origen_de_la_comida' | t"
            >
              <button
                type="button"
                role="tab"
                [class.tab]="true"
                [class.tab--active]="mealTab() === 'custom'"
                [attr.aria-selected]="mealTab() === 'custom'"
                (click)="switchAddMealTab('custom')"
              >
                {{ 'calendar.escribir' | t }}
              </button>
              <button
                type="button"
                role="tab"
                [class.tab]="true"
                [class.tab--active]="mealTab() === 'recipe'"
                [attr.aria-selected]="mealTab() === 'recipe'"
                (click)="switchAddMealTab('recipe')"
              >
                {{ 'calendar.receta' | t }}
              </button>
            </div>
          </div>

          <app-calendar-meal-completion
            *ngIf="editingMeal() as meal"
            [completed]="meal.completed"
            (toggle)="toggleMeal(meal)"
          />

          <div class="meal-form__field" *ngIf="mealTab() === 'custom'">
            <label for="meal-custom">{{ 'calendar.que_vas_a_comer' | t }}</label>
            <input
              id="meal-custom"
              type="text"
              maxlength="200"
              [(ngModel)]="draft.customMeal"
              [placeholder]="'calendar.ej_pasta_con_tomate' | t"
              class="cal-input"
            />
          </div>

          <div class="meal-form__field" *ngIf="mealTab() === 'recipe'">
            <label for="meal-recipe">{{ 'calendar.selecciona_una_receta' | t }}</label>
            <select id="meal-recipe" [(ngModel)]="draft.recipeId" class="cal-input">
              <option value="">{{ 'calendar.seleccionar' | t }}</option>
              <option *ngFor="let recipe of recipeService.recipes()" [value]="recipe.id">
                {{ recipe.name }}{{ recipe.calories ? ' · ' + recipe.calories + ' kcal' : '' }}
              </option>
            </select>
            <span class="cal-hint" *ngIf="recipeService.recipes().length === 0">
              {{ 'calendar.todavia_no_hay_recetas' | t }}
            </span>
          </div>

          <div class="meal-form__row">
            <div class="meal-form__field meal-form__field--sm">
              <label for="meal-time">{{ 'calendar.hora_opcional' | t }}</label>
              <input id="meal-time" type="time" [(ngModel)]="draft.time" class="cal-input" />
            </div>
            <div class="meal-form__field meal-form__field--sm">
              <label for="meal-servings">{{ 'calendar.raciones' | t }}</label>
              <input
                id="meal-servings"
                type="number"
                min="1"
                [(ngModel)]="draft.servings"
                class="cal-input"
              />
            </div>
          </div>

          <div class="meal-form__field">
            <label for="meal-notes">{{ 'calendar.notas_opcional' | t }}</label>
            <textarea
              id="meal-notes"
              rows="2"
              maxlength="500"
              [(ngModel)]="draft.notes"
              [placeholder]="'calendar.ej_sobras_del_dia' | t"
              class="cal-input cal-input--area"
            ></textarea>
          </div>

          <section *ngIf="draft.id" class="meal-replacement" data-test="meal-replacement">
            <button
              type="button"
              class="cal-btn"
              data-test="open-meal-replacement"
              [attr.aria-expanded]="replacementOpen()"
              (click)="toggleReplacementForm()"
            >
              {{
                (replacementOpen() ? 'calendar.replacement_close' : 'calendar.replacement_open') | t
              }}
            </button>

            <div
              *ngIf="replacementOpen()"
              class="meal-replacement__form"
              data-test="replacement-guest-form"
            >
              <p class="cal-muted">{{ 'calendar.replacement_privacy' | t }}</p>
              <app-ai-participants
                *ngIf="replacementParticipantsReady(); else replacementParticipantsLoading"
                [members]="replacementMembers()"
                [selectedMemberIds]="replacementMemberIds()"
                [guests]="replacementGuests()"
                (selectedMemberIdsChange)="updateReplacementMembers($event)"
                (guestsChange)="updateReplacementGuests($event)"
              />
              <ng-template #replacementParticipantsLoading>
                <p class="cal-muted" role="status">
                  {{ 'calendar.replacement_loading_participants' | t }}
                </p>
              </ng-template>
              <div class="meal-form__actions">
                <span class="meal-form__grow"></span>
                <button
                  type="button"
                  class="cal-btn cal-btn--primary"
                  data-test="request-meal-replacement"
                  [disabled]="isReplacingMeal() || !replacementParticipantsReady()"
                  (click)="requestMealReplacement()"
                >
                  {{
                    isReplacingMeal()
                      ? ('calendar.replacement_generating' | t)
                      : ('calendar.replacement_generate' | t)
                  }}
                </button>
              </div>
              <p *ngIf="replacementFailed()" class="meal-form__error" role="alert">
                {{ 'calendar.replacement_failed' | t }}
              </p>
              <section
                *ngIf="replacementCandidate() as candidate"
                class="meal-replacement__candidate"
                data-test="replacement-candidate"
                aria-live="polite"
              >
                <h3>{{ candidate.name }}</h3>
                <p>{{ candidate.description }}</p>
                <p class="cal-muted">
                  {{
                    'calendar.replacement_candidate_details'
                      | t
                        : {
                            ingredients: candidate.ingredients.join(', '),
                            time: candidate.estimatedTime,
                            servings: candidate.servings
                          }
                  }}
                </p>
                <p class="cal-muted">{{ 'calendar.replacement_verify_labels' | t }}</p>
                <button
                  type="button"
                  class="cal-btn cal-btn--primary"
                  data-test="apply-meal-replacement"
                  (click)="applyMealReplacement()"
                >
                  {{ 'calendar.replacement_apply' | t }}
                </button>
              </section>
            </div>
          </section>

          <div class="meal-form__actions meal-edit-actions">
            <button
              *ngIf="draft.id"
              type="button"
              class="cal-btn cal-btn--danger"
              (click)="removeMealById(draft.id)"
            >
              {{ 'common.delete' | t }}
            </button>
            <span class="meal-form__grow"></span>
            <button type="button" class="cal-btn" (click)="closeMealModal()">
              {{ 'common.cancel' | t }}
            </button>
            <button
              type="button"
              class="cal-btn cal-btn--primary"
              [disabled]="!draftValid()"
              (click)="saveMeal()"
            >
              {{ draft.id ? ('calendar.save_changes' | t) : ('ui.anadir' | t) }}
            </button>
          </div>
        </div>
      </app-modal>

      <app-calendar-meal-consumption
        *ngIf="selectedSharedMeal() as sharedMeal"
        [meal]="sharedMeal"
        [householdId]="selectedSharedMealHouseholdId() ?? ''"
        (close)="closeSharedMealConsumption()"
      />

      <!-- ══ Objetivos ══ -->
      <app-modal
        [isOpen]="isGoalsModalOpen()"
        [title]="'calendar.objetivos_nutricionales' | t"
        size="md"
        [closable]="!isSavingGoals()"
        [closeOnOverlay]="!isSavingGoals()"
        (onClose)="closeGoalsModal()"
      >
        <div class="goals-form">
          <p class="cal-muted">
            {{ 'calendar.sirven_de_punto_de' | t }}
          </p>
          <div class="goals-form__options">
            <button
              *ngFor="let goal of goalOptions"
              type="button"
              class="goal-option"
              [class.goal-option--selected]="goalsDraft.types.includes(goal.value)"
              [attr.aria-pressed]="goalsDraft.types.includes(goal.value)"
              [disabled]="isSavingGoals()"
              (click)="toggleWeeklyGoal(goal.value)"
            >
              <span class="goal-option__icon" aria-hidden="true">
                <app-icon [name]="goal.icon" [size]="18" [label]="null" />
              </span>
              <span class="goal-option__label">{{ goal.labelKey | t }}</span>
            </button>
          </div>

          <div class="meal-form__field" *ngIf="goalsDraft.types.includes('custom')">
            <label for="goals-custom">{{ 'calendar.describe_tu_objetivo' | t }}</label>
            <textarea
              id="goals-custom"
              name="weeklyCustomInstructions"
              rows="3"
              maxlength="2000"
              [(ngModel)]="goalsDraft.customInstructions"
              [placeholder]="'calendar.ej_cenas_ligeras_y' | t"
              [disabled]="isSavingGoals()"
              class="cal-input cal-input--area"
            ></textarea>
          </div>

          <div class="meal-form__field meal-form__field--sm">
            <label for="goals-calories">{{ 'calendar.calorias_diarias_objetivo' | t }}</label>
            <input
              id="goals-calories"
              type="number"
              min="800"
              max="6000"
              step="50"
              [(ngModel)]="goalsDraft.dailyCalories"
              [disabled]="isSavingGoals()"
              class="cal-input"
            />
          </div>

          <p
            *ngIf="goalsSaveError()"
            class="cal-note"
            role="alert"
            aria-live="assertive"
            data-test="goals-save-error"
          >
            {{ 'calendar.no_se_pudieron_guardar_objetivos' | t }}
          </p>

          <div class="meal-form__actions">
            <span class="meal-form__grow"></span>
            <button
              type="button"
              class="cal-btn"
              [disabled]="isSavingGoals()"
              (click)="closeGoalsModal()"
            >
              {{ 'common.cancel' | t }}
            </button>
            <button
              type="button"
              class="cal-btn cal-btn--primary"
              data-test="goals-save"
              [attr.aria-busy]="isSavingGoals()"
              [disabled]="
                isSavingGoals() ||
                !goalsDraft.types.length ||
                (goalsDraft.types.includes('custom') && !goalsDraft.customInstructions.trim())
              "
              (click)="saveGoals()"
            >
              {{
                isSavingGoals()
                  ? ('ui.guardando' | t)
                  : goalsSaveError()
                    ? ('calendar.reintentar' | t)
                    : ('common.save' | t)
              }}
            </button>
          </div>
        </div>
      </app-modal>

      <!-- ══ Planificar con IA ══ -->
      <app-modal
        [isOpen]="isGenerateModalOpen()"
        [title]="'calendar.planificar_con_ia' | t"
        size="md"
        (onClose)="closeGenerateModal()"
      >
        <div class="generate-form">
          <p class="cal-muted">
            {{ 'calendar.gen_intro' | t: { period: planWeekLabel() } }}
          </p>
          @if (caducanPronto().length > 0) {
            <p class="cal-muted cal-caduca" data-test="gen-caducidades">
              {{ 'calendar.caducan_pronto' | t: { productos: caducanPronto().join(', ') } }}
            </p>
          }

          <app-ai-participants
            [members]="householdService.household()?.members ?? []"
            [selectedMemberIds]="generateMemberIds()"
            (selectedMemberIdsChange)="generateMemberIds.set($event)"
            [guests]="generateGuests()"
            (guestsChange)="generateGuests.set($event)"
          />
          <p class="cal-hint" data-test="generate-participant-servings">
            {{ 'ai_participants.servings' | t: { number: generateServings() } }}
          </p>

          <fieldset class="meal-form__field" data-test="gen-goals">
            <legend class="meal-form__label">{{ 'calendar.objetivo' | t }}</legend>
            <p class="cal-hint">{{ 'calendar.sirven_de_punto_de' | t }}</p>
            <div class="goals-form__options">
              <button
                *ngFor="let goal of goalOptions"
                type="button"
                class="goal-option"
                [class.goal-option--selected]="generateOptions.goalTypes.includes(goal.value)"
                [attr.aria-pressed]="generateOptions.goalTypes.includes(goal.value)"
                [attr.data-test]="'generate-goal-' + goal.value"
                (click)="toggleGenerateGoal(goal.value)"
              >
                <span class="goal-option__icon" aria-hidden="true">
                  <app-icon [name]="goal.icon" [size]="18" [label]="null" />
                </span>
                <span class="goal-option__label">{{ goal.labelKey | t }}</span>
              </button>
            </div>
          </fieldset>

          <fieldset class="meal-form__field" data-test="gen-meals">
            <legend class="meal-form__label">{{ 'calendar.que_comidas_quieres_en' | t }}</legend>
            <!-- Cuatro casillas, no un desplegable de multi-seleccion: «quitar la merienda» es un click,
                 y ver las cuatro con lo que esta marcado es lo que evita pedir un dia a medias sin
                 querer. Ninguna marcada = el dia entero, y eso se dice aqui, no en un 400. -->
            <div class="goals-form__options">
              <app-checkbox
                *ngFor="let meal of mealTypesForPicker(); trackBy: trackMeal"
                [attr.data-test]="'gen-meal-' + meal"
                [label]="mealLabel(meal)"
                [checked]="generateOptions.mealTypes[meal]"
                (checkedChange)="toggleGenerateMeal(meal, $event)"
              />
            </div>
            <span class="cal-hint">
              {{ 'calendar.solo_se_pediran_y' | t }}
            </span>
            <!-- Que la IA no ofrezca una comida no puede parecer un olvido: se dice cual esta bloqueada
                 y donde se cambia, aqui mismo, que es donde se echo de menos. -->
            <span class="cal-hint" *ngIf="blockedMeals().length > 0" data-test="gen-blocked-line">
              {{ 'calendar.bloqueadas_en_preferencias' | t: { comidas: blockedMealsLabel() } }}
            </span>
          </fieldset>

          <div class="meal-form__field" *ngIf="generateOptions.goalTypes.includes('custom')">
            <label for="gen-custom">{{ 'calendar.describe_tu_objetivo' | t }}</label>
            <textarea
              id="gen-custom"
              name="customDescription"
              rows="4"
              [(ngModel)]="generateOptions.customDescription"
              [placeholder]="'calendar.ej_cenas_ligeras_y' | t"
              class="cal-input cal-input--area"
            ></textarea>
            <span class="cal-hint">
              {{ 'calendar.cuanto_mas_concreto_mejor' | t }}
            </span>
          </div>

          <div class="meal-form__field meal-form__field--sm">
            <label for="gen-calories">{{ 'calendar.calorias_diarias_opcional' | t }}</label>
            <input
              id="gen-calories"
              type="number"
              min="800"
              max="6000"
              step="50"
              [(ngModel)]="generateOptions.calories"
              class="cal-input"
            />
          </div>

          <div class="meal-form__actions">
            <span class="meal-form__grow"></span>
            <!-- Un boton apagado sin motivo es una app que no explica: el mensaje vive junto al boton. -->
            <span
              class="cal-hint"
              *ngIf="mealTypesForPicker().length === 0"
              data-test="gen-blocked-all"
            >
              {{ 'calendar.nada_que_planificar' | t }}
            </span>
            <button type="button" class="cal-btn" (click)="closeGenerateModal()">
              {{ 'common.cancel' | t }}
            </button>
            <button
              type="button"
              class="cal-btn cal-btn--primary"
              [class.cal-btn--loading]="isGenerating()"
              [attr.aria-busy]="isGenerating() ? 'true' : null"
              [attr.aria-label]="isGenerating() ? ('calendar.generating' | t) : null"
              [disabled]="
                isGenerating() || mealTypesForPicker().length === 0 || !generateGoalsReady()
              "
              (click)="generateWeeklyPlan()"
            >
              <span [class.cal-btn__loading-label--hidden]="isGenerating()">
                {{ 'calendar.generate_plan' | t }}
              </span>
              <span class="cal-spinner" *ngIf="isGenerating()" aria-hidden="true"></span>
            </button>
          </div>
        </div>
      </app-modal>

      <app-calendar-replan
        *ngIf="isReplanModalOpen()"
        [weekStart]="replanWeek().start"
        [weekEnd]="replanWeek().end"
        (closed)="closeReplanModal()"
        (applied)="onReplanApplied()"
      />
    </div>
  `,
  styles: [
    `
      :where(
        .cal-icon-btn,
        .cal-pill,
        .cal-btn,
        .cal-pill--add,
        .cal-layer,
        .cal-link,
        .cal-event-more,
        .cal-swatch,
        .cal-person,
        .recurrence-editor__day,
        .goal-option
      ):focus-visible {
        outline: 2px solid var(--primary);
        outline-offset: 2px;
      }

      .meal-replacement {
        display: grid;
        gap: var(--space-3);
      }

      .meal-replacement__form,
      .meal-replacement__candidate {
        display: grid;
        gap: var(--space-3);
      }

      .meal-replacement > .cal-btn,
      .meal-replacement__candidate > .cal-btn {
        justify-self: start;
      }

      .meal-replacement__candidate h3,
      .meal-replacement__candidate p {
        margin: 0;
      }

      .meal-replacement__candidate {
        padding: var(--space-3);
        border: 1px solid var(--border-default);
        border-radius: var(--radius-md);
        background: var(--bg-tertiary);
      }
    `
  ]
})
export class CalendarComponent implements OnInit {
  private readonly i18n = inject(I18nService);

  calendarService = inject(CalendarService);
  recipeService = inject(RecipeService);

  private readonly tasteService = inject(TasteProfileService);
  private readonly toastService = inject(ToastService);
  private readonly confirmService = inject(ConfirmService);
  private readonly authService = inject(AuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);
  private readonly routeFeatureStyles = inject(RouteFeatureStylesService);
  private readonly injector = inject(Injector);
  @ViewChild('mealDeletionAlert') private mealDeletionAlert?: ElementRef<HTMLElement>;
  readonly householdService = inject(HouseholdService);
  private readonly pantryService = inject(PantryService);
  private readonly modules = inject(ModulesService);
  private readonly aiService = inject(AiService);
  private replacementSubscription?: Subscription;

  /**
   * Si la cuenta tiene encendida «Comidas y recetas». No manda sobre la ruta —la agenda es de la
   * casa y seguiria ahi sin la cocina— sino sobre lo que hay de cocina DENTRO: la capa Comidas,
   * los anadidos de plato de las tres rejillas, la franja de energia y el planificador.
   */
  readonly kitchen = computed(() => this.modules.isEnabled('meals'));
  /** Lo que de verdad se pinta: la capa elegida Y el modulo encendido. */
  readonly mealsVisible = computed(() => this.kitchen() && this.showMeals());
  readonly tasksVisible = computed(
    () => !!this.householdService.activeHouseholdId() && this.showTasks()
  );

  readonly viewOptions = CALENDAR_VIEWS;
  readonly CALENDAR_VIEW_LABELS = CALENDAR_VIEW_LABELS;
  readonly MEAL_TYPE_META = MEAL_TYPE_META;
  readonly mealTypes = MEAL_ORDER;
  /**
   * Kcal en el locale activo de la app (`es-ES` o `en-GB`). El pipe `number` de
   * Angular sigue el LOCALE_ID del módulo, no el idioma seleccionado.
   */
  readonly fmt = formatNumber;

  /** Vista activa. `week` es la por defecto y es la única que no sale en la URL. */
  readonly view = signal<CalendarView>('week');
  /** Día de referencia: ancla la semana, el mes o el día que se ve. */
  readonly anchor = signal<Date>(startOfDay(new Date()));
  readonly viewPickerOptions = computed<PickerOption[]>(() =>
    this.viewOptions.map((view) => ({
      value: view,
      label: this.i18n.t(CALENDAR_VIEW_LABELS[view])
    }))
  );

  readonly isMealModalOpen = signal(false);
  readonly selectedSharedMeal = signal<CalendarMeal | null>(null);
  readonly selectedSharedMealHouseholdId = signal<string | null>(null);
  private readonly closeSharedMealOnHouseholdChange = effect(() => {
    const selectedMeal = this.selectedSharedMeal();
    const selectedHouseholdId = this.selectedSharedMealHouseholdId();
    const activeHouseholdId = this.householdService.activeHouseholdId();
    if (selectedMeal && selectedHouseholdId !== activeHouseholdId) {
      this.selectedSharedMeal.set(null);
      this.selectedSharedMealHouseholdId.set(null);
    }
  });
  readonly mealDeletionFailed = signal(false);
  readonly replacementOpen = signal(false);
  readonly isReplacingMeal = signal(false);
  readonly replacementFailed = signal(false);
  readonly replacementCandidate = signal<AIReplacementCandidate | null>(null);
  readonly replacementGuests = signal<AIGuestPreferences[]>([]);
  readonly replacementMemberIds = signal<string[]>([]);
  readonly replacementParticipantsReady = computed(() => {
    if (this.householdService.isLoading() || this.householdService.membershipsLoading())
      return false;
    const activeId = this.householdService.activeHouseholdId();
    const household = this.householdService.household();
    return activeId ? household?.id === activeId : household === null;
  });
  readonly replacementMembers = computed(() => {
    const activeId = this.householdService.activeHouseholdId();
    const household = this.householdService.household();
    return household?.id === activeId ? household.members.filter((member) => member.isActive) : [];
  });
  private readonly replacementObservedHouseholdId = signal<string | null | undefined>(undefined);
  private readonly replacementInitializedHouseholdId = signal<string | null | undefined>(undefined);
  private readonly replacementCandidateContext = signal<{
    householdId: string | null;
    revision: number;
  } | null>(null);
  private readonly syncReplacementHouseholdParticipants = effect(() => {
    if (!this.replacementOpen()) return;
    const activeId = this.householdService.activeHouseholdId();
    if (this.replacementObservedHouseholdId() !== activeId) {
      this.replacementObservedHouseholdId.set(activeId);
      this.replacementInitializedHouseholdId.set(undefined);
      this.replacementMemberIds.set([]);
      this.replacementGuests.set([]);
      this.replacementCandidate.set(null);
      this.replacementCandidateContext.set(null);
      this.replacementSubscription?.unsubscribe();
      this.replacementSubscription = undefined;
      this.isReplacingMeal.set(false);
      this.replacementFailed.set(false);
    }
    if (!this.replacementParticipantsReady()) return;
    if (this.replacementInitializedHouseholdId() === activeId) return;
    this.replacementInitializedHouseholdId.set(activeId);
    this.replacementMemberIds.set(this.replacementMembers().map((member) => member.id));
    this.replacementGuests.set([]);
  });
  readonly isGoalsModalOpen = signal(false);
  readonly isSavingGoals = signal(false);
  readonly goalsSaveError = signal(false);
  readonly isGenerateModalOpen = signal(false);
  readonly isGenerating = signal(false);
  readonly isReplanModalOpen = signal(false);
  readonly replanWeek = computed(() => {
    const start = startOfWeek(this.anchor());
    return { start: toISODate(start), end: toISODate(addDays(start, 6)) };
  });
  readonly generateMemberIds = signal<string[]>([]);
  readonly generateGuests = signal<AIGuestPreferences[]>([]);
  readonly generateServings = computed(() => {
    const count = this.generateMemberIds().length + this.generateGuests().length;
    if (this.householdService.household()) return count || 2;
    return Math.max(2, count + 1);
  });
  private readonly generateContextHouseholdId = signal<string | null | undefined>(undefined);
  private readonly syncGenerateHouseholdParticipants = effect(() => {
    if (!this.isGenerateModalOpen()) return;
    const householdId = this.householdService.activeHouseholdId();
    const household = this.householdService.household();
    if (householdId && household?.id !== householdId) return;
    if (this.generateContextHouseholdId() === householdId) return;
    this.generateContextHouseholdId.set(householdId);
    this.generateMemberIds.set(
      household?.members.filter((member) => member.isActive).map((member) => member.id) ?? []
    );
    this.generateGuests.set([]);
  });
  /** Pestaña del modal de comida: `?mealTab=recipe` mientras está abierto. */
  readonly mealTab = signal<'custom' | 'recipe'>('custom');
  readonly selectedGoal = signal<GoalType | null>(null);

  draft: MealDraft = emptyDraft(toISODate(new Date()), 'lunch');
  goalsDraft = {
    types: ['balanced'] as TasteGoal[],
    dailyCalories: 2000,
    customInstructions: ''
  };
  generateOptions = {
    goalTypes: ['balanced'] as TasteGoal[],
    calories: 2000,
    customDescription: '',
    /**
     * Que comidas se piden en el plan. Un mapa por clave, no una lista: lo que la plantilla pinta son
     * cuatro casillas y una lista obligaria a reconstruirla en cada click (y a perder el orden del dia).
     */
    mealTypes: { breakfast: true, lunch: true, snack: true, dinner: true } as Record<
      MealType,
      boolean
    >
  };
  readonly goalOptions = GOAL_OPTIONS;
  /**
   * Que comidas se pueden pedir (12t-T): las cuatro menos las bloqueadas en Preferencias.
   *
   * Es un `computed` sobre el signal del service, no una constante: si alguien desbloquea la merienda
   * en otra pestana, el dialog cambia solo. Y no ofrece lo bloqueado —no lo muestra desmarcado— porque
   * «no te lo ofrezco» y «te lo ofrezco apagado» son dos mensajes distintos, y el primero es el que la
   * casa eligio.
   */
  readonly allowedMeals = computed(() => plannedMealTypes(this.tasteService.mealPlan()));
  readonly blockedMeals = computed(() =>
    MEAL_ORDER.filter((type) => !this.allowedMeals().includes(type))
  );

  /**
   * ## 12ak: lo que caduca en 7 dias o menos, en orden de prisa, para avisar en el modal de
   * planificacion. La IA ya recibe el bloque completo en su prompt (servidor); esto es lo que
   * el usuario ve de eso: transparencia, no magia.
   */
  readonly caducanPronto = computed(() =>
    this.pantryService
      .caducidades()
      .filter((fila) => fila.daysLeft !== null && fila.daysLeft <= 7)
      .slice(0, 5)
      .map((fila) => fila.name)
  );
  /** Lo que recorre la plantilla del dialogo de IA: el orden del dia, sin las bloqueadas. */
  readonly mealTypesForPicker = this.allowedMeals;
  /** Color y demas meta de cada comida (la plantilla no puede importar el modelo por su cuenta). */
  readonly mealMeta = MEAL_TYPE_META;

  /**
   * Lo que se ensena de una comida, en el idioma de quien mira. La plantilla la llama por nombre porque
   * `MEAL_LABEL_KEYS[...] | t` dentro de un `@for` no tipa tanto como este getter.
   */
  mealLabel(meal: MealType): string {
    return this.i18n.t(MEAL_LABEL_KEYS[meal]);
  }

  /**
   * Las horas de la casa convertidas en minutos del dia: lo que usa la rejilla para sentar una comida
   * que no tiene hora escrita.
   *
   * Es un `computed` sobre el perfil: al cambiar el horario en Preferencias y volver atras, la rejilla se
   * recoloca sola. Y si el perfil aun no ha contestado, `mealAnchors` tira de sus anclas propias —una
   * rejilla mal colocada durante 200 ms es mejor que una medianoche con las cuatro comidas apiladas.
   */
  readonly gridMealAnchors = computed(() => anchorsFor(this.tasteService.mealTimes()));

  /** Días que se pinta cada vista, con sus comidas ya repartidas por franja. */
  readonly days = computed<CalendarDayView[]>(() => {
    const view = this.view();
    const anchor = this.anchor();
    const dates = calendarViewDates(view, anchor);
    const byDate = this.calendarService.mealsByDate();
    const tasksByDate = this.calendarService.tasksByDate();
    const monthAnchor = anchor;

    return dates.map((date) => {
      const iso = toISODate(date);
      // Apagar la capa de comidas no es esconder CSS: es no darles nada que pintar,
      // y así cada vista respeta la misma selección de capas.
      const meals = this.mealsVisible()
        ? (byDate.get(iso) ?? []).map((meal) =>
            meal.isShared
              ? { ...meal, canRecordConsumption: this.canRecordSharedMealConsumption(meal) }
              : meal
          )
        : [];
      const tasks = this.tasksVisible() ? (tasksByDate.get(iso) ?? []) : [];
      const slots = { breakfast: [], lunch: [], dinner: [], snack: [] } as Record<
        MealType,
        CalendarMeal[]
      >;
      let calories = 0;
      let hasNutrition = false;
      let done = 0;

      for (const meal of meals) {
        slots[meal.mealType].push(meal);
        if (meal.calories) {
          hasNutrition = true;
          calories += meal.calories * (meal.servings || 1);
        }
        if (meal.completed) done++;
      }

      return {
        date,
        iso,
        inCurrentMonth:
          view !== 'month' ||
          (date.getMonth() === monthAnchor.getMonth() &&
            date.getFullYear() === monthAnchor.getFullYear()),
        isToday: isSameDayAsToday(date),
        meals,
        tasks,
        slots,
        calories: Math.round(calories),
        hasNutrition,
        planned: meals.length,
        done,
        events: this.calendarService.visibleEventsOn(iso)
      };
    });
  });

  readonly singleDay = computed<CalendarDayView | null>(() => this.days()[0] ?? null);

  /** Rango inclusivo que hay que pedir para toda la vista activa. */
  /**
   * El rango visible se calcula sobre el ancla y la vista, NUNCA sobre `days()`.
   *
   * No es una preferencia estetica: `days()` incluye los eventos de casa leidos, y un
   * `effect` que pide el rango y escribe los eventos se re-ejecutaba a si mismo —cada
   * respuesta dejaba el rango "nuevo" (otra tupla) y el navegador disparaba otra peticion
   * hasta que el limitador del server cortaba la corriente (429, «demasiadas peticiones»).
   * El rango depende de lo que se mira, no de lo que se ha cargado.
   */
  readonly visibleRange = computed<[string, string]>(() => {
    return calendarViewRange(this.view(), this.anchor());
  });

  /**
   * Días que entran en las cuentas del resumen. En la vista de mes la rejilla
   * completa tiene días del mes anterior y del siguiente: contarlos hincharía el
   * denominador («4 / 168 comidas») y el progreso no cuadraría con lo que se ve.
   */
  readonly countedDays = computed(() => {
    const days = this.days();
    return this.view() === 'month' ? days.filter((day) => day.inCurrentMonth) : days;
  });

  readonly plannedCount = computed(() => sum(this.countedDays(), 'planned'));
  readonly doneCount = computed(() => sum(this.countedDays(), 'done'));
  readonly calories = computed(() => sum(this.countedDays(), 'calories'));
  readonly hasNutrition = computed(() => this.countedDays().some((day) => day.hasNutrition));

  /** Cuatro franjas por día del periodo que se está mirando. */
  readonly expectedMeals = computed(() => this.countedDays().length * MEAL_ORDER.length);

  constructor() {
    this.destroyRef.onDestroy(() => this.routeFeatureStyles.releaseStyles('calendar'));

    // La vista y la fecha forman una sola unidad de navegación. Leer la URL de
    // forma reactiva permite que Atrás/Adelante restaure ambos valores, no solo
    // que la dirección cambie mientras la pantalla se queda en el estado nuevo.
    this.route.queryParamMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
      const requestedView = params.get(CALENDAR_VIEW_PARAM);
      const nextView = (CALENDAR_VIEWS as readonly string[]).includes(requestedView ?? '')
        ? (requestedView as CalendarView)
        : 'week';
      const nextAnchor = parseISODate(params.get(CALENDAR_DATE_PARAM)) ?? startOfDay(new Date());
      this.view.set(nextView);
      if (toISODate(nextAnchor) !== toISODate(this.anchor())) this.anchor.set(nextAnchor);
    });

    effect(() => this.writeViewInUrl());

    // Cambiar de vista o de fecha => se pide exactamente el rango visible.
    effect(() => {
      const [start, end] = this.visibleRange();
      this.calendarService.loadRange(start, end);
      this.calendarService.loadHouseholdEvents(start, end);
      // Fin del bucle: si el efecto volviera a encadenarse, el guardado por ventana en el
      // servicio corta el gasto —una sola peticion por rango visible, siempre.
    });
  }

  /**
   * `?view=…&date=…`, omitiendo lo que ya es el valor por defecto (semana de
   * hoy) para que `/calendar` siga siendo la URL limpia. Un `view=bogus` se
   * descarta al leer, y aquí se limpia de la URL.
   */
  private writeViewInUrl(): void {
    const view = this.view();
    const iso = toISODate(this.anchor());
    const today = toISODate(startOfDay(new Date()));
    const isToday = iso === today;
    const targetView = view === 'week' ? null : view;
    const targetDate = isToday ? null : iso;
    const currentParams = this.route.snapshot.queryParamMap;
    const currentView = currentParams.get(CALENDAR_VIEW_PARAM);
    const currentDate = currentParams.get(CALENDAR_DATE_PARAM);

    if (currentView === targetView && currentDate === targetDate) return;

    // Entradas directas no canónicas se limpian reemplazando la URL actual;
    // los cambios iniciados por la persona sí se apilan para respetar el
    // historial del navegador.
    const parsedCurrentDate = parseISODate(currentDate);
    const replaceUrl =
      (currentView !== null &&
        (!(CALENDAR_VIEWS as readonly string[]).includes(currentView) || currentView === 'week')) ||
      (currentDate !== null && (!parsedCurrentDate || toISODate(parsedCurrentDate) === today));

    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: {
        [CALENDAR_VIEW_PARAM]: targetView,
        [CALENDAR_DATE_PARAM]: targetDate
      },
      queryParamsHandling: 'merge',
      replaceUrl
    });
  }

  ngOnInit(): void {
    this.readLayersFromUrl();
    // La casa es lo que decide si se puede invitar a alguien: sin pedirla aqui, abrir el calendario
    // directamente (enlace, recarga) dejaba el picker fuera de pantalla.
    this.householdService.ensureHousehold();
    // El recetario alimenta la pestaña «Receta» del modal (antes estaba vacío).
    this.recipeService.loadRecipes();
    this.tasteService.ensureLoaded();
  }

  /* ─────────────────────────── Etiquetas ─────────────────────────── */

  periodLabel(): string {
    const anchor = this.anchor();
    switch (this.view()) {
      case 'month':
        return labels.month(anchor);
      case 'day':
        return labels.longDay(anchor);
      case 'year':
        return String(anchor.getFullYear());
      case 'agenda': {
        const days = this.days();
        const format = new Intl.DateTimeFormat(dateLocale(), {
          day: 'numeric',
          month: 'short',
          year: 'numeric'
        });
        return `${format.format(days[0]?.date ?? anchor)} – ${format.format(days[days.length - 1]?.date ?? anchor)}`;
      }
      default: {
        const days = this.days();
        return labels.weekRange(days[0]?.date ?? anchor, days[days.length - 1]?.date ?? anchor);
      }
    }
  }

  /** Para el texto del hueco, donde «14 – 20 de septiembre» es demasiado largo. */
  periodShortLabel(): string {
    switch (this.view()) {
      case 'month':
        return labels.month(this.anchor());
      case 'day':
        return this.i18n.t('calendar.este_dia');
      case 'year':
        return String(this.anchor().getFullYear());
      case 'agenda':
        return this.i18n.t('calendar.view.agenda');
      default:
        return this.i18n.t('calendar.esta_semana');
    }
  }

  anchorIso(): string {
    return toISODate(this.anchor());
  }

  draftDateLabel(): string {
    const date = parseISODate(this.draft.date);
    return date ? labels.fullDate(date) : this.draft.date;
  }

  /** La semana que se va a planificar, no la que se esté viendo. */
  planWeekLabel(): string {
    const start = startOfWeek(this.anchor());
    return labels.weekRange(start, addDays(start, 6));
  }

  goalLabel(): string {
    return this.currentGoals()
      .map((goal) => this.i18n.t(GOAL_TYPE_LABELS[goal] ?? ('calendar.goal.custom' as never)))
      .join(' · ');
  }

  goalCount(): number {
    return this.currentGoals().length;
  }

  goalAriaLabel(): string {
    const label = this.goalLabel();
    return label
      ? `${this.i18n.t('calendar.objetivo')}: ${label}`
      : this.i18n.t('calendar.objetivo');
  }

  private currentGoals(): GoalType[] {
    const saved = this.calendarService.goals();
    if (saved?.types?.length) return saved.types;
    if (saved?.type) return [saved.type];
    if (this.selectedGoal()) return [this.selectedGoal()!];
    const legacy = this.calendarService.goalType();
    return legacy ? [legacy] : [];
  }

  plannedPercent(): number {
    const expected = this.expectedMeals();
    return expected ? Math.min(100, (this.plannedCount() / expected) * 100) : 0;
  }

  caloriePercent(): number {
    const target = this.calendarService.targetCalories();
    return target ? Math.min(100, (this.calories() / target) * 100) : 0;
  }

  isLoading(): boolean {
    return this.calendarService.isLoading();
  }

  /** La primera vez no hay nada que enseñar: esqueleto. Después, barra fina. */
  showSkeleton(): boolean {
    return (
      this.isLoading() && this.calendarService.meals().length === 0 && !this.calendarService.error()
    );
  }

  reload(): void {
    const [start, end] = this.visibleRange();
    this.calendarService.loadRange(start, end, true);
    // Forzada: `reload` es literalmente "vuelve a pedir lo mismo".
    this.calendarService.loadHouseholdEvents(start, end, true);
  }

  /* ─────────────────────── Navegación de periodos ─────────────────────── */

  setView(view: CalendarView): void {
    this.view.set(view);
  }

  setViewFromPicker(value: string | null): void {
    if ((this.viewOptions as readonly string[]).includes(String(value)))
      this.setView(value as CalendarView);
  }

  shift(direction: 1 | -1): void {
    this.anchor.set(shiftCalendarAnchor(this.view(), this.anchor(), direction));
  }

  shiftMiniMonth(direction: 1 | -1): void {
    this.anchor.set(addMonths(this.anchor(), direction));
  }

  goToToday(): void {
    this.anchor.set(startOfDay(new Date()));
  }

  jumpTo(iso: string): void {
    const date = parseISODate(iso);
    if (date) this.anchor.set(date);
  }

  /** Ver el día: desde el número de la celda o desde «+N más». */
  openDayFor(iso: string): void {
    const date = parseISODate(iso);
    if (date) this.anchor.set(date);
    this.view.set('day');
  }

  openMonthFor(iso: string): void {
    const date = parseISODate(iso);
    if (date) this.anchor.set(date);
    this.view.set('month');
  }

  openMealFromAgenda(meal: CalendarMeal): void {
    this.openEditModal(meal);
  }

  /* ─────────────────────────── Teclado ─────────────────────────── */

  /** ← → periodos · T hoy · D/4/S/M/Y/A vistas (como en Google Calendar). */
  onKeydown(event: KeyboardEvent): void {
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
    if (
      this.isMealModalOpen() ||
      this.isGoalsModalOpen() ||
      this.isGenerateModalOpen() ||
      this.isEventModalOpen() ||
      this.selectedSharedMeal() !== null
    )
      return;

    const target = event.target as HTMLElement | null;
    if (target) {
      const tag = target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable)
        return;
    }

    switch (event.key) {
      case 'ArrowLeft':
        this.shift(-1);
        break;
      case 'ArrowRight':
        this.shift(1);
        break;
      case 't':
      case 'T':
        this.goToToday();
        break;
      case 'd':
      case 'D':
        this.setView('day');
        break;
      case 's':
      case 'S':
        this.setView('week');
        break;
      case 'm':
      case 'M':
        this.setView('month');
        break;
      case '4':
        this.setView('fourDays');
        break;
      case 'y':
      case 'Y':
        this.setView('year');
        break;
      case 'a':
      case 'A':
        this.setView('agenda');
        break;
      default:
        return;
    }
    event.preventDefault();
  }

  /* ──────────────────────── Añadir / editar ──────────────────────── */

  /**
   * La rejilla de horas ya sabe la hora en la que ha caido el click: passarsela al dialog es lo que
   * hace que el eje de horas valga algo. Sin eso, la rejilla seria una lista con ejes dibujados.
   */
  onTimelineAddMeal(payload: { date: string; mealType: MealType; time?: string }): void {
    this.openAddModal(payload.date, payload.mealType, payload.time);
  }

  onTimelineAddEvent(payload: { date: string; startTime: string }): void {
    this.openEventModal({ iso: payload.date }, null, payload.startTime);
  }

  openAddModal(date: string, mealType: MealType, time?: string): void {
    this.resetReplacementState();
    this.mealDeletionFailed.set(false);
    this.draft = emptyDraft(date, mealType);
    this.draft.servings = this.householdService.defaultServings();
    // La hora es la de la casa, no una pregunta: acabamos de decir a que hora se cena, y volver a
    // pedirla por cada comida seria no haberse enterado. Se puede vaciar la casilla, y entonces la
    // comida queda «sin hora» (la rejilla la coloca en su ancla) —es un estado real, no un cero.
    this.draft.time = time ?? mealTimeOf(this.tasteService.mealTimes(), mealType);
    // Si la URL trae una pestaña válida (?mealTab=recipe) se respeta.
    readTabParam(this.route, 'mealTab', ['custom', 'recipe'] as const, 'custom', (tab) =>
      this.mealTab.set(tab)
    );
    this.isMealModalOpen.set(true);
  }

  openEditModal(meal: CalendarMeal): void {
    if (meal.isShared) {
      this.openSharedMealConsumption(meal);
      return;
    }
    this.resetReplacementState();
    this.mealDeletionFailed.set(false);
    this.draft = {
      id: meal.id,
      date: meal.date,
      mealType: meal.mealType,
      customMeal: meal.recipeId ? '' : (meal.customMeal ?? meal.title),
      recipeId: meal.recipeId ?? '',
      time: meal.time ?? '',
      servings: meal.servings || 1,
      notes: meal.notes ?? ''
    };
    this.mealTab.set(meal.recipeId ? 'recipe' : 'custom');
    this.isMealModalOpen.set(true);
  }

  private openSharedMealConsumption(meal: CalendarMeal): void {
    if (!this.canRecordSharedMealConsumption(meal)) return;
    const activeHouseholdId = this.householdService.activeHouseholdId();
    if (!activeHouseholdId) return;
    this.selectedSharedMealHouseholdId.set(activeHouseholdId);
    this.selectedSharedMeal.set(meal);
  }

  private canRecordSharedMealConsumption(meal: CalendarMeal): boolean {
    const userId = this.authService.userId();
    const activeHouseholdId = this.householdService.activeHouseholdId();
    const household = this.householdService.household();
    const member = household?.members.find((candidate) => candidate.userId === userId);
    return Boolean(
      userId &&
      activeHouseholdId &&
      household?.id === activeHouseholdId &&
      meal.participantIds?.includes(userId) &&
      member?.isActive &&
      member.permissions?.calendar?.view === true &&
      household.myPermissions?.calendar?.view === true
    );
  }

  closeSharedMealConsumption(): void {
    this.selectedSharedMeal.set(null);
    this.selectedSharedMealHouseholdId.set(null);
  }

  toggleReplacementForm(): void {
    const opening = !this.replacementOpen();
    if (opening) this.householdService.ensureHousehold();
    this.replacementOpen.set(opening);
    this.replacementFailed.set(false);
    this.replacementCandidate.set(null);
    this.replacementCandidateContext.set(null);
    if (opening && this.replacementParticipantsReady()) {
      const activeId = this.householdService.activeHouseholdId();
      this.replacementObservedHouseholdId.set(activeId);
      this.replacementInitializedHouseholdId.set(activeId);
      this.replacementMemberIds.set(this.replacementMembers().map((member) => member.id));
      this.replacementGuests.set([]);
    }
    if (!opening) {
      this.replacementGuests.set([]);
      this.replacementMemberIds.set([]);
      this.replacementObservedHouseholdId.set(undefined);
      this.replacementInitializedHouseholdId.set(undefined);
    }
  }

  updateReplacementMembers(memberIds: string[]): void {
    const allowedIds = new Set(this.replacementMembers().map((member) => member.id));
    this.replacementMemberIds.set([...new Set(memberIds)].filter((id) => allowedIds.has(id)));
  }

  updateReplacementGuests(guests: AIGuestPreferences[]): void {
    this.replacementGuests.set(
      guests.slice(0, 8).map((guest) => ({
        allergies: [...guest.allergies],
        intolerances: [...guest.intolerances],
        diets: [...guest.diets],
        likes: [...guest.likes],
        dislikes: [...guest.dislikes],
        notes: guest.notes.slice(0, 300)
      }))
    );
  }

  requestMealReplacement(): void {
    const mealId = this.draft.id;
    if (!mealId || this.isReplacingMeal()) return;
    if (!this.replacementParticipantsReady()) {
      this.replacementFailed.set(true);
      return;
    }
    const householdId = this.householdService.activeHouseholdId();
    const contextRevision = this.householdService.contextRevision();
    const allowedIds = new Set(this.replacementMembers().map((member) => member.id));
    const householdMemberIds = this.replacementMemberIds().filter((id) => allowedIds.has(id));
    const guests = this.replacementGuests().map((guest) => ({
      allergies: this.normalizeGuestValues(guest.allergies),
      intolerances: this.normalizeGuestValues(guest.intolerances),
      diets: this.normalizeGuestValues(guest.diets),
      likes: this.normalizeGuestValues(guest.likes),
      dislikes: this.normalizeGuestValues(guest.dislikes),
      notes: guest.notes.replace(/\s+/g, ' ').trim().slice(0, 300)
    }));
    this.replacementSubscription?.unsubscribe();
    this.replacementFailed.set(false);
    this.replacementCandidate.set(null);
    this.replacementCandidateContext.set(null);
    this.isReplacingMeal.set(true);
    this.replacementSubscription = this.aiService
      .replaceMeal({ mealId, householdMemberIds, guests })
      .subscribe({
        next: (candidate) => {
          this.isReplacingMeal.set(false);
          this.replacementSubscription = undefined;
          if (!this.replacementContextMatches(householdId, contextRevision)) return;
          if (!candidate) {
            this.replacementFailed.set(true);
            return;
          }
          this.replacementCandidate.set(candidate);
          this.replacementCandidateContext.set({ householdId, revision: contextRevision });
        },
        error: () => {
          this.isReplacingMeal.set(false);
          this.replacementSubscription = undefined;
          if (this.replacementContextMatches(householdId, contextRevision)) {
            this.replacementFailed.set(true);
          }
        }
      });
  }

  applyMealReplacement(): void {
    const mealId = this.draft.id;
    const candidate = this.replacementCandidate();
    const context = this.replacementCandidateContext();
    if (!mealId || !candidate || !context) return;
    if (!this.replacementContextMatches(context.householdId, context.revision)) {
      this.replacementCandidate.set(null);
      this.replacementCandidateContext.set(null);
      this.replacementFailed.set(true);
      return;
    }
    this.calendarService
      .updateMeal(mealId, { recipeId: null, customMeal: candidate.name } as never)
      .subscribe((saved) => {
        if (!this.replacementContextMatches(context.householdId, context.revision)) return;
        if (!saved) {
          this.replacementFailed.set(true);
          return;
        }
        this.toastService.success(this.i18n.t('calendar.replacement_applied'), candidate.name);
        this.closeMealModal();
      });
  }

  private resetReplacementState(): void {
    this.replacementSubscription?.unsubscribe();
    this.replacementSubscription = undefined;
    this.replacementOpen.set(false);
    this.isReplacingMeal.set(false);
    this.replacementFailed.set(false);
    this.replacementCandidate.set(null);
    this.replacementGuests.set([]);
    this.replacementMemberIds.set([]);
    this.replacementObservedHouseholdId.set(undefined);
    this.replacementInitializedHouseholdId.set(undefined);
    this.replacementCandidateContext.set(null);
  }

  private replacementContextMatches(householdId: string | null, revision: number): boolean {
    return (
      this.replacementParticipantsReady() &&
      this.householdService.activeHouseholdId() === householdId &&
      this.householdService.contextRevision() === revision
    );
  }

  private normalizeGuestValues(values: string[]): string[] {
    const unique = new Map<string, string>();
    for (const raw of values) {
      const value = raw.replace(/\s+/g, ' ').trim().slice(0, 60);
      const key = value.toLocaleLowerCase();
      if (value && !unique.has(key)) unique.set(key, value);
    }
    return [...unique.values()].slice(0, 20);
  }

  /** Cambia de pestaña y lo deja reflejado en la URL. */
  switchAddMealTab(tab: 'custom' | 'recipe'): void {
    this.mealTab.set(tab);
    writeTabParam(this.router, this.route, 'mealTab', tab, 'custom');
  }

  closeMealModal(): void {
    this.mealDeletionFailed.set(false);
    this.resetReplacementState();
    this.isMealModalOpen.set(false);
    // El modal ya no está: la pestaña deja de tener sentido en la URL.
    clearTabParam(this.router, this.route, 'mealTab');
  }

  draftValid(): boolean {
    return this.mealTab() === 'recipe' ? !!this.draft.recipeId : !!this.draft.customMeal.trim();
  }

  saveMeal(): void {
    if (!this.draftValid()) return;

    const payload = {
      date: this.draft.date,
      mealType: this.draft.mealType,
      customMeal: this.draft.customMeal.trim() || undefined,
      recipeId: this.draft.recipeId || undefined,
      time: this.draft.time || undefined,
      servings: this.draft.servings || 1,
      notes: this.draft.notes.trim() || undefined
    };

    // En el PATCH `undefined` significa «no lo toques», asi que borrar la hora exige mandar `null`
    // explicito: con `undefined` el boton de quitar era un Guardar que no guardaba nada.
    const patch: Record<string, unknown> = {
      customMeal: payload.customMeal ?? null,
      recipeId: payload.recipeId ?? null,
      time: payload.time ?? null,
      servings: payload.servings,
      notes: payload.notes ?? null
    };

    const request = this.draft.id
      ? this.calendarService.updateMeal(this.draft.id, patch as never)
      : this.calendarService.addMeal(payload);

    request.subscribe({
      next: (saved) => {
        if (!saved) {
          this.toastService.error(
            this.i18n.t('ui.error'),
            this.i18n.t('calendar.no_se_pudo_guardar')
          );
          return;
        }
        const when = parseISODate(this.draft.date);
        this.toastService.success(
          this.draft.id
            ? this.i18n.t('calendar.comida_actualizada')
            : this.i18n.t('calendar.comida_anadida'),
          `${this.i18n.t(MEAL_LABEL_KEYS[this.draft.mealType])}${when ? ' · ' + labels.longDay(when) : ''}`
        );
        this.closeMealModal();
      },
      error: () =>
        this.toastService.error(this.i18n.t('ui.error'), this.i18n.t('calendar.no_se_pudo_guardar'))
    });
  }

  /**
   * El sufijo del aviso de «generar con IA»: cuantos huecos estaban ya ocupados y se han respetado.
   * Va aparte porque el singular/plural se elige aqui, no dentro de una plantilla.
   */
  private huecosYaOcupados(skipped: number): string {
    if (!skipped) return '';
    return (
      ' · ' +
      this.i18n.t(
        skipped === 1 ? 'calendar.hueco_ocupado_uno' : 'calendar.huecos_ocupados_varios',
        { n: skipped }
      )
    );
  }

  removeMeal(meal: CalendarMeal): void {
    void this.removeMealById(meal.id, meal.title);
  }

  async removeMealById(id: string, title?: string): Promise<void> {
    // El nombre por defecto tambien se traduce: si se resolviera en la firma, el ingles llegaria tarde.
    const savedTitle = this.calendarService.meals().find((meal) => meal.id === id)?.title;
    const draftTitle =
      this.draft.id === id
        ? this.draft.customMeal.trim() ||
          this.recipeService.recipes().find((recipe) => recipe.id === this.draft.recipeId)?.name
        : undefined;
    const que = title?.trim() || savedTitle || draftTitle || this.i18n.t('calendar.esta_comida');
    const accepted = await this.confirmService.confirm({
      title: this.i18n.t('calendar.eliminar_comida'),
      message: this.i18n.t('calendar.quitar_de_la_planificacion', { title: que }),
      confirmText: this.i18n.t('common.delete')
    });
    if (!accepted) return;

    this.mealDeletionFailed.set(false);
    this.calendarService.deleteMeal(id).subscribe((removed) => {
      if (!removed) {
        this.mealDeletionFailed.set(true);
        afterNextRender(() => this.mealDeletionAlert?.nativeElement.focus(), {
          injector: this.injector
        });
        return;
      }

      this.toastService.success(
        this.i18n.t('calendar.quitada'),
        this.i18n.t('calendar.ya_no_esta_en_el', { title: que })
      );
      if (this.isMealModalOpen()) this.closeMealModal();
    });
  }

  toggleMeal(meal: CalendarMeal): void {
    this.calendarService.toggleComplete(meal);
  }

  editingMeal(): CalendarMeal | null {
    const mealId = this.draft.id;
    if (!mealId) return null;
    return this.calendarService.meals().find((meal) => meal.id === mealId) ?? null;
  }

  /* ──────────────────────────── Objetivos ──────────────────────────── */

  openGoalsModal(): void {
    const goals = this.calendarService.goals();
    this.goalsSaveError.set(false);
    this.goalsDraft = {
      types: [
        ...(goals?.types ?? (goals?.type ? [goals.type] : [this.selectedGoal() ?? 'balanced']))
      ],
      dailyCalories: goals?.dailyCalories ?? this.calendarService.targetCalories(),
      customInstructions: goals?.customInstructions ?? ''
    };
    this.isGoalsModalOpen.set(true);
  }

  toggleWeeklyGoal(goal: TasteGoal): void {
    this.goalsDraft.types = toggleTasteGoal(this.goalsDraft.types, goal);
  }

  closeGoalsModal(): void {
    if (this.isSavingGoals()) return;
    this.isGoalsModalOpen.set(false);
    this.goalsSaveError.set(false);
  }

  saveGoals(): void {
    if (
      this.isSavingGoals() ||
      this.goalsDraft.types.length === 0 ||
      (this.goalsDraft.types.includes('custom') && !this.goalsDraft.customInstructions.trim())
    )
      return;
    // Se parte de lo guardado: `PATCH /goals` reemplaza el objeto entero, así que
    // las restricciones que ya estuvieran ahí se copian en vez de borrarse.
    const previous = this.calendarService.goals();
    const selectedTypes = [...this.goalsDraft.types];
    this.isSavingGoals.set(true);
    this.goalsSaveError.set(false);
    this.calendarService
      .updateGoals(
        {
          ...previous,
          types: selectedTypes,
          customInstructions: this.goalsDraft.customInstructions.trim() || null,
          dailyCalories: Number(this.goalsDraft.dailyCalories) || undefined,
          restrictions: previous?.restrictions ?? []
        },
        toISODate(startOfWeek(this.anchor()))
      )
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.isSavingGoals.set(false);
          this.selectedGoal.set(selectedTypes[0] as GoalType);
          this.closeGoalsModal();
          this.toastService.success(
            this.i18n.t('ui.guardado'),
            this.i18n.t('calendar.objetivos_de_la_semana')
          );
        },
        error: () => {
          this.isSavingGoals.set(false);
          this.goalsSaveError.set(true);
        }
      });
  }

  /* ────────────────────────── Plan con IA ────────────────────────── */

  private tasteGoalApplied = false;

  openReplanModal(): void {
    this.householdService.ensureHousehold();
    this.isReplanModalOpen.set(true);
  }

  closeReplanModal(): void {
    this.isReplanModalOpen.set(false);
  }

  onReplanApplied(): void {
    this.isReplanModalOpen.set(false);
    this.reload();
  }

  openGenerateModal(): void {
    // ## 12ak: al planificar se mira lo que caduca. La peticion es barata (una lectura) y sin
    // ella el aviso del modal no apareceria nunca: la despensa no se pasa por aqui por defecto.
    this.pantryService.loadCaducidades();
    // Las casillas arrancan de lo que la casa dejo abierto: si la cena esta bloqueada esa casilla no
    // existe, y las demas vuelven a estar marcadas (no guardan la eleccion de la semana pasada).
    const permitidas = this.allowedMeals();
    for (const type of MEAL_ORDER) {
      this.generateOptions.mealTypes[type] = permitidas.includes(type);
    }
    this.generateContextHouseholdId.set(undefined);
    this.generateMemberIds.set([]);
    this.generateGuests.set([]);
    this.isGenerateModalOpen.set(true);
    this.applyTasteGoal();
  }

  /** Case (o descase) una comida del plan pedido. */
  toggleGenerateMeal(mealType: MealType, checked: boolean): void {
    this.generateOptions.mealTypes[mealType] = checked;
  }

  /**
   * Lo que se manda: las comidas marcadas, en el orden del dia. Si no se ha marcado ninguna se manda el
   * dia completo (ver `selectedMealTypes`), pero el «dia completo» de esta casa son **las permitidas**:
   * filtrar despues y no antes es lo que evita que «no marque nada» acabe planificando lo bloqueado.
   */
  get generateMealTypes(): MealType[] {
    const flags = this.generateOptions.mealTypes;
    const permitidas = this.allowedMeals();
    const marcadas = permitidas.filter((type) => flags[type]);
    return selectedMealTypes(marcadas.length > 0 ? marcadas : permitidas);
  }

  /** Los nombres de las comidas bloqueadas, para la linea que dice por que no estan ahi. */
  blockedMealsLabel(): string {
    const nombres = this.blockedMeals().map((type) => this.mealLabel(type));
    if (nombres.length < 2) return nombres[0] ?? '';
    return nombres.slice(0, -1).join(', ') + ' y ' + nombres[nombres.length - 1];
  }

  trackMeal(_index: number, meal: MealType): MealType {
    return meal;
  }

  /**
   * El objetivo de la configuración inicial es el punto de partida del plan.
   * Si el perfil aún no ha llegado, se aplica cuando llegue (mientras el
   * select siga sin tocar): una semana concreta puede usar otro objetivo, y
   * eso manda sobre lo guardado.
   */
  private applyTasteGoal(): void {
    if (this.tasteGoalApplied) return;

    if (!this.tasteService.isLoaded()) {
      this.tasteService
        .load()
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: () => this.applyTasteGoal(),
          error: () => undefined
        });
      return;
    }

    const { goals, goalNotes } = this.tasteService.taste();
    if (
      this.generateOptions.goalTypes.length !== 1 ||
      this.generateOptions.goalTypes[0] !== 'balanced'
    )
      return;
    this.tasteGoalApplied = true;
    this.generateOptions.goalTypes = [...(goals.length ? goals : (['balanced'] as TasteGoal[]))];
    if (
      this.generateOptions.goalTypes.includes('custom') &&
      !this.generateOptions.customDescription
    ) {
      this.generateOptions.customDescription = goalNotes;
    }
  }

  closeGenerateModal(): void {
    this.isGenerateModalOpen.set(false);
    this.generateMemberIds.set([]);
    this.generateGuests.set([]);
    this.generateContextHouseholdId.set(undefined);
  }

  toggleGenerateGoal(goal: TasteGoal): void {
    this.generateOptions.goalTypes = toggleTasteGoal(this.generateOptions.goalTypes, goal);
  }

  generateGoalsReady(): boolean {
    return (
      this.generateOptions.goalTypes.length > 0 &&
      (!this.generateOptions.goalTypes.includes('custom') ||
        this.generateOptions.customDescription.trim().length > 0)
    );
  }

  generateWeeklyPlan(): void {
    // El boton ya esta apagado en ese caso; esto es por si el bloqueo llego mientras el dialog estaba
    // abierto (la otra pestana, otro aparato). Nunca se manda una peticion que el server va a tirar.
    if (this.allowedMeals().length === 0 || !this.generateGoalsReady()) return;
    this.isGenerating.set(true);

    // La IA planifica la semana del día ancla, vea lo que se vea.
    const start = startOfWeek(this.anchor());
    const end = addDays(start, 6);

    const goals: { types: string[]; caloriesTarget?: number; customInstructions?: string } = {
      types: [...this.generateOptions.goalTypes]
    };
    const calories = Number(this.generateOptions.calories);
    if (calories > 0) goals.caloriesTarget = calories;
    if (
      this.generateOptions.goalTypes.includes('custom') &&
      this.generateOptions.customDescription.trim()
    ) {
      goals.customInstructions = this.generateOptions.customDescription.trim();
    }

    this.calendarService
      .generateWithAi({
        startDate: toISODate(start),
        endDate: toISODate(end),
        goals,
        mealTypes: this.generateMealTypes,
        householdMemberIds: this.generateMemberIds(),
        guests: this.generateGuests()
      })
      .subscribe({
        next: (data) => {
          this.isGenerating.set(false);
          const saved = data?.saved;
          if (!saved) {
            this.toastService.error(
              this.i18n.t('ui.error'),
              this.i18n.t('calendar.la_ia_no_devolvio')
            );
            return;
          }
          this.reload();
          this.closeGenerateModal();
          this.toastService.success(
            this.i18n.t('calendar.plan_guardado'),
            saved.created
              ? this.i18n.t(
                  saved.created === 1
                    ? 'calendar.comidas_generadas_uno'
                    : 'calendar.comidas_generadas_varios',
                  { n: saved.created }
                ) + this.huecosYaOcupados(saved.skipped)
              : this.i18n.t('calendar.la_semana_ya_estaba')
          );
        },
        error: (err) => {
          this.isGenerating.set(false);
          if (err?.original?.error?.code === 'MEAL_PLAN_ALL_BLOCKED') {
            // El server dijo «no hay nada que planificar» porque las comidas se bloquearon mientras
            // tanto: se refresca el estado para que el dialog se pinte con la verdad, y el aviso sale
            // del diccionario en vez de la frase que escribio el server.
            this.tasteService.load().subscribe({ error: () => undefined });
            this.toastService.warning(
              this.i18n.t('calendar.no_se_pudo_generar'),
              this.i18n.t('calendar.bloqueo_a_medio')
            );
            return;
          }
          this.toastService.error(
            this.i18n.t('ui.error'),
            this.i18n.t('calendar.no_se_pudo_generar')
          );
        }
      });
  }
  // ----------------------------------------------- eventos de la casa (§8f)

  readonly showMeals = signal(true);
  readonly showTasks = signal(true);
  readonly eventKinds = HOUSEHOLD_EVENT_KINDS;
  readonly eventColors = HOUSEHOLD_EVENT_COLORS;
  readonly isEventModalOpen = signal(false);
  readonly isRecurrenceModalOpen = signal(false);
  readonly eventMoreOptions = signal(false);
  customRecurrenceDraft: CalendarRecurrenceRule = {
    frequency: 'weekly',
    interval: 1,
    weekdays: [1],
    end: { type: 'never' }
  };
  customEndType: RecurrenceEndType = 'never';
  customEndDate = '';
  customEndCount = 13;
  customRecurrenceError = '';
  private presetBeforeCustom: EventRecurrencePreset = 'none';
  readonly recurrenceWeekdays = WEEKDAYS.map((value) => {
    const date = new Date(2024, 0, value);
    return {
      value,
      short: new Intl.DateTimeFormat(dateLocale(), { weekday: 'narrow' }).format(date),
      // La forma estrecha es visual; el nombre accesible debe identificar el día completo.
      label: new Intl.DateTimeFormat(dateLocale(), { weekday: 'long' }).format(date)
    };
  });
  eventDraft: {
    id?: string;
    title: string;
    kind: HouseholdEventKind;
    date: string;
    allDay: boolean;
    startTime: string;
    endTime: string;
    color: string | null;
    location: string;
    notes: string;
    sharedWithHousehold: boolean;
    colorTouched?: boolean;
    /**
     * Quien esta invitado. Es una lista de ids de usuario, no de nombres: si se guardase el nombre,
     * una Renata que cambie de apellido seguiria invitada a la cena de hace un ano.
     */
    attendeeIds: string[];
    /** Cada cuanto se repite (HOGARIA-SPEC 12t-R). `none` es un dia suelto, como toda la vida. */
    recurrence: HouseholdRecurrence;
    repeatPreset: EventRecurrencePreset;
    recurrenceRule: CalendarRecurrenceRule | null;
    /** El dia que define la serie. Al abrir un martes cualquiera sigue siendo el de inicio: si no, cambiar el titulo le moveria el ancla. */
    seriesDate?: string;
    /** El dia sobre el que se hizo clic. Es el que se quita con «solo este dia no». */
    occurrenceDate?: string;
    /** Si lo escribio esta cuenta. Con `false` el modal no abre: abre la salida. */
    editable?: boolean;
  } = {
    title: '',
    kind: 'other',
    date: '',
    allDay: false,
    startTime: '',
    endTime: '',
    color: null,
    location: '',
    notes: '',
    sharedWithHousehold: true,
    attendeeIds: [],
    recurrence: 'none',
    repeatPreset: 'none',
    recurrenceRule: null,
    editable: true
  };

  metaOf(kind: HouseholdEventKind) {
    return HOUSEHOLD_EVENT_META[kind];
  }

  isKindVisible(kind: HouseholdEventKind): boolean {
    return this.calendarService.visibleKinds().includes(kind);
  }

  /** Opciones del selector de tipo: reutiliza el META, que es de donde sale el color. */
  readonly kindOptions = computed<PickerOption[]>(() =>
    HOUSEHOLD_EVENT_KINDS.map((kind) => ({
      value: kind,
      // El picker pinta `label`: aqui si que hay que traducir, porque es texto de la interfaz y no dato.
      label: this.i18n.t(HOUSEHOLD_EVENT_META[kind].labelKey),
      color: HOUSEHOLD_EVENT_META[kind].color
    }))
  );

  setEventKind(value: string | null): void {
    const kind = (HOUSEHOLD_EVENT_KINDS as readonly string[]).includes(String(value))
      ? (value as HouseholdEventKind)
      : 'other';
    this.eventDraft.kind = kind;
    // El color sigue al tipo salvo que la persona haya elegido uno a mano: asi «Citas»
    // sale en rojo sin tener que explicarlo, y lo que se toco a mano se respeta.
    if (!this.eventDraft.colorTouched) this.eventDraft.color = null;
  }

  protected eventDateLabel(): string {
    const date = parseISODate(this.eventDraft.date);
    return date
      ? new Intl.DateTimeFormat(dateLocale(), {
          weekday: 'long',
          day: 'numeric',
          month: 'long'
        }).format(date)
      : this.eventDraft.date;
  }

  protected eventDateCompactLabel(): string {
    const date = parseISODate(this.eventDraft.date);
    return date
      ? new Intl.DateTimeFormat(dateLocale(), { weekday: 'short', day: 'numeric', month: 'short' })
          .format(date)
          .replace(/\./g, '')
      : this.eventDraft.date;
  }

  eventRecurrenceOptions(): PickerOption[] {
    const date = parseISODate(this.eventDraft.date) ?? this.anchor();
    const weekday = new Intl.DateTimeFormat(dateLocale(), { weekday: 'long' }).format(date);
    const monthDay = String(date.getDate());
    const dateLabel = new Intl.DateTimeFormat(dateLocale(), {
      day: 'numeric',
      month: 'long'
    }).format(date);
    return [
      { value: 'none', label: this.i18n.t('calendar.no_se_repite') },
      { value: 'daily', label: this.i18n.t('calendar.todos_los_dias') },
      { value: 'weekdays', label: this.i18n.t('calendar.repeat_weekdays') },
      { value: 'weekly', label: this.i18n.t('calendar.repeat_weekly_on', { day: weekday }) },
      { value: 'monthly', label: this.i18n.t('calendar.repeat_monthly_on', { day: monthDay }) },
      { value: 'yearly', label: this.i18n.t('calendar.repeat_yearly_on', { date: dateLabel }) },
      { value: 'custom', label: this.i18n.t('calendar.repeat_custom') }
    ];
  }

  readonly recurrenceFrequencyOptions = computed<PickerOption[]>(() => [
    { value: 'daily', label: this.i18n.t('calendar.repeat.frequency.daily') },
    { value: 'weekly', label: this.i18n.t('calendar.repeat.frequency.weekly') },
    { value: 'monthly', label: this.i18n.t('calendar.repeat.frequency.monthly') },
    { value: 'yearly', label: this.i18n.t('calendar.repeat.frequency.yearly') }
  ]);

  /** El selector repite lo previsible con un toque y abre el diálogo solo para reglas avanzadas. */
  setRecurrence(value: string | null): void {
    const preset = value as EventRecurrencePreset | null;
    if (preset === 'custom') {
      this.presetBeforeCustom = this.eventDraft.repeatPreset;
      this.openCustomRecurrence();
      return;
    }
    if (!preset || !['none', 'daily', 'weekdays', 'weekly', 'monthly', 'yearly'].includes(preset))
      return;

    this.eventDraft.repeatPreset = preset;
    this.eventDraft.recurrenceRule = null;
    if (preset === 'none') {
      this.eventDraft.recurrence = 'none';
    } else if (preset === 'daily') {
      this.eventDraft.recurrence = 'daily';
    } else if (preset === 'weekly') {
      this.eventDraft.recurrence = 'weekly';
    } else {
      this.eventDraft.recurrence = 'weekly';
      this.eventDraft.recurrenceRule = {
        frequency: preset === 'weekdays' ? 'weekly' : preset,
        interval: 1,
        ...(preset === 'weekdays' ? { weekdays: [1, 2, 3, 4, 5] } : {}),
        end: { type: 'never' }
      };
    }
  }

  private openCustomRecurrence(): void {
    const existing = this.eventDraft.recurrenceRule;
    const defaultRule = this.defaultRecurrenceRule(
      this.eventDraft.date,
      this.eventDraft.repeatPreset
    );
    this.customRecurrenceDraft = existing
      ? {
          ...existing,
          weekdays: existing.weekdays ? [...existing.weekdays] : undefined,
          end: { ...existing.end }
        }
      : defaultRule;
    const end = this.customRecurrenceDraft.end;
    this.customEndType = end.type;
    this.customEndDate = end.type === 'date' ? end.date : this.eventDraft.date;
    this.customEndCount = end.type === 'count' ? end.count : 13;
    this.customRecurrenceError = '';
    this.eventDraft.repeatPreset = 'custom';
    this.isRecurrenceModalOpen.set(true);
  }

  private defaultRecurrenceRule(
    dateIso: string,
    preset: EventRecurrencePreset = 'custom'
  ): CalendarRecurrenceRule {
    const date = parseISODate(dateIso) ?? this.anchor();
    const weekday = ((date.getDay() + 6) % 7) + 1;
    const frequency: CalendarRecurrenceFrequency =
      preset === 'daily'
        ? 'daily'
        : preset === 'monthly'
          ? 'monthly'
          : preset === 'yearly'
            ? 'yearly'
            : 'weekly';
    const weekdays = preset === 'weekdays' ? [1, 2, 3, 4, 5] : [weekday];
    return {
      frequency,
      interval: 1,
      ...(frequency === 'weekly' ? { weekdays } : {}),
      end: { type: 'never' }
    };
  }

  setCustomFrequency(value: string | null): void {
    if (!(['daily', 'weekly', 'monthly', 'yearly'] as string[]).includes(String(value))) return;
    const frequency = value as CalendarRecurrenceFrequency;
    const currentWeekdays = this.customRecurrenceDraft.weekdays;
    this.customRecurrenceDraft = {
      ...this.customRecurrenceDraft,
      frequency,
      weekdays:
        frequency === 'weekly'
          ? currentWeekdays?.length
            ? currentWeekdays
            : this.defaultRecurrenceRule(this.eventDraft.date).weekdays
          : undefined
    };
    this.customRecurrenceError = '';
  }

  toggleCustomWeekday(weekday: number): void {
    const selected = this.customRecurrenceDraft.weekdays ?? [];
    this.customRecurrenceDraft = {
      ...this.customRecurrenceDraft,
      weekdays: selected.includes(weekday)
        ? selected.filter((day) => day !== weekday)
        : [...selected, weekday].sort((a, b) => a - b)
    };
    this.customRecurrenceError = '';
  }

  cancelCustomRecurrence(): void {
    this.isRecurrenceModalOpen.set(false);
    this.eventDraft.repeatPreset = this.presetBeforeCustom;
  }

  applyCustomRecurrence(): void {
    const interval = Number(this.customRecurrenceDraft.interval);
    const weekdays = this.customRecurrenceDraft.weekdays;
    const invalidInterval = !Number.isInteger(interval) || interval < 1 || interval > 99;
    const invalidWeekdays = this.customRecurrenceDraft.frequency === 'weekly' && !weekdays?.length;
    const endDate = parseISODate(this.customEndDate);
    const startDate = parseISODate(this.eventDraft.date);
    const invalidEnd =
      (this.customEndType === 'date' && (!endDate || !startDate || endDate < startDate)) ||
      (this.customEndType === 'count' &&
        (!Number.isInteger(this.customEndCount) ||
          this.customEndCount < 1 ||
          this.customEndCount > 999));
    if (invalidInterval || invalidWeekdays || invalidEnd) {
      this.customRecurrenceError = this.i18n.t('calendar.repeat_invalid');
      return;
    }

    const end =
      this.customEndType === 'date'
        ? { type: 'date' as const, date: this.customEndDate }
        : this.customEndType === 'count'
          ? { type: 'count' as const, count: Number(this.customEndCount) }
          : { type: 'never' as const };
    this.eventDraft.recurrenceRule = {
      ...this.customRecurrenceDraft,
      interval,
      ...(this.customRecurrenceDraft.frequency === 'weekly'
        ? { weekdays: [...(weekdays ?? [])] }
        : { weekdays: undefined }),
      end
    };
    this.eventDraft.recurrence =
      this.customRecurrenceDraft.frequency === 'daily' ? 'daily' : 'weekly';
    this.eventDraft.repeatPreset = 'custom';
    this.isRecurrenceModalOpen.set(false);
  }

  toggleEventMoreOptions(): void {
    this.eventMoreOptions.update((expanded) => !expanded);
  }

  setAllDay(value: boolean): void {
    this.eventDraft.allDay = value;
    if (value) {
      this.eventDraft.startTime = '';
      this.eventDraft.endTime = '';
    }
  }

  toggleKind(kind: HouseholdEventKind): void {
    this.calendarService.toggleKind(kind);
    this.writeLayers();
  }

  /**
   * Las capas van en la URL (`?layers=home,shopping`): compartir «el calendario sin las
   * comidas» es mandar un enlace, y volver atras desde una cita no te cambia lo que estabas
   * mirando. Con todas activas no se escribe nada, para no ensuciar la URL limpia.
   */
  writeLayers(): void {
    const all = HOUSEHOLD_EVENT_KINDS;
    const visible = this.calendarService.visibleKinds();
    // `mealsVisible`, no `showMeals`: con la cocina apagada no se escribe `meals` en la URL, que
    // seria re-anadir por enlace lo que la cuenta acaba de apagar —y dejar un enlace que miente.
    const allLayersVisible =
      visible.length === all.length && this.mealsVisible() && this.tasksVisible();
    const params: Record<string, string | null> = {
      layers: allLayersVisible
        ? null
        : [
            ...(this.mealsVisible() ? ['meals'] : []),
            ...(this.tasksVisible() ? ['tasks'] : []),
            ...visible
          ].join(',')
    };
    void this.router.navigate([], {
      queryParams: params,
      queryParamsHandling: 'merge',
      replaceUrl: true
    });
  }

  readLayersFromUrl(): void {
    const raw = new URLSearchParams(window.location.search).get('layers');
    if (!raw) return;
    const wanted = raw
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean);
    // Se respeta lo que pide el enlace... si la cuenta tiene cocina. Si no, `meals` se ignora:
    // no es un error, y no se escribe de vuelta (arriba se usa `mealsVisible`).
    this.showMeals.set(this.kitchen() && wanted.includes('meals'));
    this.showTasks.set(wanted.includes('tasks'));
    const kinds = wanted.filter((entry): entry is HouseholdEventKind =>
      (HOUSEHOLD_EVENT_KINDS as readonly string[]).includes(entry)
    );
    // `layers=meals` (sin eventos de casa) es legitimo: significa "solo la comida".
    this.calendarService.visibleKinds.set(kinds);
  }

  countOf(kind: HouseholdEventKind): number {
    return this.calendarService.householdEvents().filter((event) => event.kind === kind).length;
  }

  /** La casilla «que lo vea mi casa» solo tiene sentido si hay casa. */
  hasHousehold(): boolean {
    return !!this.householdService.household();
  }

  openEventModal(
    day?: { iso?: string; date?: string },
    event?: HouseholdEvent | null,
    /** La hora pulsada en la rejilla. `''` es «todo el día», que es la banda de arriba. */
    startTime?: string
  ): void {
    const iso = event?.date ?? day?.iso ?? day?.date ?? this.anchorIso();
    // El campo del dia es el de la SERIE, no el del dia pulsado: editar una ocurrencia edita la serie
    // (12t-R), y escribir aqui el dia pulsado convertia un cambio de titulo en un cambio de martes.
    const serie = event?.seriesDate ?? iso;
    if (event && event.editable === false) {
      // No es un «no tienes permiso» seco: lo que esa persona quiere hacer aqui es salirse, y eso si
      // puede hacerlo. Abrir un formulario de solo lectura seria enseñarle campos que no puede tocar.
      void this.leaveEvent(event);
      return;
    }
    const recurrence = event?.recurrence ?? 'none';
    const recurrenceRule = event?.recurrenceRule ?? null;
    this.eventDraft = {
      id: event?.id,
      title: event?.title ?? '',
      kind: (event?.kind ?? 'other') as HouseholdEventKind,
      date: serie,
      allDay: event?.allDay ?? startTime === '',
      startTime: event?.startTime ?? (startTime || ''),
      endTime: event?.endTime ?? '',
      color: event?.color ?? null,
      location: event?.location ?? '',
      notes: event?.notes ?? '',
      sharedWithHousehold: event ? true : true,
      attendeeIds: selectedInvitees(event),
      recurrence,
      repeatPreset: this.presetForEvent(recurrence, recurrenceRule, serie),
      recurrenceRule,
      seriesDate: serie,
      occurrenceDate: event ? iso : undefined,
      editable: event?.editable ?? true
    };
    // El picker solo existe si la casa estaba cargada al abrir. Guardar sin esa marca NO manda lista:
    // `attendeeIds: []` es «que no quede nadie», y eso no lo puede decidir un renderido a medias.
    this.eventAttendeesShown = this.hasHousehold();
    this.eventMoreOptions.set(!!event);
    this.isRecurrenceModalOpen.set(false);
    this.calendarService.eventsError.set(null);
    this.isEventModalOpen.set(true);
  }

  private presetForEvent(
    recurrence: HouseholdRecurrence,
    rule: CalendarRecurrenceRule | null,
    date: string
  ): EventRecurrencePreset {
    if (!rule) return recurrence;
    if (rule.end.type === 'never' && rule.interval === 1) {
      if (rule.frequency === 'daily') return 'daily';
      if (rule.frequency === 'weekly') {
        const selected = [...(rule.weekdays ?? [])].sort((a, b) => a - b);
        if (selected.join(',') === '1,2,3,4,5') return 'weekdays';
        const parsed = parseISODate(date);
        const anchorWeekday = parsed ? ((parsed.getDay() + 6) % 7) + 1 : 0;
        if (selected.length === 1 && selected[0] === anchorWeekday) return 'weekly';
      }
      if (rule.frequency === 'monthly') return 'monthly';
      if (rule.frequency === 'yearly') return 'yearly';
    }
    return 'custom';
  }

  /**
   * Salirse de un evento que escribio otra persona. Es un DELETE en la tabla de invitados, no en el
   * evento: lo que se borra es la relacion, la cena de la casa sigue en pie.
   */
  async leaveEvent(event: HouseholdEvent): Promise<void> {
    const accepted = await this.confirmService.confirm({
      title: this.i18n.t('calendar.salir_del_evento'),
      message: this.i18n.t('calendar.lo_apunto_otra_persona', {
        title: event.title,
        autor: event.authorName ?? this.i18n.t('calendar.otra_persona_de_la')
      }),
      confirmText: this.i18n.t('calendar.salirme')
    });
    if (!accepted) return;
    const done = await this.calendarService.leaveHouseholdEvent(event.id);
    if (done) {
      this.toastService.show({
        type: 'info',
        title: this.i18n.t('calendar.te_has_salido_del'),
        duration: 4000,
        countdown: true
      });
      return;
    }
    this.toastService.error(
      this.i18n.t('calendar.no_se_pudo_salir'),
      this.i18n.t('calendar.vuelve_a_intentarlo_en')
    );
  }

  /** Los de la casa, menos yo, en orden de nombre: la regla vive en `core/event-invitations`. */
  protected householdPeople(): ReturnType<typeof inviteCandidates> {
    return inviteCandidates(
      this.householdService.household()?.members ?? [],
      this.authService.userId() || null
    );
  }

  protected openHouseholdPage(): void {
    void this.router.navigate(['/household']);
  }

  toggleAttendee(userId: string): void {
    const list = this.eventDraft.attendeeIds;
    this.eventDraft.attendeeIds = list.includes(userId)
      ? list.filter((entry) => entry !== userId)
      : [...list, userId];
  }

  /** Si el borrador actual lleva picker visible: ver `attendeeIdsPayload`. */
  private eventAttendeesShown = false;

  closeEventModal(): void {
    this.isEventModalOpen.set(false);
    this.isRecurrenceModalOpen.set(false);
  }

  /** Se abre desde la celda: el día ya viene elegido, que es lo que ahorra el tecleo. */
  agendaDay(): CalendarDayView {
    const iso = this.anchorIso();
    return (
      this.days().find((day) => day.iso === iso) ?? {
        date: new Date(),
        iso,
        inCurrentMonth: true,
        isToday: true,
        meals: [],
        tasks: [],
        slots: { breakfast: [], lunch: [], dinner: [], snack: [] } as never,
        calories: 0,
        hasNutrition: false,
        planned: 0,
        done: 0,
        events: []
      }
    );
  }

  anchorLabel(): string {
    return labels.longDay(this.anchor());
  }

  async saveEvent(): Promise<void> {
    const draft = this.eventDraft;
    const title = draft.title.trim();
    if (!title || !draft.date) return;
    const body: {
      title: string;
      kind: HouseholdEventKind;
      date: string;
      allDay: boolean;
      sharedWithHousehold: boolean;
      color: string | null;
      location: string | null;
      notes: string | null;
      /** `null` es «quitar la hora». Ausente es «no la toques»: confundirlas es el bug de antes. */
      startTime: string | null;
      endTime: string | null;
      attendeeIds?: string[];
      recurrence: HouseholdRecurrence;
      recurrenceRule: CalendarRecurrenceRule | null;
    } = {
      title,
      kind: draft.kind,
      date: draft.date,
      allDay: draft.allDay,
      sharedWithHousehold: draft.sharedWithHousehold,
      color: draft.color ?? this.metaOf(draft.kind).color,
      location: draft.location.trim() || null,
      notes: draft.notes.trim() || null,
      startTime: draft.allDay ? null : draft.startTime || null,
      endTime: draft.allDay ? null : draft.endTime || null,
      recurrence: draft.recurrence,
      recurrenceRule: draft.recurrenceRule
    };
    // Las caras van con el criterio del pure helper: lista vacia es «nadie invitado» SOLO si el picker
    // se vio; si no se vio, la clave no va y el servidor no toca la lista.
    Object.assign(body, attendeeIdsPayload(this.eventAttendeesShown, draft.attendeeIds));
    const saved = await this.calendarService.saveHouseholdEvent(body, draft.id);
    if (!saved) return;
    // Con recurrencia se vuelve a leer: lo que el servicio guarda en local es UNA fila, y los dias que
    // ocupa los calcula el servidor. Sin esto, crear «todos los dias» pintaba un dia y pareciera que no
    // se guardo nada. El parpadeo es el precio de no tener dos reglas de expansion (una aqui y otra alla).
    if (draft.recurrence !== 'none' || draft.recurrenceRule)
      this.calendarService.refreshHouseholdEvents();
    this.closeEventModal();
  }

  async removeEvent(): Promise<void> {
    const id = this.eventDraft.id;
    if (!id) return;
    const what = this.eventDraft.title.trim() || this.i18n.t('calendar.este_evento');
    // El aviso dice el alcance verdadero, que no es el que sugiere el boton: borrar el evento lo borra
    // para toda la casa. Para quitarselo de encima sin tocar a los demas existe «salir».
    const accepted = await this.confirmService.confirm({
      title: this.i18n.t('calendar.eliminar_evento'),
      // Con cadencia no se borra «el evento»: se borran todos sus dias, para toda la casa. El aviso lo
      // tiene que decir, que es la diferencia entre un clic y una discusion de pareja.
      message: this.i18n.t(
        this.eventDraft.recurrence === 'none'
          ? 'calendar.dejara_de_verse_para'
          : 'calendar.se_borra_toda_la_serie',
        { title: what }
      ),
      confirmText: this.i18n.t('common.delete'),
      variant: 'danger'
    });
    if (!accepted) return;
    const ok = await this.calendarService.removeHouseholdEvent(id);
    if (ok) {
      this.closeEventModal();
      this.toastService.show({
        type: 'info',
        title: this.i18n.t('calendar.evento_borrado'),
        duration: 4000,
        countdown: true
      });
    }
  }

  /**
   * «Quitar solo este dia» (HOGARIA-SPEC 12t-R). Falta a un gimnasio de los martes no es dejar de ir los
   * martes, y hasta ahora la unica salida era borrar la serie entera o no decirlo.
   */
  async removeOccurrence(): Promise<void> {
    const draft = this.eventDraft;
    const date = draft.occurrenceDate;
    if (!draft.id || !date || draft.recurrence === 'none') return;
    const accepted = await this.confirmService.confirm({
      title: this.i18n.t('calendar.quitar_solo_este_dia'),
      message: this.i18n.t('calendar.se_quita_el_dia', {
        date,
        title: draft.title.trim() || this.i18n.t('calendar.este_evento')
      }),
      confirmText: this.i18n.t('calendar.quitar_solo_este_dia'),
      variant: 'danger'
    });
    if (!accepted) return;
    const ok = await this.calendarService.skipHouseholdOccurrence(draft.id, date);
    if (ok) {
      this.closeEventModal();
      this.toastService.show({
        type: 'info',
        title: this.i18n.t('calendar.dia_fuera_de_serie'),
        duration: 4000,
        countdown: true
      });
      return;
    }
    this.toastService.error(this.i18n.t('ui.error'), this.i18n.t('calendar.no_se_pudo_quitar'));
  }

  eventTimeLabel(event: HouseholdEvent): string {
    return eventTimeLabel(event);
  }
}

function sum(days: CalendarDayView[], key: 'planned' | 'done' | 'calories'): number {
  return days.reduce((total, day) => total + day[key], 0);
}

function isSameDayAsToday(date: Date): boolean {
  const today = new Date();
  return (
    date.getDate() === today.getDate() &&
    date.getMonth() === today.getMonth() &&
    date.getFullYear() === today.getFullYear()
  );
}
