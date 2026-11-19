// sync-reference-rates (PRD ACC-4, INC-4): fetch the National Bank of Kazakhstan's official rates
// and upsert them into public.reference_rates. Called by a daily scheduler, never by the app.
//
// Auth: a dedicated secret (SYNC_RATES_SECRET), not the service role key, so the god key never
// sits in scheduler config. The gateway's JWT check is off for this function (config.toml), so
// this comparison is the only gate and it fails closed. Logs carry counts and codes only.
import { createClient } from 'npm:@supabase/supabase-js@2';

import { daysBetween, feedDate, isIsoDate, isPlausibleMove, parseNbkRates } from './parse.ts';

const FEED_URL = 'https://nationalbank.kz/rss/get_rates.cfm?fdate=';
const FETCH_TIMEOUT_MS = 10_000;
const MAX_FEED_BYTES = 1_000_000;
const MAX_REQUEST_BYTES = 1_000;
const MAX_BACKFILL_DAYS = 400;
const MAX_FEED_LAG_DAYS = 7; // weekends and holidays: the feed may carry an earlier date

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function env(name: string): string {
  const value = Deno.env.get(name);
  if (value === undefined || value === '') throw new Error(`missing env ${name}`);
  return value;
}

/** Constant-time comparison, so the secret can't be guessed byte by byte from response timing. */
function sameSecret(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

/** Today's date in Kazakhstan (the feed is published per Almaty calendar day). */
function todayInAlmaty(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Almaty' }).format(new Date());
}

/** Reads a body as text, giving up past `limit` bytes instead of buffering whatever arrives. */
async function readCapped(body: ReadableStream<Uint8Array> | null, limit: number): Promise<string | null> {
  if (body === null) return '';
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const all = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    all.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(all);
}

/** The date to fetch: today, or {"date": "YYYY-MM-DD"} to backfill a missed day. */
async function requestedDate(request: Request, today: string): Promise<string | null> {
  const text = await readCapped(request.body, MAX_REQUEST_BYTES);
  if (text === null) return null;
  if (text.trim() === '') return today;
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return null;
  }
  if (body === null || typeof body !== 'object') return null;
  if (!('date' in body)) return today;
  const date = (body as { date: unknown }).date;
  if (typeof date !== 'string' || !isIsoDate(date)) return null;
  const age = daysBetween(date, today);
  return age >= 0 && age <= MAX_BACKFILL_DAYS ? date : null;
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  if (!sameSecret(request.headers.get('Authorization') ?? '', `Bearer ${env('SYNC_RATES_SECRET')}`)) {
    return json({ error: 'unauthorized' }, 401);
  }

  const date = await requestedDate(request, todayInAlmaty());
  if (date === null) return json({ error: 'invalid_date' }, 400);

  const admin = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false },
  });
  const { data: currencies, error: currencyError } = await admin.from('currencies').select('code');
  if (currencyError !== null) {
    console.error('sync-reference-rates: currencies read failed', currencyError.code);
    return json({ error: 'failed' }, 500);
  }
  const wanted = new Set(currencies.map((row) => String(row.code)).filter((code) => code !== 'KZT'));

  let xml: string | null;
  try {
    const response = await fetch(FEED_URL + feedDate(date), { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!response.ok) {
      console.error('sync-reference-rates: feed returned', response.status);
      return json({ error: 'feed_unavailable' }, 502);
    }
    xml = await readCapped(response.body, MAX_FEED_BYTES);
  } catch {
    console.error('sync-reference-rates: feed unreachable');
    return json({ error: 'feed_unavailable' }, 502);
  }
  if (xml === null) {
    console.error('sync-reference-rates: feed too large');
    return json({ error: 'feed_too_large' }, 502);
  }

  const parsed = parseNbkRates(xml, wanted);
  if (!parsed.ok) {
    console.error('sync-reference-rates: parse failed', parsed.error);
    return json({ error: parsed.error }, 502);
  }
  const { rateDate, rates } = parsed.value;
  const lag = daysBetween(rateDate, date);
  if (lag < 0 || lag > MAX_FEED_LAG_DAYS) {
    console.error('sync-reference-rates: unexpected feed date, lag', lag);
    return json({ error: 'unexpected_feed_date' }, 502);
  }

  // Skip rates that jumped implausibly against the previous stored rate (garbage or spoofed feed).
  const rows = [];
  let skipped = 0;
  for (const rate of rates) {
    const { data: previous, error: previousError } = await admin
      .from('reference_rates')
      .select('kzt_per_unit')
      .eq('currency', rate.currency)
      .lt('rate_date', rateDate)
      .order('rate_date', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (previousError !== null) {
      console.error('sync-reference-rates: previous rate read failed', previousError.code);
      return json({ error: 'failed' }, 500);
    }
    if (!isPlausibleMove(previous === null ? null : String(previous.kzt_per_unit), rate.kztPerUnit)) {
      skipped += 1;
      continue;
    }
    rows.push({
      currency: rate.currency,
      rate_date: rateDate,
      kzt_per_unit: rate.kztPerUnit,
      source: 'nbk',
      fetched_at: new Date().toISOString(),
    });
  }

  if (rows.length > 0) {
    const { error: upsertError } = await admin.from('reference_rates').upsert(rows, { onConflict: 'currency,rate_date' });
    if (upsertError !== null) {
      console.error('sync-reference-rates: upsert failed', upsertError.code);
      return json({ error: 'failed' }, 500);
    }
  }

  console.log('sync-reference-rates: stored', rows.length, 'skipped', skipped, 'for', rateDate);
  return json({ ok: true, rate_date: rateDate, stored: rows.length, skipped }, 200);
});
