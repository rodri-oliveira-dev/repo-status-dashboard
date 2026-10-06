import { isValidReleaseVersion } from './release-version.mjs';

const version = process.argv[2];

if (!version || !isValidReleaseVersion(version)) {
  console.error(
    'Version must use valid SemVer 2.0.0 with a v prefix (for example, v1.2.3 or v1.2.3-rc.1+build.5).',
  );
  process.exitCode = 1;
} else {
  console.log(`Release version ${version} is valid.`);
}
