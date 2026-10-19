import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CATEGORIES,
  catalogueForPrompt,
  categoryKey,
  colorForNewCategory,
  isColor
} from './shopping-categories.js';

/**
 * Logica pura del catalogo de secciones. Lo que se prueba aqui es lo que no se ve
 * en la pantalla pero si en los datos: que dos nombres que son la misma seccion
 * choquen en la misma clave, que ningun color ilegal entre en la BD (un `color`
 * invalido pintaria una fila sin color, y eso es un bug silencioso) y que el JSON
 * que se le pasa al modelo sea JSON de verdad.
 */

describe('categoryKey', () => {
  it('ignora acentos, mayusculas y puntuacion de sobra', () => {
    expect(categoryKey('  Panadería ')).toBe(categoryKey('panaderia'));
    expect(categoryKey('Limpieza, e Higiene')).toBe(categoryKey('limpieza e higiene'));
    expect(categoryKey('Frutas   y\tverduras')).toBe('frutas y verduras');
  });

  it('no abrevia unidades: una seccion no es un producto', () => {
    // `productKeyOf` convertiria «1kg» en otra cosa; aqui el nombre es literal.
    expect(categoryKey('Pack de 6')).toBe('pack de 6');
  });

  it('una cadena vacia sigue siendo vacia, no «undefined»', () => {
    expect(categoryKey(undefined as unknown as string)).toBe('');
  });
});

describe('isColor', () => {
  it('acepta el hexadecimunal de seis y nada mas', () => {
    expect(isColor('#4CAF50')).toBe(true);
    expect(isColor('#abc123')).toBe(true);
    expect(isColor('rojo')).toBe(false);
    expect(isColor('#fff')).toBe(false);
    expect(isColor(null)).toBe(false);
  });
});

describe('colorForNewCategory', () => {
  it('es determinista y valido, porque una seccion creada dos veces no puede cambiar de color', () => {
    const a = colorForNewCategory('verduras');
    expect(a).toBe(colorForNewCategory('verduras'));
    expect(isColor(a)).toBe(true);
  });

  it('reparte: no todas las secciones nuevas salen del mismo color', () => {
    const colors = new Set(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'].map(colorForNewCategory));
    expect(colors.size).toBeGreaterThan(1);
  });
});

describe('DEFAULT_CATEGORIES', () => {
  it('cubre lo que la app ya tenia pintado, «Otros» incluido y al final', () => {
    expect(DEFAULT_CATEGORIES.map((c) => c.name)).toContain('Frutas y verduras');
    expect(DEFAULT_CATEGORIES.at(-1)?.name).toBe('Otros');
    expect(new Set(DEFAULT_CATEGORIES.map((c) => c.name)).size).toBe(DEFAULT_CATEGORIES.length);
  });

  it('ningun color por defecto es ilegal', () => {
    for (const seed of DEFAULT_CATEGORIES) expect(isColor(seed.color)).toBe(true);
  });
});

describe('catalogueForPrompt', () => {
  it('es el JSON que se le promete al modelo: nombre y color, sin nada mas', () => {
    const json = catalogueForPrompt([
      { name: 'Lacteos', color: '#4FA3D1' },
      { name: 'Otros', color: '#8A8F98' }
    ]);
    expect(JSON.parse(json)).toEqual([
      { name: 'Lacteos', color: '#4FA3D1' },
      { name: 'Otros', color: '#8A8F98' }
    ]);
  });
});
