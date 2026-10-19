import { SECCION_POR_HOJA, seccionDeLista } from './seccion-de-catalogo';
import { LIST_CATEGORIES } from '../../shared/models/shopping.model';

/**
 * La traduccion hoja→seccion (## 12ah) tiene dos formas de romperse: que una hoja caiga en
 * una seccion que no existe (la linea se va al final del recorrido), o que una hoja known se
 * quede sin entrada y caiga a «Otros» sin que nadie lo note. Las dos se prueban aqui, que es
 * mas barato que darse cuenta en la tienda.
 */
describe('seccionDeLista (## 12ah)', () => {
  it('cada hoja conocida cae en el pasillo donde de verdad se compra', () => {
    expect(seccionDeLista('dairy')).toBe('Lacteos');
    expect(seccionDeLista('bakery')).toBe('Panaderia');
    expect(seccionDeLista('fruits')).toBe('Frutas y verduras');
    expect(seccionDeLista('vegetables')).toBe('Frutas y verduras');
    expect(seccionDeLista('meat')).toBe('Carne y pescado');
    expect(seccionDeLista('fish')).toBe('Carne y pescado');
    expect(seccionDeLista('frozen')).toBe('Congelados');
    expect(seccionDeLista('beverages')).toBe('Bebidas');
    expect(seccionDeLista('grains')).toBe('Despensa');
    expect(seccionDeLista('snacks')).toBe('Despensa');
    expect(seccionDeLista('colada')).toBe('Limpieza e higiene');
    expect(seccionDeLista('botiquin')).toBe('Limpieza e higiene');
    expect(seccionDeLista('desechables')).toBe('Limpieza e higiene');
  });

  it('lo que no tiene pasillo propio —mascotas, bebe— o no se conoce, cae en Otros', () => {
    expect(seccionDeLista('perro')).toBe('Otros');
    expect(seccionDeLista('panales')).toBe('Otros');
    expect(seccionDeLista('hoja-que-nacio-hoy')).toBe('Otros');
    expect(seccionDeLista('')).toBe('Otros');
    expect(seccionDeLista(null)).toBe('Otros');
    expect(seccionDeLista(undefined)).toBe('Otros');
  });

  it('ninguna entrada inventa una seccion: todas son de las nueve del carrito', () => {
    // El tipo ya lo impide en compilacion; esto es el candado para quien lo salte con un cast.
    for (const seccion of Object.values(SECCION_POR_HOJA)) {
      expect((LIST_CATEGORIES as readonly string[]).indexOf(seccion)).toBeGreaterThanOrEqual(0);
    }
  });

  it('las hojas del catalogo estan todas decididas: mapeadas o conscientemente en Otros', () => {
    // Las que NO estan en el mapa son una decision escrita (mascotas, bebe), no un olvido:
    // si alguien anade una hoja al catalogo del server y no la traduce, este test no puede
    // saberlo —pero las que estan aqui no pueden desaparecer del mapa en silencio.
    const esperadas = [
      'fruits',
      'vegetables',
      'bakery',
      'meat',
      'fish',
      'charcuteria',
      'dairy',
      'frozen',
      'grains',
      'canned',
      'spices',
      'condiments',
      'breakfast',
      'snacks',
      'sweets',
      'beverages',
      'colada',
      'fregadero',
      'superficies',
      'bano',
      'cabello',
      'corporal',
      'bucal',
      'botiquin',
      'desechables',
      'almacenaje',
      'mantenimiento'
    ];
    expect(Object.keys(SECCION_POR_HOJA).sort()).toEqual(esperadas.sort());
  });
});
