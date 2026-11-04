const bookingState = {
  user: null,
  room: null,
  search: null,
  contact: null
};

function localDateOffset(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function bookingCurrency(value) {
  return new Intl.NumberFormat(undefined, { style: "currency", currency: CURRENCY_CODE }).format(Number(value));
}

function showBookingStatus(message, type = "error") {
  const status = document.getElementById("bookingStatus");
  status.textContent = message;
  status.className = `booking-status visible${type === "error" ? " error" : " success"}`;
}

function clearBookingStatus() {
  const status = document.getElementById("bookingStatus");
  status.textContent = "";
  status.className = "booking-status";
}

function showBookingStep(name) {
  const stepByName = {
    search: "stepSearch",
    guest: "stepGuest",
    room: "stepRoom",
    price: "stepPrice",
    payment: "stepPayment",
    complete: "stepComplete"
  };
  Object.entries(stepByName).forEach(([step, id]) => {
    document.getElementById(id).hidden = step !== name;
  });
  document.querySelectorAll(".booking-steps li").forEach((item, index) => {
    item.classList.toggle("active", index === ({ search: 0, guest: 1, room: 2, price: 3, payment: 4 }[name]));
    if (name === "complete") item.classList.add("completed");
  });
  clearBookingStatus();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

// After a booking the guest sees the check mark, then is taken back home automatically.
// A visitor goes to the home page; a signed-in guest goes to their own dashboard.
const RETURN_HOME_SECONDS = 8;
let returnTimer = null;

function stopReturnCountdown() {
  if (returnTimer) window.clearInterval(returnTimer);
  returnTimer = null;
  const note = document.getElementById("redirectNote");
  note.textContent = "";
  document.getElementById("stayHere").hidden = true;
}

function startReturnCountdown() {
  const note = document.getElementById("redirectNote");
  const destination = document.querySelector("#stepComplete a.button");
  const where = bookingState.user ? "your dashboard" : "the home page";
  let left = RETURN_HOME_SECONDS;
  document.getElementById("stayHere").hidden = false;
  note.textContent = `Taking you back to ${where} in ${left} seconds…`;
  returnTimer = window.setInterval(() => {
    left -= 1;
    if (left <= 0) {
      window.clearInterval(returnTimer);
      returnTimer = null;
      window.location.assign(destination.href);
      return;
    }
    note.textContent = `Taking you back to ${where} in ${left} ${left === 1 ? "second" : "seconds"}…`;
  }, 1000);
}

function addBookingSummaryRow(list, label, value, className = "") {
  const wrapper = document.createElement("div");
  wrapper.className = `booking-summary-row${className ? ` ${className}` : ""}`;
  const term = document.createElement("dt");
  term.textContent = label;
  const description = document.createElement("dd");
  description.textContent = value;
  wrapper.append(term, description);
  list.appendChild(wrapper);
}

function nightsBetween(checkIn, checkOut) {
  const [inYear, inMonth, inDay] = checkIn.split("-").map(Number);
  const [outYear, outMonth, outDay] = checkOut.split("-").map(Number);
  return (Date.UTC(outYear, outMonth - 1, outDay) - Date.UTC(inYear, inMonth - 1, inDay)) / 86400000;
}

function formatBookingDate(value) {
  const [year, month, day] = value.split("-").map(Number);
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(year, month - 1, day));
}

function fillBookingSummaries() {
  const { room, search, contact } = bookingState;
  const roomSummary = document.getElementById("roomSummary");
  roomSummary.replaceChildren();
  const details = document.createElement("dl");
  details.className = "booking-summary-list";
  addBookingSummaryRow(details, "Room", `${room.room_type} · Room ${room.room_number}`);
  addBookingSummaryRow(details, "Stay", `${formatBookingDate(search.checkIn)} – ${formatBookingDate(search.checkOut)} (${search.nights} ${search.nights === 1 ? "night" : "nights"})`);
  addBookingSummaryRow(details, "Arrival", search.checkInTime);
  addBookingSummaryRow(details, "Departure", search.checkOutTime);
  addBookingSummaryRow(details, "Guests", `${search.adults} ${search.adults === 1 ? "adult" : "adults"}${search.children ? `, ${search.children} ${search.children === 1 ? "child" : "children"}` : ""}`);
  addBookingSummaryRow(details, "Room capacity", `Up to ${room.capacity} guests`);
  if (contact) {
    addBookingSummaryRow(details, "Guest", contact.fullName);
    addBookingSummaryRow(details, "Email", contact.email || bookingState.user?.email || "—");
    addBookingSummaryRow(details, "Phone", contact.phone);
  }
  roomSummary.appendChild(details);

  const subtotal = Number(room.nightly_rate) * search.nights;
  const priceSummary = document.getElementById("priceSummary");
  priceSummary.replaceChildren();
  const priceList = document.createElement("dl");
  priceList.className = "booking-summary-list";
  addBookingSummaryRow(priceList, "Room rate", `${bookingCurrency(room.nightly_rate)} × ${search.nights} ${search.nights === 1 ? "night" : "nights"}`);
  addBookingSummaryRow(priceList, "Estimated room subtotal", bookingCurrency(subtotal), "booking-summary-total");
  priceSummary.appendChild(priceList);

  const finalTotal = document.getElementById("finalTotal");
  finalTotal.replaceChildren();
  const totalLabel = document.createElement("span");
  totalLabel.textContent = "Estimated room subtotal";
  const totalValue = document.createElement("strong");
  totalValue.textContent = bookingCurrency(subtotal);
  finalTotal.append(totalLabel, totalValue);
}

function renderAvailableRooms(rooms, results) {
  results.replaceChildren();
  const suitableRooms = rooms.filter((room) => Number(room.capacity) >= bookingState.search.adults + bookingState.search.children);
  if (!suitableRooms.length) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = rooms.length
      ? "Rooms are available, but none have enough capacity for your group. Try a smaller group or a different room type."
      : "No rooms are available for those dates. Try another date range.";
    results.appendChild(empty);
    return;
  }

  const heading = document.createElement("h3");
  heading.className = "booking-results-title";
  heading.textContent = `${suitableRooms.length} ${suitableRooms.length === 1 ? "room" : "rooms"} available`;
  const cards = document.createElement("div");
  cards.className = "booking-room-grid";
  suitableRooms.forEach((room) => {
    const card = document.createElement("article");
    card.className = "booking-room-card";
    const roomName = document.createElement("h3");
    roomName.textContent = room.room_type;
    const number = document.createElement("p");
    number.className = "booking-room-number";
    number.textContent = `Room ${room.room_number}`;
    const capacity = document.createElement("p");
    capacity.textContent = `Up to ${room.capacity} guests`;
    const rate = document.createElement("p");
    rate.className = "booking-room-rate";
    rate.textContent = `${bookingCurrency(room.nightly_rate)} / night`;
    const choose = document.createElement("button");
    choose.type = "button";
    choose.className = "button button-primary";
    choose.textContent = "Choose this room";
    choose.addEventListener("click", () => {
      bookingState.room = room;
      const { user, contact } = bookingState;
      document.getElementById("guestName").value = contact?.fullName || user?.user_metadata?.full_name || "";
      document.getElementById("guestEmail").value = user?.email || contact?.email || "";
      document.getElementById("guestPhone").value = contact?.phone || user?.user_metadata?.phone || "";
      showBookingStep("guest");
    });
    card.append(roomName, number, capacity, rate, choose);
    cards.appendChild(card);
  });
  results.append(heading, cards);
}

async function initBookingPage() {
  const { data, error } = await sb.auth.getSession();
  if (error) {
    document.getElementById("bookingApp").hidden = false;
    showBookingStatus(`Unable to check your sign-in: ${error.message}`);
    return;
  }
  bookingState.user = data.session?.user || null;
  // Send logged-in users back to their own dashboard instead of the public home page
const homeLinks = document.querySelectorAll(".brand-booking, .booking-home-link");
const doneLink = document.querySelector("#stepComplete a.button");
if (bookingState.user) {
  const { data: role } = await sb.rpc("current_role");
  const home = role && role !== "guest" ? "dashboard.html" : "guest-dashboard.html";
  homeLinks.forEach((link) => { link.href = home; });
  const backLink = document.querySelector(".booking-home-link");
  if (backLink) backLink.textContent = "← Back to my dashboard";
  if (doneLink) {
    doneLink.href = home;
    doneLink.textContent = "Back to my dashboard";
  }
} else if (doneLink) {
  doneLink.href = "home.html";
  doneLink.textContent = "Back to home";
}
  document.getElementById("bookingApp").hidden = false;
  const guestEmail = document.getElementById("guestEmail");
  if (bookingState.user) {
    // Signed in: the account's email is used, so there is nothing to type.
    guestEmail.readOnly = true;
    document.getElementById("guestEmailField").hidden = true;
    document.getElementById("memberNote").hidden = false;
  } else {
    // Booking without an account: the customer types a contact email and we keep it as typed.
    guestEmail.readOnly = false;
    guestEmail.required = true;
    document.getElementById("visitorNote").hidden = false;
  }
  document.getElementById("stayHere").addEventListener("click", stopReturnCountdown);
  const checkIn = document.getElementById("checkIn");
  const checkOut = document.getElementById("checkOut");
  checkIn.min = localDateOffset(0);
  checkIn.value = localDateOffset(1);
  checkOut.min = localDateOffset(2);
  checkOut.value = localDateOffset(2);
  checkIn.addEventListener("change", () => {
    const minimumCheckout = localDateOffset(0);
    checkOut.min = checkIn.value >= minimumCheckout ? checkIn.value : minimumCheckout;
    if (checkOut.value <= checkIn.value) {
      const nextDay = new Date(`${checkIn.value}T12:00:00`);
      nextDay.setDate(nextDay.getDate() + 1);
      checkOut.value = `${nextDay.getFullYear()}-${String(nextDay.getMonth() + 1).padStart(2, "0")}-${String(nextDay.getDate()).padStart(2, "0")}`;
    }
  });

  const { data: roomTypes, error: roomTypesError } = await sb.rpc("get_active_room_types");
  if (roomTypesError) {
    showBookingStatus(`Unable to load room types: ${roomTypesError.message}`);
    return;
  }
  roomTypes.forEach((roomType) => {
    document.getElementById("roomType").appendChild(new Option(roomType.name, roomType.id));
  });

  document.getElementById("availabilityForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    clearBookingStatus();
    const form = event.currentTarget;
    if (!form.reportValidity()) return;

    const adults = Number(document.getElementById("adults").value);
    const children = Number(document.getElementById("children").value);
    const checkInValue = checkIn.value;
    const checkOutValue = checkOut.value;
    if (checkOutValue <= checkInValue || checkInValue < localDateOffset(0)) {
      showBookingStatus("Choose a valid check-in date and a later check-out date.");
      return;
    }
    if (!Number.isInteger(adults) || adults < 1 || !Number.isInteger(children) || children < 0) {
      showBookingStatus("Enter a valid number of adults and children.");
      return;
    }

    const searchButton = document.getElementById("searchRooms");
    const results = document.getElementById("bookingResults");
    results.replaceChildren();
    searchButton.disabled = true;
    searchButton.textContent = "Checking rooms…";
    bookingState.search = {
      checkIn: checkInValue,
      checkOut: checkOutValue,
      checkInTime: document.getElementById("checkInTime").value,
      checkOutTime: document.getElementById("checkOutTime").value,
      adults,
      children,
      roomTypeId: document.getElementById("roomType").value || null,
      nights: nightsBetween(checkInValue, checkOutValue)
    };
    try {
      const { data: rooms, error: availabilityError } = await sb.rpc("get_available_rooms", {
        p_check_in: checkInValue,
        p_check_out: checkOutValue,
        p_room_type_id: bookingState.search.roomTypeId
      });
      if (availabilityError) throw new Error(availabilityError.message);
      renderAvailableRooms(rooms || [], results);
    } catch (searchError) {
      showBookingStatus(`Unable to check room availability: ${searchError.message}`);
    } finally {
      searchButton.disabled = false;
      searchButton.textContent = "Search available rooms";
    }
  });

  document.getElementById("guestForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const fullName = document.getElementById("guestName").value.trim();
    const email = document.getElementById("guestEmail").value.trim();
    const phone = document.getElementById("guestPhone").value.trim();
    let problem = "";
    let focusId = "";
    if (fullName.length < 2) {
      problem = "Enter your full name.";
      focusId = "guestName";
    } else if (!bookingState.user && !email) {
      problem = "Enter your email address.";
      focusId = "guestEmail";
    } else if (phone.length < 5) {
      problem = "Enter a phone number we can reach you on.";
      focusId = "guestPhone";
    }
    if (problem) {
      showBookingStatus(problem);
      document.getElementById(focusId).focus();
      return;
    }
    bookingState.contact = {
      fullName,
      email,
      phone,
      specialRequests: document.getElementById("specialRequests").value.trim()
    };
    fillBookingSummaries();
    showBookingStep("room");
  });

  document.querySelectorAll("[data-back]").forEach((button) => {
    button.addEventListener("click", () => showBookingStep(button.dataset.back));
  });
  document.querySelectorAll("[data-next]").forEach((button) => {
    button.addEventListener("click", () => showBookingStep(button.dataset.next));
  });

  document.getElementById("completeBooking").addEventListener("click", async (event) => {
    const button = event.currentTarget;
    if (!bookingState.room || !bookingState.search || !bookingState.contact) {
      showBookingStatus("Complete the room search and guest details before confirming your reservation.");
      return;
    }
    button.disabled = true;
    button.textContent = "Completing booking…";
    clearBookingStatus();
    try {
      const rpcName = bookingState.user ? "reserve_room_with_details" : "reserve_room_without_account";
      const reservationParams = {
        p_room_id: String(bookingState.room.id),
        p_check_in: bookingState.search.checkIn,
        p_check_out: bookingState.search.checkOut,
        p_check_in_time: bookingState.search.checkInTime,
        p_check_out_time: bookingState.search.checkOutTime,
        p_adults: bookingState.search.adults,
        p_children: bookingState.search.children,
        p_full_name: bookingState.contact.fullName,
        p_phone: bookingState.contact.phone,
        p_special_requests: bookingState.contact.specialRequests || null
      };
      if (!bookingState.user) reservationParams.p_email = bookingState.contact.email;
      const { data: reservationId, error: reservationError } = await sb.rpc(rpcName, reservationParams);
      if (reservationError) throw new Error(reservationError.message);

      const confirmation = document.getElementById("confirmationDetails");
      confirmation.textContent = `Your reservation reference is ${reservationId}. ${bookingState.room.room_type} · Room ${bookingState.room.room_number}, ${formatBookingDate(bookingState.search.checkIn)} to ${formatBookingDate(bookingState.search.checkOut)}. Payment is due at the property.`;
      showBookingStep("complete");
      startReturnCountdown();
    } catch (bookingError) {
      const text = bookingError.message || "";
      button.disabled = false;
      button.textContent = "Complete booking";
      const detailIssues = [
        [/email/i, "guestEmail", "The booking system could not accept that email address. Please check it and try again."],
        [/valid guest name/i, "guestName", "Please enter your full name."],
        [/contact phone/i, "guestPhone", "Please enter a phone number we can reach you on."]
      ];
      const issue = detailIssues.find(([pattern]) => pattern.test(text));
      if (issue) {
        // Send the guest back to the details step instead of leaving them on the last page.
        showBookingStep("guest");
        showBookingStatus(issue[2]);
        document.getElementById(issue[1]).focus();
        return;
      }
      showBookingStatus(`We couldn’t complete the booking: ${text}`);
    }
  });
}

initBookingPage().catch((error) => {
  document.getElementById("bookingApp").hidden = false;
  showBookingStatus(`Booking page failed to load: ${error.message}`);
});