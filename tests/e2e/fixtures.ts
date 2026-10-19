import { test as base, expect } from '@playwright/test';

/**
 * Punto de entrada de todos los specs.
 *
 * Añade un fixture automático que vigila que la aplicación no abra ningún
 * diálogo nativo del navegador (`alert`, `confirm`, `prompt`): todas las
 * confirmaciones pasan por `app-confirm-dialog` (ConfirmService), que sí
 * respeta el diseño, se puede traducir y se puede probar.
 *
 * Si algún día vuelve a colarse un `confirm()`, el diálogo se descarta (para
 * que el test no se quede colgado esperando) y el test falla, en lugar de
 * quedarse "en verde" porque nadie aceptó el diálogo.
 */
export const test = base.extend<{ nativeDialogs: string[] }>({
  nativeDialogs: [
    async ({ page }, use) => {
      const dialogs: string[] = [];

      // Y el idioma, anclado en la preferencia guardada, no solo en el navegador: `language: 'es'` es lo
      // que lee `I18nService` al arrancar. Sin esto, quien escriba un test despues de cambiar de idioma en
      // otro (el `localStorage` sobrevive entre specs dentro del mismo worker) prueba otra app.
      // La clave NO es nuestra: es `STORAGE_KEYS.language` (`frontend/src/app/core/services/storage.service.ts`),
      // que vale `hogar:v1:language` porque todo el almacenamiento de la app lleva el prefijo `STORAGE_PREFIX`.
      // Escribir otra cadena hacia lo mismo que no anclar nada: la app caia a `auto` y se llevaba el idioma del
      // navegador, que en CI es `en-US` —de ahi los chips que salian en ingles en `shopping-round10`—. Si cambia
      // `STORAGE_PREFIX`, cambia esto.
      // ...pero SOLO si la persona que corre el test no eligio idioma: `addInitScript` se ejecuta antes de CADA
      // navegacion, recargar incluida, y anclar `es` a la fuerza borraba la preferencia que un test estaba
      // probando que persistia (`settings-theme-i18n > language preference persists across reloads`). Semilla,
      // no imposicion.
      await page.addInitScript(() => {
        try {
          if (!window.localStorage.getItem('hogar:v1:language')) {
            window.localStorage.setItem('hogar:v1:language', 'es');
          }
        } catch {
          /* el test aun puede correr: la app cae a `auto`, y el locale del navegador es es-ES */
        }
      });

      page.on('dialog', async (dialog) => {
        dialogs.push(`${dialog.type()}: ${dialog.message()}`);
        await dialog.dismiss();
        throw new Error(
          'Diálogo nativo inesperado. La app debe confirmar con app-confirm-dialog ' +
            `(ConfirmService), no con el navegador. Diálogo abierto: ${dialogs.join(' | ')}`
        );
      });

      await use(dialogs);

      // Redundante con el throw de arriba, pero deja el mensaje en el assert.
      expect(dialogs, 'La app no debe abrir diálogos nativos del navegador').toEqual([]);

      page.removeAllListeners('dialog');
    },
    { auto: true }
  ]
});

export { expect };
export type { Page, Locator } from '@playwright/test';
