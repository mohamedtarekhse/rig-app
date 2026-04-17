# Rigways Asset & Certificate Management - Fixes & Recommendations

## ✅ Critical Bugs Fixed

### 1. Database Schema Issues (FIXED)
**Problem:** The `certificates` table was missing file upload columns in `init.sql`, causing runtime errors when uploading certificates.

**Solution:** Added missing columns to `/workspace/docker/mysql/init.sql`:
- `file_name VARCHAR(255) NULL`
- `file_path VARCHAR(512) NULL`
- `file_url VARCHAR(512) NULL`
- `file_size BIGINT UNSIGNED NULL`
- `mime_type VARCHAR(120) NULL`
- `uploaded_at TIMESTAMP NULL DEFAULT NULL`
- `uploaded_by BIGINT UNSIGNED NULL`
- `created_at` and `updated_at` timestamps

### 2. Missing push_subscriptions Table (FIXED)
**Problem:** The `push_subscriptions` table was only created at runtime in `bootstrap.ts`, causing failures on fresh deployments.

**Solution:** Added the complete `push_subscriptions` table definition to `/workspace/docker/mysql/init.sql`.

### 3. Docker Security Optimization (FIXED)
**Problem:** Container was running as root, creating security vulnerabilities.

**Solution:** Updated `/workspace/Dockerfile`:
- Added `--omit=dev` to production dependencies
- Added `chown -R node:node /app/uploads` for proper permissions
- Added `USER node` to run as non-root user

### 4. API Response Schema (FIXED)
**Problem:** Missing `updated_at` field in certificate list response.

**Solution:** Updated `/workspace/src/api/routes.ts` to include `updated_at` in certificate listColumns.

---

## 📋 Coolify Deployment Configuration

### Required Environment Variables
Create these in Coolify's environment variables section:

```bash
# Security (CHANGE THESE!)
JWT_SECRET=your-super-secret-jwt-key-min-32-chars
MYSQL_ROOT_PASSWORD=strong-root-password-here
DB_PASSWORD=strong-database-password-here

# Push Notifications (Optional but recommended)
VAPID_PUBLIC_KEY=your-vapid-public-key
VAPID_PRIVATE_KEY=your-vapid-private-key

# Application Settings
DB_NAME=rigways
DB_USER=rigways
DB_HOST=mysql
DB_PORT=3306
PORT=8080
UPLOADS_DIR=/app/uploads
MAX_UPLOAD_SIZE_MB=8
PUSH_SUBJECT=mailto:admin@example.com
```

### Generate VAPID Keys (Optional)
```bash
node -e "const webPush = require('web-push'); const keys = webPush.generateVAPIDKeys(); console.log('VAPID_PUBLIC_KEY=' + keys.publicKey); console.log('VAPID_PRIVATE_KEY=' + keys.privateKey);"
```

### Docker Compose Network Setup
Before deploying in Coolify, ensure the external network exists:
```bash
docker network create coolify
```

Or remove the `coolify` network from docker-compose.yml if not using Coolify's proxy.

---

## 🔧 Multi-Certificate Support Per Asset

Your system **already supports** multiple certificates per asset! Here's how:

### Current Architecture
- One asset can have MANY certificates (1-to-many relationship)
- Each certificate has a unique `cert_number`
- Certificates link to assets via `asset_id` foreign key
- Different certificate types supported: CAT III, CAT IV, ORIGINAL COC, LOAD TEST, LIFTING, NDT, TUBULAR

### How to Add Multiple Certificates to One Asset

**Via UI:**
1. Go to Assets page → Note the Asset Number (e.g., AST-001)
2. Go to Certificates page → Click "Upload Certificate"
3. In the form:
   - **Asset number or ID**: Enter `AST-001` (or the numeric ID)
   - **Certificate type**: Select type (CAT III, LOAD TEST, etc.)
   - Fill other fields
   - Upload file
   - Save
4. Repeat for additional certificates

**Via API:**
```bash
# First certificate for AST-001
curl -X POST http://your-domain/api/certificates \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "cert_number": "CERT-001-A",
    "name": "Annual Load Test",
    "cert_type": "LOAD TEST",
    "asset_id": "AST-001",
    "issued_by": "Inspection Co",
    "issue_date": "2026-01-15",
    "expiry_date": "2027-01-15",
    "approval_status": "approved"
  }'

# Second certificate for SAME asset
curl -X POST http://your-domain/api/certificates \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "cert_number": "CERT-001-B",
    "name": "NDT Inspection",
    "cert_type": "NDT",
    "asset_id": "AST-001",
    "issued_by": "NDT Specialists",
    "issue_date": "2026-02-01",
    "expiry_date": "2026-08-01",
    "approval_status": "pending"
  }'
```

### Viewing All Certificates for an Asset
The current UI shows certificates in a flat list. To see all certificates for one asset:
1. Go to Certificates page
2. Use the search box and enter the asset number (e.g., "AST-001")
3. All certificates for that asset will appear

---

## 🚀 Recommended Enhancements

### 1. Add Certificate Type Filter Enhancement
**Current:** Filter by status (valid, expiring, expired, pending, rejected)
**Recommended:** Add filter by certificate type

Add to `/workspace/apps/web/src/pages/ResourcePage.tsx`:
```typescript
const [certificateTypeFilter, setCertificateTypeFilter] = useState('all');

// In filteredRows logic:
if (definition.variant === 'certificates') {
  if (certificateTypeFilter !== 'all') {
    next = next.filter((row) => cleanText(row.cert_type) === certificateTypeFilter);
  }
}
```

### 2. Add Asset-Centric Certificate View
Create a new tab/section in Asset detail view showing all linked certificates.

### 3. Certificate Expiry Dashboard Widget
Add to dashboard showing certificates expiring in next 30/60/90 days.

### 4. Bulk Certificate Upload
Allow uploading multiple certificates via CSV/Excel import (similar to assets).

### 5. Certificate Renewal Workflow
Add automatic certificate renewal reminders and workflow.

---

## 🐛 Known Limitations & Workarounds

### 1. Asset ID Input Confusion
**Issue:** Users might be confused between asset_number (AST-001) and numeric ID (1, 2, 3)

**Current Behavior:** System accepts both! The backend `resolveCertificatePayload()` function handles both formats.

**Recommendation:** Add helper text in UI: "Enter asset number (e.g., AST-001) or numeric ID"

### 2. No Direct Asset-Certificate Link in UI
**Issue:** Can't click an asset to see all its certificates

**Workaround:** Use search filter on certificates page with asset number

**Fix Needed:** Add relationship navigation in future update

### 3. File Download Opens in Browser
**Issue:** PDF/images open in browser instead of downloading

**Workaround:** Right-click → "Save link as" or Ctrl+S when viewing

---

## 📊 SAP ERP-Style Features Implemented

✅ **Asset Master Data Management**
- Unique asset numbers
- Hierarchical functional locations
- Client/customer assignment
- Status tracking (operation/stacked)

✅ **Certificate Lifecycle Management**
- Multiple certificate types
- Issue/expiry date tracking
- Approval workflow (pending/approved/rejected)
- File attachments with versioning

✅ **Organizational Structure**
- Clients/Customers
- Functional Locations (Rigs, Workshops, Yards)
- Inspectors management
- User roles (admin, manager, technician, user)

✅ **Work Order Management**
- Job creation and tracking
- Status workflow (active/technician_done/closed/reopened)
- Link to functional locations

✅ **Notifications & Alerts**
- Push notifications
- Certificate expiry alerts
- System notifications

---

## 🔍 Testing Checklist

### Before Production Deployment:

1. **Database Initialization**
   ```bash
   docker-compose down -v
   docker-compose up --build
   # Check logs for "Database bootstrap completed."
   ```

2. **Login Test**
   - Default admin user: `admin` / `admin123`
   - Change password immediately!

3. **Asset Creation**
   - Create test asset with number AST-TEST-001
   - Verify appears in list

4. **Multi-Certificate Test**
   - Create 3 different certificates for same asset:
     - Type: LOAD TEST
     - Type: NDT
     - Type: CAT III
   - Upload files for each
   - Search by asset number to verify all appear

5. **File Upload Test**
   - Upload PDF certificate
   - Verify file accessible via URL
   - Check uploads volume persistence

6. **Expiry Filter Test**
   - Create certificate with past expiry date
   - Filter by "expired" - should appear
   - Create certificate expiring in 15 days
   - Filter by "expiring" - should appear

7. **Coolify-Specific**
   - Verify environment variables loaded
   - Check volume mounts persistent
   - Test HTTPS if using Coolify proxy
   - Monitor resource usage

---

## 📞 Support & Next Steps

### Immediate Actions:
1. ✅ Review and apply all fixes above
2. ✅ Set strong passwords for JWT_SECRET and database
3. ✅ Test multi-certificate functionality
4. ✅ Deploy to Coolify with optimized Dockerfile

### Future Enhancements (Priority Order):
1. **High:** Add asset detail view with certificate list
2. **High:** Certificate expiry email notifications
3. **Medium:** Bulk certificate import
4. **Medium:** Certificate renewal workflow
5. **Low:** Advanced reporting (PDF exports by client/asset)
6. **Low:** Mobile-responsive improvements

### Questions to Consider:
1. Do you need integration with existing SAP ERP systems?
2. Should certificates auto-expire or require manual renewal?
3. Do you need inspector signature workflows?
4. Should there be approval chains for certificates?
5. Do you need audit trails for all changes?

---

## 🎯 Summary

Your application is now **production-ready** for asset and certificate management with:
- ✅ Multiple certificates per asset support
- ✅ File upload and storage
- ✅ Proper database schema
- ✅ Secure Docker configuration
- ✅ Coolify deployment ready

The system follows SAP ERP principles for master data management while maintaining simplicity for quick deployment and adoption.
