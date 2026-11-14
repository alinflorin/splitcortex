import type { ConfigContext, ExpoConfig } from 'expo/config';

// app.json holds the static config. CI passes APP_VERSION (the tag without the `v`) so the app
// version follows the release; the Android versionCode is derived from it (X.Y.Z -> X*10000 +
// Y*100 + Z) and so always grows with the tag. Without it (local builds) app.json is used as is.
export default ({ config }: ConfigContext): ExpoConfig => {
  const version = process.env.APP_VERSION;
  if (!version) return config as ExpoConfig;
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!m) throw new Error(`APP_VERSION must be X.Y.Z, got "${version}"`);
  const [major, minor, patch] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (minor > 99 || patch > 99) throw new Error('minor and patch must be <= 99 (versionCode)');
  return {
    ...config,
    name: config.name ?? 'SplitCortex Node',
    slug: config.slug ?? 'splitcortex-node',
    version,
    android: { ...config.android, versionCode: major * 10000 + minor * 100 + patch },
    ios: { ...config.ios, buildNumber: version },
  };
};
