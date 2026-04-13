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

export type ResourceColumn = {
  key: string;
  label: string;
};

export type ResourceField = {
  key: string;
  label: string;
  type?: 'text' | 'date' | 'textarea' | 'select';
  options?: string[];
};

export type ResourceVariant =
  | 'assets'
  | 'certificates'
  | 'jobs'
  | 'notifications'
  | 'files'
  | 'clients'
  | 'inspectors'
  | 'locations';

export type ResourceStat = {
  label: string;
  key: string;
  tone: 'blue' | 'green' | 'orange' | 'red' | 'slate';
};

export type ResourceDefinition = {
  key: string;
  label: string;
  path: string;
  title: string;
  subtitle: string;
  navTitle: string;
  variant: ResourceVariant;
  accent: 'blue' | 'amber';
  addLabel: string;
  columns: ResourceColumn[];
  fields: ResourceField[];
  stats?: ResourceStat[];
};

export type ResourceRow = Record<string, string | number | null>;