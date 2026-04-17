import { useState } from 'react';
import type { ResourceColumn, ResourceDefinition, ResourceRow } from '../lib/types';
import { AssetModal } from './AssetModal';

type ResourceTableProps = {
  definition: ResourceDefinition;
  columns: ResourceColumn[];
  rows: ResourceRow[];
  onEdit: (row: ResourceRow) => void;
  onDelete: (row: ResourceRow) => void;
  userRole?: string;
};

function formatCell(definition: ResourceDefinition, key: string, value: string | number | null, row: ResourceRow) {
  const text = String(value ?? '—');

  if (key === 'status' || key === 'approval_status') {
    const tone = text.toLowerCase().includes('active') || text.toLowerCase().includes('operation') || text.toLowerCase().includes('approved')
      ? 'green'
      : text.toLowerCase().includes('pending') || text.toLowerCase().includes('reopen') || text.toLowerCase().includes('expiring')
        ? 'orange'
        : text.toLowerCase().includes('stacked') || text.toLowerCase().includes('closed') || text.toLowerCase().includes('inactive')
          ? 'slate'
          : 'red';
    return <span className={`status-pill ${tone}`}>{text}</span>;
  }

  if (key === 'client_id' || key === 'asset_number' || key === 'cert_number' || key === 'inspector_number' || key === 'fl_id') {
    return <span className="code-pill">{text}</span>;
  }

  if (key === 'file_name' && row.file_url) {
    return <a className="text-button small" href={String(row.file_url)} target="_blank" rel="noreferrer">{text}</a>;
  }

  if (definition.variant === 'inspectors' && key === 'name') {
    return (
      <div className="avatar-text-row">
        <span className="mini-avatar">{text.split(' ').map((part) => part[0]).slice(0, 2).join('')}</span>
        <div>
          <strong className="linkish">{text}</strong>
        </div>
      </div>
    );
  }

  if (definition.variant === 'assets' && key === 'name') {
    return <strong className="linkish">{text}</strong>;
  }

  if (definition.variant === 'locations' && key === 'client_id') {
    return <span className="client-chip"><span className="client-dot" /> {text}</span>;
  }

  return text;
}

export function ResourceTable({ definition, columns, rows, onEdit, onDelete, userRole = 'admin' }: ResourceTableProps) {
  const allowActions = definition.variant !== 'files';
  const [selectedAssetId, setSelectedAssetId] = useState<number | null>(null);

  const handleAssetClick = (row: ResourceRow) => {
    if (definition.variant === 'assets' && row.id) {
      setSelectedAssetId(Number(row.id));
    }
  };

  return (
    <>
      <div className="table-shell">
        <table className="data-table">
          <thead>
            <tr>
              <th className="checkbox-col"><input type="checkbox" aria-label="Select all rows" /></th>
              {columns.map((column) => (
                <th key={column.key}>{column.label}</th>
              ))}
              {allowActions ? <th>Actions</th> : null}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length + (allowActions ? 2 : 1)} className="empty-state-cell">
                  <div className="empty-table-state">
                    <div className="empty-state-icon">
                      <span className="empty-state-glyph" />
                    </div>
                    <strong>No {definition.label.toLowerCase()} found.</strong>
                  </div>
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr 
                  key={String(row.id)}
                  className={definition.variant === 'assets' ? 'cursor-pointer hover:bg-blue-50' : ''}
                  onClick={() => definition.variant === 'assets' && handleAssetClick(row)}
                >
                  <td className="checkbox-col"><input type="checkbox" aria-label={`Select row ${String(row.id)}`} onClick={(e) => e.stopPropagation()} /></td>
                  {columns.map((column) => (
                    <td key={column.key}>{formatCell(definition, column.key, row[column.key] ?? null, row)}</td>
                  ))}
                  {allowActions ? (
                    <td onClick={(e) => e.stopPropagation()}>
                      <div className="row-actions">
                        <button className="icon-button edit" onClick={() => onEdit(row)} aria-label="Edit row" type="button">
                          <span className="icon-pencil" />
                        </button>
                        <button className="icon-button delete" onClick={() => onDelete(row)} aria-label="Delete row" type="button">
                          <span className="icon-trash" />
                        </button>
                      </div>
                    </td>
                  ) : null}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {selectedAssetId && (
        <AssetModal
          assetId={selectedAssetId}
          onClose={() => setSelectedAssetId(null)}
          userRole={userRole}
        />
      )}
    </>
  );
}
