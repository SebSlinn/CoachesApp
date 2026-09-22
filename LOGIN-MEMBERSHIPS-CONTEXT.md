# SwimZone — Login & Memberships Module Context

Upload this file + the listed source files to work on auth, user profiles,
or club memberships/roles in a focused thread. No zones, no sets, no athlete
parsing logic needed here.

See `MODULE-SPLIT-PLAN.md` for how this module fits alongside the other four.

---

## What this module does

1. Signs a coach/admin/athlete in and out via Supabase Auth (email/password).
2. On sign-in, fetches (or creates) that user's profile row.
3. Fetches their club memberships and role(s) (`admin` / `coach` / `manager`
   / `athlete`) and exposes `isAdmin` / `isCoach` / `isManager` / `isAthlete`
   flags.
4. Gates every other route in the app (`/dashboard`, `/classifier`,
   `/athlete-setup`, `/set-builder`) behind a signed-in session.

It has no localStorage footprint — everything here lives in Supabase.

---

## Files in this module

```
src/supabaseClient.js         — Supabase client singleton (createClient)
src/services/auth.js          — signIn, signOut, getSession, onAuthChange
src/services/users.js         — getProfile, createProfile, getMemberships
src/hooks/useAuth.js          — orchestrates the three services above into
                                 { user, profile, memberships, loading,
                                   isAdmin, isCoach, isManager, isAthlete }
src/components/ProtectedRoute.jsx — redirects to /login if useAuth().user is null
src/pages/Login.jsx           — email/password form, calls signIn()
src/pages/Dashboard.jsx       — landing page after login, calls signOut()
```

Everything above is live and imported. Nothing in this module is dead code.

---

## Database shape (Supabase)

Inferred from the queries in `services/users.js` — confirm against your
actual schema/migrations before relying on it:

```
users            id (uuid, = auth user id), email, full_name
memberships      id, user_id → users.id, role, status,
                  organisation_id → organisations.id
organisations    id, name, org_type
```

`getMemberships()` only returns rows where `status = 'active'`.

---

## Core API reference

```js
// services/auth.js
signIn(email, password)   → { data, error }   // supabase.auth.signInWithPassword
signOut()                 → { data, error }   // supabase.auth.signOut
getSession()               → { data, error }   // supabase.auth.getSession
onAuthChange(callback)     → { data: { subscription } }

// services/users.js
getProfile(userId)                       → { data, error }   // users table, .single()
createProfile(userId, email, fullName)   → { data, error }   // insert into users
getMemberships(userId)                   → { data, error }   // memberships + organisations join

// hooks/useAuth.js
useAuth() → {
  user, profile, memberships, loading,
  isAdmin, isCoach, isManager, isAthlete,   // derived: memberships.some(m => m.role === X)
}
```

All three service files degrade to a safe "unavailable" response
(`{ data: null, error: { message } }`) when `VITE_SUPABASE_URL` /
`VITE_SUPABASE_ANON_KEY` aren't set — `supabase` is `null` in that case.
Preserve that guard if you touch `auth.js` or `users.js`.

---

## Layering note (see MODULE-SPLIT-PLAN.md)

`services/auth.js` and `services/users.js` currently call `supabase.*`
directly — there's no repository indirection yet. If/when you add one:

```js
// repositories/authRepository.js   — wraps supabase.auth.*
// repositories/membershipRepository.js — wraps users/memberships/organisations tables
```

`services/auth.js` and `services/users.js` would then call the repository
instead of `supabase` directly; their exported function signatures
(`signIn`, `signOut`, `getSession`, `onAuthChange`, `getProfile`,
`createProfile`, `getMemberships`) should stay the same so `useAuth.js`
doesn't need to change at all.

---

## Rules for this module

1. Zero React state lives outside `useAuth.js` — `Login.jsx` and
   `Dashboard.jsx` are thin, they don't duplicate session state.
2. Never read `memberships`/`role` logic into the zones/session/athlete
   modules — if a feature needs "is this user a coach," it should ask
   `useAuth()`, not re-derive it.
3. Keep the four service function signatures stable — other files aren't
   in this pack, but `hooks/useAuth.js` is the one consumer and it destructures
   these exact names.
4. `supabase` can be `null` (env vars missing) — every function here must
   keep degrading gracefully rather than throwing.
