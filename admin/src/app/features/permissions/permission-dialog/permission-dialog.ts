import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef, MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { PermissionDocument, PermissionWithId } from '../../../core/models/permission.model';

interface DialogData {
  mode: 'create' | 'edit';
  permission?: PermissionWithId;
}

@Component({
  selector: 'app-permission-dialog',
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
  ],
  templateUrl: './permission-dialog.html',
  styleUrl: './permission-dialog.scss'
})
export class PermissionDialogComponent {
  private fb = inject(FormBuilder);
  private dialogRef = inject(MatDialogRef<PermissionDialogComponent>);
  data = inject<DialogData>(MAT_DIALOG_DATA);

  form: FormGroup;

  constructor() {
    this.form = this.fb.group({
      name: [this.data.permission?.name || '', [Validators.required, Validators.minLength(2)]],
    });
  }

  get isEditMode(): boolean {
    return this.data.mode === 'edit';
  }

  get title(): string {
    return this.isEditMode ? 'Berechtigung bearbeiten' : 'Neue Berechtigung';
  }

  onSubmit(): void {
    if (this.form.valid) {
      const permission: PermissionDocument = {
        name: this.form.value.name,
      };
      this.dialogRef.close(permission);
    }
  }

  onCancel(): void {
    this.dialogRef.close();
  }
}
