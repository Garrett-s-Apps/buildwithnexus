import pkg from '../../package.json' assert { type: 'json' };

// Global injected by tsup at build time
declare const __BUILDWITHNEXUS_VERSION__: string;

/**
 * Resolve the application version.
 *
 * At build time tsup defines `__BUILDWITHNEXUS_VERSION__`; at dev time we
 * fall back to the version field in package.json.
 */
export const resolvedVersion: string =
  typeof __BUILDWITHNEXUS_VERSION__ !== 'undefined'
    ? __BUILDWITHNEXUS_VERSION__
    : pkg.version;
