// Set these values from Supabase Project Settings > API before starting the app.
const SUPABASE_URL = "https://srkdhwvkorvjfejleflg.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_HK_E1EGgEkxHTPQjEuDgNw_saSLaZfn";
const CURRENCY_CODE = "PHP";

function isValidPassword(password) {
  return password.length >= 12 &&
    password.length <= 128 &&
    /[A-Z]/.test(password) &&
    /\d/.test(password);
}

if (!window.supabase) {
  throw new Error("Supabase client failed to load. Check your network connection.");
}

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { autoRefreshToken: true, persistSession: true, detectSessionInUrl: true }
});

async function recordAuthEvent(action) {
  let error;
  try {
    const result = await sb.rpc("log_auth_event", { p_action: action });
    error = result.error;
  } catch (requestError) {
    error = requestError;
  }
  if (!error) return null;

  console.error(`Unable to record authentication event "${action}":`, error);
  try {
    sessionStorage.setItem(
      "hotel_audit_warning",
      `Your sign-in succeeded, but activity logging is unavailable (${error.message}). Apply supabase/migrations/002_auth_event.sql in the Supabase SQL Editor, then refresh the page.`
    );
  } catch (storageError) {
    console.error("Unable to preserve the authentication logging warning:", storageError);
  }
  return error;
}

// Menu per role. The administrator menu is handled by pages/admin.html (system data only).
const ROLE_MENUS = {
  guest: [
    "Browse Rooms",
    "Book a Room",
    "My Reservations",
    "My Profile",
    "My Stay",
    "Hotel Services",
    "Billing & Payments",
    "Invoices & Receipts",
    "Feedback & Reviews",
    "Notifications",
    "Account Settings"
  ], //Nakikita nila sa dashboard huhu
  receptionist: ["Guest Registration", "Walk-in Booking", "Reservations", "Check-in", "Check-out", "Room Assignment", "Payment", "Guest Requests"],
  reservation_officer: ["Booking Calendar", "Room Availability", "Guest Booking Details", "Reservation Requests", "Booking Changes", "Cancellation Records", "Promotions and Discounts", "Reservation Reports", "New Reservation"],
  housekeeping: ["Housekeeping", "Maintenance Requests", "Reports"],
  maintenance: ["Maintenance Requests", "Reports"],
  manager: ["Room Management", "Online Reservation", "Guest Registration", "Check-in", "Check-out", "Room Assignment", "Housekeeping", "Maintenance Requests", "Billing", "Payment", "Discounts", "Cancellation", "Customer Feedback", "Reports", "Audit Logs"],
  accountant: ["Guest Registration", "Check-out", "Billing", "Payment", "Discounts", "Cancellation", "Reports", "Audit Logs"],
  admin: [
    "User Management",
    "Role Permissions",
    "Room Categories",
    "System Settings",
    "Activity Logs",
    //"Login & Security",
    //"Database & Backup",
    "Reports"
  ]
};