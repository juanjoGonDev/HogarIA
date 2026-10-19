import { describe, expect, it } from 'vitest';
import { buildInventarioJson, buildTicketPrompt, TICKET_SHAPE } from './ticket-prompt.js';

/**
 * El prompt del ticket (## 12aj) se prueba como el de la foto: sin montar un proveedor. Lo que
 * se fija aqui es que el prompt pida leer el fichero actual del catálogo, que las reglas de dinero
 * y de no-inventar esten escritas, y que el PDF se anuncie como PDF.
 */
describe('buildTicketPrompt (## 12aj)', () => {
  const inventario = {
    tiendas: ['Mercadona', 'Lidl'],
    categorias: [
      { clave: 'dairy', nombre: 'Lácteos' },
      { clave: 'other', nombre: 'Otros' }
    ],
    productos: [{ categoria: 'dairy', nombre: 'Leche entera', unidad: 'unit' }]
  };

  it('el prompt pide leer el fichero inventario.json adjunto', () => {
    const json = buildInventarioJson(inventario);
    const parsed = JSON.parse(json);
    expect(parsed.tiendas).toEqual(['Mercadona', 'Lidl']);
    expect(parsed.categorias).toEqual(inventario.categorias);
    expect(parsed.productos).toEqual(inventario.productos);
    const { user } = buildTicketPrompt({ esPdf: false });
    expect(user).toContain('inventario.json');
    expect(user).toContain('adjunto');
    expect(user).toContain('lee');
    expect(user).toContain('respeta su categoria vigente');
  });

  it('las reglas que no se pueden romper: centimos, no inventar, tienda, total', () => {
    const { system } = buildTicketPrompt({ esPdf: false });
    expect(system).toContain('CENTIMOS ENTEROS');
    expect(system).toContain('NO inventes precios');
    expect(system).toContain('lo PAGADO por esa cantidad');
    expect(system).toContain('`store` es la tienda de la cabecera');
    expect(system).toContain('`totalMinor` es el total final');
    expect(system).toContain('usa su categoria vigente');
    expect(system).toContain('nunca los devuelvas como null');
    expect(system).toContain('createCategory: true');
  });

  it('la forma prometida tiene todo lo que el esquema va a validar', () => {
    expect(TICKET_SHAPE).toContain('"store"');
    expect(TICKET_SHAPE).toContain('"purchaseDate"');
    expect(TICKET_SHAPE).toContain('"priceMinor"');
    expect(TICKET_SHAPE).toContain('"totalMinor"');
    expect(TICKET_SHAPE).toContain('"warnings"');
    expect(TICKET_SHAPE).toContain('"offer"');
  });

  it('pide tienda/local y fecha impresa sin sustituirla por el momento de subida', () => {
    const { system } = buildTicketPrompt({ esPdf: false });

    expect(system).toContain('`store` es la tienda de la cabecera del ticket');
    expect(system).toContain('el nombre del establecimiento');
    expect(system).toContain(
      '`purchaseDate` es la fecha impresa de compra en formato `YYYY-MM-DD`'
    );
    expect(system).toContain('Si falta, no se lee o es ambigua, `purchaseDate` es null');
    expect(system).toContain('Nunca uses la fecha de subida ni `created_at` como fecha de compra');
  });

  it('localiza los avisos del análisis, sin traducir lo transcrito ni el catálogo', () => {
    const { system } = buildTicketPrompt({ esPdf: false, language: 'en' });

    expect(system).toContain('English (United Kingdom)');
    expect(system).toContain('warnings');
    expect(system).toContain('Do not translate');
  });

  it('el PDF se anuncia como PDF y la imagen como imagen', () => {
    const pdf = buildTicketPrompt({ esPdf: true });
    const imagen = buildTicketPrompt({ esPdf: false });
    expect(pdf.user).toContain('como PDF');
    expect(imagen.user).toContain('como imagen');
  });

  it('trata las fotos solapadas de un ticket largo como una sola compra', () => {
    const { system } = buildTicketPrompt({ esPdf: true });

    expect(system).toContain('las paginas son tramos contiguos o solapados de un unico ticket');
    expect(system).toContain('cuenta cada linea impresa una sola vez');
    expect(system).toContain('No elimines lineas impresas distintas');
  });
});
