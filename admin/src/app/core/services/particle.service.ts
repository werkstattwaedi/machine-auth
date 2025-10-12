import { Injectable, inject } from '@angular/core';
import { Auth } from '@angular/fire/auth';
import { Observable, from } from 'rxjs';
import { environment } from '../../../environments/environment';

export interface ParticleDevice {
  id: string;
  name: string;
  online: boolean;
  lastHeard: string;
  platform: number;
  productId: number;
  variables?: Record<string, string>;
  functions?: string[];
}

@Injectable({
  providedIn: 'root'
})
export class ParticleService {
  private auth = inject(Auth);

  /**
   * Get admin API base URL
   */
  private getAdminApiUrl(): string {
    if (environment.useEmulators) {
      return 'http://127.0.0.1:5001/oww-maschinenfreigabe/us-central1/admin';
    }
    return `https://us-central1-${environment.firebase.projectId}.cloudfunctions.net/admin`;
  }

  /**
   * Get Firebase Auth token for API calls
   */
  private async getAuthToken(): Promise<string> {
    const user = this.auth.currentUser;
    if (!user) {
      throw new Error('Not authenticated');
    }
    return await user.getIdToken();
  }

  /**
   * List all devices from Particle Cloud
   */
  listDevices(): Observable<ParticleDevice[]> {
    return from(this.fetchDevices());
  }

  private async fetchDevices(): Promise<ParticleDevice[]> {
    try {
      const token = await this.getAuthToken();
      const url = `${this.getAdminApiUrl()}/particle/devices`;

      console.log('[ParticleService] Fetching devices from:', url);

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      console.log('[ParticleService] Response status:', response.status);

      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Unknown error' }));
        console.error('[ParticleService] Error response:', error);
        throw new Error(error.error || `HTTP ${response.status}: Failed to list devices`);
      }

      const data = await response.json();
      console.log('[ParticleService] Received data:', data);

      if (!data.devices || !Array.isArray(data.devices)) {
        console.error('[ParticleService] Invalid response structure:', data);
        throw new Error('Invalid response: devices array not found');
      }

      console.log('[ParticleService] Found', data.devices.length, 'devices');
      return data.devices;
    } catch (error) {
      console.error('[ParticleService] fetchDevices error:', error);
      throw error;
    }
  }

  /**
   * Import a device as a terminal
   */
  importDevice(deviceId: string, name?: string): Observable<{ success: boolean; deviceId: string; name: string }> {
    return from(this.doImportDevice(deviceId, name));
  }

  private async doImportDevice(deviceId: string, name?: string): Promise<{ success: boolean; deviceId: string; name: string }> {
    const token = await this.getAuthToken();
    const url = `${this.getAdminApiUrl()}/particle/import-device`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ deviceId, name }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Unknown error' }));
      throw new Error(error.error || 'Failed to import device');
    }

    return await response.json();
  }
}
