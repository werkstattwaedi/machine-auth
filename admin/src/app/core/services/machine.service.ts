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
      map((machines) =>
        machines.map((machine: any) => ({
          id: machine.id,
          name: machine.name,
          // Convert DocumentReferences back to string IDs
          maco: machine.maco?.id || machine.maco,
          requiredPermission: machine.requiredPermission?.map((ref: any) => ref.id || ref) || [],
          control: machine.control,
        })) as MachineWithId[]
      )
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
    // Convert string IDs to DocumentReferences
    const machineData = {
      name: machine.name,
      maco: doc(this.firestore, 'maco', machine.maco),
      requiredPermission: machine.requiredPermission.map(permId =>
        doc(this.firestore, 'permission', permId)
      ),
      ...(machine.control && { control: machine.control }),
    };

    const docRef = await addDoc(this.machinesCollection, machineData);
    return docRef.id;
  }

  /**
   * Update an existing machine
   */
  async updateMachine(id: string, machine: Partial<MachineDocument>): Promise<void> {
    const docRef = doc(this.machinesCollection, id);

    // Convert string IDs to DocumentReferences
    const updateData: any = {};
    if (machine.name !== undefined) updateData.name = machine.name;
    if (machine.maco !== undefined) {
      updateData.maco = doc(this.firestore, 'maco', machine.maco);
    }
    if (machine.requiredPermission !== undefined) {
      updateData.requiredPermission = machine.requiredPermission.map(permId =>
        doc(this.firestore, 'permission', permId)
      );
    }
    if (machine.control !== undefined) updateData.control = machine.control;

    await updateDoc(docRef, updateData);
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
