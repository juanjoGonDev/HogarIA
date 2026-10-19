import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { signal } from '@angular/core';
import { ShoppingService } from '../../core/services/shopping.service';
import { ConfirmService } from '../../core/services/confirm.service';
import { ToastService } from '../../core/services/toast.service';
import { I18nService } from '../../core/services/i18n.service';
import { HouseholdService } from '../../core/services/household.service';
import { ShoppingListsComponent } from './shopping-lists.component';

describe('ShoppingListsComponent live tray stream', () => {
  let closeStream: jasmine.Spy;
  let openStream: jasmine.Spy;
  let activeHouseholdId: ReturnType<typeof signal<string | null>>;
  let contextRevision: ReturnType<typeof signal<number>>;
  let switchingHousehold: ReturnType<typeof signal<boolean>>;
  let household: ReturnType<typeof signal<{ id: string } | null>>;
  let loadLists: jasmine.Spy;
  let loadStores: jasmine.Spy;

  beforeEach(async () => {
    closeStream = jasmine.createSpy('closeStream');
    openStream = jasmine.createSpy('openStream').and.returnValue(closeStream);
    activeHouseholdId = signal<string | null>('home-a');
    contextRevision = signal(0);
    switchingHousehold = signal(false);
    household = signal<{ id: string } | null>({ id: 'home-a' });
    loadLists = jasmine.createSpy('loadLists');
    loadStores = jasmine.createSpy('loadStores');

    const shopping = {
      lists: signal([]),
      loadingLists: signal(false),
      saving: signal(false),
      listsMeta: signal({ total: 0, limit: 25, offset: 0 }),
      stores: signal([]),
      loadLists,
      loadStores,
      openStream
    };

    await TestBed.configureTestingModule({
      imports: [ShoppingListsComponent],
      providers: [
        { provide: ShoppingService, useValue: shopping },
        { provide: ConfirmService, useValue: {} },
        { provide: ToastService, useValue: {} },
        { provide: Router, useValue: { navigate: jasmine.createSpy('navigate') } },
        { provide: I18nService, useValue: { t: (key: string) => key } },
        {
          provide: HouseholdService,
          useValue: { activeHouseholdId, contextRevision, switchingHousehold, household }
        }
      ]
    })
      .overrideComponent(ShoppingListsComponent, { set: { template: '' } })
      .compileComponents();
  });

  it('subscribes to the tray channel and closes it when the view is destroyed', () => {
    const fixture = TestBed.createComponent(ShoppingListsComponent);
    fixture.detectChanges();

    expect(openStream).toHaveBeenCalledOnceWith('tray', jasmine.any(Function));

    fixture.destroy();

    expect(closeStream).toHaveBeenCalledTimes(1);
  });

  it('closes and reopens its stream and refreshes the tray when the active home changes', async () => {
    const fixture = TestBed.createComponent(ShoppingListsComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    switchingHousehold.set(true);
    contextRevision.set(1);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(closeStream).toHaveBeenCalledTimes(1);

    activeHouseholdId.set('home-b');
    household.set({ id: 'home-b' });
    switchingHousehold.set(false);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(loadLists).toHaveBeenCalledTimes(2);
    expect(loadStores).toHaveBeenCalledTimes(2);
    expect(openStream).toHaveBeenCalledTimes(2);

    fixture.destroy();
    expect(closeStream).toHaveBeenCalledTimes(2);
  });
});
