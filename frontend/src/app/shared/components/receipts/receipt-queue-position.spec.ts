import { computeReceiptQueuePanelPosition } from './receipt-queue-position';

describe('computeReceiptQueuePanelPosition', () => {
  it('does not leave a desktop panel inside the 280 px sidebar', () => {
    const position = computeReceiptQueuePanelPosition(
      { left: 224, top: 16, bottom: 56, sidebarRight: 280 },
      { width: 1280, height: 900 }
    );

    expect(position).toEqual({ left: 288, top: 64, bottom: null, width: 380, maxHeight: 820 });
  });

  it('clamps to the viewport when no sidebar boundary is provided', () => {
    expect(
      computeReceiptQueuePanelPosition(
        { left: 224, top: 16, bottom: 56 },
        { width: 1280, height: 900 }
      )
    ).toEqual({ left: 224, top: 64, bottom: null, width: 380, maxHeight: 820 });
  });

  it('clamps the panel to the viewport on mobile', () => {
    expect(
      computeReceiptQueuePanelPosition(
        { left: 170, top: 8, bottom: 48, sidebarRight: 280 },
        { width: 393, height: 851 }
      )
    ).toEqual({ left: 16, top: 56, bottom: null, width: 361, maxHeight: 779 });
  });

  it('uses the available width at 320 px without crossing the margin', () => {
    expect(
      computeReceiptQueuePanelPosition(
        { left: 170, top: 8, bottom: 48 },
        { width: 320, height: 568 }
      )
    ).toEqual({ left: 16, top: 56, bottom: null, width: 288, maxHeight: 496 });
  });

  it('opens above a low trigger and limits height to the remaining viewport', () => {
    expect(
      computeReceiptQueuePanelPosition(
        { left: 300, top: 780, bottom: 820 },
        { width: 400, height: 850 }
      )
    ).toEqual({ left: 16, top: null, bottom: 78, width: 368, maxHeight: 756 });
  });

  it('clamps a narrow viewport and a trigger outside its horizontal edges', () => {
    expect(
      computeReceiptQueuePanelPosition(
        { left: 500, top: 8, bottom: 48 },
        { width: 280, height: 568 }
      )
    ).toEqual({ left: 16, top: 56, bottom: null, width: 248, maxHeight: 496 });
  });
});
