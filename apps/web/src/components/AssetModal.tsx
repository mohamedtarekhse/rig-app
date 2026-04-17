import { useState, useEffect } from 'react';
import { fetchAssetDetail, downloadCertificateLog, transferCertificate } from '../lib/api';
import type { AssetDetail as AssetDetailType, CertificateWithExpiry, TransferRecord } from '../lib/types';
import { daysUntil } from '../lib/resourceTools';

type AssetModalProps = {
  assetId: number;
  onClose: () => void;
  userRole: string;
};

type TabKey = 'details' | 'certificates' | 'transfers';

export function AssetModal({ assetId, onClose, userRole }: AssetModalProps) {
  const [assetData, setAssetData] = useState<AssetDetailType | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState<TabKey>('details');
  const [downloading, setDownloading] = useState(false);
  const [transferFormOpen, setTransferFormOpen] = useState(false);
  const [selectedCertId, setSelectedCertId] = useState<number | null>(null);
  const [transferForm, setTransferForm] = useState({
    to_client_id: '',
    to_functional_location: '',
    notes: '',
  });
  const [transferBusy, setTransferBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');

    fetchAssetDetail(assetId)
      .then((data) => {
        if (!cancelled) {
          setAssetData(data);
          setLoading(false);
        }
      })
      .catch((caught) => {
        if (!cancelled) {
          setError(caught instanceof Error ? caught.message : 'Failed to load asset details.');
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [assetId]);

  async function handleDownloadLog(format: 'pdf' | 'csv') {
    if (!assetData) return;
    
    setDownloading(true);
    try {
      const blob = await downloadCertificateLog(assetId, format);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `asset-${assetData.asset.asset_number}-certificate-log.${format}`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (caught) {
      alert(caught instanceof Error ? caught.message : 'Failed to download log.');
    } finally {
      setDownloading(false);
    }
  }

  async function handleTransferSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedCertId) return;

    setTransferBusy(true);
    try {
      await transferCertificate(
        selectedCertId,
        transferForm.to_client_id,
        transferForm.to_functional_location || null,
        transferForm.notes || null
      );
      setTransferFormOpen(false);
      setTransferForm({ to_client_id: '', to_functional_location: '', notes: '' });
      // Refresh data
      const data = await fetchAssetDetail(assetId);
      setAssetData(data);
    } catch (caught) {
      alert(caught instanceof Error ? caught.message : 'Failed to transfer certificate.');
    } finally {
      setTransferBusy(false);
    }
  }

  function getValidityStatus(days: number) {
    if (days < 0) return { color: 'red', label: 'Expired', bg: 'bg-red-100 text-red-800' };
    if (days <= 30) return { color: 'orange', label: 'Expiring Soon', bg: 'bg-orange-100 text-orange-800' };
    return { color: 'green', label: 'Valid', bg: 'bg-green-100 text-green-800' };
  }

  if (loading) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
        <div className="bg-white rounded-lg p-8">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading asset details...</p>
        </div>
      </div>
    );
  }

  if (error || !assetData) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
        <div className="bg-white rounded-lg p-8 max-w-md">
          <h3 className="text-lg font-semibold text-red-600 mb-2">Error</h3>
          <p className="text-gray-600 mb-4">{error || 'Asset not found'}</p>
          <button
            onClick={onClose}
            className="px-4 py-2 bg-gray-200 hover:bg-gray-300 rounded-md"
          >
            Close
          </button>
        </div>
      </div>
    );
  }

  const { asset, certificates, transfers } = assetData;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/50" onClick={onClose}>
      <div 
        className="min-h-screen px-4 py-6 flex items-center justify-center"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="bg-white rounded-lg shadow-xl max-w-5xl w-full max-h-[90vh] overflow-hidden flex flex-col">
          {/* Header */}
          <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between bg-gray-50">
            <div>
              <h2 className="text-xl font-bold text-gray-900">{asset.name}</h2>
              <p className="text-sm text-gray-600">{asset.asset_number} • {asset.asset_type}</p>
            </div>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 transition-colors"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Tabs */}
          <div className="px-6 border-b border-gray-200 bg-white">
            <nav className="flex space-x-6">
              <button
                onClick={() => setActiveTab('details')}
                className={`py-3 px-1 border-b-2 font-medium text-sm transition-colors ${
                  activeTab === 'details'
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                Details
              </button>
              <button
                onClick={() => setActiveTab('certificates')}
                className={`py-3 px-1 border-b-2 font-medium text-sm transition-colors ${
                  activeTab === 'certificates'
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                Certificates ({certificates.length})
              </button>
              <button
                onClick={() => setActiveTab('transfers')}
                className={`py-3 px-1 border-b-2 font-medium text-sm transition-colors ${
                  activeTab === 'transfers'
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                Transfer History ({transfers.length})
              </button>
            </nav>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-6">
            {activeTab === 'details' && (
              <div className="space-y-6">
                <div className="grid grid-cols-2 gap-6">
                  <div>
                    <h3 className="text-sm font-medium text-gray-500 mb-1">Asset Number</h3>
                    <p className="text-base text-gray-900">{asset.asset_number}</p>
                  </div>
                  <div>
                    <h3 className="text-sm font-medium text-gray-500 mb-1">Name</h3>
                    <p className="text-base text-gray-900">{asset.name}</p>
                  </div>
                  <div>
                    <h3 className="text-sm font-medium text-gray-500 mb-1">Asset Type</h3>
                    <p className="text-base text-gray-900">{asset.asset_type}</p>
                  </div>
                  <div>
                    <h3 className="text-sm font-medium text-gray-500 mb-1">Status</h3>
                    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                      asset.status.toLowerCase().includes('operation') 
                        ? 'bg-green-100 text-green-800' 
                        : 'bg-gray-100 text-gray-800'
                    }`}>
                      {asset.status}
                    </span>
                  </div>
                  <div>
                    <h3 className="text-sm font-medium text-gray-500 mb-1">Client ID</h3>
                    <p className="text-base text-gray-900">{asset.client_id || '—'}</p>
                  </div>
                  <div>
                    <h3 className="text-sm font-medium text-gray-500 mb-1">Functional Location</h3>
                    <p className="text-base text-gray-900">{asset.functional_location || '—'}</p>
                  </div>
                  {asset.serial_number && (
                    <div>
                      <h3 className="text-sm font-medium text-gray-500 mb-1">Serial Number</h3>
                      <p className="text-base text-gray-900">{asset.serial_number}</p>
                    </div>
                  )}
                  {asset.manufacturer && (
                    <div>
                      <h3 className="text-sm font-medium text-gray-500 mb-1">Manufacturer</h3>
                      <p className="text-base text-gray-900">{asset.manufacturer}</p>
                    </div>
                  )}
                  {asset.model && (
                    <div>
                      <h3 className="text-sm font-medium text-gray-500 mb-1">Model</h3>
                      <p className="text-base text-gray-900">{asset.model}</p>
                    </div>
                  )}
                </div>
                {asset.description && (
                  <div>
                    <h3 className="text-sm font-medium text-gray-500 mb-1">Description</h3>
                    <p className="text-base text-gray-900">{asset.description}</p>
                  </div>
                )}
                {asset.notes && (
                  <div>
                    <h3 className="text-sm font-medium text-gray-500 mb-1">Notes</h3>
                    <p className="text-base text-gray-900 whitespace-pre-wrap">{asset.notes}</p>
                  </div>
                )}
                <div className="pt-4 border-t border-gray-200">
                  <p className="text-xs text-gray-500">
                    Created: {new Date(asset.created_at).toLocaleString()} • 
                    Updated: {new Date(asset.updated_at).toLocaleString()}
                  </p>
                </div>
              </div>
            )}

            {activeTab === 'certificates' && (
              <div className="space-y-4">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-semibold text-gray-900">Certificates</h3>
                  <div className="flex space-x-2">
                    <button
                      onClick={() => handleDownloadLog('pdf')}
                      disabled={downloading || certificates.length === 0}
                      className="px-3 py-2 bg-red-600 text-white text-sm font-medium rounded-md hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      {downloading ? 'Downloading...' : 'Download PDF'}
                    </button>
                    <button
                      onClick={() => handleDownloadLog('csv')}
                      disabled={downloading || certificates.length === 0}
                      className="px-3 py-2 bg-green-600 text-white text-sm font-medium rounded-md hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      {downloading ? 'Downloading...' : 'Download CSV'}
                    </button>
                  </div>
                </div>

                {certificates.length === 0 ? (
                  <div className="text-center py-12">
                    <svg className="mx-auto h-12 w-12 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    <p className="mt-2 text-gray-600">No certificates attached to this asset</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {certificates.map((cert) => {
                      const daysLeft = daysUntil(cert.expiry_date);
                      const validity = getValidityStatus(daysLeft);
                      const canEdit = userRole === 'admin'; // TODO: Add 24-hour check logic
                      
                      return (
                        <div key={cert.id} className="border border-gray-200 rounded-lg p-4 hover:shadow-md transition-shadow">
                          <div className="flex items-start justify-between">
                            <div className="flex-1">
                              <div className="flex items-center space-x-2 mb-2">
                                <h4 className="font-semibold text-gray-900">{cert.name}</h4>
                                <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${validity.bg}`}>
                                  {validity.label}
                                </span>
                                {cert.approval_status && (
                                  <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                                    cert.approval_status.toLowerCase() === 'approved'
                                      ? 'bg-green-100 text-green-800'
                                      : cert.approval_status.toLowerCase() === 'pending'
                                      ? 'bg-yellow-100 text-yellow-800'
                                      : 'bg-red-100 text-red-800'
                                  }`}>
                                    {cert.approval_status}
                                  </span>
                                )}
                              </div>
                              <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                                <div>
                                  <span className="text-gray-500">Certificate Number:</span>
                                  <span className="ml-2 text-gray-900">{cert.cert_number}</span>
                                </div>
                                <div>
                                  <span className="text-gray-500">Type:</span>
                                  <span className="ml-2 text-gray-900">{cert.cert_type}</span>
                                </div>
                                <div>
                                  <span className="text-gray-500">Issued By:</span>
                                  <span className="ml-2 text-gray-900">{cert.issued_by}</span>
                                </div>
                                <div>
                                  <span className="text-gray-500">Inspector:</span>
                                  <span className="ml-2 text-gray-900">{cert.inspector_name || '—'}</span>
                                </div>
                                <div>
                                  <span className="text-gray-500">Issue Date:</span>
                                  <span className="ml-2 text-gray-900">{new Date(cert.issue_date).toLocaleDateString()}</span>
                                </div>
                                <div>
                                  <span className="text-gray-500">Expiry Date:</span>
                                  <span className={`ml-2 font-medium ${daysLeft <= 30 ? 'text-red-600' : 'text-gray-900'}`}>
                                    {new Date(cert.expiry_date).toLocaleDateString()}
                                  </span>
                                </div>
                                {daysLeft !== Infinity && (
                                  <div>
                                    <span className="text-gray-500">Days Remaining:</span>
                                    <span className={`ml-2 font-medium ${
                                      daysLeft < 0 ? 'text-red-600' : daysLeft <= 30 ? 'text-orange-600' : 'text-green-600'
                                    }`}>
                                      {daysLeft < 0 ? 'Expired' : `${daysLeft} days`}
                                    </span>
                                  </div>
                                )}
                                {cert.functional_location && (
                                  <div>
                                    <span className="text-gray-500">Location:</span>
                                    <span className="ml-2 text-gray-900">{cert.functional_location}</span>
                                  </div>
                                )}
                              </div>
                              {cert.notes && (
                                <div className="mt-2">
                                  <span className="text-gray-500 text-sm">Notes:</span>
                                  <p className="text-sm text-gray-700 mt-1">{cert.notes}</p>
                                </div>
                              )}
                              {cert.file_url && (
                                <div className="mt-3">
                                  <a
                                    href={cert.file_url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center text-sm text-blue-600 hover:text-blue-800"
                                  >
                                    <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                    </svg>
                                    {cert.file_name || 'Download Certificate'}
                                  </a>
                                  {cert.file_size && (
                                    <span className="ml-2 text-xs text-gray-500">
                                      ({Math.round(cert.file_size / 1024)} KB)
                                    </span>
                                  )}
                                </div>
                              )}
                            </div>
                            <div className="ml-4 flex flex-col space-y-2">
                              {userRole === 'admin' && (
                                <button
                                  onClick={() => {
                                    setSelectedCertId(cert.id);
                                    setTransferFormOpen(true);
                                  }}
                                  className="px-3 py-1.5 bg-blue-600 text-white text-xs font-medium rounded-md hover:bg-blue-700 transition-colors"
                                >
                                  Transfer
                                </button>
                              )}
                              {canEdit && (
                                <button className="px-3 py-1.5 bg-gray-200 text-gray-700 text-xs font-medium rounded-md hover:bg-gray-300 transition-colors">
                                  Edit
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {activeTab === 'transfers' && (
              <div className="space-y-4">
                <h3 className="text-lg font-semibold text-gray-900">Transfer History</h3>
                
                {transfers.length === 0 ? (
                  <div className="text-center py-12">
                    <svg className="mx-auto h-12 w-12 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
                    </svg>
                    <p className="mt-2 text-gray-600">No transfer history for this asset</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {transfers.map((transfer) => (
                      <div key={transfer.id} className="border border-gray-200 rounded-lg p-4">
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center space-x-2">
                            <svg className="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
                            </svg>
                            <span className="font-medium text-gray-900">
                              {transfer.from_client_id || 'N/A'} → {transfer.to_client_id || 'N/A'}
                            </span>
                          </div>
                          <span className="text-sm text-gray-500">
                            {new Date(transfer.transfer_date).toLocaleString()}
                          </span>
                        </div>
                        {transfer.from_functional_location && transfer.to_functional_location && (
                          <p className="text-sm text-gray-600 mb-2">
                            Location: {transfer.from_functional_location} → {transfer.to_functional_location}
                          </p>
                        )}
                        {transfer.user_name && (
                          <p className="text-sm text-gray-500">
                            Transferred by: {transfer.user_name}
                          </p>
                        )}
                        {transfer.notes && (
                          <p className="text-sm text-gray-700 mt-2 italic">
                            "{transfer.notes}"
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="px-6 py-4 border-t border-gray-200 bg-gray-50 flex justify-end">
            <button
              onClick={onClose}
              className="px-4 py-2 bg-gray-200 hover:bg-gray-300 text-gray-700 font-medium rounded-md transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      </div>

      {/* Transfer Form Modal */}
      {transferFormOpen && (
        <div className="fixed inset-0 z-[60] overflow-y-auto bg-black/50 flex items-center justify-center">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4">
            <form onSubmit={handleTransferSubmit}>
              <div className="px-6 py-4 border-b border-gray-200">
                <h3 className="text-lg font-semibold text-gray-900">Transfer Certificate</h3>
              </div>
              <div className="px-6 py-4 space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    To Client ID *
                  </label>
                  <input
                    type="text"
                    required
                    value={transferForm.to_client_id}
                    onChange={(e) => setTransferForm({ ...transferForm, to_client_id: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="Enter client ID"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    To Functional Location
                  </label>
                  <input
                    type="text"
                    value={transferForm.to_functional_location}
                    onChange={(e) => setTransferForm({ ...transferForm, to_functional_location: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="Enter functional location"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Notes
                  </label>
                  <textarea
                    value={transferForm.notes}
                    onChange={(e) => setTransferForm({ ...transferForm, notes: e.target.value })}
                    rows={3}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="Add transfer notes..."
                  />
                </div>
              </div>
              <div className="px-6 py-4 border-t border-gray-200 flex justify-end space-x-3">
                <button
                  type="button"
                  onClick={() => {
                    setTransferFormOpen(false);
                    setTransferForm({ to_client_id: '', to_functional_location: '', notes: '' });
                  }}
                  className="px-4 py-2 bg-gray-200 hover:bg-gray-300 text-gray-700 font-medium rounded-md transition-colors"
                  disabled={transferBusy}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={transferBusy}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-md transition-colors disabled:opacity-50"
                >
                  {transferBusy ? 'Transferring...' : 'Transfer'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
