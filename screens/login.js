/**
 * screens/login.js
 * Handles both Login/Signup and Account Management.
 */

import { navigate } from '../core/router.js';
import { setSetting } from '../db/settings-store.js';
import { 
  signUpWithEmail, 
  signInWithEmail, 
  signOutUser,
  getCurrentUser 
} from '../core/auth.js';

let currentMode = 'signin';           // 'signin' or 'signup'
let accountTab = 'data';              // 'data' or 'account' (when signed in)
let fromOnboarding = false;

export async function init(params = {}) {
  const app = document.getElementById('app');
  if (!app) return;

  fromOnboarding = !!params.fromOnboarding;

  const user = getCurrentUser();

  if (user && !user.isAnonymous) {
    // User is signed in → show Account Management
    renderAccountScreen(app);
  } else {
    // User is not signed in → show Login/Signup
    renderLoginScreen(app);
  }
}

// =====================================================
// LOGGED OUT STATE (Sign In / Create Account)
// =====================================================
function renderLoginScreen(app) {
  let screen = document.getElementById('screen-login');
  if (!screen) {
    screen = document.createElement('div');
    screen.id = 'screen-login';
    screen.className = 'screen login-screen';
    app.appendChild(screen);
  }

  screen.innerHTML = `
    <div class="login-container">
      <div class="login-header">
        <h1 class="screen-title">ACCOUNT</h1>
        <p class="subtitle">SYNC YOUR PROGRESS ACROSS DEVICES</p>
      </div>

      <div class="login-mode-toggle">
        <button class="seg-option" data-mode="signin">SIGN IN</button>
        <button class="seg-option" data-mode="signup">CREATE ACCOUNT</button>
      </div>

      <div class="login-form">
        <div class="input-group">
          <label>EMAIL</label>
          <input type="email" id="email-input" class="arcade-input" placeholder="you@email.com">
        </div>

        <div class="input-group">
          <label>PASSWORD</label>
          <input type="password" id="password-input" class="arcade-input" placeholder="••••••••">
        </div>

        <!-- Confirm Password only shown in Create Account mode -->
        <div class="input-group" id="confirm-password-group" style="display: none;">
          <label>CONFIRM PASSWORD</label>
          <input type="password" id="confirm-password-input" class="arcade-input" placeholder="••••••••">
        </div>

        <div id="error-message" class="error-message"></div>

        <button id="submit-btn" class="btn btn-primary">SIGN IN</button>
      </div>

      <div class="login-actions">
        <button id="guest-btn" class="btn">${fromOnboarding ? 'RETURN' : 'BACK TO MAIN MENU'}</button>
      </div>
    </div>
  `;

  bindLoginEvents(screen);
  updateLoginModeUI(screen);
}

function bindLoginEvents(screen) {
  screen.querySelectorAll('.seg-option').forEach(btn => {
    btn.addEventListener('click', () => {
      currentMode = btn.dataset.mode;
      updateLoginModeUI(screen);
    });
  });

  const submitBtn = screen.querySelector('#submit-btn');
  submitBtn.addEventListener('click', handleLoginSubmit);

  screen.querySelector('#guest-btn').addEventListener('click', () => {
    if (fromOnboarding) {
      // Return to the onboarding welcome screen instead of main-menu
      // (main-menu would immediately redirect back to onboarding, causing a loading loop)
      navigate('onboarding');
    } else {
      navigate('main-menu');
    }
  });
}

function updateLoginModeUI(screen) {
  const submitBtn = screen.querySelector('#submit-btn');
  const confirmGroup = screen.querySelector('#confirm-password-group');

  screen.querySelectorAll('.seg-option').forEach(btn => {
    btn.classList.toggle('selected', btn.dataset.mode === currentMode);
  });

  if (currentMode === 'signin') {
    submitBtn.textContent = 'SIGN IN';
    if (confirmGroup) confirmGroup.style.display = 'none';
  } else {
    submitBtn.textContent = 'CREATE ACCOUNT';
    if (confirmGroup) confirmGroup.style.display = 'block';
  }
}

async function handleLoginSubmit() {
  const screen = document.getElementById('screen-login');
  const email = screen.querySelector('#email-input').value.trim();
  const password = screen.querySelector('#password-input').value;
  const confirmInput = screen.querySelector('#confirm-password-input');
  const errorEl = screen.querySelector('#error-message');
  const submitBtn = screen.querySelector('#submit-btn');

  errorEl.textContent = '';
  submitBtn.disabled = true;

  if (currentMode === 'signup' && confirmInput) {
    if (password !== confirmInput.value) {
      errorEl.textContent = 'Passwords do not match.';
      submitBtn.disabled = false;
      return;
    }
  }

  submitBtn.textContent = currentMode === 'signin' ? 'SIGNING IN...' : 'CREATING...';

  try {
    if (currentMode === 'signin') {
      await signInWithEmail(email, password);
    } else {
      await signUpWithEmail(email, password);
    }
    await setSetting('hasCompletedOnboarding', true);
    window.location.reload();
  } catch (error) {
    errorEl.textContent = error.message || 'Something went wrong.';
    submitBtn.disabled = false;
    submitBtn.textContent = currentMode === 'signin' ? 'SIGN IN' : 'CREATE ACCOUNT';
  }
}

// =====================================================
// LOGGED IN STATE (Account Management)
// =====================================================
function renderAccountScreen(app) {
  let screen = document.getElementById('screen-login');
  if (!screen) {
    screen = document.createElement('div');
    screen.id = 'screen-login';
    screen.className = 'screen login-screen';
    app.appendChild(screen);
  }

  const user = getCurrentUser();

  screen.innerHTML = `
    <div class="login-container">
      <div class="login-header">
        <h1 class="screen-title">ACCOUNT</h1>
        <p class="subtitle">${user?.email || 'Unknown'}</p>
      </div>

      <!-- Data / Account Toggle -->
      <div class="login-mode-toggle">
        <button class="seg-option" data-tab="data">DATA</button>
        <button class="seg-option" data-tab="account">ACCOUNT</button>
      </div>

      <!-- DATA TAB -->
      <div id="data-tab" class="account-tab" style="display: block;">
        <div style="padding: var(--space-xl); text-align: center; color: var(--color-text-muted);">
          <!-- FUTURE: Analytics and performance stats will go here -->
          <p>No data yet.<br>Analytics coming soon.</p>
        </div>
      </div>

      <!-- ACCOUNT TAB -->
      <div id="account-tab" class="account-tab" style="display: none;">
        <div class="account-section">
          <div class="input-group">
            <label>EMAIL</label>
            <div style="padding: var(--space-md); background: var(--color-surface); border: 2px solid var(--color-text-muted); border-radius: var(--border-radius-sm);">
              ${user?.email || 'Unknown'}
            </div>
          </div>

          <!-- Placeholder buttons -->
          <button class="btn" style="margin-top: var(--space-md);" disabled>
            CHANGE EMAIL
          </button>
          <button class="btn" style="margin-top: var(--space-sm);" disabled>
            CHANGE PASSWORD
          </button>

          <p style="font-size: var(--font-size-sm); color: var(--color-text-muted); margin-top: var(--space-md);">
            <!-- TODO: Implement Change Email and Change Password functionality -->
          </p>
        </div>
      </div>

      <div class="login-actions">
        <button id="signout-btn" class="btn">SIGN OUT</button>
        <button id="back-btn" class="btn">BACK TO MENU</button>
      </div>
    </div>
  `;

  bindAccountEvents(screen);
  updateAccountTab(screen);
}

function bindAccountEvents(screen) {
  // Tab switching
  screen.querySelectorAll('.seg-option').forEach(btn => {
    btn.addEventListener('click', () => {
      accountTab = btn.dataset.tab;
      updateAccountTab(screen);
    });
  });

  // Sign out
  screen.querySelector('#signout-btn').addEventListener('click', async () => {
    await signOutUser();
    navigate('main-menu');
  });

  // Back to menu
  screen.querySelector('#back-btn').addEventListener('click', () => {
    navigate('main-menu');
  });
}

function updateAccountTab(screen) {
  const dataTab = screen.querySelector('#data-tab');
  const accountTabEl = screen.querySelector('#account-tab');

  screen.querySelectorAll('.seg-option').forEach(btn => {
    btn.classList.toggle('selected', btn.dataset.tab === accountTab);
  });

  if (accountTab === 'data') {
    dataTab.style.display = 'block';
    accountTabEl.style.display = 'none';
  } else {
    dataTab.style.display = 'none';
    accountTabEl.style.display = 'block';
  }
}
