import { AiParticipantsComponent } from './ai-participants.component';
import { TestBed } from '@angular/core/testing';
import { I18nService } from '../../core/services/i18n.service';
import { STORAGE_KEYS } from '../../core/services/storage.service';
import { dateLocale, setDateLocale } from '../../core/time';
import type { HouseholdMember } from '../models/household.model';

let previousLocale: string;
let previousStoredLanguage: string | null;

beforeEach(() => {
  previousLocale = dateLocale();
  previousStoredLanguage = localStorage.getItem(STORAGE_KEYS.language);
});

afterEach(() => {
  TestBed.resetTestingModule();
  setDateLocale(previousLocale);
  if (previousStoredLanguage === null) localStorage.removeItem(STORAGE_KEYS.language);
  else localStorage.setItem(STORAGE_KEYS.language, previousStoredLanguage);
});

const member = (id: string, isActive = true): HouseholdMember => ({
  id,
  userId: `user-${id}`,
  name: `Persona ${id}`,
  email: `${id}@example.test`,
  role: 'member',
  cookingLevel: 'intermediate',
  joinedAt: new Date('2026-01-01T00:00:00Z'),
  isActive
});

describe('AiParticipantsComponent', () => {
  it('shows a localized, accessible allergy-safety limitation before a request', async () => {
    await TestBed.configureTestingModule({
      imports: [AiParticipantsComponent]
    }).compileComponents();
    const fixture = TestBed.createComponent(AiParticipantsComponent);
    const i18n = TestBed.inject(I18nService);
    await i18n.loadTranslations('aiParticipants');
    i18n.setLang('es');
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    const note = host.querySelector('[data-test="ai-participants-safety-note"]');
    expect(note).not.toBeNull();
    expect(note?.getAttribute('role')).toBe('note');
    expect(note?.textContent).toContain('no puede garantizar');
    expect(note?.textContent).toContain('contaminación cruzada');

    i18n.setLang('en');
    fixture.detectChanges();
    expect(note?.textContent).toContain('cannot guarantee');
    expect(note?.textContent).toContain('cross-contamination');
    fixture.destroy();
  });

  it('shows only active household members and emits a copy of selected membership IDs', () => {
    const component = new AiParticipantsComponent();
    component.members = [member('active-a'), member('inactive-b', false)];
    component.selectedMemberIds = ['active-a'];
    let emitted: string[] = [];
    component.selectedMemberIdsChange.subscribe((ids) => (emitted = ids));

    expect(component.activeMembers.map((item) => item.id)).toEqual(['active-a']);
    component.toggleMember('active-a', false);

    expect(emitted).toEqual([]);
    expect(component.selectedMemberIds).toEqual(['active-a']);
    component.selectedMemberIds = ['active-a'];
    component.toggleMember('active-a', true);
    expect(emitted).toEqual(['active-a']);
    component.toggleMember('active-b', true);
    expect(emitted).toEqual(['active-a', 'active-b']);
  });

  it('adds and removes anonymous guests without mutating the parent profile list', () => {
    const component = new AiParticipantsComponent();
    let emitted: typeof component.guests = [];
    component.guestsChange.subscribe((guests) => (emitted = guests));

    component.addGuest();
    expect(emitted.length).toBe(1);
    expect(emitted[0]).toEqual({
      allergies: [],
      intolerances: [],
      diets: [],
      likes: [],
      dislikes: [],
      notes: ''
    });
    component.guests = emitted;
    component.removeGuest(0);

    expect(emitted).toEqual([]);
    component.guests = Array.from({ length: 8 }, () => ({
      allergies: [],
      intolerances: [],
      diets: [],
      likes: [],
      dislikes: [],
      notes: ''
    }));
    component.addGuest();
    expect(emitted).toEqual([]);
  });

  it('supports multiple preset choices and emits plain preference values', () => {
    const component = new AiParticipantsComponent();
    component.guests = [
      { allergies: [], intolerances: [], diets: [], likes: [], dislikes: [], notes: '' }
    ];
    let emitted: typeof component.guests = [];
    component.guestsChange.subscribe((guests) => (emitted = guests));

    expect(
      component
        .presetOptions('allergies')
        .some((item) => item.value === 'huevo' && item.emoji === '🥚')
    ).toBeTrue();
    component.togglePreference(0, 'allergies', 'huevo');
    component.guests = emitted;
    component.togglePreference(0, 'allergies', 'leche');
    expect(emitted[0].allergies).toEqual(['huevo', 'leche']);
  });

  it('adds normalized custom preferences once, removes them and keeps list limits', () => {
    const component = new AiParticipantsComponent();
    component.guests = [
      { allergies: [], intolerances: [], diets: [], likes: [], dislikes: [], notes: '' }
    ];
    let emitted: typeof component.guests = [];
    component.guestsChange.subscribe((guests) => (emitted = guests));

    component.addCustomPreference(0, 'likes', '  sopa   de ajo ');
    component.guests = emitted;
    component.addCustomPreference(0, 'likes', 'sopa de ajo');
    expect(emitted[0].likes).toEqual(['sopa de ajo']);
    component.guests = emitted;
    component.removePreference(0, 'likes', 'sopa de ajo');
    expect(emitted[0].likes).toEqual([]);

    component.guests = [
      { ...emitted[0], allergies: Array.from({ length: 20 }, (_, i) => `a${i}`) }
    ];
    component.addCustomPreference(0, 'allergies', 'nueva');
    expect(component.guests[0].allergies.length).toBe(20);
    component.updateNotes(0, 'x'.repeat(2_501));
    expect(emitted[0].notes.length).toBe(2_501);
  });

  it('preserves full-length custom guest preferences and renders no maxlength on text fields', () => {
    const component = new AiParticipantsComponent();
    component.guests = [
      { allergies: [], intolerances: [], diets: [], likes: [], dislikes: [], notes: '' }
    ];
    let emitted: typeof component.guests = [];
    component.guestsChange.subscribe((guests) => (emitted = guests));
    const longValue = 'A'.repeat(2_501);
    component.setCustomDraft(0, 'allergies', longValue);
    component.addCustomPreference(0, 'allergies');
    component.guests = emitted;
    component.updateNotes(0, longValue);

    expect(emitted[0].allergies).toEqual([longValue]);
    expect(emitted[0].notes).toBe(longValue);
  });

  it('renders guest preference and note fields without a browser character cap', async () => {
    await TestBed.configureTestingModule({
      imports: [AiParticipantsComponent]
    }).compileComponents();
    const fixture = TestBed.createComponent(AiParticipantsComponent);
    fixture.componentInstance.guests = [
      { allergies: [], intolerances: [], diets: [], likes: [], dislikes: [], notes: '' }
    ];
    fixture.componentInstance.togglePicker(0, 'allergies');
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    expect(
      host
        .querySelector('[data-test="ai-guest-0-allergies-custom-input"]')
        ?.hasAttribute('maxlength')
    ).toBe(false);
    expect(host.querySelector('[data-test="ai-guest-0-notes"]')?.hasAttribute('maxlength')).toBe(
      false
    );
    fixture.destroy();
  });

  it('closes an open picker and safely ignores blank, duplicate and missing-guest edits', () => {
    const component = new AiParticipantsComponent();
    const emptyGuest = {
      allergies: [],
      intolerances: [],
      diets: [],
      likes: [],
      dislikes: [],
      notes: ''
    };
    component.guests = [{ ...emptyGuest }, { ...emptyGuest }];
    let emitted: typeof component.guests = component.guests;
    component.guestsChange.subscribe((guests) => (emitted = guests));

    component.togglePicker(0, 'likes');
    expect(component.isPickerOpen(0, 'likes')).toBeTrue();
    component.togglePicker(0, 'likes');
    expect(component.isPickerOpen(0, 'likes')).toBeFalse();

    component.togglePreference(0, 'likes', 'Pescado');
    component.guests = emitted;
    component.togglePreference(0, 'likes', ' pescado ');
    expect(emitted[0].likes).toEqual([]);
    component.guests = emitted;
    component.addCustomPreference(0, 'likes', '   ');
    component.addCustomPreference(0, 'likes');
    expect(emitted[0].likes).toEqual([]);

    component.addCustomPreference(0, 'likes', 'Sopa de ajo');
    component.guests = emitted;
    component.addCustomPreference(0, 'likes', ' sopa de ajo ');
    expect(emitted[0].likes).toEqual(['Sopa de ajo']);
    component.guests = emitted;
    component.removePreference(0, 'likes', 'SOPA DE AJO');
    expect(emitted[0].likes).toEqual([]);

    const emissionCount = emitted.length;
    component.togglePreference(5, 'likes', 'irrelevante');
    component.removePreference(5, 'likes', 'irrelevante');
    component.updateNotes(5, 'nota');
    expect(emitted.length).toBe(emissionCount);
  });

  it('renders accessible multi-select presets, custom choices, active members and the empty state', async () => {
    await TestBed.configureTestingModule({
      imports: [AiParticipantsComponent]
    }).compileComponents();
    const fixture = TestBed.createComponent(AiParticipantsComponent);
    const component = fixture.componentInstance;
    component.members = [member('active-a'), member('inactive-b', false)];
    component.selectedMemberIds = ['active-a'];
    component.guests = [
      { allergies: [], intolerances: [], diets: [], likes: [], dislikes: [], notes: '' }
    ];
    component.selectedMemberIdsChange.subscribe((ids) => (component.selectedMemberIds = ids));
    component.guestsChange.subscribe((guests) => (component.guests = guests));
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelectorAll('.participants__member').length).toBe(1);
    expect(host.querySelector('[data-test="ai-member-inactive-b"]')).toBeNull();
    expect(host.querySelector('[data-test="ai-guest-0-allergies-selected"]')).toBeNull();

    (host.querySelector('[data-test="ai-add-guest"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(host.querySelectorAll('.participants__guest').length).toBe(2);

    const allergyToggle = host.querySelector(
      '[data-test="ai-guest-0-allergies-toggle"]'
    ) as HTMLButtonElement;
    allergyToggle.click();
    fixture.detectChanges();
    expect(allergyToggle.getAttribute('aria-expanded')).toBe('true');
    expect(host.querySelector('[data-test="ai-guest-0-allergies-picker"]')).not.toBeNull();

    const egg = host.querySelector(
      '[data-test="ai-guest-0-allergies-option-huevo"]'
    ) as HTMLButtonElement;
    expect(egg.textContent).toContain('🥚');
    egg.click();
    fixture.detectChanges();
    expect(egg.getAttribute('aria-pressed')).toBe('true');
    expect(
      host.querySelector('[data-test="ai-guest-0-allergies-selected"]')?.textContent
    ).toContain('🥚');

    const likesToggle = host.querySelector(
      '[data-test="ai-guest-0-likes-toggle"]'
    ) as HTMLButtonElement;
    likesToggle.click();
    fixture.detectChanges();
    const custom = host.querySelector(
      '[data-test="ai-guest-0-likes-custom-input"]'
    ) as HTMLInputElement;
    custom.value = ' pupusas   de queso ';
    custom.dispatchEvent(new Event('input', { bubbles: true }));
    fixture.detectChanges();
    const addCustom = host.querySelector(
      '[data-test="ai-guest-0-likes-custom-add"]'
    ) as HTMLButtonElement;
    expect(addCustom.disabled).toBeFalse();
    addCustom.click();
    fixture.detectChanges();
    expect(host.querySelector('[data-test="ai-guest-0-likes-selected"]')?.textContent).toContain(
      'pupusas de queso'
    );

    (host.querySelector('[data-test="ai-remove-guest-1"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(host.querySelectorAll('.participants__guest').length).toBe(1);

    component.members = [];
    fixture.detectChanges();
    expect(host.querySelector('.participants__members')).toBeNull();
    expect(host.querySelector('.participants__hint')).not.toBeNull();
    fixture.destroy();
  });
});
