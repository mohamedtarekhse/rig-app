import { FormEvent, useDeferredValue, useEffect, useMemo, useState, startTransition } from 'react';
import { createResource, deleteResource, fetchResource, updateResource } from '../lib/api';
import { ResourceTable } from '../components/ResourceTable';
import type { ResourceDefinition, ResourceRow } from '../lib/types';

type ResourcePageProps = {
  definition: ResourceDefinition;
};

type StatMap = Record<string, number>;

function buildInitialForm(definition: ResourceDefinition) {
  return Object.fromEntries(definition.fields.map((field) => [field.key, '']));
}

function safeText(value: string | number | null | undefined) {
  return String(value ?? '—');
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

export function ResourcePage({ definition }: ResourcePageProps) {
  const [rows, setRows] = useState<ResourceRow[]>([]);
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [editingId, setEditingId] = useState<string | number | null>(null);
  const [formOpen, setFormOpen] = useState(definition.variant === 'jobs');
  const [form, setForm] = useState<Record<string, string>>(() => buildInitialForm(definition));

  useEffect(() => {
    let cancelled = false;
    setBusy(true);

    fetchResource(definition.path, deferredQuery)
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
  }, [definition.path, deferredQuery]);

  const stats = useMemo(() => computeStats(definition, rows), [definition, rows]);

  function resetForm() {
    setEditingId(null);
    setForm(buildInitialForm(definition));
    if (definition.variant !== 'jobs') {
      setFormOpen(false);
    }
  }

  function beginEdit(row: ResourceRow) {
    setEditingId(String(row.id));
    setFormOpen(true);
    setForm(Object.fromEntries(definition.fields.map((field) => [field.key, String(row[field.key] ?? '')])));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');

    try {
      if (editingId) {
        await updateResource(definition.path, editingId, form);
      } else {
        await createResource(definition.path, form);
      }

      const updatedRows = await fetchResource(definition.path, deferredQuery);
      setRows(updatedRows);
      resetForm();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Save failed.');
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(row: ResourceRow) {
    const label = row.name ?? row.title ?? row.client_id ?? row.asset_number ?? row.job_number ?? row.id;
    if (!window.confirm(`Delete ${String(label)}?`)) {
      return;
    }

    setBusy(true);
    setError('');

    try {
      await deleteResource(definition.path, String(row.id));
      const updatedRows = await fetchResource(definition.path, deferredQuery);
      setRows(updatedRows);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Delete failed.');
    } finally {
      setBusy(false);
    }
  }

  function renderStats() {
    if (!definition.stats?.length) {
      return null;
    }

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

  function renderFilters() {
    if (definition.variant === 'notifications') {
      return null;
    }

    const placeholderMap: Record<string, string> = {
      assets: 'Search assets...',
      certificates: 'Search certificates...',
      clients: 'Search clients...',
      inspectors: 'Search inspectors...',
      locations: 'Search locations...',
      files: 'Filename contains...',
      jobs: 'Search jobs...',
    };

    const isAssets = definition.variant === 'assets';

    return (
      <div className={`toolbar-card ${isAssets ? 'assets-toolbar-card' : ''}`}>
        <div className="filter-chip-row">
          <button className="filter-chip active">All</button>
          {definition.variant === 'assets' ? (
            <>
              <button className="filter-chip">Operation</button>
              <button className="filter-chip">Stacked</button>
            </>
          ) : null}
          {definition.variant === 'certificates' ? (
            <>
              <button className="filter-chip">Valid</button>
              <button className="filter-chip">Expiring</button>
              <button className="filter-chip">Expired</button>
              <button className="filter-chip">Pending</button>
              <button className="filter-chip">Rejected</button>
            </>
          ) : null}
          {definition.variant === 'inspectors' ? (
            <>
              <button className="filter-chip">Active</button>
              <button className="filter-chip">Inactive</button>
            </>
          ) : null}
          {definition.variant === 'locations' ? (
            <>
              <button className="filter-chip">Rigs</button>
              <button className="filter-chip">Workshops</button>
              <button className="filter-chip">Other</button>
            </>
          ) : null}
        </div>

        <div className={`toolbar-row ${isAssets ? 'assets-toolbar-row' : ''}`}>
          {definition.variant !== 'files' ? <select><option>All Clients</option></select> : <input placeholder="Job" />}
          {definition.variant === 'assets' ? <select><option>All Types</option></select> : null}
          {definition.variant === 'certificates' ? <select><option>All Types</option></select> : null}
          {definition.variant === 'locations' ? <select><option>All Clients</option></select> : null}
          {definition.variant === 'assets' ? <select><option>All Locations</option></select> : null}
          {definition.variant === 'files' ? (
            <>
              <input placeholder="Client" />
              <input placeholder="Cert Type" />
            </>
          ) : null}
          {(definition.variant === 'assets' || definition.variant === 'jobs' || definition.variant === 'files') ? <input placeholder="mm/dd/yyyy" /> : null}
          <div className="search-shell compact assets-search-shell">
            <span className="search-shell-icon" />
            <input
              placeholder={placeholderMap[definition.variant] ?? 'Search...'}
              value={query}
              onChange={(event) => {
                const nextValue = event.target.value;
                startTransition(() => setQuery(nextValue));
              }}
            />
          </div>
          <div className="toolbar-actions">
            <button className="soft-button">Columns <span className="badge-counter">{definition.columns.length}</span></button>
            <button className="soft-button">CSV</button>
            <button className="soft-button danger">PDF</button>
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
            <p>{busy ? 'Refreshing data...' : `${rows.length} records loaded`}</p>
          </div>
          <div className="table-footer-tools">
            <span>Density</span>
            <button className="density-toggle active">C</button>
            <button className="density-toggle">K</button>
          </div>
        </div>
        <ResourceTable definition={definition} rows={rows} onEdit={beginEdit} onDelete={handleDelete} />
      </section>
    );
  }

  function renderFormPanel() {
    if (!formOpen) {
      return null;
    }

    return (
      <form className="content-card action-form" onSubmit={handleSubmit}>
        <div className="panel-title-row">
          <div>
            <h3>{editingId ? `Edit ${definition.label.slice(0, -1) || definition.label}` : definition.addLabel}</h3>
            <p>{definition.subtitle}</p>
          </div>
          {definition.variant !== 'jobs' ? (
            <button className="text-button" type="button" onClick={() => setFormOpen(false)}>Close</button>
          ) : null}
        </div>

        <div className={`form-grid variant-${definition.variant}`}>
          {definition.fields.map((field) => (
            <label key={field.key} className={field.type === 'textarea' ? 'span-two' : ''}>
              <span>{field.label}</span>
              {field.type === 'textarea' ? (
                <textarea
                  rows={4}
                  value={form[field.key] ?? ''}
                  onChange={(event) => setForm((current) => ({ ...current, [field.key]: event.target.value }))}
                />
              ) : field.type === 'select' ? (
                <select
                  value={form[field.key] ?? ''}
                  onChange={(event) => setForm((current) => ({ ...current, [field.key]: event.target.value }))}
                >
                  <option value="">Select...</option>
                  {field.options?.map((option) => (
                    <option key={option} value={option}>{option}</option>
                  ))}
                </select>
              ) : (
                <input
                  type={field.type === 'date' ? 'date' : 'text'}
                  value={form[field.key] ?? ''}
                  placeholder={field.label}
                  onChange={(event) => setForm((current) => ({ ...current, [field.key]: event.target.value }))}
                />
              )}
            </label>
          ))}
        </div>

        {error ? <p className="error-banner">{error}</p> : null}

        <div className="form-actions">
          <button className="submit-button compact" type="submit" disabled={busy}>{busy ? 'Saving...' : editingId ? 'Update' : definition.addLabel}</button>
          <button className="soft-button" type="button" onClick={resetForm}>Clear</button>
        </div>
      </form>
    );
  }

  function renderClients() {
    return (
      <>
        {renderStats()}
        <div className="page-actions-row">
          <div className="search-stack">
            <div className="search-shell compact wide">
              <span className="search-shell-icon" />
              <input value={query} onChange={(event) => startTransition(() => setQuery(event.target.value))} placeholder="Search clients..." />
            </div>
            <select><option>All Status</option></select>
            <select><option>All Industries</option></select>
          </div>
          <div className="page-actions-right">
            <button className="icon-button square">[]</button>
            <button className="icon-button square">=</button>
            <button className="submit-button compact" type="button" onClick={() => setFormOpen(true)}>+ {definition.addLabel}</button>
          </div>
        </div>
        {renderFormPanel()}
        <section className="client-grid">
          {rows.map((row) => (
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
                  <button className="icon-button edit" onClick={() => beginEdit(row)}>ED</button>
                  <button className="icon-button delete" onClick={() => handleDelete(row)}>DL</button>
                </div>
              </div>
              <div className="client-metrics">
                <div><strong>0</strong><span>Assets</span></div>
                <div><strong>0</strong><span>Certs</span></div>
                <div><strong>0</strong><span>Expiring</span></div>
                <div><strong>{statusKey(row.status).includes('active') ? 'ON' : 'OFF'}</strong><span>Status</span></div>
              </div>
              <div className="client-footer">
                <div>
                  <span>{safeText(row.contact)}</span>
                  <small>{safeText(row.email)}</small>
                </div>
                <div>
                  <span>Contract ends</span>
                  <small>—</small>
                </div>
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
          <div>
            <h2>{definition.title}</h2>
            <p>{definition.subtitle}</p>
          </div>
          <div className="toolbar-actions wide-gap">
            <button className="soft-button">Reset Push</button>
            <button className="soft-button">Mark All Read</button>
            <button className="soft-button">Clear All</button>
            <button className="submit-button compact" type="button">Send Alerts by Email</button>
            <button className="soft-button">Check Health</button>
          </div>
        </div>
        <section className="alert-banner-card">
          <div>
            <h3>Alert Configuration</h3>
            <p>Configure when expiry alerts are triggered for certificates</p>
          </div>
          <div className="alert-controls">
            <label><span>Critical (Days Before)</span><input defaultValue="7" /></label>
            <label><span>Warning (Days Before)</span><input defaultValue="14" /></label>
            <label><span>Notice (Days Before)</span><input defaultValue="30" /></label>
            <label><span>Email Digest</span><select defaultValue="Daily"><option>Daily</option></select></label>
            <button className="submit-button compact">Save Config</button>
          </div>
        </section>
        {renderStats()}
        <section className="content-card notifications-card">
          <div className="notification-filter-row">
            <button className="tab-link active">All <span className="badge-counter">{rows.length}</span></button>
            <button className="tab-link">Expiry</button>
            <button className="tab-link">Approvals</button>
            <button className="tab-link">System</button>
            <button className="tab-link">Unread</button>
            <div className="search-shell compact right-push">
              <span className="search-shell-icon" />
              <input value={query} onChange={(event) => startTransition(() => setQuery(event.target.value))} placeholder="Search notifications..." />
            </div>
          </div>
          <div className="toggle-row">
            <div className="toggle-card"><span className="toggle on" /> <div><strong>Email Notifications</strong><p>Receive digest emails for expiry alerts</p></div></div>
            <div className="toggle-card"><span className="toggle" /> <div><strong>Push Notifications</strong><p>Enable browser push alerts</p></div></div>
            <button className="soft-button">Test Me</button>
            <button className="soft-button">Test All</button>
          </div>
          <div className="notification-list">
            {rows.length === 0 ? (
              <div className="empty-table-state tall">
                <div className="empty-state-icon">0</div>
                <strong>No notifications found.</strong>
              </div>
            ) : rows.map((row) => (
              <article key={String(row.id)} className="notification-item">
                <div className="notification-icon">OK</div>
                <div className="notification-content">
                  <div className="notification-title-row">
                    <strong>{safeText(row.title)}</strong>
                    <button className="text-button small" onClick={() => handleDelete(row)}>x</button>
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
        <div className="page-title-block files-title">
          <h2>{definition.title}</h2>
        </div>
        <section className="content-card file-explorer-card">
          <div className="panel-title-row"><div><h3>Global File Explorer</h3></div></div>
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
          <div className="page-title-block assets-title-block">
            <h2>{definition.title}</h2>
            <p>{definition.subtitle}</p>
          </div>
          <button className="submit-button compact assets-add-button" type="button" onClick={() => setFormOpen((value) => !value)}>
            + {definition.addLabel}
          </button>
        </div>
        {renderFilters()}
        {renderFormPanel()}
        {renderTableBlock()}
      </>
    );
  }

  if (definition.variant === 'clients') {
    return <section className="resource-page">{renderClients()}</section>;
  }

  if (definition.variant === 'notifications') {
    return <section className="resource-page">{renderNotifications()}</section>;
  }

  if (definition.variant === 'files') {
    return <section className="resource-page">{renderFiles()}</section>;
  }

  if (definition.variant === 'assets') {
    return <section className="resource-page assets-page">{renderAssetsPage()}</section>;
  }

  return (
    <section className="resource-page">
      <div className="page-actions-row headline-row">
        <div className="page-title-block">
          <h2>{definition.title}</h2>
          <p>{definition.subtitle}</p>
        </div>
        <button className="submit-button compact" type="button" onClick={() => setFormOpen((value) => !value)}>
          + {definition.addLabel}
        </button>
      </div>

      {renderStats()}
      {definition.variant !== 'jobs' ? renderFilters() : null}
      {renderFormPanel()}
      {renderTableBlock()}
    </section>
  );
}
