import { Field, Input } from '@fluentui/react-components';
import type { Control, FieldPath, FieldValues } from 'react-hook-form';
import { Controller } from 'react-hook-form';
import { useTranslation } from 'react-i18next';

interface TextFieldProps<T extends FieldValues> {
  control: Control<T>;
  name: FieldPath<T>;
  label: string;
  type?: 'text' | 'email';
  hint?: string;
  autoFocus?: boolean;
}

/** A react-hook-form bound Fluent input; the zod message is an i18n key, translated here. */
export function TextField<T extends FieldValues>({
  control,
  name,
  label,
  type = 'text',
  hint,
  autoFocus,
}: TextFieldProps<T>) {
  const { t } = useTranslation();
  return (
    <Controller
      name={name}
      control={control}
      render={({ field, fieldState }) => (
        <Field
          label={label}
          required
          hint={hint}
          validationState={fieldState.error ? 'error' : 'none'}
          validationMessage={fieldState.error?.message ? t(fieldState.error.message) : undefined}
        >
          <Input
            {...field}
            type={type}
            autoFocus={autoFocus}
            value={field.value as string}
            onChange={(_, d) => field.onChange(d.value)}
          />
        </Field>
      )}
    />
  );
}
