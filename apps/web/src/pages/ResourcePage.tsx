import { FormEvent, useDeferredValue, useEffect, useMemo, useState, startTransition } from 'react';
import { createResource, deleteResource, fetchResource, updateResource } from '../lib/api';
import { ResourceTable } from '../components/ResourceTable';
import type { ResourceDefinition, ResourceRow } from '../lib/types';

type ResourcePageProps = {
  definition: ResourceDefinition;
};

function buildInitialForm(definition: ResourceDefinition) {
  return Object.fromEntries(definition.fields.map((field) => [field.key, '']));
}

export function ResourcePage({ definition }: ResourcePageProps) {
  const [rows, setRows] = useState<ResourceRow[]>([]);
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [editingId, setEditingId] = useState<string | number | null>(null);
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

  const heading = useMemo(
    () => ({
      title: definition.title,
      subtitle: definition.subtitle,
    }),
    [definition.subtitle, definition.title],
  );

  function resetForm() {
    setEditingId(null);
    setForm(buildInitialForm(definition));
  }

  function beginEdit(row: ResourceRow) {
    setEditingId(String(row.id));
    setForm(
      Object.fromEntries(definition.fields.map((field) => [field.key, String(row[field.key] ?? '')])),
    );
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

  return (
    <section className="content-stack">
      <div className="resource-hero">
        <div>
          <p className="eyebrow">{definition.label}</p>
          <h2>{heading.title}</h2>
          <p>{heading.subtitle}</p>
        </div>

        <input
          className="search-input"
          placeholder={`Search ${definition.label.toLowerCase()}...`}
          value={query}
          onChange={(event) => {
            const nextValue = event.target.value;
            startTransition(() => setQuery(nextValue));
          }}
        />
      </div>

      <div className="panel-grid dense">
        <form className="panel form-panel" onSubmit={handleSubmit}>
          <div className="panel-heading">
            <p className="eyebrow">{editingId ? 'Update record' : 'Add record'}</p>
            <h3>{editingId ? 'Edit current item' : 'Create a new item'}</h3>
          </div>

          {definition.fields.map((field) => (
            <label key={field.key}>
              {field.label}
              {field.type === 'textarea' ? (
                <textarea
                  rows={4}
                  value={form[field.key] ?? ''}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, [field.key]: event.target.value }))
                  }
                />
              ) : field.type === 'select' ? (
                <select
                  value={form[field.key] ?? ''}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, [field.key]: event.target.value }))
                  }
                >
                  <option value="">Select...</option>
                  {field.options?.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type={field.type === 'date' ? 'date' : 'text'}
                  value={form[field.key] ?? ''}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, [field.key]: event.target.value }))
                  }
                />
              )}
            </label>
          ))}

          {error ? <p className="error-banner">{error}</p> : null}

          <div className="button-row">
            <button className="primary-button" type="submit" disabled={busy}>
              {busy ? 'Saving...' : editingId ? 'Update item' : 'Create item'}
            </button>
            <button className="ghost-button" type="button" onClick={resetForm}>
              Clear
            </button>
          </div>
        </form>

        <section className="panel table-panel">
          <div className="panel-heading">
            <p className="eyebrow">Live records</p>
            <h3>{busy ? 'Refreshing data...' : `${rows.length} items loaded`}</h3>
          </div>

          <ResourceTable definition={definition} rows={rows} onEdit={beginEdit} onDelete={handleDelete} />
        </section>
      </div>
    </section>
  );
}