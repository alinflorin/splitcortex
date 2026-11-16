import { Field, Input, makeStyles, tokens } from '@fluentui/react-components';
import { useTranslation } from 'react-i18next';
import type { Limits } from '../../api/schemas';
import { LIMIT_MAX, invalidLimits, type LimitsText } from '../../lib/limits';

const useStyles = makeStyles({
  root: { display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalM },
});

const FIELDS: (keyof Limits)[] = ['requestsPerMinute', 'tokensPerMinute', 'tokensPerDay'];

interface Props {
  value: LimitsText;
  onChange: (value: LimitsText) => void;
  disabled?: boolean;
}

/** The three rate limits as free-text numbers; empty means unlimited. Invalid input is flagged in place. */
export function LimitsFields({ value, onChange, disabled }: Props) {
  const styles = useStyles();
  const { t } = useTranslation();
  const invalid = invalidLimits(value);
  return (
    <div className={styles.root}>
      {FIELDS.map((f) => (
        <Field
          key={f}
          label={t(`limits.${f}`)}
          hint={t(`limits.${f}Hint`)}
          validationState={invalid.includes(f) ? 'error' : 'none'}
          validationMessage={
            invalid.includes(f) ? t('limits.invalid', { max: LIMIT_MAX[f] }) : undefined
          }
        >
          <Input
            inputMode="numeric"
            placeholder={t('limits.unlimited')}
            value={value[f]}
            disabled={disabled}
            onChange={(_, d) => onChange({ ...value, [f]: d.value })}
          />
        </Field>
      ))}
    </div>
  );
}
