import { ChangeEvent, FormEvent, useDeferredValue, useEffect, useMemo, useState, startTransition } from 'react';
import { useSearchParams } from 'react-router-dom';
import { clearAllNotifications, createResource, deleteResource, fetchPushPublicKey, fetchResource, markAllNotificationsRead, removePushSubscription, savePushSubscription, sendPushTest, updateResource, uploadCertificateFile } from '../lib/api';
import { ResourceTable } from '../components/ResourceTable';
import {
  daysUntil,
  downloadAssetTemplate,
  exportRowsToCsv,
  exportRowsToPdf,
  matchesDate,
  parseSpreadsheetFile,
  pickRecordValue,
  textContains,
  uniqueValues,
} from '../lib/resourceTools';
import type { ResourceDefinition, ResourceRow, SessionUser } from '../lib/types';

type ResourcePageProps = {
  definition: ResourceDefinition;
  user: SessionUser;
};

type StatMap = Record<string, number>;

type DuplicateChoice = 'unresolved' | 'update' | 'skip' | 'create';

type AssetImportPreviewRow = {
  rowNumber: number;
  record: Record<string, string>;
  existing: ResourceRow | null;
  choice: DuplicateChoice;
  error: string;
};

type AssetImportSummary = {
  total: number;
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  failures: Array<{ rowNumber: number; assetLabel: string; message: string }>;
};


type CertificateUploadDraft = {
  file: File;
  fileName: string;
  size: number;
};

const ASSET_REQUIRED_COLUMNS = ['asset_number', 'name', 'asset_type', 'status', 'client_id', 'functional_location', 'serial_number'] as const;

function buildInitialForm(definition: ResourceDefinition) {
  return Object.fromEntries(definition.fields.map((field) => [field.key, '']));
}

function safeText(value: string | number | null | undefined) {
  return String(value ?? '—');
}

function cleanText(value: string | number | null | undefined) {
  return String(value ?? '').trim();
}

function statusKey(value: string | number | null | undefined) {
  return safeText(value).toLowerCase();
}

function computeStats(definition: ResourceDefinition, rows: ResourceRow[]): StatMap {
  const stats: StatMap = { total: rows.length };

  if (definition.variant === 'assets') {
    stats.operation = rows.filter((row) => statusKey(row.status).includes('operation')).length;
    stats.stacked = rows.filter((row) => statusKey(row.status).includes('stacked')).length;
  }

  if (definition.variant === 'certificates') {
    stats.approved = rows.filter((row) => statusKey(row.approval_status).includes('approved')).length;
    stats.pending = rows.filter((row) => statusKey(row.approval_status).includes('pending')).length;
    stats.rejected = rows.filter((row) => statusKey(row.approval_status).includes('rejected')).length;
  }

  if (definition.variant === 'clients') {
    stats.active = rows.filter((row) => statusKey(row.status).includes('active')).length;
    stats.assets = 0;
    stats.expiring = 0;
  }

  if (definition.variant === 'inspectors') {
    const years = rows.map((row) => Number(row.experience_years ?? 0)).filter((year) => Number.isFinite(year));
    stats.active = rows.filter((row) => statusKey(row.status).includes('active')).length;
    stats.avgExperience = years.length ? Math.round(years.reduce((sum, year) => sum + year, 0) / years.length) : 0;
    stats.linkedCertificates = rows.length * 3 + 2;
  }

  if (definition.variant === 'locations') {
    stats.rigs = rows.filter((row) => statusKey(row.type).includes('rig')).length;
    stats.workshops = rows.filter((row) => statusKey(row.type).includes('workshop')).length;
    stats.other = rows.length - stats.rigs - stats.workshops;
  }

  if (definition.variant === 'notifications') {
    stats.unread = rows.filter((row) => String(row.is_read ?? '0') === '0').length;
    stats.critical = rows.filter((row) => statusKey(row.type).includes('critical')).length;
    stats.warnings = rows.filter((row) => statusKey(row.type).includes('warning')).length;
    stats.info = rows.filter((row) => !statusKey(row.type).includes('critical') && !statusKey(row.type).includes('warning')).length;
  }

  return stats;
}

function buildClientInitials(name: string) {
  return name.split(' ').map((part) => part[0]).slice(0, 2).join('').toUpperCase();
}

function getColumnStorageKey(userId: number, path: string) {
  return `rigways_columns_${userId}_${path}`;
}

function readParam(params: URLSearchParams, key: string, fallback = '') {
  return params.get(key) ?? fallback;
}

function writeParam(params: URLSearchParams, key: string, value: string) {
  if (value && value !== 'all') params.set(key, value);
  else params.delete(key);
}

function searchMatches(row: ResourceRow, definition: ResourceDefinition, query: string) {
  if (!query.trim()) {
    return true;
  }

  const keys = new Set<string>([
    ...definition.columns.map((column) => column.key),
    ...definition.fields.map((field) => field.key),
    'created_at',
    'title',
    'contact',
    'email',
    'city',
    'industry',
    'notes',
    'body',
    'type',
  ]);

  return Array.from(keys).some((key) => textContains(row[key], query));
}

function notificationCategory(row: ResourceRow) {
  const type = statusKey(row.type);
  if (type.includes('expiry')) return 'expiry';
  if (type.includes('approval')) return 'approvals';
  if (type.includes('system') || type.includes('critical')) return 'system';
  return 'all';
}

function assetImportBody(record: Record<string, string>) {
  return {
    asset_number: cleanText(record.asset_number),
    name: cleanText(record.name),
    asset_type: cleanText(record.asset_type),
    status: cleanText(record.status),
    client_id: cleanText(record.client_id),
    functional_location: cleanText(record.functional_location),
    serial_number: cleanText(record.serial_number),
    manufacturer: cleanText(record.manufacturer),
    model: cleanText(record.model),
    description: cleanText(record.description),
    notes: cleanText(record.notes),
  };
}

function normalizeAssetImportRecord(record: Record<string, string>) {
  return {
    asset_number: pickRecordValue(record, 'asset_number', 'asset_id'),
    name: pickRecordValue(record, 'name', 'asset_name'),
    asset_type: pickRecordValue(record, 'asset_type', 'type', 'type_category'),
    status: pickRecordValue(record, 'status'),
    client_id: pickRecordValue(record, 'client_id', 'client'),
    functional_location: pickRecordValue(record, 'functional_location', 'location'),
    serial_number: pickRecordValue(record, 'serial_number', 'serial_no'),
    manufacturer: pickRecordValue(record, 'manufacturer'),
    model: pickRecordValue(record, 'model'),
    description: pickRecordValue(record, 'description'),
    notes: pickRecordValue(record, 'notes'),
  };
}

async function readFileAsBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? '');
      const base64 = result.includes(',') ? result.split(',')[1] : result;
      resolve(base64);
    };
    reader.onerror = () => reject(new Error('Unable to read the selected file.'));
    reader.readAsDataURL(file);
  });
}

function urlBase64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const normalized = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(normalized);
  return Uint8Array.from(rawData, (character) => character.charCodeAt(0));
}
export function ResourcePage({ definition, user }: ResourcePageProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [rows, setRows] = useState<ResourceRow[]>([]);
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [editingId, setEditingId] = useState<string | number | null>(null);
  const [formOpen, setFormOpen] = useState(definition.variant === 'jobs');
  const [form, setForm] = useState<Record<string, string>>(() => buildInitialForm(definition));
  const [visibleColumnKeys, setVisibleColumnKeys] = useState<string[]>(definition.columns.map((column) => column.key));
  const [columnPickerOpen, setColumnPickerOpen] = useState(false);
  const [assetStatusFilter, setAssetStatusFilter] = useState('all');
  const [certificateFilter, setCertificateFilter] = useState('all');
  const [inspectorFilter, setInspectorFilter] = useState('all');
  const [locationFilter, setLocationFilter] = useState('all');
  const [notificationFilter, setNotificationFilter] = useState('all');
  const [selectedClient, setSelectedClient] = useState('all');
  const [selectedType, setSelectedType] = useState('all');
  const [selectedLocation, setSelectedLocation] = useState('all');
  const [selectedStatus, setSelectedStatus] = useState('all');
  const [selectedIndustry, setSelectedIndustry] = useState('all');
  const [selectedDate, setSelectedDate] = useState('');
  const [jobFilter, setJobFilter] = useState('');
  const [fileClientFilter, setFileClientFilter] = useState('');
  const [fileCertTypeFilter, setFileCertTypeFilter] = useState('');
  const [importOpen, setImportOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState('');
  const [importFileName, setImportFileName] = useState('');
  const [importPreviewRows, setImportPreviewRows] = useState<AssetImportPreviewRow[]>([]);
  const [importSummary, setImportSummary] = useState<AssetImportSummary | null>(null);
  const [certificateUpload, setCertificateUpload] = useState<CertificateUploadDraft | null>(null);
  const [certificateExistingFile, setCertificateExistingFile] = useState<{ name: string; url: string; size?: string } | null>(null);
  const [pushSupported, setPushSupported] = useState(false);
  const [pushEnabled, setPushEnabled] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);

  useEffect(() => {
    setQuery(readParam(searchParams, 'q'));
    setAssetStatusFilter(readParam(searchParams, 'assetStatus', 'all') || 'all');
    setCertificateFilter(readParam(searchParams, 'certificateStatus', 'all') || 'all');
    setInspectorFilter(readParam(searchParams, 'inspectorStatus', 'all') || 'all');
    setLocationFilter(readParam(searchParams, 'locationType', 'all') || 'all');
    setNotificationFilter(readParam(searchParams, 'notificationTab', 'all') || 'all');
    setSelectedClient(readParam(searchParams, 'client', 'all') || 'all');
    setSelectedType(readParam(searchParams, 'type', 'all') || 'all');
    setSelectedLocation(readParam(searchParams, 'location', 'all') || 'all');
    setSelectedStatus(readParam(searchParams, 'status', 'all') || 'all');
    setSelectedIndustry(readParam(searchParams, 'industry', 'all') || 'all');
    setSelectedDate(readParam(searchParams, 'date'));
    setJobFilter(readParam(searchParams, 'job'));
    setFileClientFilter(readParam(searchParams, 'fileClient'));
    setFileCertTypeFilter(readParam(searchParams, 'fileCertType'));
  }, [definition.path]);

  useEffect(() => {
    const params = new URLSearchParams();
    writeParam(params, 'q', query.trim());
    writeParam(params, 'assetStatus', assetStatusFilter);
    writeParam(params, 'certificateStatus', certificateFilter);
    writeParam(params, 'inspectorStatus', inspectorFilter);
    writeParam(params, 'locationType', locationFilter);
    writeParam(params, 'notificationTab', notificationFilter);
    writeParam(params, 'client', selectedClient);
    writeParam(params, 'type', selectedType);
    writeParam(params, 'location', selectedLocation);
    writeParam(params, 'status', selectedStatus);
    writeParam(params, 'industry', selectedIndustry);
    writeParam(params, 'date', selectedDate);
    writeParam(params, 'job', jobFilter.trim());
    writeParam(params, 'fileClient', fileClientFilter.trim());
    writeParam(params, 'fileCertType', fileCertTypeFilter.trim());
    setSearchParams(params, { replace: true });
  }, [
    assetStatusFilter,
    certificateFilter,
    fileCertTypeFilter,
    fileClientFilter,
    inspectorFilter,
    jobFilter,
    locationFilter,
    notificationFilter,
    query,
    selectedClient,
    selectedDate,
    selectedIndustry,
    selectedLocation,
    selectedStatus,
    selectedType,
    setSearchParams,
  ]);

  async function refreshRows() {
    const data = await fetchResource(definition.path);
    setRows(data);
  }

  useEffect(() => {
    let cancelled = false;
    setBusy(true);

    fetchResource(definition.path)
      .then((data) => {
        if (!cancelled) {
          setRows(data);
          setError('');
        }
      })
      .catch((caught) => {
        if (!cancelled) {
          setError(caught instanceof Error ? caught.message : 'Failed to load records.');
        }
      })
      .finally(() => {
        if (!cancelled) {
          setBusy(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [definition.path]);

  useEffect(() => {
    const raw = window.localStorage.getItem(getColumnStorageKey(user.id, definition.path));
    if (!raw) {
      setVisibleColumnKeys(definition.columns.map((column) => column.key));
      return;
    }

    try {
      const parsed = JSON.parse(raw) as string[];
      const allowed = definition.columns.map((column) => column.key);
      const filtered = parsed.filter((key) => allowed.includes(key));
      setVisibleColumnKeys(filtered.length ? filtered : allowed);
    } catch {
      setVisibleColumnKeys(definition.columns.map((column) => column.key));
    }
  }, [definition.columns, definition.path, user.id]);

  useEffect(() => {
    window.localStorage.setItem(getColumnStorageKey(user.id, definition.path), JSON.stringify(visibleColumnKeys));
  }, [definition.path, user.id, visibleColumnKeys]);

  useEffect(() => {
    if (definition.variant !== 'notifications') return;

    const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
    setPushSupported(supported);
    if (!supported) return;

    void syncPushState();
  }, [definition.variant]);

  const visibleColumns = useMemo(() => {
    const columns = definition.columns.filter((column) => visibleColumnKeys.includes(column.key));
    return columns.length ? columns : [definition.columns[0]];
  }, [definition.columns, visibleColumnKeys]);

  const clientOptions = useMemo(() => uniqueValues(rows, 'client_id'), [rows]);
  const assetTypeOptions = useMemo(() => uniqueValues(rows, definition.variant === 'certificates' ? 'cert_type' : 'asset_type'), [definition.variant, rows]);
  const locationOptions = useMemo(() => uniqueValues(rows, 'functional_location'), [rows]);
  const industryOptions = useMemo(() => uniqueValues(rows, 'industry'), [rows]);
  const statusOptions = useMemo(() => uniqueValues(rows, 'status'), [rows]);

  const filteredRows = useMemo(() => {
    let next = rows.filter((row) => searchMatches(row, definition, deferredQuery));

    if (definition.variant === 'assets') {
      if (assetStatusFilter !== 'all') next = next.filter((row) => statusKey(row.status).includes(assetStatusFilter));
      if (selectedClient !== 'all') next = next.filter((row) => cleanText(row.client_id) === selectedClient);
      if (selectedType !== 'all') next = next.filter((row) => cleanText(row.asset_type) === selectedType);
      if (selectedLocation !== 'all') next = next.filter((row) => cleanText(row.functional_location) === selectedLocation);
      if (selectedDate) next = next.filter((row) => matchesDate(row.created_at, selectedDate));
    }

    if (definition.variant === 'certificates') {
      if (certificateFilter !== 'all') {
        next = next.filter((row) => {
          const expiryDays = daysUntil(row.expiry_date);
          if (certificateFilter === 'valid') return expiryDays > 30;
          if (certificateFilter === 'expiring') return expiryDays >= 0 && expiryDays <= 30;
          if (certificateFilter === 'expired') return expiryDays < 0;
          if (certificateFilter === 'pending') return statusKey(row.approval_status).includes('pending');
          if (certificateFilter === 'rejected') return statusKey(row.approval_status).includes('rejected');
          return true;
        });
      }
      if (selectedClient !== 'all') next = next.filter((row) => cleanText(row.client_id) === selectedClient);
      if (selectedType !== 'all') next = next.filter((row) => cleanText(row.cert_type) === selectedType);
    }

    if (definition.variant === 'jobs' && selectedDate) {
      next = next.filter((row) => matchesDate(row.created_at, selectedDate));
    }

    if (definition.variant === 'clients') {
      if (selectedStatus !== 'all') next = next.filter((row) => cleanText(row.status) === selectedStatus);
      if (selectedIndustry !== 'all') next = next.filter((row) => cleanText(row.industry) === selectedIndustry);
    }

    if (definition.variant === 'inspectors' && inspectorFilter !== 'all') {
      next = next.filter((row) => statusKey(row.status).includes(inspectorFilter));
    }

    if (definition.variant === 'locations') {
      if (locationFilter !== 'all') {
        next = next.filter((row) => {
          const type = statusKey(row.type);
          if (locationFilter === 'rigs') return type.includes('rig');
          if (locationFilter === 'workshops') return type.includes('workshop');
          if (locationFilter === 'other') return !type.includes('rig') && !type.includes('workshop');
          return true;
        });
      }
      if (selectedClient !== 'all') next = next.filter((row) => cleanText(row.client_id) === selectedClient);
    }

    if (definition.variant === 'notifications') {
      if (notificationFilter === 'unread') next = next.filter((row) => String(row.is_read ?? '0') === '0');
      else if (notificationFilter !== 'all') next = next.filter((row) => notificationCategory(row) === notificationFilter);
    }

    if (definition.variant === 'files') {
      if (jobFilter.trim()) next = next.filter((row) => textContains(row.job_id, jobFilter));
      if (fileClientFilter.trim()) next = next.filter((row) => textContains(row.client_id, fileClientFilter));
      if (fileCertTypeFilter.trim()) next = next.filter((row) => textContains(row.cert_type, fileCertTypeFilter));
      if (selectedDate) next = next.filter((row) => matchesDate(row.uploaded_at, selectedDate));
    }

    return next;
  }, [
    assetStatusFilter,
    certificateFilter,
    deferredQuery,
    definition,
    fileCertTypeFilter,
    fileClientFilter,
    inspectorFilter,
    jobFilter,
    locationFilter,
    notificationFilter,
    rows,
    selectedClient,
    selectedDate,
    selectedIndustry,
    selectedLocation,
    selectedStatus,
    selectedType,
  ]);

  const stats = useMemo(() => computeStats(definition, filteredRows), [definition, filteredRows]);

  function resetForm() {
    setEditingId(null);
    setForm(buildInitialForm(definition));
    setCertificateUpload(null);
    setCertificateExistingFile(null);
    if (definition.variant !== 'jobs') setFormOpen(false);
  }

  function beginEdit(row: ResourceRow) {
    setEditingId(String(row.id));
    setFormOpen(true);
    setCertificateUpload(null);
    setCertificateExistingFile(definition.variant === 'certificates' && row.file_name && row.file_url ? {
      name: String(row.file_name),
      url: String(row.file_url),
      size: row.file_size ? String(row.file_size) : undefined,
    } : null);
    setForm(Object.fromEntries(definition.fields.map((field) => [field.key, String(row[field.key] ?? '')])));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');

    try {
      const saved = editingId ? await updateResource(definition.path, editingId, form) : await createResource(definition.path, form);
      if (definition.variant === 'certificates' && certificateUpload) {
        await uploadCertificateFile(String(saved.id), certificateUpload.file);
      }
      await refreshRows();
      resetForm();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Save failed.');
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(row: ResourceRow) {
    const label = row.name ?? row.title ?? row.client_id ?? row.asset_number ?? row.job_number ?? row.id;
    if (!window.confirm(`Delete ${String(label)}?`)) return;

    setBusy(true);
    setError('');

    try {
      await deleteResource(definition.path, String(row.id));
      await refreshRows();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Delete failed.');
    } finally {
      setBusy(false);
    }
  }

  async function handleCertificateFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      setCertificateUpload({
        file,
        fileName: file.name,
        size: file.size,
      });
      setError('');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to read the selected file.');
    } finally {
      event.target.value = '';
    }
  }

  async function syncPushState() {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    setPushEnabled(Boolean(subscription));
  }

  async function enablePushNotifications() {
    if (!pushSupported) {
      setError('This browser does not support service workers and push notifications.');
      return;
    }

    setPushBusy(true);
    setError('');

    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        throw new Error('Notification permission was not granted.');
      }

      const registration = await navigator.serviceWorker.ready;
      const { publicKey } = await fetchPushPublicKey();
      const existing = await registration.pushManager.getSubscription();
      const subscription = existing ?? await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });

      await savePushSubscription(subscription.toJSON());
      setPushEnabled(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to enable push notifications.');
    } finally {
      setPushBusy(false);
    }
  }

  async function resetPushNotifications() {
    setPushBusy(true);
    setError('');

    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      const endpoint = subscription?.endpoint;
      if (endpoint) {
        await removePushSubscription(endpoint);
        await subscription?.unsubscribe();
      } else {
        await removePushSubscription();
      }
      setPushEnabled(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to reset push notifications.');
    } finally {
      setPushBusy(false);
    }
  }

  async function handleMarkAllRead() {
    setBusy(true);
    setError('');

    try {
      await markAllNotificationsRead();
      setRows((current) => current.map((row) => ({ ...row, is_read: 1 })));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to update notifications.');
    } finally {
      setBusy(false);
    }
  }

  async function handleClearNotifications() {
    if (!window.confirm('Clear all notifications for your account?')) return;

    setBusy(true);
    setError('');

    try {
      await clearAllNotifications();
      setRows([]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to clear notifications.');
    } finally {
      setBusy(false);
    }
  }

  async function handleSendPush(isBroadcast: boolean) {
    setPushBusy(true);
    setError('');

    try {
      await sendPushTest(isBroadcast);
      await refreshRows();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to send a push notification.');
    } finally {
      setPushBusy(false);
    }
  }
function handleExportCsv() {
    exportRowsToCsv(definition.title, visibleColumns, filteredRows);
  }

  function handleExportPdf() {
    exportRowsToPdf(definition.title, definition.subtitle, visibleColumns, filteredRows);
  }

  function toggleVisibleColumn(key: string) {
    setVisibleColumnKeys((current) => {
      if (current.includes(key)) {
        if (current.length === 1) return current;
        return current.filter((item) => item !== key);
      }
      return [...current, key];
    });
  }

  function resetVisibleColumns() {
    setVisibleColumnKeys(definition.columns.map((column) => column.key));
  }

  function renderStats() {
    if (!definition.stats?.length) return null;
    return (
      <div className="metric-grid">
        {definition.stats.map((stat) => (
          <article key={stat.key} className={`metric-card ${stat.tone}`}>
            <strong>{stats[stat.key] ?? 0}</strong>
            <span>{stat.label}</span>
          </article>
        ))}
      </div>
    );
  }

  function renderColumnButton() {
    return (
      <button className="soft-button" type="button" onClick={() => setColumnPickerOpen(true)}>
        Columns <span className="badge-counter">{visibleColumns.length}</span>
      </button>
    );
  }

  function renderExportButtons() {
    return (
      <>
        {renderColumnButton()}
        <button className="soft-button" type="button" onClick={handleExportCsv}>CSV</button>
        <button className="soft-button danger" type="button" onClick={handleExportPdf}>PDF</button>
      </>
    );
  }

  function renderFilters() {
    const placeholderMap: Record<string, string> = {
      assets: 'Search assets...',
      certificates: 'Search certificates...',
      clients: 'Search clients...',
      inspectors: 'Search inspectors...',
      locations: 'Search locations...',
      files: 'Filename contains...',
      jobs: 'Search jobs...',
      notifications: 'Search notifications...',
    };

    const isAssets = definition.variant === 'assets';

    return (
      <div className={`toolbar-card ${isAssets ? 'assets-toolbar-card' : ''}`}>
        {(definition.variant === 'assets' || definition.variant === 'certificates' || definition.variant === 'inspectors' || definition.variant === 'locations') ? (
          <div className="filter-chip-row">
            {definition.variant === 'assets' ? (
              <>
                <button className={`filter-chip ${assetStatusFilter === 'all' ? 'active' : ''}`} type="button" onClick={() => setAssetStatusFilter('all')}>All</button>
                <button className={`filter-chip ${assetStatusFilter === 'operation' ? 'active' : ''}`} type="button" onClick={() => setAssetStatusFilter('operation')}>Operation</button>
                <button className={`filter-chip ${assetStatusFilter === 'stacked' ? 'active' : ''}`} type="button" onClick={() => setAssetStatusFilter('stacked')}>Stacked</button>
              </>
            ) : null}
            {definition.variant === 'certificates' ? ['all', 'valid', 'expiring', 'expired', 'pending', 'rejected'].map((item) => (
              <button key={item} className={`filter-chip ${certificateFilter === item ? 'active' : ''}`} type="button" onClick={() => setCertificateFilter(item)}>{item.charAt(0).toUpperCase() + item.slice(1)}</button>
            )) : null}
            {definition.variant === 'inspectors' ? ['all', 'active', 'inactive'].map((item) => (
              <button key={item} className={`filter-chip ${inspectorFilter === item ? 'active' : ''}`} type="button" onClick={() => setInspectorFilter(item)}>{item.charAt(0).toUpperCase() + item.slice(1)}</button>
            )) : null}
            {definition.variant === 'locations' ? (
              <>
                <button className={`filter-chip ${locationFilter === 'all' ? 'active' : ''}`} type="button" onClick={() => setLocationFilter('all')}>All</button>
                <button className={`filter-chip ${locationFilter === 'rigs' ? 'active' : ''}`} type="button" onClick={() => setLocationFilter('rigs')}>Rigs</button>
                <button className={`filter-chip ${locationFilter === 'workshops' ? 'active' : ''}`} type="button" onClick={() => setLocationFilter('workshops')}>Workshops</button>
                <button className={`filter-chip ${locationFilter === 'other' ? 'active' : ''}`} type="button" onClick={() => setLocationFilter('other')}>Other</button>
              </>
            ) : null}
          </div>
        ) : null}

        <div className={`toolbar-row ${isAssets ? 'assets-toolbar-row' : ''}`}>
          {definition.variant === 'files' ? <input aria-label="Filter files by job" placeholder="Job" value={jobFilter} onChange={(event) => setJobFilter(event.target.value)} /> : null}
          {['assets', 'certificates', 'locations'].includes(definition.variant) ? (
            <select aria-label="Filter by client" value={selectedClient} onChange={(event) => setSelectedClient(event.target.value)}>
              <option value="all">All Clients</option>
              {clientOptions.map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          ) : null}
          {definition.variant === 'assets' ? (
            <select aria-label="Filter by type" value={selectedType} onChange={(event) => setSelectedType(event.target.value)}>
              <option value="all">All Types</option>
              {assetTypeOptions.map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          ) : null}
          {definition.variant === 'certificates' ? (
            <select aria-label="Filter by type" value={selectedType} onChange={(event) => setSelectedType(event.target.value)}>
              <option value="all">All Types</option>
              {assetTypeOptions.map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          ) : null}
          {definition.variant === 'assets' ? (
            <select aria-label="Filter by location" value={selectedLocation} onChange={(event) => setSelectedLocation(event.target.value)}>
              <option value="all">All Locations</option>
              {locationOptions.map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          ) : null}
          {definition.variant === 'clients' ? (
            <>
              <select aria-label="Filter by status" value={selectedStatus} onChange={(event) => setSelectedStatus(event.target.value)}>
                <option value="all">All Status</option>
                {statusOptions.map((value) => <option key={value} value={value}>{value}</option>)}
              </select>
              <select aria-label="Filter by industry" value={selectedIndustry} onChange={(event) => setSelectedIndustry(event.target.value)}>
                <option value="all">All Industries</option>
                {industryOptions.map((value) => <option key={value} value={value}>{value}</option>)}
              </select>
            </>
          ) : null}
          {definition.variant === 'files' ? (
            <>
              <input aria-label="Filter files by client" placeholder="Client" value={fileClientFilter} onChange={(event) => setFileClientFilter(event.target.value)} />
              <input aria-label="Filter files by certificate type" placeholder="Cert Type" value={fileCertTypeFilter} onChange={(event) => setFileCertTypeFilter(event.target.value)} />
            </>
          ) : null}
          {['assets', 'jobs', 'files'].includes(definition.variant) ? <input aria-label="Filter by date" type="date" value={selectedDate} onChange={(event) => setSelectedDate(event.target.value)} /> : null}
          <div className="search-shell compact assets-search-shell">
            <span className="search-shell-icon" />
            <input aria-label={`Search ${definition.label.toLowerCase()}`} placeholder={placeholderMap[definition.variant] ?? 'Search...'} value={query} onChange={(event) => startTransition(() => setQuery(event.target.value))} />
          </div>
          <div className="toolbar-actions">
            {definition.variant === 'assets' ? <button className="soft-button" type="button" onClick={() => setImportOpen(true)}>Import</button> : null}
            {renderExportButtons()}
          </div>
        </div>
      </div>
    );
  }

  function renderTableBlock() {
    return (
      <section className={`content-card table-card ${definition.variant === 'assets' ? 'assets-table-card' : ''}`}>
        <div className="table-header-row">
          <div>
            <h3>{definition.title}</h3>
            <p>{busy ? 'Refreshing data...' : `${filteredRows.length} records in current view`}</p>
          </div>
          <div className="table-footer-tools">
            <span>Density</span>
            <button className="density-toggle active" type="button">C</button>
            <button className="density-toggle" type="button">K</button>
          </div>
        </div>
        <ResourceTable definition={definition} columns={visibleColumns} rows={filteredRows} onEdit={beginEdit} onDelete={handleDelete} userRole={user.role} />
      </section>
    );
  }

  function renderFormPanel() {
    if (!formOpen) return null;

    return (
      <form className="content-card action-form" onSubmit={handleSubmit}>
        <div className="panel-title-row">
          <div>
            <h3>{editingId ? `Edit ${definition.label.slice(0, -1) || definition.label}` : definition.addLabel}</h3>
            <p>{definition.subtitle}</p>
          </div>
          {definition.variant !== 'jobs' ? <button className="text-button" type="button" onClick={() => setFormOpen(false)}>Close</button> : null}
        </div>

        <div className={`form-grid variant-${definition.variant}`}>
          {definition.fields.map((field) => (
            <label key={field.key} className={field.type === 'textarea' ? 'span-two' : ''}>
              <span>{field.label}</span>
              {field.type === 'textarea' ? (
                <textarea rows={4} value={form[field.key] ?? ''} onChange={(event) => setForm((current) => ({ ...current, [field.key]: event.target.value }))} />
              ) : field.type === 'select' ? (
                <select value={form[field.key] ?? ''} onChange={(event) => setForm((current) => ({ ...current, [field.key]: event.target.value }))}>
                  <option value="">Select...</option>
                  {field.options?.map((option) => <option key={option} value={option}>{option}</option>)}
                </select>
              ) : (
                <input type={field.type === 'date' ? 'date' : 'text'} value={form[field.key] ?? ''} placeholder={field.label} onChange={(event) => setForm((current) => ({ ...current, [field.key]: event.target.value }))} />
              )}
            </label>
          ))}
        </div>

        {definition.variant === 'certificates' ? (
          <div className="content-card">
            <div className="panel-title-row">
              <div>
                <h3>Certificate Attachment</h3>
                <p>Upload the certificate file to the Coolify-backed storage volume.</p>
              </div>
            </div>
            <label className="upload-dropzone">
              <input type="file" accept=".pdf,.jpg,.jpeg,.png,.doc,.docx" onChange={handleCertificateFileChange} hidden />
              <div className="upload-dropzone-inner">
                <div className="upload-dropzone-icon">?</div>
                <strong>{certificateUpload ? certificateUpload.fileName : 'Choose certificate file'}</strong>
                <span>{certificateUpload ? `${Math.round(certificateUpload.size / 1024)} KB selected` : 'Accepts PDF, image, and Office files'}</span>
              </div>
            </label>
            {certificateExistingFile ? <p className="notifications-disclaimer">Current file: <a href={certificateExistingFile.url} target="_blank" rel="noreferrer">{certificateExistingFile.name}</a></p> : null}
          </div>
        ) : null}

        {error ? <p className="error-banner">{error}</p> : null}

        <div className="form-actions">
          <button className="submit-button compact" type="submit" disabled={busy}>{busy ? 'Saving...' : editingId ? 'Update' : definition.addLabel}</button>
          <button className="soft-button" type="button" onClick={resetForm}>Clear</button>
        </div>
      </form>
    );
  }
async function handleImportFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    setImportError('');
    setImportSummary(null);
    setImportFileName(file.name);

    try {
      const rawRows = await parseSpreadsheetFile(file);
      if (!rawRows.length) throw new Error('The selected file does not contain any rows.');

      const normalized = rawRows.map(normalizeAssetImportRecord);
      const preview = normalized.map((record, index) => {
        const missingRequired = ASSET_REQUIRED_COLUMNS.filter((column) => !cleanText(record[column]));
        const existing = rows.find((row) => cleanText(row.asset_number) === cleanText(record.asset_number)) ?? null;
        return {
          rowNumber: index + 2,
          record,
          existing,
          choice: existing ? 'unresolved' : 'create',
          error: missingRequired.length ? `Missing required: ${missingRequired.join(', ')}` : '',
        } satisfies AssetImportPreviewRow;
      });

      setImportPreviewRows(preview);
    } catch (caught) {
      setImportPreviewRows([]);
      setImportError(caught instanceof Error ? caught.message : 'Unable to parse the file.');
    }
  }

  function updatePreviewChoice(rowNumber: number, choice: DuplicateChoice) {
    setImportPreviewRows((current) => current.map((row) => (row.rowNumber === rowNumber ? { ...row, choice } : row)));
  }

  async function runAssetImport() {
    const unresolved = importPreviewRows.filter((row) => row.existing && row.choice === 'unresolved');
    const invalid = importPreviewRows.filter((row) => row.error);

    if (invalid.length) {
      setImportError('Please resolve invalid rows before importing.');
      return;
    }

    if (unresolved.length) {
      setImportError('Choose update or skip for every duplicate asset before importing.');
      return;
    }

    setImportError('');
    setImportSummary(null);
    setImporting(true);

    const summary: AssetImportSummary = {
      total: importPreviewRows.length,
      created: 0,
      updated: 0,
      skipped: 0,
      failed: 0,
      failures: [],
    };

    try {
      for (const row of importPreviewRows) {
        if (row.choice === 'skip') {
          summary.skipped += 1;
          continue;
        }

        const payload = assetImportBody(row.record);
        const assetLabel = row.record.asset_number || row.record.name || 'unknown asset';

        try {
          if (row.existing && row.choice === 'update') {
            await updateResource('assets', String(row.existing.id), payload);
            summary.updated += 1;
          } else if (row.choice === 'create') {
            await createResource('assets', payload);
            summary.created += 1;
          }
        } catch (caught) {
          const detail = caught instanceof Error ? caught.message : 'Import failed.';
          summary.failed += 1;
          summary.failures.push({ rowNumber: row.rowNumber, assetLabel, message: detail });
        }
      }

      await refreshRows();
      setImportSummary(summary);

      if (summary.failed > 0) {
        setImportError(`Import finished with ${summary.failed} failed row(s). Review the summary below.`);
      } else {
        setImportError('');
      }
    } catch (caught) {
      setImportError(caught instanceof Error ? caught.message : 'Import failed.');
    } finally {
      setImporting(false);
    }
  }

  function renderClients() {
    return (
      <>
        {renderStats()}
        <div className="page-actions-row">
          <div className="search-stack">
            <div className="search-shell compact wide">
              <span className="search-shell-icon" />
              <input aria-label="Search clients" value={query} onChange={(event) => startTransition(() => setQuery(event.target.value))} placeholder="Search clients..." />
            </div>
            <select aria-label="Filter by status" value={selectedStatus} onChange={(event) => setSelectedStatus(event.target.value)}>
              <option value="all">All Status</option>
              {statusOptions.map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
            <select aria-label="Filter by industry" value={selectedIndustry} onChange={(event) => setSelectedIndustry(event.target.value)}>
              <option value="all">All Industries</option>
              {industryOptions.map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </div>
          <div className="page-actions-right toolbar-actions">
            {renderExportButtons()}
            <button className="submit-button compact" type="button" onClick={() => setFormOpen(true)}>+ {definition.addLabel}</button>
          </div>
        </div>
        {renderFormPanel()}
        <section className="client-grid">
          {filteredRows.map((row) => (
            <article key={String(row.id)} className="client-card">
              <div className="client-card-top">
                <div className="client-avatar">{buildClientInitials(safeText(row.name))}</div>
                <div className="client-title-block">
                  <strong>{safeText(row.name)}</strong>
                  <div className="client-meta-row">
                    <span className="code-pill">{safeText(row.client_id)}</span>
                    <span className="neutral-chip">{safeText(row.industry)}</span>
                  </div>
                </div>
                <div className="row-actions">
                  <button className="icon-button edit" type="button" aria-label={`Edit client ${safeText(row.name)}`} onClick={() => beginEdit(row)}><span className="icon-pencil" /></button>
                  <button className="icon-button delete" type="button" aria-label={`Delete client ${safeText(row.name)}`} onClick={() => handleDelete(row)}><span className="icon-trash" /></button>
                </div>
              </div>
              <div className="client-metrics">
                <div><strong>0</strong><span>Assets</span></div>
                <div><strong>0</strong><span>Certs</span></div>
                <div><strong>0</strong><span>Expiring</span></div>
                <div><strong>{statusKey(row.status).includes('active') ? 'ON' : 'OFF'}</strong><span>Status</span></div>
              </div>
              <div className="client-footer">
                <div><span>{safeText(row.contact)}</span><small>{safeText(row.email)}</small></div>
                <div><span>Contract ends</span><small>—</small></div>
              </div>
            </article>
          ))}
        </section>
      </>
    );
  }

  function renderNotifications() {
    return (
      <>
        <div className="page-actions-row notifications-top">
          <div><h2>{definition.title}</h2><p>{definition.subtitle}</p></div>
          <div className="toolbar-actions wide-gap">
            <button className="soft-button" type="button" onClick={resetPushNotifications} disabled={!pushSupported || pushBusy}>Reset Push</button>
            <button className="soft-button" type="button" onClick={handleMarkAllRead} disabled={busy || filteredRows.length === 0}>Mark All Read</button>
            <button className="soft-button" type="button" onClick={handleClearNotifications} disabled={busy || filteredRows.length === 0}>Clear All</button>
            {renderExportButtons()}
            <button className="submit-button compact" type="button" onClick={() => handleSendPush(false)} disabled={pushBusy}>Send Test Push</button>
            <button className="soft-button" type="button" onClick={() => handleSendPush(true)} disabled={pushBusy || user.role !== 'admin'}>Push All</button>
          </div>
        </div>
        <p className="notifications-disclaimer">Browser push is connected to the backend. Add stable VAPID keys in Coolify so subscriptions survive restarts.</p>
        <section className="alert-banner-card">
          <div><h3>Alert Configuration</h3><p>Certificate uploads and status changes now create notifications automatically.</p></div>
          <div className="alert-controls">
            <label><span>Critical (Days Before)</span><input defaultValue="7" readOnly /></label>
            <label><span>Warning (Days Before)</span><input defaultValue="14" readOnly /></label>
            <label><span>Notice (Days Before)</span><input defaultValue="30" readOnly /></label>
            <label><span>Push State</span><select value={pushEnabled ? 'Enabled' : 'Disabled'} readOnly><option>{pushEnabled ? 'Enabled' : 'Disabled'}</option></select></label>
            <button className="submit-button compact" type="button" onClick={enablePushNotifications} disabled={!pushSupported || pushBusy || pushEnabled}>{pushEnabled ? 'Enabled' : 'Enable Push'}</button>
          </div>
        </section>
        {renderStats()}
        <section className="content-card notifications-card">
          <div className="notification-filter-row">
            {['all', 'expiry', 'approvals', 'system', 'unread'].map((item) => (
              <button key={item} className={`tab-link ${notificationFilter === item ? 'active' : ''}`} type="button" onClick={() => setNotificationFilter(item)}>
                {item.charAt(0).toUpperCase() + item.slice(1)} {item === 'all' ? <span className="badge-counter">{filteredRows.length}</span> : null}
              </button>
            ))}
            <div className="search-shell compact right-push">
              <span className="search-shell-icon" />
              <input aria-label="Search notifications" value={query} onChange={(event) => startTransition(() => setQuery(event.target.value))} placeholder="Search notifications..." />
            </div>
          </div>
          <div className="toggle-row">
            <div className="toggle-card"><span className="toggle on" /> <div><strong>In-App Notifications</strong><p>Stored in MySQL and shown inside the dashboard</p></div></div>
            <div className="toggle-card"><span className={`toggle ${pushEnabled ? 'on' : ''}`} /> <div><strong>Push Notifications</strong><p>{pushSupported ? (pushEnabled ? 'This browser is subscribed for push alerts' : 'Enable browser push alerts for approvals and uploads') : 'This browser does not support push notifications'}</p></div></div>
            <button className="soft-button" type="button" onClick={enablePushNotifications} disabled={!pushSupported || pushBusy || pushEnabled}>{pushEnabled ? 'Enabled' : 'Enable Push'}</button>
            <button className="soft-button" type="button" onClick={() => handleSendPush(false)} disabled={pushBusy}>Test Me</button>
            <button className="soft-button" type="button" onClick={() => handleSendPush(true)} disabled={pushBusy || user.role !== 'admin'}>Test All</button>
          </div>
          <div className="notification-list">
            {filteredRows.length === 0 ? (
              <div className="empty-table-state tall">
                <div className="empty-state-icon"><span className="empty-state-glyph" /></div>
                <strong>No notifications found.</strong>
              </div>
            ) : filteredRows.map((row) => (
              <article key={String(row.id)} className="notification-item">
                <div className="notification-icon">NT</div>
                <div className="notification-content">
                  <div className="notification-title-row">
                    <strong>{safeText(row.title)}</strong>
                    <button className="text-button small" type="button" onClick={() => handleDelete(row)}>×</button>
                  </div>
                  <p>{safeText(row.body)}</p>
                  <div className="notification-tags">
                    <span className="code-pill">{safeText(row.type)}</span>
                    <span>{safeText(row.created_at)}</span>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </section>
      </>
    );
  }
function renderFiles() {
    return (
      <>
        <div className="page-title-block files-title"><h2>{definition.title}</h2></div>
        <section className="content-card file-explorer-card">
          <div className="panel-title-row"><div><h3>Global File Explorer</h3><p>{filteredRows.length} files in current view</p></div></div>
          {renderFilters()}
          {renderTableBlock()}
        </section>
      </>
    );
  }

  function renderAssetsPage() {
    return (
      <>
        <div className="page-actions-row headline-row assets-headline-row">
          <div className="page-title-block assets-title-block"><h2>{definition.title}</h2><p>{definition.subtitle}</p></div>
          <button className="submit-button compact assets-add-button" type="button" onClick={() => setFormOpen((value) => !value)}>+ {definition.addLabel}</button>
        </div>
        {renderFilters()}
        {renderFormPanel()}
        {renderTableBlock()}
      </>
    );
  }

  function renderColumnPickerModal() {
    if (!columnPickerOpen) return null;

    return (
      <div className="modal-overlay" role="presentation" onClick={() => setColumnPickerOpen(false)}>
        <div className="modal-card column-modal" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
          <div className="modal-header">
            <div><h3>Visible Columns</h3><p>Saved in this browser for {user.name}.</p></div>
            <button className="icon-button" type="button" onClick={() => setColumnPickerOpen(false)} aria-label="Close modal">×</button>
          </div>
          <div className="column-picker-list">
            {definition.columns.map((column) => {
              const checked = visibleColumnKeys.includes(column.key);
              return (
                <label key={column.key} className="column-picker-item">
                  <input type="checkbox" checked={checked} onChange={() => toggleVisibleColumn(column.key)} />
                  <span>{column.label}</span>
                </label>
              );
            })}
          </div>
          <div className="modal-footer">
            <button className="soft-button" type="button" onClick={resetVisibleColumns}>Reset</button>
            <button className="submit-button compact" type="button" onClick={() => setColumnPickerOpen(false)}>Done</button>
          </div>
        </div>
      </div>
    );
  }

  function renderAssetImportModal() {
    if (!importOpen || definition.variant !== 'assets') return null;

    return (
      <div className="modal-overlay" role="presentation" onClick={() => setImportOpen(false)}>
        <div className="modal-card import-modal" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
          <div className="import-modal-topbar">
            <div><h3>Import Assets</h3><p>Upload CSV or Excel, review duplicates, then import.</p></div>
            <button className="icon-button" type="button" onClick={() => setImportOpen(false)} aria-label="Close import modal">×</button>
          </div>
          <div className="import-modal-body">
            <div className="import-helper-box">
              <span>First time?</span>
              <button className="text-button" type="button" onClick={() => downloadAssetTemplate('csv')}>CSV template</button>
              <span>or</span>
              <button className="text-button" type="button" onClick={() => downloadAssetTemplate('xlsx')}>Excel template</button>
            </div>
            <label className="upload-dropzone">
              <input type="file" accept=".csv,.xlsx,.xls" onChange={handleImportFileChange} hidden />
              <div className="upload-dropzone-inner">
                <div className="upload-dropzone-icon">?</div>
                <strong>{importFileName ? importFileName : 'Click to browse or drag & drop'}</strong>
                <span>Accepts CSV (.csv) or Excel (.xlsx, .xls)</span>
              </div>
            </label>
            <div className="expected-columns-row">
              {ASSET_REQUIRED_COLUMNS.map((column) => <span key={column} className="required-chip">{column}</span>)}
              {['manufacturer', 'model', 'description', 'notes'].map((column) => <span key={column} className="neutral-chip">{column}</span>)}
            </div>
            {importError ? <p className="error-banner">{importError}</p> : null}
            {importSummary ? (
              <div className="import-summary-card">
                <div className="import-summary-head">
                  <div>
                    <h4>Import Summary</h4>
                    <p>{importSummary.failed ? 'Completed with some failed rows.' : 'All processed rows completed successfully.'}</p>
                  </div>
                  <span className={`status-pill ${importSummary.failed ? 'orange' : 'green'}`}>
                    {importSummary.failed ? 'Needs review' : 'Completed'}
                  </span>
                </div>
                <div className="import-summary-metrics">
                  <span className="neutral-chip">Total {importSummary.total}</span>
                  <span className="status-pill green">Created {importSummary.created}</span>
                  <span className="status-pill green">Updated {importSummary.updated}</span>
                  <span className="status-pill slate">Skipped {importSummary.skipped}</span>
                  <span className={`status-pill ${importSummary.failed ? 'red' : 'green'}`}>Failed {importSummary.failed}</span>
                </div>
                {importSummary.failures.length ? (
                  <div className="import-failure-list">
                    {importSummary.failures.map((failure) => (
                      <article key={`${failure.rowNumber}-${failure.assetLabel}`} className="import-failure-item">
                        <strong>Row {failure.rowNumber} ? {failure.assetLabel}</strong>
                        <p>{failure.message}</p>
                      </article>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}
            {importPreviewRows.length ? (
              <div className="import-preview-shell">
                <div className="import-preview-head"><h4>Preview & Resolve</h4><p>{importPreviewRows.length} rows ready for review</p></div>
                <div className="table-shell">
                  <table className="data-table compact-table">
                    <thead>
                      <tr><th>Row</th><th>Asset Number</th><th>Name</th><th>Status</th><th>Client</th><th>Duplicate</th><th>Action</th><th>Validation</th></tr>
                    </thead>
                    <tbody>
                      {importPreviewRows.map((row) => (
                        <tr key={row.rowNumber}>
                          <td>{row.rowNumber}</td>
                          <td>{row.record.asset_number}</td>
                          <td>{row.record.name}</td>
                          <td>{row.record.status}</td>
                          <td>{row.record.client_id}</td>
                          <td>{row.existing ? 'Existing asset found' : 'New asset'}</td>
                          <td>
                            {row.existing ? (
                              <select value={row.choice} onChange={(event) => updatePreviewChoice(row.rowNumber, event.target.value as DuplicateChoice)}>
                                <option value="unresolved">Choose…</option>
                                <option value="update">Update existing</option>
                                <option value="skip">Skip row</option>
                              </select>
                            ) : <span className="status-pill green">Create</span>}
                          </td>
                          <td>{row.error ? <span className="status-pill red">{row.error}</span> : <span className="status-pill green">Ready</span>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : null}
          </div>
          <div className="modal-footer">
            <button className="soft-button" type="button" onClick={() => { setImportOpen(false); setImportSummary(null); setImportError(''); }}>Cancel</button>
            <button className="submit-button compact" type="button" onClick={runAssetImport} disabled={!importPreviewRows.length || importing}>{importing ? 'Importing...' : 'Import Assets'}</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      {definition.variant === 'clients' ? <section className="resource-page">{renderClients()}</section> : null}
      {definition.variant === 'notifications' ? <section className="resource-page">{renderNotifications()}</section> : null}
      {definition.variant === 'files' ? <section className="resource-page">{renderFiles()}</section> : null}
      {definition.variant === 'assets' ? <section className="resource-page assets-page">{renderAssetsPage()}</section> : null}
      {!['clients', 'notifications', 'files', 'assets'].includes(definition.variant) ? (
        <section className="resource-page">
          <div className="page-actions-row headline-row">
            <div className="page-title-block"><h2>{definition.title}</h2><p>{definition.subtitle}</p></div>
            <button className="submit-button compact" type="button" onClick={() => setFormOpen((value) => !value)}>+ {definition.addLabel}</button>
          </div>
          {renderStats()}
          {renderFilters()}
          {renderFormPanel()}
          {renderTableBlock()}
        </section>
      ) : null}
      {renderColumnPickerModal()}
      {renderAssetImportModal()}
    </>
  );
}











