const EMPLOYEE_ROLES = [
  ["receptionist", "Receptionist"],
  ["reservation_officer", "Reservation Officer"],
  ["housekeeping", "Housekeeping"],
  ["maintenance", "Maintenance"],
  ["manager", "Manager"],
  ["accountant", "Accountant"],
  ["admin", "Administrator"]
];
const CODE_FORMAT = /^[A-Za-z0-9]{3,20}$/;

let administratorId;
let allUsers = [];
let resetTarget = null;

function showAdminMessage(text, type, boxId = "msg") {
  const box = document.getElementById(boxId);
  box.textContent = text;
  box.className = `msg ${type}`;
}

function appendCell(row, value) {
  const td = document.createElement("td");
  td.textContent = value || "—";
  row.appendChild(td);
  return td;
}

function messageRow(body, text, columns = 7) {
  const row = document.createElement("tr");
  const cell = document.createElement("td");
  cell.colSpan = columns;
  cell.textContent = text;
  row.appendChild(cell);
  body.appendChild(row);
}

function randomInt(max) {
  const limit = Math.floor(0x100000000 / max) * max;
  const buffer = new Uint32Array(1);
  do { crypto.getRandomValues(buffer); } while (buffer[0] >= limit);
  return buffer[0] % max;
}

// 14 characters, always at least 3 uppercase letters and 3 digits; no look-alike characters.
function generateTemporaryPassword() {
  const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const lower = "abcdefghijkmnopqrstuvwxyz";
  const digits = "23456789";
  const pick = (set) => set[randomInt(set.length)];
  const chars = [];
  for (let i = 0; i < 3; i += 1) chars.push(pick(upper), pick(digits));
  while (chars.length < 14) chars.push(pick(upper + lower + digits));
  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

async function functionFailure(functionError, result, fallback) {
  let message = result?.error || functionError?.message || fallback;
  if (functionError?.context && typeof functionError.context.json === "function") {
    try {
      const response = await functionError.context.json();
      message = response.error || message;
    } catch {
      message = functionError.message || message;
    }
  }
  return message;
}

function drawSummary() {
  const box = document.getElementById("summary");
  box.replaceChildren();
  const active = allUsers.filter((u) => u.active).length;
  const admins = allUsers.filter((u) => u.active && u.roles?.name === "admin").length;
  [
    ["Employees", allUsers.length],
    ["Active", active],
    ["Deactivated", allUsers.length - active],
    ["Administrators", admins]
  ].forEach(([label, value]) => {
    const card = document.createElement("div");
    card.className = "stat-card";
    const title = document.createElement("span");
    title.textContent = label;
    const metric = document.createElement("strong");
    metric.textContent = String(value);
    card.append(title, metric);
    box.appendChild(card);
  });
}

/* ------------------------------------------------------------ password reset */
function openReset(target) {
  resetTarget = target;
  const panel = document.getElementById("resetPanel");
  document.getElementById("resetTitle").textContent = `Set a temporary password for ${target.name}${target.code ? ` (${target.code})` : ""}`;
  document.getElementById("resetPassword").value = generateTemporaryPassword();
  document.getElementById("resetSaveBtn").disabled = false;
  showAdminMessage("", "", "resetMsg");
  panel.hidden = false;
  panel.scrollIntoView({ behavior: "smooth", block: "start" });
}

function closeReset() {
  resetTarget = null;
  document.getElementById("resetPanel").hidden = true;
  document.getElementById("resetPassword").value = "";
  showAdminMessage("", "", "resetMsg");
}

function showResetDone(target, password, warning) {
  const box = document.getElementById("resetMsg");
  box.replaceChildren();
  box.className = "msg success";
  const line = document.createElement("span");
  line.append(`Password set for ${target.name}. Give them this temporary password: `);
  const code = document.createElement("code");
  code.textContent = password;
  line.append(code, ". They will choose their own password when they next sign in.");
  box.appendChild(line);
  if (warning) {
    const note = document.createElement("div");
    note.textContent = warning;
    box.appendChild(note);
  }
}

async function saveReset() {
  if (!resetTarget) return;
  const password = document.getElementById("resetPassword").value;
  if (!isValidPassword(password)) {
    showAdminMessage("Use a temporary password with 12–128 characters, at least one uppercase letter, and one number.", "error", "resetMsg");
    return;
  }
  const button = document.getElementById("resetSaveBtn");
  button.disabled = true;
  const target = resetTarget;
  const { data: result, error: functionError } = await sb.functions.invoke("admin-reset-password", {
    body: { user_id: target.id, password }
  });
  if (functionError || result?.error) {
    showAdminMessage(await functionFailure(functionError, result, "The password could not be reset."), "error", "resetMsg");
    button.disabled = false;
    return;
  }
  showResetDone(target, password, result?.warning);
  await Promise.all([loadUsers(), loadRequests()]);
}

/* --------------------------------------------------------------- directory */
function drawUsers() {
  const body = document.getElementById("userRows");
  body.replaceChildren();
  const term = document.getElementById("userSearch").value.trim().toLowerCase();
  const roleFilter = document.getElementById("roleFilter").value;
  const statusFilter = document.getElementById("statusFilter").value;

  const users = allUsers.filter((u) =>
    (roleFilter === "all" || u.roles?.name === roleFilter)
    && (statusFilter === "all" || (statusFilter === "active" ? u.active : !u.active))
    && (!term || [u.full_name, u.employee_code, u.email, u.position].some((v) => String(v || "").toLowerCase().includes(term)))
  );
  if (!users.length) {
    messageRow(body, allUsers.length ? "No employees match your filters." : "No employee accounts have been created.");
    return;
  }

  users.forEach((user) => {
    const row = document.createElement("tr");
    appendCell(row, user.full_name);
    // Older accounts that were created with a real email still show that email.
    appendCell(row, user.employee_code || user.email);
    appendCell(row, user.phone);

    const roleCell = document.createElement("td");
    const select = document.createElement("select");
    EMPLOYEE_ROLES.forEach(([value, label]) => select.appendChild(new Option(label, value, false, value === user.roles?.name)));
    if (user.id === administratorId || !user.active) select.disabled = true;
    select.addEventListener("change", async () => {
      select.disabled = true;
      const { error } = await sb.rpc("admin_set_employee_role", { p_user_id: user.id, p_role: select.value });
      if (error) {
        showAdminMessage(`Unable to update the employee role: ${error.message}`, "error");
      } else {
        showAdminMessage("Employee role updated.", "success");
      }
      await loadUsers();
    });
    roleCell.appendChild(select);
    row.appendChild(roleCell);

    appendCell(row, user.position);
    appendCell(row, `${user.active ? "Active" : "Deactivated"}${user.must_change_password ? " · must set new password" : ""}`);

    const actionCell = document.createElement("td");
    const statusButton = document.createElement("button");
    statusButton.className = "button button-outline button-small";
    statusButton.type = "button";
    statusButton.textContent = user.active ? "Deactivate" : "Reactivate";
    statusButton.disabled = user.id === administratorId;
    statusButton.addEventListener("click", async () => {
      if (user.active && !window.confirm(`Deactivate ${user.full_name || user.employee_code}? They will lose access on their next request.`)) return;
      statusButton.disabled = true;
      const nextState = !user.active;
      const { error } = await sb.rpc("admin_set_employee_active", { p_user_id: user.id, p_active: nextState });
      if (error) {
        showAdminMessage(`Unable to update account status: ${error.message}`, "error");
        statusButton.disabled = false;
        return;
      }
      showAdminMessage(nextState ? "Employee account reactivated." : "Employee account deactivated.", "success");
      await loadUsers();
    });

    const resetButton = document.createElement("button");
    resetButton.className = "button button-outline button-small";
    resetButton.type = "button";
    resetButton.textContent = "Reset password";
    resetButton.disabled = !user.active || user.id === administratorId;
    resetButton.addEventListener("click", () => {
      openReset({ id: user.id, name: user.full_name || user.employee_code || user.email, code: user.employee_code });
    });

    actionCell.append(statusButton, resetButton);
    row.appendChild(actionCell);
    body.appendChild(row);
  });
}

async function loadUsers() {
  const body = document.getElementById("userRows");
  const { data, error } = await sb
    .from("profiles")
    .select("id,full_name,email,employee_code,phone,position,active,must_change_password,roles!inner(name)")
    .neq("roles.name", "guest")
    .order("created_at", { ascending: true });
  if (error) {
    body.replaceChildren();
    messageRow(body, `Unable to load employee accounts: ${error.message}`);
    return;
  }
  allUsers = data || [];
  drawSummary();
  drawUsers();
}

/* ------------------------------------------------------------ reset requests */
async function loadRequests() {
  const body = document.getElementById("requestRows");
  body.replaceChildren();
  const { data, error } = await sb
    .from("password_reset_requests")
    .select("id,requested_at,profile_id,profile:profiles!profile_id(full_name,employee_code,email,position)")
    .eq("status", "pending")
    .order("requested_at", { ascending: true });
  if (error) {
    messageRow(body, `Unable to load reset requests: ${error.message}. Apply 019_employee_codes.sql first.`, 5);
    return;
  }
  if (!data.length) {
    messageRow(body, "No one is waiting for a password reset.", 5);
    return;
  }
  data.forEach((request) => {
    const person = request.profile || {};
    const name = person.full_name || person.employee_code || person.email;
    const row = document.createElement("tr");
    appendCell(row, person.full_name);
    appendCell(row, person.employee_code || person.email);
    appendCell(row, person.position);
    appendCell(row, new Date(request.requested_at).toLocaleString());

    const actions = document.createElement("td");
    const setButton = document.createElement("button");
    setButton.type = "button";
    setButton.className = "button button-primary button-small";
    setButton.textContent = "Set new password";
    setButton.addEventListener("click", () => openReset({ id: request.profile_id, name, code: person.employee_code }));
    const dismissButton = document.createElement("button");
    dismissButton.type = "button";
    dismissButton.className = "button button-outline button-small";
    dismissButton.textContent = "Dismiss";
    dismissButton.addEventListener("click", async () => {
      dismissButton.disabled = true;
      const { error: dismissError } = await sb
        .from("password_reset_requests")
        .update({ status: "dismissed", resolved_at: new Date().toISOString(), resolved_by: administratorId })
        .eq("id", request.id)
        .eq("status", "pending");
      if (dismissError) {
        showAdminMessage(`Unable to dismiss the request: ${dismissError.message}`, "error");
        dismissButton.disabled = false;
        return;
      }
      await loadRequests();
    });
    actions.append(setButton, dismissButton);
    row.appendChild(actions);
    body.appendChild(row);
  });
}

/* --------------------------------------------------------------------- init */
async function initAdminUsers() {
  const { data, error } = await sb.auth.getSession();
  if (error || !data.session) {
    if (error) showAdminMessage(`Unable to verify your sign-in: ${error.message}`, "error");
    window.location.href = "index.html";
    return;
  }
  administratorId = data.session.user.id;

  const { data: profile, error: profileError } = await sb
    .from("profiles")
    .select("active,roles(name)")
    .eq("id", administratorId)
    .single();
  if (profileError || !profile?.active || profile.roles?.name !== "admin") {
    window.location.href = "dashboard.html";
    return;
  }

  const roleSelect = document.getElementById("role");
  const roleFilter = document.getElementById("roleFilter");
  EMPLOYEE_ROLES.forEach(([value, label]) => {
    roleSelect.appendChild(new Option(label, value));
    roleFilter.appendChild(new Option(label, value));
  });
  ["userSearch", "roleFilter", "statusFilter"].forEach((id) => {
    document.getElementById(id).addEventListener(id === "userSearch" ? "input" : "change", drawUsers);
  });
  document.getElementById("logoutBtn").addEventListener("click", async () => {
    await recordAuthEvent("logout");
    await sb.auth.signOut();
    window.location.href = "home.html";
  });
  document.getElementById("generateBtn").addEventListener("click", () => {
    document.getElementById("password").value = generateTemporaryPassword();
  });
  document.getElementById("resetGenerateBtn").addEventListener("click", () => {
    document.getElementById("resetPassword").value = generateTemporaryPassword();
  });
  document.getElementById("resetSaveBtn").addEventListener("click", saveReset);
  document.getElementById("resetCancelBtn").addEventListener("click", closeReset);
  await Promise.all([loadUsers(), loadRequests()]);

  document.getElementById("empForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = document.getElementById("createBtn");
    const employeeCode = document.getElementById("employeeCode").value.trim().toUpperCase();
    const fullName = document.getElementById("fullName").value.trim();
    const password = document.getElementById("password").value;
    const role = roleSelect.value;
    const position = document.getElementById("position").value.trim();
    const phone = document.getElementById("phone").value.trim();
    if (!CODE_FORMAT.test(employeeCode)) {
      showAdminMessage("The employee code must be 3 to 20 letters and numbers, with no spaces or symbols.", "error", "createMsg");
      return;
    }
    if (!isValidPassword(password)) {
      showAdminMessage("Use a temporary password with 12–128 characters, at least one uppercase letter, and one number.", "error", "createMsg");
      return;
    }

    button.disabled = true;
    button.textContent = "Creating…";
    const { data: result, error: functionError } = await sb.functions.invoke("create-employee", {
      body: { employee_code: employeeCode, full_name: fullName, password, role, position, phone }
    });
    button.disabled = false;
    button.textContent = "Create account";
    if (functionError || result?.error) {
      showAdminMessage(await functionFailure(functionError, result, "Employee account could not be created."), "error", "createMsg");
      return;
    }

    showAdminMessage(
      `Account created. Employee code: ${result.employee_code}. Temporary password: ${password}. Give both to ${fullName}; they will choose their own password the first time they sign in.`,
      "success",
      "createMsg"
    );
    document.getElementById("empForm").reset();
    await loadUsers();
  });
}

initAdminUsers();