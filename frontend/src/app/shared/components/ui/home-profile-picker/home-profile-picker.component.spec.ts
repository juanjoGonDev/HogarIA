import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { I18nService } from '../../../../core/services/i18n.service';
import { DEFAULT_HOME_PROFILE, HomeProfile } from '../../../models/home-profile';
import { HomeProfilePickerComponent } from './home-profile-picker.component';

describe('HomeProfilePickerComponent', () => {
  let fixture: ComponentFixture<HomeProfilePickerComponent>;
  let component: HomeProfilePickerComponent;
  let i18n: jasmine.SpyObj<I18nService>;

  beforeEach(async () => {
    i18n = jasmine.createSpyObj<I18nService>('I18nService', ['t'], {
      changeTick: signal(0)
    });
    i18n.t.and.callFake((key) => `trad:${key}`);

    await TestBed.configureTestingModule({
      imports: [HomeProfilePickerComponent],
      providers: [{ provide: I18nService, useValue: i18n }]
    }).compileComponents();

    fixture = TestBed.createComponent(HomeProfilePickerComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('profile', { ...DEFAULT_HOME_PROFILE });
  });

  it('resuelve etiquetas traducidas al leer y permite reemplazar cada valor por input', () => {
    expect(component.levelLabelText).toBe('trad:home_profile_picker.como_andas_de_cocina');
    expect(component.levelHintText).toBe('trad:home_profile_picker.no_es_una_etiqueta');
    expect(component.modulesLabelText).toBe('trad:home_profile_picker.que_quieres_llevar');
    expect(component.modulesHintText).toBe('trad:home_profile_picker.marca_lo_que_vas_a_usar');

    fixture.componentRef.setInput('levelLabel', 'Nivel propio');
    fixture.componentRef.setInput('levelHint', 'Pista propia');
    fixture.componentRef.setInput('modulesLabel', 'Módulos propios');
    fixture.componentRef.setInput('modulesHint', 'Pista de módulos propia');
    fixture.detectChanges();

    expect(component.levelLabelText).toBe('Nivel propio');
    expect(component.levelHintText).toBe('Pista propia');
    expect(component.modulesLabelText).toBe('Módulos propios');
    expect(component.modulesHintText).toBe('Pista de módulos propia');
  });

  it('muestra niveles, selección y efecto del nivel de cocina actual', () => {
    fixture.componentRef.setInput('profile', { cookingLevel: 'intermediate', modules: [] });
    fixture.detectChanges();

    const buttons = Array.from(
      fixture.nativeElement.querySelectorAll(
        '.profile-picker__level'
      ) as NodeListOf<HTMLButtonElement>
    );
    expect(buttons.map((button) => button.dataset['level'])).toEqual([
      'none',
      'beginner',
      'intermediate',
      'expert'
    ]);
    expect(buttons.map((button) => button.getAttribute('aria-pressed'))).toEqual([
      'false',
      'false',
      'true',
      'false'
    ]);
    expect(fixture.nativeElement.querySelector('.profile-picker__effect').textContent).toContain(
      'trad:profile.cookingEffect.intermediate'
    );
  });

  it('actualiza la pista de efecto cuando el perfil cambia tras el primer render', () => {
    fixture.componentRef.setInput('profile', { cookingLevel: 'beginner', modules: [] });
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.profile-picker__effect').textContent).toContain(
      'trad:profile.cookingEffect.beginner'
    );

    fixture.componentRef.setInput('profile', { cookingLevel: 'expert', modules: ['meals'] });
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.profile-picker__effect').textContent).toContain(
      'trad:profile.cookingEffect.expert'
    );
  });

  it('muestra la pista de nivel solo cuando se proporciona', () => {
    fixture.componentRef.setInput('askForModules', false);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.profile-picker__hint')).toBeNull();

    fixture.componentRef.setInput('levelHint', 'Elige lo que mejor te describa');
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.profile-picker__hint').textContent).toContain(
      'Elige lo que mejor te describa'
    );
  });

  it('respeta qué secciones pregunta y no pinta controles de las secciones ocultas', () => {
    fixture.componentRef.setInput('askForLevel', false);
    fixture.detectChanges();

    let fieldsets = fixture.nativeElement.querySelectorAll('fieldset') as NodeListOf<HTMLElement>;
    expect(fieldsets.length).toBe(2);
    expect(fieldsets[0].querySelector('.profile-picker__levels')).toBeNull();
    expect(fieldsets[0].querySelector('.profile-picker__effect')).toBeNull();
    expect(fieldsets[1].querySelector('.profile-picker__modules')).not.toBeNull();

    fixture.componentRef.setInput('askForModules', false);
    fixture.detectChanges();

    fieldsets = fixture.nativeElement.querySelectorAll('fieldset') as NodeListOf<HTMLElement>;
    expect(fieldsets.length).toBe(1);
    expect(fieldsets[0].querySelector('.profile-picker__modules')).toBeNull();
  });

  it('marca módulos seleccionados y anuncia como pronto solo el módulo no disponible', () => {
    fixture.componentRef.setInput('profile', { cookingLevel: 'beginner', modules: ['meals'] });
    fixture.detectChanges();

    const selected = fixture.nativeElement.querySelector(
      'input[data-module-input="meals"]'
    ) as HTMLInputElement;
    const pending = fixture.nativeElement.querySelector(
      'label[data-module="home"] .profile-picker__soon'
    ) as HTMLElement;

    expect(selected.checked).toBe(true);
    expect(selected.closest('label')?.classList.contains('profile-picker__module--on')).toBe(true);
    expect(pending.textContent).toContain('trad:home_profile_picker.proonto');
    expect(fixture.nativeElement.querySelectorAll('.profile-picker__soon').length).toBe(1);
  });

  it('emite un perfil completo al cambiar nivel y conserva los módulos', () => {
    const profile: HomeProfile = { cookingLevel: 'beginner', modules: ['pantry', 'shopping'] };
    fixture.componentRef.setInput('profile', profile);
    fixture.detectChanges();
    const emitted: HomeProfile[] = [];
    component.profileChange.subscribe((next) => emitted.push(next));

    (fixture.nativeElement.querySelector('[data-level="expert"]') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(emitted).toEqual([{ cookingLevel: 'expert', modules: ['pantry', 'shopping'] }]);
    expect(component.profile).toEqual(emitted[0]);
    expect(
      fixture.nativeElement.querySelector('[data-level="expert"]').getAttribute('aria-pressed')
    ).toBe('true');
    expect(fixture.nativeElement.querySelector('.profile-picker__effect').textContent).toContain(
      'trad:profile.cookingEffect.expert'
    );
  });

  it('añade y quita módulos mediante change, conservando el nivel y el resto de módulos', () => {
    const profile: HomeProfile = { cookingLevel: 'expert', modules: ['meals'] };
    fixture.componentRef.setInput('profile', profile);
    fixture.detectChanges();
    const emitted: HomeProfile[] = [];
    component.profileChange.subscribe((next) => emitted.push(next));

    const shopping = fixture.nativeElement.querySelector(
      'input[data-module-input="shopping"]'
    ) as HTMLInputElement;
    shopping.checked = true;
    shopping.dispatchEvent(new Event('change', { bubbles: true }));
    fixture.detectChanges();

    const meals = fixture.nativeElement.querySelector(
      'input[data-module-input="meals"]'
    ) as HTMLInputElement;
    meals.checked = false;
    meals.dispatchEvent(new Event('change', { bubbles: true }));
    fixture.detectChanges();

    expect(emitted).toEqual([
      { cookingLevel: 'expert', modules: ['meals', 'shopping'] },
      { cookingLevel: 'expert', modules: ['shopping'] }
    ]);
    expect(component.profile).toEqual(emitted[1]);
  });
});
