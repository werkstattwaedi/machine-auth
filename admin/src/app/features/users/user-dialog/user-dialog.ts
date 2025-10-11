import { Component, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef, MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatSelectModule } from '@angular/material/select';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { Observable } from 'rxjs';
import { UserDocument, UserWithId } from '../../../core/models/user.model';
import { PermissionWithId } from '../../../core/models/permission.model';
import { PermissionService } from '../../../core/services/permission.service';

interface DialogData {
  mode: 'create' | 'edit';
  user?: UserWithId;
}

@Component({
  selector: 'app-user-dialog',
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatSelectModule,
    MatCheckboxModule,
  ],
  templateUrl: './user-dialog.html',
  styleUrl: './user-dialog.scss'
})
export class UserDialogComponent implements OnInit {
  private fb = inject(FormBuilder);
  private dialogRef = inject(MatDialogRef<UserDialogComponent>);
  private permissionService = inject(PermissionService);
  data = inject<DialogData>(MAT_DIALOG_DATA);

  form: FormGroup;
  permissions$: Observable<PermissionWithId[]> = this.permissionService.getPermissions();

  availableRoles = [
    { value: 'admin', label: 'Administrator' },
    { value: 'vereinsmitglied', label: 'Vereinsmitglied' },
  ];

  constructor() {
    this.form = this.fb.group({
      email: [this.data.user?.email || '', [Validators.required, Validators.email]],
      displayName: [this.data.user?.displayName || '', [Validators.required, Validators.minLength(2)]],
      name: [this.data.user?.name || ''],
      roles: [this.data.user?.roles || ['vereinsmitglied'], [Validators.required]],
      permissions: [this.data.user?.permissions || []],
    });
  }

  ngOnInit(): void {}

  get isEditMode(): boolean {
    return this.data.mode === 'edit';
  }

  get title(): string {
    return this.isEditMode ? 'Benutzer bearbeiten' : 'Neuer Benutzer';
  }

  onSubmit(): void {
    if (this.form.valid) {
      const user: Omit<UserDocument, 'created'> = {
        email: this.form.value.email,
        displayName: this.form.value.displayName,
        name: this.form.value.name,
        roles: this.form.value.roles,
        permissions: this.form.value.permissions,
        firebaseUid: this.data.user?.firebaseUid,
      };
      this.dialogRef.close(user);
    }
  }

  onCancel(): void {
    this.dialogRef.close();
  }
}
