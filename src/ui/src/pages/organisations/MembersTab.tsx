import { useState } from 'react';
import {
  Badge,
  Button,
  Dropdown,
  Field,
  Option,
  makeStyles,
  tokens,
} from '@fluentui/react-components';
import { Add24Regular, Delete20Regular } from '@fluentui/react-icons';
import { zodResolver } from '@hookform/resolvers/zod';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useAddMember, useMembers, useRemoveMember, useUpdateMemberRole } from '../../api/hooks';
import { addMemberFormSchema } from '../../api/schemas';
import type { AddMemberForm, Member, OrgRole } from '../../api/schemas';
import { useCurrentUser } from '../../auth/useCurrentUser';
import { QueryBoundary } from '../../components/QueryBoundary';
import { CardList, ItemCard } from '../../components/cards/cards';
import { useConfirm } from '../../components/feedback/useConfirm';
import { useToast } from '../../components/feedback/useToast';
import { FormDialog } from '../../components/forms/FormDialog';
import { TextField } from '../../components/forms/TextField';
import { assignableRoles, canManage, isAdmin } from '../../lib/roles';
import { useOrganisationContext } from './OrganisationLayout';

const useStyles = makeStyles({
  toolbar: { display: 'flex', justifyContent: 'flex-end', marginBottom: tokens.spacingVerticalL },
  roleDropdown: { minWidth: '120px' },
});

export function MembersTab() {
  const styles = useStyles();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const org = useOrganisationContext();
  const me = useCurrentUser()?.email?.toLowerCase();
  const admin = isAdmin(org.role);
  const query = useMembers(org.id);
  const add = useAddMember(org.id);
  const updateRole = useUpdateMemberRole(org.id);
  const remove = useRemoveMember(org.id);
  const confirm = useConfirm();
  const toast = useToast();
  const [open, setOpen] = useState(false);

  const roles = assignableRoles(org.role);
  const form = useForm<AddMemberForm>({
    resolver: zodResolver(addMemberFormSchema),
    mode: 'onTouched',
    defaultValues: { email: '', role: 'member' },
  });

  const close = () => {
    setOpen(false);
    form.reset();
  };
  const submit = form.handleSubmit(async (values) => {
    try {
      await add.mutateAsync(values);
      toast.success(t('members.added'));
      close();
    } catch {
      // error toast shown by the mutation cache
    }
  });

  const changeRole = (m: Member, role: OrgRole) => {
    if (role === m.role) return;
    updateRole.mutate(
      { email: m.email, role },
      { onSuccess: () => toast.success(t('members.roleChanged')) },
    );
  };

  const onRemove = async (m: Member) => {
    const self = m.email === me;
    const ok = await confirm({
      title: t(self ? 'members.leaveTitle' : 'members.removeTitle', { email: m.email }),
      message: t(self ? 'members.leaveMessage' : 'members.removeMessage'),
      confirmLabel: t(self ? 'members.leave' : 'members.remove'),
      destructive: true,
    });
    if (!ok) return;
    try {
      await remove.mutateAsync(m.email);
      toast.success(t(self ? 'members.left' : 'members.removed'));
      if (self) void navigate('/organisations');
    } catch {
      // error toast shown by the mutation cache
    }
  };

  return (
    <>
      {admin && (
        <div className={styles.toolbar}>
          <Button appearance="primary" icon={<Add24Regular />} onClick={() => setOpen(true)}>
            {t('members.add')}
          </Button>
        </div>
      )}

      <QueryBoundary query={query}>
        {(members) => (
          <CardList>
            {members.map((m) => {
              const self = m.email === me;
              const editable = admin && canManage(org.role, m.role);
              return (
                <ItemCard
                  key={m.email}
                  title={
                    <>
                      {m.email} {self && <Badge appearance="outline">{t('members.you')}</Badge>}
                    </>
                  }
                  subtitle={`${t('common.created')} ${new Date(m.createdAt).toLocaleDateString()}`}
                  meta={
                    editable ? (
                      <Dropdown
                        className={styles.roleDropdown}
                        aria-label={t('members.role')}
                        value={t(`roles.${m.role}`)}
                        selectedOptions={[m.role]}
                        onOptionSelect={(_, d) => changeRole(m, d.optionValue as OrgRole)}
                      >
                        {roles.map((r) => (
                          <Option key={r} value={r}>
                            {t(`roles.${r}`)}
                          </Option>
                        ))}
                      </Dropdown>
                    ) : (
                      <Badge appearance="tint">{t(`roles.${m.role}`)}</Badge>
                    )
                  }
                  actions={
                    (self || editable) && (
                      <Button
                        appearance="subtle"
                        icon={<Delete20Regular />}
                        aria-label={t(self ? 'members.leave' : 'members.remove')}
                        onClick={() => void onRemove(m)}
                      />
                    )
                  }
                />
              );
            })}
          </CardList>
        )}
      </QueryBoundary>

      <FormDialog
        open={open}
        title={t('members.add')}
        submitLabel={t('members.add')}
        busy={add.isPending}
        onClose={close}
        onSubmit={(e) => void submit(e)}
      >
        <TextField
          control={form.control}
          name="email"
          type="email"
          label={t('members.email')}
          hint={t('members.emailHint')}
          autoFocus
        />
        <Controller
          name="role"
          control={form.control}
          render={({ field }) => (
            <Field label={t('members.role')}>
              <Dropdown
                value={t(`roles.${field.value}`)}
                selectedOptions={[field.value]}
                onOptionSelect={(_, d) => field.onChange(d.optionValue as OrgRole)}
              >
                {roles.map((r) => (
                  <Option key={r} value={r}>
                    {t(`roles.${r}`)}
                  </Option>
                ))}
              </Dropdown>
            </Field>
          )}
        />
      </FormDialog>
    </>
  );
}
