import { Component, inject, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { Auth, signInWithEmailAndPassword } from '@angular/fire/auth';
import { AuthService } from '../auth.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './login.component.html',
  styleUrls: ['./login.component.scss']
})
export class LoginComponent implements OnInit {
  email = '';
  password = '';
  errorMessage = '';

  private auth: Auth = inject(Auth);
  private router: Router = inject(Router);
  private authService: AuthService = inject(AuthService);

  ngOnInit() {
    // Check for email link sign-in
    this.authService.completeEmailLinkSignIn().catch((err: any) => {
      this.errorMessage = err.message;
      console.error(err);
    });
  }

  async login() {
    this.errorMessage = '';
    try {
      const userCredential = await signInWithEmailAndPassword(this.auth, this.email, this.password);
      if (userCredential.user) {
        this.router.navigate(['/dashboard']);
      }
    } catch (error: any) {
      this.errorMessage = error.message;
      console.error('Login failed:', error);
    }
  }
}