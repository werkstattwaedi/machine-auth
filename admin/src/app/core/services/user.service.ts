import { Injectable, inject } from '@angular/core';
import {
  Firestore,
  collection,
  collectionData,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  setDoc,
  Timestamp,
  CollectionReference,
  DocumentReference
} from '@angular/fire/firestore';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { UserDocument, UserWithId } from '../models/user.model';
import { TokenDocument, TokenWithId } from '../models/token.model';

@Injectable({
  providedIn: 'root'
})
export class UserService {
  private firestore = inject(Firestore);
  private usersCollection = collection(this.firestore, 'users');

  /**
   * Get all users as an observable stream
   */
  getUsers(): Observable<UserWithId[]> {
    return collectionData(this.usersCollection, { idField: 'id' }).pipe(
      map((users) => users as UserWithId[])
    );
  }

  /**
   * Create a new user
   */
  async createUser(user: Omit<UserDocument, 'created'>): Promise<string> {
    const newUser = {
      ...user,
      created: Timestamp.now(),
    };
    const docRef = await addDoc(this.usersCollection, newUser);
    return docRef.id;
  }

  /**
   * Update an existing user
   */
  async updateUser(id: string, user: Partial<UserDocument>): Promise<void> {
    const docRef = doc(this.usersCollection, id);
    await updateDoc(docRef, user);
  }

  /**
   * Delete a user
   */
  async deleteUser(id: string): Promise<void> {
    const docRef = doc(this.usersCollection, id);
    await deleteDoc(docRef);
  }

  /**
   * Get tokens for a specific user
   */
  getUserTokens(userId: string): Observable<TokenWithId[]> {
    const tokensCollection = collection(this.firestore, `users/${userId}/token`) as CollectionReference;
    return collectionData(tokensCollection, { idField: 'id' }).pipe(
      map((tokens) => tokens as TokenWithId[])
    );
  }

  /**
   * Add a token to a user
   */
  async addToken(userId: string, tokenId: string, token: Omit<TokenDocument, 'userId' | 'registered'>): Promise<void> {
    const tokensCollection = collection(this.firestore, `users/${userId}/token`);
    const tokenDocRef = doc(tokensCollection, tokenId);
    const tokenData: TokenDocument = {
      ...token,
      userId: `/users/${userId}`,
      registered: Timestamp.now(),
    };
    await setDoc(tokenDocRef, tokenData);
  }

  /**
   * Update a token
   */
  async updateToken(userId: string, tokenId: string, updates: Partial<TokenDocument>): Promise<void> {
    const tokenDocRef = doc(this.firestore, `users/${userId}/token/${tokenId}`);
    await updateDoc(tokenDocRef, updates);
  }

  /**
   * Deactivate a token
   */
  async deactivateToken(userId: string, tokenId: string): Promise<void> {
    await this.updateToken(userId, tokenId, {
      deactivated: Timestamp.now(),
    });
  }

  /**
   * Delete a token
   */
  async deleteToken(userId: string, tokenId: string): Promise<void> {
    const tokenDocRef = doc(this.firestore, `users/${userId}/token/${tokenId}`);
    await deleteDoc(tokenDocRef);
  }
}
