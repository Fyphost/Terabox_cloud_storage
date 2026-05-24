import { customAlphabet } from 'nanoid';

const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZabcdefghijkmnpqrstvwxyz';
const make = (size: number) => customAlphabet(alphabet, size);

const _media = make(20);
const _variant = make(20);
const _saved = make(20);
const _savedVariant = make(20);
const _cache = make(20);
const _user = make(22);
const _session = make(24);

export const newMediaId = (): string => `med_${_media()}`;
export const newVariantId = (): string => `var_${_variant()}`;
export const newSavedId = (): string => `sav_${_saved()}`;
export const newSavedVariantId = (): string => `svr_${_savedVariant()}`;
export const newCacheId = (): string => `cch_${_cache()}`;
export const newUserId = (): string => `usr_${_user()}`;
export const newSessionId = (): string => `ses_${_session()}`;
