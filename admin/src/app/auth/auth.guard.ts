import { CanActivateFn, Router } from '@angular/router';
import { inject } from '@angular/core';
import { Auth } from '@angular/fire/auth';
import { Firestore, doc, getDoc } from '@angular/fire/firestore';
import { firstValueFrom } from 'rxjs';
import { authState } from 'rxfire/auth';

export const authGuard: CanActivateFn = async (route, state) => {
  const auth = inject(Auth);
  const firestore = inject(Firestore);
  const router = inject(Router);
  console.log('before');

  const user = await firstValueFrom(authState(auth));
  console.log('something', user);

  if (user) {
    const userDocRef = doc(firestore, `users/${user.uid}`);
    const userDocSnap = await getDoc(userDocRef);

    if (userDocSnap.exists()) {
      const userData = userDocSnap.data();
      // Check if the roles array exists and includes 'admin'
      if (
        userData['roles'] &&
        Array.isArray(userData['roles']) &&
        userData['roles'].includes('admin')
      ) {
        return true;
      }
    }
  }

  // If no user, user document doesn't exist, or user is not an admin, redirect to login
  return router.parseUrl('/login');
};
