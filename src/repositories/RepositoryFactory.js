//repositories/RepositoryFactory.js
// Single place that decides which concrete repository backs each interface.
// services/auth.js and services/users.js call these getters instead of
// reaching into supabaseClient.js themselves. Swapping backends later
// (or adding a MockAuthRepository for tests) means changing this file only.
import { SupabaseAuthRepository } from './supabase/SupabaseAuthRepository';
import { SupabaseMembershipRepository } from './supabase/SupabaseMembershipRepository';
import { LocalAthleteRepository } from './local/LocalAthleteRepository';
import { LocalSessionRepository } from './local/LocalSessionRepository';
import { SupabaseGroupRepository } from './supabase/SupabaseGroupRepository';
import { SupabaseLogSharingRepository } from './supabase/SupabaseLogSharingRepository';
import { SupabaseSponsorshipRepository } from './supabase/SupabaseSponsorshipRepository';
import { SupabaseResultsRepository } from './supabase/SupabaseResultsRepository';
import { SupabaseProtocolsRepository } from './supabase/SupabaseProtocolsRepository';
import { SupabaseAthleteProfileRepository } from './supabase/SupabaseAthleteProfileRepository';
import { LocalZoneSchemeRepository } from './local/LocalZoneSchemeRepository';
import { SupabaseRegisterRepository } from './supabase/SupabaseRegisterRepository';

let authRepository = null;
let membershipRepository = null;
let athleteRepository = null;
let sessionRepository = null;
let groupRepository = null;
let logSharingRepository = null;
let sponsorshipRepository = null;
let resultsRepository = null;
let protocolsRepository = null;
let athleteProfileRepository = null;
let zoneSchemeRepository = null;
let registerRepository = null;

export function getAuthRepository() {
  if (!authRepository) authRepository = new SupabaseAuthRepository();
  return authRepository;
}

export function getMembershipRepository() {
  if (!membershipRepository) membershipRepository = new SupabaseMembershipRepository();
  return membershipRepository;
}

export function getAthleteRepository() {
  if (!athleteRepository) athleteRepository = new LocalAthleteRepository();
  return athleteRepository;
}

export function getSessionRepository() {
  if (!sessionRepository) sessionRepository = new LocalSessionRepository();
  return sessionRepository;
}

// ---- user accounts (added 2026-09-24; groups reworked 2026-10-15) — server-only by nature: the
// permission rules live in the database, so there are no Local versions.
export function getGroupRepository() {
  if (!groupRepository) groupRepository = new SupabaseGroupRepository();
  return groupRepository;
}

export function getLogSharingRepository() {
  if (!logSharingRepository) logSharingRepository = new SupabaseLogSharingRepository();
  return logSharingRepository;
}

// ---- sponsorship (added 2026-10-15) — who may bring NEW people in; was the
// adding-rights grant tree. Server-only: the rules live in the database.
export function getSponsorshipRepository() {
  if (!sponsorshipRepository) sponsorshipRepository = new SupabaseSponsorshipRepository();
  return sponsorshipRepository;
}

export function getResultsRepository() {
  if (!resultsRepository) resultsRepository = new SupabaseResultsRepository();
  return resultsRepository;
}

// ---- Test Set Library (added 2026-09-30) — server-only: visibility follows
// group membership (parent groups included), which lives in the database.
export function getProtocolsRepository() {
  if (!protocolsRepository) protocolsRepository = new SupabaseProtocolsRepository();
  return protocolsRepository;
}

// ---- Athlete profiles (added 2026-10-06) — per-athlete coaching judgements
// (type, PHV) keyed by athlete id; server-only so they follow the athlete
// across coaches and devices. Access rules (has_log_access) live in the DB.
export function getAthleteProfileRepository() {
  if (!athleteProfileRepository) athleteProfileRepository = new SupabaseAthleteProfileRepository();
  return athleteProfileRepository;
}

// ---- Zone colour scheme (added 2026-10-14) — the coach's display choice
// (contracts/ZONES.md). This device only for now; a Supabase version (per coach,
// with a club default) replaces it here once Accounts adds the column/table.
export function getZoneSchemeRepository() {
  if (!zoneSchemeRepository) zoneSchemeRepository = new LocalZoneSchemeRepository();
  return zoneSchemeRepository;
}

// ---- Registers (added 2026-10-22) — attendance and sign-out. Server-only for now: the rules
// (take_register, members only) live in the database. A local outbox can wrap it later (phase 4).
export function getRegisterRepository() {
  if (!registerRepository) registerRepository = new SupabaseRegisterRepository();
  return registerRepository;
}
