// ============================================================================
// SwimZone — Edge Function: add-athlete
//
// Adds an athlete to a group on behalf of the signed-in admin.
//   • New email   → sends a Supabase invite email, creates the profile.
//   • Known email → just adds them to the group (no new account).
// All permission, rate-limit and guardian checks run in the database
// (validate_athlete_addition / record_athlete_addition) so they can't be
// bypassed. This function only exists because creating auth users needs the
// service-role key, which must never be in the browser.
//
// Deploy:  supabase functions deploy add-athlete
// Env:     SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY (set automatically)
//          SITE_URL (recommended) — the app's live address, e.g. https://swimzone.vercel.app
//          (invitations link to SITE_URL + '/set-password')
//
// POST body:
//   { organisation_id, email, full_name, date_of_birth: 'YYYY-MM-DD',
//     guardian_emails?: string[] }
// Response 200: { user_id, new_account, pending_guardians }
// Errors:       { error: 'CODE: message' } with 400 / 403 / 404 / 429
// ============================================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function reply(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

function statusFor(message: string): number {
  const code = message.split(':')[0];
  switch (code) {
    case 'NOT_ALLOWED':      return 403;
    case 'RATE_LIMIT':       return 429;
    case 'USER_NOT_FOUND':
    case 'NOT_FOUND':        return 404;
    default:                 return 400;
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return reply('ok');
  if (req.method !== 'POST') return reply({ error: 'INVALID: POST only' }, 405);

  const url = Deno.env.get('SUPABASE_URL')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  // 1. Who is calling? (verified from their JWT, never from the body)
  const authHeader = req.headers.get('Authorization') ?? '';
  const asCaller = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } } });
  const { data: { user: caller }, error: authErr } = await asCaller.auth.getUser();
  if (authErr || !caller) return reply({ error: 'NOT_ALLOWED: sign in first' }, 401);

  // 2. Input
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return reply({ error: 'INVALID: body must be JSON' }, 400); }

  const orgId = String(body.organisation_id ?? '');
  const email = String(body.email ?? '').trim().toLowerCase();
  const fullName = String(body.full_name ?? '').trim();
  const dob = body.date_of_birth ? String(body.date_of_birth) : null;
  const guardianEmails = Array.isArray(body.guardian_emails)
    ? (body.guardian_emails as unknown[]).map((e) => String(e).trim().toLowerCase()).filter(Boolean)
    : [];

  if (!orgId) return reply({ error: 'INVALID: organisation_id is required' }, 400);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return reply({ error: 'INVALID: a valid email is required' }, 400);
  if (dob && !/^\d{4}-\d{2}-\d{2}$/.test(dob)) return reply({ error: 'INVALID: date_of_birth must be YYYY-MM-DD' }, 400);
  if (guardianEmails.includes(email)) return reply({ error: 'INVALID: an athlete cannot be their own guardian' }, 400);

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

  // 3. Existing account?
  const { data: existingId, error: findErr } = await admin.rpc('find_user_by_email', { p_email: email });
  if (findErr) return reply({ error: `INVALID: ${findErr.message}` }, 500);

  // 4. Check everything BEFORE sending any email
  const { data: problem, error: valErr } = await admin.rpc('validate_athlete_addition', {
    p_actor: caller.id,
    p_org: orgId,
    p_date_of_birth: dob,
    p_guardian_emails: guardianEmails,
    p_existing_user: existingId ?? null,
  });
  if (valErr) return reply({ error: `INVALID: ${valErr.message}` }, 500);
  if (problem) return reply({ error: problem }, statusFor(problem));

  // 5. Existing user → just record the membership (+ any guardians)
  if (existingId) {
    const { data, error } = await admin.rpc('record_athlete_addition', {
      p_actor: caller.id, p_org: orgId, p_user_id: existingId, p_email: email,
      p_full_name: fullName || null, p_date_of_birth: dob,
      p_guardian_emails: guardianEmails, p_new_account: false,
    });
    if (error) return reply({ error: error.message }, statusFor(error.message));
    return reply({ ...data, new_account: false });
  }

  // 6. New user → invite, then record; undo the invite if recording fails
  if (!fullName) return reply({ error: 'INVALID: full_name is required for a new athlete' }, 400);

  // Invitation link lands on the app's set-password page. SITE_URL (a function
  // secret, e.g. https://swimzone.vercel.app) wins; otherwise the address the
  // admin is using. Either must be in Auth → URL Configuration → Redirect URLs.
  const baseUrl = (Deno.env.get('SITE_URL') || req.headers.get('origin') || '').replace(/\/+$/, '');
  const { data: invited, error: inviteErr } = await admin.auth.admin.inviteUserByEmail(email, {
    data: { full_name: fullName },
    ...(baseUrl ? { redirectTo: `${baseUrl}/set-password` } : {}),
  });
  if (inviteErr || !invited?.user) {
    return reply({ error: `INVALID: invite failed — ${inviteErr?.message ?? 'unknown error'}` }, 400);
  }

  const { data, error } = await admin.rpc('record_athlete_addition', {
    p_actor: caller.id, p_org: orgId, p_user_id: invited.user.id, p_email: email,
    p_full_name: fullName, p_date_of_birth: dob,
    p_guardian_emails: guardianEmails, p_new_account: true,
  });
  if (error) {
    await admin.auth.admin.deleteUser(invited.user.id);   // compensate: no orphan auth user
    return reply({ error: error.message }, statusFor(error.message));
  }
  return reply({ ...data, new_account: true });
});
