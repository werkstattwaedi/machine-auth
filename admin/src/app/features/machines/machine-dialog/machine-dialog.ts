import { Component, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef, MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatSelectModule } from '@angular/material/select';
import { Observable } from 'rxjs';
import { MachineDocument, MachineWithId, MacoWithId } from '../../../core/models/machine.model';
import { PermissionWithId } from '../../../core/models/permission.model';
import { MachineService } from '../../../core/services/machine.service';
import { PermissionService } from '../../../core/services/permission.service';

interface DialogData {
  mode: 'create' | 'edit';
  machine?: MachineWithId;
}

@Component({
  selector: 'app-machine-dialog',
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatSelectModule,
  ],
  templateUrl: './machine-dialog.html',
  styleUrl: './machine-dialog.scss'
})
export class MachineDialogComponent implements OnInit {
  private fb = inject(FormBuilder);
  private dialogRef = inject(MatDialogRef<MachineDialogComponent>);
  private machineService = inject(MachineService);
  private permissionService = inject(PermissionService);
  data = inject<DialogData>(MAT_DIALOG_DATA);

  form: FormGroup;
  macos$: Observable<MacoWithId[]> = this.machineService.getMacos();
  permissions$: Observable<PermissionWithId[]> = this.permissionService.getPermissions();

  constructor() {
    this.form = this.fb.group({
      name: [this.data.machine?.name || '', [Validators.required, Validators.minLength(2)]],
      maco: [this.data.machine?.maco || '', [Validators.required]],
      requiredPermission: [this.data.machine?.requiredPermission || [], [Validators.required]],
    });
  }

  ngOnInit(): void {}

  get isEditMode(): boolean {
    return this.data.mode === 'edit';
  }

  get title(): string {
    return this.isEditMode ? 'Maschine bearbeiten' : 'Neue Maschine';
  }

  onSubmit(): void {
    if (this.form.valid) {
      const machine: MachineDocument = {
        name: this.form.value.name,
        maco: this.form.value.maco,
        requiredPermission: this.form.value.requiredPermission,
      };
      this.dialogRef.close(machine);
    }
  }

  onCancel(): void {
    this.dialogRef.close();
  }
}
