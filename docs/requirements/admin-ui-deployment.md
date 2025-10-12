# Admin UI Deployment Requirements

## Production Checklist

Before deploying the admin UI to production, these items MUST be addressed:

### Critical (Blocking)

- [ ] **Firestore Security Rules** (Issue #30)
  - Current rules are permissive for development
  - Must implement role-based rules before production
  - Admin-only write access for sensitive collections
  - Users can only read their own data

### Important (Should Fix)

- [ ] **Bundle Size Optimization**
  - Currently 1.42 MB (exceeds 1 MB budget)
  - Consider lazy loading feature modules
  - Tree-shake unused Material components
  - Code splitting for dialog components

- [ ] **Environment Configuration**
  - Verify `environment.prod.ts` has correct Firebase credentials
  - Ensure `useEmulators: false` in production

### Nice to Have

- [ ] Error tracking (e.g., Sentry)
- [ ] Analytics integration
- [ ] Performance monitoring
- [ ] Backup strategy documentation

## Deployment Process

```bash
# From project root
firebase deploy --only hosting

# Or from admin directory
npm run build
# Then deploy dist/admin/browser/ to hosting
```

## Related

- Issue #30: Firestore security rules
- Issue #31: Separate dev/prod Firebase environments
