import { expect, type Locator } from '@playwright/test';

export async function expectAiParticipantsSafetyNoteGeometry(note: Locator): Promise<void> {
  const geometry = await note.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      margin: [style.marginTop, style.marginRight, style.marginBottom, style.marginLeft],
      padding: [style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft],
      borderLeftWidth: style.borderLeftWidth,
      borderRadius: style.borderRadius,
      fontSize: style.fontSize,
      backgroundColor: style.backgroundColor,
      color: style.color
    };
  });

  expect(geometry).toEqual({
    margin: ['4px', '0px', '12px', '0px'],
    padding: ['8px', '10px', '8px', '10px'],
    borderLeftWidth: '2px',
    borderRadius: '4px',
    fontSize: '12px',
    backgroundColor: 'rgb(245, 245, 244)',
    color: 'rgb(28, 25, 23)'
  });
}
