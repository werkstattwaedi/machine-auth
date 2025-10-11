import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatTableModule } from '@angular/material/table';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatChipsModule } from '@angular/material/chips';
import { MatCardModule } from '@angular/material/card';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatBadgeModule } from '@angular/material/badge';
import { Observable, BehaviorSubject, switchMap, of } from 'rxjs';
import { UserService } from '../../core/services/user.service';
import { PermissionService } from '../../core/services/permission.service';
import { UserWithId } from '../../core/models/user.model';
import { TokenWithId } from '../../core/models/token.model';
import { PermissionWithId } from '../../core/models/permission.model';
import { UserDialogComponent } from './user-dialog/user-dialog';
import { TokenDialogComponent } from './token-dialog/token-dialog';

@Component({
  selector: 'app-users',
  imports: [
    CommonModule,
    MatTableModule,
    MatButtonModule,
    MatIconModule,
    MatChipsModule,
    MatCardModule,
    MatDialogModule,
    MatSnackBarModule,
    MatBadgeModule,
  ],
  templateUrl: './users.html',
  styleUrl: './users.scss'
})
export class UsersComponent {
  private userService = inject(UserService);
  private permissionService = inject(PermissionService);
  private dialog = inject(MatDialog);
  private snackBar = inject(MatSnackBar);

  users$: Observable<UserWithId[]> = this.userService.getUsers();
  permissions$: Observable<PermissionWithId[]> = this.permissionService.getPermissions();

  private selectedUserSubject = new BehaviorSubject<UserWithId | null>(null);
  selectedUser$ = this.selectedUserSubject.asObservable();

  selectedUserTokens$: Observable<TokenWithId[]> = this.selectedUser$.pipe(
    switchMap(user => user ? this.userService.getUserTokens(user.id) : of([]))
  );

  userColumns: string[] = ['displayName', 'email', 'roles', 'actions'];
  tokenColumns: string[] = ['id', 'label', 'registered', 'deactivated', 'actions'];

  selectUser(user: UserWithId): void {
    this.selectedUserSubject.next(user);
  }

  /**
   * Create a new user
   */
  createUser(): void {
    const dialogRef = this.dialog.open(UserDialogComponent, {
      width: '600px',
      data: { mode: 'create' }
    });

    dialogRef.afterClosed().subscribe((result) => {
      if (result) {
        this.userService.createUser(result).then(() => {
          this.snackBar.open('Benutzer erstellt', 'OK', { duration: 3000 });
        }).catch((error) => {
          this.snackBar.open(`Fehler: ${error.message}`, 'OK', { duration: 5000 });
        });
      }
    });
  }

  /**
   * Edit a user
   */
  editUser(user: UserWithId): void {
    const dialogRef = this.dialog.open(UserDialogComponent, {
      width: '600px',
      data: { mode: 'edit', user }
    });

    dialogRef.afterClosed().subscribe((result) => {
      if (result) {
        this.userService.updateUser(user.id, result).then(() => {
          this.snackBar.open('Benutzer aktualisiert', 'OK', { duration: 3000 });
        }).catch((error) => {
          this.snackBar.open(`Fehler: ${error.message}`, 'OK', { duration: 5000 });
        });
      }
    });
  }

  /**
   * Delete a user
   */
  deleteUser(user: UserWithId): void {
    if (confirm(`Benutzer "${user.displayName}" wirklich löschen?`)) {
      this.userService.deleteUser(user.id).then(() => {
        this.snackBar.open('Benutzer gelöscht', 'OK', { duration: 3000 });
        if (this.selectedUserSubject.value?.id === user.id) {
          this.selectedUserSubject.next(null);
        }
      }).catch((error) => {
        this.snackBar.open(`Fehler: ${error.message}`, 'OK', { duration: 5000 });
      });
    }
  }

  /**
   * Add a token to the selected user
   */
  addToken(user: UserWithId): void {
    const dialogRef = this.dialog.open(TokenDialogComponent, {
      width: '500px',
      data: { mode: 'create', userId: user.id }
    });

    dialogRef.afterClosed().subscribe((result) => {
      if (result) {
        this.userService.addToken(user.id, result.tokenId, { label: result.label }).then(() => {
          this.snackBar.open('Token hinzugefügt', 'OK', { duration: 3000 });
        }).catch((error) => {
          this.snackBar.open(`Fehler: ${error.message}`, 'OK', { duration: 5000 });
        });
      }
    });
  }

  /**
   * Edit a token
   */
  editToken(user: UserWithId, token: TokenWithId): void {
    const dialogRef = this.dialog.open(TokenDialogComponent, {
      width: '500px',
      data: { mode: 'edit', userId: user.id, token }
    });

    dialogRef.afterClosed().subscribe((result) => {
      if (result) {
        this.userService.updateToken(user.id, token.id, { label: result.label }).then(() => {
          this.snackBar.open('Token aktualisiert', 'OK', { duration: 3000 });
        }).catch((error) => {
          this.snackBar.open(`Fehler: ${error.message}`, 'OK', { duration: 5000 });
        });
      }
    });
  }

  /**
   * Deactivate a token
   */
  deactivateToken(user: UserWithId, token: TokenWithId): void {
    if (confirm(`Token "${token.label}" wirklich deaktivieren?`)) {
      this.userService.deactivateToken(user.id, token.id).then(() => {
        this.snackBar.open('Token deaktiviert', 'OK', { duration: 3000 });
      }).catch((error) => {
        this.snackBar.open(`Fehler: ${error.message}`, 'OK', { duration: 5000 });
      });
    }
  }

  /**
   * Delete a token
   */
  deleteToken(user: UserWithId, token: TokenWithId): void {
    if (confirm(`Token "${token.label}" wirklich löschen?`)) {
      this.userService.deleteToken(user.id, token.id).then(() => {
        this.snackBar.open('Token gelöscht', 'OK', { duration: 3000 });
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
   * Format timestamp for display
   */
  formatDate(timestamp: any): string {
    if (!timestamp) return '-';
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    return date.toLocaleDateString('de-DE', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  }
}
