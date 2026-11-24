import { ScrollView, View, type ScrollViewProps } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../theme/ThemeContext';
import { Backdrop } from './Backdrop';

export function Screen({ contentContainerStyle, ...rest }: ScrollViewProps) {
  const { theme: t } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1, backgroundColor: t.colorNeutralBackground1 }}>
      <Backdrop />
      <ScrollView
        {...rest}
        style={{ flex: 1 }}
        contentContainerStyle={[
          {
            padding: parseFloat(t.spacingHorizontalL),
            paddingBottom: insets.bottom + parseFloat(t.spacingVerticalXXL),
            gap: parseFloat(t.spacingVerticalL),
          },
          contentContainerStyle,
        ]}
      />
    </View>
  );
}
