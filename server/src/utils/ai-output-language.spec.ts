import { describe, expect, it } from 'vitest';
import { aiOutputLanguageInstruction, resolveAiOutputLanguage } from './ai-output-language.js';

describe('idioma de salida de la IA', () => {
  it('usa el idioma resuelto por la aplicación por encima de preferencias compartidas o navegador', () => {
    expect(resolveAiOutputLanguage('en', 'es', 'es-ES,es;q=0.9')).toBe('en');
    expect(resolveAiOutputLanguage('es', 'en', 'en-GB,en;q=0.9')).toBe('es');
  });

  it('resuelve auto con Accept-Language y usa español si no hay señal válida', () => {
    expect(resolveAiOutputLanguage('auto', 'es', 'en-GB,en;q=0.9')).toBe('en');
    expect(resolveAiOutputLanguage('auto', 'en', 'es-ES,es;q=0.9')).toBe('es');
    expect(resolveAiOutputLanguage('invalid', undefined, undefined)).toBe('es');
    expect(resolveAiOutputLanguage('invalid', 'en', 'es-ES,es;q=0.9')).toBe('en');
    expect(resolveAiOutputLanguage('invalid', 'invalid', 'de-DE,de;q=0.9')).toBe('es');
  });

  it('da instrucciones distintas, explícitas y seguras para cada idioma', () => {
    expect(aiOutputLanguageInstruction('es')).toContain('español de España');
    expect(aiOutputLanguageInstruction('en')).toContain('English (United Kingdom)');
    expect(aiOutputLanguageInstruction('es')).toContain('No traduzcas');
    expect(aiOutputLanguageInstruction('en')).toContain('Do not translate');
  });
});
