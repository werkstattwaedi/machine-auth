import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { MatSidenavModule } from '@angular/material/sidenav';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatListModule } from '@angular/material/list';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatMenuModule } from '@angular/material/menu';
import { AuthService } from '../../../core/services/auth.service';

interface NavItem {
  label: string;
  route: string;
  icon: string;
  adminOnly?: boolean;
}

@Component({
  selector: 'app-main-layout',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    MatSidenavModule,
    MatToolbarModule,
    MatListModule,
    MatIconModule,
    MatButtonModule,
    MatMenuModule,
  ],
  templateUrl: './main-layout.html',
  styleUrl: './main-layout.scss',
})
export class MainLayoutComponent {
  private authService = inject(AuthService);

  readonly userDoc$ = this.authService.userDoc$;
  readonly isAdmin$ = this.authService.isAdmin$;

  navItems: NavItem[] = [
    { label: 'Dashboard', route: '/dashboard', icon: 'dashboard' },
    { label: 'Meine Sitzungen', route: '/sessions', icon: 'history' },
    { label: 'Mein Profil', route: '/profile', icon: 'person' },
    { label: 'Benutzer', route: '/users', icon: 'people', adminOnly: true },
    { label: 'Maschinen', route: '/machines', icon: 'precision_manufacturing', adminOnly: true },
    { label: 'Berechtigungen', route: '/permissions', icon: 'verified_user', adminOnly: true },
    { label: 'Alle Sitzungen', route: '/sessions/all', icon: 'admin_panel_settings', adminOnly: true },
  ];

  async signOut() {
    await this.authService.signOut();
  }
}
