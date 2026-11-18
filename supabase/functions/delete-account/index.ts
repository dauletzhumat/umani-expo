// delete-account (PRD AUTH-4, DATABASE.md §7): verify the caller, then purge their data with the
// service role through api.purge_account (service_role only). Logs carry no PII.
import { createClient } from 'npm:@supabase/supabase-js@2';

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function env(name: string): string {
  const value = Deno.env.get(name);
  if (value === undefined || value === '') throw new Error(`missing env ${name}`);
  return value;
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const authorization = request.headers.get('Authorization');
  if (authorization === null) return json({ error: 'unauthorized' }, 401);

  const url = env('SUPABASE_URL');
  // Resolve the user from their own JWT (the gateway has already verified its signature).
  const asUser = createClient(url, env('SUPABASE_ANON_KEY'), {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false },
  });
  const { data, error } = await asUser.auth.getUser();
  if (error !== null || data.user === null) return json({ error: 'unauthorized' }, 401);

  // TODO(staging): revoke the user's Sign in with Apple token before deletion. It needs the
  // Apple private key (Edge Function secret), which is configured with the staging project.

  const admin = createClient(url, env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });
  const { error: purgeError } = await admin.schema('api').rpc('purge_account', { p_user_id: data.user.id });
  if (purgeError !== null) {
    console.error('delete-account: purge failed', purgeError.code);
    return json({ error: 'failed' }, 500);
  }

  console.log('delete-account: account deleted');
  return json({ ok: true }, 200);
});
