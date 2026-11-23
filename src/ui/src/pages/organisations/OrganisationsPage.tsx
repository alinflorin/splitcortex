import { useEffect, useState } from 'react';
import { Badge, Button } from '@fluentui/react-components';
import { Add24Regular, Building24Regular } from '@fluentui/react-icons';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useCreateOrganisation, useOrganisations } from '../../api/hooks';
import { organisationFormSchema } from '../../api/schemas';
import type { OrganisationForm } from '../../api/schemas';
import { QueryBoundary } from '../../components/QueryBoundary';
import { PageHeader } from '../../components/layout/PageHeader';
import { EmptyState } from '../../components/cards/EmptyState';
import { CardList, ItemCard } from '../../components/cards/cards';
import { FormDialog } from '../../components/forms/FormDialog';
import { TextField } from '../../components/forms/TextField';
import { useToast } from '../../components/feedback/useToast';
import { slugify } from '../../lib/slugify';

export function OrganisationsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const toast = useToast();
  const query = useOrganisations();
  const create = useCreateOrganisation();
  const [open, setOpen] = useState(false);

  const form = useForm<OrganisationForm>({
    resolver: zodResolver(organisationFormSchema),
    mode: 'onTouched',
    defaultValues: { name: '', slug: '' },
  });

  // Suggest a slug from the name until the user edits the slug themselves.
  const name = form.watch('name');
  const slugEdited = form.formState.dirtyFields.slug;
  useEffect(() => {
    if (!slugEdited) form.setValue('slug', slugify(name));
  }, [name, slugEdited, form]);

  const close = () => {
    setOpen(false);
    form.reset();
  };
  const submit = form.handleSubmit((values) =>
    create.mutateAsync(values).then(
      (org) => {
        toast.success(t('organisations.created'));
        close();
        void navigate(`/organisations/${org.id}`);
      },
      () => undefined,
    ),
  );

  return (
    <>
      <PageHeader
        title={t('organisations.title')}
        subtitle={t('organisations.subtitle')}
        actions={
          <Button appearance="primary" icon={<Add24Regular />} onClick={() => setOpen(true)}>
            {t('organisations.new')}
          </Button>
        }
      />

      <QueryBoundary query={query}>
        {(orgs) =>
          orgs.length === 0 ? (
            <EmptyState
              icon={<Building24Regular />}
              text={t('organisations.empty')}
              actionLabel={t('organisations.new')}
              actionIcon={<Add24Regular />}
              onAction={() => setOpen(true)}
            />
          ) : (
            <CardList variant="grid">
              {orgs.map((org) => (
                <ItemCard
                  key={org.id}
                  title={org.name}
                  subtitle={org.slug}
                  meta={
                    <Badge appearance="tint" color="success">
                      {t(`roles.${org.role}`)}
                    </Badge>
                  }
                  onClick={() => void navigate(`/organisations/${org.id}`)}
                />
              ))}
            </CardList>
          )
        }
      </QueryBoundary>

      <FormDialog
        open={open}
        title={t('organisations.new')}
        submitLabel={t('common.create')}
        busy={create.isPending}
        onClose={close}
        onSubmit={(e) => void submit(e)}
      >
        <TextField control={form.control} name="name" label={t('organisations.name')} autoFocus />
        <TextField
          control={form.control}
          name="slug"
          label={t('organisations.slug')}
          hint={t('organisations.slugHint')}
        />
      </FormDialog>
    </>
  );
}
