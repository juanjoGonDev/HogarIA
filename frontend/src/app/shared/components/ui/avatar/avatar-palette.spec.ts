import { AVATAR_COLORS, avatarColorIndex, avatarInk, contrastRatio, initialsOf, readableInkOn } from './avatar-palette';

/**
 * El color del avatar, en puro. Se prueba aqui y no en el componente porque un spec que corre en
 * node no puede importar un `@Component`, y porque el fallo que dio lugar a esto (la inicial
 * invisible) era exactamente un color mal elegido: un test es lo unico que impide que vuelva.
 */

// El guiso y la carita van por punto de codigo, no escritos: `check-ui` no deja emoji en el
// codigo de la app, y un test que ejercita un emoji no necesita contener uno.
const STEW = String.fromCodePoint(0x1f372);
const SMILEY = String.fromCodePoint(0x1f642);

describe('avatar-palette — que la inicial se vea', () => {
  it('todo nombre acaba en una pareja con contraste legible', () => {
    const names = ['Ana', 'Luis', 'Kiquín', 'María del Carmen Fernández', 'q', `${STEW} cocina`, '', null, undefined, '   '];
    for (const name of names) {
      const { background, foreground } = avatarInk(name as string | null | undefined);
      expect(background).toMatch(/^#[0-9a-f]{6}$/);
      expect(foreground).toMatch(/^#[0-9a-f]{6}$/);
      // 4,5:1 es el minimo de WCAG para texto pequeno; una inicial de 10 px lo exige.
      expect(contrastRatio(background, foreground)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('el mismo nombre, el mismo color —en la fila, en la auditoria y en la agenda', () => {
    const first = avatarInk('Ana Ruiz');
    for (let i = 0; i < 5; i++) expect(avatarInk('Ana Ruiz')).toEqual(first);
    expect(avatarColorIndex('Ana Ruiz')).toBe(avatarColorIndex('ana ruiz'.trim()));
    expect(new Set(['Ana', 'Luis', 'Bea', 'Che', 'Dea', 'Ene'].map(avatarColorIndex)).size).toBeGreaterThan(1);
    expect(avatarColorIndex('')).toBe(0);
  });

  it('el fondo es un tinte claro del color de siempre, no el color entero', () => {
    // Con el color entero y letras blancas el disco desaparecia en el tema claro: de ahi que el
    // fondo se aclare y la letra se oscurezca del MISMO tono, que es lo que conserva la sena.
    const { background, foreground } = avatarInk('Ana');
    expect(contrastRatio(background, '#FFFFFF')).toBeLessThan(1.6);
    expect(contrastRatio(foreground, '#0B1220')).toBeLessThan(2);
    expect(AVATAR_COLORS).toContain('#F97316');
  });

  it('un color explicito se respeta, y solo se decide la tinta', () => {
    expect(avatarInk('Ana', '#F97316').background).toBe('#F97316');
    expect(avatarInk('Ana', '#000000').foreground).toBe('#FFFFFF');
    expect(avatarInk('Ana', '#FFFFFF').foreground).toBe('#0B1220');
    expect(readableInkOn('#111111')).toBe('#FFFFFF');
  });

  it('las iniciales: una letra si hay un nombre, dos si hay apellido, ? si no hay', () => {
    expect(initialsOf('Ana Ruiz')).toBe('AR');
    expect(initialsOf('luis')).toBe('L');
    expect(initialsOf('  Ana   García  López ')).toBe('AL');
    expect(initialsOf('')).toBe('?');
    expect(initialsOf(null)).toBe('?');
    // Que no reviente con un nombre que empieza por un surrogate (emoji, CJK poco comun): se
    // recorre por code points, no por unidades UTF-16, o la "inicial" seria medio caracter.
    expect(initialsOf(`${SMILEY} Ana`)).toBe(`${SMILEY}A`);
  });
});
