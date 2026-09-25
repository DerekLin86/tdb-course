import { ApplicationConfig, provideZoneChangeDetection } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideHttpClient, withFetch } from '@angular/common/http';
import { BALLET_API_BASE_URL } from '@libs/ballet/data-access';

import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(routes),
    provideHttpClient(withFetch()),
    {
      provide: BALLET_API_BASE_URL,
      useFactory: () => {
        if (typeof window !== 'undefined' && window.location.port !== '4200') {
          return '/api/v1';
        }
        return 'http://localhost:8000/api/v1';
      }
    }
  ]
};

