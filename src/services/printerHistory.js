/**
 * Reads the property's print-job history from the cloud so the printers page
 * can show per-printer health even when this computer's agent has nothing in
 * its local queue (for example a printer that only serves the kitchen tablet).
 *
 * `fnb_print_jobs` is the durable job table the printer agent claims from, so
 * it holds both jobs printed by this browser and jobs printed by a paired
 * workstation while the browser was closed.
 */
import { supabase } from '@/lib/supabaseClient';
import {
  HISTORY_MAX_JOBS,
  HISTORY_WINDOW_DAYS,
  groupJobsByPrinter,
  historyWindowStart,
} from './printerHistoryCore.js';

export const PRINT_HISTORY_COLUMNS = 'id,printer_id,status,title,assignment_type,copy_type,error_message,created_at,printed_at,last_attempt_at';

export function emptyPrintHistory({ days = HISTORY_WINDOW_DAYS, now = new Date() } = {}) {
  return {
    jobs: [],
    byPrinter: {},
    since: historyWindowStart(now, days).toISOString(),
    days,
  };
}

export async function fetchPrinterHistory({
  propertyId,
  printerIds = [],
  client = supabase,
  days = HISTORY_WINDOW_DAYS,
  limit = HISTORY_MAX_JOBS,
  now = new Date(),
} = {}) {
  const since = historyWindowStart(now, days);
  if (!propertyId) return emptyPrintHistory({ days, now });

  const rows = Math.min(500, Math.max(1, Number(limit) || HISTORY_MAX_JOBS));
  let query = client
    .from('fnb_print_jobs')
    .select(PRINT_HISTORY_COLUMNS)
    .eq('property_id', propertyId)
    .gte('created_at', since.toISOString())
    .order('created_at', { ascending: false })
    .limit(rows);

  const ids = (Array.isArray(printerIds) ? printerIds : []).filter(Boolean);
  if (ids.length) query = query.in('printer_id', ids);

  const { data, error } = await query;
  if (error) throw new Error(error.message || 'Print history could not be loaded.');

  const jobs = Array.isArray(data) ? data : [];
  return { jobs, byPrinter: groupJobsByPrinter(jobs), since: since.toISOString(), days };
}
