// Contract for open sign-up (root's switch): is it on, switching it, parents signing up, adding a
// child, and root's list of recent sign-ups. The rules live in the database
// (supabase/migrations/20261025120000_open_signup.sql) and the self-signup Edge Function.
// Every method resolves to { data, error } — never throws.
export class ISignupRepository {
  /** → boolean (works signed out) */
  async isOpen() { throw new Error('ISignupRepository.isOpen not implemented'); }
  /** root only → boolean */
  async setOpen(_open) { throw new Error('ISignupRepository.setOpen not implemented'); }
  /** root only → [{ user_id, name, email, kind: parent|child, added_by_name, created_at }] */
  async recent(_days) { throw new Error('ISignupRepository.recent not implemented'); }
  /** { email, fullName, website } → { ok, user_id } */
  async signUp(_person) { throw new Error('ISignupRepository.signUp not implemented'); }
  /** { email, fullName, dateOfBirth } → { ok, user_id } (signed in) */
  async addChild(_child) { throw new Error('ISignupRepository.addChild not implemented'); }
}
