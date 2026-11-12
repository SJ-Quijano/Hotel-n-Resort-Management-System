const ADMIN_MODULES = ["System Settings", "Room Categories", "Activity Logs"];
const PROTECTED_ADMIN_MODULES = ["User Management", "System Settings"];

const SECURITY_FILTER = "and(table_name.eq.profiles,action.eq.UPDATE),table_name.in.(role_modules,system_settings,admin_action,password_reset_requests),and(table_name.eq.auth,action.eq.password_change)";
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

/* Applies any module toggles saved in the role_modules table to the menu of the signed-in role.
   Called for every staff role at login. */
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
    logins, security, roles, dbStatus, resetRequests
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
    ["System settings", () => renderModule("System Settings")]
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
  if (resetRequests > 0) issues.push(`${resetRequests} employee${resetRequests === 1 ? " is" : "s are"} waiting for a password reset. Open User Management to set a new temporary password.`);
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
  health.appendChild(healthStats);

  makeTable(addPanel(content, "Recent sign-ins", "Latest login and logout events."), ["Account", "Event", "Time"], logins, (event, row) => {
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

/* ------------------------------------------------------------ activity logs */
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

/* -------------------------------------------------------------------- router */
async function renderAdminModule(name) {
  if (name === "System Settings") return renderSystemSettings();
  if (name === "Room Categories") return renderRoomCategories();
  if (name === "Activity Logs") {
    return renderAuditViewer("Activity logs", "Every recorded change made by users, newest first.", (q) => q,
      ["auth", "profiles", "guests", "reservations", "rooms", "room_types", "invoices", "payments", "service_usage", "housekeeping_tasks", "maintenance_requests", "discounts", "system_settings", "role_modules", "password_reset_requests", "admin_action"]);
  }
}