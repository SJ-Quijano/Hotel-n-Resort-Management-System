/* Guest dashboard */

const CHECK_IN_TIME = "2:00 PM";
const CHECK_OUT_TIME = "12:00 NN";
const HOTEL_INFO = "Front desk is open 24/7. Please bring a valid ID at check-in."; // edit freely
const MAX_PROOF_MB = 5;
const PAID_PAYMENT_STATUSES = ["completed", "paid", "succeeded"];

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const money = (n) => new Intl.NumberFormat("en-PH", {
  style: "currency",
  currency: "PHP"
}).format(Number(n || 0));
const parseDate = (d) => new Date(`${d}T00:00:00`);
const fmtDate = (d) => (d ? parseDate(d).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "-");
const localToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const nightsBetween = (a, b) => Math.max(1, Math.round((parseDate(b) - parseDate(a)) / 864e5));
const cls = (s) => String(s || "").toLowerCase().replace(/[^a-z_]/g, "");

const state = {
  uid: null, email: "", profile: {}, guest: null,
  reservations: [], invoices: [], payments: [], proofs: [], feedback: [], roomTypes: [],
  filter: "all", warnings: []
};

/* ---------- data ---------- */
function note(label, error) {
  if (error) {
    console.error(label, error);
    state.warnings.push(`${label}: ${error.message}`);
  }
}

async function load() {
  const { data: { session } } = await sb.auth.getSession();
  state.uid = session.user.id;
  state.email = session.user.email || "";

  const [prof, guestRes, types] = await Promise.all([
    sb.from("profiles").select("full_name,email,phone").eq("id", state.uid).maybeSingle(),
    sb.from("guests").select("*").or(`user_id.eq.${state.uid},profile_id.eq.${state.uid}`).limit(1).maybeSingle(),
    sb.from("room_types").select("*").eq("active", true)
  ]);
  note("Profile", prof.error);
  note("Guest record", guestRes.error);
  note("Room types", types.error);
  state.profile = prof.data || {};
  state.guest = guestRes.data || null;
  state.roomTypes = (types.data || []).sort((a, b) => rate(a) - rate(b));

  if (!state.guest) return;
  const gid = state.guest.id;

  let r = await sb.from("reservations").select("*, rooms(room_number, room_types(name))")
    .eq("guest_id", gid).order("check_in", { ascending: false });
  if (r.error) {
    r = await sb.from("reservations").select("*").eq("guest_id", gid).order("check_in", { ascending: false });
  }
  note("Reservations", r.error);
  state.reservations = r.data || [];

  const ids = state.reservations.map((x) => x.id);
  if (ids.length) {
    const inv = await sb.from("invoices").select("*").in("reservation_id", ids);
    note("Invoices", inv.error);
    state.invoices = inv.data || [];
    const invIds = state.invoices.map((x) => x.id);
    if (invIds.length) {
      const pay = await sb.from("payments").select("*").in("invoice_id", invIds);
      note("Payments", pay.error);
      state.payments = pay.data || [];
    }
  }
  const proofs = await sb.from("payment_proofs").select("*").eq("guest_id", gid);
  if (proofs.error && proofs.error.code !== "42P01" && proofs.error.code !== "PGRST205") note("Payment proofs", proofs.error);
  state.proofs = proofs.data || [];

  const fb = await sb.from("feedback").select("*").eq("guest_id", gid).order("created_at", { ascending: false });
  note("Feedback", fb.error);
  state.feedback = fb.data || [];
}

/* ---------- derived helpers ---------- */
const rate = (t) => Number(t.nightly_rate) || Number(t.base_rate) || 0;
const resById = (id) => state.reservations.find((r) => r.id === id);
const invoiceFor = (res) => state.invoices.find((i) => i.reservation_id === res.id);
const paidOn = (inv) => state.payments
  .filter((p) => p.invoice_id === inv.id && PAID_PAYMENT_STATUSES.includes(String(p.status || "").toLowerCase()))
  .reduce((s, p) => s + Number(p.amount || 0), 0);
const proofsFor = (inv) => state.proofs.filter((p) => p.invoice_id === inv.id);
function payState(inv) {
  const total = Number(inv.total || 0);
  const paid = paidOn(inv);
  if (String(inv.status || "").toLowerCase() === "paid" || (total > 0 && paid >= total)) return "paid";
  if (proofsFor(inv).some((p) => p.status === "pending")) return "proof_submitted";
  return paid > 0 ? "partial" : "unpaid";
}
const labelOf = (s) => s.replace("_", " ");
const status = (r) => String(r.status || "").toLowerCase();
const isCancelled = (r) => status(r) === "cancelled" || status(r) === "canceled";
const isPast = (r) => !isCancelled(r) && (["checked_out", "completed"].includes(status(r)) || r.check_out < localToday());
const isUpcoming = (r) => !isCancelled(r) && !isPast(r);
const canChange = (r) => ["pending", "confirmed"].includes(status(r)) && r.check_in > localToday();
const roomLabel = (r) => {
  const type = r.rooms?.room_types?.name;
  const num = r.rooms?.room_number;
  return type ? `${type}${num ? ` · Room ${num}` : ""}` : `Room ${r.room_id ?? ""}`.trim();
};

/* ---------- ui helpers ---------- */
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (t.hidden = true), 3500);
}
const openModal = (html) => { $("#modalBody").innerHTML = html; $("#modal").hidden = false; };
const closeModal = () => { $("#modal").hidden = true; };

const titles = { overview: "Overview", rooms: "Browse Rooms", bookings: "My Reservations", billing: "Billing & Receipts", reviews: "Feedback & Reviews", profile: "My Profile" };
function show(view) {
  $$(".view").forEach((v) => v.classList.toggle("active", v.id === `view-${view}`));
  $$(".nav-btn[data-view]").forEach((b) => b.classList.toggle("active", b.dataset.view === view));
  $("#viewTitle").textContent = titles[view];
  $("#sidebar").classList.remove("open");
}

/* ---------- renderers ---------- */
function renderBanner() {
  const b = $("#banner");
  const msgs = [];
  if (!state.guest) msgs.push("Your guest profile isn't set up yet. Fill in My Profile and save to create it.");
  if (state.warnings.length) msgs.push(`Some information couldn't be loaded (${esc(state.warnings[0])}). Please contact the front desk if this continues.`);
  b.hidden = !msgs.length;
  b.innerHTML = msgs.join("<br>");
}

function renderOverview() {
  $("#guestName").textContent = state.guest?.full_name || state.profile.full_name || state.email;
  const up = state.reservations.filter(isUpcoming);
  $("#statUpcoming").textContent = up.length;
  $("#statPast").textContent = state.reservations.filter(isPast).length;
  const due = state.invoices.reduce((s, i) => {
    const res = resById(i.reservation_id);
    if (!res || isCancelled(res)) return s;
    return s + Math.max(0, Number(i.total || 0) - paidOn(i));
  }, 0);
  $("#statDue").textContent = money(due);

  const next = [...up].sort((a, b) => a.check_in.localeCompare(b.check_in))[0];
  $("#nextStay").innerHTML = next
    ? `<h2>Your next stay</h2>
       <p><b>${esc(roomLabel(next))}</b><br>${fmtDate(next.check_in)} → ${fmtDate(next.check_out)} (${nightsBetween(next.check_in, next.check_out)} nights)</p>
       <p class="muted">Check-in from ${CHECK_IN_TIME} · Check-out until ${CHECK_OUT_TIME}</p>
       <button class="btn sm" data-details="${esc(next.id)}">Check-in details</button>`
    : `<h2>No upcoming stays</h2><p>Ready for a getaway?</p><a class="btn primary sm" href="book.html">Book a room</a>`;
  $("#hotelInfo").innerHTML = `<h2>Hotel information</h2><p>Check-in from <b>${CHECK_IN_TIME}</b> · Check-out until <b>${CHECK_OUT_TIME}</b></p><p class="muted">${esc(HOTEL_INFO)}</p>`;
}

function renderRooms() {
  $("#roomGrid").innerHTML = state.roomTypes.length
    ? state.roomTypes.map((t) => `<article class="room">
        <h3>${esc(t.name)}</h3>
        <p class="muted">${esc(t.description || "")}</p>
        <div class="price">${money(rate(t))} <small>/ night · up to ${esc(t.capacity ?? "-")} guests</small></div>
        <a class="btn primary" href="book.html">Check availability &amp; book</a>
      </article>`).join("")
    : '<p class="muted">Room information is not available right now.</p>';
}

function renderBookings() {
  const f = state.filter;
  const list = state.reservations.filter((r) =>
    f === "all" || (f === "upcoming" && isUpcoming(r)) || (f === "past" && isPast(r)) || (f === "cancelled" && isCancelled(r)));
  $("#bookingList").innerHTML = list.length ? list.map((r) => `
    <div class="booking">
      <div>
        <h3>${esc(roomLabel(r))} <span class="badge ${cls(r.status)}">${esc(labelOf(String(r.status || "")))}</span></h3>
        <div class="muted">${fmtDate(r.check_in)} → ${fmtDate(r.check_out)} · ${esc(r.adults ?? 1)} adult(s)${r.children ? `, ${esc(r.children)} child(ren)` : ""} · ${money(r.total_amount)}</div>
      </div>
      <div class="actions">
        <button class="btn sm" data-details="${esc(r.id)}">Check-in details</button>
        ${canChange(r) ? `<button class="btn sm" data-change="${esc(r.id)}">Request change</button>
                          <button class="btn sm danger" data-cancel="${esc(r.id)}">Cancel</button>` : ""}
      </div>
    </div>`).join("") : '<p class="muted">No reservations here yet.</p>';
}

function renderBilling() {
  const rows = state.invoices.map((inv) => {
    const res = resById(inv.reservation_id);
    const ps = payState(inv);
    const cancelled = res && isCancelled(res);
    return `<tr>
      <td>${esc(inv.invoice_number || `#${inv.id}`)}</td>
      <td>${res ? `${esc(roomLabel(res))}<br><span class="muted">${fmtDate(res.check_in)} → ${fmtDate(res.check_out)}</span>` : "-"}</td>
      <td>${money(inv.total)}</td>
      <td>${money(paidOn(inv))}</td>
      <td><span class="badge ${ps}">${labelOf(ps)}</span></td>
      <td class="actions">
        ${ps !== "paid" && !cancelled ? `<button class="btn sm" data-proof="${esc(inv.id)}">Upload proof</button>` : ""}
        <button class="btn sm" data-receipt="${esc(inv.id)}">${ps === "paid" ? "Receipt" : "Invoice"}</button>
      </td></tr>`;
  });
  $("#billingRows").innerHTML = rows.join("") || '<tr><td colspan="6" class="muted">No invoices yet. They appear once your reservation is confirmed.</td></tr>';
}

function renderReviews() {
  const reviewed = new Set(state.feedback.map((f) => f.reservation_id));
  const eligible = state.reservations.filter((r) => isPast(r) && !reviewed.has(r.id));
  $("#reviewReservation").innerHTML = eligible.length
    ? eligible.map((r) => `<option value="${esc(r.id)}">${esc(roomLabel(r))} · ${fmtDate(r.check_in)}</option>`).join("")
    : '<option value="">No completed stays to review</option>';
  $("#reviewList").innerHTML = state.feedback.map((f) => {
    const res = resById(f.reservation_id);
    const rating = Math.min(5, Math.max(0, Number(f.rating) || 0));
    return `<div class="card"><div class="stars">${"★".repeat(rating)}${"☆".repeat(5 - rating)}</div>
      <p>${esc(f.comment || f.comments || "")}</p>
      <p class="muted">${res ? `${esc(roomLabel(res))} · ` : ""}${f.created_at ? fmtDate(f.created_at.slice(0, 10)) : ""}</p></div>`;
  }).join("");
}

function renderProfile() {
  $("#pName").value = state.guest?.full_name || state.profile.full_name || "";
  $("#pEmail").value = state.guest?.email || state.profile.email || state.email;
  $("#pPhone").value = state.guest?.phone || state.profile.phone || "";
  $("#pAddress").value = state.guest?.address || "";
}

function renderAll() {
  renderBanner(); renderOverview(); renderRooms(); renderBookings(); renderBilling(); renderReviews(); renderProfile();
}

/* ---------- actions ---------- */
function showDetails(id) {
  const r = resById(id);
  if (!r) return;
  openModal(`<h2>Stay details</h2>
    <p><b>${esc(roomLabel(r))}</b> <span class="badge ${cls(r.status)}">${esc(labelOf(String(r.status || "")))}</span></p>
    <p>Arrival: <b>${fmtDate(r.check_in)}</b>, from ${CHECK_IN_TIME}<br>Departure: <b>${fmtDate(r.check_out)}</b>, until ${CHECK_OUT_TIME}</p>
    <p>Guests: ${esc(r.adults ?? 1)} adult(s)${r.children ? `, ${esc(r.children)} child(ren)` : ""}<br>
       Rate: ${money(r.nightly_rate)} / night · Total: ${money(r.total_amount)}</p>
    ${r.special_requests ? `<p class="muted">Special requests: ${esc(r.special_requests)}</p>` : ""}
    <p class="muted">Please bring a valid ID.</p>`);
}

async function cancelReservation(id) {
  if (!confirm("Cancel this reservation?")) return;
  const { error } = await sb.rpc("guest_cancel_reservation", { p_reservation: id });
  if (error) { console.error(error); return toast(`Couldn't cancel: ${error.message}`); }
  const r = resById(id);
  if (r) r.status = "cancelled";
  renderAll();
  toast("Reservation cancelled");
}

function changeForm(id) {
  openModal(`<h2>Request a change</h2>
    <p class="muted">Tell us what you'd like to change (dates, room, guests). The front desk will confirm with you.</p>
    <form id="changeForm">
      <label>Your request <textarea id="changeNote" rows="4" maxlength="500" required></textarea></label>
      <button class="btn primary" type="submit">Send request</button>
    </form>`);
  $("#changeForm").onsubmit = async (e) => {
    e.preventDefault();
    const { error } = await sb.rpc("guest_request_reservation_change", { p_reservation: id, p_note: $("#changeNote").value.trim() });
    if (error) { console.error(error); return toast(`Couldn't send request: ${error.message}`); }
    closeModal();
    toast("Request sent to the front desk");
  };
}

function proofForm(invoiceId) {
  openModal(`<h2>Upload payment proof</h2>
    <form id="proofForm">
      <label>Screenshot or receipt (image or PDF, max ${MAX_PROOF_MB} MB) <input type="file" id="proofFile" accept="image/*,.pdf" required></label>
      <label>Note (optional) <input id="proofNote" maxlength="200" placeholder="Reference number, bank, etc."></label>
      <button class="btn primary" type="submit">Upload</button>
    </form>`);
  $("#proofForm").onsubmit = async (e) => {
    e.preventDefault();
    const file = $("#proofFile").files[0];
    if (!file) return;
    if (file.size > MAX_PROOF_MB * 1024 * 1024) return toast(`File is larger than ${MAX_PROOF_MB} MB`);
    const btn = e.submitter; btn.disabled = true;
    const safeName = file.name.replace(/[^\w.\-]/g, "_");
    const path = `${state.uid}/${invoiceId}-${Date.now()}-${safeName}`;
    const up = await sb.storage.from("payment-proofs").upload(path, file);
    if (up.error) { btn.disabled = false; console.error(up.error); return toast(`Upload failed: ${up.error.message}`); }
    const ins = await sb.from("payment_proofs")
      .insert({ invoice_id: Number(invoiceId), guest_id: state.guest.id, file_path: path, note: $("#proofNote").value.trim() || null })
      .select().single();
    if (ins.error) { btn.disabled = false; console.error(ins.error); return toast(`Couldn't save proof: ${ins.error.message}`); }
    state.proofs.push(ins.data);
    closeModal(); renderAll();
    toast("Proof uploaded. We'll verify your payment shortly.");
  };
}

function showReceipt(invoiceId) {
  const inv = state.invoices.find((i) => String(i.id) === String(invoiceId));
  if (!inv) return;
  const res = resById(inv.reservation_id);
  const ps = payState(inv);
  const payments = state.payments.filter((p) => p.invoice_id === inv.id && PAID_PAYMENT_STATUSES.includes(String(p.status || "").toLowerCase()));
  openModal(`<div class="receipt">
    <h2>${ps === "paid" ? "Receipt" : "Invoice"} ${esc(inv.invoice_number || `#${inv.id}`)}</h2>
    <p><b>${esc(state.guest?.full_name || state.email)}</b></p>
    ${res ? `<p>${esc(roomLabel(res))}<br>${fmtDate(res.check_in)} → ${fmtDate(res.check_out)} (${nightsBetween(res.check_in, res.check_out)} nights)</p>` : ""}
    <dl>
      <dt>Subtotal</dt><dd>${money(inv.subtotal ?? inv.total)}</dd>
      ${Number(inv.discount_amount) ? `<dt>Discount</dt><dd>-${money(inv.discount_amount)}</dd>` : ""}
      ${Number(inv.tax_amount) ? `<dt>Tax</dt><dd>${money(inv.tax_amount)}</dd>` : ""}
      <dt><b>Total</b></dt><dd><b>${money(inv.total)}</b></dd>
      <dt>Paid</dt><dd>${money(paidOn(inv))}</dd>
      <dt>Status</dt><dd><span class="badge ${ps}">${labelOf(ps)}</span></dd>
    </dl>
    ${payments.length ? `<p class="muted">Payments: ${payments.map((p) => `${money(p.amount)} via ${esc(p.method || "n/a")}${p.paid_at ? ` on ${fmtDate(p.paid_at.slice(0, 10))}` : ""}`).join("; ")}</p>` : ""}
  </div>
  <button class="btn primary no-print" id="printBtn">Download / Print</button>`);
  $("#printBtn").onclick = () => {
    document.body.classList.add("print-receipt");
    window.addEventListener("afterprint", () => document.body.classList.remove("print-receipt"), { once: true });
    window.print();
  };
}

/* ---------- wiring ---------- */
function wire() {
  document.addEventListener("click", (e) => {
    const t = e.target.closest("button");
    if (!t) return;
    const d = t.dataset;
    if (d.view) show(d.view);
    else if (d.details) showDetails(d.details);
    else if (d.cancel) cancelReservation(d.cancel);
    else if (d.change) changeForm(d.change);
    else if (d.proof) proofForm(d.proof);
    else if (d.receipt) showReceipt(d.receipt);
    else if (t.classList.contains("tab")) {
      state.filter = d.filter;
      $$(".tab").forEach((x) => x.classList.toggle("active", x === t));
      renderBookings();
    }
  });
  $("#menuToggle").onclick = () => $("#sidebar").classList.toggle("open");
  $("#modalClose").onclick = closeModal;
  $("#modal").onclick = (e) => { if (e.target.id === "modal") closeModal(); };

  $("#logoutBtn").onclick = async () => {
    try { if (typeof recordAuthEvent === "function") await recordAuthEvent("logout"); } catch (_) { /* ignore */ }
    await sb.auth.signOut();
    window.location.replace("index.html");
  };

  $("#profileForm").onsubmit = async (e) => {
    e.preventDefault();
    const row = {
      full_name: $("#pName").value.trim(),
      phone: $("#pPhone").value.trim() || null,
      address: $("#pAddress").value.trim() || null
    };
    let res;
    if (state.guest) {
      res = await sb.from("guests").update(row).eq("id", state.guest.id).select().single();
    } else {
      res = await sb.from("guests").insert({ ...row, user_id: state.uid, email: state.email }).select().single();
    }
    if (res.error) { console.error(res.error); return toast(`Couldn't save: ${res.error.message}`); }
    state.guest = res.data;
    await sb.from("profiles").update({ full_name: row.full_name, phone: row.phone }).eq("id", state.uid); // best effort
    renderAll();
    toast("Profile updated");
  };

  $("#reviewForm").onsubmit = async (e) => {
    e.preventDefault();
    const reservationId = $("#reviewReservation").value;
    if (!reservationId || !state.guest) return;
    const { data, error } = await sb.from("feedback")
      .insert({ guest_id: state.guest.id, reservation_id: reservationId, rating: Number($("#reviewRating").value), comment: $("#reviewText").value.trim() || null })
      .select().single();
    if (error) { console.error(error); return toast(`Couldn't submit: ${error.message}`); }
    state.feedback.unshift(data);
    $("#reviewText").value = "";
    renderReviews();
    toast("Thanks for your feedback!");
  };
}

(async function init() {
  const allowed = await RoleGuard.require("guest");
  if (!allowed) return;
  wire();
  try {
    await load();
  } catch (err) {
    console.error(err);
    state.warnings.push(err.message || "Unexpected error");
  }
  renderAll();
})();