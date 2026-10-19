import { describe, expect, it } from 'vitest';
import { EXPECTED_SHAPE, buildPhotoPrompt } from './photo-prompt.js';

/**
 * El prompt es contrato: si cambia, cambia lo que el modelo puede contestar, y eso se
 * nota en la pantalla de otra persona. Se prueba lo que tiene que estar presente y
 * que la forma que se promete sea la forma que se valida.
 */

describe('buildPhotoPrompt', () => {
  const base = { categoriesJson: '[{"name":"Lacteos","color":"#4FA3D1"}]' };

  it('el sistema prohibe el markdown y exige centimos', () => {
    const { system } = buildPhotoPrompt({ ...base, mode: 'auto' });
    expect(system).toContain('UN objeto JSON');
    expect(system).toContain('CENTIMOS ENTEROS');
    expect(system).toContain('NO inventes precios');
  });

  it('el usuario lleva el catalogo tal cual', () => {
    const { user } = buildPhotoPrompt({ ...base, mode: 'auto' });
    expect(user).toContain('#4FA3D1');
    expect(user).toContain('Lacteos');
  });

  it('cada modo cambia la instruccion, y `auto` es la que no presupone', () => {
    const ticket = buildPhotoPrompt({ ...base, mode: 'ticket' }).user;
    const shelf = buildPhotoPrompt({ ...base, mode: 'shelf' }).user;
    const auto = buildPhotoPrompt({ ...base, mode: 'auto' }).user;
    expect(ticket).toContain('TICKET');
    expect(ticket).toContain('lo PAGADO');
    expect(shelf).toContain('PRECIO POR UNIDAD');
    expect(auto).not.toContain('TICKET');
  });

  it('la nota de quien fotografio llega al modelo', () => {
    const { user } = buildPhotoPrompt({
      ...base,
      mode: 'auto',
      note: 'es la oferta de la esquina'
    });
    expect(user).toContain('es la oferta de la esquina');
  });

  it('localiza solo los avisos y conserva nombres transcritos y categorías del catálogo', () => {
    const { system } = buildPhotoPrompt({ ...base, mode: 'auto', language: 'en' });
    expect(system).toContain('English (United Kingdom)');
    expect(system).toContain('warnings');
    expect(system).toContain('Do not translate');
  });

  it('la forma que se le muestra al modelo es JSON de verdad', () => {
    // Si aqui falla, el ejemplo esta roto y el modelo va a copiar algo que el propio
    // parser no acepta: es la prueba barata de que prompt y schema no se separan.
    const example = JSON.parse(EXPECTED_SHAPE);
    expect(example.lines[0]).toMatchObject({ name: 'Leche semidesnatada 1,5L', priceMinor: 95 });
  });

  it('el ejemplo del prompt pasa el contrato de respuesta', async () => {
    const { photoLinesSchema } = await import('../schemas/shopping.schema.js');
    const parsed = photoLinesSchema.safeParse(JSON.parse(EXPECTED_SHAPE));
    expect(parsed.success).toBe(true);
  });

  it('la nota vacia no deja una linea suelta en el prompt', () => {
    const { user } = buildPhotoPrompt({ ...base, mode: 'auto', note: null });
    expect(user).not.toMatch(/^\s*$/m);
  });
});
