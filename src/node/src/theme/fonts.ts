import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
} from '@expo-google-fonts/inter';

/** Bundled with the app (no network). Keys are the family names used in styles. */
export const fontAssets = {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
};

/** Fluent font weight tokens (400/500/600/700) mapped to the matching Inter family. */
export function fontFamilyForWeight(weight: string | number): string {
  switch (String(weight)) {
    case '500':
      return 'Inter_500Medium';
    case '600':
      return 'Inter_600SemiBold';
    case '700':
    case '800':
      return 'Inter_700Bold';
    default:
      return 'Inter_400Regular';
  }
}
