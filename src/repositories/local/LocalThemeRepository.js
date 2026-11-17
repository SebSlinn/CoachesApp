// repositories/local/LocalThemeRepository.js
// The light / dark choice on this device (localStorage, KEYS.THEME).
import { storage, KEYS } from '../../lib/storage.js';
import { IThemeRepository } from '../interfaces/IThemeRepository.js';

export class LocalThemeRepository extends IThemeRepository {
  get() { return storage.get(KEYS.THEME); }
  save(choice) {
    if (choice) storage.set(KEYS.THEME, choice);
    else storage.remove(KEYS.THEME);
  }
}
