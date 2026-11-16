import { Switch, View } from 'react-native';
import { useTheme } from '../theme/ThemeContext';
import { Text } from './Text';

/** A label with an explanation and a switch. */
export function ToggleRow({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint?: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  const { theme: t } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="subtitle">{label}</Text>
        {hint ? (
          <Text variant="caption" muted>
            {hint}
          </Text>
        ) : null}
      </View>
      <Switch
        accessibilityLabel={label}
        value={value}
        onValueChange={onChange}
        trackColor={{ true: t.colorBrandBackground, false: t.colorNeutralStroke1 }}
      />
    </View>
  );
}
