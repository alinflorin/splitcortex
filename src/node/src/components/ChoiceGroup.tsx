import { Pressable, View } from 'react-native';
import { useTheme } from '../theme/ThemeContext';
import { Text } from './Text';

export interface Choice<T extends string> {
  value: T;
  label: string;
}

/** Radio-style list used for the theme and language pickers. */
export function ChoiceGroup<T extends string>({
  label,
  choices,
  value,
  onChange,
}: {
  label: string;
  choices: readonly Choice<T>[];
  value: T;
  onChange: (value: T) => void;
}) {
  const { theme: t } = useTheme();
  return (
    <View accessibilityRole="radiogroup" style={{ gap: 4 }}>
      <Text variant="subtitle">{label}</Text>
      {choices.map((c) => {
        const selected = c.value === value;
        return (
          <Pressable
            key={c.value}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            onPress={() => onChange(c.value)}
            style={{ minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 12 }}
          >
            <View
              style={{
                width: 20,
                height: 20,
                borderRadius: 10,
                borderWidth: 1,
                borderColor: selected ? t.colorCompoundBrandStroke : t.colorNeutralStrokeAccessible,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {selected ? (
                <View
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: 5,
                    backgroundColor: t.colorCompoundBrandForeground1,
                  }}
                />
              ) : null}
            </View>
            <Text>{c.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}
