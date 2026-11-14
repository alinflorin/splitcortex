import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useTranslation } from 'react-i18next';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import '../i18n';
import { fontAssets, fontFamilyForWeight } from '../theme/fonts';
import { ThemeProvider, useTheme } from '../theme/ThemeContext';

function Shell() {
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
          contentStyle: { backgroundColor: t.colorNeutralBackground2 },
        }}
      >
        <Stack.Screen name="index" options={{ title: tr('app.name') }} />
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
