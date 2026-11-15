// Menu prices are entered excluding VAT and VAT is added to the running ticket
// total. 16% matches the `property_settings` default for resident guests; it is
// a named constant so the ticket and its label can never drift apart.
export const VAT_RATE = 0.16;

export const VAT_LABEL = `VAT ${Math.round(VAT_RATE * 100)}%`;

export const addVat = (subtotal) => Math.round(subtotal * VAT_RATE);
