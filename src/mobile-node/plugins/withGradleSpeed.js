// Gradle settings that make the Android build faster (applied by `expo prebuild`, which regenerates
// android/gradle.properties on every run, so editing that file would be lost):
// - bigger heap and Metaspace: the default 512m Metaspace made the daemon die during R8 in release builds
//   ("Daemon will be stopped ... running out of JVM Metaspace"), which costs a restart;
// - the Gradle build cache, so tasks with unchanged inputs are reused between builds;
// - only the ABIs the engine supports (default would be all four).
const { withGradleProperties } = require('expo/config-plugins');

const PROPS = {
  'org.gradle.jvmargs': '-Xmx4g -XX:MaxMetaspaceSize=1g -XX:+UseParallelGC',
  'org.gradle.caching': 'true',
  // LiteRT-LM only ships these two ABIs, so armeabi-v7a and x86 builds could never run the engine.
  // Overridable per build: ./gradlew ... -PreactNativeArchitectures=x86_64
  reactNativeArchitectures: 'arm64-v8a,x86_64',
};

module.exports = function withGradleSpeed(config) {
  return withGradleProperties(config, (cfg) => {
    for (const [key, value] of Object.entries(PROPS)) {
      const existing = cfg.modResults.find((p) => p.type === 'property' && p.key === key);
      if (existing) existing.value = value;
      else cfg.modResults.push({ type: 'property', key, value });
    }
    return cfg;
  });
};
