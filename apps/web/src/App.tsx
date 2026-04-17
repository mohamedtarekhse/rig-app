import { useEffect, useMemo, useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { fetchMe, getToken } from './lib/api';
import type { ResourceDefinition, SessionUser } from './lib/types';
import { LoginPage } from './pages/LoginPage';
import { ResourcePage } from './pages/ResourcePage';

export const RESOURCE_DEFINITIONS: ResourceDefinition[] = [
  {
    key: 'assets',
    label: 'Assets',
    navTitle: 'Asset Management',
    path: 'assets',
    title: 'Assets',
    subtitle: 'All assets across clients',
    variant: 'assets',
    accent: 'blue',
    addLabel: 'Add Asset',
    stats: [
      { label: 'All', key: 'total', tone: 'blue' },
      { label: 'Operation', key: 'operation', tone: 'green' },
      { label: 'Stacked', key: 'stacked', tone: 'slate' },
    ],
    columns: [
      { key: 'asset_number', label: 'Asset ID' },
      { key: 'name', label: 'Asset Name' },
      { key: 'asset_type', label: 'Type / Category' },
      { key: 'serial_number', label: 'Serial No.' },
      { key: 'functional_location', label: 'Location' },
      { key: 'status', label: 'Status' },
      { key: 'client_id', label: 'Client' },
    ],
    fields: [
      { key: 'asset_number', label: 'Asset number' },
      { key: 'name', label: 'Asset name' },
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
    navTitle: 'Certificate Management',
    path: 'certificates',
    title: 'Certificates',
    subtitle: 'All certificates across clients',
    variant: 'certificates',
    accent: 'blue',
    addLabel: 'Upload Certificate',
    stats: [
      { label: 'Valid', key: 'approved', tone: 'green' },
      { label: 'Pending', key: 'pending', tone: 'orange' },
      { label: 'Rejected', key: 'rejected', tone: 'red' },
    ],
    columns: [
      { key: 'cert_number', label: 'Cert ID' },
      { key: 'asset_id', label: 'Asset number or ID' },
      { key: 'name', label: 'Certificate Name' },
      { key: 'cert_type', label: 'Type' },
      { key: 'issued_by', label: 'Issued By' },
      { key: 'expiry_date', label: 'Expiry' },
      { key: 'approval_status', label: 'Approval' },
      { key: 'file_name', label: 'Attachment' },
      { key: 'client_id', label: 'Client' },
    ],
    fields: [
      { key: 'cert_number', label: 'Certificate number' },
      { key: 'name', label: 'Certificate name' },
      {
        key: 'cert_type',
        label: 'Certificate type',
        type: 'select',
        options: ['CAT III', 'CAT IV', 'ORIGINAL COC', 'LOAD TEST', 'LIFTING', 'NDT', 'TUBULAR'],
      },
      { key: 'asset_id', label: 'Asset number or ID' },
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
    navTitle: 'Asset & Certificate Management',
    path: 'jobs',
    title: 'Jobs',
    subtitle: 'Create work orders and track field actions',
    variant: 'jobs',
    accent: 'blue',
    addLabel: 'Create Job',
    columns: [
      { key: 'job_number', label: 'Job Number' },
      { key: 'client_id', label: 'Client' },
      { key: 'functional_location', label: 'Functional Location' },
      { key: 'notes', label: 'Scope' },
      { key: 'status', label: 'Status' },
    ],
    fields: [
      { key: 'job_number', label: 'Job Number (optional)' },
      { key: 'client_id', label: 'Client code' },
      { key: 'functional_location', label: 'Functional location' },
      { key: 'title', label: 'Title' },
      { key: 'notes', label: 'Scope', type: 'textarea' },
      {
        key: 'status',
        label: 'Status',
        type: 'select',
        options: ['active', 'technician_done', 'closed', 'reopened'],
      },
    ],
  },
  {
    key: 'notifications',
    label: 'Notifications',
    navTitle: 'Notifications & Alerts',
    path: 'notifications',
    title: 'Notifications & Alerts',
    subtitle: 'Certificate expiry alerts, approval updates, and system events',
    variant: 'notifications',
    accent: 'blue',
    addLabel: 'Send Push Alert',
    stats: [
      { label: 'Total', key: 'total', tone: 'blue' },
      { label: 'Unread', key: 'unread', tone: 'red' },
      { label: 'Critical', key: 'critical', tone: 'orange' },
      { label: 'Warnings', key: 'warnings', tone: 'orange' },
      { label: 'Info', key: 'info', tone: 'green' },
    ],
    columns: [
      { key: 'type', label: 'Type' },
      { key: 'title', label: 'Title' },
      { key: 'body', label: 'Body' },
      { key: 'created_at', label: 'Created' },
    ],
    fields: [
      { key: 'type', label: 'Type' },
      { key: 'title', label: 'Title' },
      { key: 'body', label: 'Body', type: 'textarea' },
      { key: 'is_read', label: 'Read state', type: 'select', options: ['0', '1'] },
    ],
  },
  {
    key: 'files',
    label: 'Files',
    navTitle: 'Asset & Certificate Management',
    path: 'files',
    title: 'Files Explorer',
    subtitle: 'Uploaded certificate files across the platform',
    variant: 'files',
    accent: 'amber',
    addLabel: 'Apply',
    columns: [
      { key: 'job_id', label: 'Job' },
      { key: 'client_id', label: 'Client' },
      { key: 'cert_type', label: 'Cert Type' },
      { key: 'file_name', label: 'Filename' },
      { key: 'file_size', label: 'Size' },
      { key: 'uploaded_by', label: 'Uploaded By' },
      { key: 'uploaded_at', label: 'Uploaded At' },
      { key: 'status', label: 'Status' },
    ],
    fields: [
      { key: 'file_name', label: 'Filename' },
      { key: 'status', label: 'Status' },
    ],
  },
  {
    key: 'clients',
    label: 'Clients',
    navTitle: 'Client Management',
    path: 'clients',
    title: 'Client Management',
    subtitle: 'Manage client accounts and their linked assets & certificates',
    variant: 'clients',
    accent: 'amber',
    addLabel: 'Add Client',
    stats: [
      { label: 'Total Clients', key: 'total', tone: 'blue' },
      { label: 'Active Clients', key: 'active', tone: 'green' },
      { label: 'Total Assets', key: 'assets', tone: 'orange' },
      { label: 'Expiring Certs', key: 'expiring', tone: 'red' },
    ],
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
    navTitle: 'Inspector Management',
    path: 'inspectors',
    title: 'Inspector Management',
    subtitle: 'Manage inspector profiles, qualifications & linked certificates',
    variant: 'inspectors',
    accent: 'amber',
    addLabel: 'Add Inspector',
    stats: [
      { label: 'Total Inspectors', key: 'total', tone: 'blue' },
      { label: 'Active', key: 'active', tone: 'green' },
      { label: 'Avg Experience', key: 'avgExperience', tone: 'orange' },
      { label: 'Linked Certificates', key: 'linkedCertificates', tone: 'green' },
    ],
    columns: [
      { key: 'inspector_number', label: 'Inspector ID' },
      { key: 'name', label: 'Name / Title' },
      { key: 'education', label: 'Education' },
      { key: 'experience_years', label: 'Experience' },
      { key: 'cv', label: 'CV' },
      { key: 'training_certificates', label: 'Training Certificates' },
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
    label: 'Func. Locations',
    navTitle: 'Functional Locations',
    path: 'functional-locations',
    title: 'Functional Locations',
    subtitle: 'Manage rigs, workshops and other locations grouped by client',
    variant: 'locations',
    accent: 'amber',
    addLabel: 'Add Location',
    stats: [
      { label: 'Total Locations', key: 'total', tone: 'blue' },
      { label: 'Rigs', key: 'rigs', tone: 'green' },
      { label: 'Workshops', key: 'workshops', tone: 'orange' },
      { label: 'Other', key: 'other', tone: 'slate' },
    ],
    columns: [
      { key: 'fl_id', label: 'Location ID' },
      { key: 'name', label: 'Location Name' },
      { key: 'type', label: 'Type' },
      { key: 'client_id', label: 'Client' },
      { key: 'notes', label: 'Description' },
      { key: 'assets', label: 'Assets' },
    ],
    fields: [
      { key: 'fl_id', label: 'Functional location ID' },
      { key: 'name', label: 'Name' },
      { key: 'type', label: 'Type', type: 'select', options: ['Rig', 'Workshop', 'Yard', 'Warehouse', 'Other'] },
      { key: 'client_id', label: 'Client code' },
      { key: 'status', label: 'Status', type: 'select', options: ['active', 'inactive'] },
      { key: 'notes', label: 'Description', type: 'textarea' },
    ],
  },
];

function ProtectedApp({ user }: { user: SessionUser }) {
  const definitions = useMemo(() => RESOURCE_DEFINITIONS, []);

  return (
    <Routes>
      <Route element={<Layout user={user} definitions={definitions} />}>
        <Route path="/" element={<Navigate to="/assets" replace />} />
        {definitions.map((definition) => (
          <Route
            key={definition.key}
            path={`/${definition.path}`}
            element={<ResourcePage definition={definition} user={user} />}
          />
        ))}
      </Route>
      <Route path="*" element={<Navigate to="/assets" replace />} />
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



