import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { AuthService } from '../auth.service';

@Component({
  selector: 'app-register',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './register.component.html',
  styleUrls: ['./register.component.scss']
})
export class RegisterComponent {
  email = '';
  password = '';
  displayName = '';
  emailForLink = '';
  linkSent = false;
  errorMessage = '';

  private authService: AuthService = inject(AuthService);

  async registerWithEmail() {
    this.errorMessage = '';
    try {
      await this.authService.registerWithEmail(this.email, this.password, this.displayName);
    } catch (error: any) {
      this.errorMessage = error.message;
      console.error('Registration failed:', error);
    }
  }

  async registerWithGoogle() {
    this.errorMessage = '';
    try {
      await this.authService.registerWithGoogle();
    } catch (error: any) {
      this.errorMessage = error.message;
      console.error('Google registration failed:', error);
    }
  }

  async registerWithEmailLink() {
    this.errorMessage = '';
    this.linkSent = false;
    try {
      await this.authService.sendEmailLink(this.emailForLink);
      this.linkSent = true;
    } catch (error: any) {
      this.errorMessage = error.message;
      console.error('Email link registration failed:', error);
    }
  }
}