import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatTabsModule } from '@angular/material/tabs';
import { MatTableModule } from '@angular/material/table';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatChipsModule } from '@angular/material/chips';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { Observable } from 'rxjs';
import { MachineService } from '../../core/services/machine.service';
import { PermissionService } from '../../core/services/permission.service';
import { MachineWithId, MacoWithId } from '../../core/models/machine.model';
import { PermissionWithId } from '../../core/models/permission.model';
import { MachineDialogComponent } from './machine-dialog/machine-dialog';
import { MacoDialogComponent } from './maco-dialog/maco-dialog';
import { ImportDialogComponent } from './import-dialog/import-dialog';

@Component({
  selector: 'app-machines',
  imports: [
    CommonModule,
    MatTabsModule,
    MatTableModule,
    MatButtonModule,
    MatIconModule,
    MatChipsModule,
    MatDialogModule,
    MatSnackBarModule,
  ],
  templateUrl: './machines.html',
  styleUrl: './machines.scss'
})
export class MachinesComponent {
  private machineService = inject(MachineService);
  private permissionService = inject(PermissionService);
  private dialog = inject(MatDialog);
  private snackBar = inject(MatSnackBar);

  machines$: Observable<MachineWithId[]> = this.machineService.getMachines();
  macos$: Observable<MacoWithId[]> = this.machineService.getMacos();
  permissions$: Observable<PermissionWithId[]> = this.permissionService.getPermissions();

  machineColumns: string[] = ['name', 'maco', 'requiredPermission', 'actions'];
  macoColumns: string[] = ['id', 'name', 'actions'];

  /**
   * Open dialog to create a new machine
   */
  createMachine(): void {
    const dialogRef = this.dialog.open(MachineDialogComponent, {
      width: '600px',
      data: { mode: 'create' }
    });

    dialogRef.afterClosed().subscribe((result) => {
      if (result) {
        this.machineService.createMachine(result).then(() => {
          this.snackBar.open('Maschine erstellt', 'OK', { duration: 3000 });
        }).catch((error) => {
          this.snackBar.open(`Fehler: ${error.message}`, 'OK', { duration: 5000 });
        });
      }
    });
  }

  /**
   * Open dialog to edit an existing machine
   */
  editMachine(machine: MachineWithId): void {
    const dialogRef = this.dialog.open(MachineDialogComponent, {
      width: '600px',
      data: { mode: 'edit', machine }
    });

    dialogRef.afterClosed().subscribe((result) => {
      if (result) {
        this.machineService.updateMachine(machine.id, result).then(() => {
          this.snackBar.open('Maschine aktualisiert', 'OK', { duration: 3000 });
        }).catch((error) => {
          this.snackBar.open(`Fehler: ${error.message}`, 'OK', { duration: 5000 });
        });
      }
    });
  }

  /**
   * Delete a machine with confirmation
   */
  deleteMachine(machine: MachineWithId): void {
    if (confirm(`Maschine "${machine.name}" wirklich löschen?`)) {
      this.machineService.deleteMachine(machine.id).then(() => {
        this.snackBar.open('Maschine gelöscht', 'OK', { duration: 3000 });
      }).catch((error) => {
        this.snackBar.open(`Fehler: ${error.message}`, 'OK', { duration: 5000 });
      });
    }
  }

  /**
   * Open dialog to create/edit a MaCo terminal
   */
  createMaco(): void {
    const dialogRef = this.dialog.open(MacoDialogComponent, {
      width: '500px',
      data: { mode: 'create' }
    });

    dialogRef.afterClosed().subscribe((result) => {
      if (result) {
        this.machineService.saveMaco(result.deviceId, { name: result.name }).then(() => {
          this.snackBar.open('Terminal erstellt', 'OK', { duration: 3000 });
        }).catch((error) => {
          this.snackBar.open(`Fehler: ${error.message}`, 'OK', { duration: 5000 });
        });
      }
    });
  }

  /**
   * Edit a MaCo terminal
   */
  editMaco(maco: MacoWithId): void {
    const dialogRef = this.dialog.open(MacoDialogComponent, {
      width: '500px',
      data: { mode: 'edit', maco }
    });

    dialogRef.afterClosed().subscribe((result) => {
      if (result) {
        this.machineService.saveMaco(maco.id, { name: result.name }).then(() => {
          this.snackBar.open('Terminal aktualisiert', 'OK', { duration: 3000 });
        }).catch((error) => {
          this.snackBar.open(`Fehler: ${error.message}`, 'OK', { duration: 5000 });
        });
      }
    });
  }

  /**
   * Delete a MaCo terminal with confirmation
   */
  deleteMaco(maco: MacoWithId): void {
    if (confirm(`Terminal "${maco.name}" (${maco.id}) wirklich löschen?`)) {
      this.machineService.deleteMaco(maco.id).then(() => {
        this.snackBar.open('Terminal gelöscht', 'OK', { duration: 3000 });
      }).catch((error) => {
        this.snackBar.open(`Fehler: ${error.message}`, 'OK', { duration: 5000 });
      });
    }
  }

  /**
   * Get permission name by ID
   */
  getPermissionName(permissionId: string, permissions: PermissionWithId[]): string {
    const permission = permissions.find(p => p.id === permissionId);
    return permission ? permission.name : permissionId;
  }

  /**
   * Get MaCo name by device ID
   */
  getMacoName(deviceId: string, macos: MacoWithId[]): string {
    const maco = macos.find(m => m.id === deviceId);
    return maco ? maco.name : deviceId;
  }

  /**
   * Import devices from Particle Cloud
   */
  importFromParticle(): void {
    const dialogRef = this.dialog.open(ImportDialogComponent, {
      width: '800px',
      maxHeight: '80vh',
    });

    dialogRef.afterClosed().subscribe((shouldRefresh) => {
      if (shouldRefresh) {
        // Refresh the macos list
        this.macos$ = this.machineService.getMacos();
      }
    });
  }
}
