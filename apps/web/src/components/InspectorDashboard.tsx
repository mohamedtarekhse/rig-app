import { useState, useEffect, useMemo } from 'react';
import { fetchInspectorCertificates, uploadCertificateFile, createResource, updateResource, fetchResource } from '../lib/api';
import type { CertificateWithExpiry, SessionUser, ResourceRow } from '../lib/types';
import { daysUntil } from '../lib/resourceTools';

type InspectorDashboardProps = {
  user: SessionUser;
};

type CertificateUploadDraft = {
  file: File | null;
  cert_number: string;
  name: string;
  cert_type: string;
  asset_id: string;
  client_id: string;
  functional_location: string;
  issued_by: string;
  issue_date: string;
  expiry_date: string;
  notes: string;
};

const initialForm: CertificateUploadDraft = {
  file: null,
  cert_number: '',
  name: '',
  cert_type: '',
  asset_id: '',
  client_id: '',
  functional_location: '',
  issued_by: '',
  issue_date: '',
  expiry_date: '',
  notes: '',
};

export function InspectorDashboard({ user }: InspectorDashboardProps) {
  const [certificates, setCertificates] = useState<CertificateWithExpiry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<CertificateUploadDraft>(initialForm);
  const [submitting, setSubmitting] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [filter, setFilter] = useState<'all' | 'valid' | 'expiring' | 'expired'>('all');
  const [clients, setClients] = useState<ResourceRow[]>([]);
  const [assets, setAssets] = useState<ResourceRow[]>([]);
  const [locations, setLocations] = useState<ResourceRow[]>([]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');

    Promise.all([
      fetchInspectorCertificates(user.id),
      fetchResource('clients'),
      fetchResource('assets'),
      fetchResource('locations'),
    ])
      .then(([certs, clientsData, assetsData, locationsData]) => {
        if (!cancelled) {
          setCertificates(certs);
          setClients(clientsData);
          setAssets(assetsData);
          setLocations(locationsData);
          setLoading(false);
        }
      })
      .catch((caught) => {
        if (!cancelled) {
          setError(caught instanceof Error ? caught.message : 'Failed to load dashboard.');
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [user.id]);

  function canEditCertificate(cert: CertificateWithExpiry): boolean {
    if (user.role === 'admin') return true;
    
    const createdAt = new Date(cert.created_at).getTime();
    const now = Date.now();
    const hoursSinceCreation = (now - createdAt) / (1000 * 60 * 60);
    
    return hoursSinceCreation <= 24;
  }

  const filteredCertificates = useMemo(() => {
    let result = certificates;
    
    if (filter === 'valid') {
      result = result.filter((c) => daysUntil(c.expiry_date) > 30);
    } else if (filter === 'expiring') {
      result = result.filter((c) => {
        const days = daysUntil(c.expiry_date);
        return days >= 0 && days <= 30;
      });
    } else if (filter === 'expired') {
      result = result.filter((c) => daysUntil(c.expiry_date) < 0);
    }
    
    return result;
  }, [certificates, filter]);

  const stats = useMemo(() => {
    const total = certificates.length;
    const valid = certificates.filter((c) => daysUntil(c.expiry_date) > 30).length;
    const expiring = certificates.filter((c) => {
      const days = daysUntil(c.expiry_date);
      return days >= 0 && days <= 30;
    }).length;
    const expired = certificates.filter((c) => daysUntil(c.expiry_date) < 0).length;
    
    return { total, valid, expiring, expired };
  }, [certificates]);

  function getValidityStatus(days: number) {
    if (days < 0) return { label: 'Expired', bg: 'bg-red-100 text-red-800', border: 'border-red-200' };
    if (days <= 30) return { label: 'Expiring Soon', bg: 'bg-orange-100 text-orange-800', border: 'border-orange-200' };
    return { label: 'Valid', bg: 'bg-green-100 text-green-800', border: 'border-green-200' };
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    
    if (!form.cert_number || !form.name || !form.asset_id) {
      alert('Please fill in all required fields.');
      return;
    }

    setSubmitting(true);
    try {
      const certData = {
        cert_number: form.cert_number,
        name: form.name,
        cert_type: form.cert_type,
        asset_id: parseInt(form.asset_id, 10),
        client_id: form.client_id || null,
        functional_location: form.functional_location || null,
        inspector_id: user.id,
        issued_by: form.issued_by,
        issue_date: form.issue_date,
        expiry_date: form.expiry_date,
        approval_status: 'pending',
        notes: form.notes || null,
      };

      let cert;
      if (editingId) {
        cert = await updateResource('certificates', editingId, certData);
      } else {
        cert = await createResource('certificates', certData);
      }

      // Upload file if provided
      if (form.file) {
        await uploadCertificateFile(cert.id, form.file);
      }

      setForm(initialForm);
      setEditingId(null);
      setFormOpen(false);
      
      // Refresh certificates
      const updatedCerts = await fetchInspectorCertificates(user.id);
      setCertificates(updatedCerts);
    } catch (caught) {
      alert(caught instanceof Error ? caught.message : 'Failed to save certificate.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleEdit(cert: CertificateWithExpiry) {
    if (!canEditCertificate(cert)) {
      alert('You can only edit certificates within 24 hours of creation. Contact admin for older entries.');
      return;
    }

    setEditingId(cert.id);
    setForm({
      file: null,
      cert_number: cert.cert_number,
      name: cert.name,
      cert_type: cert.cert_type,
      asset_id: String(cert.asset_id),
      client_id: cert.client_id || '',
      functional_location: cert.functional_location || '',
      issued_by: cert.issued_by,
      issue_date: cert.issue_date,
      expiry_date: cert.expiry_date,
      notes: cert.notes || '',
    });
    setFormOpen(true);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading dashboard...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Inspector Dashboard</h1>
          <p className="text-gray-600 mt-1">Manage your uploaded certificates</p>
        </div>
        <button
          onClick={() => {
            setForm(initialForm);
            setEditingId(null);
            setFormOpen(true);
          }}
          className="px-4 py-2 bg-blue-600 text-white font-medium rounded-md hover:bg-blue-700 transition-colors"
        >
          + Upload Certificate
        </button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-lg shadow p-6 border-l-4 border-blue-500">
          <p className="text-sm font-medium text-gray-500">Total Certificates</p>
          <p className="text-3xl font-bold text-gray-900 mt-2">{stats.total}</p>
        </div>
        <div className="bg-white rounded-lg shadow p-6 border-l-4 border-green-500">
          <p className="text-sm font-medium text-gray-500">Valid</p>
          <p className="text-3xl font-bold text-green-600 mt-2">{stats.valid}</p>
        </div>
        <div className="bg-white rounded-lg shadow p-6 border-l-4 border-orange-500">
          <p className="text-sm font-medium text-gray-500">Expiring Soon</p>
          <p className="text-3xl font-bold text-orange-600 mt-2">{stats.expiring}</p>
        </div>
        <div className="bg-white rounded-lg shadow p-6 border-l-4 border-red-500">
          <p className="text-sm font-medium text-gray-500">Expired</p>
          <p className="text-3xl font-bold text-red-600 mt-2">{stats.expired}</p>
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="bg-white rounded-lg shadow">
        <div className="border-b border-gray-200 px-4">
          <nav className="flex space-x-6">
            {(['all', 'valid', 'expiring', 'expired'] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setFilter(tab)}
                className={`py-3 px-1 border-b-2 font-medium text-sm capitalize transition-colors ${
                  filter === tab
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                {tab}
                {tab !== 'all' && (
                  <span className="ml-2 text-xs bg-gray-100 px-2 py-0.5 rounded-full">
                    {stats[tab as keyof typeof stats]}
                  </span>
                )}
              </button>
            ))}
          </nav>
        </div>

        {/* Certificates List */}
        <div className="p-4">
          {filteredCertificates.length === 0 ? (
            <div className="text-center py-12">
              <svg className="mx-auto h-12 w-12 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              <p className="mt-2 text-gray-600">No certificates found</p>
            </div>
          ) : (
            <div className="space-y-3">
              {filteredCertificates.map((cert) => {
                const daysLeft = daysUntil(cert.expiry_date);
                const validity = getValidityStatus(daysLeft);
                const canEdit = canEditCertificate(cert);
                
                return (
                  <div 
                    key={cert.id} 
                    className={`border rounded-lg p-4 hover:shadow-md transition-shadow ${validity.border}`}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center space-x-2 mb-2">
                          <h3 className="font-semibold text-gray-900">{cert.name}</h3>
                          <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${validity.bg}`}>
                            {validity.label}
                          </span>
                          <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                            cert.approval_status.toLowerCase() === 'approved'
                              ? 'bg-green-100 text-green-800'
                              : cert.approval_status.toLowerCase() === 'pending'
                              ? 'bg-yellow-100 text-yellow-800'
                              : 'bg-red-100 text-red-800'
                          }`}>
                            {cert.approval_status}
                          </span>
                        </div>
                        <div className="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-2 text-sm">
                          <div>
                            <span className="text-gray-500">Certificate #:</span>
                            <span className="ml-2 text-gray-900">{cert.cert_number}</span>
                          </div>
                          <div>
                            <span className="text-gray-500">Type:</span>
                            <span className="ml-2 text-gray-900">{cert.cert_type}</span>
                          </div>
                          <div>
                            <span className="text-gray-500">Asset ID:</span>
                            <span className="ml-2 text-gray-900">{cert.asset_id}</span>
                          </div>
                          <div>
                            <span className="text-gray-500">Client:</span>
                            <span className="ml-2 text-gray-900">{cert.client_id || '—'}</span>
                          </div>
                          <div>
                            <span className="text-gray-500">Location:</span>
                            <span className="ml-2 text-gray-900">{cert.functional_location || '—'}</span>
                          </div>
                          <div>
                            <span className="text-gray-500">Expiry:</span>
                            <span className={`ml-2 font-medium ${daysLeft <= 30 ? 'text-red-600' : 'text-gray-900'}`}>
                              {new Date(cert.expiry_date).toLocaleDateString()}
                            </span>
                          </div>
                        </div>
                        {daysLeft !== Infinity && (
                          <div className="mt-2">
                            <span className="text-sm">
                              Days remaining:{' '}
                              <span className={`font-medium ${
                                daysLeft < 0 ? 'text-red-600' : daysLeft <= 30 ? 'text-orange-600' : 'text-green-600'
                              }`}>
                                {daysLeft < 0 ? 'Expired' : `${daysLeft} days`}
                              </span>
                            </span>
                          </div>
                        )}
                        {!canEdit && (
                          <p className="mt-2 text-xs text-orange-600">
                            ⚠️ Edit window closed (created more than 24 hours ago)
                          </p>
                        )}
                      </div>
                      <div className="ml-4 flex flex-col space-y-2">
                        {canEdit && (
                          <button
                            onClick={() => handleEdit(cert)}
                            className="px-3 py-1.5 bg-gray-200 text-gray-700 text-xs font-medium rounded-md hover:bg-gray-300 transition-colors"
                          >
                            Edit
                          </button>
                        )}
                        {cert.file_url && (
                          <a
                            href={cert.file_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="px-3 py-1.5 bg-blue-600 text-white text-xs font-medium rounded-md hover:bg-blue-700 transition-colors text-center"
                          >
                            View File
                          </a>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Upload/Edit Form Modal */}
      {formOpen && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-black/50 flex items-center justify-center">
          <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto">
            <form onSubmit={handleSubmit}>
              <div className="px-6 py-4 border-b border-gray-200 sticky top-0 bg-white">
                <h3 className="text-lg font-semibold text-gray-900">
                  {editingId ? 'Edit Certificate' : 'Upload New Certificate'}
                </h3>
              </div>
              
              <div className="px-6 py-4 space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Certificate Number *
                    </label>
                    <input
                      type="text"
                      required
                      value={form.cert_number}
                      onChange={(e) => setForm({ ...form, cert_number: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Name *
                    </label>
                    <input
                      type="text"
                      required
                      value={form.name}
                      onChange={(e) => setForm({ ...form, name: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Certificate Type
                    </label>
                    <input
                      type="text"
                      value={form.cert_type}
                      onChange={(e) => setForm({ ...form, cert_type: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Asset ID *
                    </label>
                    <select
                      required
                      value={form.asset_id}
                      onChange={(e) => setForm({ ...form, asset_id: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="">Select Asset</option>
                      {assets.map((asset) => (
                        <option key={asset.id} value={asset.id}>
                          {asset.asset_number} - {asset.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Client ID
                    </label>
                    <select
                      value={form.client_id}
                      onChange={(e) => setForm({ ...form, client_id: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="">Select Client</option>
                      {clients.map((client) => (
                        <option key={client.client_id} value={client.client_id}>
                          {client.client_id} - {client.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Functional Location
                    </label>
                    <select
                      value={form.functional_location}
                      onChange={(e) => setForm({ ...form, functional_location: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="">Select Location</option>
                      {locations.map((loc) => (
                        <option key={loc.id} value={loc.functional_location}>
                          {loc.functional_location} - {loc.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Issued By
                    </label>
                    <input
                      type="text"
                      value={form.issued_by}
                      onChange={(e) => setForm({ ...form, issued_by: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Issue Date
                    </label>
                    <input
                      type="date"
                      value={form.issue_date}
                      onChange={(e) => setForm({ ...form, issue_date: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Expiry Date *
                  </label>
                  <input
                    type="date"
                    required
                    value={form.expiry_date}
                    onChange={(e) => setForm({ ...form, expiry_date: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Notes
                  </label>
                  <textarea
                    value={form.notes}
                    onChange={(e) => setForm({ ...form, notes: e.target.value })}
                    rows={3}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {editingId ? 'Upload New File (optional)' : 'Attach Certificate File'}
                  </label>
                  <input
                    type="file"
                    accept=".pdf,.jpg,.jpeg,.png"
                    onChange={(e) => setForm({ ...form, file: e.target.files?.[0] || null })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <p className="mt-1 text-xs text-gray-500">
                    Accepted formats: PDF, JPG, PNG
                  </p>
                </div>
              </div>

              <div className="px-6 py-4 border-t border-gray-200 flex justify-end space-x-3 sticky bottom-0 bg-white">
                <button
                  type="button"
                  onClick={() => {
                    setForm(initialForm);
                    setEditingId(null);
                    setFormOpen(false);
                  }}
                  className="px-4 py-2 bg-gray-200 hover:bg-gray-300 text-gray-700 font-medium rounded-md transition-colors"
                  disabled={submitting}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-md transition-colors disabled:opacity-50"
                >
                  {submitting ? 'Saving...' : editingId ? 'Update' : 'Upload'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
