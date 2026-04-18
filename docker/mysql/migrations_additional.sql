-- Maintenance Scheduling Table
CREATE TABLE IF NOT EXISTS maintenance_schedules (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  asset_id BIGINT UNSIGNED NOT NULL,
  title VARCHAR(255) NOT NULL,
  description TEXT NULL,
  scheduled_date DATE NOT NULL,
  completed_date DATE NULL,
  status ENUM('scheduled', 'in_progress', 'completed', 'cancelled') NOT NULL DEFAULT 'scheduled',
  priority ENUM('low', 'medium', 'high', 'critical') NOT NULL DEFAULT 'medium',
  assigned_to BIGINT UNSIGNED NULL,
  created_by BIGINT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_maint_asset FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE,
  CONSTRAINT fk_maint_assigned FOREIGN KEY (assigned_to) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_maint_created FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Certificate Renewal Workflows Table
CREATE TABLE IF NOT EXISTS certificate_renewals (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  certificate_id BIGINT UNSIGNED NOT NULL,
  old_expiry_date DATE NOT NULL,
  new_expiry_date DATE NULL,
  renewal_status ENUM('pending', 'in_progress', 'approved', 'rejected', 'completed') NOT NULL DEFAULT 'pending',
  requested_by BIGINT UNSIGNED NOT NULL,
  approved_by BIGINT UNSIGNED NULL,
  renewal_notes TEXT NULL,
  rejection_reason TEXT NULL,
  requested_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  approved_at TIMESTAMP NULL DEFAULT NULL,
  completed_at TIMESTAMP NULL DEFAULT NULL,
  CONSTRAINT fk_renewal_cert FOREIGN KEY (certificate_id) REFERENCES certificates(id) ON DELETE CASCADE,
  CONSTRAINT fk_renewal_requested FOREIGN KEY (requested_by) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT fk_renewal_approved FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Audit Logs Table
CREATE TABLE IF NOT EXISTS audit_logs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NULL,
  action_type VARCHAR(100) NOT NULL,
  resource_type VARCHAR(100) NOT NULL,
  resource_id BIGINT UNSIGNED NULL,
  old_values JSON NULL,
  new_values JSON NULL,
  ip_address VARCHAR(45) NULL,
  user_agent VARCHAR(512) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_audit_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_audit_resource (resource_type, resource_id),
  INDEX idx_audit_user (user_id),
  INDEX idx_audit_action (action_type),
  INDEX idx_audit_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Bulk Operations Log Table
CREATE TABLE IF NOT EXISTS bulk_operations (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  operation_type VARCHAR(100) NOT NULL,
  resource_type VARCHAR(100) NOT NULL,
  total_records INT NOT NULL DEFAULT 0,
  successful_records INT NOT NULL DEFAULT 0,
  failed_records INT NOT NULL DEFAULT 0,
  status ENUM('pending', 'processing', 'completed', 'failed') NOT NULL DEFAULT 'pending',
  error_log TEXT NULL,
  initiated_by BIGINT UNSIGNED NOT NULL,
  started_at TIMESTAMP NULL DEFAULT NULL,
  completed_at TIMESTAMP NULL DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_bulk_user FOREIGN KEY (initiated_by) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Add reminder settings for certificate expiry
ALTER TABLE certificates ADD COLUMN reminder_enabled TINYINT(1) NOT NULL DEFAULT 1 AFTER approval_status;
ALTER TABLE certificates ADD COLUMN reminder_days INT NOT NULL DEFAULT 30 AFTER reminder_enabled;

-- Add index for certificate expiry queries
CREATE INDEX idx_cert_expiry ON certificates(expiry_date, approval_status);
CREATE INDEX idx_cert_reminder ON certificates(reminder_enabled, expiry_date, reminder_days);

-- Add status index for maintenance schedules
CREATE INDEX idx_maint_status ON maintenance_schedules(status, scheduled_date);
CREATE INDEX idx_maint_asset_status ON maintenance_schedules(asset_id, status);
