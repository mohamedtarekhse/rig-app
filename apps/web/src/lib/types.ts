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

export type CertificateWithExpiry = {
  id: number;
  cert_number: string;
  name: string;
  cert_type: string;
  asset_id: number;
  client_id: string | null;
  functional_location: string | null;
  inspector_id: number | null;
  inspector_name: string | null;
  issued_by: string;
  issue_date: string;
  expiry_date: string;
  approval_status: string;
  notes: string | null;
  file_name: string | null;
  file_url: string | null;
  file_size: number | null;
  mime_type: string | null;
  uploaded_at: string | null;
  created_at: string;
  updated_at: string;
  days_until_expiry: number;
};

export type TransferRecord = {
  id: number;
  from_client_id: string | null;
  to_client_id: string | null;
  from_functional_location: string | null;
  to_functional_location: string | null;
  transferred_by: number;
  transfer_date: string;
  notes: string | null;
  user_name: string | null;
};

export type AssetDetail = {
  asset: {
    id: number;
    asset_number: string;
    name: string;
    asset_type: string;
    status: string;
    client_id: string | null;
    functional_location: string | null;
    serial_number: string | null;
    manufacturer: string | null;
    model: string | null;
    description: string | null;
    notes: string | null;
    created_at: string;
    updated_at: string;
  };
  certificates: CertificateWithExpiry[];
  transfers: TransferRecord[];
};

export type InspectorWithUser = {
  id: number;
  inspector_number: string | null;
  name: string;
  title: string | null;
  email: string | null;
  phone: string | null;
  status: string;
  experience_years: number | null;
  user_id: number | null;
  username: string | null;
};

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