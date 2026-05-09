// chrome-extension/reader/lib/constants.ts
//
// Shared product constants. Pulling these into one place so cap/quota tweaks
// don't require sed across components, i18n, and spec.

// Free-tier cross-device sync cap. Library entries beyond this point stay
// local-only on the originating device — see spec §7.4 Option B.
export const FREE_LIBRARY_CAP = 16;
