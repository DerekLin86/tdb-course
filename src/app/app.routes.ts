import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    redirectTo: 'kiosk',
    pathMatch: 'full'
  },
  {
    path: 'kiosk',
    loadComponent: () =>
      import('./pages/kiosk/kiosk-checkin.component').then(m => m.KioskCheckinComponent),
    title: '教室 iPad 簽到台 (模式 A) | Triple-D 芭蕾'
  },
  {
    path: 'student',
    loadComponent: () =>
      import('./pages/student/student-view.component').then(m => m.StudentViewComponent),
    title: '學員手機端 (LINE 友善) | Triple-D 芭蕾'
  },
  {
    path: 'admin',
    loadComponent: () =>
      import('./pages/admin/admin-dashboard.component').then(m => m.AdminDashboardComponent),
    title: '老師管理後台與損益防虧 | Triple-D 芭蕾'
  },
  {
    path: '**',
    redirectTo: 'kiosk'
  }
];
