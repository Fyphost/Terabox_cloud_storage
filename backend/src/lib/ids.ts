import { customAlphabet } from 'nanoid';

const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZabcdefghijkmnpqrstvwxyz';
const make = (size: number) => customAlphabet(alphabet, size);

const _media = make(20);
const _variant = make(20);
const _saved = make(20);
const _cache = make(20);
const _user = make(22);
const _session = make(24);
// Share tokens are 32 chars (~190 bits of entropy from a 54-symbol alphabet).
// Anyone holding a token can play the saved media; they MUST be unguessable.
const _share = make(32);

export const newMediaId = (): string => `med_${_media()}`;
export const newVariantId = (): string => `var_${_variant()}`;
export const newSavedId = (): string => `sav_${_saved()}`;
export const newCacheId = (): string => `cch_${_cache()}`;
export const newUserId = (): string => `usr_${_user()}`;
export const newSessionId = (): string => `ses_${_session()}`;
export const newShareToken = (): string => `sht_${_share()}`;
