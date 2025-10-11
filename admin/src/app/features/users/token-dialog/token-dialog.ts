import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef, MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { TokenWithId } from '../../../core/models/token.model';

interface DialogData {
  mode: 'create' | 'edit';
  userId: string;
  token?: TokenWithId;
}

@Component({
  selector: 'app-token-dialog',
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
  ],
  templateUrl: './token-dialog.html',
  styleUrl: './token-dialog.scss'
})
export class TokenDialogComponent {
  private fb = inject(FormBuilder);
  private dialogRef = inject(MatDialogRef<TokenDialogComponent>);
  data = inject<DialogData>(MAT_DIALOG_DATA);

  form: FormGroup;

  constructor() {
    this.form = this.fb.group({
      tokenId: [
        { value: this.data.token?.id || '', disabled: this.isEditMode },
        [Validators.required, Validators.pattern(/^[a-f0-9]{14}$/)]
      ],
      label: [this.data.token?.label || '', [Validators.required, Validators.minLength(2)]],
    });
  }

  get isEditMode(): boolean {
    return this.data.mode === 'edit';
  }

  get title(): string {
    return this.isEditMode ? 'Token bearbeiten' : 'Neues Token';
  }

  onSubmit(): void {
    if (this.form.valid) {
      const result = {
        tokenId: this.isEditMode ? this.data.token!.id : this.form.value.tokenId,
        label: this.form.value.label,
      };
      this.dialogRef.close(result);
    }
  }

  onCancel(): void {
    this.dialogRef.close();
  }
}
