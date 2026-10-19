const REQUIRED_PLATFORMS = ['linux/amd64', 'linux/arm64'];

export function checkImagePlatforms(rawManifest) {
  let manifest;
  try {
    manifest = JSON.parse(rawManifest);
  } catch {
    throw new Error('Image manifest is not valid JSON');
  }

  if (!manifest || !Array.isArray(manifest.manifests)) {
    throw new Error('Image manifest index is missing manifests');
  }

  const available = new Set(
    manifest.manifests
      .map((entry) => {
        const platform = entry?.platform;
        return platform?.os && platform?.architecture
          ? `${platform.os}/${platform.architecture}`
          : null;
      })
      .filter(Boolean)
  );
  const missing = REQUIRED_PLATFORMS.filter((platform) => !available.has(platform));
  if (missing.length) throw new Error(`Image manifest missing required platform: ${missing.join(', ')}`);

  return REQUIRED_PLATFORMS;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;

  try {
    const platforms = checkImagePlatforms(input);
    console.log(`Image manifest includes: ${platforms.join(', ')}`);
  } catch (error) {
    console.error(`Image manifest check failed: ${error instanceof Error ? error.message : 'unknown error'}`);
    process.exitCode = 1;
  }
}
import { pathToFileURL } from 'node:url';

