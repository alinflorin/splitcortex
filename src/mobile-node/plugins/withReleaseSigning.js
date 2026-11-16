// Signs the Android release build with our own keystore, read from environment variables so no
// secret is ever committed: SC_KEYSTORE_FILE, SC_KEYSTORE_PASSWORD, SC_KEY_ALIAS, SC_KEY_PASSWORD.
// Without SC_KEYSTORE_FILE the release build falls back to the debug key (local builds).
const { withAppBuildGradle } = require('expo/config-plugins');

const RELEASE_CONFIG = `
        release {
            if (System.getenv('SC_KEYSTORE_FILE')) {
                storeFile file(System.getenv('SC_KEYSTORE_FILE'))
                storePassword System.getenv('SC_KEYSTORE_PASSWORD')
                keyAlias System.getenv('SC_KEY_ALIAS')
                keyPassword System.getenv('SC_KEY_PASSWORD')
            }
        }`;

module.exports = function withReleaseSigning(config) {
  return withAppBuildGradle(config, (cfg) => {
    let src = cfg.modResults.contents;
    if (src.includes('SC_KEYSTORE_FILE')) return cfg;

    // 1. add signingConfigs.release after the debug config
    const signing = /(signingConfigs\s*\{\s*debug\s*\{[^}]*\})/;
    if (!signing.test(src)) throw new Error('withReleaseSigning: signingConfigs.debug not found');
    src = src.replace(signing, `$1${RELEASE_CONFIG}`);

    // 2. use it in the release build type (the last debug signingConfig in the file)
    const useDebug = 'signingConfig signingConfigs.debug';
    const at = src.lastIndexOf(useDebug);
    if (at < src.indexOf('buildTypes')) {
      throw new Error('withReleaseSigning: release signingConfig not found');
    }
    src =
      src.slice(0, at) +
      "signingConfig System.getenv('SC_KEYSTORE_FILE') ? signingConfigs.release : signingConfigs.debug" +
      src.slice(at + useDebug.length);

    cfg.modResults.contents = src;
    return cfg;
  });
};
