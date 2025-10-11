import { Injectable, inject } from '@angular/core';
import { Firestore, collection, collectionData, doc, addDoc, updateDoc, deleteDoc } from '@angular/fire/firestore';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { PermissionDocument, PermissionWithId } from '../models/permission.model';

@Injectable({
  providedIn: 'root'
})
export class PermissionService {
  private firestore = inject(Firestore);
  private permissionsCollection = collection(this.firestore, 'permission');

  /**
   * Get all permissions as an observable stream
   */
  getPermissions(): Observable<PermissionWithId[]> {
    return collectionData(this.permissionsCollection, { idField: 'id' }).pipe(
      map((permissions) => permissions as PermissionWithId[])
    );
  }

  /**
   * Create a new permission
   */
  async createPermission(permission: PermissionDocument): Promise<string> {
    const docRef = await addDoc(this.permissionsCollection, permission);
    return docRef.id;
  }

  /**
   * Update an existing permission
   */
  async updatePermission(id: string, permission: Partial<PermissionDocument>): Promise<void> {
    const docRef = doc(this.permissionsCollection, id);
    await updateDoc(docRef, permission);
  }

  /**
   * Delete a permission
   */
  async deletePermission(id: string): Promise<void> {
    const docRef = doc(this.permissionsCollection, id);
    await deleteDoc(docRef);
  }
}
