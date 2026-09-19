const euros = new Intl.NumberFormat('es-ES', {
  style: 'currency',
  currency: 'EUR',
  // CLDR Spanish leaves 4-digit numbers ungrouped ("1234,56 €"); amounts of money read better grouped.
  useGrouping: 'always',
});

/** "1.234,56 €" */
export const formatEuros = (amount: number | string | { toString(): string }): string =>
  euros.format(Number(amount.toString()));
