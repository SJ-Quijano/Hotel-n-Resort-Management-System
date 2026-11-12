/* role-guard.js
*/
const RoleGuard = (() => {
  const LOGIN_PAGE = "index.html";
  const STAFF_HOME = "dashboard.html";
  const ADMIN_HOME = "admin.html";
  const GUEST_HOME = "guest-dashboard.html";

  async function getRole() {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) return null;
    const { data, error } = await sb.rpc("current_role");
    if (error || !data) return "guest"; // least privilege if the role can't be read
    return data;
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

  // Each kind of account has its own home page.
  function homeFor(role) {
    if (role === "guest") return GUEST_HOME;
    return role === "admin" ? ADMIN_HOME : STAFF_HOME;
  }

  function onLoginPage() {
    return /(?:^|\/)(?:index\.html)?$/.test(window.location.pathname);
  }

  async function redirectByRole() {
    const role = await getRole();
    window.location.replace(role ? homeFor(role) : LOGIN_PAGE);
  }

  // Browsers can restore a page from their back/forward cache without running scripts,
  // so a dashboard could reappear after logout. Reloading re-runs the check.
  function reloadWhenRestoredFromCache() {
    window.addEventListener("pageshow", (event) => {
      if (event.persisted) window.location.reload();
    });
  }

  // For public pages: logged-in users are sent to their own dashboard.
  async function redirectIfLoggedIn() {
    const check = async () => {
      document.documentElement.style.visibility = "hidden";
      try {
        const role = await getRole();
        if (role) {
          if (role !== "guest" && await mustChangePassword()) {
            // Must choose a new password first: the sign-in page shows that form.
            if (!onLoginPage()) {
              window.location.replace(LOGIN_PAGE);
              return;
            }
          } else {
            window.location.replace(homeFor(role));
            return;
          }
        }
      } catch (err) {
        console.error("Role check failed:", err);
      }
      document.documentElement.style.visibility = "visible";
    };
    window.addEventListener("pageshow", (event) => {
      if (event.persisted) check();
    });
    await check();
  }

  // kind: "guest" or "staff". allowedRoles (optional) narrows it to specific roles.
  // Anyone who is not allowed on the page is sent to their own home page.
  async function require(kind, allowedRoles) {
    reloadWhenRestoredFromCache();
    document.documentElement.style.visibility = "hidden";
    try {
      const role = await getRole();
      if (!role) {
        window.location.replace(LOGIN_PAGE);
        return false;
      }
      const isGuest = role === "guest";
      if (!isGuest && await mustChangePassword()) {
        window.location.replace(LOGIN_PAGE);
        return false;
      }
      let allowed = kind === "guest" ? isGuest : !isGuest;
      if (allowed && Array.isArray(allowedRoles)) allowed = allowedRoles.includes(role);
      if (!allowed) {
        window.location.replace(homeFor(role));
        return false;
      }
      document.documentElement.style.visibility = "visible";
      return true;
    } catch (err) {
      console.error("Role check failed:", err);
      window.location.replace(LOGIN_PAGE);
      return false;
    }
  }

  return { getRole, mustChangePassword, redirectByRole, redirectIfLoggedIn, require };
})();