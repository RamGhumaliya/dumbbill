import { expect, test } from '@playwright/test';
import { previewSubtotalPaise, usePosCart } from '@/stores/pos-cart';

const whey = { productId: 'whey', name: 'Whey 2 lb', unitPricePaise: 489_900 };
const shaker = { productId: 'shaker', name: 'Shaker', unitPricePaise: 34_900 };

/** The cart is a preview only (the server owns the real bill), but it must still never hold nonsense. */
test.describe('POS cart store', () => {
  test.beforeEach(() => usePosCart.getState().clear());

  test('adding the same product twice increases its quantity instead of adding a second line', () => {
    const { addItem } = usePosCart.getState();
    addItem(whey);
    addItem(whey);
    addItem(shaker);
    expect(usePosCart.getState().lines).toEqual([
      { ...whey, quantity: 2 },
      { ...shaker, quantity: 1 },
    ]);
  });

  test('preview subtotal is the sum of price x quantity, in whole paise', () => {
    const { addItem, setQuantity } = usePosCart.getState();
    addItem(whey);
    addItem(shaker);
    setQuantity('shaker', 3);
    expect(previewSubtotalPaise(usePosCart.getState().lines)).toBe(489_900 + 3 * 34_900);
  });

  test('setting a quantity of zero or less removes the line', () => {
    const { addItem, setQuantity } = usePosCart.getState();
    addItem(whey);
    setQuantity('whey', 0);
    expect(usePosCart.getState().lines).toEqual([]);
  });

  test('removeItem and clear work', () => {
    const { addItem, removeItem, clear } = usePosCart.getState();
    addItem(whey);
    addItem(shaker);
    removeItem('whey');
    expect(usePosCart.getState().lines.map((l) => l.productId)).toEqual(['shaker']);
    clear();
    expect(usePosCart.getState().lines).toEqual([]);
  });

  test('refuses a price that is not whole paise or is negative', () => {
    const { addItem } = usePosCart.getState();
    expect(() => addItem({ ...whey, unitPricePaise: 10.5 })).toThrow(/whole number of paise/);
    expect(() => addItem({ ...whey, unitPricePaise: -1 })).toThrow();
    expect(usePosCart.getState().lines).toEqual([]);
  });

  test('refuses a fractional quantity', () => {
    const { addItem, setQuantity } = usePosCart.getState();
    addItem(whey);
    expect(() => setQuantity('whey', 1.5)).toThrow(/whole number/);
  });
});
