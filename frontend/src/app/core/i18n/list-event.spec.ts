import { LIST_EVENT_LABEL_KEYS } from './labels';
import { shoppingListsEn, shoppingListsEs } from './dict/shopping_lists';
import { listEventText } from '../../shared/models/shopping.model';

// El historial de la lista lo compone el cliente con el diccionario de verdad (HOGARIA-SPEC ## 12w): aqui se
// prueba la frase que ve una persona en cada idioma, no un diccionario de juguete.
const pinta =
  (dict: Record<string, string>) =>
  (key: string, params?: Record<string, string>): string => {
    let texto = dict[key] ?? key;
    for (const [nombre, valor] of Object.entries(params ?? {})) texto = texto.split(`{${nombre}}`).join(valor);
    return texto.replace(/\s{2,}/g, ' ').trim();
  };

const EN_ES = pinta(shoppingListsEs as unknown as Record<string, string>);
const EN_EN = pinta(shoppingListsEn as unknown as Record<string, string>);

const fila = (action: keyof typeof LIST_EVENT_LABEL_KEYS, item: string | null) => ({
  action,
  item_name: item,
  description: 'Ana ha tocado la lista'
});

describe('historial de la lista: la frase la compone el idioma activo', () => {
  it('en castellano sale la frase de siempre, palabra por palabra', () => {
    const texto = listEventText(fila('item.uncheck', 'Leche'), 'Ana', { t: EN_ES });
    expect(texto).toBe('Ana ha desmarcado «Leche»');
  });

  it('al cambiar a ingles se traduce el verbo, no solo el sujeto', () => {
    const texto = listEventText(fila('item.uncheck', 'Milk'), 'Ana', { t: EN_EN });
    expect(texto).toBe('Ana has unchecked Milk');
    expect(texto.includes('desmarcado')).toBe(false);
  });

  it('el nombre del articulo pasa por el catalogo cuando la pantalla le da una etiqueta', () => {
    const texto = listEventText(fila('item.add', 'Leche'), 'Juanjo', {
      t: EN_EN,
      item: (nombre) => (nombre === 'Leche' ? 'Milk' : nombre)
    });
    expect(texto).toBe('Juanjo has added Milk');
  });

  it('las acciones sin articulo no dejan la llave colgando ni huecos dobles', () => {
    const texto = listEventText(fila('list.clear-checked', null), 'Ana', { t: EN_ES });
    expect(texto).toBe('Ana ha vaciado el carro');
    expect(texto.includes('{')).toBe(false);
  });

  it('una accion que el diccionario no conoce se pinta con la frase del server', () => {
    const desconocida = { action: 'list.archive', item_name: null, description: 'Ana ha archivado la lista' };
    expect(listEventText(desconocida, 'Ana', { t: EN_EN })).toBe('Ana ha archivado la lista');
  });

  it('y si tampoco hay frase del server, la generica en el idioma activo', () => {
    const desconocida = { action: 'list.archive', item_name: null, description: '' };
    expect(listEventText(desconocida, 'Ana', { t: EN_EN })).toBe('Ana has touched the list');
  });

  it('las 20 acciones tienen clave, en los dos idiomas, y solo llaman a {item} las que mandan nombre', () => {
    const conNombre = new Set(['item.add', 'item.merge', 'item.update', 'item.discount', 'item.offer', 'item.check', 'item.uncheck', 'item.remove', 'item.restore']);
    const claves = Object.values(LIST_EVENT_LABEL_KEYS);
    expect(claves.length).toBe(20);
    for (const [action, key] of Object.entries(LIST_EVENT_LABEL_KEYS)) {
      for (const dict of [shoppingListsEs, shoppingListsEn] as unknown as Record<string, string>[]) {
        const frase = dict[key];
        expect(typeof frase).toBe('string');
        expect(frase.includes('{who}')).toBe(true);
        expect(frase.includes('{item}')).toBe(conNombre.has(action));
      }
    }
  });
});
