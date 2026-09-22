//repositories/RepositoryFactory.js
// Single place that decides which concrete repository backs each interface.
// services/auth.js and services/users.js call these getters instead of
// reaching into supabaseClient.js themselves. Swapping backends later
// (or adding a MockAuthRepository for tests) means changing this file only.
import { SupabaseAuthRepository } from './supabase/SupabaseAuthRepository';
import { SupabaseMembershipRepository } from './supabase/SupabaseMembershipRepository';
import { LocalAthleteRepository } from './local/LocalAthleteRepository';
import { LocalSessionRepository } from './local/LocalSessionRepository';

let authRepository = null;
let membershipRepository = null;
let athleteRepository = null;
let sessionRepository = null;

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
