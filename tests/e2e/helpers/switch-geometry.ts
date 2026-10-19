import { expect, type Page } from '../fixtures';

export async function assertSwitchHitArea(page: Page, selector: string): Promise<void> {
  const bounds = await page.locator(selector).boundingBox();
  expect(bounds, 'the switch remains visible at the tested viewport').not.toBeNull();
  expect(bounds!.width).toBeGreaterThanOrEqual(44);
  expect(bounds!.height).toBeGreaterThanOrEqual(44);
}

export async function assertSwitchGeometry(page: Page, selector: string): Promise<void> {
  const control = page.locator(selector);
  const assertContrast = async (): Promise<void> => {
    const ratios = await control.evaluate((element) => {
      const luminance = (color: string): number => {
        const hex = color.match(/^#([\da-f]{3}|[\da-f]{6})$/i)?.[1];
        const channels = hex
          ? ((hex.length === 3
              ? hex.split('').map((channel) => Number.parseInt(channel + channel, 16))
              : hex.match(/../g)?.map((channel) => Number.parseInt(channel, 16))) ?? [])
          : (color
              .match(/[\d.]+/g)
              ?.slice(0, 3)
              .map(Number) ?? []);
        if (channels.length !== 3) throw new Error(`Unexpected computed color: ${color}`);
        const [red, green, blue] = channels.map((channel) => {
          const normalized = channel / 255;
          return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
      };
      const ratio = (first: string, second: string): number => {
        const a = luminance(first);
        const b = luminance(second);
        return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      };
      const track = element.querySelector<HTMLElement>('[data-switch-track]');
      const thumb = element.querySelector<HTMLElement>('[data-switch-thumb]');
      if (!track || !thumb) throw new Error('Shared switch track and thumb must be measurable');
      return {
        thumbToTrack: ratio(
          getComputedStyle(thumb).backgroundColor,
          getComputedStyle(track).backgroundColor
        ),
        focusToSurface: ratio(
          getComputedStyle(element).outlineColor,
          getComputedStyle(document.documentElement).getPropertyValue('--bg-primary').trim()
        )
      };
    });
    expect(
      ratios.thumbToTrack,
      'the checked thumb is distinct from its track'
    ).toBeGreaterThanOrEqual(3);
    expect(
      ratios.focusToSurface,
      'the keyboard focus ring has visible contrast'
    ).toBeGreaterThanOrEqual(3);
  };
  const measure = () =>
    control.evaluate((element) => {
      const track = element.querySelector<HTMLElement>('[data-switch-track]');
      const thumb = element.querySelector<HTMLElement>('[data-switch-thumb]');
      if (!track || !thumb) throw new Error('Shared switch track and thumb must be measurable');
      const bounds = (target: HTMLElement) => {
        const rect = target.getBoundingClientRect();
        return {
          left: rect.left,
          right: rect.right,
          top: rect.top,
          bottom: rect.bottom,
          width: rect.width,
          height: rect.height
        };
      };
      return {
        target: bounds(element as HTMLElement),
        track: bounds(track),
        thumb: bounds(thumb)
      };
    });

  const assertCentered = async (checked: boolean): Promise<void> => {
    const state = checked ? 'on' : 'off';
    await expect(control).toHaveAttribute('aria-checked', String(checked));
    await expect
      .poll(async () => {
        const geometry = await measure();
        const trackCenterY = (geometry.track.top + geometry.track.bottom) / 2;
        const thumbCenterY = (geometry.thumb.top + geometry.thumb.bottom) / 2;
        const thumbCenterX = (geometry.thumb.left + geometry.thumb.right) / 2;
        const expectedCenterX = checked
          ? geometry.track.right - (geometry.thumb.right - geometry.thumb.left) / 2 - 3
          : geometry.track.left + (geometry.thumb.right - geometry.thumb.left) / 2 + 3;
        return Math.max(
          Math.abs(trackCenterY - thumbCenterY),
          Math.abs(expectedCenterX - thumbCenterX)
        );
      })
      .toBeLessThanOrEqual(1);

    const geometry = await measure();
    expect(geometry.track.width).toBe(38);
    expect(geometry.track.height).toBe(22);
    expect(geometry.thumb.width).toBeCloseTo(16, 2);
    expect(geometry.thumb.height).toBeCloseTo(16, 2);
    expect(
      Math.abs(
        (geometry.track.top + geometry.track.bottom) / 2 -
          (geometry.thumb.top + geometry.thumb.bottom) / 2
      ),
      `the thumb is vertically centered in the ${state} state`
    ).toBeLessThanOrEqual(1);
    expect(
      Math.abs(
        (geometry.track.top + geometry.track.bottom) / 2 -
          (geometry.target.top + geometry.target.bottom) / 2
      ),
      'the track is vertically centered in the complete touch target'
    ).toBeLessThanOrEqual(1);
    expect(
      Math.abs((geometry.track.left + geometry.track.right) / 2 - (geometry.target.left + 22)),
      'the track is centered in the switch control column'
    ).toBeLessThanOrEqual(1);
    const expectedCenterX = checked
      ? geometry.track.right - (geometry.thumb.right - geometry.thumb.left) / 2 - 3
      : geometry.track.left + (geometry.thumb.right - geometry.thumb.left) / 2 + 3;
    expect(
      Math.abs(expectedCenterX - (geometry.thumb.left + geometry.thumb.right) / 2),
      `the thumb has a symmetric inset in the ${state} state`
    ).toBeLessThanOrEqual(1);
  };

  await expect(control).toHaveAttribute('role', 'switch');
  await expect(control).toHaveAttribute('aria-checked', 'true');
  await expect(control).toHaveAccessibleName(/.+/);
  await assertSwitchHitArea(page, selector);
  await assertCentered(true);

  await control.click();
  await assertCentered(false);
  await expect(control).toHaveAttribute('aria-disabled', 'false');
  await control.focus();
  await page.keyboard.press('Space');
  await assertCentered(true);
  await expect(control).toBeFocused();
  await expect(control).toHaveCSS('outline-style', 'solid');
  await assertContrast();
}
