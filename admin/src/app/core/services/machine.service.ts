import { Injectable, inject } from '@angular/core';
import { Firestore, collection, collectionData, doc, addDoc, updateDoc, deleteDoc, setDoc } from '@angular/fire/firestore';
import { Observable, combineLatest } from 'rxjs';
import { map } from 'rxjs/operators';
import { MachineDocument, MachineWithId, MacoDocument, MacoWithId } from '../models/machine.model';

@Injectable({
  providedIn: 'root'
})
export class MachineService {
  private firestore = inject(Firestore);
  private machinesCollection = collection(this.firestore, 'machine');
  private macosCollection = collection(this.firestore, 'maco');

  /**
   * Get all machines as an observable stream
   */
  getMachines(): Observable<MachineWithId[]> {
    return collectionData(this.machinesCollection, { idField: 'id' }).pipe(
      map((machines) => machines as MachineWithId[])
    );
  }

  /**
   * Get all MaCo terminals as an observable stream
   */
  getMacos(): Observable<MacoWithId[]> {
    return collectionData(this.macosCollection, { idField: 'id' }).pipe(
      map((macos) => macos as MacoWithId[])
    );
  }

  /**
   * Get combined machines and terminals data
   */
  getMachinesWithTerminals(): Observable<{ machines: MachineWithId[]; macos: MacoWithId[] }> {
    return combineLatest([this.getMachines(), this.getMacos()]).pipe(
      map(([machines, macos]) => ({ machines, macos }))
    );
  }

  /**
   * Create a new machine
   */
  async createMachine(machine: MachineDocument): Promise<string> {
    const docRef = await addDoc(this.machinesCollection, machine);
    return docRef.id;
  }

  /**
   * Update an existing machine
   */
  async updateMachine(id: string, machine: Partial<MachineDocument>): Promise<void> {
    const docRef = doc(this.machinesCollection, id);
    await updateDoc(docRef, machine);
  }

  /**
   * Delete a machine
   */
  async deleteMachine(id: string): Promise<void> {
    const docRef = doc(this.machinesCollection, id);
    await deleteDoc(docRef);
  }

  /**
   * Create or update a MaCo terminal (uses device ID as document ID)
   */
  async saveMaco(deviceId: string, maco: MacoDocument): Promise<void> {
    const docRef = doc(this.macosCollection, deviceId);
    await setDoc(docRef, maco);
  }

  /**
   * Delete a MaCo terminal
   */
  async deleteMaco(deviceId: string): Promise<void> {
    const docRef = doc(this.macosCollection, deviceId);
    await deleteDoc(docRef);
  }
}
