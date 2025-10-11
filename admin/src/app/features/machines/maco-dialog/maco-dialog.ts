import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef, MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MacoWithId } from '../../../core/models/machine.model';

interface DialogData {
  mode: 'create' | 'edit';
  maco?: MacoWithId;
}

@Component({
  selector: 'app-maco-dialog',
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
  ],
  templateUrl: './maco-dialog.html',
  styleUrl: './maco-dialog.scss'
})
export class MacoDialogComponent {
  private fb = inject(FormBuilder);
  private dialogRef = inject(MatDialogRef<MacoDialogComponent>);
  data = inject<DialogData>(MAT_DIALOG_DATA);

  form: FormGroup;

  constructor() {
    this.form = this.fb.group({
      deviceId: [
        { value: this.data.maco?.id || '', disabled: this.isEditMode },
        [Validators.required, Validators.pattern(/^[a-f0-9]{24}$/)]
      ],
      name: [this.data.maco?.name || '', [Validators.required, Validators.minLength(2)]],
    });
  }

  get isEditMode(): boolean {
    return this.data.mode === 'edit';
  }

  get title(): string {
    return this.isEditMode ? 'Terminal bearbeiten' : 'Neues Terminal';
  }

  onSubmit(): void {
    if (this.form.valid) {
      const result = {
        deviceId: this.isEditMode ? this.data.maco!.id : this.form.value.deviceId,
        name: this.form.value.name,
      };
      this.dialogRef.close(result);
    }
  }

  onCancel(): void {
    this.dialogRef.close();
  }
}
