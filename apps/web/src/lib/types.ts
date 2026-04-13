export type UserRole = 'admin' | 'manager' | 'technician' | 'user';

export type SessionUser = {
  id: number;
  username: string;
  name: string;
  role: UserRole;
  customer_id: string | null;
};

export type DashboardSummary = {
  assets: number;
  certificates: number;
  jobs: number;
  notifications: number;
  clients: number;
  inspectors: number;
};

export type ResourceDefinition = {
  key: string;
  label: string;
  path: string;
  title: string;
  subtitle: string;
  columns: Array<{ key: string; label: string }>;
  fields: Array<{ key: string; label: string; type?: 'text' | 'date' | 'textarea' | 'select'; options?: string[] }>;
};

export type ResourceRow = Record<string, string | number | null>;