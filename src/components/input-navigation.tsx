'use client';
import { useLayoutEffect } from 'react';
import { nexusInput } from '@/input/manager';
// Root InputSystem owns polling/navigation. Runtime adapters only declare their current scope.
export function InputNavigation({ suspended = false }: { suspended?: boolean }) {
  // Publish the new input scope before the menu is painted, so an immediate
  // Escape/Cancel is handled by the visible UI instead of the previous game scope.
  useLayoutEffect(() => nexusInput.acquire(suspended ? 'game' : 'ui'), [suspended]);
  return null;
}
