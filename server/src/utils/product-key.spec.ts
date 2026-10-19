import { describe, expect, it } from 'vitest';
import { normalizeProductName, productKeyOf } from './product-key.js';

/**
 * La clave normalizada es lo que hace que «Leche Semi 1L» de ayer valga para la
 * «leche semi» de hoy. Si esta funcion se pasa de lista, dos nombres distintos
 * comparten precio (peor: el tomate paga la leche); si se queda corta, cada
 * escritura es un producto nuevo y la cesta nunca lleva precios.
 */
describe('normalizeProductName', () => {
  it('normaliza mayusculas, acentos y espacios', () => {
    expect(normalizeProductName('  Lechuga   de  Huerta ')).toBe('lechuga huerta');
    expect(normalizeProductName('CAFÉ CON LECHE')).toBe('cafe con leche');
  });

  it('unifica las unidades escritas de formas distintas', () => {
    expect(normalizeProductName('Tomates 1 kilogramo')).toBe(normalizeProductName('tomates 1 kg'));
    expect(normalizeProductName('Leche 2 litros')).toBe('leche 2 l');
    expect(normalizeProductName('Yogur desnatado x4')).toBe(normalizeProductName('yogur desnatado x 4'));
  });

  it('no borra el sentido: la marca y el tipo siguen en la clave', () => {
    expect(normalizeProductName('Hacendado leche semi')).not.toBe(normalizeProductName('leche semi'));
    // Los modificadores que cambian el precio sobreviven a la normalizacion.
    expect(normalizeProductName('Leche sin lactosa')).toBe('leche sin lactosa');
    expect(normalizeProductName('Leche sin lactosa')).not.toBe(normalizeProductName('Leche con lactosa'));
  });

  it('descarta vacios, nulos y ruido suelto', () => {
    expect(normalizeProductName('')).toBe('');
    expect(normalizeProductName(null)).toBe('');
    expect(normalizeProductName(undefined)).toBe('');
    expect(normalizeProductName('   ')).toBe('');
    expect(normalizeProductName('...')).toBe('');
  });

  it('deja de ser la misma clave cuando cambia la cantidad', () => {
    // Deliberado: 1L y 500ml NO son el mismo precio unitario, y confundirlos es
    // exactamente como una estimacion se pone a si misma 4 veces el total.
    expect(normalizeProductName('Aceite 1L')).not.toBe(normalizeProductName('Aceite 500ml'));
  });

  it('productKeyOf es la misma funcion con nombre de dominio', () => {
    expect(productKeyOf('  Aguas  ')).toBe(normalizeProductName('Aguas'));
  });
});
