#!/usr/bin/env bash
# Creates the Android release keystore and (optionally) stores it as GitHub Actions secrets.
#
#   scripts/create-keystore.sh            create the keystore in ~/splitcortex-keystore
#   scripts/create-keystore.sh --upload   also run `gh secret set` for the repository
#
# Back up the output folder somewhere safe (password manager, encrypted drive): if the keystore
# is lost, installed apps can never be updated with a new build. Never commit it.
set -euo pipefail

dir="${KEYSTORE_DIR:-$HOME/splitcortex-keystore}"
alias_name="splitcortex-node"
file="$dir/release.jks"

if [[ -e "$file" ]]; then
  echo "Refusing to overwrite $file" >&2
  exit 1
fi

umask 077
mkdir -p "$dir"
# PKCS12 keystores use one password for the store and the key.
password="$(openssl rand -base64 24 | tr -d '/+=' | cut -c1-24)"

keytool -genkeypair -v \
  -keystore "$file" -storetype PKCS12 \
  -alias "$alias_name" -keyalg RSA -keysize 4096 -validity 36500 \
  -storepass "$password" -keypass "$password" \
  -dname "CN=SplitCortex Node, O=SplitCortex"

cat > "$dir/secrets.env" <<ENV
ANDROID_KEYSTORE_FILE=$file
ANDROID_KEYSTORE_PASSWORD=$password
ANDROID_KEY_ALIAS=$alias_name
ANDROID_KEY_PASSWORD=$password
ENV

echo
echo "Keystore: $file"
echo "Passwords and alias: $dir/secrets.env (keep it with the keystore)"

if [[ "${1:-}" == "--upload" ]]; then
  base64 -w0 "$file" | gh secret set ANDROID_KEYSTORE_BASE64
  gh secret set ANDROID_KEYSTORE_PASSWORD --body "$password"
  gh secret set ANDROID_KEY_ALIAS --body "$alias_name"
  gh secret set ANDROID_KEY_PASSWORD --body "$password"
  echo "GitHub secrets set."
else
  echo "Run again with --upload (from a clone with gh logged in) to set the GitHub secrets,"
  echo "or set ANDROID_KEYSTORE_BASE64 (base64 -w0 of the .jks), ANDROID_KEYSTORE_PASSWORD,"
  echo "ANDROID_KEY_ALIAS and ANDROID_KEY_PASSWORD yourself."
fi
