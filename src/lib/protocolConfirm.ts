/**
 * What the operator must confirm before a protocol is executed. The app has
 * no stored product or occupancy settings yet, so each execution asks for
 * them: the pool is unoccupied or closed, circulation is running, and the
 * products (with strengths) for any chemical step are named.
 */
export interface ProtocolConfirmInput {
  unoccupied: boolean;
  circulating: boolean;
  /** Free text naming each product and its strength, e.g. "10% liquid chlorine". */
  products: string;
}

export const MIN_PRODUCT_DESCRIPTION_LENGTH = 3;

export function isProtocolConfirmReady(input: ProtocolConfirmInput): boolean {
  return (
    input.unoccupied &&
    input.circulating &&
    input.products.trim().length >= MIN_PRODUCT_DESCRIPTION_LENGTH
  );
}

/** The part of an inventory item these helpers read. */
export interface StockedProduct {
  name: string;
  concentrationPct?: number;
}

/**
 * Stocked products for the AI prompt. A product with no recorded strength is
 * listed as such, so the model knows it cannot dose that product from a strength.
 */
export function formatStockForPrompt(stock: StockedProduct[]): string {
  if (stock.length === 0) return 'none recorded';
  return stock
    .map((item) => (item.concentrationPct != null
      ? `- ${item.name}, ${item.concentrationPct}% strength`
      : `- ${item.name}, strength not recorded`))
    .join('\n');
}

/**
 * Prefill for the confirmation's product field: each stocked product with a
 * recorded strength, e.g. "10% Chlorine Granules, 31% Muriatic Acid".
 */
export function suggestedProductsFromStock(stock: StockedProduct[]): string {
  return stock
    .filter((item) => item.concentrationPct != null)
    .map((item) => `${item.concentrationPct}% ${item.name}`)
    .join(', ');
}
