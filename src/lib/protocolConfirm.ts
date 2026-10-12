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
