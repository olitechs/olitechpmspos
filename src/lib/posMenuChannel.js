import { supabase } from '@/lib/supabaseClient';

/**
 * Lightweight cross-terminal menu sync.
 *
 * A property-scoped broadcast channel is used instead of a Postgres change
 * subscription on `products`, because every POS sale updates stock on that
 * table; subscribing there would refresh the menu on every sale. Broadcasting
 * only when a manager actually changes the menu keeps traffic proportional to
 * edits. If Realtime is unavailable the calls are no-ops and the local
 * `olitech:menu-updated` event still refreshes the current terminal.
 */
const channelName = (propertyId) => `olitech-pos-menu:${propertyId}`;

export function notifyPosMenuChanged(propertyId) {
  if (!propertyId) return;
  try {
    const channel = supabase.channel(channelName(propertyId));
    channel.subscribe((status) => {
      if (status !== 'SUBSCRIBED') return;
      Promise.resolve(channel.send({ type: 'broadcast', event: 'menu-changed', payload: { at: Date.now() } }))
        .catch(() => {})
        .finally(() => {
          window.setTimeout(() => { try { supabase.removeChannel(channel); } catch { /* already removed */ } }, 1500);
        });
    });
  } catch {
    /* Realtime is optional; the local refresh already happened. */
  }
}

export function subscribePosMenuChanges(propertyId, onChange) {
  if (!propertyId || typeof onChange !== 'function') return () => {};
  try {
    const channel = supabase
      .channel(channelName(propertyId))
      .on('broadcast', { event: 'menu-changed' }, () => onChange())
      .subscribe();
    return () => { try { supabase.removeChannel(channel); } catch { /* already removed */ } };
  } catch {
    return () => {};
  }
}
