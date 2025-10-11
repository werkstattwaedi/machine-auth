import { Injectable, inject } from '@angular/core';
import { Router } from '@angular/router';
import {
  Auth,
  signInWithPopup,
  GoogleAuthProvider,
  sendSignInLinkToEmail,
  isSignInWithEmailLink,
  signInWithEmailLink,
  signOut,
  User,
} from '@angular/fire/auth';
import {
  Firestore,
  doc,
  getDoc,
  setDoc,
  serverTimestamp,
  query,
  collection,
  where,
  getDocs,
} from '@angular/fire/firestore';
import { Observable, from, of, switchMap, map, catchError } from 'rxjs';
import { authState } from 'rxfire/auth';
import { UserDocument, UserWithId } from '../models/user.model';

@Injectable({
  providedIn: 'root',
})
export class AuthService {
  private auth = inject(Auth);
  private firestore = inject(Firestore);
  private router = inject(Router);

  // Observable of current Firebase Auth user
  readonly user$: Observable<User | null> = authState(this.auth);

  // Observable of current user document from Firestore
  readonly userDoc$: Observable<UserWithId | null> = this.user$.pipe(
    switchMap((user) => {
      if (!user) return of(null);
      return this.getUserDocument(user.uid);
    })
  );

  // Observable of whether current user is admin
  readonly isAdmin$: Observable<boolean> = this.userDoc$.pipe(
    map((userDoc) => userDoc?.roles?.includes('admin') ?? false)
  );

  /**
   * Get user document from Firestore by Firebase UID
   */
  private getUserDocument(firebaseUid: string): Observable<UserWithId | null> {
    return from(
      (async () => {
        // Query for user with this firebaseUid
        const usersRef = collection(this.firestore, 'users');
        const q = query(usersRef, where('firebaseUid', '==', firebaseUid));
        const querySnapshot = await getDocs(q);

        if (querySnapshot.empty) {
          return null;
        }

        const userDoc = querySnapshot.docs[0];
        return {
          id: userDoc.id,
          ...userDoc.data(),
        } as UserWithId;
      })()
    );
  }

  /**
   * Sign in with Google
   * If user document exists with matching email, link firebaseUid
   * Otherwise create new user document
   */
  async signInWithGoogle(): Promise<void> {
    const provider = new GoogleAuthProvider();
    const credential = await signInWithPopup(this.auth, provider);

    await this.handleSignIn(credential.user);
  }

  /**
   * Send passwordless email link
   */
  async sendEmailLink(email: string): Promise<void> {
    const actionCodeSettings = {
      url: `${window.location.origin}/login`,
      handleCodeInApp: true,
    };

    await sendSignInLinkToEmail(this.auth, email, actionCodeSettings);
    window.localStorage.setItem('emailForSignIn', email);
  }

  /**
   * Complete email link sign-in
   * Called when user clicks link in email
   */
  completeEmailLinkSignIn(): Promise<void> {
    return new Promise((resolve, reject) => {
      // Check immediately if this is an email link
      const isEmailLink = isSignInWithEmailLink(this.auth, window.location.href);

      if (!isEmailLink) {
        resolve();
        return;
      }

      let email = window.localStorage.getItem('emailForSignIn');
      if (!email) {
        email = window.prompt('Please provide your email for confirmation');
      }

      if (!email) {
        reject(new Error('Email required for sign-in'));
        return;
      }

      signInWithEmailLink(this.auth, email, window.location.href)
        .then((credential) => {
          window.localStorage.removeItem('emailForSignIn');
          return this.handleSignIn(credential.user);
        })
        .then(() => resolve())
        .catch(reject);
    });
  }

  /**
   * Handle post-sign-in logic:
   * - Check if user doc exists with this firebaseUid (already linked)
   * - If not, check if unclaimed user doc exists with this email
   * - If found, claim it by adding firebaseUid
   * - Otherwise, create new user doc
   */
  private async handleSignIn(user: User): Promise<void> {
    if (!user.email) {
      throw new Error('User email is required');
    }

    // Check if user doc already exists with this firebaseUid
    const usersRef = collection(this.firestore, 'users');
    const uidQuery = query(usersRef, where('firebaseUid', '==', user.uid));
    const uidSnapshot = await getDocs(uidQuery);

    if (!uidSnapshot.empty) {
      // User already linked, navigate to dashboard
      this.router.navigate(['/dashboard']);
      return;
    }

    // Check for unclaimed user doc with matching email
    const emailQuery = query(usersRef, where('email', '==', user.email));
    const emailSnapshot = await getDocs(emailQuery);

    if (!emailSnapshot.empty) {
      // Found unclaimed account, claim it
      const userDocRef = emailSnapshot.docs[0].ref;
      await setDoc(
        userDocRef,
        {
          firebaseUid: user.uid,
          displayName: user.displayName || emailSnapshot.docs[0].data()['displayName'],
        },
        { merge: true }
      );
    } else {
      // Create new user document
      const newUserRef = doc(usersRef);
      await setDoc(newUserRef, {
        firebaseUid: user.uid,
        email: user.email,
        displayName: user.displayName || 'New User',
        created: serverTimestamp(),
        roles: ['vereinsmitglied'], // Default role
        permissions: [],
      });
    }

    this.router.navigate(['/dashboard']);
  }

  /**
   * Sign out
   */
  async signOut(): Promise<void> {
    await signOut(this.auth);
    this.router.navigate(['/login']);
  }
}
