import * as source from '../../parsers/shared/archive/zipBombGuard.js';
import { __resolveModule } from '../../utils/moduleOverrides.js';
import * as I18nStatic from '../../utils/i18n.js';
export { MAX_ZIP_SIZE, MAX_ENTRY_COUNT, MAX_TOTAL_UNCOMPRESSED } from '../../parsers/shared/archive/zipBombGuard.js';
export type { ZipBombGuardModule } from '../../parsers/shared/archive/zipBombGuard.js';
function translator(): source.ZipGuardTranslator | undefined {
    const i18n = __resolveModule('I18n', I18nStatic);
    return i18n && typeof i18n.t === 'function' ? (key, ...args) => i18n.t(key, ...args) : undefined;
}
/** Keep the existing localized application errors outside the raw archive validator. */
export function validateZipFile(file?: unknown): void { source.validateZipFile(file, translator()); }
export function validateZipEntries(zip?: unknown): void { source.validateZipEntries(zip, translator()); }
export const ZipBombGuard: source.ZipBombGuardModule = {
    MAX_ZIP_SIZE: source.MAX_ZIP_SIZE, MAX_ENTRY_COUNT: source.MAX_ENTRY_COUNT,
    MAX_TOTAL_UNCOMPRESSED: source.MAX_TOTAL_UNCOMPRESSED, validateZipFile, validateZipEntries,
};
export default ZipBombGuard;
