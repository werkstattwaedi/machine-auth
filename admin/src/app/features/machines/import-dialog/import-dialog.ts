import { Component, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatTableModule } from '@angular/material/table';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { ParticleService, ParticleDevice } from '../../../core/services/particle.service';
import { MachineService } from '../../../core/services/machine.service';
import { Observable, forkJoin } from 'rxjs';
import { map, take } from 'rxjs/operators';

interface DeviceWithStatus extends ParticleDevice {
  imported: boolean;
  importing: boolean;
}

@Component({
  selector: 'app-import-dialog',
  standalone: true,
  imports: [
    CommonModule,
    MatDialogModule,
    MatButtonModule,
    MatTableModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatSnackBarModule,
  ],
  templateUrl: './import-dialog.html',
  styleUrl: './import-dialog.scss'
})
export class ImportDialogComponent implements OnInit {
  private particleService = inject(ParticleService);
  private machineService = inject(MachineService);
  private snackBar = inject(MatSnackBar);
  private dialogRef = inject(MatDialogRef<ImportDialogComponent>);

  devices: DeviceWithStatus[] = [];
  loading = true;
  error: string | null = null;

  displayedColumns = ['name', 'id', 'online', 'actions'];

  ngOnInit() {
    this.loadDevices();
  }

  /**
   * Load devices from Particle and check which are already imported
   */
  loadDevices() {
    console.log('[ImportDialog] Starting loadDevices');
    this.loading = true;
    this.error = null;

    forkJoin({
      particleDevices: this.particleService.listDevices(),
      terminals: this.machineService.getMacos().pipe(take(1)),
    }).subscribe({
      next: ({ particleDevices, terminals }) => {
        console.log('[ImportDialog] Received data:', {
          particleDevices: particleDevices.length,
          terminals: terminals.length
        });

        const terminalIds = new Set(terminals.map(t => t.id));

        this.devices = particleDevices.map(device => ({
          ...device,
          imported: terminalIds.has(device.id),
          importing: false,
        }));

        console.log('[ImportDialog] Processed devices:', this.devices.length);
        this.loading = false;
      },
      error: (err) => {
        console.error('[ImportDialog] Error loading devices:', err);
        this.error = err.message || 'Fehler beim Laden der Geräte';
        this.loading = false;
      }
    });
  }

  /**
   * Import a device as terminal
   */
  importDevice(device: DeviceWithStatus) {
    device.importing = true;

    this.particleService.importDevice(device.id, device.name).subscribe({
      next: (result) => {
        device.importing = false;
        device.imported = true;
        this.snackBar.open(`Terminal "${result.name}" importiert`, 'OK', { duration: 3000 });
      },
      error: (err) => {
        device.importing = false;
        this.snackBar.open(`Fehler: ${err.message}`, 'OK', { duration: 5000 });
      }
    });
  }

  /**
   * Close dialog and refresh parent
   */
  close() {
    this.dialogRef.close(true); // Return true to indicate refresh needed
  }
}
