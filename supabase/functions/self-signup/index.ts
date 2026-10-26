// ============================================================================
// SwimZone — Edge Function: self-signup   (DECISIONS 2026-10-25, migration 20261025120000_open_signup)
//
// Only works while root has switched "Open sign-up" on (system_settings.open_signup).
//
//   { action: 'signup', email, full_name }                 — no sign-in needed: a parent creates
//        their own account. Supabase emails them a link to set a password (/set-password).
//   { action: 'add_child', email, full_name, date_of_birth } — signed in: an adult adds their child.
//        The child gets the same email; the parent is their guardian at once.
//
// Every rule (open?, known email?, adult parent?, under 18?, daily limits) is checked in the
// database (validate_self_signup / validate_child_addition) BEFORE any email is sent, and again
// when recording. This function only exists because creating sign-ins needs the service-role key,
// which must never be in the browser.
//
// Deploy (sign-up has no signed-in user, so the gateway must not demand one):
//     supabase functions deploy self-signup --no-verify-jwt
// Env: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY (automatic);
//      SITE_URL — the app's address, e.g. https://swimzone.vercel.app (same as add-athlete).
//
// Response 200: { ok: true, user_id }     Errors: { error: 'CODE: words' } with 400/401/403/409/429
// ============================================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-region, x-supabase-api-version',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

function statusFor(message: string): number {
  switch (message.split(':')[0]) {
    case 'NOT_ALLOWED': return 403;
    case 'SIGNUP_CLOSED': return 403;
    case 'ALREADY_REGISTERED': return 409;
    case 'RATE_LIMIT': return 429;
    default: return 400;
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return reply('ok');
  if (req.method !== 'POST') return reply({ error: 'INVALID: POST only' }, 405);

  const url = Deno.env.get('SUPABASE_URL')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return reply({ error: 'INVALID: body must be JSON' }, 400); }

  // A field people never see. Bots fill it in: pretend all went well and do nothing.
  if (String(body.website ?? '').trim()) return reply({ ok: true });

  const action = String(body.action ?? '');
  const email = String(body.email ?? '').trim().toLowerCase();
  const fullName = String(body.full_name ?? '').trim().slice(0, 120);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return reply({ error: 'INVALID: a valid email is required' }, 400);
  if (!fullName) return reply({ error: 'INVALID: a name is required' }, 400);

  const baseUrl = (Deno.env.get('SITE_URL') || req.headers.get('origin') || '').replace(/\/+$/, '');
  const invite = () => admin.auth.admin.inviteUserByEmail(email, {
    data: { full_name: fullName },
    ...(baseUrl ? { redirectTo: `${baseUrl}/set-password` } : {}),
  });

  // ---- a parent signs up --------------------------------------------------------------
  if (action === 'signup') {
    const { data: problem, error: vErr } = await admin.rpc('validate_self_signup', { p_email: email });
    if (vErr) return reply({ error: `INVALID: ${vErr.message}` }, 500);
    if (problem) return reply({ error: problem }, statusFor(problem));

    const { data: invited, error: invErr } = await invite();
    if (invErr || !invited?.user) return reply({ error: `INVALID: invite failed — ${invErr?.message ?? 'unknown error'}` }, 400);

    const { error } = await admin.rpc('record_self_signup', { p_user: invited.user.id, p_email: email, p_full_name: fullName });
    if (error) {
      await admin.auth.admin.deleteUser(invited.user.id);   // no orphan sign-in
      return reply({ error: error.message }, statusFor(error.message));
    }
    return reply({ ok: true, user_id: invited.user.id });
  }

  // ---- a signed-in adult adds their child ----------------------------------------------
  if (action === 'add_child') {
    const asCaller = createClient(url, anonKey, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } });
    const { data: { user: parent }, error: authErr } = await asCaller.auth.getUser();
    if (authErr || !parent) return reply({ error: 'NOT_ALLOWED: sign in first' }, 401);

    const dob = String(body.date_of_birth ?? '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dob)) return reply({ error: 'INVALID: the child\'s date of birth is needed (YYYY-MM-DD)' }, 400);
    if (email === (parent.email ?? '').toLowerCase()) return reply({ error: 'INVALID: your child needs their own email (try you+name@…)' }, 400);

    const { data: problem, error: vErr } = await admin.rpc('validate_child_addition', { p_parent: parent.id, p_email: email, p_date_of_birth: dob });
    if (vErr) return reply({ error: `INVALID: ${vErr.message}` }, 500);
    if (problem) return reply({ error: problem }, statusFor(problem));

    const { data: invited, error: invErr } = await invite();
    if (invErr || !invited?.user) return reply({ error: `INVALID: invite failed — ${invErr?.message ?? 'unknown error'}` }, 400);

    const { error } = await admin.rpc('record_child_addition', {
      p_parent: parent.id, p_child: invited.user.id, p_email: email, p_full_name: fullName, p_date_of_birth: dob,
    });
    if (error) {
      await admin.auth.admin.deleteUser(invited.user.id);
      return reply({ error: error.message }, statusFor(error.message));
    }
    return reply({ ok: true, user_id: invited.user.id });
  }

  return reply({ error: 'INVALID: action must be signup or add_child' }, 400);
});
