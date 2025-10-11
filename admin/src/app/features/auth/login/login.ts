import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { AuthService } from '../../../core/services/auth.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatCardModule,
    MatButtonModule,
    MatInputModule,
    MatFormFieldModule,
    MatProgressSpinnerModule,
  ],
  templateUrl: './login.html',
  styleUrl: './login.scss',
})
export class LoginComponent implements OnInit {
  private authService = inject(AuthService);

  email = '';
  linkSent = false;
  loading = false;
  errorMessage = '';

  ngOnInit() {
    // Check if this is an email link callback
    this.authService.completeEmailLinkSignIn().catch((err) => {
      console.log('completeEmailLinkSignIn caught error:', err);
      // Only show error if it's a real error (not just "not an email link")
      if (err && err.message && err.message !== 'Email required for sign-in') {
        this.errorMessage = String(err.message);
        console.error('Email link sign-in error:', err);
      }
    });
  }

  async sendEmailLink() {
    if (!this.email) {
      this.errorMessage = 'Bitte gib deine E-Mail-Adresse ein';
      return;
    }

    this.loading = true;
    this.errorMessage = '';
    this.linkSent = false;

    try {
      await this.authService.sendEmailLink(this.email);
      this.linkSent = true;
    } catch (error: any) {
      this.errorMessage = error.message;
    } finally {
      this.loading = false;
    }
  }

  async signInWithGoogle() {
    this.loading = true;
    this.errorMessage = '';

    try {
      await this.authService.signInWithGoogle();
    } catch (error: any) {
      console.error("signInWithGoogle", error);
      this.errorMessage = error.message;
      this.loading = false;
    }
  }
}
