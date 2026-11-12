function showAuthMessage(text, type) {
  const box = document.getElementById("msg");
  box.textContent = text;
  box.className = `msg ${type}`;
}

function postAuthDestination() {
  return new URLSearchParams(window.location.search).get("next") === "book.html" ? "book.html" : "";
}

// Guests go to the guest dashboard, the administrator to the administration page, and every
// other staff role to the staff dashboard.
// If the role can't be read, fall back to the guest page (least privilege).
async function roleHome() {
  const { data, error } = await sb.rpc("current_role");
  if (error || !data || data === "guest") return "guest-dashboard.html";
  return data === "admin" ? "admin.html" : "dashboard.html";
}

async function afterAuthDestination() {
  return postAuthDestination() || await roleHome();
}

// Staff sign in with an employee code. Supabase needs an email-shaped login, so the code is
// turned into an internal address that never receives mail.
// This value MUST match STAFF_EMAIL_DOMAIN in supabase/functions/create-employee/index.ts.
const STAFF_EMAIL_DOMAIN = "staff.harborpine.example";
const EMPLOYEE_CODE_PATTERN = /^[A-Za-z0-9]{3,20}$/;

// One sign-in box for everyone: an entry with "@" is an email (guests and older accounts),
// anything else is an employee code.
function loginEmailFor(value) {
  const entry = String(value || "").trim().toLowerCase();
  if (entry.includes("@")) return entry;
  return EMPLOYEE_CODE_PATTERN.test(entry) ? `${entry}@${STAFF_EMAIL_DOMAIN}` : null;
}

// True while an administrator-issued temporary password has not been replaced yet.
async function mustChangePassword() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) return false;
  const { data, error } = await sb
    .from("profiles")
    .select("must_change_password")
    .eq("id", session.user.id)
    .single();
  return !error && data?.must_change_password === true;
}

async function initLogin() {
  // Back/forward cache: re-run this page so a logged-in user is redirected.
  window.addEventListener("pageshow", (event) => {
    if (event.persisted) window.location.reload();
  });
  const signupLink = document.getElementById("signupLink");
  if (signupLink && postAuthDestination() === "book.html") {
    signupLink.href = "signup.html?next=book.html";
  }
  const loginForm = document.getElementById("loginForm");
  const loginId = document.getElementById("email");
  const forgotLink = document.getElementById("forgotPasswordLink");
  const recoveryPanel = document.getElementById("recoveryPanel");
  const recoveryEmail = document.getElementById("recoveryEmail");
  const recoveryCodeForm = document.getElementById("recoveryCodeForm");
  const recoveryCode = document.getElementById("recoveryCode");
  const recoveryPassword = document.getElementById("recoveryPassword");
  const recoveryConfirmation = document.getElementById("recoveryConfirmation");
  const recoveryCodeFields = document.getElementById("recoveryCodeFields");
  const loginSignupSwitch = document.getElementById("loginSignupSwitch");
  const changePanel = document.getElementById("changePasswordPanel");
  const changeForm = document.getElementById("changePasswordForm");
  const newPassword = document.getElementById("newPassword");
  const confirmNewPassword = document.getElementById("confirmNewPassword");
  const message = document.getElementById("msg");

  let signedInPassword = ""; // remembered only to refuse "new password = temporary password"

  function clearMessage() {
    message.textContent = "";
    message.className = "msg";
  }

  function showOnly(section) {
    loginForm.hidden = section !== "login";
    loginSignupSwitch.hidden = section !== "login";
    recoveryPanel.hidden = section !== "recovery";
    changePanel.hidden = section !== "change";
    clearMessage();
  }

  function showChangePassword() {
    showOnly("change");
    showAuthMessage("Your administrator gave you a temporary password. Choose your own to continue.", "success");
    newPassword.focus();
  }

  forgotLink.addEventListener("click", (event) => {
    event.preventDefault();
    recoveryEmail.value = loginId.value.trim();
    recoveryCodeFields.hidden = true;
    showOnly("recovery");
  });

  document.getElementById("backToLoginLink").addEventListener("click", (event) => {
    event.preventDefault();
    recoveryCodeFields.hidden = true;
    showOnly("login");
  });

  document.getElementById("changeCancelLink").addEventListener("click", async (event) => {
    event.preventDefault();
    await recordAuthEvent("logout");
    await sb.auth.signOut();
    window.location.replace("index.html");
  });

  // ---- forgot password ----
  // An email gets a recovery code by email. An employee code sends a request to the administrator.
  document.getElementById("requestRecoveryCodeBtn").addEventListener("click", async () => {
    const entry = recoveryEmail.value.trim();
    if (!entry) {
      showAuthMessage("Enter your email or your employee code.", "error");
      return;
    }
    const button = document.getElementById("requestRecoveryCodeBtn");

    if (!entry.includes("@")) {
      if (!EMPLOYEE_CODE_PATTERN.test(entry)) {
        showAuthMessage("Enter your email, or your employee code (letters and numbers only).", "error");
        return;
      }
      button.disabled = true;
      button.textContent = "Sending request…";
      try {
        const { error: requestError } = await sb.rpc("request_staff_password_reset", { p_code: entry });
        if (requestError) {
          showAuthMessage(`Unable to send the request: ${requestError.message}`, "error");
          return;
        }
        recoveryCodeFields.hidden = true;
        // Same answer whether or not the code exists, so codes cannot be guessed from this page.
        showAuthMessage("If that employee code exists, your administrator has been notified. Ask them for a new temporary password; you will choose your own when you sign in.", "success");
      } catch (requestError) {
        const detail = requestError instanceof Error ? requestError.message : String(requestError);
        showAuthMessage(`Unable to send the request: ${detail}`, "error");
      } finally {
        button.disabled = false;
        button.textContent = "Reset my password";
      }
      return;
    }

    if (!/^\S+@\S+\.\S+$/.test(entry)) {
      showAuthMessage("Enter a valid email address.", "error");
      return;
    }
    button.disabled = true;
    button.textContent = "Sending code…";
    try {
      const { error: recoveryError } = await sb.auth.resetPasswordForEmail(entry);
      if (recoveryError) {
        showAuthMessage(`Unable to send a recovery code: ${recoveryError.message}`, "error");
        return;
      }
      recoveryCodeFields.hidden = false;
      showAuthMessage("If an account exists for that email, a recovery code has been sent.", "success");
      recoveryCode.focus();
    } catch (requestError) {
      const detail = requestError instanceof Error ? requestError.message : String(requestError);
      showAuthMessage(`Unable to send a recovery code: ${detail}`, "error");
    } finally {
      button.disabled = false;
      button.textContent = "Reset my password";
    }
  });

  recoveryCodeForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = document.getElementById("resetPasswordBtn");
    const email = recoveryEmail.value.trim();
    const password = recoveryPassword.value;
    if (!isValidPassword(password)) {
      showAuthMessage("Use 12–128 characters with at least one uppercase letter and one number.", "error");
      return;
    }
    if (password !== recoveryConfirmation.value) {
      showAuthMessage("Passwords do not match.", "error");
      return;
    }

    button.disabled = true;
    button.textContent = "Verifying code…";
    try {
      const { error: verifyError } = await sb.auth.verifyOtp({
        email,
        token: recoveryCode.value.trim(),
        type: "recovery"
      });
      if (verifyError) {
        showAuthMessage("That recovery code is invalid or expired. Request a new code and try again.", "error");
        return;
      }

      button.textContent = "Updating password…";
      const { error: updateError } = await sb.auth.updateUser({ password });
      if (updateError) {
        showAuthMessage(`Unable to update your password: ${updateError.message}`, "error");
        return;
      }

      const { error: signOutError } = await sb.auth.signOut();
      recoveryCodeForm.reset();
      recoveryCodeFields.hidden = true;
      showOnly("login");
      loginId.value = email;
      document.getElementById("password").value = "";
      if (signOutError) {
        showAuthMessage(`Password updated, but sign-out failed: ${signOutError.message}. Please close this page before signing in again.`, "error");
        return;
      }
      showAuthMessage("Password updated. Sign in with your new password.", "success");
    } catch (recoveryError) {
      const detail = recoveryError instanceof Error ? recoveryError.message : String(recoveryError);
      showAuthMessage(`Unable to complete password recovery: ${detail}`, "error");
    } finally {
      button.disabled = false;
      button.textContent = "Reset password";
    }
  });

  // ---- sign in (email or employee code, one form for everyone) ----
  loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = document.getElementById("loginBtn");
    const entry = loginId.value.trim();
    const password = document.getElementById("password").value;

    const email = loginEmailFor(entry);
    if (!email) {
      showAuthMessage("Enter your email, or your employee code (letters and numbers only).", "error");
      return;
    }

    button.disabled = true;
    button.textContent = "Signing in…";
    const { error: signInError } = await sb.auth.signInWithPassword({ email, password });

    if (signInError) {
      showAuthMessage("Sign-in failed. Check your details or try again later.", "error");
      button.disabled = false;
      button.textContent = "Sign in";
      return;
    }
    await recordAuthEvent("login");
    if (await mustChangePassword()) {
      signedInPassword = password;
      button.disabled = false;
      button.textContent = "Sign in";
      showChangePassword();
      return;
    }
    window.location.replace(await afterAuthDestination());
  });

  // ---- first sign-in: choose your own password ----
  changeForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const password = newPassword.value;
    if (!isValidPassword(password)) {
      showAuthMessage("Use 12–128 characters with at least one uppercase letter and one number.", "error");
      return;
    }
    if (password !== confirmNewPassword.value) {
      showAuthMessage("Passwords do not match.", "error");
      return;
    }
    if (signedInPassword && password === signedInPassword) {
      showAuthMessage("Choose a password that is different from the temporary one.", "error");
      return;
    }
    const button = document.getElementById("changePasswordBtn");
    button.disabled = true;
    button.textContent = "Saving…";
    try {
      const { error: updateError } = await sb.auth.updateUser({ password });
      if (updateError) {
        showAuthMessage(`Unable to update your password: ${updateError.message}`, "error");
        return;
      }
      const { error: flagError } = await sb.rpc("complete_password_change");
      if (flagError) {
        showAuthMessage(`Your password was changed, but the account could not be unlocked: ${flagError.message}`, "error");
        return;
      }
      await recordAuthEvent("password_change");
      window.location.replace(await afterAuthDestination());
    } catch (changeError) {
      const detail = changeError instanceof Error ? changeError.message : String(changeError);
      showAuthMessage(`Unable to update your password: ${detail}`, "error");
    } finally {
      button.disabled = false;
      button.textContent = "Save password and continue";
    }
  });

  // ---- already signed in? ----
  const { data, error } = await sb.auth.getSession();
  if (error) {
    showAuthMessage(`Unable to check your session: ${error.message}`, "error");
    return;
  }
  if (data.session) {
    if (await mustChangePassword()) {
      showChangePassword();
      return;
    }
    window.location.replace(await afterAuthDestination());
  }
}

function initSignup() {
  // A logged-in user has no business on the signup page: send them to their dashboard.
  window.addEventListener("pageshow", (event) => {
    if (event.persisted) window.location.reload();
  });
  sb.auth.getSession().then(async ({ data }) => {
    if (data.session) window.location.replace(await afterAuthDestination());
  });
  const loginLink = document.getElementById("loginLink");
  if (loginLink && postAuthDestination() === "book.html") {
    loginLink.href = "index.html?next=book.html";
  }
  document.getElementById("signupForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = document.getElementById("signupBtn");
    const fullName = document.getElementById("fullName").value.trim();
    const phone = document.getElementById("phone").value.trim();
    const email = document.getElementById("email").value.trim();
    const password = document.getElementById("password").value;
    const confirmation = document.getElementById("confirm").value;

    if (password !== confirmation) {
      showAuthMessage("Passwords do not match.", "error");
      return;
    }
    if (!isValidPassword(password)) {
      showAuthMessage("Use 12–128 characters with at least one uppercase letter and one number.", "error");
      return;
    }

    button.disabled = true;
    button.textContent = "Creating account…";
    const { data, error } = await sb.auth.signUp({
      email,
      password,
      options: { data: { full_name: fullName, phone } }
    });
    button.disabled = false;
    button.textContent = "Create account";

    if (error) {
      showAuthMessage(error.message, "error");
      return;
    }
    if (data.session) {
      await recordAuthEvent("login");
      window.location.replace(await afterAuthDestination());
      return;
    }
    // Email confirmation is on: ask for the code that was just emailed.
    showSignupOtp(email);
  });
}

// Number of digits in the code from your confirmation email (Supabase default is 6).
// If your emails contain a longer code, change this number.
const OTP_LENGTH = 6;

// Shows a "type the code from your email" card in place of the signup form.
function showSignupOtp(email) {
  const signupForm = document.getElementById("signupForm");
  const existing = document.getElementById("otpForm");
  if (existing) existing.remove();

  const form = document.createElement("form");
  form.id = "otpForm";
  form.noValidate = true;
  form.innerHTML = `
    <div class="otp-icon">✉️</div>
    <h2>Check your email</h2>
    <p class="otp-sub">We sent a ${OTP_LENGTH}-digit code to <b id="otpEmail"></b>. Enter it below to confirm your account.</p>
    <div class="otp-boxes" id="otpBoxes"></div>
    <button type="submit" class="otp-primary" id="otpBtn">Verify and continue</button>
    <div class="otp-links">
      <button type="button" class="otp-link" id="otpResend">Resend code</button>
      <button type="button" class="otp-link" id="otpBack">Use a different email</button>
    </div>`;
  form.querySelector("#otpEmail").textContent = email;

  const boxesWrap = form.querySelector("#otpBoxes");
  const boxes = [];
  for (let i = 0; i < OTP_LENGTH; i += 1) {
    const box = document.createElement("input");
    box.type = "text";
    box.inputMode = "numeric";
    box.autocomplete = i === 0 ? "one-time-code" : "off";
    box.className = "otp-box";
    box.setAttribute("aria-label", `Digit ${i + 1} of ${OTP_LENGTH}`);
    boxesWrap.appendChild(box);
    boxes.push(box);
  }

  signupForm.hidden = true;
  signupForm.after(form);
  showAuthMessage("Account created. Check your email for the code.", "success");

  const getCode = () => boxes.map((b) => b.value).join("");
  const refreshStyles = () => boxes.forEach((b) => b.classList.toggle("filled", b.value !== ""));
  const clearError = () => boxes.forEach((b) => b.classList.remove("error"));
  const showCodeError = () => {
    boxes.forEach((b) => { b.value = ""; b.classList.remove("filled"); b.classList.add("error"); });
    boxes[0].focus();
  };
  // Put digits into the boxes starting at `start`; returns the index of the next empty box.
  const fillFrom = (start, digits) => {
    let i = start;
    for (const d of digits) {
      if (i >= OTP_LENGTH) break;
      boxes[i].value = d;
      i += 1;
    }
    refreshStyles();
    return i;
  };

  let busy = false;
  const verifyBtn = form.querySelector("#otpBtn");

  async function submitCode() {
    if (busy) return;
    const code = getCode();
    if (code.length < OTP_LENGTH) {
      showAuthMessage(`Enter all ${OTP_LENGTH} digits of the code.`, "error");
      boxes.find((b) => b.value === "")?.focus();
      return;
    }
    busy = true;
    verifyBtn.disabled = true;
    verifyBtn.textContent = "Verifying…";
    const { data, error } = await sb.auth.verifyOtp({ email, token: code, type: "signup" });
    if (error || !data.session) {
      busy = false;
      verifyBtn.disabled = false;
      verifyBtn.textContent = "Verify and continue";
      showCodeError();
      showAuthMessage("That code is invalid or expired. Check it and try again, or resend a new code.", "error");
      return;
    }
    verifyBtn.textContent = "Confirmed. Redirecting…";
    await recordAuthEvent("login");
    window.location.replace(await afterAuthDestination());
  }

  boxes.forEach((box, index) => {
    box.addEventListener("input", () => {
      clearError();
      const digits = box.value.replace(/\D/g, "");
      box.value = "";
      if (!digits) { refreshStyles(); return; }
      // Typing one digit, or autofill/paste of several, both land here.
      const next = fillFrom(index, digits);
      boxes[Math.min(next, OTP_LENGTH - 1)].focus();
      if (getCode().length === OTP_LENGTH) form.requestSubmit();
    });
    box.addEventListener("keydown", (event) => {
      if (event.key === "Backspace" && box.value === "" && index > 0) {
        boxes[index - 1].value = "";
        boxes[index - 1].focus();
        refreshStyles();
        event.preventDefault();
      } else if (event.key === "ArrowLeft" && index > 0) {
        boxes[index - 1].focus();
      } else if (event.key === "ArrowRight" && index < OTP_LENGTH - 1) {
        boxes[index + 1].focus();
      }
    });
    box.addEventListener("focus", () => box.select());
    box.addEventListener("paste", (event) => {
      const digits = (event.clipboardData?.getData("text") || "").replace(/\D/g, "");
      if (!digits) return;
      event.preventDefault();
      clearError();
      const next = fillFrom(0, digits);
      boxes[Math.min(next, OTP_LENGTH - 1)].focus();
      if (getCode().length === OTP_LENGTH) form.requestSubmit();
    });
  });

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    submitCode();
  });

  const resendBtn = form.querySelector("#otpResend");
  let cooldownTimer = null;
  function startCooldown(seconds) {
    let left = seconds;
    resendBtn.disabled = true;
    resendBtn.textContent = `Resend code in ${left}s`;
    clearInterval(cooldownTimer);
    cooldownTimer = setInterval(() => {
      left -= 1;
      if (left <= 0) {
        clearInterval(cooldownTimer);
        resendBtn.disabled = false;
        resendBtn.textContent = "Resend code";
      } else {
        resendBtn.textContent = `Resend code in ${left}s`;
      }
    }, 1000);
  }
  startCooldown(60); // a code was just sent

  resendBtn.addEventListener("click", async () => {
    resendBtn.disabled = true;
    const { error } = await sb.auth.resend({ type: "signup", email });
    if (error) {
      showAuthMessage(`Unable to resend the code: ${error.message}`, "error");
      resendBtn.disabled = false;
      return;
    }
    showAuthMessage("A new code has been sent. Check your email.", "success");
    startCooldown(60);
  });

  form.querySelector("#otpBack").addEventListener("click", () => {
    clearInterval(cooldownTimer);
    form.remove();
    signupForm.hidden = false;
    showAuthMessage("", "");
  });

  boxes[0].focus();
}