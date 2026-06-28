// @ts-nocheck
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { format, parseISO } from 'date-fns';
import { Clock, Download, FileText, Search, Upload, Loader2, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/app/components/ui/button';
import { Input } from '@/app/components/ui/input';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger,
} from '@/app/components/ui/sheet';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from '@/app/components/ui/alert-dialog';
import { documentsApi } from '@/app/api/endpoints/documents';

function formatFileSize(bytes: number): string {
  if (!bytes) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function UploadHistoryDrawer() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['upload-history'],
    queryFn: () => documentsApi.list({ source_type: 'upload', page_size: 50 }),
    enabled: open,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => documentsApi.delete(id),
    onSuccess: () => {
      toast.success(t('generatorV1.uploadHistory.deleteSuccess'));
      queryClient.invalidateQueries({ queryKey: ['upload-history'] });
      queryClient.invalidateQueries({ queryKey: ['documents'] });
      setDeleteTarget(null);
    },
    onError: () => {
      toast.error(t('generatorV1.uploadHistory.deleteError'));
    },
  });

  const handleDownload = async (id: string, name: string) => {
    setDownloadingId(id);
    try {
      await documentsApi.download(id, name);
    } catch {
      toast.error(t('generatorV1.uploadHistory.downloadError'));
    } finally {
      setDownloadingId(null);
    }
  };

  const allFiles = (data?.items ?? []).map(d => ({
    id: d.id,
    name: d.original_filename || d.title,
    uploadedAt: d.created_at ? format(parseISO(d.created_at), 'dd/MM/yyyy HH:mm') : '—',
    size: formatFileSize(d.file_size),
    type: (d.extension ?? '').toUpperCase(),
  }));

  const filtered = allFiles.filter(f => f.name.toLowerCase().includes(search.toLowerCase()));

  return (
    <>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>
          <Button variant="outline" size="sm" className="gap-1.5 text-xs h-8">
            <Clock className="w-3.5 h-3.5" />{t('generatorV1.uploadHistory.triggerBtn')}
            {allFiles.length > 0 && (
              <span className="ml-0.5 bg-primary/10 text-primary text-[10px] font-semibold px-1.5 py-0.5 rounded-full">{allFiles.length}</span>
            )}
          </Button>
        </SheetTrigger>
        <SheetContent side="right" className="w-[min(440px,100vw)] p-0 flex flex-col h-full overflow-hidden">
          <SheetHeader className="px-5 pt-5 pb-3 border-b border-border flex-shrink-0">
            <SheetTitle className="text-base">{t('generatorV1.uploadHistory.drawerTitle')}</SheetTitle>
          </SheetHeader>
          <div className="px-5 py-3 border-b border-border flex-shrink-0">
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input className="pl-8 h-8 text-xs" placeholder={t('generatorV1.uploadHistory.searchPlaceholder')} value={search} onChange={e => setSearch(e.target.value)} />
            </div>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto">
            <div className="p-4 space-y-2">
              {isLoading ? (
                <div className="flex items-center justify-center py-16 gap-2 text-muted-foreground">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span className="text-sm">{t('generatorV1.uploadHistory.loading')}</span>
                </div>
              ) : filtered.length === 0 ? (
                <div className="text-center py-16 space-y-2">
                  <div className="w-12 h-12 rounded-2xl bg-muted mx-auto flex items-center justify-center">
                    <Upload className="w-5 h-5 text-muted-foreground" />
                  </div>
                  <p className="text-sm text-muted-foreground">{t('generatorV1.uploadHistory.emptyMsg')}</p>
                </div>
              ) : filtered.map(f => (
                <div key={f.id} className="group flex items-center gap-3 px-3 py-2.5 rounded-lg border border-border hover:bg-muted/40 transition-colors">
                  <div className="w-9 h-9 rounded-lg bg-muted flex items-center justify-center flex-shrink-0">
                    <FileText className="w-4 h-4 text-muted-foreground" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-foreground truncate">{f.name}</p>
                    <div className="flex items-center gap-2 mt-0.5 text-[10px] text-muted-foreground">
                      <span>{f.uploadedAt}</span><span>·</span><span>{f.size}</span>
                      {f.type && <><span>·</span><span className="font-mono">{f.type}</span></>}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                    <button
                      onClick={() => handleDownload(f.id, f.name)}
                      disabled={downloadingId === f.id}
                      className="p-1.5 rounded hover:bg-muted disabled:opacity-50"
                      title={t('generatorV1.uploadHistory.downloadTitle')}
                    >
                      {downloadingId === f.id
                        ? <Loader2 className="w-3.5 h-3.5 text-muted-foreground animate-spin" />
                        : <Download className="w-3.5 h-3.5 text-muted-foreground" />}
                    </button>
                    <button
                      onClick={() => setDeleteTarget({ id: f.id, name: f.name })}
                      className="p-1.5 rounded hover:bg-muted"
                      title={t('generatorV1.uploadHistory.deleteTitle')}
                    >
                      <Trash2 className="w-3.5 h-3.5 text-muted-foreground hover:text-destructive" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </SheetContent>
      </Sheet>

      <AlertDialog open={!!deleteTarget} onOpenChange={v => !v && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('generatorV1.uploadHistory.deleteConfirmTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              <span className="font-medium">{deleteTarget?.name}</span>{' '}
              {t('generatorV1.uploadHistory.deleteConfirmDesc')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('generatorV1.uploadHistory.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
              disabled={deleteMutation.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Xóa'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
