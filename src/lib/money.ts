const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

// Money is integer cents everywhere; dollars exist only in the displayed text.
export const formatCents = (cents: number) => usd.format(cents / 100);
