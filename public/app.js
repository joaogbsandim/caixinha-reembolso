const state = {
  user: null,
  token: localStorage.getItem("authToken") || "",
  companies: [],
  projects: [],
  draftExpenses: [],
  reports: [],
  users: [],
  imageDataUrl: null,
  catalogKind: null,
  decisionReportId: null,
  decisionStatus: null,
  editingUserId: null
};

const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const statusLabels = { pending: "Pendente", approved: "Aprovado", returned: "Devolvido" };
const roleLabels = { admin: "Administrador", employee: "Colaborador" };

const dom = {
  authScreen: document.querySelector("#authScreen"),
  changePasswordScreen: document.querySelector("#changePasswordScreen"),
  changePasswordForm: document.querySelector("#changePasswordForm"),
  changePasswordMessage: document.querySelector("#changePasswordMessage"),
  appShell: document.querySelector("#appShell"),
  loginForm: document.querySelector("#loginForm"),
  loginMessage: document.querySelector("#loginMessage"),
  logoutButton: document.querySelector("#logoutButton"),
  userName: document.querySelector("#userName"),
  userRole: document.querySelector("#userRole"),
  form: document.querySelector("#expenseForm"),
  receiptInput: document.querySelector("#receiptInput"),
  receiptPreview: document.querySelector("#receiptPreview"),
  companySelect: document.querySelector("[name='company']"),
  projectSelect: document.querySelector("[name='project']"),
  draftList: document.querySelector("#draftList"),
  draftCount: document.querySelector("#draftCount"),
  draftTotal: document.querySelector("#draftTotal"),
  reportList: document.querySelector("#reportList"),
  adminList: document.querySelector("#adminList"),
  approvedList: document.querySelector("#approvedList"),
  reportCount: document.querySelector("#reportCount"),
  approvedCount: document.querySelector("#approvedCount"),
  submitReportButton: document.querySelector("#submitReportButton"),
  toast: document.querySelector("#toast"),
  catalogModal: document.querySelector("#catalogModal"),
  catalogForm: document.querySelector("#catalogForm"),
  catalogTitle: document.querySelector("#catalogTitle"),
  catalogLabel: document.querySelector("#catalogLabel"),
  catalogNameInput: document.querySelector("#catalogNameInput"),
  catalogCloseButton: document.querySelector("#catalogCloseButton"),
  catalogCancelButton: document.querySelector("#catalogCancelButton"),
  decisionModal: document.querySelector("#decisionModal"),
  decisionForm: document.querySelector("#decisionForm"),
  decisionTitle: document.querySelector("#decisionTitle"),
  decisionLabel: document.querySelector("#decisionLabel"),
  decisionReasonInput: document.querySelector("#decisionReasonInput"),
  decisionCloseButton: document.querySelector("#decisionCloseButton"),
  decisionCancelButton: document.querySelector("#decisionCancelButton"),
  userList: document.querySelector("#userList"),
  newUserButton: document.querySelector("#newUserButton"),
  userModal: document.querySelector("#userModal"),
  userForm: document.querySelector("#userForm"),
  userModalTitle: document.querySelector("#userModalTitle"),
  userNameInput: document.querySelector("#userNameInput"),
  userUsernameInput: document.querySelector("#userUsernameInput"),
  userRoleInput: document.querySelector("#userRoleInput"),
  userModalMessage: document.querySelector("#userModalMessage"),
  userModalClose: document.querySelector("#userModalClose"),
  userModalCancel: document.querySelector("#userModalCancel"),
  userModalSubmit: document.querySelector("#userModalSubmit")
};

function formatDate(value) {
  if (!value) return "";
  const [year, month, day] = value.split("-");
  return `${day}/${month}/${year}`;
}

function showToast(message) {
  dom.toast.textContent = message;
  dom.toast.classList.add("is-visible");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => dom.toast.classList.remove("is-visible"), 3200);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      ...(state.token ? { Authorization: `Bearer ${state.token}` } : {}),
      ...(options.headers || {})
    },
    ...options
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Falha na operacao.");
  return data;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

function empty(message) {
  const div = document.createElement("div");
  div.className = "empty";
  div.textContent = message;
  return div;
}

function receiptPlaceholder() {
  return "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Crect width='120' height='120' fill='%23edf2ef'/%3E%3Cpath d='M38 30h44v60l-8-5-7 5-7-5-7 5-7-5-8 5z' fill='%23b8c7c1'/%3E%3C/svg%3E";
}

function isPdf(url = "") { return String(url).toLowerCase().split("?")[0].endsWith(".pdf"); }

function receiptPreviewHtml(url, label = "Comprovante") {
  const safeUrl = escapeHtml(url || receiptPlaceholder());
  if (isPdf(url)) return `<a class="pdf-thumb" href="${safeUrl}" target="_blank" rel="noopener">PDF</a>`;
  return `<a href="${safeUrl}" target="_blank" rel="noopener"><img src="${safeUrl}" alt="${escapeHtml(label)}" onerror="this.src='${receiptPlaceholder()}'"></a>`;
}

function optionHtml(value) { return `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`; }

function renderOptions(selected = {}) {
  dom.companySelect.innerHTML = state.companies.map(optionHtml).join("");
  dom.projectSelect.innerHTML = state.projects.map(optionHtml).join("");
  if (selected.company) dom.companySelect.value = selected.company;
  if (selected.project) dom.projectSelect.value = selected.project;
}

function applyAuthState() {
  const logged = Boolean(state.user);
  const mustChange = logged && state.user.must_change_password;

  dom.authScreen.hidden = logged || mustChange;
  dom.authScreen.classList.toggle("is-hidden", logged || mustChange);

  dom.changePasswordScreen.hidden = !mustChange;
  dom.changePasswordScreen.classList.toggle("is-hidden", !mustChange);

  dom.appShell.hidden = !logged || mustChange;
  dom.appShell.classList.toggle("is-hidden", !logged || mustChange);

  if (!logged || mustChange) return;

  dom.userName.textContent = state.user.name;
  dom.userRole.textContent = roleLabels[state.user.role] || state.user.role;
  document.querySelectorAll(".admin-only").forEach(el => el.classList.toggle("is-hidden", state.user.role !== "admin"));
  document.querySelectorAll(".employee-only").forEach(el => el.classList.toggle("is-hidden", state.user.role === "admin"));

  const activeView = document.querySelector(".view.is-active")?.id;
  if (state.user.role === "admin" && ["employeeView", "reportsView"].includes(activeView)) {
    activateView("adminView");
  } else if (state.user.role !== "admin" && activeView === "adminView") {
    activateView("employeeView");
  }
}

function activateView(viewId) {
  document.querySelectorAll(".tab").forEach(tab => tab.classList.toggle("is-active", tab.dataset.view === viewId));
  document.querySelectorAll(".view").forEach(view => view.classList.toggle("is-active", view.id === viewId));
  if (viewId === "usersView") loadUsers();
}

// ---------------------------------------------------------------------------
// Drag and drop
// ---------------------------------------------------------------------------
function setupDropZone() {
  const zone = dom.receiptPreview;

  zone.addEventListener("dragover", e => {
    e.preventDefault();
    zone.classList.add("drag-over");
  });

  zone.addEventListener("dragleave", () => zone.classList.remove("drag-over"));

  zone.addEventListener("drop", async e => {
    e.preventDefault();
    zone.classList.remove("drag-over");
    const file = e.dataTransfer.files[0];
    if (file) {
      try { await handleImageSelection(file); }
      catch (err) { showToast(err.message); }
    }
  });

  zone.addEventListener("click", () => dom.receiptInput.click());
}

// ---------------------------------------------------------------------------
// Render drafts
// ---------------------------------------------------------------------------
function renderDrafts() {
  const total = state.draftExpenses.reduce((sum, e) => sum + e.amount, 0);
  dom.draftCount.textContent = `${state.draftExpenses.length} ${state.draftExpenses.length === 1 ? "item" : "itens"}`;
  dom.draftTotal.textContent = money.format(total);
  dom.submitReportButton.disabled = state.draftExpenses.length === 0;
  dom.draftList.innerHTML = "";

  if (!state.draftExpenses.length) { dom.draftList.append(empty("Nenhum comprovante em aberto.")); return; }

  const template = document.querySelector("#expenseTemplate");
  state.draftExpenses.forEach(expense => {
    const node = template.content.cloneNode(true);
    const image = node.querySelector("img");
    image.src = expense.image_url || expense.imageUrl || receiptPlaceholder();
    image.alt = `Comprovante de ${expense.supplier}`;
    node.querySelector("strong").textContent = expense.supplier;
    node.querySelector(".item-head span").textContent = money.format(expense.amount);
    node.querySelector("p").textContent = `${expense.company} - ${expense.project}`;
    node.querySelector("small").textContent = `${formatDate(expense.date)} - ${expense.description || "Sem descricao"}`;
    node.querySelector("button").addEventListener("click", () => removeExpense(expense.id));
    dom.draftList.append(node);
  });
}

// ---------------------------------------------------------------------------
// Render reports
// ---------------------------------------------------------------------------
function renderReports() {
  const openReports = state.reports.filter(r => r.status !== "approved");
  dom.reportCount.textContent = `${openReports.length} em aberto`;
  dom.reportList.innerHTML = "";
  if (!openReports.length) { dom.reportList.append(empty("Nenhum pedido em aberto.")); return; }
  openReports.forEach(r => dom.reportList.append(reportNode(r, false, r.status === "returned")));
}

function renderAdmin() {
  dom.adminList.innerHTML = "";
  if (state.user?.role !== "admin") { dom.adminList.append(empty("Acesso restrito ao administrador.")); return; }
  const pending = state.reports.filter(r => r.status === "pending");
  if (!pending.length) { dom.adminList.append(empty("Nenhum pedido pendente no momento.")); return; }
  pending.forEach(r => dom.adminList.append(reportNode(r, true)));
}

function renderApproved() {
  dom.approvedList.innerHTML = "";
  const approved = state.reports.filter(r => r.status === "approved");
  dom.approvedCount.textContent = `${approved.length} ${approved.length === 1 ? "aprovado" : "aprovados"}`;
  if (!approved.length) { dom.approvedList.append(empty("Nenhum pedido aprovado ainda.")); return; }
  approved.forEach(r => dom.approvedList.append(reportNode(r, false, true)));
}

function reportNode(report, withActions, forceOpen = false) {
  const template = document.querySelector("#reportTemplate");
  const node = template.content.cloneNode(true);
  const article = node.querySelector(".report-item");
  const status = node.querySelector(".status");
  const expenseList = node.querySelector(".report-expenses");
  if (withActions) article.classList.add("admin-report");
  if (withActions || forceOpen) {
    node.querySelector("details").open = true;
    node.querySelector("summary").textContent = withActions ? "Checklist dos comprovantes" : "Comprovantes";
  }

  node.querySelector("strong").textContent = report.code;
  status.textContent = statusLabels[report.status] || report.status;
  status.classList.add(report.status);
  node.querySelector("p").textContent = `${report.employee} - ${money.format(report.total)}`;
  node.querySelector("small").textContent = `Enviado em ${new Date(report.created_at || report.createdAt).toLocaleString("pt-BR")}`;

  if (report.decision_reason || report.decisionReason) {
    const reason = document.createElement("div");
    reason.className = "decision-reason";
    reason.textContent = `Motivo: ${report.decision_reason || report.decisionReason}`;
    node.querySelector(".item-body").insertBefore(reason, node.querySelector("details"));
  }
  if (report.status === "approved") {
    const approved = document.createElement("div");
    approved.className = "decision-reason approved-note";
    approved.textContent = `Aprovado em ${new Date(report.updated_at || report.updatedAt).toLocaleString("pt-BR")}`;
    node.querySelector(".item-body").insertBefore(approved, node.querySelector("details"));
  }

  const expenses = report.expenses || [];
  expenses.forEach((expense, index) => {
    const item = document.createElement("div");
    item.className = withActions ? "mini-expense checklist-expense" : "mini-expense";
    const imgUrl = expense.image_url || expense.imageUrl;
    item.innerHTML = withActions
      ? `<input class="expense-check" type="checkbox" aria-label="Conferir despesa ${index + 1}">
         <span class="expense-number">${String(index + 1).padStart(2, "0")}</span>
         ${receiptPreviewHtml(imgUrl, `Comprovante ${index + 1}`)}
         <div>
           <strong>${escapeHtml(expense.supplier)} - ${money.format(expense.amount)}</strong>
           <p>${escapeHtml(expense.company)} - ${escapeHtml(expense.project)} - ${formatDate(expense.date)}</p>
           <small>${escapeHtml(expense.description || "Sem descricao")}</small>
         </div>`
      : `${receiptPreviewHtml(imgUrl)}
         <div>
           <strong>${escapeHtml(expense.supplier)} - ${money.format(expense.amount)}</strong>
           <p>${escapeHtml(expense.company)} - ${escapeHtml(expense.project)} - ${formatDate(expense.date)}</p>
         </div>`;
    expenseList.append(item);
  });

  if (withActions) {
    const actions = node.querySelector(".status-actions");
    actions.append(actionButton("Aprovar", "approved", report.status === "approved"));
    actions.append(actionButton("Devolver", "returned", report.status === "returned", false, "warning"));
    actions.querySelectorAll("button").forEach(btn => {
      btn.addEventListener("click", () => handleReportAction(report.id, btn.dataset.status));
    });
  } else {
    node.querySelector(".status-actions").remove();
  }

  return article;
}

function actionButton(label, status, disabled, danger = false, variant = "") {
  const button = document.createElement("button");
  button.className = `button ${danger ? "danger" : variant || "ghost"}`;
  button.type = "button";
  button.dataset.status = status;
  button.disabled = disabled;
  button.textContent = label;
  return button;
}

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------
async function loadUsers() {
  if (state.user?.role !== "admin") return;
  try {
    const data = await api("/api/users");
    state.users = data.users;
    renderUsers();
  } catch (err) { showToast(err.message); }
}

function renderUsers() {
  dom.userList.innerHTML = "";
  if (!state.users.length) { dom.userList.append(empty("Nenhum usuario cadastrado.")); return; }

  state.users.forEach(user => {
    const item = document.createElement("div");
    item.className = "item user-item";
    item.innerHTML = `
      <div class="item-body">
        <div class="item-head">
          <strong>${escapeHtml(user.name)}</strong>
          <span class="status ${user.active ? "" : "inactive"}">${user.active ? roleLabels[user.role] : "Inativo"}</span>
        </div>
        <p style="color:var(--muted);font-size:0.88rem;">@${escapeHtml(user.username)}${user.must_change_password ? " · Senha temporaria" : ""}</p>
      </div>
      <div class="status-actions user-actions"></div>
    `;

    const actions = item.querySelector(".user-actions");

    const editBtn = document.createElement("button");
    editBtn.className = "button ghost";
    editBtn.textContent = "Editar";
    editBtn.addEventListener("click", () => openUserModal(user));
    actions.append(editBtn);

    const resetBtn = document.createElement("button");
    resetBtn.className = "button ghost";
    resetBtn.textContent = "Resetar senha";
    resetBtn.addEventListener("click", () => resetPassword(user));
    actions.append(resetBtn);

    const toggleBtn = document.createElement("button");
    toggleBtn.className = user.active ? "button warning" : "button ghost";
    toggleBtn.textContent = user.active ? "Desativar" : "Reativar";
    toggleBtn.addEventListener("click", () => toggleUserActive(user));
    actions.append(toggleBtn);

    if (user.id !== state.user.id) {
      const delBtn = document.createElement("button");
      delBtn.className = "button danger";
      delBtn.textContent = "Apagar";
      delBtn.addEventListener("click", () => deleteUser(user));
      actions.append(delBtn);
    }

    dom.userList.append(item);
  });
}

function openUserModal(user = null) {
  state.editingUserId = user ? user.id : null;
  dom.userModalTitle.textContent = user ? "Editar usuario" : "Novo usuario";
  dom.userNameInput.value = user ? user.name : "";
  dom.userUsernameInput.value = user ? user.username : "";
  dom.userRoleInput.value = user ? user.role : "employee";
  dom.userUsernameInput.disabled = false;
  dom.userModalMessage.textContent = "";
  dom.userModal.hidden = false;
  dom.userModal.classList.remove("is-hidden");
  setTimeout(() => dom.userNameInput.focus(), 50);
}

function closeUserModal() {
  state.editingUserId = null;
  dom.userModal.hidden = true;
  dom.userModal.classList.add("is-hidden");
  dom.userForm.reset();
}

async function saveUser(event) {
  event.preventDefault();
  const name = dom.userNameInput.value.trim();
  const username = dom.userUsernameInput.value.trim();
  const role = dom.userRoleInput.value;
  dom.userModalMessage.textContent = "";

  try {
    if (state.editingUserId) {
      const data = await api(`/api/users/${state.editingUserId}`, {
        method: "PATCH",
        body: JSON.stringify({ name, username, role })
      });
      state.users = state.users.map(u => u.id === data.user.id ? data.user : u);
      showToast("Usuario atualizado.");
    } else {
      const data = await api("/api/users", {
        method: "POST",
        body: JSON.stringify({ name, username, role })
      });
      state.users.push(data.user);
      showToast(`Usuario criado. Senha temporaria: ${username.toLowerCase()}123`);
    }
    closeUserModal();
    renderUsers();
  } catch (err) {
    dom.userModalMessage.textContent = err.message;
  }
}

async function resetPassword(user) {
  if (!confirm(`Resetar senha de ${user.name}?`)) return;
  try {
    const data = await api(`/api/users/${user.id}/reset-password`, { method: "POST", body: "{}" });
    showToast(`Senha resetada. Nova senha temporaria: ${data.temp_password}`);
    await loadUsers();
  } catch (err) { showToast(err.message); }
}

async function toggleUserActive(user) {
  const action = user.active ? "desativar" : "reativar";
  if (!confirm(`Deseja ${action} o usuario ${user.name}?`)) return;
  try {
    const data = await api(`/api/users/${user.id}`, {
      method: "PATCH",
      body: JSON.stringify({ active: !user.active })
    });
    state.users = state.users.map(u => u.id === data.user.id ? data.user : u);
    renderUsers();
    showToast(`Usuario ${data.user.active ? "reativado" : "desativado"}.`);
  } catch (err) { showToast(err.message); }
}

async function deleteUser(user) {
  if (!confirm(`Apagar o usuario ${user.name}? Os pedidos dele serao mantidos no historico.`)) return;
  try {
    await api(`/api/users/${user.id}`, { method: "DELETE" });
    state.users = state.users.filter(u => u.id !== user.id);
    renderUsers();
    showToast("Usuario apagado.");
  } catch (err) { showToast(err.message); }
}

// ---------------------------------------------------------------------------
// renderAll
// ---------------------------------------------------------------------------
function renderAll() {
  applyAuthState();
  renderOptions();
  renderDrafts();
  renderReports();
  renderAdmin();
  renderApproved();
}

// ---------------------------------------------------------------------------
// App load / session
// ---------------------------------------------------------------------------
async function loadApp() {
  const data = await api("/api/bootstrap");
  state.user = data.user;
  state.companies = data.companies;
  state.projects = data.projects;
  state.draftExpenses = data.draftExpenses;
  state.reports = data.reports;
  dom.form.elements.date.valueAsDate = new Date();
  renderAll();
}

async function checkSession() {
  try {
    const data = await api("/api/session");
    if (!data.user) { state.user = null; state.token = ""; localStorage.removeItem("authToken"); applyAuthState(); return; }
    state.user = data.user;
    if (data.user.must_change_password) { applyAuthState(); return; }
    await loadApp();
  } catch (err) { state.user = null; applyAuthState(); }
}

async function login(event) {
  event.preventDefault();
  const payload = Object.fromEntries(new FormData(dom.loginForm).entries());
  dom.loginMessage.textContent = "";
  try {
    const data = await api("/api/login", { method: "POST", body: JSON.stringify(payload) });
    state.user = data.user;
    state.token = data.token || "";
    if (state.token) localStorage.setItem("authToken", state.token);
    if (data.user.must_change_password) { applyAuthState(); return; }
    await loadApp();
    dom.loginForm.reset();
    showToast(`Bem-vindo, ${state.user.name}.`);
  } catch (err) {
    dom.loginMessage.textContent = err.message;
  }
}

async function logout() {
  try { await api("/api/logout", { method: "POST", body: "{}" }); } catch (e) {}
  state.user = null; state.token = ""; localStorage.removeItem("authToken");
  state.draftExpenses = []; state.reports = []; state.imageDataUrl = null;
  dom.receiptInput.value = "";
  applyAuthState();
}

// ---------------------------------------------------------------------------
// Change password
// ---------------------------------------------------------------------------
async function changePassword(event) {
  event.preventDefault();
  dom.changePasswordMessage.textContent = "";
  const current_password = dom.changePasswordForm.elements.current_password.value;
  const new_password = dom.changePasswordForm.elements.new_password.value;
  const confirm_password = dom.changePasswordForm.elements.confirm_password.value;

  if (new_password !== confirm_password) {
    dom.changePasswordMessage.textContent = "As senhas nao coincidem.";
    return;
  }

  try {
    await api("/api/change-password", { method: "POST", body: JSON.stringify({ current_password, new_password }) });
    state.user.must_change_password = false;
    showToast("Senha alterada com sucesso.");
    await loadApp();
    dom.changePasswordForm.reset();
  } catch (err) {
    dom.changePasswordMessage.textContent = err.message;
  }
}

// ---------------------------------------------------------------------------
// Catalog modal
// ---------------------------------------------------------------------------
function openCatalogModal(kind) {
  const label = kind === "company" ? "empresa" : "obra";
  state.catalogKind = kind;
  dom.catalogTitle.textContent = kind === "company" ? "Nova empresa" : "Nova obra";
  dom.catalogLabel.textContent = `Nome da ${label}`;
  dom.catalogNameInput.value = "";
  dom.catalogModal.hidden = false;
  dom.catalogModal.classList.remove("is-hidden");
  setTimeout(() => dom.catalogNameInput.focus(), 50);
}

function closeCatalogModal() {
  state.catalogKind = null;
  dom.catalogModal.classList.add("is-hidden");
  dom.catalogModal.hidden = true;
  dom.catalogForm.reset();
}

async function saveCatalog(event) {
  event.preventDefault();
  const kind = state.catalogKind;
  if (!kind) return;
  const label = kind === "company" ? "empresa" : "obra";
  const value = dom.catalogNameInput.value.trim();
  if (!value) return;
  try {
    const path = kind === "company" ? "/api/companies" : "/api/projects";
    const data = await api(path, { method: "POST", body: JSON.stringify({ name: value }) });
    if (kind === "company") { state.companies = data.companies; renderOptions({ company: data.name, project: dom.projectSelect.value }); }
    else { state.projects = data.projects; renderOptions({ company: dom.companySelect.value, project: data.name }); }
    closeCatalogModal();
    showToast(`${label[0].toUpperCase()}${label.slice(1)} salva.`);
  } catch (err) { showToast(err.message); }
}

// ---------------------------------------------------------------------------
// Decision modal
// ---------------------------------------------------------------------------
function openDecisionModal(id, status) {
  state.decisionReportId = id; state.decisionStatus = status;
  dom.decisionTitle.textContent = "Devolver pedido";
  dom.decisionLabel.textContent = "Explique o que o colaborador deve corrigir";
  dom.decisionReasonInput.value = "";
  dom.decisionModal.hidden = false;
  dom.decisionModal.classList.remove("is-hidden");
  setTimeout(() => dom.decisionReasonInput.focus(), 50);
}

function closeDecisionModal() {
  state.decisionReportId = null; state.decisionStatus = null;
  dom.decisionModal.classList.add("is-hidden");
  dom.decisionModal.hidden = true;
  dom.decisionForm.reset();
}

async function saveDecision(event) {
  event.preventDefault();
  const id = state.decisionReportId; const status = state.decisionStatus;
  const reason = dom.decisionReasonInput.value.trim();
  if (!id || !status || !reason) return;
  try {
    const data = await api(`/api/reports/${id}`, { method: "PATCH", body: JSON.stringify({ status, reason }) });
    state.reports = state.reports.map(r => r.id === id ? data.report : r);
    closeDecisionModal(); renderAll();
    showToast("Pedido devolvido ao colaborador.");
  } catch (err) { showToast(err.message); }
}

// ---------------------------------------------------------------------------
// Expense actions
// ---------------------------------------------------------------------------
async function addExpense(event) {
  event.preventDefault();
  if (!state.imageDataUrl) { showToast("Anexe o comprovante."); return; }
  const formData = new FormData(dom.form);
  const payload = Object.fromEntries(formData.entries());
  payload.imageDataUrl = state.imageDataUrl;
  try {
    const data = await api("/api/expenses", { method: "POST", body: JSON.stringify(payload) });
    state.draftExpenses.push(data.expense);
    state.companies = data.companies; state.projects = data.projects;
    dom.form.elements.supplier.value = "";
    dom.form.elements.amount.value = "";
    dom.form.elements.description.value = "";
    state.imageDataUrl = null;
    dom.receiptInput.value = "";
    dom.receiptPreview.innerHTML = "<span>Arraste ou clique para anexar</span>";
    renderAll();
    showToast("Comprovante adicionado.");
  } catch (err) { showToast(err.message); }
}

async function removeExpense(id) {
  try {
    await api(`/api/expenses/${id}`, { method: "DELETE" });
    state.draftExpenses = state.draftExpenses.filter(e => e.id !== id);
    renderAll();
    showToast("Comprovante removido.");
  } catch (err) { showToast(err.message); }
}

async function submitReport() {
  try {
    const data = await api("/api/reports", { method: "POST", body: "{}" });
    const exists = state.reports.some(r => r.id === data.report.id);
    state.reports = exists
      ? state.reports.map(r => r.id === data.report.id ? data.report : r)
      : [data.report, ...state.reports];
    state.draftExpenses = [];
    renderAll();
    showToast(`${data.report.code} enviado para gestao.`);
  } catch (err) { showToast(err.message); }
}

async function updateReportStatus(id, status) {
  try {
    const data = await api(`/api/reports/${id}`, { method: "PATCH", body: JSON.stringify({ status }) });
    state.reports = state.reports.map(r => r.id === id ? data.report : r);
    renderAll();
    showToast(`Pedido marcado como ${statusLabels[status].toLowerCase()}.`);
  } catch (err) { showToast(err.message); }
}

function handleReportAction(id, status) {
  if (status === "returned") { openDecisionModal(id, status); return; }
  updateReportStatus(id, status);
}

// ---------------------------------------------------------------------------
// Image handling
// ---------------------------------------------------------------------------
function readImage(file) {
  return new Promise((resolve, reject) => {
    if (!file) return resolve(null);
    const allowed = String(file.type || "").startsWith("image/") || file.type === "application/pdf";
    if (!allowed) { reject(new Error("Selecione uma imagem ou PDF.")); return; }
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Nao foi possivel ler o arquivo."));
    reader.readAsDataURL(file);
  });
}

async function handleImageSelection(file) {
  if (!file) return;
  if (file.type === "application/pdf") {
    dom.receiptPreview.innerHTML = `<div class="file-preview"><strong>PDF</strong><span>${escapeHtml(file.name)}</span></div>`;
  } else {
    const previewUrl = URL.createObjectURL(file);
    dom.receiptPreview.innerHTML = `<img src="${previewUrl}" alt="Previa do comprovante">`;
    const image = dom.receiptPreview.querySelector("img");
    image.onload = () => URL.revokeObjectURL(previewUrl);
    image.onerror = () => { URL.revokeObjectURL(previewUrl); dom.receiptPreview.innerHTML = "<span>Arquivo selecionado</span>"; };
  }
  state.imageDataUrl = await readImage(file);
  showToast("Comprovante anexado.");
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------
function bindEvents() {
  document.querySelectorAll(".tab").forEach(btn => btn.addEventListener("click", () => activateView(btn.dataset.view)));
  document.querySelectorAll(".add-catalog").forEach(btn => btn.addEventListener("click", e => { e.preventDefault(); e.stopPropagation(); openCatalogModal(btn.dataset.kind); }));

  dom.loginForm.addEventListener("submit", login);
  dom.logoutButton.addEventListener("click", logout);
  dom.changePasswordForm.addEventListener("submit", changePassword);

  dom.catalogForm.addEventListener("submit", saveCatalog);
  dom.catalogCloseButton.addEventListener("click", closeCatalogModal);
  dom.catalogCancelButton.addEventListener("click", closeCatalogModal);
  dom.catalogModal.addEventListener("click", e => { if (e.target === dom.catalogModal) closeCatalogModal(); });

  dom.form.addEventListener("submit", addExpense);
  dom.submitReportButton.addEventListener("click", submitReport);

  dom.decisionForm.addEventListener("submit", saveDecision);
  dom.decisionCloseButton.addEventListener("click", closeDecisionModal);
  dom.decisionCancelButton.addEventListener("click", closeDecisionModal);
  dom.decisionModal.addEventListener("click", e => { if (e.target === dom.decisionModal) closeDecisionModal(); });

  dom.receiptInput.addEventListener("change", async e => {
    try { await handleImageSelection(e.target.files[0]); } catch (err) { showToast(err.message); }
  });

  dom.newUserButton.addEventListener("click", () => openUserModal());
  dom.userForm.addEventListener("submit", saveUser);
  dom.userModalClose.addEventListener("click", closeUserModal);
  dom.userModalCancel.addEventListener("click", closeUserModal);
  dom.userModal.addEventListener("click", e => { if (e.target === dom.userModal) closeUserModal(); });

  setupDropZone();
}

bindEvents();
checkSession();
