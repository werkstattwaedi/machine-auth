import { Routes } from '@angular/router';
import { LoginComponent } from './features/auth/login/login';
import { DashboardComponent } from './features/dashboard/dashboard';
import { ProfileComponent } from './features/profile/profile';
import { SessionsComponent } from './features/sessions/sessions';
import { UsersComponent } from './features/users/users';
import { MachinesComponent } from './features/machines/machines';
import { PermissionsComponent } from './features/permissions/permissions';
import { MainLayoutComponent } from './shared/layout/main-layout/main-layout';
import { authGuard } from './core/guards/auth.guard';
import { adminGuard } from './core/guards/admin.guard';

export const routes: Routes = [
  {
    path: 'login',
    component: LoginComponent,
  },
  {
    path: '',
    component: MainLayoutComponent,
    canActivate: [authGuard],
    children: [
      {
        path: 'dashboard',
        component: DashboardComponent,
      },
      {
        path: 'profile',
        component: ProfileComponent,
      },
      {
        path: 'sessions',
        component: SessionsComponent,
      },
      {
        path: 'users',
        component: UsersComponent,
        canActivate: [adminGuard],
      },
      {
        path: 'machines',
        component: MachinesComponent,
        canActivate: [adminGuard],
      },
      {
        path: 'permissions',
        component: PermissionsComponent,
        canActivate: [adminGuard],
      },
      {
        path: 'sessions/all',
        component: SessionsComponent,
        canActivate: [adminGuard],
      },
      {
        path: '',
        redirectTo: '/dashboard',
        pathMatch: 'full',
      },
    ],
  },
];
