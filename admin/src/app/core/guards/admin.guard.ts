import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { CanActivateFn } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { map, take } from 'rxjs/operators';

/**
 * Guard that checks if user is authenticated AND has admin role
 */
export const adminGuard: CanActivateFn = () => {
  const authService = inject(AuthService);
  const router = inject(Router);

  return authService.userDoc$.pipe(
    take(1),
    map((userDoc) => {
      if (userDoc?.roles?.includes('admin')) {
        return true;
      } else {
        // Not admin - redirect to dashboard
        return router.parseUrl('/dashboard');
      }
    })
  );
};
