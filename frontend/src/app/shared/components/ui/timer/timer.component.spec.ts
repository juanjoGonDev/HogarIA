import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { TimerComponent } from './timer.component';

describe('TimerComponent', () => {
  let component: TimerComponent;
  let fixture: ComponentFixture<TimerComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TimerComponent]
    }).compileComponents();

    fixture = TestBed.createComponent(TimerComponent);
    component = fixture.componentInstance;
    component.duration = 60; // 60 seconds
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should initialize with correct time', () => {
    expect(component.currentTime).toBe(60);
    expect(component.state).toBe('idle');
  });

  it('exposes a named, non-live timer region for assistive technology', () => {
    component.label = 'Temporizador del paso 1';
    fixture.detectChanges();

    const timer = fixture.nativeElement.querySelector('[role="timer"]') as HTMLElement | null;
    expect(timer).not.toBeNull();
    expect(timer?.getAttribute('aria-label')).toBe('Temporizador del paso 1');
    expect(timer?.getAttribute('aria-live')).toBe('off');
  });

  it('keeps the default timer layout and supports a compact recipe layout', () => {
    const timer = fixture.nativeElement.querySelector('[role="timer"]') as HTMLElement;
    const startButton = fixture.nativeElement.querySelector('button') as HTMLButtonElement;
    expect(timer.classList.contains('timer--compact')).toBeFalse();
    expect(startButton.classList.contains('btn--primary')).toBeTrue();

    component.compact = true;
    fixture.detectChanges();

    expect(timer.classList.contains('timer--compact')).toBeTrue();
    expect(startButton.classList.contains('btn--outline')).toBeTrue();
  });

  it('should format time correctly', () => {
    expect(component.formatTime(0)).toBe('00:00');
    expect(component.formatTime(30)).toBe('00:30');
    expect(component.formatTime(60)).toBe('01:00');
    expect(component.formatTime(90)).toBe('01:30');
    expect(component.formatTime(125)).toBe('02:05');
  });

  it('should start timer', fakeAsync(() => {
    component.start();

    expect(component.state).toBe('running');

    tick(1000);
    expect(component.currentTime).toBe(59);

    tick(1000);
    expect(component.currentTime).toBe(58);
  }));

  it('should pause timer', fakeAsync(() => {
    component.start();
    tick(2000);

    component.pause();

    expect(component.state).toBe('paused');
    expect(component.currentTime).toBe(58);

    tick(2000);
    expect(component.currentTime).toBe(58); // Should not change
  }));

  it('should resume timer', fakeAsync(() => {
    component.start();
    tick(2000);
    component.pause();

    component.start();
    tick(1000);

    expect(component.currentTime).toBe(57);
  }));

  it('should reset timer', fakeAsync(() => {
    component.start();
    tick(5000);

    component.reset();

    expect(component.state).toBe('idle');
    expect(component.currentTime).toBe(60);
  }));

  it('should complete timer', fakeAsync(() => {
    component.duration = 3;
    component.currentTime = 3;
    component.start();

    tick(3000);

    expect(component.state).toBe('finished');
    expect(component.currentTime).toBe(0);
  }));

  it('completes after a background-tab clock jump despite delayed interval ticks', fakeAsync(() => {
    component.duration = 60;
    component.currentTime = 60;
    const startedAt = Date.now();
    const now = spyOn(Date, 'now').and.returnValue(startedAt);
    const completed = spyOn(component.timerComplete, 'emit');

    component.start();
    now.and.returnValue(startedAt + 61_000);
    tick(1_000);

    expect(component.state).toBe('finished');
    expect(component.currentTime).toBe(0);
    expect(completed).toHaveBeenCalledTimes(1);
  }));

  it('restarts a completed timer from its full duration', fakeAsync(() => {
    component.duration = 1;
    component.currentTime = 1;
    component.start();
    tick(1000);

    expect(component.state).toBe('finished');

    const reset = spyOn(component, 'reset').and.callThrough();
    component.start();

    expect(component.state).toBe('running');
    expect(component.currentTime).toBe(1);
    expect(reset).toHaveBeenCalledTimes(1);
    tick(1000);
    expect(component.state).toBe('finished');
  }));

  it('should emit timerStart', fakeAsync(() => {
    spyOn(component.timerStart, 'emit');

    component.start();

    expect(component.timerStart.emit).toHaveBeenCalled();
  }));

  it('should emit timerPause', fakeAsync(() => {
    spyOn(component.timerPause, 'emit');

    component.start();
    tick(1000);
    component.pause();

    expect(component.timerPause.emit).toHaveBeenCalled();
  }));

  it('should emit timerComplete', fakeAsync(() => {
    spyOn(component.timerComplete, 'emit');

    component.duration = 2;
    component.currentTime = 2;
    component.start();
    tick(2000);

    expect(component.timerComplete.emit).toHaveBeenCalled();
  }));

  it('should emit timerReset', fakeAsync(() => {
    spyOn(component.timerReset, 'emit');

    component.start();
    tick(1000);
    component.reset();

    expect(component.timerReset.emit).toHaveBeenCalled();
  }));

  it('should emit timerTick', fakeAsync(() => {
    spyOn(component.timerTick, 'emit');

    component.start();
    tick(1000);

    expect(component.timerTick.emit).toHaveBeenCalledWith(59);
  }));

  it('should auto-start when autoStart is true', fakeAsync(() => {
    component.autoStart = true;
    component.ngOnInit();

    tick(1000);

    expect(component.state).toBe('running');
    expect(component.currentTime).toBe(59);
  }));

  it('should calculate progress correctly', () => {
    component.duration = 100;
    component.currentTime = 50;

    component['calculateProgress']();

    expect(component.progress).toBe(50);
  });

  it('keeps progress at zero for a zero-duration timer', () => {
    component.duration = 0;
    component.currentTime = 0;
    component.progress = 50;

    component['calculateProgress']();

    expect(component.progress).toBe(0);
  });

  it('should have 100% progress when finished', fakeAsync(() => {
    component.duration = 1;
    component.currentTime = 1;
    component.start();
    tick(1000);

    expect(component.progress).toBe(100);
  }));

  describe('getClasses', () => {
    it('should return correct class for idle state', () => {
      expect(component.getClasses()).toBe('timer timer--idle');
    });

    it('should return correct class for running state', () => {
      component.start();
      expect(component.getClasses()).toBe('timer timer--running');
    });

    it('should return correct class for paused state', () => {
      component.start();
      component.pause();
      expect(component.getClasses()).toBe('timer timer--paused');
    });
  });
});
