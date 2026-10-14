//repositories/local/LocalZoneSchemeRepository.js
// The coach's zone scheme on this device (localStorage, KEYS.ZONE_SCHEME).
import { storage, KEYS } from '../../lib/storage.js';
import { IZoneSchemeRepository } from '../interfaces/IZoneSchemeRepository.js';

export class LocalZoneSchemeRepository extends IZoneSchemeRepository {
  get() {
    return storage.get(KEYS.ZONE_SCHEME);
  }

  save(choice) {
    if (choice) storage.set(KEYS.ZONE_SCHEME, choice);
    else storage.remove(KEYS.ZONE_SCHEME);
  }
}
