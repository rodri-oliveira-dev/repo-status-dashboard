// SemVer 2.0.0 identifiers, with the repository's required `v` tag prefix.
// Numeric pre-release identifiers cannot contain leading zeroes. Build metadata
// may contain them, as allowed by the specification.
const RELEASE_VERSION_PATTERN =
  /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

export function isValidReleaseVersion(version) {
  return RELEASE_VERSION_PATTERN.test(version);
}
