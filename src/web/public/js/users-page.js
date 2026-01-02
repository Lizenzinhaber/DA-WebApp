async function apiGet(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

async function apiPost(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

let activeUserId = null;

function setActiveUserLabel(name) {
  const el = document.getElementById("activeUserName");
  if (el) el.textContent = name || "none";
}

function setActiveNav(navId) {
  const aDash = document.getElementById("navDashboard");
  const aUsers = document.getElementById("navUsers");
  const aFilter = document.getElementById("navFilter");

  [aDash, aUsers, aFilter].forEach(a => a && a.classList.remove("active"));
  const active = document.getElementById(navId);
  if (active) active.classList.add("active");
}

function showView(which) {
  const vDash = document.getElementById("viewDashboard");
  const vUsers = document.getElementById("viewUsers");

  if (which === "users") {
    if (vDash) vDash.classList.add("d-none");
    if (vUsers) vUsers.classList.remove("d-none");
    setActiveNav("navUsers");
  } else {
    if (vUsers) vUsers.classList.add("d-none");
    if (vDash) vDash.classList.remove("d-none");
    setActiveNav("navDashboard");
  }
}

function renderUserList(users) {
  const list = document.getElementById("userList");
  if (!list) return;

  list.innerHTML = "";

  users.forEach(u => {
    const btn = document.createElement("button");
    btn.type = "button";

    // Bootstrap list-group item
    btn.className = "list-group-item list-group-item-action d-flex justify-content-between align-items-center";

    const isActive = activeUserId === u.id;

    // Nur beim aktiven User steht "aktiv"
    btn.innerHTML = isActive
      ? `<span>${u.name}</span><span class="badge text-bg-success">aktiv</span>`
      : `<span>${u.name}</span><span class="badge text-bg-light"> </span>`;

    // Optional: auch optisch als aktiv markieren (typisches Bootstrap-Verhalten)
    if (isActive) {
      btn.classList.add("active");
      btn.setAttribute("aria-current", "true");
    }

    btn.addEventListener("click", async () => {
      const res = await apiPost("/api/session/active-user", { userId: u.id });
      activeUserId = res.activeUser ? res.activeUser.id : null;
      setActiveUserLabel(res.activeUser ? res.activeUser.name : "none");
      await refreshUsers(); // neu rendern => "aktiv" steht nur noch einmal
    });

    list.appendChild(btn);
  });
}

async function refreshUsers() {
  const users = await apiGet("/api/users");
  renderUserList(users);
}

async function refreshActiveUser() {
  const sess = await apiGet("/api/session");
  activeUserId = sess.activeUser ? sess.activeUser.id : null;
  setActiveUserLabel(sess.activeUser ? sess.activeUser.name : "none");
}

document.addEventListener("DOMContentLoaded", () => {
  const navDashboard = document.getElementById("navDashboard");
  const navUsers = document.getElementById("navUsers");

  if (navDashboard) navDashboard.addEventListener("click", (e) => {
    e.preventDefault();
    showView("dashboard");
  });

  if (navUsers) navUsers.addEventListener("click", async (e) => {
    e.preventDefault();
    showView("users");
    await refreshActiveUser();
    await refreshUsers();
  });

  const btnCreate = document.getElementById("btnCreateUser");
  const input = document.getElementById("newUserName");

  if (btnCreate) btnCreate.addEventListener("click", async () => {
    const name = (input?.value || "").trim();
    if (!name) return;

    await apiPost("/api/users", { name });
    if (input) input.value = "";
    await refreshUsers();
  });

  // initial
  showView("dashboard");
  refreshActiveUser().catch(console.error);
});
