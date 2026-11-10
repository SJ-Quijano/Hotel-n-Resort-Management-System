const roomPhotos = [
  "https://images.unsplash.com/photo-1611892440504-42a792e24d32?auto=format&fit=crop&w=1200&q=85",
  "https://images.unsplash.com/photo-1616486338812-3dadae4b4ace?auto=format&fit=crop&w=1200&q=85",
  "https://images.unsplash.com/photo-1590490360182-c33d57733427?auto=format&fit=crop&w=1200&q=85",
  "https://images.unsplash.com/photo-1618773928121-c32242e63f39?auto=format&fit=crop&w=1200&q=85",
  "https://images.unsplash.com/photo-1566665797739-1674de7a421a?auto=format&fit=crop&w=1200&q=85"
];

let allRooms = [];
let activeFilter = "all";

function createRoomArt(index, label, detail = false) {
  const art = document.createElement("div");
  art.className = `room-art room-art--${(index % 3) + 1}${detail ? " room-detail-art" : ""}`;
  if (detail) art.dataset.roomArt = "";
  const image = document.createElement("img");
  image.src = roomPhotos[index % roomPhotos.length];
  image.alt = label;
  image.loading = "lazy";
  image.addEventListener("error", () => image.remove(), { once: true });
  art.appendChild(image);
  return art;
}

function roomCurrency(value) {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: CURRENCY_CODE
  }).format(Number(value));
}

function showRoomListStatus(message, isError = false) {
  const status = document.createElement("p");
  status.className = `room-list-status${isError ? " error" : ""}`;
  status.textContent = message;
  document.getElementById("publicRoomGrid").replaceChildren(status);
}

function openRoomDetails(room, index) {
  document.getElementById("roomDetailTitle").textContent = room.name;
  document.getElementById("roomDetailDescription").textContent =
    room.description || "Contact our reservations team for more information about this room type.";
  document.getElementById("roomDetailCapacity").textContent =
    `${room.capacity} ${Number(room.capacity) === 1 ? "guest" : "guests"}`;
  document.getElementById("roomDetailRate").textContent = `${roomCurrency(room.nightly_rate)} per night`;

  const dialog = document.getElementById("roomDetailDialog");
  const art = createRoomArt(index, `Photo of the ${room.name} room`, true);
  dialog.querySelector("[data-room-art]").replaceWith(art);
  dialog.showModal();
}

function buildRoomCard(room, index) {
  const card = document.createElement("button");
  card.className = "public-room-card";
  card.type = "button";
  card.setAttribute("aria-label", `View details for ${room.name}`);
  card.appendChild(createRoomArt(index, `Photo of the ${room.name} room`));

  const copy = document.createElement("div");
  copy.className = "public-room-copy";
  const title = document.createElement("h3");
  title.textContent = room.name;
  const description = document.createElement("p");
  description.textContent = room.description || "A comfortable room for a considered stay.";
  const meta = document.createElement("div");
  meta.className = "public-room-meta";
  const capacity = document.createElement("span");
  capacity.textContent = `Up to ${room.capacity} ${Number(room.capacity) === 1 ? "guest" : "guests"}`;
  const rate = document.createElement("strong");
  rate.textContent = `${roomCurrency(room.nightly_rate)} / night`;
  meta.append(capacity, rate);
  copy.append(title, description, meta);
  card.appendChild(copy);
  card.addEventListener("click", () => openRoomDetails(room, index));
  return card;
}

function renderRoomCards() {
  const visible = allRooms
    .map((room, index) => ({ room, index }))
    .filter(({ room }) => activeFilter === "all" || String(room.name).toLowerCase().includes(activeFilter));
  if (!visible.length) {
    showRoomListStatus("No rooms in this category yet.");
    return;
  }
  document.getElementById("publicRoomGrid")
    .replaceChildren(...visible.map(({ room, index }) => buildRoomCard(room, index)));
}

async function loadPublicRoomTypes() {
  const { data: rooms, error } = await sb.rpc("get_public_room_types");
  if (error) {
    console.error("Unable to load public room types:", error);
    showRoomListStatus(`Room types could not be loaded: ${error.message}`, true);
    return;
  }
  if (!rooms?.length) {
    showRoomListStatus("There are no active room types to display yet.");
    return;
  }
  allRooms = rooms;
  renderRoomCards();
}

document.querySelectorAll(".kind-tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".kind-tab").forEach((t) => t.classList.remove("is-active"));
    tab.classList.add("is-active");
    const label = tab.textContent.trim().toLowerCase();
    activeFilter = label === "all rooms" ? "all" : label;
    renderRoomCards();
  });
});

document.querySelector(".room-detail-close").addEventListener("click", () => {
  document.getElementById("roomDetailDialog").close();
});
document.getElementById("roomDetailDialog").addEventListener("click", (event) => {
  if (event.target === event.currentTarget) event.currentTarget.close();
});

loadPublicRoomTypes().catch((error) => {
  console.error("Room type page failed to load:", error);
  showRoomListStatus(`Room types could not be loaded: ${error.message}`, true);
});