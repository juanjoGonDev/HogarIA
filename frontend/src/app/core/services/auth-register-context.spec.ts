import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { Router } from '@angular/router';
import { SILENT_TOAST } from '../interceptors/error.interceptor';
import { AuthService } from './auth.service';

describe('AuthService register error handling', () => {
  let service: AuthService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [
        AuthService,
        { provide: Router, useValue: { navigate: jasmine.createSpy('navigate') } }
      ]
    });
    service = TestBed.inject(AuthService);
    http = TestBed.inject(HttpTestingController);
    localStorage.clear();
  });

  afterEach(() => {
    http.verify();
    localStorage.clear();
  });

  it('lets the registration form own and localize failed registration feedback', () => {
    service.register({ name: 'Ana', email: 'ana@example.test', password: 'Abc123' }).subscribe({
      error: () => undefined
    });

    const request = http.expectOne('/api/auth/register');
    expect(request.request.context.get(SILENT_TOAST)).toBeTrue();
    request.flush(
      { success: false, message: 'Email already registered' },
      { status: 409, statusText: 'Conflict' }
    );
  });
});
