import type { ResourceDefinition, ResourceRow } from '../lib/types';

type ResourceTableProps = {
  definition: ResourceDefinition;
  rows: ResourceRow[];
  onEdit: (row: ResourceRow) => void;
  onDelete: (row: ResourceRow) => void;
};

export function ResourceTable({ definition, rows, onEdit, onDelete }: ResourceTableProps) {
  return (
    <div className="table-wrap">
      <table className="resource-table">
        <thead>
          <tr>
            {definition.columns.map((column) => (
              <th key={column.key}>{column.label}</th>
            ))}
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={definition.columns.length + 1} className="empty-cell">
                No records yet.
              </td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr key={String(row.id)}>
                {definition.columns.map((column) => (
                  <td key={column.key}>{String(row[column.key] ?? '-')}</td>
                ))}
                <td className="actions-cell">
                  <button className="ghost-button" onClick={() => onEdit(row)}>
                    Edit
                  </button>
                  <button className="danger-button" onClick={() => onDelete(row)}>
                    Delete
                  </button>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}