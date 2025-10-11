import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AuthService } from '../../core/services/auth.service';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.scss',
})
export class DashboardComponent {
  private authService = inject(AuthService);

  readonly userDoc$ = this.authService.userDoc$;
  readonly isAdmin$ = this.authService.isAdmin$;
}
