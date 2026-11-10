/* front-desk.js: the receptionist workspace para sa pages/dashboard.html. */
(function () {
  "use strict";

  const RES_SELECT =
    "id,guest_id,room_id,check_in,check_out,check_in_time,check_out_time,checked_in_at,checked_out_at," +
    "status,adults,children,nightly_rate,special_requests," +
    "guests(full_name,email,phone),rooms(room_number,room_types(name))";

  const ROUTES = ["Walk-in Booking", "Reservations", "Check-in", "Check-out", "Payment", "Guest Requests"];

  /* ---------- small helpers ---------- */
  const hm = (value) => (value ? String(value).slice(0, 5) : "—");
  const guestName = (r) => r.guests?.full_name || "Guest";
  const roomLabel = (r) => (r.rooms ? `${r.rooms.room_number} · ${r.rooms.room_types?.name || "Room"}` : "—");
  const contactOf = (r) => [r.guests?.phone, r.guests?.email].filter(Boolean).join(" · ") || "—";
  const nightsOf = (r) =>
    Math.max(0, Math.round((new Date(`${r.check_out}T00:00:00`) - new Date(`${r.check_in}T00:00:00`)) / 86400000));
  const scheduleOf = (r) =>
    `${formatDate(r.check_in)} ${hm(r.check_in_time)} → ${formatDate(r.check_out)} ${hm(r.check_out_time)}`;
  const guestCountOf = (r) =>
    `${Number(r.adults || 0) + Number(r.children || 0)} (${r.adults} adult(s), ${r.children} child(ren))`;
  const matches = (query, values) =>
    !query || values.some((value) => String(value || "").toLowerCase().includes(query));

  function paymentLookup(invoices, payments) {
    const invoiceByReservation = new Map(invoices.map((invoice) => [invoice.reservation_id, invoice]));
    const paidByInvoice = new Map();
    payments
      .filter((payment) => payment.status === "completed")
      .forEach((payment) => {
        paidByInvoice.set(payment.invoice_id, (paidByInvoice.get(payment.invoice_id) || 0) + Number(payment.amount));
      });
    return {
      invoiceByReservation,
      paidByInvoice,
      of(reservation) {
        const invoice = invoiceByReservation.get(reservation.id);
        if (!invoice) {
          const estimate = nightsOf(reservation) * Number(reservation.nightly_rate || 0);
          return { text: `Not invoiced · est. ${currency(estimate)}`, balance: estimate, invoiced: false };
        }
        if (invoice.status === "void") return { text: "Invoice void", balance: 0, invoiced: true };
        const paid = paidByInvoice.get(invoice.id) || 0;
        const balance = Math.max(0, Number(invoice.total) - paid);
        if (balance <= 0) return { text: "Paid in full", balance: 0, invoiced: true };
        return {
          text: `${paid > 0 ? "Partially paid" : "Unpaid"} · ${currency(balance)} due`,
          balance,
          invoiced: true
        };
      }
    };
  }

  async function loadFinance() {
    const [invoices, payments] = await Promise.all([
      loadRowsByRole("invoices", "id,reservation_id,total,status", "issued_at"),
      loadRowsByRole("payments", "invoice_id,amount,status", "paid_at")
    ]);
    return paymentLookup(invoices, payments);
  }

  function smallButton(label, primary, onClick) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `button ${primary ? "button-primary" : "button-outline"} button-small`;
    button.textContent = label;
    button.addEventListener("click", () => onClick(button));
    return button;
  }

  /* ---------- printing (booking confirmations and receipts) ---------- */
  function ensurePrintArea() {
    if (!document.getElementById("fdPrintStyles")) {
      const style = document.createElement("style");
      style.id = "fdPrintStyles";
      style.textContent = `
        #printArea{display:none}
        @media print{
          body.printing-doc > *:not(#printArea){display:none !important}
          body.printing-doc #printArea{display:block;font-family:Georgia,"Times New Roman",serif;color:#111;
            background:#fff;padding:24px;max-width:720px;margin:0 auto}
          #printArea .pa-brand{font-size:13px;letter-spacing:.14em;margin-bottom:16px}
          #printArea h1{font-size:28px;margin:0 0 4px}
          #printArea .pa-ref{color:#555;margin:0 0 8px;font-size:14px}
          #printArea h2{font-size:15px;margin:22px 0 8px;padding-bottom:4px;border-bottom:1px solid #999}
          #printArea dl{display:grid;grid-template-columns:200px 1fr;gap:6px 16px;margin:0;font-size:14px}
          #printArea dt{color:#555}
          #printArea dd{margin:0}
          #printArea table{width:100%;border-collapse:collapse;font-size:14px}
          #printArea th,#printArea td{text-align:left;padding:6px 4px;border-bottom:1px solid #ccc}
          #printArea .pa-foot{margin-top:28px;font-size:12px;color:#555}
        }`;
      document.head.appendChild(style);
    }
    let area = document.getElementById("printArea");
    if (!area) {
      area = document.createElement("div");
      area.id = "printArea";
      document.body.appendChild(area);
    }
    return area;
  }

  function printDocument({ heading, reference, sections, footer }) {
    const area = ensurePrintArea();
    area.replaceChildren();
    const brand = document.createElement("div");
    brand.className = "pa-brand";
    brand.textContent = "LUNARA · HOTEL & RESORT";
    const title = document.createElement("h1");
    title.textContent = heading;
    area.append(brand, title);
    if (reference) {
      const ref = document.createElement("p");
      ref.className = "pa-ref";
      ref.textContent = reference;
      area.appendChild(ref);
    }
    sections.forEach((section) => {
      if (section.title) {
        const h2 = document.createElement("h2");
        h2.textContent = section.title;
        area.appendChild(h2);
      }
      if (section.rows) {
        const list = document.createElement("dl");
        section.rows.forEach(([label, value]) => {
          const dt = document.createElement("dt");
          dt.textContent = label;
          const dd = document.createElement("dd");
          dd.textContent = value === null || value === undefined || value === "" ? "—" : String(value);
          list.append(dt, dd);
        });
        area.appendChild(list);
      }
      if (section.table) {
        const table = document.createElement("table");
        const head = document.createElement("tr");
        section.table.headers.forEach((header) => {
          const th = document.createElement("th");
          th.textContent = header;
          head.appendChild(th);
        });
        table.appendChild(head);
        section.table.rows.forEach((values) => {
          const tr = document.createElement("tr");
          values.forEach((value) => {
            const td = document.createElement("td");
            td.textContent = value === null || value === undefined || value === "" ? "—" : String(value);
            tr.appendChild(td);
          });
          table.appendChild(tr);
        });
        area.appendChild(table);
      }
    });
    if (footer) {
      const foot = document.createElement("p");
      foot.className = "pa-foot";
      foot.textContent = footer;
      area.appendChild(foot);
    }
    document.body.classList.add("printing-doc");
    const cleanup = () => document.body.classList.remove("printing-doc");
    window.addEventListener("afterprint", cleanup, { once: true });
    window.print();
  }

  function printConfirmation(reservation) {
    const nights = nightsOf(reservation);
    const rate = Number(reservation.nightly_rate || 0);
    printDocument({
      heading: "Booking confirmation",
      reference: `Reservation reference: ${reservation.id}`,
      sections: [
        {
          title: "Guest",
          rows: [
            ["Name", guestName(reservation)],
            ["Phone", reservation.guests?.phone],
            ["Email", reservation.guests?.email]
          ]
        },
        {
          title: "Stay",
          rows: [
            ["Room", roomLabel(reservation)],
            ["Check-in", `${formatDate(reservation.check_in)} from ${hm(reservation.check_in_time)}`],
            ["Check-out", `${formatDate(reservation.check_out)} by ${hm(reservation.check_out_time)}`],
            ["Nights", nights],
            ["Guests", guestCountOf(reservation)],
            ["Special requests", reservation.special_requests],
            ["Status", humanize(reservation.status)]
          ]
        },
        {
          title: "Price",
          rows: [
            ["Nightly rate", currency(rate)],
            ["Estimated room total", currency(nights * rate)],
            ["Payment", "Pay at the property"]
          ]
        }
      ],
      footer: "Please bring a valid ID at check-in. Taxes and any additional charges are confirmed by the property."
    });
  }

  function printReceipt(payment, invoice, reservation, invoicePayments) {
    const completed = invoicePayments.filter((item) => item.status === "completed");
    const paidTotal = completed.reduce((sum, item) => sum + Number(item.amount), 0);
    const balance = Math.max(0, Number(invoice.total) - paidTotal);
    printDocument({
      heading: "Payment receipt",
      reference: `Invoice ${invoice.invoice_number || `#${invoice.id}`}`,
      sections: [
        {
          title: "This payment",
          rows: [
            ["Amount received", currency(payment.amount)],
            ["Method", humanize(payment.method)],
            ["Reference", payment.reference],
            ["Received", payment.paid_at ? new Date(payment.paid_at).toLocaleString() : "—"]
          ]
        },
        {
          title: "Stay",
          rows: reservation
            ? [
                ["Guest", guestName(reservation)],
                ["Room", reservation.rooms?.room_number],
                ["Dates", `${formatDate(reservation.check_in)} – ${formatDate(reservation.check_out)}`]
              ]
            : [["Reservation", invoice.reservation_id]]
        },
        {
          title: "Invoice summary",
          rows: [
            ["Invoice total", currency(invoice.total)],
            ["Total paid", currency(paidTotal)],
            ["Balance due", currency(balance)]
          ]
        },
        {
          title: "All payments on this invoice",
          table: {
            headers: ["Date", "Method", "Reference", "Amount"],
            rows: completed.map((item) => [
              item.paid_at ? new Date(item.paid_at).toLocaleDateString() : "—",
              humanize(item.method),
              item.reference,
              currency(item.amount)
            ])
          }
        }
      ],
      footer: "Thank you for staying with LUNARA."
    });
  }

  /* ---------- dashboard overview ---------- */
  async function overview() {
    const today = todayLocal();
    const { content, panel } = setContentTitle(
      "Front desk",
      `${formatDate(today)} · today's arrivals, departures, and room status.`
    );
    const [rooms, reservations, lookup] = await Promise.all([
      loadRowsByRole("rooms", "id,room_number,floor,status,room_types(name)", "room_number"),
      loadRowsByRole("reservations", RES_SELECT, "check_in"),
      loadFinance()
    ]);

    const inHouse = reservations.filter((r) => r.status === "checked_in");
    const occupiedRoomIds = new Set(inHouse.map((r) => r.room_id));
    const arrivals = reservations
      .filter((r) => r.check_in === today && ["reserved", "checked_in"].includes(r.status))
      .sort((a, b) => hm(a.check_in_time).localeCompare(hm(b.check_in_time)));
    const departures = reservations
      .filter((r) => r.check_out === today && ["checked_in", "checked_out"].includes(r.status))
      .sort((a, b) => hm(a.check_out_time).localeCompare(hm(b.check_out_time)));
    const arrivingRoomIds = new Set(arrivals.filter((r) => r.status === "reserved").map((r) => r.room_id));

    const roomState = (room) => {
      if (room.status === "cleaning") return "Dirty · being cleaned";
      if (room.status === "maintenance") return "Under maintenance";
      if (["inactive", "out_of_service"].includes(room.status)) return "Out of service";
      if (room.status === "occupied" || occupiedRoomIds.has(room.id)) return "Occupied";
      if (arrivingRoomIds.has(room.id)) return "Vacant · arriving today";
      if (room.status === "available") return "Vacant · clean";
      return humanize(room.status);
    };
    const states = rooms.map((room) => ({ room, state: roomState(room) }));
    const count = (prefix) => states.filter((item) => item.state.startsWith(prefix)).length;
    const dueToday = departures.filter((r) => r.status === "checked_in" && lookup.of(r).balance > 0).length;

    const stats = document.createElement("div");
    stats.className = "stat-grid";
    addOverviewStat(stats, "Arrivals today", arrivals.length, `${arrivals.filter((r) => r.status === "checked_in").length} checked in`);
    addOverviewStat(stats, "Departures today", departures.length, `${departures.filter((r) => r.status === "checked_out").length} checked out`);
    addOverviewStat(stats, "Occupied rooms", count("Occupied"), `${inHouse.length} reservation(s) in house`);
    addOverviewStat(stats, "Vacant rooms", count("Vacant"), "Ready or arriving today");
    addOverviewStat(stats, "Dirty rooms", count("Dirty"), "Waiting for housekeeping");
    addOverviewStat(stats, "Departures with a balance", dueToday, "Collect payment before check-out");
    panel.appendChild(stats);
    content.appendChild(panel);

    const arrivalPanel = addPanel(content, "Today's arrivals", "Guests due to check in today. Use Check-in to authorize the arrival.");
    makeTable(
      arrivalPanel,
      ["Guest", "Contact", "Room", "Arrival", "Guests", "Special requests", "Payment", "Status"],
      arrivals,
      (r, row) => {
        cell(row, guestName(r));
        cell(row, contactOf(r));
        cell(row, roomLabel(r));
        cell(row, hm(r.check_in_time));
        cell(row, guestCountOf(r));
        cell(row, r.special_requests);
        cell(row, lookup.of(r).text);
        cell(row, humanize(r.status));
      }
    );

    const departurePanel = addPanel(content, "Today's departures", "Guests due to leave today. Use Check-out once their balance is settled.");
    makeTable(
      departurePanel,
      ["Guest", "Contact", "Room", "Departure", "Special requests", "Payment", "Status"],
      departures,
      (r, row) => {
        cell(row, guestName(r));
        cell(row, contactOf(r));
        cell(row, roomLabel(r));
        cell(row, hm(r.check_out_time));
        cell(row, r.special_requests);
        cell(row, lookup.of(r).text);
        cell(row, humanize(r.status));
      }
    );

    const boardPanel = addPanel(content, "Room status", "Occupied comes from guests currently checked in. Dirty rooms are the ones marked as cleaning.");
    makeTable(boardPanel, ["Room", "Type", "Floor", "Status"], states, (item, row) => {
      cell(row, item.room.room_number);
      cell(row, item.room.room_types?.name);
      cell(row, item.room.floor);
      cell(row, item.state);
    });
  }

  /* ---------- check-in and check-out ---------- */
  async function renderStay(mode, content) {
    const isCheckIn = mode === "checkin";
    const today = todayLocal();
    const [reservations, lookup] = await Promise.all([
      loadRowsByRole("reservations", RES_SELECT, "check_in"),
      loadFinance()
    ]);

    const panel = addPanel(
      content,
      isCheckIn ? "Arrivals waiting to check in" : "Guests currently in house",
      isCheckIn
        ? "Confirmed reservations arriving today or earlier that have not been checked in."
        : "Checked-in guests, soonest departure first. Review the balance before authorizing check-out."
    );
    const search = makeInput("Search guest, phone or room", "fdStaySearch", "search", false);
    const toolbar = document.createElement("div");
    toolbar.className = "toolbar";
    toolbar.appendChild(search.wrapper);
    panel.appendChild(toolbar);
    const box = document.createElement("div");
    panel.appendChild(box);

    const rows = isCheckIn
      ? reservations.filter((r) => r.status === "reserved" && r.check_in <= today).sort((a, b) => a.check_in.localeCompare(b.check_in))
      : reservations.filter((r) => r.status === "checked_in").sort((a, b) => a.check_out.localeCompare(b.check_out));

    const actionCell = (r) => {
      const td = document.createElement("td");
      const state = lookup.of(r);
      td.appendChild(
        smallButton(isCheckIn ? "Authorize check-in" : "Authorize check-out", true, async (button) => {
          if (!isCheckIn && (!state.invoiced || state.balance > 0)) {
            const reason = state.invoiced ? `${currency(state.balance)} is still due` : "no invoice has been issued yet";
            if (!window.confirm(`${guestName(r)}: ${reason}. Check out anyway?`)) return;
          }
          button.disabled = true;
          const { error } = await sb.rpc("transition_reservation", {
            p_reservation_id: r.id,
            p_status: isCheckIn ? "checked_in" : "checked_out"
          });
          if (error) {
            notify(error.message, "error");
            button.disabled = false;
            return;
          }
          notify(isCheckIn ? "Guest checked in." : "Guest checked out.");
          await renderModule(isCheckIn ? "Check-in" : "Check-out");
        })
      );
      td.appendChild(smallButton("Print confirmation", false, () => printConfirmation(r)));
      return td;
    };

    const draw = () => {
      const query = search.input.value.trim().toLowerCase();
      box.replaceChildren();
      const shown = rows.filter((r) => matches(query, [guestName(r), r.guests?.phone, r.guests?.email, r.rooms?.room_number]));
      makeTable(
        box,
        isCheckIn
          ? ["Guest", "Contact", "Room", "Stay schedule", "Guests", "Special requests", "Payment", "Actions"]
          : ["Guest", "Contact", "Room", "Checked in", "Departure", "Special requests", "Payment", "Actions"],
        shown,
        (r, row) => {
          cell(row, guestName(r));
          cell(row, contactOf(r));
          cell(row, roomLabel(r));
          if (isCheckIn) {
            cell(row, scheduleOf(r));
            cell(row, guestCountOf(r));
          } else {
            cell(row, r.checked_in_at ? new Date(r.checked_in_at).toLocaleString() : formatDate(r.check_in));
            const overdue = r.check_out < today ? " · overdue" : r.check_out === today ? " · today" : "";
            cell(row, `${formatDate(r.check_out)} ${hm(r.check_out_time)}${overdue}`);
          }
          cell(row, r.special_requests);
          cell(row, lookup.of(r).text);
          row.appendChild(actionCell(r));
        }
      );
    };
    search.input.addEventListener("input", draw);
    draw();

    if (isCheckIn) {
      const doneToday = reservations.filter((r) => r.status === "checked_in" && r.check_in === today);
      const donePanel = addPanel(content, "Checked in today", "Guests who arrived today.");
      makeTable(donePanel, ["Guest", "Room", "Checked in", "Departure", "Payment"], doneToday, (r, row) => {
        cell(row, guestName(r));
        cell(row, roomLabel(r));
        cell(row, r.checked_in_at ? new Date(r.checked_in_at).toLocaleTimeString() : "—");
        cell(row, `${formatDate(r.check_out)} ${hm(r.check_out_time)}`);
        cell(row, lookup.of(r).text);
      });
    }
  }

  /* ---------- reservation register ---------- */
  async function renderReservationList(content) {
    const [reservations, lookup] = await Promise.all([
      loadRowsByRole("reservations", RES_SELECT, "check_in"),
      loadFinance()
    ]);
    const panel = addPanel(
      content,
      "Reservation register",
      "Reservation details, stay schedules, payment status, and special requests. Print a booking confirmation for any reservation."
    );
    const status = makeSelect(
      "Status",
      "fdResStatus",
      [
        ["all", "All statuses"],
        ["pending", "Pending approval"],
        ["reserved", "Confirmed"],
        ["checked_in", "Checked in"],
        ["checked_out", "Checked out"],
        ["cancelled", "Cancelled"],
        ["no_show", "No show"]
      ],
      false
    );
    const from = makeInput("Check-in from", "fdResFrom", "date", false);
    const to = makeInput("Check-in to", "fdResTo", "date", false);
    const search = makeInput("Search guest, phone or room", "fdResSearch", "search", false);
    const toolbar = document.createElement("div");
    toolbar.className = "toolbar";
    toolbar.append(status.wrapper, from.wrapper, to.wrapper, search.wrapper);
    panel.appendChild(toolbar);
    const box = document.createElement("div");
    panel.appendChild(box);

    const draw = () => {
      const query = search.input.value.trim().toLowerCase();
      box.replaceChildren();
      const shown = reservations.filter(
        (r) =>
          (status.input.value === "all" || r.status === status.input.value) &&
          (!from.input.value || r.check_in >= from.input.value) &&
          (!to.input.value || r.check_in <= to.input.value) &&
          matches(query, [guestName(r), r.guests?.phone, r.guests?.email, r.rooms?.room_number])
      );
      makeTable(
        box,
        ["Reference", "Guest", "Contact", "Room", "Stay schedule", "Guests", "Special requests", "Status", "Payment", "Actions"],
        shown,
        (r, row) => {
          cell(row, String(r.id).slice(0, 8).toUpperCase());
          cell(row, guestName(r));
          cell(row, contactOf(r));
          cell(row, roomLabel(r));
          cell(row, scheduleOf(r));
          cell(row, guestCountOf(r));
          cell(row, r.special_requests);
          cell(row, humanize(r.status));
          cell(row, lookup.of(r).text);
          const td = document.createElement("td");
          td.appendChild(smallButton("Print confirmation", false, () => printConfirmation(r)));
          row.appendChild(td);
        }
      );
    };
    [status.input, from.input, to.input].forEach((input) => input.addEventListener("change", draw));
    search.input.addEventListener("input", draw);
    draw();
  }

  /* ---------- payments ---------- */
  async function renderPayments(content) {
    const [invoices, payments, reservations] = await Promise.all([
      loadRowsByRole("invoices", "id,invoice_number,reservation_id,total,status,issued_at", "issued_at"),
      loadRowsByRole("payments", "id,invoice_id,amount,method,reference,status,paid_at", "paid_at"),
      loadRowsByRole("reservations", "id,check_in,check_out,status,nightly_rate,guests(full_name),rooms(room_number)", "check_in")
    ]);
    const reservationById = new Map(reservations.map((r) => [r.id, r]));
    const invoiceById = new Map(invoices.map((invoice) => [invoice.id, invoice]));
    const invoicedReservations = new Set(invoices.map((invoice) => invoice.reservation_id));
    const paidByInvoice = new Map();
    payments
      .filter((payment) => payment.status === "completed")
      .forEach((payment) => {
        paidByInvoice.set(payment.invoice_id, (paidByInvoice.get(payment.invoice_id) || 0) + Number(payment.amount));
      });
    const balanceOf = (invoice) => Math.max(0, Number(invoice.total) - (paidByInvoice.get(invoice.id) || 0));
    const describe = (invoice) => {
      const r = reservationById.get(invoice.reservation_id);
      return `${invoice.invoice_number || `#${invoice.id}`} · ${r ? guestName(r) : "Guest"} · Room ${r?.rooms?.room_number || "—"}`;
    };

    // 1. Record a payment
    const recordPanel = addPanel(
      content,
      "Record a payment",
      "Choose the invoice, confirm the amount received, and record how it was paid. A payment cannot be more than the balance."
    );
    const outstanding = invoices.filter((invoice) => ["unpaid", "partially_paid"].includes(invoice.status) && balanceOf(invoice) > 0);
    if (!outstanding.length) {
      const note = document.createElement("p");
      note.className = "muted-note";
      note.textContent = "No invoices are waiting for payment.";
      recordPanel.appendChild(note);
    } else {
      const invoiceField = makeSelect(
        "Invoice",
        "fdPayInvoice",
        outstanding.map((invoice) => [invoice.id, `${describe(invoice)} · ${currency(balanceOf(invoice))} due`])
      );
      const amountField = makeInput("Amount received", "fdPayAmount", "number");
      amountField.input.min = "0.01";
      amountField.input.step = "0.01";
      const methodField = makeSelect("Method", "fdPayMethod", [
        ["cash", "Cash"],
        ["card", "Card"],
        ["bank_transfer", "Bank transfer"],
        ["online", "Online"]
      ]);
      const referenceField = makeInput("Reference (optional)", "fdPayReference", "text", false);
      const syncAmount = () => {
        const invoice = invoiceById.get(Number(invoiceField.input.value));
        if (!invoice) return;
        const balance = balanceOf(invoice).toFixed(2);
        amountField.input.value = balance;
        amountField.input.max = balance;
      };
      invoiceField.input.addEventListener("change", syncAmount);
      syncAmount();
      makeForm(recordPanel, [invoiceField, amountField, methodField, referenceField], "Record payment", async () => {
        const { error } = await sb.rpc("record_payment", {
          p_invoice_id: Number(invoiceField.input.value),
          p_amount: Number(amountField.input.value),
          p_method: methodField.input.value,
          p_reference: referenceField.input.value.trim() || null
        });
        if (error) {
          notify(error.message, "error");
          return;
        }
        notify("Payment recorded. You can print the receipt below.");
        await renderModule("Payment");
      });
    }

    // 2. Issue an invoice
    const invoicePanel = addPanel(
      content,
      "Issue an invoice",
      "A reservation needs an invoice before a payment can be recorded. The total comes from the booked rate and any posted services."
    );
    const candidates = reservations.filter(
      (r) => ["reserved", "checked_in", "checked_out"].includes(r.status) && !invoicedReservations.has(r.id)
    );
    if (!candidates.length) {
      const note = document.createElement("p");
      note.className = "muted-note";
      note.textContent = "Every active reservation already has an invoice.";
      invoicePanel.appendChild(note);
    } else {
      const reservationField = makeSelect(
        "Reservation",
        "fdInvoiceReservation",
        candidates.map((r) => [r.id, `${guestName(r)} · Room ${r.rooms?.room_number || "—"} · ${formatDate(r.check_in)}`])
      );
      makeForm(invoicePanel, [reservationField], "Issue invoice", async () => {
        const { error } = await sb.rpc("create_invoice", { p_reservation_id: reservationField.input.value });
        if (error) {
          notify(error.message, "error");
          return;
        }
        notify("Invoice issued.");
        await renderModule("Payment");
      });
    }

    // 3. Recent payments and receipts
    const listPanel = addPanel(content, "Recent payments", "The latest 50 payments. Print a receipt for any of them.");
    makeTable(
      listPanel,
      ["Invoice", "Guest", "Amount", "Method", "Reference", "Status", "Received", "Receipt"],
      payments.slice(0, 50),
      (payment, row) => {
        const invoice = invoiceById.get(payment.invoice_id);
        const reservation = invoice ? reservationById.get(invoice.reservation_id) : null;
        cell(row, invoice?.invoice_number || `#${payment.invoice_id}`);
        cell(row, reservation ? guestName(reservation) : "—");
        cell(row, currency(payment.amount));
        cell(row, humanize(payment.method));
        cell(row, payment.reference);
        cell(row, humanize(payment.status));
        cell(row, payment.paid_at ? new Date(payment.paid_at).toLocaleString() : "—");
        const td = document.createElement("td");
        if (invoice && payment.status === "completed") {
          td.appendChild(
            smallButton("Print receipt", false, () =>
              printReceipt(payment, invoice, reservation, payments.filter((item) => item.invoice_id === payment.invoice_id))
            )
          );
        } else {
          td.textContent = "—";
        }
        row.appendChild(td);
      }
    );
  }

  /* ---------- forward a complaint or request ---------- */
  async function renderGuestRequests(content) {
    const [rooms, reservations, tasks, issues] = await Promise.all([
      loadRowsByRole("rooms", "id,room_number", "room_number"),
      loadRowsByRole("reservations", "id,room_id,status,guests(full_name),rooms(room_number)", "check_in"),
      loadRowsByRole("housekeeping_tasks", "id,task_type,status,notes,scheduled_for,rooms(room_number)", "scheduled_for"),
      loadRowsByRole("maintenance_requests", "id,title,priority,status,created_at,rooms(room_number)", "created_at")
    ]);
    const inHouse = reservations.filter((r) => r.status === "checked_in");
    const roomNumberOf = (id) => rooms.find((room) => String(room.id) === String(id))?.room_number;

    const panel = addPanel(
      content,
      "Forward a complaint or request",
      "Send a guest's complaint or request to housekeeping or maintenance. It appears in that team's queue straight away."
    );
    const kind = makeSelect("Type", "frKind", [["complaint", "Complaint"], ["request", "Request"]]);
    const dept = makeSelect("Send to", "frDept", [["housekeeping", "Housekeeping"], ["maintenance", "Maintenance"]]);
    const guest = makeSelect(
      "Guest",
      "frGuest",
      [["", "Not linked to a guest"], ...inHouse.map((r) => [r.id, `${guestName(r)} · Room ${r.rooms?.room_number || "—"}`])],
      false
    );
    const room = makeSelect("Room", "frRoom", [["", "No specific room"], ...rooms.map((r) => [r.id, r.room_number])], false);
    const priority = makeSelect(
      "Priority (maintenance only)",
      "frPriority",
      [["low", "Low"], ["normal", "Normal"], ["high", "High"], ["urgent", "Urgent"]],
      false
    );
    priority.input.value = "normal";
    const details = makeInput("Details", "frDetails", "textarea");
    guest.input.addEventListener("change", () => {
      const match = inHouse.find((r) => r.id === guest.input.value);
      if (match) room.input.value = String(match.room_id);
    });

    makeForm(panel, [kind, dept, guest, room, priority, details], "Forward", async (form) => {
      const selectedGuest = inHouse.find((r) => r.id === guest.input.value);
      const roomId = room.input.value ? Number(room.input.value) : null;
      const label = kind.input.value === "complaint" ? "Guest complaint" : "Guest request";
      const text = details.input.value.trim();
      const note = `${label}${selectedGuest ? ` (${guestName(selectedGuest)})` : ""}: ${text}`;
      let result;
      if (dept.input.value === "housekeeping") {
        if (!roomId) {
          notify("Choose the room for a housekeeping task.", "error");
          return;
        }
        result = await sb.from("housekeeping_tasks").insert({ room_id: roomId, task_type: "cleaning", notes: note });
      } else {
        result = await sb.from("maintenance_requests").insert({
          title: `${label}${roomId ? ` · Room ${roomNumberOf(roomId) || roomId}` : ""}`,
          description: note,
          priority: priority.input.value || "normal",
          room_id: roomId,
          reported_by: currentUser.id
        });
      }
      if (result.error) {
        notify(result.error.message, "error");
        return;
      }
      notify(`Forwarded to ${dept.input.value}.`);
      form.reset();
      await renderModule("Guest Requests");
    });

    const taskPanel = addPanel(content, "Open housekeeping tasks", "Where forwarded housekeeping requests stand.");
    makeTable(
      taskPanel,
      ["Room", "Task", "Notes", "Scheduled", "Status"],
      tasks.filter((task) => ["pending", "in_progress"].includes(task.status)).slice(0, 15),
      (task, row) => {
        cell(row, task.rooms?.room_number);
        cell(row, humanize(task.task_type));
        cell(row, task.notes);
        cell(row, task.scheduled_for ? new Date(task.scheduled_for).toLocaleString() : "—");
        cell(row, humanize(task.status));
      }
    );
    const issuePanel = addPanel(content, "Open maintenance requests", "Where forwarded maintenance requests stand.");
    makeTable(
      issuePanel,
      ["Room", "Request", "Priority", "Reported", "Status"],
      issues.filter((issue) => ["open", "in_progress"].includes(issue.status)).slice(0, 15),
      (issue, row) => {
        cell(row, issue.rooms?.room_number || "—");
        cell(row, issue.title);
        cell(row, humanize(issue.priority));
        cell(row, new Date(issue.created_at).toLocaleDateString());
        cell(row, humanize(issue.status));
      }
    );
  }

  /* ---------- walk-in booking (reuses the staff booking search) ---------- */
  async function renderWalkIn(content) {
    addPanel(
      content,
      "Walk-in guests",
      "Register the guest first under Guest Registration, then choose their dates and room here. Walk-in bookings are confirmed immediately."
    );
    return renderAvailability(content, true);
  }

  /* ---------- routing used by dashboard.js ---------- */
  function handles(role, name) {
    if (role === "reservation_officer") {
      return Boolean(window.ReservationDesk && window.ReservationDesk.handles(name));
    }
    return role === "receptionist" && ROUTES.includes(name);
  }

  async function overviewByRole() {
    if (activeRole === "reservation_officer" && window.ReservationDesk) return window.ReservationDesk.overview();
    return overview();
  }

  async function render(name) {
    // Always start from a clean page, so one page never stacks under another.
    const { content } = setContentTitle(name, "");
    if (activeRole === "reservation_officer") return window.ReservationDesk.render(name, content);
    if (name === "Walk-in Booking") return renderWalkIn(content);
    if (name === "Reservations") return renderReservationList(content);
    if (name === "Check-in") return renderStay("checkin", content);
    if (name === "Check-out") return renderStay("checkout", content);
    if (name === "Payment") return renderPayments(content);
    if (name === "Guest Requests") return renderGuestRequests(content);
  }

  window.FrontDesk = { handles, render, overview: overviewByRole, printConfirmation };
})();