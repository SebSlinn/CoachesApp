//repositories/local/LocalRegisterStore.js
// What a register needs on the phone to work with no signal, in one localStorage key
// (KEYS.REGISTERS_OFFLINE):
//   { userId, preparedAt, groups:[…register_prepare groups…],
//     sheets:  { [registerKey]: sheet }            last copy from the server, or one made on the phone
//     pending: { [registerKey]: { registerId|null, create|null, ops:[…], close:null|{force} } }
//     failed:  [{ registerKey, op, error, at }]    taps the database refused when they were sent
//     moved:   { 'local:…': realRegisterId } }     a phone-made register after its first sync
// registerKey = the register's id, or 'local:<client_uuid>' until the server has made it.
// Only this file (and lib/storage.js) touches localStorage for registers.
import { storage, KEYS } from '../../lib/storage';

const EMPTY = { userId: null, preparedAt: null, groups: [], sheets: {}, pending: {}, failed: [], moved: {} };

export class LocalRegisterStore {
  read() {
    const m = storage.get(KEYS.REGISTERS_OFFLINE);
    return m ? { ...EMPTY, ...m } : { ...EMPTY };
  }

  write(pState) { storage.set(KEYS.REGISTERS_OFFLINE, pState); }

  // Read–change–write in one go. pFn gets a copy and returns the new state.
  update(pFn) {
    const mNext = pFn(structuredCloneSafe(this.read()));
    this.write(mNext);
    return mNext;
  }

  clear() { storage.remove(KEYS.REGISTERS_OFFLINE); }

  // Is this person still signed in on this device (a Supabase session is stored, maybe expired)?
  // Used only to keep the register usable offline when the token can't be refreshed.
  hasDeviceSession(pUserId) {
    if (!pUserId) return false;
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k || !/^sb-.*-auth-token$/.test(k)) continue;
        const v = JSON.parse(localStorage.getItem(k) || 'null');
        const id = v?.user?.id || v?.currentSession?.user?.id;
        if (id === pUserId) return true;
      }
    } catch (e) { /* ignore */ }
    return false;
  }
}

function structuredCloneSafe(v) {
  try { return structuredClone(v); } catch (e) { return JSON.parse(JSON.stringify(v)); }
}
