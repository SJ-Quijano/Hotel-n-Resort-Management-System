/* admin.js: Administrator console. SYSTEM data only (no guests, reservations or payments).
   Load after config.js (global `sb`, ROLE_MENUS, isValidPassword, recordAuthEvent) and role-guard.js.
   The sidebar is built from ROLE_MENUS.admin in config.js; each name maps to a renderer below. */

const ROLES = ["guest", "receptionist", "reservation_officer", "housekeeping", "maintenance", "manager", "accountant", "admin"];
const STAFF_ROLES = ROLES.filter((r) => r !== "guest");
const ROLE_NAMES = { admin: "Administrator", reservation_officer: "Reservation officer" };
const PROTECTED_ADMIN_MODULES = ["User Management", "Role Permissions", "System Settings"];
const LOGIN_TABLES = ["auth", "auth_events"];
const SECURITY_TABLES = ["admin_action", "profiles", "role_modules", "system_settings", "room_types"];
const SETTING_TYPES = { default_check_in_time: "time", default_check_out_time: "time", online_booking_enabled: "boolean", support_email: "email" };

/* ------------------------------------------------------------------ helpers */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const roleLabel = (r) => ROLE_NAMES[r] || r.charAt(0).toUpperCase() + r.slice(1).replace(/_/g, " ");
const humanize = (v) => String(v ?? "").replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()) || "—";
const fmtTime = (d) => (d ? new Date(d).toLocaleString() : "—");
const localDate = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const money = (n) => new Intl.NumberFormat(undefined, { style: "currency", currency: typeof CURRENCY_CODE !== "undefined" ? CURRENCY_CODE : "USD" }).format(Number(n || 0));

// Tiny DOM builder. Text always goes in as text, never as HTML.
function h(tag, props = {}, ...kids) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props || {})) {
    if (value == null || value === false) continue;
    if (key === "class") node.className = value;
    else if (key === "text") node.textContent = value;
    else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? "" : value);
  }
  kids.flat(Infinity).forEach((kid) => {
    if (kid == null || kid === false) return;
    node.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  });
  return node;
}

let noticeTimer;
function notify(message, type = "success") {
  const box = $("#notice");
  box.textContent = message;
  box.className = `adm-notice ${type}`;
  box.hidden = false;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => { box.hidden = true; }, 7000);
}

const panel = (title, subtitle, ...kids) => h("section", { class: "adm-panel" },
  title ? h("div", { class: "adm-head" }, h("h2", { text: title }), subtitle ? h("p", { class: "adm-muted", text: subtitle }) : null) : null,
  ...kids);

const stats = (items) => h("div", { class: "adm-stats" }, items.map(([label, value, hint]) =>
  h("div", { class: "adm-stat" }, h("span", { text: label }), h("strong", { text: String(value) }), hint ? h("small", { text: hint }) : null)));

function table(headers, rows, empty = "Nothing to show yet.", extraClass = "") {
  const body = rows.length
    ? rows.map((row) => h("tr", {}, row.map((cell) => h("td", {}, cell ?? "—"))))
    : [h("tr", {}, h("td", { colspan: headers.length, class: "adm-muted", text: empty }))];
  return h("div", { class: `adm-table ${extraClass}` }, h("table", {},
    h("thead", {}, h("tr", {}, headers.map((x) => h("th", { text: x })))), h("tbody", {}, body)));
}

const tag = (text, kind = "") => h("span", { class: `adm-tag ${kind}`, text });
const button = (text, onclick, extra = "") => h("button", { type: "button", class: `adm-btn small ${extra}`, onclick, text });

async function load(label, query) {
  const { data, error } = await query;
  if (error) throw new Error(`${label}: ${error.message}`);
  return data || [];
}
async function countOf(label, query) {
  const { count, error } = await query;
  if (error) throw new Error(`${label}: ${error.message}`);
  return count || 0;
}
async function rpc(name, args) {
  const { error } = await sb.rpc(name, args);
  if (error) throw new Error(error.message);
}

let people = null; // id -> display name, loaded on demand
async function loadPeople() {
  if (!people) {
    const rows = await load("people", sb.from("profiles").select("id,full_name,email"));
    people = new Map(rows.map((p) => [p.id, p.full_name || p.email]));
  }
  return people;
}

// Disable a button while work runs; report success or the error.
async function run(btn, work, okMessage) {
  btn.disabled = true;
  try {
    await work();
    if (okMessage) notify(okMessage);
    return true;
  } catch (err) {
    notify(err.message || String(err), "error");
    btn.disabled = false;
    return false;
  }
}

const csvCell = (v) => {
  let s = String(v ?? "");
  if (/^[=+\-@]/.test(s)) s = `'${s}`; // stop spreadsheet formula injection
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const toCsv = (headers, rows) => [headers, ...rows].map((r) => r.map(csvCell).join(",")).join("\n");
function downloadFile(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = h("a", { href: url, download: name });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function bars(rows) {
  const max = Math.max(1, ...rows.map(([, v]) => v));
  return h("div", { class: "adm-bars" }, rows.map(([label, value]) => {
    const fill = h("i", {});
    fill.style.width = `${Math.round((value / max) * 100)}%`;
    return h("div", { class: "adm-bar" }, h("span", { text: label }), h("div", {}, fill), h("b", { text: String(value) }));
  }));
}

/* ----------------------------------------------------------------- overview */
async function renderOverview(root) {
  const warnings = [];
  const safe = async (work, fallback) => {
    try { return await work; } catch (err) { warnings.push(err.message); return fallback; }
  };
  const [staff, guestAccounts, logins, changes, db, names] = await Promise.all([
    safe(load("staff accounts", sb.from("profiles").select("id,active,roles!inner(name)").neq("roles.name", "guest")), []),
    safe(countOf("guest accounts", sb.from("profiles").select("id,roles!inner(name)", { count: "exact", head: true }).eq("roles.name", "guest")), 0),
    safe(load("sign-ins", sb.from("audit_logs").select("actor_id,action,created_at").in("table_name", LOGIN_TABLES).order("created_at", { ascending: false }).limit(6)), []),
    safe(load("system changes", sb.from("audit_logs").select("actor_id,action,table_name,created_at").in("table_name", SECURITY_TABLES).order("created_at", { ascending: false }).limit(6)), []),
    safe(sb.rpc("admin_database_status").then(({ data, error }) => { if (error) throw new Error(`database status: ${error.message}`); return data; }), null),
    safe(loadPeople(), new Map())
  ]);
  const who = (id) => (id ? names.get(id) || "Unknown user" : "System");
  const active = staff.filter((u) => u.active).length;

  if (warnings.length) {
    root.append(panel("Some data could not be loaded", "The rest of this page is still accurate. Usually a missing permission: run supabase/migrations/019_admin_console.sql.",
      h("ul", {}, warnings.map((w) => h("li", { text: w })))));
  }
  root.append(
    panel("System at a glance", "Accounts and database health.", stats([
      ["Employees", staff.length, `${active} active`],
      ["Administrators", staff.filter((u) => u.active && u.roles?.name === "admin").length],
      ["Guest accounts", guestAccounts],
      ["Database size", db?.database_size ?? "—"]
    ])),
    panel("Shortcuts", "", h("div", { class: "adm-actions" },
      button("Create employee", () => show("User Management")),
      button("Review permissions", () => show("Role Permissions")),
      button("System settings", () => show("System Settings")),
      button("Export system data", () => show("Database & Backup")))),
    h("div", { class: "adm-grid2" },
      panel("Recent sign-ins", "", table(["Account", "Event", "When"], logins.map((e) => [who(e.actor_id), humanize(e.action), fmtTime(e.created_at)]), "No sign-ins recorded yet.")),
      panel("Recent system changes", "", table(["Who", "Action", "Area", "When"], changes.map((e) => [who(e.actor_id), humanize(e.action), humanize(e.table_name), fmtTime(e.created_at)]), "No changes recorded yet."))));
}

/* -------------------------------------------------------------------- users */
async function renderUsers(root) {
  const [staff, guestAccounts] = await Promise.all([
    load("staff accounts", sb.from("profiles").select("id,full_name,email,phone,position,active,created_at,roles!inner(name)").neq("roles.name", "guest").order("created_at", { ascending: true })),
    countOf("guest accounts", sb.from("profiles").select("id,roles!inner(name)", { count: "exact", head: true }).eq("roles.name", "guest"))
  ]);
  const active = staff.filter((u) => u.active).length;
  root.append(panel("Accounts", "Employee accounts and guest sign-ups.", stats([
    ["Employees", staff.length], ["Active", active], ["Deactivated", staff.length - active],
    ["Administrators", staff.filter((u) => u.active && u.roles?.name === "admin").length], ["Guest accounts", guestAccounts]
  ])));

  const search = h("input", { type: "search", placeholder: "Name, email or position", "aria-label": "Search employees" });
  const roleSel = h("select", { "aria-label": "Filter by role" }, h("option", { value: "all", text: "All roles" }), STAFF_ROLES.map((r) => h("option", { value: r, text: roleLabel(r) })));
  const statusSel = h("select", { "aria-label": "Filter by status" },
    h("option", { value: "all", text: "All statuses" }), h("option", { value: "active", text: "Active" }), h("option", { value: "inactive", text: "Deactivated" }));
  const host = h("div");

  const done = () => { people = null; show("User Management"); };

  function draw() {
    const term = search.value.trim().toLowerCase();
    const list = staff.filter((u) =>
      (roleSel.value === "all" || u.roles?.name === roleSel.value)
      && (statusSel.value === "all" || (statusSel.value === "active" ? u.active : !u.active))
      && (!term || [u.full_name, u.email, u.position].some((v) => String(v || "").toLowerCase().includes(term))));

    host.replaceChildren(table(["Name", "Email", "Phone", "Role", "Position", "Status", "Actions"], list.map((user) => {
      const isMe = user.id === me.id;
      const select = h("select", { "aria-label": `Role for ${user.full_name || user.email}`, disabled: isMe || !user.active },
        STAFF_ROLES.map((r) => h("option", { value: r, selected: r === user.roles?.name, text: roleLabel(r) })));
      select.addEventListener("change", async () => {
        select.disabled = true;
        try {
          await rpc("admin_set_employee_role", { p_user_id: user.id, p_role: select.value });
          notify("Role updated.");
          done();
        } catch (err) {
          notify(`Unable to update the role: ${err.message}`, "error");
          select.value = user.roles?.name;
          select.disabled = false;
        }
      });
      const toggle = button(user.active ? "Deactivate" : "Reactivate", async (e) => {
        if (user.active && !window.confirm(`Deactivate ${user.full_name || user.email}? They lose access on their next request.`)) return;
        const ok = await run(e.target, () => rpc("admin_set_employee_active", { p_user_id: user.id, p_active: !user.active }),
          user.active ? "Account deactivated." : "Account reactivated.");
        if (ok) done();
      });
      toggle.disabled = isMe;
      const reset = button("Reset password", async (e) => {
        if (!window.confirm(`Email a password reset code to ${user.email}? You will not see or set their password.`)) return;
        await run(e.target, async () => {
          const { error } = await sb.auth.resetPasswordForEmail(user.email);
          if (error) throw new Error(`Unable to send the reset email: ${error.message}`);
          await rpc("admin_log_event", { p_action: "password_reset_requested", p_record: user.id });
          e.target.disabled = false;
        }, `A reset code was sent to ${user.email}. They finish it with "Forgot password" on the sign-in page.`);
      });
      reset.disabled = isMe || !user.active;
      return [user.full_name, user.email, user.phone, select, user.position, tag(user.active ? "Active" : "Deactivated", user.active ? "ok" : "off"),
        h("div", { class: "adm-actions" }, toggle, reset)];
    }), staff.length ? "No employees match your filters." : "No employee accounts yet."));
  }
  [search, roleSel, statusSel].forEach((el) => el.addEventListener(el === search ? "input" : "change", draw));
  root.append(panel("Employee accounts", "Change roles, deactivate access or send a password reset.",
    h("div", { class: "adm-toolbar" }, search, roleSel, statusSel), host));
  draw();

  // ---- create employee
  const f = {
    name: h("input", { required: true, maxlength: 120, autocomplete: "name" }),
    email: h("input", { type: "email", required: true, maxlength: 254, autocomplete: "email" }),
    password: h("input", { type: "password", required: true, minlength: 12, maxlength: 128, autocomplete: "new-password" }),
    role: h("select", { required: true }, STAFF_ROLES.map((r) => h("option", { value: r, text: roleLabel(r) }))),
    position: h("input", { maxlength: 120 }),
    phone: h("input", { type: "tel", maxlength: 32 })
  };
  const submit = h("button", { type: "submit", class: "adm-btn primary", text: "Create account" });
  const form = h("form", { class: "adm-form" },
    h("label", {}, "Full name", f.name), h("label", {}, "Work email", f.email),
    h("label", {}, "Temporary password (12+ characters, an uppercase letter and a number)", f.password),
    h("label", {}, "Role", f.role), h("label", {}, "Position / title", f.position), h("label", {}, "Phone", f.phone),
    h("div", { class: "wide" }, submit));
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!isValidPassword(f.password.value)) return notify("Use a temporary password with 12–128 characters, an uppercase letter and a number.", "error");
    submit.disabled = true;
    submit.textContent = "Creating…";
    const body = { full_name: f.name.value.trim(), email: f.email.value.trim(), password: f.password.value, role: f.role.value, position: f.position.value.trim(), phone: f.phone.value.trim() };
    const { data: result, error: fnError } = await sb.functions.invoke("create-employee", { body });
    submit.disabled = false;
    submit.textContent = "Create account";
    if (fnError || result?.error) {
      let message = result?.error || fnError?.message || "The account could not be created.";
      if (fnError?.context && typeof fnError.context.json === "function") {
        try { message = (await fnError.context.json()).error || message; } catch { /* keep message */ }
      }
      return notify(message, "error");
    }
    notify(`Account created for ${result.email}. They must confirm their email before signing in.`);
    done();
  });
  root.append(panel("Create employee account", "Only administrators can provision staff accounts.", form));
}

/* -------------------------------------------------------- role permissions */
async function renderPermissions(root) {
  const rows = await load("role permissions", sb.from("role_modules").select("role_name,module,enabled"));
  const menus = typeof ROLE_MENUS !== "undefined" ? ROLE_MENUS : {};
  const modules = [...new Set(Object.values(menus).flat())];
  const state = new Map(rows.map((r) => [`${r.role_name}|${r.module}`, r.enabled]));

  if (!rows.length) {
    const seed = button("Load defaults from the role menus", async (e) => {
      const defaults = Object.entries(menus).flatMap(([role_name, list]) => list.map((module) => ({ role_name, module, enabled: true })));
      const ok = await run(e.target, async () => {
        const { error } = await sb.from("role_modules").upsert(defaults, { onConflict: "role_name,module" });
        if (error) throw new Error(error.message);
      }, "Default permissions loaded.");
      if (ok) show("Role Permissions");
    }, "primary");
    root.append(panel("No permissions saved yet", "Start from each role's current menu, then adjust.", seed));
    return;
  }

  const head = ["Module", ...ROLES.map(roleLabel)];
  const body = modules.map((module) => [module, ...ROLES.map((role) => {
    const locked = role === "admin" && PROTECTED_ADMIN_MODULES.includes(module);
    const box = h("input", { type: "checkbox", disabled: locked, "aria-label": `${roleLabel(role)}: ${module}`, title: locked ? "Administrators always keep this" : null });
    box.checked = locked || state.get(`${role}|${module}`) === true;
    box.addEventListener("change", async () => {
      box.disabled = true;
      const { error } = await sb.from("role_modules").upsert({ role_name: role, module, enabled: box.checked }, { onConflict: "role_name,module" });
      box.disabled = false;
      if (error) { box.checked = !box.checked; return notify(`Unable to save: ${error.message}`, "error"); }
      notify(`${roleLabel(role)}: ${module} ${box.checked ? "enabled" : "disabled"}.`);
    });
    return box;
  })]);
  root.append(panel("Role permissions", "Tick the modules each role may open. Changes save immediately and are logged.",
    table(head, body, "No modules defined.", "adm-matrix"),
    h("p", { class: "adm-muted", text: "Administrators always keep User Management, Role Permissions and System Settings. The staff dashboard applies these settings when it reads the role_modules table." })));
}

/* ---------------------------------------------------------- room categories */
async function renderRoomCategories(root) {
  const types = await load("room categories", sb.from("room_types").select("*").order("name"));
  let editing = null;
  const f = {
    name: h("input", { required: true, maxlength: 80 }),
    description: h("input", { maxlength: 300 }),
    capacity: h("input", { type: "number", min: 1, max: 20, value: 2, required: true })
  };
  const submit = h("button", { type: "submit", class: "adm-btn primary", text: "Add category" });
  const cancel = h("button", { type: "button", class: "adm-btn", text: "Cancel edit", hidden: true });
  const heading = h("h2", { text: "Add a room category" });

  function startEdit(type) {
    editing = type;
    f.name.value = type.name || "";
    f.description.value = type.description || "";
    f.capacity.value = type.capacity || 2;
    submit.textContent = "Save changes";
    cancel.hidden = false;
    heading.textContent = `Edit ${type.name}`;
    f.name.focus();
  }
  function stopEdit() {
    editing = null;
    form.reset();
    f.capacity.value = 2;
    submit.textContent = "Add category";
    cancel.hidden = true;
    heading.textContent = "Add a room category";
  }
  cancel.addEventListener("click", stopEdit);

  const rateOf = (t) => Number(t.nightly_rate) || Number(t.base_rate) || 0;
  root.append(panel("Room categories", "Names, descriptions and capacity. Prices are set by a manager, not the administrator.",
    table(["Category", "Description", "Capacity", "Price / night", "Status", "Actions"], types.map((t) => [
      t.name, t.description, t.capacity, rateOf(t) > 0 ? money(rateOf(t)) : tag("Not priced", "warn"),
      tag(t.active ? "Active" : "Inactive", t.active ? "ok" : ""),
      h("div", { class: "adm-actions" },
        button("Edit", () => startEdit(t)),
        (() => {
          const b = button(t.active ? "Deactivate" : "Activate", async (e) => {
            const ok = await run(e.target, async () => {
              const { error } = await sb.from("room_types").update({ active: !t.active }).eq("id", t.id);
              if (error) throw new Error(error.message);
            }, t.active ? "Category deactivated." : "Category activated.");
            if (ok) show("Room Categories");
          });
          if (!t.active && rateOf(t) <= 0) { b.disabled = true; b.title = "A manager must set a price first"; }
          return b;
        })())
    ]), "No room categories yet.")));

  const form = h("form", { class: "adm-form" },
    h("label", {}, "Name", f.name), h("label", {}, "Description", f.description), h("label", {}, "Guest capacity", f.capacity),
    h("div", { class: "wide adm-actions" }, submit, cancel));
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    submit.disabled = true;
    const values = { name: f.name.value.trim(), description: f.description.value.trim() || null, capacity: Number(f.capacity.value) };
    const { error } = editing
      ? await sb.from("room_types").update(values).eq("id", editing.id)
      : await sb.from("room_types").insert({ ...values, base_rate: 0, nightly_rate: 0, active: false });
    submit.disabled = false;
    if (error) return notify(`Unable to save: ${error.message}`, "error");
    notify(editing ? "Category updated." : "Category added. It stays inactive until a manager sets a price.");
    show("Room Categories");
  });
  root.append(h("section", { class: "adm-panel" }, heading, form));
}

/* ----------------------------------------------------------------- settings */
async function renderSettings(root) {
  const rows = await load("system settings", sb.from("system_settings").select("key,value,description,updated_at").order("key"));
  const inputs = new Map();
  const fields = rows.map((row) => {
    const type = SETTING_TYPES[row.key];
    const input = type === "boolean"
      ? h("select", {}, h("option", { value: "true", text: "Yes" }), h("option", { value: "false", text: "No" }))
      : h("input", { type: type || "text", maxlength: 200 });
    input.value = row.value;
    inputs.set(row.key, [input, row.value]);
    return h("label", {}, humanize(row.key), input, row.description ? h("span", { class: "adm-muted", text: row.description }) : null);
  });
  const save = h("button", { type: "submit", class: "adm-btn primary", text: "Save settings" });
  const form = h("form", { class: "adm-form" }, fields, h("div", { class: "wide" }, save));
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const changed = [...inputs].filter(([, [input, original]]) => input.value !== original);
    if (!changed.length) return notify("Nothing to save.");
    save.disabled = true;
    const results = await Promise.all(changed.map(([key, [input]]) => sb.from("system_settings").update({ value: input.value }).eq("key", key)));
    save.disabled = false;
    const failed = results.find((r) => r.error);
    if (failed) return notify(`Unable to save: ${failed.error.message}`, "error");
    notify(`${changed.length} setting${changed.length > 1 ? "s" : ""} saved.`);
    show("System Settings");
  });
  root.append(panel("System settings", "Changes are logged with your name and the time.",
    rows.length ? form : h("p", { class: "adm-muted", text: "No settings found. Run migration 018_admin_system.sql." })));
}

/* --------------------------------------------------------------------- logs */
async function renderLog(root, { title, subtitle, apply }) {
  const names = await loadPeople();
  const PAGE = 50;
  let loaded = [];
  const who = (id) => (id ? names.get(id) || "Unknown user" : "System");
  const search = h("input", { type: "search", placeholder: "Search who, action or area", "aria-label": "Search the log" });
  const host = h("div");
  const more = h("button", { type: "button", class: "adm-btn", text: "Load more", hidden: true });

  function draw() {
    const term = search.value.trim().toLowerCase();
    const list = loaded.filter((r) => !term || [who(r.actor_id), r.action, r.table_name].some((v) => String(v || "").toLowerCase().includes(term)));
    host.replaceChildren(table(["When", "Who", "Action", "Area", "Record"], list.map((r) => [
      fmtTime(r.created_at), who(r.actor_id), humanize(r.action), humanize(r.table_name),
      r.record_id ? h("span", { title: r.record_id, text: String(r.record_id).slice(0, 12) }) : null
    ]), "No log entries match."));
  }
  async function fetchMore() {
    more.disabled = true;
    const rows = await load("log", apply(sb.from("audit_logs").select("id,actor_id,action,table_name,record_id,created_at"))
      .order("created_at", { ascending: false }).range(loaded.length, loaded.length + PAGE - 1));
    loaded = loaded.concat(rows);
    more.disabled = false;
    more.hidden = rows.length < PAGE;
    draw();
  }
  more.addEventListener("click", () => fetchMore().catch((err) => { more.disabled = false; notify(err.message, "error"); }));
  search.addEventListener("input", draw);
  await fetchMore();
  root.append(panel(title, subtitle, h("div", { class: "adm-toolbar" }, search), host, more));
}

const renderActivity = (root) => renderLog(root, {
  title: "User activity", subtitle: "Recorded changes made by employees and the system.",
  apply: (q) => q.not("table_name", "in", "(auth,auth_events)")
});

async function renderSecurity(root) {
  const views = [
    ["Login history", { title: "Login history", subtitle: "Every sign-in and sign-out.", apply: (q) => q.in("table_name", LOGIN_TABLES) }],
    ["Security events", { title: "Security events", subtitle: "Account, role, permission and settings changes, resets and exports.", apply: (q) => q.in("table_name", SECURITY_TABLES) }]
  ];
  const host = h("div");
  const bar = h("div", { class: "adm-tabs" });
  async function open(index) {
    $$(".adm-tab", bar).forEach((b, i) => b.classList.toggle("active", i === index));
    host.replaceChildren();
    try { await renderLog(host, views[index][1]); } catch (err) { host.append(panel("Could not load the log", err.message)); }
  }
  views.forEach(([name], i) => bar.append(h("button", { type: "button", class: "adm-tab", text: name, onclick: () => open(i) })));
  root.append(bar, host);
  await open(0);
}

/* ------------------------------------------------------- database & backup */
async function exportSystemData(btn) {
  btn.disabled = true;
  try {
    const [staff, permissions, settings, categories, logs] = await Promise.all([
      load("staff", sb.from("profiles").select("id,full_name,email,phone,position,active,created_at,roles!inner(name)").neq("roles.name", "guest")),
      load("permissions", sb.from("role_modules").select("*")),
      load("settings", sb.from("system_settings").select("*")),
      load("room categories", sb.from("room_types").select("*")),
      load("activity log", sb.from("audit_logs").select("id,actor_id,action,table_name,record_id,created_at").order("created_at", { ascending: false }).limit(5000))
    ]);
    const payload = { exported_at: new Date().toISOString(), exported_by: me.email, staff_accounts: staff, role_permissions: permissions, system_settings: settings, room_categories: categories, activity_log: logs };
    downloadFile(`system-export-${localDate()}.json`, JSON.stringify(payload, null, 2), "application/json");
    const { error } = await sb.rpc("admin_log_event", { p_action: "backup_export", p_record: "system-data" });
    notify(error ? `Exported, but it could not be logged: ${error.message}` : "Export downloaded and logged.", error ? "error" : "success");
  } catch (err) {
    notify(err.message, "error");
  } finally {
    btn.disabled = false;
  }
}

async function renderDatabase(root) {
  const { data, error } = await sb.rpc("admin_database_status");
  if (error) throw new Error(`database status: ${error.message}`);
  const status = data || {};
  const tables = status.tables || [];
  root.append(
    panel("Database status", `Checked ${fmtTime(status.checked_at)}`,
      stats([["Database size", status.database_size ?? "—"], ["Tables", tables.length]]),
      table(["Table", "Rows (estimate)", "Size"], tables.map((t) => [t.name, Number(t.rows).toLocaleString(), t.size]), "No tables found.")),
    panel("Backup", "Download the system data (staff accounts, permissions, settings, room categories and the activity log) as a file.",
      h("div", { class: "adm-actions" }, h("button", { type: "button", class: "adm-btn primary", text: "Download system data export", onclick: (e) => exportSystemData(e.target) })),
      h("p", { class: "adm-muted", text: "This is an export of system data, not a full database backup. Full backups are managed in your Supabase project. The export contains staff contact details, so store it securely. Every export is logged." })));
}

/* ------------------------------------------------------------------ reports */
async function renderReports(root) {
  const since14 = new Date(); since14.setDate(since14.getDate() - 13); since14.setHours(0, 0, 0, 0);
  const since30 = new Date(); since30.setDate(since30.getDate() - 29); since30.setHours(0, 0, 0, 0);
  const [accounts, logins, events] = await Promise.all([
    load("accounts", sb.from("profiles").select("id,active,roles(name)")),
    load("sign-ins", sb.from("audit_logs").select("created_at").in("table_name", LOGIN_TABLES).eq("action", "login").gte("created_at", since14.toISOString()).limit(5000)),
    load("system events", sb.from("audit_logs").select("action").in("table_name", SECURITY_TABLES).gte("created_at", since30.toISOString()).limit(5000))
  ]);

  const byRole = ROLES.map((r) => [roleLabel(r), accounts.filter((a) => a.roles?.name === r).length]);
  const activeCount = accounts.filter((a) => a.active).length;
  const days = Array.from({ length: 14 }, (_, i) => { const d = new Date(since14); d.setDate(d.getDate() + i); return localDate(d); });
  const perDay = days.map((day) => [day, logins.filter((l) => localDate(new Date(l.created_at)) === day).length]);
  const counts = new Map();
  events.forEach((e) => counts.set(e.action, (counts.get(e.action) || 0) + 1));
  const byAction = [...counts].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([a, n]) => [humanize(a), n]);

  const csv = (name, headers, rows) => button("Download CSV", () => downloadFile(name, toCsv(headers, rows), "text/csv"));
  root.append(
    panel("Accounts by role", `${accounts.length} accounts · ${activeCount} active · ${accounts.length - activeCount} deactivated`,
      bars(byRole), csv(`accounts-by-role-${localDate()}.csv`, ["Role", "Accounts"], byRole)),
    panel("Sign-ins, last 14 days", `${logins.length} sign-ins`, bars(perDay), csv(`sign-ins-${localDate()}.csv`, ["Date", "Sign-ins"], perDay)),
    panel("System changes, last 30 days", `${events.length} events`,
      byAction.length ? bars(byAction) : h("p", { class: "adm-muted", text: "No system changes recorded." }),
      csv(`system-changes-${localDate()}.csv`, ["Action", "Events"], byAction)));
}

/* --------------------------------------------------------------- navigation */
const RENDERERS = {
  "User Management": renderUsers,
  "Role Permissions": renderPermissions,
  "Room Categories": renderRoomCategories,
  "System Settings": renderSettings,
  "Activity Logs": renderActivity,
  "Login & Security": renderSecurity,
  "Database & Backup": renderDatabase,
  "Reports": renderReports
};

let me = null;
let current = "Overview";
let renderToken = 0;

async function show(name) {
  const token = ++renderToken;
  current = name;
  $$("#nav button").forEach((b) => b.classList.toggle("active", b.dataset.name === name));
  $("#eyebrow").textContent = name.toUpperCase();
  $("#sideBar").classList.remove("open");
  const holder = h("div");
  try {
    await (name === "Overview" ? renderOverview : RENDERERS[name])(holder);
  } catch (err) {
    console.error(err);
    holder.replaceChildren(h("section", { class: "adm-panel adm-error" },
      h("h2", { text: "This section could not be loaded" }), h("p", { text: err.message || String(err) }),
      h("p", { class: "adm-muted", text: "If this mentions a permission or a missing table, run supabase/migrations/019_admin_console.sql in the SQL Editor." })));
  }
  if (token === renderToken) $("#content").replaceChildren(holder);
}

(async function init() {
  if (!(await RoleGuard.require("admin"))) return;
  const { data: { session } } = await sb.auth.getSession();
  me = session.user;
  const { data: profile } = await sb.from("profiles").select("full_name,email").eq("id", me.id).maybeSingle();
  $("#userName").textContent = profile?.full_name || profile?.email || me.email;

  const menu = typeof ROLE_MENUS !== "undefined" && Array.isArray(ROLE_MENUS.admin) ? ROLE_MENUS.admin : Object.keys(RENDERERS);
  const names = ["Overview", ...menu.filter((n) => RENDERERS[n])];
  const nav = $("#nav");
  names.forEach((name) => nav.append(h("button", { type: "button", "data-name": name, text: name, onclick: () => show(name) })));

  $("#menuBtn").addEventListener("click", () => $("#sideBar").classList.toggle("open"));
  $("#logoutBtn").addEventListener("click", async () => {
    try { if (typeof recordAuthEvent === "function") await recordAuthEvent("logout"); } catch { /* ignore */ }
    await sb.auth.signOut();
    window.location.replace("home.html");
  });
  await show("Overview");
})();