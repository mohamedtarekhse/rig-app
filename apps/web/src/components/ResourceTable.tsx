import type { ResourceDefinition, ResourceRow } from '../lib/types';

type ResourceTableProps = {
  definition: ResourceDefinition;
  rows: ResourceRow[];
  onEdit: (row: ResourceRow) => void;
  onDelete: (row: ResourceRow) => void;
};

function formatCell(definition: ResourceDefinition, key: string, value: string | number | null) {
  const text = String(value ?? '—');

  if (key === 'status' || key === 'approval_status') {
    const tone = text.toLowerCase().includes('active') || text.toLowerCase().includes('operation') || text.toLowerCase().includes('approved')
      ? 'green'
      : text.toLowerCase().includes('pending') || text.toLowerCase().includes('reopen')
        ? 'orange'
        : text.toLowerCase().includes('stacked') || text.toLowerCase().includes('closed') || text.toLowerCase().includes('inactive')
          ? 'slate'
          : 'red';
    return <span className={`status-pill ${tone}`}>{text}</span>;
  }

  if (key === 'client_id' || key === 'asset_number' || key === 'cert_number' || key === 'inspector_number' || key === 'fl_id') {
    return <span className="code-pill">{text}</span>;
  }

  if (definition.variant === 'inspectors' && key === 'name') {
    return (
      <div className="avatar-text-row">
        <span className="mini-avatar">{text.split(' ').map((part) => part[0]).slice(0, 2).join('')}</span>
        <div>
          <strong className="linkish">{text}</strong>
          <p>{String((value as string) ? '' : '')}</p>
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

export function ResourceTable({ definition, rows, onEdit, onDelete }: ResourceTableProps) {
  return (
    <div className="table-shell">
      <table className="data-table">
        <thead>
          <tr>
            <th className="checkbox-col"><input type="checkbox" /></th>
            {definition.columns.map((column) => (
              <th key={column.key}>{column.label}</th>
            ))}
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={definition.columns.length + 2} className="empty-state-cell">
                <div className="empty-table-state">
                  <div className="empty-state-icon">?</div>
                  <strong>No {definition.label.toLowerCase()} found.</strong>
                </div>
              </td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr key={String(row.id)}>
                <td className="checkbox-col"><input type="checkbox" /></td>
                {definition.columns.map((column) => (
                  <td key={column.key}>{formatCell(definition, column.key, row[column.key] ?? null)}</td>
                ))}
                <td>
                  <div className="row-actions">
                    <button className="icon-button edit" onClick={() => onEdit(row)}>?</button>
                    <button className="icon-button delete" onClick={() => onDelete(row)}>??</button>
                  </div>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}