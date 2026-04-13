import { useEffect, useState } from 'react';
import { fetchDashboard, fetchResource } from '../lib/api';
import { StatCard } from '../components/StatCard';
import type { DashboardSummary, ResourceRow } from '../lib/types';

export function DashboardPage() {
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [recentCertificates, setRecentCertificates] = useState<ResourceRow[]>([]);
  const [recentJobs, setRecentJobs] = useState<ResourceRow[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;

    Promise.all([fetchDashboard(), fetchResource('certificates'), fetchResource('jobs')])
      .then(([dashboard, certificates, jobs]) => {
        if (cancelled) {
          return;
        }

        setSummary(dashboard);
        setRecentCertificates(certificates.slice(0, 5));
        setRecentJobs(jobs.slice(0, 5));
      })
      .catch((caught) => {
        if (!cancelled) {
          setError(caught instanceof Error ? caught.message : 'Failed to load the dashboard.');
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  if (error) {
    return <p className="error-banner">{error}</p>;
  }

  return (
    <section className="content-stack">
      <div className="hero-band">
        <div>
          <p className="eyebrow">Operations snapshot</p>
          <h2>Everything important in one pass.</h2>
          <p>
            The rebuild keeps the original modules but gives them a cleaner operating surface for
            React, Node.js, MySQL, and Docker deployments.
          </p>
        </div>
      </div>

      <div className="stats-grid">
        <StatCard label="Assets" value={summary?.assets ?? 0} tone="#ff5d36" />
        <StatCard label="Certificates" value={summary?.certificates ?? 0} tone="#0f9d7a" />
        <StatCard label="Jobs" value={summary?.jobs ?? 0} tone="#2f6bff" />
        <StatCard label="Notifications" value={summary?.notifications ?? 0} tone="#f7b500" />
      </div>

      <div className="panel-grid">
        <section className="panel">
          <div className="panel-heading">
            <p className="eyebrow">Latest certificates</p>
            <h3>Approval-sensitive records</h3>
          </div>
          <ul className="activity-list">
            {recentCertificates.map((item) => (
              <li key={String(item.id)}>
                <strong>{String(item.name)}</strong>
                <span>{String(item.approval_status ?? 'pending')}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="panel">
          <div className="panel-heading">
            <p className="eyebrow">Latest jobs</p>
            <h3>Field workflow pulse</h3>
          </div>
          <ul className="activity-list">
            {recentJobs.map((item) => (
              <li key={String(item.id)}>
                <strong>{String(item.title ?? item.job_number)}</strong>
                <span>{String(item.status ?? 'active')}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </section>
  );
}