import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Application from 'expo-application';
import * as Device from 'expo-device';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform, View } from 'react-native';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { Screen } from '../components/Screen';
import { Text } from '../components/Text';
import { TextField } from '../components/TextField';
import { EnrollError, enroll, type EnrollErrorKind } from '../enrollment/client';
import { formatCodeInput, parseCode, parseEnrollLink } from '../enrollment/crypto';
import { getOrCreateIdentity } from '../enrollment/identity';
import { saveEnrollment } from '../enrollment/store';
import { useTheme } from '../theme/ThemeContext';

/** Default control plane (BFF) URL; editable on the screen for self-hosted or LAN deployments. */
export const DEFAULT_ENROLLMENT_URL =
  process.env.EXPO_PUBLIC_ENROLLMENT_URL ?? 'https://app.prd.splitcortex.com/api';

export default function Enroll() {
  const { t } = useTranslation();
  const { theme } = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ url?: string; code?: string }>();
  const [code, setCode] = useState(formatCodeInput(params.code ?? ''));
  const [url, setUrl] = useState(params.url ?? DEFAULT_ENROLLMENT_URL);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<EnrollErrorKind | null>(null);
  const [scanning, setScanning] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();
  const scanned = useRef(false);

  // A deep link (`splitcortex://enroll?...`) opens this screen with the values filled in.
  useEffect(() => {
    if (params.code) setCode(formatCodeInput(params.code));
    if (params.url) setUrl(params.url);
  }, [params.code, params.url]);

  const valid = parseCode(code) !== null && /^https?:\/\//i.test(url.trim());

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const identity = await getOrCreateIdentity();
      const baseUrl = url.trim();
      const result = await enroll({
        baseUrl,
        code,
        identity,
        device: {
          name: Device.deviceName ?? undefined,
          platform: Platform.OS,
          deviceModel: Device.modelName ?? undefined,
          osVersion: Device.osVersion ?? undefined,
          appVersion: Application.nativeApplicationVersion ?? undefined,
          memoryTotalMb: Device.totalMemory
            ? Math.round(Device.totalMemory / 1024 ** 2)
            : undefined,
        },
      });
      await saveEnrollment({
        ...result,
        enrollmentUrl: baseUrl,
        enrolledAt: new Date().toISOString(),
      });
      // Pop back to the existing Home; replacing would leave two Home screens in the stack. When the
      // screen was opened by a deep link there is nothing to pop, so replace instead.
      if (router.canGoBack()) router.back();
      else router.replace('/');
    } catch (e) {
      setError(e instanceof EnrollError ? e.kind : 'server');
    } finally {
      setBusy(false);
    }
  };

  const startScan = async () => {
    if (!permission?.granted && !(await requestPermission()).granted) return;
    scanned.current = false;
    setScanning(true);
  };

  return (
    <Screen keyboardShouldPersistTaps="handled">
      <Card>
        <Text variant="subtitle">{t('enroll.title')}</Text>
        <Text muted>{t('enroll.intro')}</Text>
        <TextField
          label={t('enroll.code')}
          value={code}
          onChangeText={(v) => setCode(formatCodeInput(v))}
          placeholder="XXXX-XXXXXX"
          autoCapitalize="characters"
          autoCorrect={false}
          maxLength={11}
          mono
        />
        {scanning ? (
          <View style={{ height: 260, overflow: 'hidden', borderRadius: 12 }}>
            <CameraView
              style={{ flex: 1 }}
              barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
              onBarcodeScanned={({ data }) => {
                const link = parseEnrollLink(data);
                if (!link || scanned.current) return;
                scanned.current = true;
                setCode(formatCodeInput(link.code));
                setUrl(link.url);
                setScanning(false);
              }}
            />
          </View>
        ) : (
          <Button label={t('enroll.scan')} onPress={() => void startScan()} />
        )}
        {permission && !permission.granted && !permission.canAskAgain && (
          <Text variant="caption" muted>
            {t('enroll.noCamera')}
          </Text>
        )}
        <TextField
          label={t('enroll.url')}
          hint={t('enroll.urlHint')}
          value={url}
          onChangeText={setUrl}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
        />
        {error && (
          <Text
            variant="caption"
            style={{ color: theme.colorPaletteRedForeground1 }}
            accessibilityRole="alert"
          >
            {t(`enroll.errors.${error}`)}
          </Text>
        )}
        <Button
          appearance="primary"
          label={t('enroll.submit')}
          disabled={!valid}
          loading={busy}
          onPress={() => void submit()}
        />
      </Card>
    </Screen>
  );
}
