import { create } from 'zustand';

/**
 * The bill being built at the till (the "cart").
 *
 * IMPORTANT: this store only holds what the cashier has picked, and shows a PREVIEW subtotal.
 * The server decides the real prices, discounts, GST and total when the bill is created; the numbers
 * here are never sent as the answer. (The preview also keeps working offline.)
 *
 * Money is whole PAISE (integers). Quantities are whole numbers of items.
 */
export interface CartLine {
  productId: string;
  name: string;
  quantity: number;
  /** Price of one item in paise, as last known by this screen. */
  unitPricePaise: number;
}

export type CartProduct = Pick<CartLine, 'productId' | 'name' | 'unitPricePaise'>;

interface PosCartState {
  lines: CartLine[];
  /** Add one of this product, or one more if it is already on the bill. */
  addItem: (product: CartProduct) => void;
  /** Set the quantity. Zero or less removes the line. */
  setQuantity: (productId: string, quantity: number) => void;
  removeItem: (productId: string) => void;
  clear: () => void;
}

export const usePosCart = create<PosCartState>()((set) => ({
  lines: [],

  addItem: (product) => {
    // A price like 12.5 paise or -3 is a bug in the caller, so fail loudly instead of billing wrongly.
    if (!Number.isSafeInteger(product.unitPricePaise) || product.unitPricePaise < 0) {
      throw new Error(
        `Unit price must be a whole number of paise, received ${product.unitPricePaise}.`,
      );
    }
    set((state) => {
      const existing = state.lines.find((line) => line.productId === product.productId);
      if (existing) {
        return {
          lines: state.lines.map((line) =>
            line.productId === product.productId ? { ...line, quantity: line.quantity + 1 } : line,
          ),
        };
      }
      return { lines: [...state.lines, { ...product, quantity: 1 }] };
    });
  },

  setQuantity: (productId, quantity) => {
    if (!Number.isSafeInteger(quantity))
      throw new Error(`Quantity must be a whole number, received ${quantity}.`);
    set((state) => ({
      lines:
        quantity <= 0
          ? state.lines.filter((line) => line.productId !== productId)
          : state.lines.map((line) =>
              line.productId === productId ? { ...line, quantity } : line,
            ),
    }));
  },

  removeItem: (productId) =>
    set((state) => ({ lines: state.lines.filter((line) => line.productId !== productId) })),

  clear: () => set({ lines: [] }),
}));

/** Price of one line in paise (preview). */
export function linePreviewPaise(line: CartLine): number {
  return line.unitPricePaise * line.quantity;
}

/** Sum of all lines in paise, before any discount or tax (preview). */
export function previewSubtotalPaise(lines: readonly CartLine[]): number {
  return lines.reduce((sum, line) => sum + linePreviewPaise(line), 0);
}
