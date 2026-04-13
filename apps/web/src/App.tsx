import { useEffect, useMemo, useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { fetchMe, getToken } from './lib/api';
import type { ResourceDefinition, SessionUser } from './lib/types';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/DashboardPage';
import { ResourcePage } from './pages/ResourcePage';

const RESOURCE_DEFINITIONS: ResourceDefinition[] = [
  {
    key: 'assets',
    label: 'Assets',
    path: 'assets',
    title: 'Asset registry',
    subtitle: 'Track fleet equipment, operating status, and asset ownership by client.',
    columns: [
      { key: 'asset_number', label: 'Asset #' },
      { key: 'name', label: 'Name' },
      { key: 'asset_type', label: 'Type' },
      { key: 'client_id', label: 'Client' },
      { key: 'status', label: 'Status' },
    ],
    fields: [
      { key: 'asset_number', label: 'Asset number' },
      { key: 'name', label: 'Name' },
      {
        key: 'asset_type',
        label: 'Asset type',
        type: 'select',
        options: ['Hoisting Equipment', 'Drilling Equipment', 'Mud System', 'Wirelines', 'Tubular'],
      },
      { key: 'client_id', label: 'Client code' },
      { key: 'status', label: 'Status', type: 'select', options: ['operation', 'stacked'] },
      { key: 'functional_location', label: 'Functional location' },
      { key: 'serial_number', label: 'Serial number' },
      { key: 'manufacturer', label: 'Manufacturer' },
      { key: 'notes', label: 'Notes', type: 'textarea' },
    ],
  },
  {
    key: 'certificates',
    label: 'Certificates',
    path: 'certificates',
    title: 'Certificate control',
    subtitle: 'Review issue dates, expiry windows, and approval state from a single workflow.',
    columns: [
      { key: 'cert_number', label: 'Certificate #' },
      { key: 'name', label: 'Name' },
      { key: 'asset_id', label: 'Asset ID' },
      { key: 'expiry_date', label: 'Expiry' },
      { key: 'approval_status', label: 'Approval' },
    ],
    fields: [
      { key: 'cert_number', label: 'Certificate number' },
      { key: 'name', label: 'Name' },
      {
        key: 'cert_type',
        label: 'Certificate type',
        type: 'select',
        options: ['CAT III', 'CAT IV', 'ORIGINAL COC', 'LOAD TEST', 'LIFTING', 'NDT', 'TUBULAR'],
      },
      { key: 'asset_id', label: 'Asset ID' },
      { key: 'client_id', label: 'Client code' },
      { key: 'issued_by', label: 'Issued by' },
      { key: 'issue_date', label: 'Issue date', type: 'date' },
      { key: 'expiry_date', label: 'Expiry date', type: 'date' },
      {
        key: 'approval_status',
        label: 'Approval status',
        type: 'select',
        options: ['pending', 'approved', 'rejected'],
      },
      { key: 'notes', label: 'Notes', type: 'textarea' },
    ],
  },
  {
    key: 'jobs',
    label: 'Jobs',
    path: 'jobs',
    title: 'Job workflow',
    subtitle: 'Coordinate field jobs, assign responsibility, and move work cleanly to closure.',
    columns: [
      { key: 'job_number', label: 'Job #' },
      { key: 'title', label: 'Title' },
      { key: 'client_id', label: 'Client' },
      { key: 'functional_location', label: 'Location' },
      { key: 'status', label: 'Status' },
    ],
    fields: [
      { key: 'job_number', label: 'Job number' },
      { key: 'client_id', label: 'Client code' },
      { key: 'functional_location', label: 'Functional location' },
      { key: 'title', label: 'Title' },
      {
        key: 'status',
        label: 'Status',
        type: 'select',
        options: ['active', 'technician_done', 'closed', 'reopened'],
      },
      { key: 'notes', label: 'Notes', type: 'textarea' },
    ],
  },
  {
    key: 'clients',
    label: 'Clients',
    path: 'clients',
    title: 'Client directory',
    subtitle: 'Maintain customer identities, account state, and contact detail in one place.',
    columns: [
      { key: 'client_id', label: 'Client ID' },
      { key: 'name', label: 'Name' },
      { key: 'industry', label: 'Industry' },
      { key: 'city', label: 'City' },
      { key: 'status', label: 'Status' },
    ],
    fields: [
      { key: 'client_id', label: 'Client ID' },
      { key: 'name', label: 'Name' },
      { key: 'industry', label: 'Industry' },
      { key: 'contact', label: 'Contact' },
      { key: 'email', label: 'Email' },
      { key: 'phone', label: 'Phone' },
      { key: 'country', label: 'Country' },
      { key: 'city', label: 'City' },
      { key: 'status', label: 'Status', type: 'select', options: ['active', 'inactive', 'suspended'] },
    ],
  },
  {
    key: 'inspectors',
    label: 'Inspectors',
    path: 'inspectors',
    title: 'Inspector roster',
    subtitle: 'Store assigned inspectors, contact details, and field availability.',
    columns: [
      { key: 'inspector_number', label: 'Inspector #' },
      { key: 'name', label: 'Name' },
      { key: 'title', label: 'Title' },
      { key: 'email', label: 'Email' },
      { key: 'status', label: 'Status' },
    ],
    fields: [
      { key: 'inspector_number', label: 'Inspector number' },
      { key: 'name', label: 'Name' },
      { key: 'title', label: 'Title' },
      { key: 'email', label: 'Email' },
      { key: 'phone', label: 'Phone' },
      { key: 'status', label: 'Status', type: 'select', options: ['active', 'inactive'] },
      { key: 'experience_years', label: 'Experience years' },
    ],
  },
  {
    key: 'functional-locations',
    label: 'Functional locations',
    path: 'functional-locations',
    title: 'Location structure',
    subtitle: 'Anchor assets and jobs to field locations that map cleanly to client operations.',
    columns: [
      { key: 'fl_id', label: 'FL ID' },
      { key: 'name', label: 'Name' },
      { key: 'type', label: 'Type' },
      { key: 'client_id', label: 'Client' },
      { key: 'status', label: 'Status' },
    ],
    fields: [
      { key: 'fl_id', label: 'Functional location ID' },
      { key: 'name', label: 'Name' },
      { key: 'type', label: 'Type', type: 'select', options: ['Rig', 'Workshop', 'Yard', 'Warehouse', 'Other'] },
      { key: 'client_id', label: 'Client code' },
      { key: 'status', label: 'Status', type: 'select', options: ['active', 'inactive'] },
      { key: 'notes', label: 'Notes', type: 'textarea' },
    ],
  },
  {
    key: 'notifications',
    label: 'Notifications',
    path: 'notifications',
    title: 'Notification center',
    subtitle: 'See operational messages, unread state, and reference links across the platform.',
    columns: [
      { key: 'type', label: 'Type' },
      { key: 'title', label: 'Title' },
      { key: 'body', label: 'Body' },
      { key: 'is_read', label: 'Read' },
      { key: 'created_at', label: 'Created' },
    ],
    fields: [
      { key: 'type', label: 'Type' },
      { key: 'title', label: 'Title' },
      { key: 'body', label: 'Body', type: 'textarea' },
      { key: 'is_read', label: 'Read state', type: 'select', options: ['0', '1'] },
    ],
  },
];

function ProtectedApp({ user }: { user: SessionUser }) {
  const definitions = useMemo(() => RESOURCE_DEFINITIONS, []);

  return (
    <Routes>
      <Route element={<Layout user={user} />}>
        <Route path="/" element={<DashboardPage />} />
        {definitions.map((definition) => (
          <Route
            key={definition.key}
            path={`/${definition.path}`}
            element={<ResourcePage definition={definition} />}
          />
        ))}
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!getToken()) {
      setLoading(false);
      return;
    }

    fetchMe()
      .then((profile) => setUser(profile))
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <div className="loading-screen">Loading Rigways...</div>;
  }

  return (
    <BrowserRouter>
      {user ? (
        <ProtectedApp user={user} />
      ) : (
        <Routes>
          <Route path="/login" element={<LoginPage onAuthenticated={setUser} />} />
          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      )}
    </BrowserRouter>
  );
}