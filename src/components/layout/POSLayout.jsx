import React from 'react';
import AppShell from './AppShell';

/**
 * POS keeps its own floor/order/bill controls inside POSContainer.
 * The workspace shell supplies the global workspace switcher only; hiding
 * its generic sidebar prevents a second, unrelated navigation system.
 */
export default function POSLayout() {
  return <AppShell workspace="pos" />;
}
