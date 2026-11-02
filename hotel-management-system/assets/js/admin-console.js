/* admin-console.js
   System-administrator workspace. Load AFTER role-guard.js and BEFORE dashboard.js:
     config.js -> role-guard.js -> admin-console.js -> dashboard.js
   Uses helpers defined in dashboard.js (setContentTitle, addPanel, makeForm, makeTable, ...),
   which are resolved when the functions run, not when this file loads. */

const ADMIN_MODULES = [
  "Role Permissions", "System Settings", "Room Categories",
  "Activity Logs", "Login History", "Security Logs", "Database & Backups", "System Reports"
];
const PROTECTED_ADMIN_MODULES = ["User Management", "Role Permissions", "System Settings"];
const ADMIN_MENU = [
  "## Administration", "User Management", "Role Permissions", "System Settings", "Room Categories",
  "## Monitoring", "Activity Logs", "Login History", "Security Logs", "Database & Backups", "System Reports",
  "## Hotel operations", "Rooms & Cottages", "Reservations", "Check-in", "Check-out", "Room Assignment",
  "Customers / Guests", "Housekeeping", "Maintenance Requests", "Billing", "Payments & Transactions",
  "Discounts", "Facilities & Amenities", "Feedback & Reviews"
];
const SECURITY_FILTER = "and(table_name.eq.profiles,action.eq.UPDATE),table_name.in.(role_modules,system_settings,admin_action,password_reset_requests),and(table_name.eq.auth,action.eq.password_change)";
const BACKUP_TABLES = [
  ["roles", "id"], ["profiles", "id"], ["guests", "id"], ["room_types", "id"], ["rooms", "id"],
  ["reservations", "id"], ["services", "id"], ["invoices", "id"], ["payments", "id"],
  ["service_usage", "id"], ["housekeeping_tasks", "id"], ["maintenance_requests", "id"],
  ["discounts", "id"], ["feedback", "id"], ["audit_logs", "id"],
  ["system_settings", "key"], ["role_modules", "module"]
];
const SETTING_DEFS = [
  ["hotel_name", "Hotel name", "text"],
  ["support_email", "Support email", "email"],
  ["default_check_in_time", "Default check-in time", "time"],
  ["default_check_out_time", "Default check-out time", "time"],
  ["online_booking_enabled", "Online booking", "select"]
];

/* ------------------------------------------------------------ shared helpers */
function adminWhen(value) {
  return value ? new Date(value).toLocaleString() : "—";
}

function adminDayKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

async function adminRows(query, label) {
  const { data, error } = await query;
  if (error) throw new Error(`${label}: ${error.message}`);
  return data || [];
}

async function adminNameMap(ids) {
  const map = new Map();
  const list = [...new Set(ids.filter(Boolean))];
  if (!list.length) return map;
  const { data } = await sb.from("profiles").select("id,full_name,email").in("id", list);
  (data || []).forEach((person) => map.set(person.id, person.full_name || person.email));
  return map;
}

function defaultRoleMenus() {
  if (!window.__defaultRoleMenus) window.__defaultRoleMenus = JSON.parse(JSON.stringify(ROLE_MENUS));
  return window.__defaultRoleMenus;
}

/* Applies the module toggles saved under Role Permissions to the menu of the signed-in role. */
async function applyRoleModuleOverrides(role) {
  const defaults = defaultRoleMenus();
  ROLE_MENUS[role] = [...(defaults[role] || [])];
  try {
    const { data, error } = await sb.from("role_modules").select("module,enabled").eq("role_name", role);
    if (error || !data?.length) return;
    const off = new Set(data.filter((item) => !item.enabled).map((item) => item.module));
    if (role === "admin") PROTECTED_ADMIN_MODULES.forEach((module) => off.delete(module));
    const kept = ROLE_MENUS[role].filter((item) => item.startsWith("## ") || !off.has(item));
    ROLE_MENUS[role] = kept.filter((item, index) => !item.startsWith("## ") || (kept[index + 1] && !kept[index + 1].startsWith("## ")));
  } catch (error) {
    console.error("Unable to load role module settings:", error);
  }
}

function describeChange(record, roleNames) {
  const before = record.old_data || {};
  const after = record.new_data || record.old_data || {};
  if (record.table_name === "profiles" && record.action === "UPDATE") {
    const parts = [];
    if (before.role_id !== after.role_id) parts.push(`Role: ${roleNames.get(before.role_id) || before.role_id} → ${roleNames.get(after.role_id) || after.role_id}`);
    if (before.active !== after.active) parts.push(after.active ? "Account reactivated" : "Account deactivated");
    ["full_name", "position", "phone"].forEach((key) => { if (before[key] !== after[key]) parts.push(`${humanize(key)} changed`); });
    return parts.join("; ") || "Profile updated";
  }
  if (record.table_name === "role_modules") return `${humanize(after.role_name)} · ${after.module}: ${after.enabled ? "enabled" : "disabled"}`;
  if (record.table_name === "system_settings") return `${humanize(after.key)}: ${record.old_data ? `${before.value || "—"} → ` : ""}${after.value || "—"}`;
  if (record.table_name === "password_reset_requests") return `Password reset request: ${after.status || "updated"}`;
  if (record.table_name === "admin_action") return humanize(record.action);
  return "";
}

/* ------------------------------------------------------------------ overview */
async function renderAdminConsoleOverview() {
  const warnings = [];
  const safe = async (label, work, fallback) => {
    try { return await work; } catch (error) { warnings.push(`${label}: ${error.message}`); return fallback; }
  };
  const rows = (label, query) => safe(label, adminRows(query, label), []);
  const count = (label, table, filter, selection) => safe(label, countRecords(table, filter, selection), 0);
  const startedAt = performance.now();

  const [
    employees, activeEmployees, admins, guests, rooms, reservations, arrivals,
    logins, security, backups, roles, dbStatus, resetRequests
  ] = await Promise.all([
    count("employees", "profiles", (q) => q.neq("roles.name", "guest"), "id,roles!inner(name)"),
    count("active employees", "profiles", (q) => q.neq("roles.name", "guest").eq("active", true), "id,roles!inner(name)"),
    count("administrators", "profiles", (q) => q.eq("roles.name", "admin").eq("active", true), "id,roles!inner(name)"),
    count("guests", "guests"),
    count("rooms", "rooms"),
    count("reservations", "reservations"),
    count("arrivals", "reservations", (q) => q.eq("check_in", todayLocal()).in("status", ["reserved", "checked_in"])),
    rows("login history", sb.from("audit_logs").select("actor_id,action,created_at")
      .eq("table_name", "auth").order("id", { ascending: false }).limit(8)),
    rows("security events", sb.from("audit_logs").select("actor_id,action,table_name,record_id,old_data,new_data,created_at")
      .or(SECURITY_FILTER).order("id", { ascending: false }).limit(8)),
    rows("last backup", sb.from("audit_logs").select("created_at,record_id")
      .eq("table_name", "admin_action").eq("action", "backup_export").order("id", { ascending: false }).limit(1)),
    rows("roles", sb.from("roles").select("id,name")),
    safe("database status", sb.rpc("admin_database_status").then(({ data, error }) => {
      if (error) throw new Error(error.message);
      return data;
    }), null),
    count("password reset requests", "password_reset_requests", (q) => q.eq("status", "pending"))
  ]);
  const latency = Math.round(performance.now() - startedAt);
  const roleNames = new Map(roles.map((role) => [role.id, humanize(role.name)]));
  const names = await adminNameMap([...logins, ...security].map((item) => item.actor_id));
  const who = (id) => (id ? names.get(id) || "Unknown user" : "System");

  const { content, panel } = setContentTitle("System administration", "Technical overview of accounts, access, and system health.");

  if (warnings.length) {
    const warn = addPanel(content, "Some data could not be loaded", "Usually a database change that has not been applied yet (run 016, 017 and 018).");
    const list = document.createElement("ul");
    warnings.forEach((text) => { const li = document.createElement("li"); li.textContent = text; list.appendChild(li); });
    warn.appendChild(list);
  }

  const links = document.createElement("div");
  links.className = "toolbar";
  [
    ["Create employee", () => { window.location.href = "admin-users.html"; }],
    ["Role permissions", () => renderModule("Role Permissions")],
    ["System settings", () => renderModule("System Settings")],
    ["Back up data", () => renderModule("Database & Backups")]
  ].forEach(([label, handler]) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "button button-outline button-small";
    button.textContent = label;
    button.addEventListener("click", handler);
    links.appendChild(button);
  });
  panel.appendChild(links);

  const issues = [];
  const lastBackup = backups[0];
  if (resetRequests > 0) issues.push(`${resetRequests} employee${resetRequests === 1 ? " is" : "s are"} waiting for a password reset. Open User Management to set a new temporary password.`);
  if (!lastBackup) issues.push("No data backup has been exported yet.");
  else {
    const days = Math.floor((Date.now() - new Date(lastBackup.created_at)) / 86400000);
    if (days >= 7) issues.push(`The last data backup was ${days} days ago.`);
  }
  if (admins < 2) issues.push("Only one active administrator account exists. Create a second one to avoid being locked out.");
  if (!dbStatus) issues.push("Database status could not be read.");
  const attention = addPanel(content, "System checks", issues.length ? "These need attention." : "No outstanding system issues.");
  if (issues.length) {
    const list = document.createElement("ul");
    issues.forEach((text) => { const li = document.createElement("li"); li.textContent = text; list.appendChild(li); });
    attention.appendChild(list);
  }

  const health = addPanel(content, "System health");
  const healthStats = document.createElement("div");
  healthStats.className = "stat-grid";
  addOverviewStat(healthStats, "Employee accounts", employees, `${activeEmployees} active · ${employees - activeEmployees} deactivated`);
  addOverviewStat(healthStats, "Active administrators", admins);
  addOverviewStat(healthStats, "Database size", dbStatus?.database_size || "—");
  addOverviewStat(healthStats, "API response", `${latency} ms`, "Time to load this page's data");
  addOverviewStat(healthStats, "Last data backup", lastBackup ? formatDate(adminDayKey(new Date(lastBackup.created_at))) : "Never");
  health.appendChild(healthStats);

  makeTable(addPanel(content, "Recent sign-ins", "Latest login and logout events. Full history is in Login History."), ["Account", "Event", "Time"], logins, (event, row) => {
    cell(row, who(event.actor_id));
    cell(row, humanize(event.action));
    cell(row, adminWhen(event.created_at));
  });
  makeTable(addPanel(content, "Recent security events", "Role, account, settings, and password changes."), ["Time", "User", "Event", "Details"], security, (event, row) => {
    cell(row, adminWhen(event.created_at));
    cell(row, who(event.actor_id));
    cell(row, humanize(event.action));
    cell(row, describeChange(event, roleNames));
  });

  const snapshot = addPanel(content, "Hotel snapshot (read-only)", "Pricing and financial approvals are handled by the Manager and Accountant roles.");
  const snapshotStats = document.createElement("div");
  snapshotStats.className = "stat-grid";
  addOverviewStat(snapshotStats, "Rooms", rooms);
  addOverviewStat(snapshotStats, "Reservations", reservations);
  addOverviewStat(snapshotStats, "Registered guests", guests);
  addOverviewStat(snapshotStats, "Today's check-ins", arrivals);
  snapshot.appendChild(snapshotStats);
}

/* ---------------------------------------------------------- role permissions */
async function renderRolePermissions() {
  const { content } = setContentTitle("Role permissions", "Choose which modules each role can open from its workspace.");
  const panel = addPanel(content, "Module access by role",);
  const defaults = defaultRoleMenus();
  const stored = await adminRows(sb.from("role_modules").select("role_name,module,enabled"), "role permissions");
  const roleField = makeSelect("Role", "permissionRole", Object.entries(ROLE_TITLES), false);
  panel.appendChild(roleField.wrapper);
  const grid = document.createElement("div");
  grid.className = "form-grid";
  panel.appendChild(grid);
  const actions = document.createElement("div");
  actions.className = "form-actions";
  const save = document.createElement("button");
  save.type = "button";
  save.className = "button button-primary";
  save.textContent = "Save permissions";
  const reset = document.createElement("button");
  reset.type = "button";
  reset.className = "button button-outline";
  reset.textContent = "Reset to defaults";
  actions.append(save, reset);
  panel.appendChild(actions);

  let boxes = [];
  const draw = () => {
    const role = roleField.input.value;
    const modules = (defaults[role] || []).filter((item) => !item.startsWith("## "));
    const off = new Set(stored.filter((item) => item.role_name === role && !item.enabled).map((item) => item.module));
    grid.replaceChildren();
    boxes = modules.map((module) => {
      const label = document.createElement("label");
      const box = document.createElement("input");
      box.type = "checkbox";
      box.checked = !off.has(module);
      const locked = role === "admin" && PROTECTED_ADMIN_MODULES.includes(module);
      if (locked) { box.checked = true; box.disabled = true; }
      label.append(box, ` ${module}${locked ? " (always on)" : ""}`);
      grid.appendChild(label);
      return { module, box };
    });
  };
  const refresh = async () => {
    const fresh = await adminRows(sb.from("role_modules").select("role_name,module,enabled"), "role permissions");
    stored.splice(0, stored.length, ...fresh);
    if (roleField.input.value === activeRole) {
      await applyRoleModuleOverrides(activeRole);
      addNavigation(activeRole);
      document.querySelectorAll(".nav-item").forEach((item) => item.classList.toggle("active", item.textContent === "Role Permissions"));
    }
    draw();
  };
  roleField.input.addEventListener("change", draw);
  save.addEventListener("click", async () => {
    save.disabled = true;
    const role = roleField.input.value;
    const { error } = await sb.from("role_modules").upsert(
      boxes.map(({ module, box }) => ({ role_name: role, module, enabled: box.checked })),
      { onConflict: "role_name,module" }
    );
    save.disabled = false;
    if (error) { notify(error.message, "error"); return; }
    notify(`${ROLE_TITLES[role]} permissions saved. Users see the change the next time they load their workspace.`);
    await refresh();
  });
  reset.addEventListener("click", async () => {
    const role = roleField.input.value;
    if (!window.confirm(`Reset ${ROLE_TITLES[role]} to the default modules?`)) return;
    const { error } = await sb.from("role_modules").delete().eq("role_name", role);
    if (error) { notify(error.message, "error"); return; }
    notify("Permissions reset to defaults.");
    await refresh();
  });
  draw();
}

/* ----------------------------------------------------------- system settings */
async function renderSystemSettings() {
  const { content } = setContentTitle("System settings", "Platform configuration. Prices, taxes, and discounts are managed by the Manager role.");
  const panel = addPanel(content, "Configuration",);
  const rows = await adminRows(sb.from("system_settings").select("key,value,updated_by,updated_at"), "system settings");
  const byKey = new Map(rows.map((item) => [item.key, item]));
  const fields = SETTING_DEFS.map(([key, label, type]) => {
    const field = type === "select"
      ? makeSelect(label, `setting_${key}`, [["true", "Open"], ["false", "Paused"]], true)
      : makeInput(label, `setting_${key}`, type, false);
    field.input.value = byKey.get(key)?.value ?? "";
    return { key, field };
  });
  makeForm(panel, fields.map((item) => item.field), "Save settings", async () => {
    const { error } = await sb.from("system_settings").upsert(
      fields.map(({ key, field }) => ({ key, value: field.input.value.trim() })),
      { onConflict: "key" }
    );
    if (error) { notify(error.message, "error"); return; }
    notify("Settings saved.");
    await renderModule("System Settings");
  });
  const names = await adminNameMap(rows.map((item) => item.updated_by));
  makeTable(addPanel(content, "Last changes", ""), ["Setting", "Value", "Updated by", "Updated"], rows, (item, row) => {
    cell(row, humanize(item.key));
    cell(row, item.value);
    cell(row, names.get(item.updated_by));
    cell(row, adminWhen(item.updated_at));
  });
}

/* ---------------------------------------------------------- room categories */
async function renderRoomCategories() {
  const { content } = setContentTitle("Room categories", "Create and organise room categories. Prices are set by management and cannot be edited here.");
  const types = await adminRows(sb.from("room_types").select("id,name,description,capacity,nightly_rate,active").order("name"), "room categories");
  const roomRows = await adminRows(sb.from("rooms").select("room_type_id"), "rooms");
  const roomCounts = new Map();
  roomRows.forEach((room) => roomCounts.set(room.room_type_id, (roomCounts.get(room.room_type_id) || 0) + 1));

  const formPanel = addPanel(content, "Category details", "New categories start inactive until a manager sets a nightly rate.");
  const name = makeInput("Category name", "categoryName");
  const description = makeInput("Description", "categoryDescription", "textarea", false);
  const capacity = makeInput("Maximum occupancy", "categoryCapacity", "number");
  capacity.input.min = "1";
  capacity.input.step = "1";
  let editingId = null;
  const form = makeForm(formPanel, [name, description, capacity], "Add category", async (formElement) => {
    const values = {
      name: name.input.value.trim(),
      description: description.input.value.trim() || null,
      capacity: Number(capacity.input.value)
    };
    const result = editingId
      ? await sb.from("room_types").update(values).eq("id", editingId)
      : await sb.from("room_types").insert(values);
    if (result.error) { notify(result.error.message, "error"); return; }
    notify(editingId ? "Category updated." : "Category added. A manager must price it before it can be activated.");
    formElement.reset();
    editingId = null;
    await renderModule("Room Categories");
  });
  const submit = form.querySelector('button[type="submit"]');
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.className = "button button-outline button-small";
  cancel.textContent = "Cancel edit";
  cancel.hidden = true;
  cancel.addEventListener("click", () => { form.reset(); editingId = null; submit.textContent = "Add category"; cancel.hidden = true; });
  form.querySelector(".form-actions").appendChild(cancel);

  const listPanel = addPanel(content, "All categories", "");
  makeTable(listPanel, ["Category", "Description", "Max occupancy", "Nightly rate", "Rooms", "Status", "Actions"], types, (type, row) => {
    cell(row, type.name);
    cell(row, type.description);
    cell(row, type.capacity);
    cell(row, Number(type.nightly_rate) > 0 ? `${currency(type.nightly_rate)} (set by management)` : "Not priced yet");
    cell(row, roomCounts.get(type.id) || 0);
    cell(row, type.active ? "Active" : "Inactive");
    const td = document.createElement("td");
    const edit = document.createElement("button");
    edit.type = "button";
    edit.className = "button button-outline button-small";
    edit.textContent = "Edit";
    edit.addEventListener("click", () => {
      editingId = type.id;
      name.input.value = type.name;
      description.input.value = type.description || "";
      capacity.input.value = type.capacity;
      submit.textContent = "Save category";
      cancel.hidden = false;
      formPanel.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "button button-outline button-small";
    toggle.textContent = type.active ? "Deactivate" : "Activate";
    toggle.addEventListener("click", async () => {
      const { error } = await sb.from("room_types").update({ active: !type.active }).eq("id", type.id);
      if (error) { notify(error.message, "error"); return; }
      notify(type.active ? "Category deactivated." : "Category activated.");
      await renderModule("Room Categories");
    });
    td.append(edit, toggle);
    row.appendChild(td);
  });
}

/* ------------------------------------------------------------ audit viewers */
async function renderAuditViewer(title, description, baseFilter, areas) {
  const { content } = setContentTitle(title, description);
  const panel = addPanel(content, title, "");
  const roles = await adminRows(sb.from("roles").select("id,name"), "roles");
  const roleNames = new Map(roles.map((role) => [role.id, humanize(role.name)]));
  const people = await adminRows(sb.from("profiles").select("id,full_name,email").order("full_name"), "accounts");
  const nameOf = new Map(people.map((person) => [person.id, person.full_name || person.email]));

  const userField = makeSelect("User", "logUser", [["", "All users"], ...people.map((person) => [person.id, person.full_name || person.email])], false);
  const areaField = areas ? makeSelect("Area", "logArea", [["", "All areas"], ...areas.map((area) => [area, humanize(area)])], false) : null;
  const fromField = makeInput("From", "logFrom", "date", false);
  const toField = makeInput("To", "logTo", "date", false);
  const toolbar = document.createElement("div");
  toolbar.className = "toolbar";
  toolbar.append(userField.wrapper, ...(areaField ? [areaField.wrapper] : []), fromField.wrapper, toField.wrapper);
  const apply = document.createElement("button");
  apply.type = "button";
  apply.className = "button button-primary button-small";
  apply.textContent = "Apply filters";
  toolbar.appendChild(apply);
  const tableBox = document.createElement("div");
  const more = document.createElement("button");
  more.type = "button";
  more.className = "button button-outline";
  more.textContent = "Load more";
  panel.append(toolbar, tableBox, more);

  const PAGE = 100;
  let records = [];
  const draw = (done) => {
    tableBox.replaceChildren();
    makeTable(tableBox, ["Time", "User", "Action", "Area", "Target", "Details"], records, (record, row) => {
      cell(row, adminWhen(record.created_at));
      cell(row, record.actor_id ? nameOf.get(record.actor_id) || "Unknown user" : "System");
      cell(row, humanize(record.action));
      cell(row, humanize(record.table_name));
      cell(row, nameOf.get(record.record_id) || record.record_id);
      cell(row, describeChange(record, roleNames));
    });
    more.hidden = done;
  };
  const load = async (reset) => {
    if (reset) records = [];
    let query = baseFilter(sb.from("audit_logs").select("id,actor_id,action,table_name,record_id,old_data,new_data,created_at"));
    if (userField.input.value) query = query.eq("actor_id", userField.input.value);
    if (areaField?.input.value) query = query.eq("table_name", areaField.input.value);
    if (fromField.input.value) query = query.gte("created_at", localDayStart(fromField.input.value));
    if (toField.input.value) query = query.lt("created_at", nextLocalDayStart(toField.input.value));
    const { data, error } = await query.order("id", { ascending: false }).range(records.length, records.length + PAGE - 1);
    if (error) { notify(`Unable to load the log: ${error.message}`, "error"); return; }
    records = records.concat(data || []);
    draw((data || []).length < PAGE);
  };
  apply.addEventListener("click", () => load(true));
  more.addEventListener("click", () => load(false));
  await load(true);
}

/* ------------------------------------------------------- database & backups */
async function renderDatabaseStatus() {
  const { content } = setContentTitle("Database & backups", "Database health and data exports. Automatic backups and point-in-time recovery are managed in your Supabase project.");
  const status = addPanel(content, "Database status", "");
  const startedAt = performance.now();
  const { data, error } = await sb.rpc("admin_database_status");
  const latency = Math.round(performance.now() - startedAt);
  if (error) {
    const note = document.createElement("p");
    note.textContent = `Unable to read database status: ${error.message}. Apply 018_admin_system.sql first.`;
    status.appendChild(note);
  } else {
    const stats = document.createElement("div");
    stats.className = "stat-grid";
    const tables = data.tables || [];
    addOverviewStat(stats, "Connection", "Online", `${latency} ms round trip`);
    addOverviewStat(stats, "Database size", data.database_size);
    addOverviewStat(stats, "Tables", tables.length);
    addOverviewStat(stats, "Approx. records", tables.reduce((sum, table) => sum + Number(table.rows || 0), 0));
    addOverviewStat(stats, "Checked", new Date(data.checked_at).toLocaleTimeString());
    status.appendChild(stats);
    makeTable(addPanel(content, "Tables", "Row counts are estimates maintained by the database."), ["Table", "Approx. rows", "Size"], tables, (table, row) => {
      cell(row, table.name);
      cell(row, table.rows);
      cell(row, table.size);
    });
  }

  const backupHistory = await adminRows(sb.from("audit_logs").select("actor_id,record_id,created_at")
    .eq("table_name", "admin_action").eq("action", "backup_export").order("id", { ascending: false }).limit(10), "backup history");
  const names = await adminNameMap(backupHistory.map((item) => item.actor_id));
  const backup = addPanel(content, "Data backup", "Downloads a complete JSON copy of hotel data. It contains personal and financial information, so store it securely. It cannot restore sign-in accounts or database structure; use Supabase backups for full recovery.");
  const button = document.createElement("button");
  button.type = "button";
  button.className = "button button-primary";
  button.textContent = "Download data backup";
  const progress = document.createElement("p");
  progress.className = "muted-note";
  backup.append(button, progress);
  button.addEventListener("click", async () => {
    if (!window.confirm("This downloads personal and financial data to this device. Continue?")) return;
    button.disabled = true;
    const dump = { exported_at: new Date().toISOString(), exported_by: currentUser.id, tables: {} };
    let total = 0;
    try {
      for (const [table, order] of BACKUP_TABLES) {
        progress.textContent = `Exporting ${table}…`;
        const rows = await loadAllRows(table, "*", (query) => query, order);
        dump.tables[table] = rows;
        total += rows.length;
      }
      const url = URL.createObjectURL(new Blob([JSON.stringify(dump, null, 2)], { type: "application/json" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = `hotel-backup-${adminDayKey(new Date())}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      const { error: logError } = await sb.rpc("admin_log_event", { p_action: "backup_export", p_record: `${BACKUP_TABLES.length} tables, ${total} rows` });
      notify(logError ? `Backup downloaded, but it could not be logged: ${logError.message}` : `Backup downloaded (${total} records).`, logError ? "error" : "success");
      if (!logError) await renderModule("Database & Backups");
    } catch (backupError) {
      notify(`Backup failed: ${backupError.message}`, "error");
    } finally {
      button.disabled = false;
      progress.textContent = "";
    }
  });
  makeTable(addPanel(content, "Backup history", "Exports made from this dashboard."), ["Time", "By", "Contents"], backupHistory, (item, row) => {
    cell(row, adminWhen(item.created_at));
    cell(row, names.get(item.actor_id));
    cell(row, item.record_id);
  });
}

/* ------------------------------------------------------------ system reports */
async function renderSystemReports() {
  const { content } = setContentTitle("System reports", "Accounts, access, and system activity. Business figures are read-only.");
  const since = new Date();
  since.setDate(since.getDate() - 13);
  const sinceKey = adminDayKey(since);
  const thirtyDays = new Date();
  thirtyDays.setDate(thirtyDays.getDate() - 29);

  const [employees, loginRows, activityRows] = await Promise.all([
    adminRows(sb.from("profiles").select("id,active,roles!inner(name)").neq("roles.name", "guest"), "employees"),
    loadAllRows("audit_logs", "created_at", (q) => q.eq("table_name", "auth").eq("action", "login").gte("created_at", localDayStart(sinceKey)), "created_at"),
    loadAllRows("audit_logs", "table_name", (q) => q.gte("created_at", localDayStart(adminDayKey(thirtyDays))), "id")
  ]);

  const accounts = addPanel(content, "Accounts", "");
  const byRole = new Map();
  employees.forEach((employee) => byRole.set(employee.roles.name, (byRole.get(employee.roles.name) || 0) + 1));
  const stats = document.createElement("div");
  stats.className = "stat-grid";
  addOverviewStat(stats, "Employees", employees.length);
  addOverviewStat(stats, "Active", employees.filter((employee) => employee.active).length);
  addOverviewStat(stats, "Deactivated", employees.filter((employee) => !employee.active).length);
  accounts.appendChild(stats);
  addOverviewBarChart(addPanel(accounts, "Employees by role", ""), [...byRole].map(([label, value]) => ({ label: humanize(label), value })).sort((a, b) => b.value - a.value));

  const loginsPerDay = new Map();
  for (let i = 0; i < 14; i += 1) {
    const day = new Date(since);
    day.setDate(since.getDate() + i);
    loginsPerDay.set(adminDayKey(day), 0);
  }
  loginRows.forEach((item) => {
    const key = adminDayKey(new Date(item.created_at));
    if (loginsPerDay.has(key)) loginsPerDay.set(key, loginsPerDay.get(key) + 1);
  });
  addOverviewBarChart(addPanel(content, "Logins per day", "Last 14 days."), [...loginsPerDay].map(([key, value]) => ({ label: formatDate(key), value })));

  const byArea = new Map();
  activityRows.forEach((item) => byArea.set(item.table_name, (byArea.get(item.table_name) || 0) + 1));
  addOverviewBarChart(addPanel(content, "Recorded activity by area", "Last 30 days."), [...byArea].map(([label, value]) => ({ label: humanize(label), value })).sort((a, b) => b.value - a.value).slice(0, 10));

  const statuses = ["pending", "reserved", "checked_in", "checked_out", "cancelled", "no_show"];
  const counts = await Promise.all(statuses.map((status) => countRecords("reservations", (q) => q.eq("status", status))));
  addOverviewBarChart(addPanel(content, "Reservations by status (read-only)", "Operational data for reference."), statuses.map((status, index) => ({ label: humanize(status), value: counts[index] })));
}

/* -------------------------------------------------------------------- router */
async function renderAdminModule(name) {
  if (name === "Role Permissions") return renderRolePermissions();
  if (name === "System Settings") return renderSystemSettings();
  if (name === "Room Categories") return renderRoomCategories();
  if (name === "Database & Backups") return renderDatabaseStatus();
  if (name === "System Reports") return renderSystemReports();
  if (name === "Login History") {
    return renderAuditViewer("Login history", "Sign-ins, sign-outs, and password changes recorded by the system.", (q) => q.eq("table_name", "auth"), null);
  }
  if (name === "Security Logs") {
    return renderAuditViewer("Security logs", "Role changes, account activation, permission and settings changes, password resets, and backups.", (q) => q.or(SECURITY_FILTER), null);
  }
  if (name === "Activity Logs") {
    return renderAuditViewer("Activity logs", "Every recorded change made by users, newest first.", (q) => q,
      ["auth", "profiles", "guests", "reservations", "rooms", "room_types", "invoices", "payments", "service_usage", "housekeeping_tasks", "maintenance_requests", "discounts", "system_settings", "role_modules", "password_reset_requests", "admin_action"]);
  }
}