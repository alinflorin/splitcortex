import { useRef, useState } from 'react';
import {
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Field,
  MessageBar,
  MessageBarBody,
  ProgressBar,
  Tab,
  TabList,
  Text,
  makeStyles,
  tokens,
} from '@fluentui/react-components';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import {
  useAddModelFromUrl,
  useCompleteModelUpload,
  useDeleteModel,
  usePartUploader,
  useStartModelUpload,
} from '../../api/hooks';
import { MODEL_EXTENSION, modelFromUrlFormSchema, modelUploadFormSchema } from '../../api/schemas';
import type { ModelFromUrlForm, ModelUploadForm } from '../../api/schemas';
import { useToast } from '../../components/feedback/useToast';
import { TextField } from '../../components/forms/TextField';
import { formatBytes } from '../../lib/format';
import { uploadParts } from '../../lib/uploadParts';

const MAX_BYTES = 32 * 1024 ** 3;

const useStyles = makeStyles({
  fields: { display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalL },
  progress: { display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalXS },
});

type Mode = 'url' | 'upload';

/** Add a model from a Hugging Face URL (mirrored by the platform) or by uploading a .litertlm file. */
export function AddModelDialog({
  orgId,
  open,
  onClose,
}: {
  orgId: string;
  open: boolean;
  onClose: () => void;
}) {
  const styles = useStyles();
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const [mode, setMode] = useState<Mode>('url');
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [uploaded, setUploaded] = useState<number | null>(null);
  const abort = useRef<AbortController | null>(null);
  const uploading = uploaded !== null;

  const addFromUrl = useAddModelFromUrl(orgId);
  const startUpload = useStartModelUpload(orgId);
  const completeUpload = useCompleteModelUpload(orgId);
  const partUploader = usePartUploader(orgId);
  const deleteModel = useDeleteModel(orgId);

  const urlForm = useForm<ModelFromUrlForm>({
    resolver: zodResolver(modelFromUrlFormSchema),
    mode: 'onTouched',
    defaultValues: { name: '', url: '' },
  });
  const uploadForm = useForm<ModelUploadForm>({
    resolver: zodResolver(modelUploadFormSchema),
    mode: 'onTouched',
    defaultValues: { name: '' },
  });

  const reset = () => {
    urlForm.reset();
    uploadForm.reset();
    setFile(null);
    setFileError(null);
    setUploaded(null);
  };
  const close = () => {
    if (uploading) abort.current?.abort(); // the upload handler cleans the half-created model up
    reset();
    onClose();
  };

  const pickFile = (f: File | undefined) => {
    setFile(f ?? null);
    if (!f) return setFileError(null);
    if (!f.name.toLowerCase().endsWith(MODEL_EXTENSION)) setFileError(t('validation.modelFile'));
    else if (f.size === 0 || f.size > MAX_BYTES) setFileError(t('models.fileSize'));
    else {
      setFileError(null);
      if (!uploadForm.getValues('name'))
        uploadForm.setValue('name', f.name.slice(0, -MODEL_EXTENSION.length), {
          shouldValidate: true,
        });
    }
  };

  const submitUrl = urlForm.handleSubmit(async (values) => {
    try {
      await addFromUrl.mutateAsync(values);
      toast.success(t('models.added'));
      reset();
      onClose();
    } catch {
      // error toast shown by the mutation cache
    }
  });

  const submitUpload = uploadForm.handleSubmit(async ({ name }) => {
    if (!file || fileError) return setFileError(file ? fileError : t('validation.required'));
    const ac = new AbortController();
    abort.current = ac;
    setUploaded(0);
    let modelId: string | null = null;
    try {
      const plan = await startUpload.mutateAsync({
        name,
        fileName: file.name,
        sizeBytes: file.size,
      });
      modelId = plan.model.id;
      const parts = await uploadParts(file, plan, {
        put: partUploader(plan.model.id),
        signal: ac.signal,
        onProgress: setUploaded,
      });
      await completeUpload.mutateAsync({ modelId, parts });
      toast.success(t('models.uploaded'));
      reset();
      onClose();
    } catch (err) {
      // Never leave a half-uploaded model (and its open multipart upload) behind.
      if (modelId) await deleteModel.mutateAsync(modelId).catch(() => undefined);
      if (!ac.signal.aborted)
        toast.error(t('models.uploadFailed'), { body: (err as Error).message });
      setUploaded(null);
    }
  });

  const busy = addFromUrl.isPending || startUpload.isPending || uploading;

  return (
    <Dialog open={open} modalType="alert" onOpenChange={(_, d) => !d.open && close()}>
      <DialogSurface>
        <form noValidate onSubmit={(e) => void (mode === 'url' ? submitUrl(e) : submitUpload(e))}>
          <DialogBody>
            <DialogTitle>{t('models.add')}</DialogTitle>
            <DialogContent className={styles.fields}>
              <TabList
                selectedValue={mode}
                onTabSelect={(_, d) => !uploading && setMode(d.value as Mode)}
              >
                <Tab value="url">{t('models.fromUrl')}</Tab>
                <Tab value="upload">{t('models.fromUpload')}</Tab>
              </TabList>

              {mode === 'url' ? (
                <>
                  <TextField
                    control={urlForm.control}
                    name="name"
                    label={t('models.name')}
                    autoFocus
                  />
                  <TextField
                    control={urlForm.control}
                    name="url"
                    label={t('models.hfUrl')}
                    hint={t('models.hfUrlHint')}
                  />
                </>
              ) : (
                <>
                  <TextField control={uploadForm.control} name="name" label={t('models.name')} />
                  <Field
                    label={t('models.file')}
                    required
                    hint={t('models.fileHint')}
                    validationState={fileError ? 'error' : 'none'}
                    validationMessage={fileError ?? undefined}
                  >
                    <input
                      type="file"
                      accept={MODEL_EXTENSION}
                      disabled={uploading}
                      onChange={(e) => pickFile(e.target.files?.[0])}
                    />
                  </Field>
                  {uploading && file && (
                    <div className={styles.progress}>
                      <ProgressBar value={uploaded / file.size} thickness="large" />
                      <Text size={200}>
                        {formatBytes(uploaded, i18n.language)} /{' '}
                        {formatBytes(file.size, i18n.language)}
                      </Text>
                      <MessageBar intent="info">
                        <MessageBarBody>{t('models.keepOpen')}</MessageBarBody>
                      </MessageBar>
                    </div>
                  )}
                </>
              )}
            </DialogContent>
            <DialogActions>
              <Button appearance="secondary" onClick={close}>
                {t('common.cancel')}
              </Button>
              <Button appearance="primary" type="submit" disabled={busy}>
                {t(mode === 'url' ? 'models.addUrl' : 'models.upload')}
              </Button>
            </DialogActions>
          </DialogBody>
        </form>
      </DialogSurface>
    </Dialog>
  );
}
