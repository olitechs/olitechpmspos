import React from 'react';
import MenuManager from '@/components/pos/MenuManager';

export default function MenuTab() {
  return <div className="min-w-0">
    <MenuManager open embedded />
  </div>;
}
