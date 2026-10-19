import { CATALOG_LABEL_KEYS, catalogLabelKey } from '../../core/i18n/labels';
import { pantryEn, pantryEs } from '../../core/i18n/dict/pantry';
import { catalogLabel } from './catalog-label.pipe';

// La etiqueta del catalogo sembrado (HOGARIA-SPEC ## 12w): lectura traducida, dato en crudo, texto ajeno intacto.
const con = (dict: Record<string, string>) => (key: string): string => dict[key] ?? key;

describe('catalogLabel', () => {
  it('un alimento del semillero se lee en el idioma activo', () => {
    expect(catalogLabel('Leche', con(pantryEs as unknown as Record<string, string>))).toBe('Leche');
    expect(catalogLabel('Leche', con(pantryEn as unknown as Record<string, string>))).toBe('Milk');
  });

  it('un utensilio igual, y los dos catalogos se encuentran con la misma llamada', () => {
    const t = con(pantryEn as unknown as Record<string, string>);
    expect(catalogLabel('Sartén', t)).toBe('Frying pan');
    expect(catalogLabel('Vitrocerámica / Placa inducción', t)).toBe('Induction hob');
  });

  it('lo que no es del catalogo se pinta tal cual: es el nombre que escribio la persona', () => {
    expect(catalogLabel('Leche de avena sin lactosa', con(pantryEn as unknown as Record<string, string>))).toBe(
      'Leche de avena sin lactosa'
    );
  });

  it('nada de claves colgando cuando el nombre falta', () => {
    const t = con(pantryEn as unknown as Record<string, string>);
    expect(catalogLabel(null, t)).toBe('');
    expect(catalogLabel(undefined, t)).toBe('');
    expect(catalogLabel('', t)).toBe('');
  });

  it('los 122 nombres sembrados tienen etiqueta, y la busqueda los encuentra a todos', () => {
    const claves = Object.values(CATALOG_LABEL_KEYS);
    expect(claves.length).toBe(122);
    for (const nombre of Object.keys(CATALOG_LABEL_KEYS)) {
      expect(catalogLabelKey(nombre)).toBe(CATALOG_LABEL_KEYS[nombre]);
    }
  });

});
