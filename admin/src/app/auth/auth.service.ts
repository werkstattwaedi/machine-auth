import { Injectable, inject } from '@angular/core';
import { Auth, createUserWithEmailAndPassword, signInWithPopup, GoogleAuthProvider, sendSignInLinkToEmail, isSignInWithEmailLink, signInWithEmailLink } from '@angular/fire/auth';
import { Firestore, doc, setDoc, serverTimestamp } from '@angular/fire/firestore';
import { Router } from '@angular/router';

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private auth: Auth = inject(Auth);
  private firestore: Firestore = inject(Firestore);
  private router: Router = inject(Router);

  // Helper to create user document in Firestore
  private async createUserDocument(uid: string, email: string, displayName?: string | null) {
    const userDocRef = doc(this.firestore, `users/${uid}`);
    return setDoc(userDocRef, {
      firebaseUid: uid,
      email: email,
      displayName: displayName || 'New User',
      created: serverTimestamp(),
      roles: ['vereinsmitglied'], // Default role
      permissions: []
    });
  }

  // Email/Password Registration
  async registerWithEmail(email: string, password: string, displayName: string) {
    const credential = await createUserWithEmailAndPassword(this.auth, email, password);
    await this.createUserDocument(credential.user.uid, email, displayName);
    this.router.navigate(['/dashboard']);
  }

  // Google Registration
  async registerWithGoogle() {
    const provider = new GoogleAuthProvider();
    const credential = await signInWithPopup(this.auth, provider);
    // For Google sign-in, we only create a document if it's a new user
    // Note: Firestore security rules should prevent overwriting existing documents by non-admins
    await this.createUserDocument(credential.user.uid, credential.user.email!, credential.user.displayName);
    this.router.navigate(['/dashboard']);
  }

  // Email Link Registration
  async sendEmailLink(email: string) {
    const actionCodeSettings = {
      url: `${window.location.origin}/login`, // URL to redirect to after sign-in
      handleCodeInApp: true,
    };
    await sendSignInLinkToEmail(this.auth, email, actionCodeSettings);
    window.localStorage.setItem('emailForSignIn', email);
  }

  async completeEmailLinkSignIn() {
    if (isSignInWithEmailLink(this.auth, window.location.href)) {
      let email = window.localStorage.getItem('emailForSignIn');
      if (!email) {
        email = window.prompt('Please provide your email for confirmation');
      }
      if (email) {
        const credential = await signInWithEmailLink(this.auth, email, window.location.href);
        window.localStorage.removeItem('emailForSignIn');
        await this.createUserDocument(credential.user.uid, email);
        this.router.navigate(['/dashboard']);
      }
    }
  }
}
