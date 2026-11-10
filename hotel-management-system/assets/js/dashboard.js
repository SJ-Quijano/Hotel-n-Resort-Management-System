
const ROLE_TITLES = {
  guest: "Guest", receptionist: "Receptionist", reservation_officer: "Reservation Officer",
  housekeeping: "Housekeeping", maintenance: "Maintenance", manager: "Manager",
  accountant: "Accountant", admin: "Administrator"
};

let activeRole;
let currentUser;
let toastTimer;

function notify(message, type = "success") {
  const toast = document.getElementById("toast");
  toast.textContent = message;
  toast.className = `toast visible${type === "error" ? " error" : ""}`;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => { toast.className = "toast"; }, 4200);
}

function setContentTitle(title, description) {
  const content = document.getElementById("content");
  content.replaceChildren();
  const panel = document.createElement("section");
  panel.className = "panel";
  const heading = document.createElement("div");
  heading.className = "section-heading";
  const copy = document.createElement("div");
  const eyebrow = document.createElement("p");
  eyebrow.className = "eyebrow";
  eyebrow.textContent = "HOTEL OPERATIONS";
  const h = document.createElement("h1");
  h.textContent = title;
  const p = document.createElement("p");
  p.textContent = description;
  copy.append(eyebrow, h, p);
  heading.appendChild(copy);
  panel.appendChild(heading);
  content.appendChild(panel);
  return { content, panel };
}

function addPanel(content, title, description) {
  const panel = document.createElement("section");
  panel.className = "panel";
  if (title) {
    const heading = document.createElement("div");
    heading.className = "section-heading";
    const copy = document.createElement("div");
    const h = document.createElement("h2");
    h.textContent = title;
    copy.appendChild(h);
    if (description) {
      const p = document.createElement("p");
      p.textContent = description;
      copy.appendChild(p);
    }
    heading.appendChild(copy);
    panel.appendChild(heading);
  }
  content.appendChild(panel);
  return panel;
}

function makeInput(labelText, name, type = "text", required = true) {
  const wrapper = document.createElement("div");
  const label = document.createElement("label");
  const input = document.createElement(type === "textarea" ? "textarea" : "input");
  input.id = name;
  input.name = name;
  if (type !== "textarea") input.type = type;
  input.required = required;
  label.htmlFor = name;
  label.textContent = labelText;
  wrapper.append(label, input);
  return { wrapper, input };
}

function makeSelect(labelText, name, options, required = true) {
  const wrapper = document.createElement("div");
  const label = document.createElement("label");
  const select = document.createElement("select");
  select.id = name;
  select.name = name;
  select.required = required;
  label.htmlFor = name;
  label.textContent = labelText;
  options.forEach(([value, text]) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = text;
    select.appendChild(option);
  });
  wrapper.append(label, select);
  return { wrapper, input: select };
}

function makeForm(panel, fields, buttonText, onSubmit) {
  const form = document.createElement("form");
  form.className = "form-grid";
  fields.forEach((field) => form.appendChild(field.wrapper));
  const actions = document.createElement("div");
  actions.className = "form-actions";
  const button = document.createElement("button");
  button.className = "button button-primary";
  button.type = "submit";
  button.textContent = buttonText;
  actions.appendChild(button);
  form.appendChild(actions);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    button.disabled = true;
    try {
      await onSubmit(form);
    } finally {
      button.disabled = false;
    }
  });
  panel.appendChild(form);
  return form;
}

function makeTable(panel, headers, rows, rowBuilder) {
  const wrap = document.createElement("div");
  wrap.className = "table-wrap";
  const table = document.createElement("table");
  const thead = document.createElement("thead");
  const tr = document.createElement("tr");
  headers.forEach((header) => {
    const th = document.createElement("th");
    th.textContent = header;
    tr.appendChild(th);
  });
  thead.appendChild(tr);
  const tbody = document.createElement("tbody");
  if (!rows.length) {
    const emptyRow = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = headers.length;
    cell.className = "empty-state";
    cell.textContent = "No records to display.";
    emptyRow.appendChild(cell);
    tbody.appendChild(emptyRow);
  } else {
    rows.forEach((row) => {
      const tableRow = document.createElement("tr");
      rowBuilder(row, tableRow);
      tbody.appendChild(tableRow);
    });
  }
  table.append(thead, tbody);
  wrap.appendChild(table);
  panel.appendChild(wrap);
  return tbody;
}

function cell(row, value) {
  const td = document.createElement("td");
  td.textContent = value === null || value === undefined || value === "" ? "—" : String(value);
  row.appendChild(td);
  return td;
}

function currency(value) {
  return new Intl.NumberFormat(undefined, { style: "currency", currency: CURRENCY_CODE }).format(Number(value || 0));
}

function humanize(value) {
  return String(value || "").replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatDate(value) {
  if (!value) return "—";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(`${value}T00:00:00`));
}

function todayLocal() {
  const today = new Date();
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
}

function dateOffset(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

async function loadTable(name, selection, orderColumn = "created_at") {
  const { data, error } = await sb.from(name).select(selection).order(orderColumn, { ascending: false });
  if (error) throw new Error(error.message);
  return data || [];
}

async function loadRowsByRole(name, selection, orderColumn = "created_at") {
  try {
    return await loadTable(name, selection, orderColumn);
  } catch (error) {
    notify(`Unable to load ${name.replaceAll("_", " ")}: ${error.message}`, "error");
    return [];
  }
}

function isMissingProfileActiveColumn(error) {
  return error?.code === "42703"
    && /column.*(?:profiles|profile)\.active.*does not exist/i.test(error.message || "");
}

function addNavigation(role) {
  const nav = document.getElementById("nav");
  nav.replaceChildren();
  const items = ["Dashboard", ...(ROLE_MENUS[role] || []), "Logout"];
  items.forEach((name, index) => {
    if (name.startsWith("## ")) {
      const heading = document.createElement("div");
      heading.className = "nav-heading";
      heading.textContent = name.slice(3);
      nav.appendChild(heading);
      return;
    }
    const button = document.createElement("button");
    button.type = "button";
    button.className = `nav-item${index === 0 ? " active" : ""}`;
    button.textContent = name;
    button.addEventListener("click", () => {
      if (name === "Logout") {
        signOut();
        return;
      }
      document.querySelectorAll(".nav-item").forEach((item) => item.classList.remove("active"));
      button.classList.add("active");
      if (name === "User Management") {
        window.location.href = "admin-users.html";
        return;
      }
      renderModule(name);
    });
    nav.appendChild(button);
  });
}

async function renderOverview() {
  if (activeRole === "admin") {
    try {
      return await renderAdminConsoleOverview();
    } catch (error) {
      notify(`Unable to load admin dashboard: ${error.message}`, "error");
      setContentTitle("Admin dashboard unavailable", error.message);
      return;
    }
  }
  const { content, panel } = setContentTitle("At a glance", "A live snapshot of the records available to your account.");
  const stats = document.createElement("div");
  stats.className = "stat-grid";
  const metrics = [["Rooms", "rooms"], ["Reservations", "reservations"]];
  if (["admin", "manager", "accountant", "receptionist"].includes(activeRole)) metrics.push(["Invoices", "invoices"]);
  for (const [label, tableName] of metrics) {
    const { count, error } = await sb.from(tableName).select("*", { count: "exact", head: true });
    if (error) {
      notify(`Unable to load ${label.toLowerCase()} summary: ${error.message}`, "error");
      continue;
    }
    const card = document.createElement("div");
    card.className = "stat-card";
    const title = document.createElement("span");
    title.textContent = label;
    const value = document.createElement("strong");
    value.textContent = String(count ?? 0);
    card.append(title, value);
    stats.appendChild(card);
  }
  panel.appendChild(stats);
  const note = document.createElement("p");
  note.className = "muted-note";
  note.textContent = "Available modules are controlled by your assigned role. Database policies enforce access to every record.";
  panel.appendChild(note);
  content.appendChild(panel);
}

async function countRecords(table, applyFilters = (query) => query, selection = "*") {
  const query = applyFilters(sb.from(table).select(selection, { count: "exact", head: true }));
  const { count, error } = await query;
  if (error) throw new Error(`Unable to count ${table.replaceAll("_", " ")}: ${error.message}`);
  return count ?? 0;
}

async function loadAllRows(table, selection, applyFilters, orderColumn) {
  const pageSize = 500;
  const rows = [];
  for (let offset = 0; ; offset += pageSize) {
    const query = applyFilters(sb.from(table).select(selection))
      .order(orderColumn, { ascending: true })
      .range(offset, offset + pageSize - 1);
    const { data, error } = await query;
    if (error) throw new Error(`Unable to load ${table.replaceAll("_", " ")}: ${error.message}`);
    rows.push(...(data || []));
    if (!data || data.length < pageSize) return rows;
  }
}

//async function sumCompletedPayments() {
 // const pageSize = 500;
 // let offset = 0;
 // let total = 0;
 // while (true) {
   // const { data, error } = await sb.from("payments")
   //   .select("amount")
   //   .eq("status", "completed")
   //   .order("paid_at", { ascending: true })
   //   .range(offset, offset + pageSize - 1);
   // if (error) throw new Error(`Unable to calculate revenue: ${error.message}`);
   // total += (data || []).reduce((sum, payment) => sum + Number(payment.amount), 0);
   // if (!data || data.length < pageSize) return total;
   // offset += pageSize;
 // }
//}

function localDayStart(date) {
  return new Date(`${date}T00:00:00`).toISOString();
}

function nextLocalDayStart(date) {
  const next = new Date(`${date}T00:00:00`);
  next.setDate(next.getDate() + 1);
  return next.toISOString();
}

function addOverviewStat(grid, label, value, detail = "") {
  const card = document.createElement("div");
  card.className = "stat-card";
  const title = document.createElement("span");
  title.textContent = label;
  const metric = document.createElement("strong");
  metric.textContent = String(value);
  card.append(title, metric);
  if (detail) {
    const note = document.createElement("small");
    note.textContent = detail;
    card.appendChild(note);
  }
  grid.appendChild(card);
}

function addOverviewBarChart(panel, items, formatValue = (value) => String(value)) {
  const chart = document.createElement("div");
  chart.className = "overview-chart";
  if (!items.length) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "No data to display.";
    chart.appendChild(empty);
  }
  const maximum = Math.max(1, ...items.map((item) => item.value));
  items.forEach((item) => {
    const row = document.createElement("div");
    row.className = "overview-chart-row";
    const label = document.createElement("span");
    label.textContent = item.label;
    const track = document.createElement("div");
    track.className = "overview-chart-track";
    const bar = document.createElement("div");
    bar.className = "overview-chart-bar";
    bar.style.width = `${Math.max(item.value > 0 ? 2 : 0, (item.value / maximum) * 100)}%`;
    track.appendChild(bar);
    const value = document.createElement("strong");
    value.textContent = formatValue(item.value);
    row.append(label, track, value);
    chart.appendChild(row);
  });
  panel.appendChild(chart);
}

async function renderAvailability(content, staffBooking) {
  const panel = addPanel(content, staffBooking ? "Find a room for a guest" : "Find your stay", "Choose dates to see rooms that are available for the full stay.");
  const start = makeInput("Check-in", "checkIn", "date");
  const end = makeInput("Check-out", "checkOut", "date");
  start.input.min = todayLocal();
  start.input.value = dateOffset(1);
  end.input.min = dateOffset(2);
  end.input.value = dateOffset(2);
  const adults = makeInput("Adults", "adults", "number");
  adults.input.min = "1";
  adults.input.value = "1";
  adults.input.max = "20";
  const children = makeInput("Children", "children", "number", false);
  children.input.min = "0";
  children.input.value = "0";
  children.input.max = "20";
  const guests = makeSelect("Guest", "guestId", [], true);
  if (staffBooking) {
    guests.input.appendChild(new Option("Choose a guest", ""));
    const guestRows = await loadRowsByRole("guests", "id,full_name,email", "full_name");
    guestRows.forEach((guest) => guests.input.appendChild(new Option(`${guest.full_name}${guest.email ? ` · ${guest.email}` : ""}`, guest.id)));
  }
  const request = makeInput("Special requests", "specialRequests", "textarea", false);
  const toolbar = document.createElement("div");
  toolbar.className = "toolbar";
  toolbar.append(start.wrapper, end.wrapper, adults.wrapper, children.wrapper);
  if (staffBooking) toolbar.appendChild(guests.wrapper);
  panel.appendChild(toolbar);
  panel.appendChild(request.wrapper);
  const search = document.createElement("button");
  search.className = "button button-primary";
  search.type = "button";
  search.textContent = "Search availability";
  panel.appendChild(search);
  const results = document.createElement("div");
  panel.appendChild(results);

  const searchRooms = async () => {
    results.replaceChildren();
    if (!start.input.value || !end.input.value || end.input.value <= start.input.value || start.input.value < todayLocal()) {
      notify("Choose valid future check-in and check-out dates.", "error");
      return;
    }
    search.disabled = true;
    try {
      const { data, error } = await sb.rpc("get_available_rooms", {
        p_check_in: start.input.value,
        p_check_out: end.input.value,
        p_room_type_id: null
      });
      if (error) throw new Error(error.message);
      if (!data || !data.length) {
        const empty = document.createElement("p");
        empty.className = "empty-state";
        empty.textContent = "No rooms are available for those dates. Try another date range.";
        results.appendChild(empty);
        return;
      }
      const cards = document.createElement("div");
      cards.className = "room-cards";
      data.forEach((room) => {
        const card = document.createElement("article");
        card.className = "room-card";
        const heading = document.createElement("h3");
        heading.textContent = `${room.room_type} · ${room.room_number}`;
        const capacity = document.createElement("p");
        capacity.textContent = `Up to ${room.capacity} guests`;
        const rate = document.createElement("p");
        rate.textContent = `${currency(room.nightly_rate)} per night`;
        const reserve = document.createElement("button");
        reserve.type = "button";
        reserve.className = "button button-primary";
        reserve.textContent = staffBooking ? "Book for guest" : "Reserve this room";
        reserve.addEventListener("click", async () => {
          if (staffBooking && !guests.input.value) {
            notify("Select a guest before placing the reservation.", "error");
            return;
          }
          reserve.disabled = true;
          const { data: reservationId, error: bookingError } = await sb.rpc(
            staffBooking ? "reserve_room_for_guest" : "reserve_room",
            staffBooking ? {
              p_guest_id: guests.input.value,
              p_room_id: room.id,
              p_check_in: start.input.value,
              p_check_out: end.input.value,
              p_adults: Number(adults.input.value),
              p_children: Number(children.input.value),
              p_special_requests: request.input.value.trim() || null
            } : {
              p_room_id: room.id,
              p_check_in: start.input.value,
              p_check_out: end.input.value,
              p_adults: Number(adults.input.value),
              p_children: Number(children.input.value),
              p_special_requests: request.input.value.trim() || null
            }
          );
          reserve.disabled = false;
          if (bookingError) {
            notify(bookingError.message, "error");
            return;
          }
          notify(`Reservation confirmed. Reference: ${reservationId}`);
          await searchRooms();
        });
        card.append(heading, capacity, rate, reserve);
        cards.appendChild(card);
      });
      results.appendChild(cards);
    } catch (error) {
      notify(`Availability search failed: ${error.message}`, "error");
    } finally {
      search.disabled = false;
    }
  };
  search.addEventListener("click", searchRooms);
}

async function renderReservations(content, mode) {
  const isGuest = activeRole === "guest";
  const isAdmin = activeRole === "admin" && mode === "all";
  const isStayOperation = mode === "checkin" || mode === "checkout";
  const panel = addPanel(content, isAdmin ? "Reservation history & schedule" : mode === "checkin" ? "Today's arrivals & check-in" : mode === "checkout" ? "Today's departures & check-out" : "Reservations", isGuest ? "View and manage your upcoming and past stays." : isStayOperation ? "Review guest details, assigned rooms, stay schedules, charges, and payment balances before authorizing a stay transition." : "Reservation records and changes are protected by role-based database policies.");
  const rows = await loadRowsByRole(
    "reservations",
    "id,guest_id,room_id,check_in,check_out,check_in_time,check_out_time,checked_in_at,checked_out_at,status,adults,children,nightly_rate,created_at,guests(full_name,email,phone,address,identification_type,identification_number),rooms(room_number,room_types(name))",
    isAdmin ? "created_at" : "check_in"
  );
  const financeVisible = isAdmin || isStayOperation;
  const [invoices, payments, serviceUsage] = financeVisible ? await Promise.all([
    loadRowsByRole("invoices", "id,reservation_id,total,status", "issued_at"),
    loadRowsByRole("payments", "invoice_id,amount,status", "paid_at"),
    loadRowsByRole("service_usage", "reservation_id,quantity,unit_price", "used_at")
  ]) : [[], [], []];
  const invoiceByReservation = new Map(invoices.map((invoice) => [invoice.reservation_id, invoice]));
  const invoiceTotals = new Map(invoices.map((invoice) => [invoice.reservation_id, Number(invoice.total)]));
  const paidByInvoice = new Map();
  payments.filter((payment) => payment.status === "completed").forEach((payment) => {
    paidByInvoice.set(payment.invoice_id, (paidByInvoice.get(payment.invoice_id) || 0) + Number(payment.amount));
  });
  const servicesByReservation = new Map();
  serviceUsage.forEach((usage) => {
    servicesByReservation.set(usage.reservation_id, (servicesByReservation.get(usage.reservation_id) || 0) + Number(usage.quantity) * Number(usage.unit_price));
  });
  const guests = isAdmin ? await loadRowsByRole("guests", "id,full_name,email", "full_name") : [];
  const rooms = isAdmin
    ? await loadRowsByRole("rooms", "id,room_number,status,room_type_id,room_types(name,capacity,nightly_rate,active)", "room_number")
    : [];
  let editingReservation = null;
  let reservationForm;
  let guestField;
  let roomField;
  let checkInField;
  let checkOutField;
  let adultsField;
  let childrenField;
  let reservationFormButton;
  let cancelEditButton;

  if (isAdmin) {
    const formPanel = addPanel(content, "Create reservation", "Administrator-created reservations start pending and must be approved before they are confirmed.");
    guestField = makeSelect("Guest", "reservationGuest", [["", "Choose a guest"], ...guests.map((guest) => [
      guest.id, `${guest.full_name}${guest.email ? ` · ${guest.email}` : ""}`
    ])]);
    roomField = makeSelect("Room", "reservationRoom", [["", "Choose a room"], ...rooms
    .filter((room) => room.room_types?.active && room.status === "available")
      .map((room) => [room.id, `${room.room_number} · ${room.room_types?.name || "Room"} · ${currency(room.room_types?.nightly_rate)}`])]);
    checkInField = makeInput("Check-in date", "reservationCheckIn", "date");
    checkInField.input.min = todayLocal();
    checkInField.input.value = dateOffset(1);
    checkOutField = makeInput("Check-out date", "reservationCheckOut", "date");
    checkOutField.input.min = dateOffset(2);
    checkOutField.input.value = dateOffset(2);
    adultsField = makeInput("Adults", "reservationAdults", "number");
    adultsField.input.min = "1";
    adultsField.input.max = "20";
    adultsField.input.value = "1";
    childrenField = makeInput("Children", "reservationChildren", "number", false);
    childrenField.input.min = "0";
    childrenField.input.max = "20";
    childrenField.input.value = "0";
    reservationForm = makeForm(formPanel, [guestField, roomField, checkInField, checkOutField, adultsField, childrenField], "Create pending reservation", async (form) => {
      const selectedRoom = rooms.find((room) => room.id === roomField.input.value);
      if (!guestField.input.value || !selectedRoom) {
        notify("Choose a guest and an available room.", "error");
        return;
      }
      if (!editingReservation && selectedRoom.status !== "available") {
        notify("Choose a room currently marked available.", "error");
        return;
      }
      if (checkOutField.input.value <= checkInField.input.value) {
        notify("Check-out must be after check-in.", "error");
        return;
      }
      const guestCount = Number(adultsField.input.value) + Number(childrenField.input.value || 0);
      if (guestCount > Number(selectedRoom.room_types?.capacity || 0)) {
        notify("Guest count exceeds room capacity.", "error");
        return;
      }
      const args = {
        p_guest_id: guestField.input.value,
        p_room_id: roomField.input.value,
        p_check_in: checkInField.input.value,
        p_check_out: checkOutField.input.value,
        p_adults: Number(adultsField.input.value),
        p_children: Number(childrenField.input.value || 0)
      };
      const result = editingReservation
        ? await sb.rpc("admin_update_reservation", { p_reservation_id: editingReservation.id, ...args })
        : await sb.rpc("admin_create_pending_reservation", args);
      if (result.error) {
        notify(result.error.message, "error");
        return;
      }
      notify(editingReservation ? "Reservation updated." : "Pending reservation created.");
      editingReservation = null;
      form.reset();
      checkInField.input.value = dateOffset(1);
      checkOutField.input.value = dateOffset(2);
      adultsField.input.value = "1";
      childrenField.input.value = "0";
      reservationFormButton.textContent = "Create pending reservation";
      cancelEditButton.hidden = true;
      await renderModule("Reservations");
    });
    reservationFormButton = reservationForm.querySelector('button[type="submit"]');
    cancelEditButton = document.createElement("button");
    cancelEditButton.type = "button";
    cancelEditButton.className = "button button-outline button-small";
    cancelEditButton.textContent = "Cancel edit";
    cancelEditButton.hidden = true;
    cancelEditButton.addEventListener("click", () => {
      editingReservation = null;
      reservationForm.reset();
      checkInField.input.value = dateOffset(1);
      checkOutField.input.value = dateOffset(2);
      adultsField.input.value = "1";
      childrenField.input.value = "0";
      reservationFormButton.textContent = "Create pending reservation";
      cancelEditButton.hidden = true;
    });
    reservationForm.querySelector(".form-actions").appendChild(cancelEditButton);
  }

  const filters = document.createElement("div");
  filters.className = "toolbar";
  const statusFilter = makeSelect("Status", "reservationStatusFilter", [
    ["all", "All statuses"],
    ["pending", "Pending approval"],
    ["reserved", "Confirmed"],
    ["checked_in", "Checked in"],
    ["checked_out", "Checked out"],
    ["cancelled", "Cancelled"],
    ["no_show", "No show"]
  ], false);
  const fromFilter = makeInput(isStayOperation ? (mode === "checkin" ? "Arrival from" : "Departure from") : "Check-in from", "reservationFrom", "date", false);
  const toFilter = makeInput(isStayOperation ? (mode === "checkin" ? "Arrival to" : "Departure to") : "Check-in to", "reservationTo", "date", false);
  if (isStayOperation) {
    fromFilter.input.value = todayLocal();
    toFilter.input.value = todayLocal();
  }
  filters.append(statusFilter.wrapper, fromFilter.wrapper, toFilter.wrapper);
  const historyPanel = addPanel(content, isAdmin ? "Booking history" : "Reservation register", "Filter reservation history by status or scheduled arrival date.");
  historyPanel.appendChild(filters);
  const tableContainer = document.createElement("div");
  historyPanel.appendChild(tableContainer);

  const tableRows = mode === "checkin" ? rows.filter((item) => ["reserved", "checked_in"].includes(item.status) && item.check_in <= todayLocal())
    : mode === "checkout" ? rows.filter((item) => ["checked_in", "checked_out"].includes(item.status) && item.check_out <= todayLocal())
      : isGuest || mode === "cancel" ? rows.filter((item) => item.status === "reserved" && item.check_in > todayLocal())
        : rows;
  const drawTable = () => {
    const dateField = mode === "checkout" ? "check_out" : "check_in";
    const filteredRows = tableRows.filter((item) =>
      (statusFilter.input.value === "all" || !statusFilter.input.value || item.status === statusFilter.input.value)
      && (!fromFilter.input.value || item[dateField] >= fromFilter.input.value)
      && (!toFilter.input.value || item[dateField] <= toFilter.input.value)
    );
    tableContainer.replaceChildren();
    const headers = isStayOperation
      ? ["Reservation ID", "Guest", "Contact", "Room", "Stay schedule", "Guests", "Stay status", "Recorded arrival/departure", "Total charges", "Service charges", "Paid", "Balance", "Actions"]
      : ["Reservation ID", "Guest", "Room assigned", "Check-in", "Check-out", "Guests", "Reservation date", "Total amount", "Status", "Actions"];
    makeTable(tableContainer, headers, filteredRows, (reservation, row) => {
      const invoice = invoiceByReservation.get(reservation.id);
      const nights = Math.max(0, Math.round((new Date(`${reservation.check_out}T00:00:00`) - new Date(`${reservation.check_in}T00:00:00`)) / 86400000));
      const estimatedRoomCharge = nights * Number(reservation.nightly_rate || 0);
      const serviceCharge = servicesByReservation.get(reservation.id) || 0;
      const invoiceTotal = invoice ? Number(invoice.total) : estimatedRoomCharge + serviceCharge;
      const paid = invoice ? (paidByInvoice.get(invoice.id) || 0) : 0;
      const balance = invoice?.status === "void" ? 0 : Math.max(0, invoiceTotal - paid);
      cell(row, reservation.id);
      cell(row, `${reservation.guests?.full_name || "Guest"}${reservation.guests?.email ? ` · ${reservation.guests.email}` : ""}`);
      if (isStayOperation) {
        cell(row, [
          reservation.guests?.phone,
          reservation.guests?.address,
          reservation.guests?.identification_type || reservation.guests?.identification_number
            ? `ID: ${[reservation.guests?.identification_type, reservation.guests?.identification_number].filter(Boolean).join(" ")}`
            : null
        ].filter(Boolean).join(" · ") || "—");
        cell(row, `${reservation.rooms?.room_number || "—"} · ${reservation.rooms?.room_types?.name || "Room"}`);
        cell(row, `In ${formatDate(reservation.check_in)} ${reservation.check_in_time || ""} · Out ${formatDate(reservation.check_out)} ${reservation.check_out_time || ""}`);
        cell(row, `${Number(reservation.adults || 0) + Number(reservation.children || 0)} (${reservation.adults} adult(s), ${reservation.children} child(ren))`);
        cell(row, humanize(reservation.status));
        cell(row, `In: ${reservation.checked_in_at ? new Date(reservation.checked_in_at).toLocaleString() : "Not recorded"} · Out: ${reservation.checked_out_at ? new Date(reservation.checked_out_at).toLocaleString() : "Not recorded"}`);
        cell(row, `${currency(invoiceTotal)}${invoice ? "" : " (estimated)"}`);
        cell(row, currency(serviceCharge));
        cell(row, currency(paid));
        cell(row, `${currency(balance)}${invoice?.status === "void" ? " (void invoice)" : ""}`);
        const actionCell = document.createElement("td");
        const transitionStatus = mode === "checkin" ? "reserved" : "checked_in";
        if (reservation.status === transitionStatus && ["admin", "manager", "receptionist"].includes(activeRole)) {
          const action = document.createElement("button");
          action.type = "button";
          action.className = "button button-primary button-small";
          action.textContent = mode === "checkin" ? "Authorize check-in" : "Authorize check-out";
          action.addEventListener("click", async () => {
            action.disabled = true;
            const { error } = await sb.rpc("transition_reservation", {
              p_reservation_id: reservation.id,
              p_status: mode === "checkin" ? "checked_in" : "checked_out"
            });
            if (error) {
              notify(error.message, "error");
              action.disabled = false;
              return;
            }
            notify(`Reservation ${mode === "checkin" ? "checked in" : "checked out"}.`);
            await renderModule(mode === "checkin" ? "Check-in" : "Check-out");
          });
          actionCell.appendChild(action);
        } else {
          actionCell.textContent = mode === "checkin" ? "Arrival recorded" : "Departure recorded";
        }
        row.appendChild(actionCell);
        return;
      }
      cell(row, `${reservation.rooms?.room_number || "—"} · ${reservation.rooms?.room_types?.name || "Room"}`);
      cell(row, formatDate(reservation.check_in));
      cell(row, formatDate(reservation.check_out));
      cell(row, `${Number(reservation.adults || 0) + Number(reservation.children || 0)} (${reservation.adults} adult(s), ${reservation.children} child(ren))`);
      cell(row, reservation.created_at ? new Date(reservation.created_at).toLocaleString() : "—");
      const total = invoiceTotals.has(reservation.id)
        ? currency(invoiceTotals.get(reservation.id))
        : `${currency(estimatedRoomCharge + serviceCharge)} (estimated)`;
      cell(row, total);
      cell(row, humanize(reservation.status));
      const actions = document.createElement("td");
      if (isAdmin) {
        if (reservation.status === "pending") {
          const approve = document.createElement("button");
          approve.type = "button";
          approve.className = "button button-primary button-small";
          approve.textContent = "Approve";
          approve.addEventListener("click", async () => {
            approve.disabled = true;
            const { error } = await sb.rpc("transition_reservation", {
              p_reservation_id: reservation.id,
              p_status: "reserved"
            });
            if (error) {
              notify(error.message, "error");
              approve.disabled = false;
              return;
            }
            notify("Reservation approved and confirmed.");
            await renderModule("Reservations");
          });
          actions.appendChild(approve);
        }
        if (["pending", "reserved"].includes(reservation.status)) {
          const edit = document.createElement("button");
          edit.type = "button";
          edit.className = "button button-outline button-small";
          edit.textContent = "Modify";
          edit.addEventListener("click", () => {
            editingReservation = reservation;
            if (!Array.from(roomField.input.options).some((option) => option.value === reservation.room_id)) {
              const assignedRoom = rooms.find((room) => room.id === reservation.room_id);
              if (assignedRoom) {
                roomField.input.appendChild(new Option(
                  `${assignedRoom.room_number} · ${assignedRoom.room_types?.name || "Room"} · ${currency(assignedRoom.room_types?.nightly_rate)} (current assignment)`,
                  assignedRoom.id
                ));
              }
            }
            guestField.input.value = reservation.guest_id;
            roomField.input.value = reservation.room_id;
            checkInField.input.value = reservation.check_in;
            checkOutField.input.value = reservation.check_out;
            adultsField.input.value = reservation.adults;
            childrenField.input.value = reservation.children;
            reservationFormButton.textContent = "Save reservation";
            cancelEditButton.hidden = false;
            reservationForm.scrollIntoView({ behavior: "smooth", block: "start" });
          });
          actions.appendChild(edit);
        }
        if (["pending", "reserved"].includes(reservation.status)) {
          const cancel = document.createElement("button");
          cancel.type = "button";
          cancel.className = "button button-outline button-small";
          cancel.textContent = "Cancel";
          cancel.addEventListener("click", async () => {
            cancel.disabled = true;
            const { error } = await sb.rpc("transition_reservation", {
              p_reservation_id: reservation.id,
              p_status: "cancelled"
            });
            if (error) {
              notify(error.message, "error");
              cancel.disabled = false;
              return;
            }
            notify("Reservation cancelled.");
            await renderModule("Reservations");
          });
          actions.appendChild(cancel);
        }
      } else if (mode === "all" && ["admin", "manager", "receptionist", "reservation_officer"].includes(activeRole)) {
        const invoice = document.createElement("button");
        invoice.type = "button";
        invoice.className = "button button-outline button-small";
        invoice.textContent = "Create invoice";
        invoice.addEventListener("click", async () => {
          const { data, error } = await sb.rpc("create_invoice", { p_reservation_id: reservation.id });
          if (error) notify(error.message, "error");
          else {
            notify(`Invoice created: ${data}`);
            await renderModule("Reservations");
          }
        });
        actions.appendChild(invoice);
      } else if (mode && tableRows.includes(reservation)
        && (isGuest || ["admin", "manager", "receptionist", "reservation_officer"].includes(activeRole))) {
        const button = document.createElement("button");
        button.className = "button button-outline button-small";
        button.type = "button";
        button.textContent = mode === "checkin" ? "Check in" : mode === "checkout" ? "Check out" : "Cancel";
        button.addEventListener("click", async () => {
          button.disabled = true;
          const { error } = isGuest
            ? await sb.rpc("cancel_own_reservation", { p_reservation_id: reservation.id })
            : await sb.rpc("transition_reservation", {
              p_reservation_id: reservation.id,
              p_status: mode === "checkin" ? "checked_in" : mode === "checkout" ? "checked_out" : "cancelled"
            });
          if (error) {
            notify(error.message, "error");
            button.disabled = false;
            return;
          }
          notify(`Reservation ${humanize(mode === "checkin" ? "checked_in" : mode === "checkout" ? "checked_out" : "cancelled")}.`);
          await renderModule(mode === "checkin" ? "Check-in" : mode === "checkout" ? "Check-out" : isGuest ? "My Reservations" : "Cancellation");
        });
        actions.appendChild(button);
      }
      row.appendChild(actions);
    });
  };
  [statusFilter.input, fromFilter.input, toFilter.input].forEach((input) => input.addEventListener("change", drawTable));
  drawTable();

  if (isAdmin) {
    const upcoming = rows
      .filter((reservation) => ["pending", "reserved"].includes(reservation.status) && reservation.check_out >= todayLocal())
      .sort((left, right) => left.check_in.localeCompare(right.check_in));
    const schedulePanel = addPanel(content, "Upcoming reservation schedule", `${upcoming.length} upcoming stay(s).`);
    makeTable(schedulePanel, ["Arrival", "Departure", "Guest", "Room", "Status"], upcoming, (reservation, row) => {
      cell(row, formatDate(reservation.check_in));
      cell(row, formatDate(reservation.check_out));
      cell(row, reservation.guests?.full_name || "Guest");
      cell(row, reservation.rooms?.room_number);
      cell(row, humanize(reservation.status));
    });
  }
}

async function renderGuestRegistration(content) {
  const isGuest = activeRole === "guest";
  const limited = activeRole === "accountant";
  const panel = addPanel(content, "Guest registration", isGuest ? "View and update your own guest contact details." : limited ? "Limited guest details associated with invoice records." : "Register and update guest contact and identification details, search the guest register, and review reservation history.");
  const selection = limited
    ? "id,full_name,email,phone,created_at"
    : "id,profile_id,full_name,email,phone,address,identification_type,identification_number,notes,created_at";
  let guestQuery = sb.from("guests").select(selection).order("full_name");
  if (isGuest) guestQuery = guestQuery.eq("profile_id", currentUser.id);
  const guestResult = await guestQuery;
  if (guestResult.error) throw new Error(guestResult.error.message);
  const rows = guestResult.data || [];
  const reservations = !limited ? await loadRowsByRole("reservations", "id,guest_id,room_id,check_in,check_out,status,rooms(room_number)", "check_in") : [];
  const name = makeInput("Full name", "guestName");
  const email = makeInput("Email", "guestEmail", "email", false);
  const phone = makeInput("Phone", "guestPhone", "tel", false);
  const address = makeInput("Address", "guestAddress", "textarea", false);
  const identificationType = makeInput("Identification type", "guestIdentificationType", "text", false);
  const identificationNumber = makeInput("Identification details", "guestIdentificationNumber", "text", false);
  const notes = makeInput("Guest notes", "guestNotes", "textarea", false);
  let editingGuestId = isGuest ? rows[0]?.id || null : null;
  const canEdit = isGuest ? Boolean(editingGuestId) : ["admin", "manager", "receptionist", "reservation_officer"].includes(activeRole);
  if (isGuest && editingGuestId) {
    name.input.value = rows[0].full_name || "";
    email.input.value = rows[0].email || "";
    phone.input.value = rows[0].phone || "";
    address.input.value = rows[0].address || "";
    identificationType.input.value = rows[0].identification_type || "";
    identificationNumber.input.value = rows[0].identification_number || "";
    notes.input.value = rows[0].notes || "";
  }
  if (canEdit) {
  const guestForm = makeForm(panel, [name, email, phone, ...(isGuest ? [address] : [address, identificationType, identificationNumber, notes])], isGuest ? "Update my details" : "Register guest", async (form) => {
    const values = {
      full_name: name.input.value.trim(),
      email: email.input.value.trim() || null,
      phone: phone.input.value.trim() || null,
      address: address.input.value.trim() || null
    };
    if (!isGuest) {
      values.identification_type = identificationType.input.value.trim() || null;
      values.identification_number = identificationNumber.input.value.trim() || null;
      values.notes = notes.input.value.trim() || null;
    }
    const result = editingGuestId
      ? await sb.from("guests").update(values).eq("id", editingGuestId).select("id").single()
      : await sb.from("guests").insert(values).select("id").single();
    const { error } = result;
    if (error) {
      notify(error.message, "error");
      return;
    }
    notify(editingGuestId ? "Guest information updated." : "Guest registered.");
    editingGuestId = null;
    form.reset();
    guestFormButton.textContent = "Register guest";
    cancelGuestEdit.hidden = true;
    await renderModule("Customers / Guests");
  });
  const guestFormButton = guestForm.querySelector('button[type="submit"]');
  const cancelGuestEdit = document.createElement("button");
  cancelGuestEdit.type = "button";
  cancelGuestEdit.className = "button button-outline button-small";
  cancelGuestEdit.textContent = "Cancel edit";
  cancelGuestEdit.hidden = true;
  cancelGuestEdit.addEventListener("click", () => {
    editingGuestId = null;
    guestForm.reset();
    guestFormButton.textContent = "Register guest";
    cancelGuestEdit.hidden = true;
  });
  if (!isGuest) guestForm.querySelector(".form-actions").appendChild(cancelGuestEdit);
  }
  const search = makeInput("Search guests", "guestSearch", "search", false);
  const searchToolbar = document.createElement("div");
  searchToolbar.className = "toolbar";
  searchToolbar.appendChild(search.wrapper);
  const listPanel = addPanel(content, "Guest register", `${rows.length} registered guest(s).`);
  listPanel.appendChild(searchToolbar);
  const guestTable = document.createElement("div");
  listPanel.appendChild(guestTable);
  const historyPanel = addPanel(content, "Guest reservation history", isGuest ? "Your reservation history." : "Select a guest's history to review their stays.");
  historyPanel.hidden = limited;
  const historyContent = document.createElement("div");
  historyPanel.appendChild(historyContent);
  const drawGuests = () => {
    const query = search.input.value.trim().toLowerCase();
    const filtered = rows.filter((guest) => [
      guest.id, guest.full_name, guest.email, guest.phone, guest.address,
      guest.identification_type, guest.identification_number
    ].some((value) => String(value || "").toLowerCase().includes(query)));
    guestTable.replaceChildren();
    const headers = limited
      ? ["Guest ID", "Full name", "Phone", "Email", "Registered"]
      : ["Guest ID", "Full name", "Phone", "Email", "Address", "Identification", "Registered", ...(canEdit && !isGuest ? ["Actions"] : [])];
    makeTable(guestTable, headers, filtered, (guest, row) => {
      cell(row, guest.id);
      cell(row, guest.full_name);
      cell(row, guest.phone);
      cell(row, guest.email);
      if (!limited) {
        cell(row, guest.address);
        cell(row, [guest.identification_type, guest.identification_number].filter(Boolean).join(" · "));
      }
      cell(row, new Date(guest.created_at).toLocaleDateString());
      if (canEdit && !isGuest) {
      const actions = document.createElement("td");
      const edit = document.createElement("button");
      edit.type = "button";
      edit.className = "button button-outline button-small";
      edit.textContent = "Edit";
      edit.addEventListener("click", () => {
        editingGuestId = guest.id;
        name.input.value = guest.full_name || "";
        email.input.value = guest.email || "";
        phone.input.value = guest.phone || "";
        address.input.value = guest.address || "";
        identificationType.input.value = guest.identification_type || "";
        identificationNumber.input.value = guest.identification_number || "";
        notes.input.value = guest.notes || "";
        guestFormButton.textContent = "Save guest";
        cancelGuestEdit.hidden = false;
        guestForm.scrollIntoView({ behavior: "smooth", block: "start" });
      });
      const history = document.createElement("button");
      history.type = "button";
      history.className = "button button-outline button-small";
      history.textContent = "History";
      history.addEventListener("click", () => {
        const stays = reservations.filter((reservation) => reservation.guest_id === guest.id);
        historyContent.replaceChildren();
        const heading = document.createElement("p");
        heading.textContent = `${guest.full_name} · ${stays.length} reservation(s)`;
        historyContent.appendChild(heading);
        makeTable(historyContent, ["Reservation ID", "Room", "Check-in", "Check-out", "Status"], stays, (reservation, historyRow) => {
          cell(historyRow, reservation.id);
          cell(historyRow, reservation.rooms?.room_number || "—");
          cell(historyRow, formatDate(reservation.check_in));
          cell(historyRow, formatDate(reservation.check_out));
          cell(historyRow, humanize(reservation.status));
        });
        historyPanel.scrollIntoView({ behavior: "smooth", block: "start" });
      });
      actions.append(edit, history);
      row.appendChild(actions);
      } else if (isGuest) {
        const stays = reservations.filter((reservation) => reservation.guest_id === guest.id);
        historyContent.replaceChildren();
        makeTable(historyContent, ["Reservation ID", "Room", "Check-in", "Check-out", "Status"], stays, (reservation, historyRow) => {
          cell(historyRow, reservation.id);
          cell(historyRow, reservation.rooms?.room_number || "—");
          cell(historyRow, formatDate(reservation.check_in));
          cell(historyRow, formatDate(reservation.check_out));
          cell(historyRow, humanize(reservation.status));
        });
      }
    });
  };
  search.input.addEventListener("input", drawGuests);
  search.wrapper.hidden = isGuest || limited;
  drawGuests();
}

async function renderRooms(content, title = "Room management") {
  const { content: page } = setContentTitle(title, "Add, update, and deactivate rooms; manage room types, rates, capacity, and inventory details.");
  const canManage = ["admin", "manager"].includes(activeRole);
  const types = await loadRowsByRole("room_types", "id,name,description,capacity,nightly_rate,active", "name");
  const typeOptions = [["", "Choose a room type"], ...types
    .map((type) => [type.id, `${type.name}${type.active ? "" : " · Deactivated"} · ${currency(type.nightly_rate)}`])];

  if (canManage) {
    if (activeRole === "manager") {
    const typePanel = addPanel(page, "Room types", "Room type descriptions, occupancy limits, and rates apply to every room in that type.");
    const typeName = makeInput("Type name", "typeName");
    const typeDescription = makeInput("Description", "typeDescription", "textarea", false);
    const typeCapacity = makeInput("Maximum occupancy", "typeCapacity", "number");
    typeCapacity.input.min = "1";
    typeCapacity.input.step = "1";
    const typeRate = makeInput("Nightly rate", "typeRate", "number");
    typeRate.input.min = "0";
    typeRate.input.step = "0.01";
    const typeActive = makeSelect("Availability", "typeActive", [["true", "Active"], ["false", "Deactivated"]]);
    let editingTypeId = null;
    const typeForm = makeForm(typePanel, [typeName, typeDescription, typeCapacity, typeRate, typeActive], "Add room type", async (form) => {
      const editing = Boolean(editingTypeId);
      const values = {
        name: typeName.input.value.trim(),
        description: typeDescription.input.value.trim() || null,
        capacity: Number(typeCapacity.input.value),
        nightly_rate: Number(typeRate.input.value),
        active: typeActive.input.value === "true"
      };
      const result = editing
        ? await sb.from("room_types").update(values).eq("id", editingTypeId)
        : await sb.from("room_types").insert(values);
      if (result.error) {
        notify(result.error.message, "error");
        return;
      }
      notify(editing ? "Room type updated." : "Room type added.");
      form.reset();
      editingTypeId = null;
      typeFormButton.textContent = "Add room type";
      await renderModule(title);
    });
    const typeFormButton = typeForm.querySelector('button[type="submit"]');
    const cancelTypeEdit = document.createElement("button");
    cancelTypeEdit.type = "button";
    cancelTypeEdit.className = "button button-outline button-small";
    cancelTypeEdit.textContent = "Cancel edit";
    cancelTypeEdit.hidden = true;
    cancelTypeEdit.addEventListener("click", () => {
      typeForm.reset();
      editingTypeId = null;
      typeFormButton.textContent = "Add room type";
      cancelTypeEdit.hidden = true;
    });
    typeForm.querySelector(".form-actions").appendChild(cancelTypeEdit);

    const typeRowsPanel = addPanel(page, "Room type list", "");
    makeTable(typeRowsPanel, ["Type", "Description", "Maximum occupancy", "Nightly rate", "Status", "Actions"], types, (type, row) => {
      cell(row, type.name);
      cell(row, type.description);
      cell(row, type.capacity);
      cell(row, currency(type.nightly_rate));
      cell(row, type.active ? "Active" : "Deactivated");
      const actions = document.createElement("td");
      const edit = document.createElement("button");
      edit.type = "button";
      edit.className = "button button-outline button-small";
      edit.textContent = "Edit";
      edit.addEventListener("click", () => {
        editingTypeId = type.id;
        typeName.input.value = type.name;
        typeDescription.input.value = type.description || "";
        typeCapacity.input.value = type.capacity;
        typeRate.input.value = type.nightly_rate;
        typeActive.input.value = String(type.active);
        typeFormButton.textContent = "Save room type";
        cancelTypeEdit.hidden = false;
        typePanel.scrollIntoView({ behavior: "smooth", block: "start" });
      });
      actions.appendChild(edit);
      row.appendChild(actions);
    });

    }

    const roomPanel = addPanel(page, "Add a room", "Room descriptions and amenities are specific to each room. Image uploads are limited to 5 MB.");
    const roomNumber = makeInput("Room number", "roomNumber");
    const roomType = makeSelect("Room type", "roomType", typeOptions);
    const floor = makeInput("Floor", "roomFloor", "number", false);
    const roomStatus = makeSelect("Status", "roomStatus", [
      ["available", "Available"],
      ["reserved", "Reserved"],
      ["occupied", "Occupied"],
      ["cleaning", "Under Cleaning"],
      ["maintenance", "Under Maintenance"],
      ["out_of_service", "Out of Service"],
      ["inactive", "Deactivated"]
    ]);
    const roomDescription = makeInput("Room description", "roomDescription", "textarea", false);
    const amenities = makeInput("Room amenities (comma-separated)", "roomAmenities", "text", false);
    const image = makeInput("Room image", "roomImage", "file", false);
    image.input.accept = "image/jpeg,image/png,image/webp,image/avif";
    const imagePreview = document.createElement("div");
    imagePreview.className = "room-image-preview";
    image.wrapper.appendChild(imagePreview);
    let previewUrl = null;
    image.input.addEventListener("change", () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      previewUrl = null;
      imagePreview.replaceChildren();
      const file = image.input.files?.[0];
      if (!file) return;
      const preview = document.createElement("img");
      previewUrl = URL.createObjectURL(file);
      preview.src = previewUrl;
      preview.alt = "Selected room image preview";
      imagePreview.appendChild(preview);
    });
    let editingRoom = null;
    const roomForm = makeForm(roomPanel, [roomNumber, roomType, floor, roomStatus, roomDescription, amenities, image], "Add room", async (form) => {
      const existing = editingRoom;
      const file = image.input.files?.[0];
      if (file && (!["image/jpeg", "image/png", "image/webp", "image/avif"].includes(file.type) || file.size > 5 * 1024 * 1024)) {
        notify("Choose a JPEG, PNG, WebP, or AVIF image up to 5 MB.", "error");
        return;
      }
      const selectedType = types.find((type) => type.id === roomType.input.value);
      if (!selectedType || (!selectedType.active && selectedType.id !== editingRoom?.room_type_id)) {
        notify("Select an active room type first.", "error");
        return;
      }
      const roomValues = {
        room_number: roomNumber.input.value.trim(),
        room_type_id: roomType.input.value,
        floor: floor.input.value ? Number(floor.input.value) : null,
        status: roomStatus.input.value,
        notes: roomDescription.input.value.trim() || null,
        amenities: amenities.input.value.split(",").map((item) => item.trim()).filter(Boolean)
      };
      const saved = existing
        ? await sb.from("rooms").update(roomValues).eq("id", existing.id).select("id").single()
        : await sb.from("rooms").insert(roomValues).select("id").single();
      if (saved.error) {
        notify(saved.error.message, "error");
        return;
      }
      const roomId = existing?.id || saved.data.id;
      let newImagePath = null;
      let imageCleanupWarning = null;
      if (file) {
        const extension = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/avif": "avif" }[file.type];
        newImagePath = `${roomId}/${crypto.randomUUID()}.${extension}`;
        const { error: uploadError } = await sb.storage.from("room-images").upload(newImagePath, file, {
          cacheControl: "3600",
          contentType: file.type,
          upsert: false
        });
        if (uploadError) {
          notify(`Room was saved, but its image could not be uploaded: ${uploadError.message}`, "error");
          await renderModule(title);
          return;
        }
        const { error: imageUpdateError } = await sb.from("rooms").update({ image_path: newImagePath }).eq("id", roomId);
        if (imageUpdateError) {
          const { error: cleanupError } = await sb.storage.from("room-images").remove([newImagePath]);
          const cleanupMessage = cleanupError ? ` Uploaded file cleanup also failed: ${cleanupError.message}` : "";
          notify(`Room was saved, but its image path could not be recorded: ${imageUpdateError.message}.${cleanupMessage}`, "error");
          await renderModule(title);
          return;
        }
        if (existing?.image_path) {
          const { error: removeError } = await sb.storage.from("room-images").remove([existing.image_path]);
          if (removeError) imageCleanupWarning = `Room image updated, but the previous image could not be removed: ${removeError.message}`;
        }
      }
      notify(imageCleanupWarning || (existing ? "Room updated." : "Room added."), imageCleanupWarning ? "error" : "success");
      form.reset();
      editingRoom = null;
      imagePreview.replaceChildren();
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      previewUrl = null;
      roomFormButton.textContent = "Add room";
      cancelRoomEdit.hidden = true;
      await renderModule(title);
    });
    const roomFormButton = roomForm.querySelector('button[type="submit"]');
    const cancelRoomEdit = document.createElement("button");
    cancelRoomEdit.type = "button";
    cancelRoomEdit.className = "button button-outline button-small";
    cancelRoomEdit.textContent = "Cancel edit";
    cancelRoomEdit.hidden = true;
    cancelRoomEdit.addEventListener("click", () => {
      roomForm.reset();
      editingRoom = null;
      roomFormButton.textContent = "Add room";
      cancelRoomEdit.hidden = true;
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      previewUrl = null;
      imagePreview.replaceChildren();
    });
    roomForm.querySelector(".form-actions").appendChild(cancelRoomEdit);

    if (activeRole === "manager") {
    const servicePanel = addPanel(page, "Guest services", "Configure charges available for posting to a guest reservation.");
    const serviceName = makeInput("Service name", "serviceName");
    const serviceDescription = makeInput("Description", "serviceDescription", "textarea", false);
    const servicePrice = makeInput("Unit price", "servicePrice", "number");
    servicePrice.input.min = "0";
    servicePrice.input.step = "0.01";
    makeForm(servicePanel, [serviceName, serviceDescription, servicePrice], "Add service", async (form) => {
      const { error } = await sb.from("services").insert({
        name: serviceName.input.value.trim(),
        description: serviceDescription.input.value.trim() || null,
        unit_price: Number(servicePrice.input.value)
      });
      if (error) notify(error.message, "error");
      else { notify("Service added."); form.reset(); renderModule(title); }
    });
    const services = await loadRowsByRole("services", "id,name,description,unit_price", "name");
    makeTable(servicePanel, ["Service", "Description", "Unit price"], services, (service, row) => {
      cell(row, service.name);
      cell(row, service.description);
      cell(row, currency(service.unit_price));
    });

    }

    const roomRowsPanel = addPanel(page, "Room inventory", "");
    const rooms = await loadRowsByRole(
      "rooms",
      "id,room_number,floor,status,notes,amenities,image_path,room_type_id,room_types(name,description,capacity,nightly_rate,active)",
      "room_number"
    );
    const roomCount = document.createElement("p");
    roomCount.className = "muted-note";
    roomCount.textContent = `${rooms.length} room(s)`;
    roomRowsPanel.appendChild(roomCount);
    makeTable(roomRowsPanel, ["Image", "Room ID", "Room number", "Room type", "Rate", "Maximum occupancy", "Description", "Amenities", "Status", "Actions"], rooms, (room, row) => {
      const imageCell = document.createElement("td");
      if (room.image_path) {
        const { data } = sb.storage.from("room-images").getPublicUrl(room.image_path);
        const photo = document.createElement("img");
        photo.className = "room-inventory-image";
        photo.src = data.publicUrl;
        photo.alt = `${room.room_number} room`;
        imageCell.appendChild(photo);
      } else {
        imageCell.textContent = "—";
      }
      row.appendChild(imageCell);
      cell(row, room.id);
      cell(row, room.room_number);
      cell(row, room.room_types?.name);
      cell(row, currency(room.room_types?.nightly_rate));
      cell(row, room.room_types?.capacity);
      cell(row, room.notes || room.room_types?.description);
      cell(row, (room.amenities || []).join(", "));
      cell(row, ({
        cleaning: "Under Cleaning",
        maintenance: "Under Maintenance",
        out_of_service: "Out of Service",
        inactive: "Deactivated"
      })[room.status] || humanize(room.status));
      const actions = document.createElement("td");
      const edit = document.createElement("button");
      edit.type = "button";
      edit.className = "button button-outline button-small";
      edit.textContent = "Edit";
      edit.addEventListener("click", () => {
        editingRoom = room;
        roomNumber.input.value = room.room_number;
        roomType.input.value = room.room_type_id;
        floor.input.value = room.floor ?? "";
        roomStatus.input.value = room.status;
        roomDescription.input.value = room.notes || "";
        amenities.input.value = (room.amenities || []).join(", ");
        image.input.value = "";
        if (previewUrl) URL.revokeObjectURL(previewUrl);
        previewUrl = null;
        imagePreview.replaceChildren();
        if (room.image_path) {
          const { data } = sb.storage.from("room-images").getPublicUrl(room.image_path);
          const currentImage = document.createElement("img");
          currentImage.src = data.publicUrl;
          currentImage.alt = `Current image for room ${room.room_number}`;
          imagePreview.appendChild(currentImage);
        }
        roomFormButton.textContent = "Save room";
        cancelRoomEdit.hidden = false;
        roomPanel.scrollIntoView({ behavior: "smooth", block: "start" });
      });
      actions.appendChild(edit);
      const deactivate = document.createElement("button");
      deactivate.type = "button";
      deactivate.className = "button button-outline button-small";
      deactivate.textContent = room.status === "inactive" ? "Reactivate" : "Deactivate";
      deactivate.addEventListener("click", async () => {
        const nextStatus = room.status === "inactive" ? "available" : "inactive";
        const { error } = await sb.from("rooms").update({ status: nextStatus }).eq("id", room.id);
        if (error) notify(error.message, "error");
        else { notify(room.status === "inactive" ? "Room reactivated." : "Room deactivated."); await renderModule(title); }
      });
      actions.appendChild(deactivate);
      row.appendChild(actions);
    });
  } else {
    const rooms = await loadRowsByRole(
      "rooms",
      "id,room_number,floor,status,notes,amenities,image_path,room_type_id,room_types(name,description,capacity,nightly_rate,active)",
      "room_number"
    );
    const panel = addPanel(page, "Room inventory", `${rooms.length} room(s)`);
    makeTable(panel, ["Image", "Room ID", "Room number", "Room type", "Rate", "Maximum occupancy", "Description", "Amenities", "Status"], rooms, (room, row) => {
      const imageCell = document.createElement("td");
      if (room.image_path) {
        const { data } = sb.storage.from("room-images").getPublicUrl(room.image_path);
        const photo = document.createElement("img");
        photo.className = "room-inventory-image";
        photo.src = data.publicUrl;
        photo.alt = `${room.room_number} room`;
        imageCell.appendChild(photo);
      } else imageCell.textContent = "—";
      row.appendChild(imageCell);
      cell(row, room.id);
      cell(row, room.room_number);
      cell(row, room.room_types?.name);
      cell(row, currency(room.room_types?.nightly_rate));
      cell(row, room.room_types?.capacity);
      cell(row, room.notes || room.room_types?.description);
      cell(row, (room.amenities || []).join(", "));
      cell(row, humanize(room.status));
    });
  }
}

async function renderFacilities(content) {
  const { content: page } = setContentTitle("Facilities & amenities", "Manage guest services and amenities offered with stays.");
  const panel = addPanel(page, "Guest services and amenities", "These services can be posted to a guest reservation.");
  const serviceName = makeInput("Service name", "facilityName");
  const serviceDescription = makeInput("Description", "facilityDescription", "textarea", false);
  const servicePrice = makeInput("Unit price", "facilityPrice", "number");
  servicePrice.input.min = "0";
  servicePrice.input.step = "0.01";
  if (activeRole === "manager") makeForm(panel, [serviceName, serviceDescription, servicePrice], "Add service", async (form) => {
    const { error } = await sb.from("services").insert({
      name: serviceName.input.value.trim(),
      description: serviceDescription.input.value.trim() || null,
      unit_price: Number(servicePrice.input.value)
    });
    if (error) notify(error.message, "error");
    else { notify("Service added."); form.reset(); renderModule("Facilities & Amenities"); }
  });
  const services = await loadRowsByRole("services", "id,name,description,unit_price,active", "name");
  makeTable(panel, ["Service", "Description", "Unit price", "Status"], services, (service, row) => {
    cell(row, service.name);
    cell(row, service.description);
    cell(row, currency(service.unit_price));
    cell(row, service.active ? "Active" : "Inactive");
  });
}

async function renderRoomAssignment(content) {
  const panel = addPanel(content, "Room assignment & transfers", "Review each active reservation's room, reservation ID, guest, assignment time, and occupancy schedule. Room transfers are checked against overlapping stays in the database.");
  const reservations = await loadRowsByRole("reservations", "id,room_id,check_in,check_out,status,room_assigned_at,guests(full_name),rooms(room_number,status)", "check_in");
  const rooms = await loadRowsByRole("rooms", "id,room_number,status,room_types(name)", "room_number");
  const canTransfer = ["admin", "manager", "receptionist"].includes(activeRole);
  makeTable(panel, ["Reservation ID", "Guest", "Stay schedule", "Assigned room", "Room status", "Reservation status", "Assignment date", "Transfer room"], reservations.filter((item) => ["reserved", "checked_in"].includes(item.status)), (reservation, row) => {
    cell(row, reservation.id);
    cell(row, reservation.guests?.full_name);
    cell(row, `${formatDate(reservation.check_in)} – ${formatDate(reservation.check_out)}`);
    cell(row, reservation.rooms?.room_number);
    cell(row, reservation.status === "checked_in" ? "Occupied (current stay)" : reservation.status === "reserved" ? "Reserved" : humanize(reservation.rooms?.status || "unknown"));
    cell(row, humanize(reservation.status));
    cell(row, reservation.room_assigned_at ? new Date(reservation.room_assigned_at).toLocaleString() : "—");
    if (canTransfer) {
      const td = document.createElement("td");
      const select = document.createElement("select");
      rooms.filter((room) => room.status === "available" || room.id === reservation.room_id).forEach((room) => {
        select.appendChild(new Option(`${room.room_number} · ${room.room_types?.name || ""}`, room.id, false, room.id === reservation.room_id));
      });
      select.addEventListener("change", async () => {
        const { error } = await sb.rpc("assign_reservation_room", {
          p_reservation_id: reservation.id,
          p_room_id: select.value
        });
        if (error) {
          notify(error.message, "error");
          select.value = reservation.room_id;
          return;
        }
        notify("Room assignment updated.");
        renderModule("Room Assignment");
      });
      td.appendChild(select);
      row.appendChild(td);
    } else {
      cell(row, "View only");
    }
  });
}

async function renderHousekeeping(content) {
  const rooms = await loadRowsByRole("rooms", "id,room_number,status", "room_number");
  const canCreate = ["admin", "manager"].includes(activeRole);
  const panel = addPanel(content, "Housekeeping", canCreate ? "Create and assign cleaning tasks; track progress without exposing invoice or payment details." : activeRole === "housekeeping" ? "View and update your assigned housekeeping tasks." : "View housekeeping task status.");
  if (canCreate) {
    const employees = await loadRowsByRole("profiles", "id,full_name,roles!inner(name)", "full_name");
    const housekeepers = employees.filter((employee) => employee.roles?.name === "housekeeping");
    const room = makeSelect("Room", "taskRoom", rooms.map((item) => [item.id, `${item.room_number} · ${humanize(item.status)}`]));
    const assignee = makeSelect("Assign to", "taskAssignee", [["", "Unassigned"], ...housekeepers.map((employee) => [employee.id, employee.full_name])], false);
    const type = makeSelect("Task type", "taskType", [["cleaning", "Room cleaning"], ["turn_down", "Turn-down service"], ["inspection", "Inspection"]]);
    const notes = makeInput("Task notes", "taskNotes", "textarea", false);
    makeForm(panel, [room, assignee, type, notes], "Create task", async (form) => {
      const { error } = await sb.from("housekeeping_tasks").insert({
        room_id: room.input.value, assigned_to: assignee.input.value || null,
        task_type: type.input.value, notes: notes.input.value.trim() || null
      });
      if (error) notify(error.message, "error");
      else { notify("Housekeeping task created."); form.reset(); renderModule("Housekeeping"); }
    });
  }
  const tasks = await loadRowsByRole("housekeeping_tasks", "id,room_id,assigned_to,task_type,status,notes,scheduled_for,rooms(room_number)", "scheduled_for");
  makeTable(panel, ["Room", "Task", "Scheduled", "Notes", "Status", "Update"], tasks, (task, row) => {
    cell(row, task.rooms?.room_number);
    cell(row, humanize(task.task_type));
    cell(row, new Date(task.scheduled_for).toLocaleString());
    cell(row, task.notes);
    cell(row, humanize(task.status));
    if (["admin", "manager"].includes(activeRole) || (activeRole === "housekeeping" && task.assigned_to === currentUser.id)) {
      const td = document.createElement("td");
      const select = makeSelect("", `task-${task.id}`, [["pending", "Pending"], ["in_progress", "In progress"], ["completed", "Completed"]], true).input;
      select.value = task.status;
      select.addEventListener("change", async () => {
        const update = { status: select.value, completed_at: select.value === "completed" ? new Date().toISOString() : null };
        const { error } = await sb.from("housekeeping_tasks").update(update).eq("id", task.id);
        if (error) notify(error.message, "error");
        else { notify("Task status updated."); renderModule("Housekeeping"); }
      });
      td.appendChild(select);
      row.appendChild(td);
    } else {
      cell(row, "View only");
    }
  });
}

async function renderMaintenance(content) {
  const canReport = ["guest", "receptionist", "housekeeping", "maintenance", "manager", "admin"].includes(activeRole);
  const canManage = ["maintenance", "manager", "admin"].includes(activeRole);
  const rooms = canReport ? await loadRowsByRole("rooms", "id,room_number", "room_number") : [];
  const panel = addPanel(content, "Maintenance requests", "Report and track property repairs. Financial records are not available in this workspace.");
  if (canReport) {
    const title = makeInput("Issue", "maintenanceTitle");
    const room = makeSelect("Room", "maintenanceRoom", [["", "Common area / not room-specific"], ...rooms.map((item) => [item.id, item.room_number])], false);
    const priority = makeSelect("Priority", "maintenancePriority", [["low", "Low"], ["normal", "Normal"], ["high", "High"], ["urgent", "Urgent"]]);
    const description = makeInput("Description", "maintenanceDescription", "textarea", false);
    makeForm(panel, [title, room, priority, description], "Submit request", async (form) => {
      const { error } = await sb.from("maintenance_requests").insert({
        title: title.input.value.trim(), room_id: room.input.value || null,
        priority: priority.input.value, description: description.input.value.trim() || null,
        reported_by: currentUser.id
      });
      if (error) notify(error.message, "error");
      else { notify("Maintenance request submitted."); form.reset(); renderModule("Maintenance Requests"); }
    });
  }
  const rows = await loadRowsByRole("maintenance_requests", "id,title,priority,status,description,created_at,assigned_to,rooms(room_number)", "created_at");
  makeTable(panel, ["Issue", "Room", "Priority", "Reported", "Description", "Status", ...(canManage ? ["Update"] : [])], rows, (request, row) => {
    cell(row, request.title);
    cell(row, request.rooms?.room_number || "Common area");
    cell(row, humanize(request.priority));
    cell(row, new Date(request.created_at).toLocaleDateString());
    cell(row, request.description);
    cell(row, humanize(request.status));
    if (canManage) {
      const td = document.createElement("td");
      const select = makeSelect("", `maintenance-${request.id}`, [["open", "Open"], ["in_progress", "In progress"], ["resolved", "Resolved"]]).input;
      select.value = request.status;
      select.addEventListener("change", async () => {
        const { error } = await sb.from("maintenance_requests").update({
          status: select.value, resolved_at: select.value === "resolved" ? new Date().toISOString() : null
        }).eq("id", request.id);
        if (error) notify(error.message, "error");
        else { notify("Request updated."); renderModule("Maintenance Requests"); }
      });
      td.appendChild(select);
      row.appendChild(td);
    }
  });
}

async function renderBilling(content, paymentOnly = false) {
  const panel = addPanel(content, paymentOnly ? "Payments" : "Billing & invoices", "Invoices and payment records are restricted to authorized financial roles and each guest's own records.");
  const invoices = await loadRowsByRole("invoices", "id,invoice_number,reservation_id,subtotal,discount_amount,tax_amount,total,status,issued_at", "issued_at");
  if (!paymentOnly && ["manager", "accountant", "receptionist"].includes(activeRole)) {
    const reservations = await loadRowsByRole("reservations", "id,check_in,check_out,status,guests(full_name),rooms(room_number)", "check_in");
    const candidates = reservations.filter((reservation) =>
      !invoices.some((invoice) => invoice.reservation_id === reservation.id)
      && !["cancelled", "no_show"].includes(reservation.status)
    );
    if (["manager", "receptionist"].includes(activeRole)) {
      const services = await loadRowsByRole("services", "id,name,unit_price", "name");
      const activeReservations = candidates.filter((item) => ["reserved", "checked_in"].includes(item.status));
      const serviceReservation = makeSelect("Reservation", "serviceReservation", activeReservations.map((item) => [item.id, `${item.guests?.full_name || "Guest"} · ${item.rooms?.room_number || ""} · ${formatDate(item.check_in)}`]));
      const service = makeSelect("Service", "usageService", services.map((item) => [item.id, `${item.name} · ${currency(item.unit_price)}`]));
      const quantity = makeInput("Quantity", "serviceQuantity", "number");
      quantity.input.min = "0.01";
      quantity.input.max = "1000";
      quantity.input.step = "0.01";
      quantity.input.value = "1";
      const usagePanel = addPanel(content, "Post a guest service", "The database uses the configured service price, not a price supplied by the browser.");
      makeForm(usagePanel, [serviceReservation, service, quantity], "Add service usage", async (form) => {
        const { error } = await sb.rpc("record_service_usage", {
          p_reservation_id: serviceReservation.input.value,
          p_service_id: service.input.value,
          p_quantity: Number(quantity.input.value)
        });
        if (error) notify(error.message, "error");
        else { notify("Service usage recorded."); form.reset(); renderModule("Billing"); }
      });
    }
    const panelCreate = addPanel(content, "Issue invoice", "Invoice totals are calculated by the database from the booked rate and recorded service usage.");
    const reservation = makeSelect("Reservation", "invoiceReservation", candidates.map((item) => [item.id, `${item.guests?.full_name || "Guest"} · ${item.rooms?.room_number || ""} · ${formatDate(item.check_in)}`]));
    const discounts = await loadRowsByRole("discounts", "id,name,code,percent,amount,active,starts_at,ends_at", "name");
    const discount = makeSelect("Discount", "invoiceDiscount", [["", "No discount"], ...discounts
      .filter((item) => item.active && (!item.starts_at || new Date(item.starts_at) <= new Date()) && (!item.ends_at || new Date(item.ends_at) > new Date()))
      .map((item) => [item.id, `${item.name}${item.code ? ` (${item.code})` : ""}`])], false);
    makeForm(panelCreate, [reservation, discount], "Create invoice", async () => {
      const { data, error } = await sb.rpc("create_invoice", {
        p_reservation_id: reservation.input.value,
        p_discount_id: discount.input.value || null
      });
      if (error) notify(error.message, "error");
      else { notify(`Invoice created: ${data}`); renderModule(paymentOnly ? "Payment" : "Billing"); }
    });
  }
  if (paymentOnly && ["accountant", "receptionist"].includes(activeRole)) {
    const outstanding = invoices.filter((invoice) => ["unpaid", "partially_paid"].includes(invoice.status));
    const invoice = makeSelect("Invoice", "paymentInvoice", outstanding.map((item) => [item.id, `${item.invoice_number} · balance ${currency(item.total)}`]));
    const amount = makeInput("Payment amount", "paymentAmount", "number");
    amount.input.min = "0.01";
    amount.input.step = "0.01";
    const method = makeSelect("Method", "paymentMethod", [["cash", "Cash"], ["card", "Card"], ["bank_transfer", "Bank transfer"], ["online", "Online"]]);
    const reference = makeInput("Reference", "paymentReference", "text", false);
    const paymentForm = addPanel(content, "Record payment", "Payments cannot exceed the remaining invoice balance; the balance is checked in a database transaction.");
    makeForm(paymentForm, [invoice, amount, method, reference], "Record payment", async (form) => {
      const { error } = await sb.rpc("record_payment", {
        p_invoice_id: invoice.input.value,
        p_amount: Number(amount.input.value),
        p_method: method.input.value,
        p_reference: reference.input.value.trim() || null
      });
      if (error) notify(error.message, "error");
      else { notify("Payment recorded."); form.reset(); renderModule("Payment"); }
    });
  }
  const shown = paymentOnly
    ? await loadRowsByRole("payments", "id,invoice_id,amount,method,reference,status,paid_at,invoices(invoice_number)", "paid_at")
    : invoices;
  makeTable(panel, paymentOnly
    ? ["Invoice", "Amount", "Method", "Reference", "Status", "Received"]
    : ["Invoice", "Reservation", "Subtotal", "Discount", "Tax", "Total", "Status", "Issued"], shown, (record, row) => {
    if (paymentOnly) {
      cell(row, record.invoices?.invoice_number);
      cell(row, currency(record.amount));
      cell(row, humanize(record.method));
      cell(row, record.reference);
      cell(row, humanize(record.status));
      cell(row, new Date(record.paid_at).toLocaleString());
    } else {
      cell(row, record.invoice_number);
      cell(row, record.reservation_id);
      cell(row, currency(record.subtotal));
      cell(row, currency(record.discount_amount));
      cell(row, currency(record.tax_amount));
      cell(row, currency(record.total));
      cell(row, humanize(record.status));
      cell(row, new Date(record.issued_at).toLocaleDateString());
    }
  });
}

async function renderDiscounts(content) {
  const panel = addPanel(content, "Discounts", "Review active discount terms. Management creates rules; authorized reservation and reception staff may apply them when issuing invoices.");
  if (activeRole === "manager") {
    const name = makeInput("Discount name", "discountName");
    const code = makeInput("Code", "discountCode", "text", false);
    const percent = makeInput("Percent off", "discountPercent", "number", false);
    percent.input.min = "0";
    percent.input.max = "100";
    percent.input.step = "0.01";
    const amount = makeInput("Fixed amount off", "discountAmount", "number", false);
    amount.input.min = "0";
    amount.input.step = "0.01";
    makeForm(panel, [name, code, percent, amount], "Create discount", async (form) => {
      if (Boolean(percent.input.value) === Boolean(amount.input.value)) {
        notify("Enter exactly one discount value: a percentage or a fixed amount.", "error");
        return;
      }
      const { error } = await sb.from("discounts").insert({
        name: name.input.value.trim(), code: code.input.value.trim() || null,
        percent: percent.input.value ? Number(percent.input.value) : null,
        amount: amount.input.value ? Number(amount.input.value) : null, created_by: currentUser.id
      });
      if (error) notify(error.message, "error");
      else { notify("Discount created."); form.reset(); renderModule("Discounts"); }
    });
  }
  const rows = await loadRowsByRole("discounts", "id,name,code,percent,amount,active,starts_at,ends_at", "name");
  if (["receptionist", "reservation_officer"].includes(activeRole)) {
    const reservations = await loadRowsByRole("reservations", "id,check_in,status,guests(full_name),rooms(room_number)", "check_in");
    const invoices = await loadRowsByRole("invoices", "reservation_id", "issued_at");
    const invoiced = new Set(invoices.map((invoice) => invoice.reservation_id));
    const eligible = reservations.filter((item) => ["reserved", "checked_in"].includes(item.status)
      && (activeRole === "reservation_officer" || !invoiced.has(item.id)));
    const activeDiscounts = rows.filter((item) => item.active && (!item.starts_at || new Date(item.starts_at) <= new Date()) && (!item.ends_at || new Date(item.ends_at) > new Date()));
    const applyPanel = addPanel(content, "Apply a discount", "Applying a discount issues an invoice for the selected reservation.");
    if (eligible.length && activeDiscounts.length) {
      const reservation = makeSelect("Reservation", "discountReservation", eligible.map((item) => [item.id, `${item.guests?.full_name || "Guest"} · ${item.rooms?.room_number || ""} · ${formatDate(item.check_in)}`]));
      const discount = makeSelect("Discount", "discountToApply", activeDiscounts.map((item) => [item.id, `${item.name}${item.code ? ` (${item.code})` : ""}`]));
      makeForm(applyPanel, [reservation, discount], "Apply and issue invoice", async () => {
        const { data, error } = await sb.rpc("apply_discount_to_reservation", { p_reservation_id: reservation.input.value, p_discount_id: discount.input.value });
        if (error) notify(error.message, "error");
        else { notify(`Discount applied; invoice created: ${data}`); await renderModule("Discounts"); }
      });
    } else {
      const note = document.createElement("p");
      note.textContent = "No active discounts or uninvoiced stays are available to apply.";
      applyPanel.appendChild(note);
    }
  }
  makeTable(panel, ["Name", "Code", "Percent", "Amount", "Status"], rows, (discount, row) => {
    cell(row, discount.name);
    cell(row, discount.code);
    cell(row, discount.percent === null ? "—" : `${discount.percent}%`);
    cell(row, discount.amount === null ? "—" : currency(discount.amount));
    cell(row, discount.active ? "Active" : "Inactive");
  });
}

async function renderFeedback(content, title = "Guest feedback") {
  const panel = addPanel(content, title, "Guest reviews help the team understand and improve each stay.");
  if (activeRole === "guest") {
    const rating = makeSelect("Rating", "feedbackRating", [["5", "5 · Excellent"], ["4", "4 · Very good"], ["3", "3 · Good"], ["2", "2 · Fair"], ["1", "1 · Poor"]]);
    const comments = makeInput("Comments", "feedbackComments", "textarea", false);
    makeForm(panel, [rating, comments], "Submit feedback", async (form) => {
      const { data: guest, error: guestError } = await sb.from("guests").select("id").eq("profile_id", currentUser.id).single();
      if (guestError) { notify(guestError.message, "error"); return; }
      const { error } = await sb.from("feedback").insert({
        guest_id: guest.id, rating: Number(rating.input.value), comments: comments.input.value.trim() || null
      });
      if (error) notify(error.message, "error");
      else { notify("Thank you for your feedback."); form.reset(); }
    });
  }
  const rows = await loadRowsByRole("feedback", "id,rating,comments,created_at,guests(full_name)", "created_at");
  makeTable(panel, ["Guest", "Rating", "Comments", "Date"], rows, (record, row) => {
    cell(row, record.guests?.full_name || "Guest");
    cell(row, `${record.rating} / 5`);
    cell(row, record.comments);
    cell(row, new Date(record.created_at).toLocaleDateString());
  });
}

async function renderReports(content, title = "Reports") {
  const { content: page } = setContentTitle(title, "Live operational summaries. Results are limited to records your role is permitted to view.");
  const definitions = activeRole === "guest"
    ? [["My reservations", "reservations", "id,status", (rows) => String(rows.length)]]
    : activeRole === "housekeeping"
      ? [["My housekeeping tasks", "housekeeping_tasks", "id,status", (rows) => String(rows.length)]]
      : activeRole === "maintenance"
        ? [["My maintenance assignments", "maintenance_requests", "id,status", (rows) => String(rows.length)]]
        : [
          ["Rooms", "rooms", "id", (rows) => String(rows.length)],
          ["Reservations", "reservations", "id,status", (rows) => String(rows.length)],
          ["Open maintenance", "maintenance_requests", "id,status", (rows) => String(rows.filter((item) => ["open", "in_progress"].includes(item.status)).length)]
        ];
  const stats = document.createElement("div");
  stats.className = "stat-grid";
  for (const [label, table, selection, summarize] of definitions) {
    if (table === "maintenance_requests" && !["admin", "manager", "maintenance"].includes(activeRole)) continue;
    let records;
    if (activeRole === "maintenance" && table === "maintenance_requests") {
      const { data, error } = await sb.from(table).select(selection).eq("assigned_to", currentUser.id);
      if (error) throw new Error(error.message);
      records = data || [];
    } else {
      records = await loadRowsByRole(table, selection);
    }
    const card = document.createElement("div");
    card.className = "stat-card";
    const text = document.createElement("span");
    text.textContent = label;
    const value = document.createElement("strong");
    value.textContent = summarize(records);
    card.append(text, value);
    stats.appendChild(card);
  }
  const summary = addPanel(page, "Operations summary", "Counts reflect currently visible records.");
  summary.appendChild(stats);
  if (["admin", "manager", "accountant"].includes(activeRole)) {
    const paymentRows = await loadRowsByRole("payments", "amount,status");
    const total = paymentRows.filter((item) => item.status === "completed").reduce((sum, item) => sum + Number(item.amount), 0);
    const finance = addPanel(page, "Payment summary", "Completed payment total in the records available to this account.");
    const card = document.createElement("div");
    card.className = "stat-card";
    const title = document.createElement("span");
    title.textContent = "Collected payments";
    const amount = document.createElement("strong");
    amount.textContent = currency(total);
    card.append(title, amount);
    finance.appendChild(card);
  }
}

async function renderAuditLogs(content, title = "Audit logs") {
  const managerView = activeRole === "manager";
  const accountantView = activeRole === "accountant";
  const panel = addPanel(content, title, managerView
    ? "Recent operational activity, excluding authentication events."
    : accountantView ? "Audit history for financial records." : "Append-only event history for important operational record changes.");
  let query = sb.from("audit_logs").select("id,actor_id,action,table_name,record_id,created_at").order("created_at", { ascending: false });
  if (accountantView) query = query.in("table_name", ["invoices", "payments", "service_usage", "discounts"]);
  if (managerView) query = query.neq("table_name", "auth_events").limit(100);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  const rows = data || [];
  makeTable(panel, ["Time", "Actor", "Action", "Record type", "Record ID"], rows, (record, row) => {
    cell(row, new Date(record.created_at).toLocaleString());
    cell(row, record.actor_id || "System");
    cell(row, humanize(record.action));
    cell(row, record.table_name);
    cell(row, record.record_id);
  });
}

async function renderModule(name) {
  document.getElementById("sectionEyebrow").textContent = "PROPERTY MANAGEMENT";
  try {
    const routeAliases = {
      "Rooms & Cottages": "Room Management",
      "Customers / Guests": "Guest Registration",
      "Payments & Transactions": "Payment",
      "Feedback & Reviews": "Customer Feedback",
      "Reports & Analytics": "Reports",
      "Activity Logs": "Audit Logs",
      "Browse Rooms": "Online Reservation",
      "Book a Room": "Online Reservation",
      "My Profile": "Guest Registration",
      "My Stay": "My Reservations",
      "Hotel Services": "Facilities & Amenities",
      "Billing & Payments": "Payment",
      "Invoices & Receipts": "Payment",
      "Notifications": "Audit Logs",
      "Account Settings": "System Settings"
    };
    const canonicalName = routeAliases[name] || name;
    if (name !== "Dashboard" && name !== "Logout"
      && !(ROLE_MENUS[activeRole] || []).includes(name)
      && !(ROLE_MENUS[activeRole] || []).includes(canonicalName)) {
      const { content } = setContentTitle("Access unavailable", "Your assigned role does not have access to this module.");
      addPanel(content, "Permission required", "If you need this module, ask an administrator to review your role.");
      return;
    }
    //if (name === "Dashboard") return await renderOverview();
    const content = document.getElementById("content");
    content.replaceChildren();
    if (name === "Dashboard") return await renderOverview();
    if (activeRole === "admin" && ADMIN_MODULES.includes(name)) return await renderAdminModule(name);

        if (window.FrontDesk && FrontDesk.handles(activeRole, name)) return await FrontDesk.render(name, content);
    if (name === "Browse Rooms" || name === "Book a Room") return await renderAvailability(content, false);
    if (name === "My Reservations" || name === "My Stay") return await renderReservations(content, "cancel");
    if (name === "My Profile") return await renderGuestRegistration(content);
    if (name === "Hotel Services") return await renderFacilities(content);
    if (name === "Billing & Payments" || name === "Invoices & Receipts") return await renderBilling(content, true);
    if (name === "Feedback & Reviews") return await renderFeedback(content, name);
    if (name === "Notifications") return await renderAuditLogs(content, name);
    if (name === "Account Settings") {
      const panel = addPanel(content, "Account settings", "Your profile and account preferences are managed from your guest information and security settings.");
      return panel;
    }
    if (name === "Rooms & Cottages") return await renderRooms(content, name);
    if (name === "Reservations") return await renderReservations(content, "all");
    if (name === "Customers / Guests") return await renderGuestRegistration(content);
    if (name === "Payments & Transactions") return await renderBilling(content, true);
    if (name === "Facilities & Amenities") return await renderFacilities(content);
    if (name === "Reports & Analytics") return await renderReports(content, name);
    if (name === "System Settings") {
      const panel = addPanel(content, "Configuration access", "System-wide settings are managed through the deployment and Supabase project. Editable system settings are not currently available in this dashboard.");
      return panel;
    }
    if (name === "Activity Logs") return await renderAuditLogs(content, name);
    //if (name === "Online Reservation") return await renderAvailability(content, activeRole !== "guest");
   // if (name === "My Reservations") return await renderReservations(content, "cancel");
   // if (name === "Guest Registration") return await renderGuestRegistration(content);
    if (name === "Check-in") return await renderReservations(content, "checkin");
    if (name === "Check-out") return await renderReservations(content, "checkout");
    if (name === "Cancellation") return await renderReservations(content, "cancel");
    if (name === "Room Assignment") return await renderRoomAssignment(content);
    if (name === "Room Management") return await renderRooms(content);
    if (name === "Housekeeping") return await renderHousekeeping(content);
    if (name === "Maintenance Requests") return await renderMaintenance(content);
    if (name === "Billing") return await renderBilling(content);
    if (name === "Payment") return await renderBilling(content, true);
    if (name === "Discounts") return await renderDiscounts(content);
    if (name === "Customer Feedback") return await renderFeedback(content);
    if (name === "Reports") return await renderReports(content);
    if (name === "Audit Logs") return await renderAuditLogs(content);
  } catch (error) {
    notify(`Unable to load ${name.toLowerCase()}: ${error.message}`, "error");
  }
}

async function signOut() {
  const auditError = await recordAuthEvent("logout");
  const { error: signOutError } = await sb.auth.signOut();
  if (signOutError) {
    notify(`Unable to sign out: ${signOutError.message}`, "error");
    return;
  }
  if (auditError) window.alert(`You were signed out, but the activity event could not be recorded: ${auditError.message}`);
  window.location.href = "home.html";
}

async function initDashboard() {
  const { data, error } = await sb.auth.getSession();
  if (error) {
    notify(`Unable to check your sign-in: ${error.message}`, "error");
    return;
  }
  if (!data.session) {
    window.location.href = "index.html";
    return;
  }
  currentUser = data.session.user;
  let { data: profile, error: profileError } = await sb
    .from("profiles")
    .select("full_name,email,active,roles(name)")
    .eq("id", currentUser.id)
    .single();
  let legacyProfileSchema = false;
  if (isMissingProfileActiveColumn(profileError)) {
    legacyProfileSchema = true;
    const result = await sb
      .from("profiles")
      .select("full_name,email,roles(name)")
      .eq("id", currentUser.id)
      .single();
    profile = result.data;
    profileError = result.error;
  }
  if (profileError || !profile || profile.active === false || !profile.roles) {
    notify(`Unable to load your active user profile${profileError ? `: ${profileError.message}` : "."}`, "error");
    await sb.auth.signOut();
    window.location.href = "index.html";
    return;
  }
  activeRole = profile.roles.name;
  await applyRoleModuleOverrides(activeRole);
  document.getElementById("userName").textContent = profile.full_name || profile.email;
  document.getElementById("roleBadge").textContent = ROLE_TITLES[activeRole] || humanize(activeRole);
  addNavigation(activeRole);
  await renderOverview();
  if (legacyProfileSchema) {
    notify("Signed in, but this database uses an older schema. Ask an administrator to review the database upgrade before using hotel operations.", "error");
  }
  try {
    const auditWarning = sessionStorage.getItem("hotel_audit_warning");
    if (auditWarning) {
      sessionStorage.removeItem("hotel_audit_warning");
      notify(auditWarning, "error");
    }
  } catch (error) {
    console.error("Unable to read the authentication logging warning:", error);
  }
  document.getElementById("logoutBtn")?.addEventListener("click", signOut);
}

initDashboard();