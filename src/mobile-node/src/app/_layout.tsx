import '../polyfills';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useTranslation } from 'react-i18next';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Brand } from '../components/Brand';
import '../i18n';
import { fontAssets, fontFamilyForWeight } from '../theme/fonts';
import { useEffect } from 'react';
import { nodeService } from '../native/nodeService';
import { runtime } from '../runtime';
import { loadSettings } from '../runtime/settings';
import { ThemeProvider, useTheme } from '../theme/ThemeContext';

/** Starts the node service when the app starts, if the settings say so (default: yes). */
function useAutoStart() {
  useEffect(() => {
    void loadSettings().then((s) => {
      void nodeService.setStartAtBoot(s.startAtBoot); // the boot receiver reads its own copy
      if (s.connectOnStart) void runtime.start();
    });
  }, []);
}

function Shell() {
  useAutoStart();
  const { theme: t, mode } = useTheme();
  const { t: tr } = useTranslation();
  return (
    <>
      <StatusBar style={mode === 'dark' ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: t.colorNeutralBackground1 },
          headerTintColor: t.colorNeutralForeground1,
          headerTitleStyle: { fontFamily: fontFamilyForWeight(t.fontWeightSemibold) },
          headerShadowVisible: false,
          contentStyle: { backgroundColor: t.colorNeutralBackground1 },
        }}
      >
        <Stack.Screen
          name="index"
          options={{ title: tr('app.name'), headerTitle: () => <Brand /> }}
        />
        <Stack.Screen name="enroll" options={{ title: tr('enroll.title') }} />
        <Stack.Screen name="logs" options={{ title: tr('nav.logs') }} />
        <Stack.Screen name="settings" options={{ title: tr('nav.settings') }} />
      </Stack>
    </>
  );
}

export default function RootLayout() {
  const [loaded] = useFonts(fontAssets);
  if (!loaded) return null;
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <Shell />
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
