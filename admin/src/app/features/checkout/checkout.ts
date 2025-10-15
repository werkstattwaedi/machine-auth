import { Component, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatTableModule } from '@angular/material/table';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { SessionService } from '../../core/services/session.service';
import { AuthService } from '../../core/services/auth.service';
import { UsageSummary, SessionWithId } from '../../core/models/session.model';
import { environment } from '../../../environments/environment';

@Component({
  selector: 'app-checkout',
  standalone: true,
  imports: [
    CommonModule,
    MatCardModule,
    MatButtonModule,
    MatTableModule,
    MatProgressSpinnerModule,
  ],
  templateUrl: './checkout.html',
  styleUrl: './checkout.scss',
})
export class CheckoutComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private http = inject(HttpClient);
  private sessionService = inject(SessionService);
  private authService = inject(AuthService);

  loading = true;
  error: string | null = null;
  userId: string | null = null;
  usageSummary: UsageSummary | null = null;
  sessions: SessionWithId[] = [];
  displayedColumns = ['machine', 'count', 'duration'];

  async ngOnInit() {
    // Check if this is tag-based checkout (URL params)
    const picc = this.route.snapshot.queryParamMap.get('picc');
    const cmac = this.route.snapshot.queryParamMap.get('cmac');

    if (picc && cmac) {
      // Tag-based checkout
      await this.handleTagCheckout(picc, cmac);
    } else {
      // Authenticated checkout (user logged in)
      await this.handleAuthenticatedCheckout();
    }
  }

  /**
   * Handles checkout via NFC tag URL
   */
  private async handleTagCheckout(picc: string, cmac: string) {
    try {
      this.loading = true;
      this.error = null;

      // Call Firebase function to verify tag
      const verifyUrl = `${environment.firebaseFunctionsUrl}/verifyTagCheckout`;
      const result: any = await firstValueFrom(
        this.http.post(verifyUrl, { picc, cmac })
      );

      this.userId = result.userId;

      if (!this.userId) {
        this.error = 'Ungültige Antwort vom Server';
        this.loading = false;
        return;
      }

      // Load sessions and calculate summary
      await this.loadSessionsAndSummary(this.userId);
    } catch (error: any) {
      console.error('Tag verification failed:', error);
      this.error = error.error?.error || 'Tag-Verifizierung fehlgeschlagen';
      this.loading = false;
    }
  }

  /**
   * Handles checkout for authenticated user
   */
  private async handleAuthenticatedCheckout() {
    try {
      this.loading = true;
      this.error = null;

      // Get current user
      const userDoc = await firstValueFrom(this.authService.userDoc$);
      if (!userDoc) {
        this.error = 'Nicht angemeldet';
        this.loading = false;
        return;
      }

      this.userId = userDoc.id;

      // Load sessions and calculate summary
      await this.loadSessionsAndSummary(this.userId);
    } catch (error: any) {
      console.error('Authenticated checkout failed:', error);
      this.error = 'Fehler beim Laden der Sitzungen';
      this.loading = false;
    }
  }

  /**
   * Loads active sessions and calculates usage summary
   */
  private async loadSessionsAndSummary(userId: string) {
    // Get active sessions
    this.sessions = await firstValueFrom(
      this.sessionService.getActiveSessionsForUser(userId)
    );

    if (this.sessions.length === 0) {
      this.error = 'Keine aktiven Sitzungen gefunden';
      this.loading = false;
      return;
    }

    // Calculate usage summary
    this.usageSummary = await this.sessionService.calculateUsageSummary(
      this.sessions
    );

    this.loading = false;
  }

  /**
   * Closes all sessions and redirects to Cognitoforms
   */
  async proceedToCheckout() {
    if (!this.sessions.length) {
      return;
    }

    this.loading = true;

    try {
      // Close all sessions
      const sessionIds = this.sessions.map((s) => s.id);
      await this.sessionService.closeAllSessions(sessionIds, 'user_checkout');

      // Build Cognitoforms URL with prefilled data
      const params = new URLSearchParams();

      if (this.usageSummary) {
        // Add machine usage data
        this.usageSummary.machineUsage.forEach((usage, index) => {
          params.append(`entry.machine${index + 1}`, usage.machineName);
          params.append(
            `entry.duration${index + 1}`,
            usage.totalDurationMinutes.toString()
          );
        });

        // Add total
        params.append('entry.totalMinutes', this.usageSummary.totalDurationMinutes.toString());
      }

      // Redirect to Cognitoforms (URL TBD)
      const cognitoformsUrl = `https://www.cognitoforms.com/FORM_ID?${params.toString()}`;
      window.location.href = cognitoformsUrl;
    } catch (error: any) {
      console.error('Checkout failed:', error);
      this.error = 'Fehler beim Abschluss';
      this.loading = false;
    }
  }

  /**
   * Formats duration in minutes to HH:MM
   */
  formatDuration(minutes: number): string {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${hours}:${mins.toString().padStart(2, '0')}`;
  }
}
