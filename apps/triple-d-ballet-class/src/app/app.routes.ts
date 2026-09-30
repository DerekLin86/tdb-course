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
      import('@libs/ballet/feature').then(m => m.KioskCheckinComponent),
    title: '教室 iPad 簽到台 (模式 A) | Triple-D 芭蕾'
  },
  {
    path: 'admin',
    redirectTo: 'admin/sessions',
    pathMatch: 'full'
  },
  {
    path: 'admin/sessions',
    loadComponent: () =>
      import('@libs/ballet/feature').then(m => m.SessionManagementComponent),
    title: '課堂管理與場租防護 | Triple-D 芭蕾'
  },
  {
    path: 'admin/students',
    loadComponent: () =>
      import('@libs/ballet/feature').then(m => m.StudentManagementComponent),
    title: '學員票卡與歷程管理 | Triple-D 芭蕾'
  },
  {
    path: '**',
    redirectTo: 'kiosk'
  }
];
