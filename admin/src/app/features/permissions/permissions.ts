import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatTableModule } from '@angular/material/table';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { Observable } from 'rxjs';
import { PermissionService } from '../../core/services/permission.service';
import { PermissionWithId } from '../../core/models/permission.model';
import { PermissionDialogComponent } from './permission-dialog/permission-dialog';

@Component({
  selector: 'app-permissions',
  imports: [
    CommonModule,
    MatTableModule,
    MatButtonModule,
    MatIconModule,
    MatDialogModule,
    MatSnackBarModule,
  ],
  templateUrl: './permissions.html',
  styleUrl: './permissions.scss'
})
export class PermissionsComponent {
  private permissionService = inject(PermissionService);
  private dialog = inject(MatDialog);
  private snackBar = inject(MatSnackBar);

  permissions$: Observable<PermissionWithId[]> = this.permissionService.getPermissions();
  displayedColumns: string[] = ['name', 'id', 'actions'];

  /**
   * Open dialog to create a new permission
   */
  createPermission(): void {
    const dialogRef = this.dialog.open(PermissionDialogComponent, {
      width: '500px',
      data: { mode: 'create' }
    });

    dialogRef.afterClosed().subscribe((result) => {
      if (result) {
        this.permissionService.createPermission(result).then(() => {
          this.snackBar.open('Berechtigung erstellt', 'OK', { duration: 3000 });
        }).catch((error) => {
          this.snackBar.open(`Fehler: ${error.message}`, 'OK', { duration: 5000 });
        });
      }
    });
  }

  /**
   * Open dialog to edit an existing permission
   */
  editPermission(permission: PermissionWithId): void {
    const dialogRef = this.dialog.open(PermissionDialogComponent, {
      width: '500px',
      data: { mode: 'edit', permission }
    });

    dialogRef.afterClosed().subscribe((result) => {
      if (result) {
        this.permissionService.updatePermission(permission.id, result).then(() => {
          this.snackBar.open('Berechtigung aktualisiert', 'OK', { duration: 3000 });
        }).catch((error) => {
          this.snackBar.open(`Fehler: ${error.message}`, 'OK', { duration: 5000 });
        });
      }
    });
  }

  /**
   * Delete a permission with confirmation
   */
  deletePermission(permission: PermissionWithId): void {
    if (confirm(`Berechtigung "${permission.name}" wirklich löschen?`)) {
      this.permissionService.deletePermission(permission.id).then(() => {
        this.snackBar.open('Berechtigung gelöscht', 'OK', { duration: 3000 });
      }).catch((error) => {
        this.snackBar.open(`Fehler: ${error.message}`, 'OK', { duration: 5000 });
      });
    }
  }
}
