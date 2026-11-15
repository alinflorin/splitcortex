// Debug builds only: trust CAs installed by the user (the local cert-manager root CA, see
// scripts/start-emulator.sh) in addition to the system ones. Android 7+ ignores user CAs unless an
// app opts in. Cleartext stays allowed because a network security config overrides the manifest's
// usesCleartextTraffic and the dev client loads the bundle from Metro over http. This is written to the `debug` source set, so release builds never trust user CAs.
const { withDangerousMod } = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

const NSC = `<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
    <base-config cleartextTrafficPermitted="true">
        <trust-anchors>
            <certificates src="system" />
            <certificates src="user" />
        </trust-anchors>
    </base-config>
</network-security-config>
`;

module.exports = function withDevUserCa(config) {
  return withDangerousMod(config, [
    'android',
    (cfg) => {
      const debugDir = path.join(cfg.modRequest.platformProjectRoot, 'app/src/debug');
      const xmlDir = path.join(debugDir, 'res/xml');
      fs.mkdirSync(xmlDir, { recursive: true });
      fs.writeFileSync(path.join(xmlDir, 'network_security_config.xml'), NSC);

      const manifest = path.join(debugDir, 'AndroidManifest.xml');
      let src = fs.readFileSync(manifest, 'utf8');
      if (!src.includes('networkSecurityConfig')) {
        src = src.replace(
          '<application ',
          '<application android:networkSecurityConfig="@xml/network_security_config" ',
        );
        src = src.replace(
          'tools:replace="android:usesCleartextTraffic"',
          'tools:replace="android:usesCleartextTraffic,android:networkSecurityConfig"',
        );
        fs.writeFileSync(manifest, src);
      }
      return cfg;
    },
  ]);
};
