/* reservation-desk.js: tthe reservation officer workspace for pages/dashboard.html.*/
(function () {
  "use strict";

  const RES_SELECT =
    "id,guest_id,room_id,check_in,check_out,check_in_time,check_out_time,status,status_note,adults,children," +
    "nightly_rate,total_amount,special_requests,created_at,updated_at,guests(full_name,email,phone),rooms(room_number,room_types(name))";

  const ROUTES = [
    "Booking Calendar",
    "Room Availability",
    "Guest Booking Details",
    "Reservation Requests",
    "Booking Changes",
    "Cancellation Records",
    "Promotions and Discounts",
    "Reservation Reports",
    "New Reservation"
  ];

  const REQUEST_MARK = "[Guest change request ";

  /* ---------- small helpers...yarn? ---------- */
  const hm = (value) => (value ? String(value).slice(0, 5) : "—");
  const guestName = (r) => r.guests?.full_name || "Guest";
  const roomLabel = (r) => (r.rooms ? `${r.rooms.room_number} · ${r.rooms.room_types?.name || "Room"}` : "—");
  const contactOf = (r) => [r.guests?.phone, r.guests?.email].filter(Boolean).join(" · ") || "—";
  const nightsOf = (r) =>
    Math.max(0, Math.round((new Date(`${r.check_out}T00:00:00`) - new Date(`${r.check_in}T00:00:00`)) / 86400000));
  const stayOf = (r) => `${formatDate(r.check_in)} → ${formatDate(r.check_out)} (${nightsOf(r)} night(s))`;
  const guestCountOf = (r) => `${Number(r.adults || 0) + Number(r.children || 0)} (${r.adults} adult(s), ${r.children} child(ren))`;
  const matches = (query, values) =>
    !query || values.some((value) => String(value || "").toLowerCase().includes(query));
  const statusLabel = (r) => {
    if (r.status === "reserved") return "Confirmed";
    if (r.status === "cancelled" && String(r.status_note || "").startsWith("Rejected")) return "Rejected";
    return humanize(r.status);
  };
  const hasOpenRequest = (r) =>
    ["pending", "reserved"].includes(r.status) && String(r.special_requests || "").includes(REQUEST_MARK);
  const openRequestsOf = (r) =>
    String(r.special_requests || "").split("\n").filter((line) => line.startsWith(REQUEST_MARK));

  const isRejected = (r) => r.status === "cancelled" && String(r.status_note || "").startsWith("Rejected");
  const outcomeLabel = (r) => (r.status === "no_show" ? "No show" : isRejected(r) ? "Rejected" : "Cancelled");

  function lastMonths(count) {
    const now = new Date();
    return Array.from({ length: count }, (_, index) => {
      const month = new Date(now.getFullYear(), now.getMonth() - (count - 1 - index), 1);
      return {
        key: `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, "0")}`,
        label: month.toLocaleDateString(undefined, { month: "short", year: "numeric" })
      };
    });
  }

  function shiftDate(value, days) {
    const date = new Date(`${value}T00:00:00`);
    date.setDate(date.getDate() + days);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }

  function dayOf(iso) {
    const date = new Date(iso);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }

  function smallButton(label, primary, onClick) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `button ${primary ? "button-primary" : "button-outline"} button-small`;
    button.textContent = label;
    button.addEventListener("click", () => onClick(button));
    return button;
  }

  function askReason(question) {
    const answer = window.prompt(question);
    if (answer === null) return null;
    if (answer.trim().length < 3) {
      notify("Please enter a short reason (at least 3 characters).", "error");
      return null;
    }
    return answer.trim();
  }

  async function runRpc(name, params, successMessage, refreshName) {
    const { error } = await sb.rpc(name, params);
    if (error) {
      notify(error.message, "error");
      return false;
    }
    notify(successMessage);
    await renderModule(refreshName);
    return true;
  }

  function emailConfirmation(r) {
    const email = r.guests?.email;
    if (!email) {
      notify("This guest has no email address on file.", "error");
      return;
    }
    const confirmed = ["reserved", "checked_in"].includes(r.status);
    const lines = [
      `Dear ${guestName(r)},`,
      "",
      confirmed
        ? "Your reservation at LUNARA Hotel & Resort is confirmed."
        : "We have received your reservation at LUNARA Hotel & Resort and will confirm it shortly.",
      "",
      `Reference: ${r.id}`,
      `Room: ${roomLabel(r)}`,
      `Check-in: ${formatDate(r.check_in)} from ${hm(r.check_in_time)}`,
      `Check-out: ${formatDate(r.check_out)} by ${hm(r.check_out_time)}`,
      `Guests: ${r.adults} adult(s), ${r.children} child(ren)`,
      `Rate: ${currency(r.nightly_rate)} per night for ${nightsOf(r)} night(s)`,
      "Payment: pay at the property.",
      "",
      "Please bring a valid ID at check-in.",
      "",
      "LUNARA Hotel & Resort"
    ];
    window.location.href =
      `mailto:${email}?subject=${encodeURIComponent("Your LUNARA booking")}` +
      `&body=${encodeURIComponent(lines.join("\n"))}`;
  }

  function printConfirmation(r) {
    if (window.FrontDesk && window.FrontDesk.printConfirmation) window.FrontDesk.printConfirmation(r);
    else notify("Printing is unavailable: make sure front-desk.js is loaded before this page's scripts.", "error");
  }

  /* ---------- edit panel (dates, room, guests, requests) ---------- */
  async function openEditPanel(host, r, refreshName) {
    host.replaceChildren();
    const panel = addPanel(
      host,
      `Edit reservation · ${guestName(r)}`,
      "Change the dates, room, guest count or requests. The nightly rate follows the official rate of the room you choose. A reservation that already has an invoice must be changed by a manager."
    );
    const checkIn = makeInput("Check-in date", "orCheckIn", "date");
    checkIn.input.min = todayLocal();
    checkIn.input.value = r.check_in;
    const checkOut = makeInput("Check-out date", "orCheckOut", "date");
    checkOut.input.min = todayLocal();
    checkOut.input.value = r.check_out;
    const adults = makeInput("Adults", "orAdults", "number");
    adults.input.min = "1";
    adults.input.max = "20";
    adults.input.value = r.adults;
    const children = makeInput("Children", "orChildren", "number", false);
    children.input.min = "0";
    children.input.max = "20";
    children.input.value = r.children;
    const room = makeSelect("Room", "orRoom", [[String(r.room_id), `${roomLabel(r)} (current)`]]);
    const requests = makeInput("Special requests", "orRequests", "textarea", false);
    requests.input.value = r.special_requests || "";

    const loadRooms = async () => {
      if (!checkIn.input.value || !checkOut.input.value || checkOut.input.value <= checkIn.input.value) return;
      const { data, error } = await sb.rpc("get_available_rooms", {
        p_check_in: checkIn.input.value,
        p_check_out: checkOut.input.value,
        p_room_type_id: null
      });
      if (error) {
        notify(`Unable to check room availability: ${error.message}`, "error");
        return;
      }
      const previous = room.input.value;
      room.input.replaceChildren();
      room.input.appendChild(new Option(`${roomLabel(r)} (current)`, String(r.room_id)));
      (data || [])
        .filter((item) => String(item.id) !== String(r.room_id))
        .forEach((item) => {
          room.input.appendChild(
            new Option(`${item.room_number} · ${item.room_type} · ${currency(item.nightly_rate)} / night`, String(item.id))
          );
        });
      const stillThere = Array.from(room.input.options).some((option) => option.value === previous);
      room.input.value = stillThere ? previous : String(r.room_id);
    };
    [checkIn.input, checkOut.input].forEach((input) => input.addEventListener("change", loadRooms));

    const form = makeForm(panel, [checkIn, checkOut, adults, children, room, requests], "Save changes", async () => {
      const { error } = await sb.rpc("officer_update_reservation", {
        p_reservation_id: r.id,
        p_room_id: Number(room.input.value),
        p_check_in: checkIn.input.value,
        p_check_out: checkOut.input.value,
        p_adults: Number(adults.input.value),
        p_children: Number(children.input.value || 0),
        p_special_requests: requests.input.value.trim() || null
      });
      if (error) {
        notify(error.message, "error");
        return;
      }
      notify("Reservation updated.");
      await renderModule(refreshName);
    });
    form.querySelector(".form-actions").appendChild(smallButton("Close", false, () => host.replaceChildren()));
    await loadRooms();
    host.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  /* ---------- confirm / reject buttons ---------- */
  function decisionButtons(r, refreshName, onEdit) {
    const td = document.createElement("td");
    td.appendChild(
      smallButton("Confirm", true, async (button) => {
        button.disabled = true;
        const ok = await runRpc(
          "transition_reservation",
          { p_reservation_id: r.id, p_status: "reserved" },
          "Reservation confirmed.",
          refreshName
        );
        if (!ok) button.disabled = false;
      })
    );
    td.appendChild(
      smallButton("Reject", false, async () => {
        const reason = askReason(`Reason for rejecting ${guestName(r)}'s booking:`);
        if (!reason) return;
        await runRpc("reject_reservation", { p_reservation_id: r.id, p_reason: reason }, "Booking rejected.", refreshName);
      })
    );
    if (onEdit) td.appendChild(smallButton("Edit", false, onEdit));
    return td;
  }

  /* ---------- dashboard overview ---------- */
  async function overview() {
    const today = todayLocal();
    const weekEnd = shiftDate(today, 7);
    const { content, panel } = setContentTitle("Reservations desk", `${formatDate(today)} · bookings that need a decision.`);
    const reservations = await loadRowsByRole("reservations", RES_SELECT, "created_at");

    const pending = reservations
      .filter((r) => r.status === "pending")
      .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
    const requests = reservations.filter(hasOpenRequest);
    const upcoming = reservations.filter((r) => r.status === "reserved" && r.check_in >= today);
    const arrivalsSoon = upcoming.filter((r) => r.check_in <= weekEnd).sort((a, b) => a.check_in.localeCompare(b.check_in));
    const bookedToday = reservations.filter((r) => r.created_at && dayOf(r.created_at) === today).length;

    const stats = document.createElement("div");
    stats.className = "stat-grid";
    const confirmedCount = reservations.filter((r) => r.status === "reserved").length;
    const cancelledCount = reservations.filter((r) => r.status === "cancelled" && !isRejected(r)).length;
    const rejectedCount = reservations.filter(isRejected).length;
    const noShowCount = reservations.filter((r) => r.status === "no_show").length;
    addOverviewStat(stats, "Total bookings", reservations.length, `${bookedToday} received today`);
    addOverviewStat(stats, "Pending requests", pending.length, "Awaiting confirmation");
    addOverviewStat(stats, "Confirmed reservations", confirmedCount, `${arrivalsSoon.length} arriving in the next 7 days`);
    addOverviewStat(stats, "Cancellations", cancelledCount, `${rejectedCount} rejected · ${noShowCount} no-show`);
    addOverviewStat(stats, "Open change requests", requests.length, "Guests asking to change a booking");
    panel.appendChild(stats);
    content.appendChild(panel);

    const pendingPanel = addPanel(content, "Awaiting your decision", "Confirm or reject each online booking, oldest first.");
    makeTable(pendingPanel, ["Guest", "Contact", "Room", "Stay", "Guests", "Booked", "Decision"], pending, (r, row) => {
      cell(row, guestName(r));
      cell(row, contactOf(r));
      cell(row, roomLabel(r));
      cell(row, stayOf(r));
      cell(row, guestCountOf(r));
      cell(row, r.created_at ? new Date(r.created_at).toLocaleString() : "—");
      row.appendChild(decisionButtons(r, "Dashboard"));
    });

    const requestPanel = addPanel(content, "Guest change requests", "Open Reservation Requests to act on them.");
    makeTable(requestPanel, ["Guest", "Stay", "Request"], requests, (r, row) => {
      cell(row, guestName(r));
      cell(row, stayOf(r));
      cell(row, openRequestsOf(r).join(" "));
    });

    const arrivalPanel = addPanel(content, "Confirmed arrivals in the next 7 days", "");
    makeTable(arrivalPanel, ["Arrival", "Guest", "Room", "Guests", "Special requests"], arrivalsSoon, (r, row) => {
      cell(row, `${formatDate(r.check_in)} ${hm(r.check_in_time)}`);
      cell(row, guestName(r));
      cell(row, roomLabel(r));
      cell(row, guestCountOf(r));
      cell(row, r.special_requests);
    });
  }

  /* ---------- reservations register ---------- */
  async function renderRegister(content) {
    const reservations = await loadRowsByRole("reservations", RES_SELECT, "created_at");
    const editHost = document.createElement("div");
    content.appendChild(editHost);
    const panel = addPanel(
      content,
      "Guest booking details",
      "Every booking with the guest information needed to process it, plus status and history. Confirm or reject pending bookings, edit or cancel active ones, and send confirmations."
    );
    const status = makeSelect(
      "Status",
      "orStatus",
      [
        ["all", "All statuses"],
        ["pending", "Pending"],
        ["reserved", "Confirmed"],
        ["checked_in", "Checked in"],
        ["checked_out", "Checked out"],
        ["cancelled", "Cancelled or rejected"],
        ["no_show", "No show"]
      ],
      false
    );
    const from = makeInput("Check-in from", "orFrom", "date", false);
    const to = makeInput("Check-in to", "orTo", "date", false);
    const search = makeInput("Search guest, phone, room or reference", "orSearch", "search", false);
    const toolbar = document.createElement("div");
    toolbar.className = "toolbar";
    toolbar.append(status.wrapper, from.wrapper, to.wrapper, search.wrapper);
    panel.appendChild(toolbar);
    const box = document.createElement("div");
    panel.appendChild(box);
    const historyHost = document.createElement("div");
    content.appendChild(historyHost);

    const showHistory = (r) => {
      historyHost.replaceChildren();
      const stays = reservations
        .filter((item) => item.guest_id === r.guest_id)
        .sort((a, b) => b.check_in.localeCompare(a.check_in));
      const historyPanel = addPanel(historyHost, `Booking history · ${guestName(r)}`, `${stays.length} reservation(s) on record.`);
      makeTable(historyPanel, ["Reference", "Room", "Stay", "Status", "Booked"], stays, (item, row) => {
        cell(row, String(item.id).slice(0, 8).toUpperCase());
        cell(row, roomLabel(item));
        cell(row, stayOf(item));
        cell(row, statusLabel(item));
        cell(row, item.created_at ? new Date(item.created_at).toLocaleDateString() : "—");
      });
      historyHost.scrollIntoView({ behavior: "smooth", block: "start" });
    };

    const draw = () => {
      const query = search.input.value.trim().toLowerCase();
      box.replaceChildren();
      const shown = reservations.filter(
        (r) =>
          (status.input.value === "all" || r.status === status.input.value) &&
          (!from.input.value || r.check_in >= from.input.value) &&
          (!to.input.value || r.check_in <= to.input.value) &&
          matches(query, [guestName(r), r.guests?.phone, r.guests?.email, r.rooms?.room_number, String(r.id).slice(0, 8)])
      );
      makeTable(
        box,
        ["Reference", "Guest", "Contact", "Room", "Stay", "Guests", "Rate / night", "Status", "Booked", "Requests", "Actions"],
        shown,
        (r, row) => {
          cell(row, String(r.id).slice(0, 8).toUpperCase());
          cell(row, guestName(r));
          cell(row, contactOf(r));
          cell(row, roomLabel(r));
          cell(row, stayOf(r));
          cell(row, guestCountOf(r));
          cell(row, currency(r.nightly_rate));
          cell(row, `${statusLabel(r)}${r.status_note ? ` · ${r.status_note}` : ""}`);
          cell(row, r.created_at ? new Date(r.created_at).toLocaleDateString() : "—");
          cell(row, r.special_requests);
          const td = document.createElement("td");
          if (r.status === "pending") {
            td.appendChild(
              smallButton("Confirm", true, async (button) => {
                button.disabled = true;
                const ok = await runRpc(
                  "transition_reservation",
                  { p_reservation_id: r.id, p_status: "reserved" },
                  "Reservation confirmed.",
                  "Guest Booking Details"
                );
                if (!ok) button.disabled = false;
              })
            );
            td.appendChild(
              smallButton("Reject", false, async () => {
                const reason = askReason(`Reason for rejecting ${guestName(r)}'s booking:`);
                if (!reason) return;
                await runRpc("reject_reservation", { p_reservation_id: r.id, p_reason: reason }, "Booking rejected.", "Guest Booking Details");
              })
            );
          }
          if (["pending", "reserved"].includes(r.status)) {
            td.appendChild(smallButton("Edit", false, () => openEditPanel(editHost, r, "Guest Booking Details")));
            td.appendChild(
              smallButton("Cancel", false, async () => {
                const reason = askReason(`Reason for cancelling ${guestName(r)}'s reservation:`);
                if (!reason) return;
                await runRpc("cancel_reservation", { p_reservation_id: r.id, p_reason: reason }, "Reservation cancelled.", "Guest Booking Details");
              })
            );
          }
          if (["pending", "reserved", "checked_in"].includes(r.status)) {
            td.appendChild(smallButton("Print", false, () => printConfirmation(r)));
            td.appendChild(smallButton("Email", false, () => emailConfirmation(r)));
          }
          td.appendChild(smallButton("History", false, () => showHistory(r)));
          row.appendChild(td);
        }
      );
    };
    [status.input, from.input, to.input].forEach((input) => input.addEventListener("change", draw));
    search.input.addEventListener("input", draw);
    draw();
  }

  /* ---------- new reservation (find the guest, then pick a room) ---------- */
  async function renderBooking(content, refreshName) {
    const state = { guest: null };

    // Step 1: choose the guest by searching, or add a new one.
    const guestPanel = addPanel(
      content,
      "1 · Choose the guest",
      "Search by name, phone number or email. If the guest is not registered yet, add them below."
    );
    const selectedBox = document.createElement("div");
    const finder = document.createElement("div");
    const search = makeInput("Find a guest", "orGuestSearch", "search", false);
    search.input.placeholder = "Type at least 2 letters or digits";
    const resultsBox = document.createElement("div");
    const newGuestBox = document.createElement("div");
    newGuestBox.hidden = true;
    const newName = makeInput("Full name", "orNewName");
    const newPhone = makeInput("Phone", "orNewPhone", "tel", false);
    const newEmail = makeInput("Email", "orNewEmail", "email", false);
    const toggleNew = smallButton("Guest not found? Add a new guest", false, () => {
      newGuestBox.hidden = !newGuestBox.hidden;
    });
    finder.append(search.wrapper, resultsBox, toggleNew, newGuestBox);
    guestPanel.append(selectedBox, finder);

    const contactLine = (guest) => [guest.phone, guest.email].filter(Boolean).join(" · ");

    const renderSelected = () => {
      selectedBox.replaceChildren();
      finder.hidden = Boolean(state.guest);
      const line = document.createElement("p");
      if (!state.guest) {
        line.className = "muted-note";
        line.textContent = "No guest selected yet.";
        selectedBox.appendChild(line);
        return;
      }
      const contact = contactLine(state.guest);
      line.textContent = `Booking for ${state.guest.full_name}${contact ? ` · ${contact}` : ""}`;
      selectedBox.append(
        line,
        smallButton("Change guest", false, () => {
          state.guest = null;
          renderSelected();
          search.input.focus();
        })
      );
    };

    makeForm(newGuestBox, [newName, newPhone, newEmail], "Add guest and select", async () => {
      const { data, error } = await sb
        .from("guests")
        .insert({
          full_name: newName.input.value.trim(),
          phone: newPhone.input.value.trim() || null,
          email: newEmail.input.value.trim() || null
        })
        .select("id,full_name,email,phone")
        .single();
      if (error) {
        notify(error.message, "error");
        return;
      }
      state.guest = data;
      newGuestBox.hidden = true;
      resultsBox.replaceChildren();
      renderSelected();
      notify("Guest added and selected.");
    });

    let timer = null;
    let searchRun = 0;
    const runSearch = async () => {
      const mine = ++searchRun;
      const q = search.input.value.trim().replace(/[,()*%\\"]/g, " ").replace(/\s+/g, " ").trim();
      resultsBox.replaceChildren();
      if (q.length < 2) return;
      const { data, error } = await sb
        .from("guests")
        .select("id,full_name,email,phone")
        .or(`full_name.ilike.*${q}*,email.ilike.*${q}*,phone.ilike.*${q}*`)
        .order("full_name")
        .limit(8);
      if (mine !== searchRun) return;
      if (error) {
        notify(`Unable to search guests: ${error.message}`, "error");
        return;
      }
      resultsBox.replaceChildren();
      if (!data.length) {
        const none = document.createElement("p");
        none.className = "muted-note";
        none.textContent = "No guest found. Use \"Guest not found?\" below to add them.";
        resultsBox.appendChild(none);
        return;
      }
      data.forEach((guest) => {
        const row = document.createElement("div");
        row.appendChild(
          smallButton(`${guest.full_name} · ${contactLine(guest) || "no contact details"}`, false, () => {
            state.guest = guest;
            search.input.value = "";
            resultsBox.replaceChildren();
            renderSelected();
          })
        );
        resultsBox.appendChild(row);
      });
      if (data.length === 8) {
        const more = document.createElement("p");
        more.className = "muted-note";
        more.textContent = "Showing the first 8 matches. Keep typing to narrow it down.";
        resultsBox.appendChild(more);
      }
    };
    search.input.addEventListener("input", () => {
      clearTimeout(timer);
      timer = setTimeout(runSearch, 250);
    });
    renderSelected();

    // Step 2: dates, guests and free rooms.
    const stayPanel = addPanel(content, "2 · Dates and guests", "Choose the stay, then search for free rooms.");
    const checkIn = makeInput("Check-in", "orBookIn", "date");
    checkIn.input.min = todayLocal();
    checkIn.input.value = dateOffset(1);
    const checkOut = makeInput("Check-out", "orBookOut", "date");
    checkOut.input.min = dateOffset(1);
    checkOut.input.value = dateOffset(2);
    const adults = makeInput("Adults", "orBookAdults", "number");
    adults.input.min = "1";
    adults.input.max = "20";
    adults.input.value = "1";
    const children = makeInput("Children", "orBookChildren", "number", false);
    children.input.min = "0";
    children.input.max = "20";
    children.input.value = "0";
    const requests = makeInput("Special requests", "orBookRequests", "textarea", false);
    const toolbar = document.createElement("div");
    toolbar.className = "toolbar";
    toolbar.append(checkIn.wrapper, checkOut.wrapper, adults.wrapper, children.wrapper);
    const roomsBox = document.createElement("div");
    const doneBox = document.createElement("div");

    const showDone = async (reservationId) => {
      doneBox.replaceChildren();
      const { data: created } = await sb.from("reservations").select(RES_SELECT).eq("id", reservationId).single();
      const panel = addPanel(doneBox, "Reservation confirmed", `Reference: ${reservationId}`);
      if (created) {
        const summary = document.createElement("p");
        summary.textContent = `${guestName(created)} · ${roomLabel(created)} · ${stayOf(created)}`;
        panel.appendChild(summary);
        panel.append(
          smallButton("Print confirmation", false, () => printConfirmation(created)),
          smallButton("Email confirmation", false, () => emailConfirmation(created))
        );
      }
      panel.appendChild(smallButton("Make another booking", true, () => renderModule(refreshName)));
      doneBox.scrollIntoView({ behavior: "smooth", block: "start" });
    };

    const searchButton = smallButton("Search free rooms", true, async (button) => {
      roomsBox.replaceChildren();
      doneBox.replaceChildren();
      const adultCount = Number(adults.input.value);
      const childCount = Number(children.input.value || 0);
      if (
        !checkIn.input.value ||
        !checkOut.input.value ||
        checkOut.input.value <= checkIn.input.value ||
        checkIn.input.value < todayLocal()
      ) {
        notify("Choose a future check-in and a later check-out date.", "error");
        return;
      }
      if (!Number.isInteger(adultCount) || adultCount < 1 || !Number.isInteger(childCount) || childCount < 0) {
        notify("Enter a valid number of adults and children.", "error");
        return;
      }
      button.disabled = true;
      const { data, error } = await sb.rpc("get_available_rooms", {
        p_check_in: checkIn.input.value,
        p_check_out: checkOut.input.value,
        p_room_type_id: null
      });
      button.disabled = false;
      if (error) {
        notify(`Availability search failed: ${error.message}`, "error");
        return;
      }
      const suitable = (data || []).filter((room) => Number(room.capacity) >= adultCount + childCount);
      const nights = Math.round(
        (new Date(`${checkOut.input.value}T00:00:00`) - new Date(`${checkIn.input.value}T00:00:00`)) / 86400000
      );
      const note = document.createElement("p");
      note.className = "muted-note";
      note.textContent = `${suitable.length} room(s) free for ${nights} night(s) and ${adultCount + childCount} guest(s).`;
      roomsBox.appendChild(note);
      makeTable(roomsBox, ["Room", "Type", "Capacity", "Rate / night", "Total for stay", "Book"], suitable, (room, row) => {
        cell(row, room.room_number);
        cell(row, room.room_type);
        cell(row, `Up to ${room.capacity} guests`);
        cell(row, currency(room.nightly_rate));
        cell(row, currency(Number(room.nightly_rate) * nights));
        const td = document.createElement("td");
        td.appendChild(
          smallButton("Book this room", true, async (book) => {
            if (!state.guest) {
              notify("Choose a guest first (step 1).", "error");
              return;
            }
            book.disabled = true;
            const { data: reservationId, error: bookError } = await sb.rpc("reserve_room_for_guest", {
              p_guest_id: state.guest.id,
              p_room_id: String(room.id),
              p_check_in: checkIn.input.value,
              p_check_out: checkOut.input.value,
              p_adults: adultCount,
              p_children: childCount,
              p_special_requests: requests.input.value.trim() || null
            });
            if (bookError) {
              notify(bookError.message, "error");
              book.disabled = false;
              return;
            }
            notify("Reservation confirmed.");
            roomsBox.replaceChildren();
            await showDone(reservationId);
          })
        );
        row.appendChild(td);
      });
    });
    stayPanel.append(toolbar, requests.wrapper, searchButton, roomsBox);
    content.appendChild(doneBox);
  }

  /* ---------- booking calendar ---------- */
  const CALENDAR_COLORS = {
    pending: ["#f5dfa8", "Pending"],
    reserved: ["#bfe0c8", "Confirmed"],
    checked_in: ["#a9c9ea", "Checked in"],
    checked_out: ["#dcdfe3", "Checked out"]
  };

  async function renderCalendar(content) {
    const [rooms, reservations] = await Promise.all([
      loadRowsByRole("rooms", "id,room_number,room_types(name)", "room_number"),
      loadRowsByRole("reservations", RES_SELECT, "check_in")
    ]);
    rooms.sort((a, b) => String(a.room_number).localeCompare(String(b.room_number), undefined, { numeric: true }));

    const panel = addPanel(
      content,
      "Booking calendar",
      "Each row is a room and each column is a night. Click a coloured cell for the booking details."
    );
    const start = makeInput("Start date", "orCalStart", "date", false);
    start.input.value = todayLocal();
    const span = makeSelect("Days shown", "orCalSpan", [["14", "14 days"], ["21", "21 days"], ["30", "30 days"]], false);
    const toolbar = document.createElement("div");
    toolbar.className = "toolbar";
    const previous = smallButton("◀ Earlier", false, () => {
      start.input.value = shiftDate(start.input.value || todayLocal(), -Number(span.input.value));
      draw();
    });
    const next = smallButton("Later ▶", false, () => {
      start.input.value = shiftDate(start.input.value || todayLocal(), Number(span.input.value));
      draw();
    });
    const today = smallButton("Today", false, () => {
      start.input.value = todayLocal();
      draw();
    });
    toolbar.append(start.wrapper, span.wrapper, previous, today, next);
    panel.appendChild(toolbar);

    const legend = document.createElement("p");
    legend.className = "muted-note";
    legend.textContent = Object.values(CALENDAR_COLORS).map(([, label]) => label).join(" · ") + " · White = free";
    panel.appendChild(legend);
    const box = document.createElement("div");
    panel.appendChild(box);
    const detail = document.createElement("p");
    detail.className = "muted-note";
    detail.textContent = "Click a coloured cell to see who is staying.";
    panel.appendChild(detail);

    const draw = () => {
      const first = start.input.value || todayLocal();
      const days = Number(span.input.value);
      const dates = Array.from({ length: days }, (_, index) => shiftDate(first, index));
      const last = shiftDate(first, days);

      const byRoomDate = new Map();
      reservations
        .filter((r) => CALENDAR_COLORS[r.status] && r.check_in < last && r.check_out > first)
        .forEach((r) => {
          for (let d = r.check_in; d < r.check_out; d = shiftDate(d, 1)) byRoomDate.set(`${r.room_id}|${d}`, r);
        });

      box.replaceChildren();
      const wrap = document.createElement("div");
      wrap.className = "table-wrap";
      const table = document.createElement("table");
      const head = document.createElement("tr");
      const corner = document.createElement("th");
      corner.textContent = "Room";
      head.appendChild(corner);
      dates.forEach((date) => {
        const th = document.createElement("th");
        th.style.cssText = "text-align:center;font-size:12px;min-width:40px;padding:4px";
        const weekday = new Date(`${date}T00:00:00`).toLocaleDateString(undefined, { weekday: "short" });
        th.textContent = `${weekday} ${date.slice(5)}`;
        head.appendChild(th);
      });
      const thead = document.createElement("thead");
      thead.appendChild(head);
      table.appendChild(thead);

      const body = document.createElement("tbody");
      rooms.forEach((room) => {
        const tr = document.createElement("tr");
        const label = document.createElement("td");
        label.style.whiteSpace = "nowrap";
        label.textContent = `${room.room_number} · ${room.room_types?.name || ""}`;
        tr.appendChild(label);
        dates.forEach((date) => {
          const td = document.createElement("td");
          td.style.cssText = "text-align:center;font-size:11px;padding:4px;border:1px solid #e2e5df;height:30px";
          const r = byRoomDate.get(`${room.id}|${date}`);
          if (r) {
            td.style.background = CALENDAR_COLORS[r.status][0];
            td.style.color = "#17201f";
            td.style.cursor = "pointer";
            td.title = `${guestName(r)} · ${stayOf(r)} · ${statusLabel(r)}`;
            if (date === r.check_in || date === first) td.textContent = guestName(r).slice(0, 6);
            td.addEventListener("click", () => {
              detail.textContent = `${guestName(r)} · Room ${r.rooms?.room_number} · ${stayOf(r)} · ${statusLabel(r)} · ${contactOf(r)}`;
            });
          }
          tr.appendChild(td);
        });
        body.appendChild(tr);
      });
      table.appendChild(body);
      wrap.appendChild(table);
      box.appendChild(wrap);
    };
    [start.input, span.input].forEach((input) => input.addEventListener("change", draw));
    draw();
  }

  /* ---------- room availability ---------- */
  async function renderAvailabilityPage(content) {
    const types = await loadRowsByRole("room_types", "id,name,description,capacity,nightly_rate,active", "name");
    const panel = addPanel(content, "Room availability", "Check which rooms are free for a date range and what they cost for the stay.");
    const checkIn = makeInput("Check-in", "orAvailIn", "date");
    checkIn.input.min = todayLocal();
    checkIn.input.value = dateOffset(1);
    const checkOut = makeInput("Check-out", "orAvailOut", "date");
    checkOut.input.min = dateOffset(1);
    checkOut.input.value = dateOffset(2);
    const type = makeSelect(
      "Room type",
      "orAvailType",
      [["", "All room types"], ...types.filter((item) => item.active).sort((a, b) => a.name.localeCompare(b.name)).map((item) => [item.id, item.name])],
      false
    );
    const toolbar = document.createElement("div");
    toolbar.className = "toolbar";
    toolbar.append(checkIn.wrapper, checkOut.wrapper, type.wrapper);
    panel.appendChild(toolbar);
    const results = document.createElement("div");
    const search = smallButton("Search availability", true, async (button) => {
      results.replaceChildren();
      if (!checkIn.input.value || !checkOut.input.value || checkOut.input.value <= checkIn.input.value) {
        notify("Choose a check-out date after the check-in date.", "error");
        return;
      }
      button.disabled = true;
      const { data, error } = await sb.rpc("get_available_rooms", {
        p_check_in: checkIn.input.value,
        p_check_out: checkOut.input.value,
        p_room_type_id: type.input.value || null
      });
      button.disabled = false;
      if (error) {
        notify(`Availability search failed: ${error.message}`, "error");
        return;
      }
      const nights = Math.round((new Date(`${checkOut.input.value}T00:00:00`) - new Date(`${checkIn.input.value}T00:00:00`)) / 86400000);
      const heading = document.createElement("p");
      heading.className = "muted-note";
      heading.textContent = `${(data || []).length} room(s) free for ${nights} night(s).`;
      results.appendChild(heading);
      makeTable(results, ["Room", "Type", "Capacity", "Rate / night", "Total for stay"], data || [], (room, row) => {
        cell(row, room.room_number);
        cell(row, room.room_type);
        cell(row, `Up to ${room.capacity} guests`);
        cell(row, currency(room.nightly_rate));
        cell(row, currency(Number(room.nightly_rate) * nights));
      });
    });
    panel.appendChild(search);
    panel.appendChild(results);

    const ratesPanel = addPanel(content, "Room types and rates", "Official nightly rates. Only a manager can change them.");
    makeTable(
      ratesPanel,
      ["Room type", "Description", "Capacity", "Nightly rate", "Status"],
      [...types].sort((a, b) => a.name.localeCompare(b.name)),
      (item, row) => {
        cell(row, item.name);
        cell(row, item.description);
        cell(row, `Up to ${item.capacity} guests`);
        cell(row, currency(item.nightly_rate));
        cell(row, item.active ? "Active" : "Inactive");
      }
    );
  }

  /* ---------- reservation requests (bookings awaiting confirmation) ---------- */
  async function renderRequests(content) {
    const reservations = await loadRowsByRole("reservations", RES_SELECT, "created_at");
    const editHost = document.createElement("div");
    content.appendChild(editHost);

    const pending = reservations
      .filter((r) => r.status === "pending")
      .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
    const panel = addPanel(
      content,
      "Bookings awaiting confirmation",
      `${pending.length} online booking(s) need a decision, oldest first. Confirm or reject each one, or edit it first.`
    );
    makeTable(panel, ["Guest", "Contact", "Room", "Stay", "Guests", "Special requests", "Booked", "Decision"], pending, (r, row) => {
      cell(row, guestName(r));
      cell(row, contactOf(r));
      cell(row, roomLabel(r));
      cell(row, stayOf(r));
      cell(row, guestCountOf(r));
      cell(row, r.special_requests);
      cell(row, r.created_at ? new Date(r.created_at).toLocaleString() : "—");
      row.appendChild(decisionButtons(r, "Reservation Requests", () => openEditPanel(editHost, r, "Reservation Requests")));
    });
  }

  /* ---------- booking changes (guest requests to change a booking) ---------- */
  async function renderChanges(content) {
    const reservations = await loadRowsByRole("reservations", RES_SELECT, "created_at");
    const editHost = document.createElement("div");
    content.appendChild(editHost);

    const open = reservations.filter(hasOpenRequest);
    const openPanel = addPanel(
      content,
      "Open change requests",
      `${open.length} request(s) to change dates, room type or guest count. Edit the reservation if needed, then mark the request as handled.`
    );
    makeTable(
      openPanel,
      ["Guest", "Contact", "Current room", "Current stay", "Guests", "Status", "Request", "Actions"],
      open,
      (r, row) => {
        cell(row, guestName(r));
        cell(row, contactOf(r));
        cell(row, roomLabel(r));
        cell(row, stayOf(r));
        cell(row, guestCountOf(r));
        cell(row, statusLabel(r));
        cell(row, openRequestsOf(r).join("\n"));
        const td = document.createElement("td");
        td.appendChild(smallButton("Edit reservation", false, () => openEditPanel(editHost, r, "Booking Changes")));
        td.appendChild(
          smallButton("Mark handled", true, async () => {
            const note = askReason("How was this request handled? (for example: dates moved to 12-14 Dec)");
            if (!note) return;
            await runRpc("resolve_change_request", { p_reservation_id: r.id, p_note: note }, "Request marked as handled.", "Booking Changes");
          })
        );
        td.appendChild(smallButton("Email guest", false, () => emailConfirmation(r)));
        row.appendChild(td);
      }
    );

    const handled = reservations.filter((r) => String(r.special_requests || "").includes("[Request handled "));
    const handledLines = (r) =>
      String(r.special_requests || "")
        .split("\n")
        .filter((line) => line.startsWith("[Change request handled ") || line.startsWith("[Request handled "));
    const handledPanel = addPanel(content, "Handled change requests", "The record of requests that were dealt with, and what was done.");
    makeTable(handledPanel, ["Guest", "Stay", "Status", "Request and outcome"], handled, (r, row) => {
      cell(row, guestName(r));
      cell(row, stayOf(r));
      cell(row, statusLabel(r));
      cell(row, handledLines(r).join("\n"));
    });
  }

  /* ---------- cancellation records ---------- */
  async function renderCancellations(content) {
    const all = await loadRowsByRole("reservations", RES_SELECT, "updated_at");
    const closed = all.filter((r) => r.status === "cancelled" || r.status === "no_show");
    const cancelledCount = closed.filter((r) => r.status === "cancelled" && !isRejected(r)).length;
    const rejectedCount = closed.filter(isRejected).length;
    const noShowCount = closed.filter((r) => r.status === "no_show").length;

    const panel = addPanel(
      content,
      "Cancellation records",
      "Cancelled and rejected bookings and no-shows, with the reason that was recorded. Cancellations made by the guest online have no reason."
    );
    const stats = document.createElement("div");
    stats.className = "stat-grid";
    addOverviewStat(stats, "Cancelled", cancelledCount, "Cancelled by guest or staff");
    addOverviewStat(stats, "Rejected", rejectedCount, "Declined before confirmation");
    addOverviewStat(stats, "No-shows", noShowCount, "Confirmed but did not arrive");
    panel.appendChild(stats);

    const outcome = makeSelect(
      "Outcome",
      "orCancelOutcome",
      [["all", "All outcomes"], ["cancelled", "Cancelled"], ["rejected", "Rejected"], ["no_show", "No-show"]],
      false
    );
    const from = makeInput("Check-in from", "orCancelFrom", "date", false);
    const to = makeInput("Check-in to", "orCancelTo", "date", false);
    const search = makeInput("Search guest, phone or room", "orCancelSearch", "search", false);
    const toolbar = document.createElement("div");
    toolbar.className = "toolbar";
    toolbar.append(outcome.wrapper, from.wrapper, to.wrapper, search.wrapper);
    panel.appendChild(toolbar);
    const box = document.createElement("div");
    panel.appendChild(box);

    const reasonOf = (r) =>
      String(r.status_note || "").replace(/^(Cancelled|Rejected):\s*/, "") ||
      (r.status === "no_show" ? "Guest did not arrive" : "No reason recorded");

    const draw = () => {
      const query = search.input.value.trim().toLowerCase();
      box.replaceChildren();
      const shown = closed.filter(
        (r) =>
          (outcome.input.value === "all" ||
            (outcome.input.value === "no_show" && r.status === "no_show") ||
            (outcome.input.value === "rejected" && isRejected(r)) ||
            (outcome.input.value === "cancelled" && r.status === "cancelled" && !isRejected(r))) &&
          (!from.input.value || r.check_in >= from.input.value) &&
          (!to.input.value || r.check_in <= to.input.value) &&
          matches(query, [guestName(r), r.guests?.phone, r.guests?.email, r.rooms?.room_number])
      );
      makeTable(
        box,
        ["Reference", "Guest", "Contact", "Room", "Stay", "Outcome", "Reason", "Booked", "Closed"],
        shown,
        (r, row) => {
          cell(row, String(r.id).slice(0, 8).toUpperCase());
          cell(row, guestName(r));
          cell(row, contactOf(r));
          cell(row, roomLabel(r));
          cell(row, stayOf(r));
          cell(row, outcomeLabel(r));
          cell(row, reasonOf(r));
          cell(row, r.created_at ? new Date(r.created_at).toLocaleDateString() : "—");
          cell(row, r.updated_at ? new Date(r.updated_at).toLocaleString() : "—");
        }
      );
    };
    [outcome.input, from.input, to.input].forEach((input) => input.addEventListener("change", draw));
    search.input.addEventListener("input", draw);
    draw();
  }

  /* ---------- promotions and discounts (read only) ---------- */
  async function renderPromotions(content) {
    const discounts = await loadRowsByRole("discounts", "id,name,code,percent,amount,starts_at,ends_at,active", "name");
    const now = new Date();
    const stateOf = (d) => {
      if (!d.active) return "Inactive";
      if (d.starts_at && new Date(d.starts_at) > now) return "Upcoming";
      if (d.ends_at && new Date(d.ends_at) <= now) return "Expired";
      return "Active now";
    };
    const order = ["Active now", "Upcoming", "Expired", "Inactive"];
    const rows = discounts
      .map((d) => ({ d, state: stateOf(d) }))
      .sort((a, b) => order.indexOf(a.state) - order.indexOf(b.state) || a.d.name.localeCompare(b.d.name));
    const panel = addPanel(
      content,
      "Promotions and discounts",
      "Approved promotions and the dates they apply. Managers create and change them; they are applied when an invoice is issued."
    );
    makeTable(panel, ["Promotion", "Code", "Discount", "Applies from", "Applies until", "Status"], rows, (item, row) => {
      cell(row, item.d.name);
      cell(row, item.d.code);
      cell(row, item.d.percent === null ? currency(item.d.amount) : `${item.d.percent}%`);
      cell(row, item.d.starts_at ? new Date(item.d.starts_at).toLocaleDateString() : "No start date");
      cell(row, item.d.ends_at ? new Date(item.d.ends_at).toLocaleDateString() : "No end date");
      cell(row, item.state);
    });
  }

  /* ---------- reservation reports (counts only, no money) ---------- */
  async function renderReports(content) {
    const [reservations, rooms] = await Promise.all([
      loadRowsByRole("reservations", RES_SELECT, "created_at"),
      loadRowsByRole("rooms", "id,status", "room_number")
    ]);
    const count = (test) => reservations.filter(test).length;
    const total = reservations.length;
    const cancelled = count((r) => r.status === "cancelled" && !isRejected(r));
    const rejected = count(isRejected);
    const noShows = count((r) => r.status === "no_show");
    const lost = cancelled + rejected + noShows;
    const rate = total ? ((lost / total) * 100).toFixed(1) : "0.0";

    const totalsPanel = addPanel(
      content,
      "Booking totals",
      "Every booking on record, by status. These reports count bookings only; they do not show money."
    );
    const totalStats = document.createElement("div");
    totalStats.className = "stat-grid";
    addOverviewStat(totalStats, "Total bookings", total);
    addOverviewStat(totalStats, "Pending", count((r) => r.status === "pending"), "Awaiting confirmation");
    addOverviewStat(totalStats, "Confirmed", count((r) => r.status === "reserved"), "Not yet arrived");
    addOverviewStat(totalStats, "In house", count((r) => r.status === "checked_in"));
    addOverviewStat(totalStats, "Completed", count((r) => r.status === "checked_out"));
    addOverviewStat(totalStats, "Cancelled", cancelled);
    addOverviewStat(totalStats, "Rejected", rejected);
    addOverviewStat(totalStats, "No-shows", noShows);
    totalsPanel.appendChild(totalStats);

    const months = lastMonths(6);
    const receivedByMonth = new Map(months.map((m) => [m.key, 0]));
    reservations.forEach((r) => {
      if (!r.created_at) return;
      const key = dayOf(r.created_at).slice(0, 7);
      if (receivedByMonth.has(key)) receivedByMonth.set(key, receivedByMonth.get(key) + 1);
    });
    const monthPanel = addPanel(content, "Bookings received per month", "New bookings by the month they were made, over the last 6 months.");
    addOverviewBarChart(monthPanel, months.map((m) => ({ label: m.label, value: receivedByMonth.get(m.key) })));

    const today = todayLocal();
    const usableRooms = rooms.filter((room) => !["inactive", "out_of_service"].includes(room.status)).length;
    const days = Array.from({ length: 14 }, (_, index) => shiftDate(today, index));
    const occupiedBy = new Map(days.map((d) => [d, new Set()]));
    reservations
      .filter((r) => ["pending", "reserved", "checked_in"].includes(r.status))
      .forEach((r) => {
        days.forEach((d) => {
          if (r.check_in <= d && d < r.check_out) occupiedBy.get(d).add(r.room_id);
        });
      });
    const forecastPanel = addPanel(
      content,
      "Occupancy forecast, next 14 days",
      `Share of the ${usableRooms} usable room(s) booked each night, including pending bookings. Bars are scaled to the busiest night.`
    );
    addOverviewBarChart(
      forecastPanel,
      days.map((d) => ({
        label: `${new Date(`${d}T00:00:00`).toLocaleDateString(undefined, { weekday: "short" })} ${d.slice(5)}`,
        value: usableRooms ? Math.round((occupiedBy.get(d).size / usableRooms) * 100) : 0
      })),
      (value) => `${value}%`
    );

    const cancelPanel = addPanel(
      content,
      "Cancellation statistics",
      "Cancelled, rejected and no-show bookings as a share of all bookings."
    );
    const cancelStats = document.createElement("div");
    cancelStats.className = "stat-grid";
    addOverviewStat(cancelStats, "Cancellation rate", `${rate}%`, `${lost} of ${total} bookings`);
    addOverviewStat(cancelStats, "Cancelled", cancelled);
    addOverviewStat(cancelStats, "Rejected", rejected);
    addOverviewStat(cancelStats, "No-shows", noShows);
    cancelPanel.appendChild(cancelStats);
    const closedByMonth = new Map(months.map((m) => [m.key, 0]));
    reservations
      .filter((r) => ["cancelled", "no_show"].includes(r.status) && r.updated_at)
      .forEach((r) => {
        const key = dayOf(r.updated_at).slice(0, 7);
        if (closedByMonth.has(key)) closedByMonth.set(key, closedByMonth.get(key) + 1);
      });
    const closedPanel = addPanel(cancelPanel, "Closed per month", "Bookings cancelled, rejected or marked no-show, by the month it happened (approximate).");
    addOverviewBarChart(closedPanel, months.map((m) => ({ label: m.label, value: closedByMonth.get(m.key) })));
  }

  /* ---------- routing used by front-desk.js / dashboard.js ---------- */
  function handles(name) {
    return ROUTES.includes(name);
  }

  async function render(name, content) {
    if (name === "Guest Booking Details") return renderRegister(content);
    if (name === "New Reservation") return renderBooking(content, "New Reservation");
    if (name === "Booking Calendar") return renderCalendar(content);
    if (name === "Room Availability") return renderAvailabilityPage(content);
    if (name === "Reservation Requests") return renderRequests(content);
    if (name === "Booking Changes") return renderChanges(content);
    if (name === "Cancellation Records") return renderCancellations(content);
    if (name === "Promotions and Discounts") return renderPromotions(content);
    if (name === "Reservation Reports") return renderReports(content);
  }

  window.ReservationDesk = { handles, render, overview, renderBooking };
})();