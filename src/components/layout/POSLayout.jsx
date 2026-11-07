import React from 'react';
import AppShell from './AppShell';

/**
 * POS keeps its own floor/order/bill controls inside POSContainer.
 * The workspace shell intentionally supplies no global workspace switcher or
 * generic sidebar; POS navigation and content remain entirely self-contained.
 */
export default function POSLayout() {
  return <AppShell workspace="pos" />;
}
