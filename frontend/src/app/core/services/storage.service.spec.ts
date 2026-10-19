import { TestBed } from '@angular/core/testing';
import { StorageService } from './storage.service';

describe('StorageService', () => {
  let service: StorageService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(StorageService);
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('get/set', () => {
    it('should store and retrieve a value', () => {
      service.set('test-key', { name: 'test' });

      const result = service.get('test-key');
      expect(result).toEqual({ name: 'test' });
    });

    it('should return null for non-existent key', () => {
      expect(service.get('nonexistent')).toBeNull();
    });

    it('should handle different data types', () => {
      service.set('string', 'hello');
      service.set('number', 42);
      service.set('boolean', true);
      service.set('array', [1, 2, 3]);
      service.set('object', { key: 'value' });

      expect(service.get('string')).toBe('hello');
      expect(service.get('number')).toBe(42);
      expect(service.get('boolean')).toBe(true);
      expect(service.get('array')).toEqual([1, 2, 3]);
      expect(service.get('object')).toEqual({ key: 'value' });
    });

    it('should overwrite existing value', () => {
      service.set('key', 'old');
      service.set('key', 'new');

      expect(service.get('key')).toBe('new');
    });
  });

  describe('remove', () => {
    it('should remove a value', () => {
      service.set('key', 'value');
      service.remove('key');

      expect(service.get('key')).toBeNull();
    });
  });

  describe('has', () => {
    it('should return true for existing key', () => {
      service.set('key', 'value');

      expect(service.has('key')).toBeTrue();
    });

    it('should return false for non-existent key', () => {
      expect(service.has('nonexistent')).toBeFalse();
    });
  });

  describe('clear', () => {
    it('should remove all app-prefixed keys', () => {
      service.set('key1', 'value1');
      service.set('key2', 'value2');
      service.set('key3', 'value3');

      service.clear();

      expect(service.get('key1')).toBeNull();
      expect(service.get('key2')).toBeNull();
      expect(service.get('key3')).toBeNull();
    });

    it('should not remove non-prefixed keys', () => {
      localStorage.setItem('other-key', 'other-value');
      service.set('app-key', 'app-value');

      service.clear();

      expect(localStorage.getItem('other-key')).toBe('other-value');
      expect(service.get('app-key')).toBeNull();
    });
  });

  describe('getKeys', () => {
    it('should return all app-prefixed keys', () => {
      service.set('key1', 'value1');
      service.set('key2', 'value2');
      localStorage.setItem('other-key', 'other-value');

      const keys = service.getKeys();

      expect(keys.length).toBe(2);
      expect(keys).toContain('key1');
      expect(keys).toContain('key2');
      expect(keys).not.toContain('other-key');
    });
  });

  describe('error handling', () => {
    it('should handle invalid JSON gracefully', () => {
      localStorage.setItem('recipeapp_invalid', 'not-json');
      localStorage.setItem('hogar:v1:invalid', 'not-json');

      const result = service.get('invalid');
      expect(result).toBeNull();
    });

    it('should tolerate quota errors when persisting a value', () => {
      spyOn(Storage.prototype, 'setItem').and.throwError('quota exceeded');
      const log = spyOn(console, 'error');

      expect(() => service.set('shopping.recent-units', ['kg'])).not.toThrow();
      expect(log).toHaveBeenCalled();
    });
  });
});
