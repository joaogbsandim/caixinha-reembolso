const state = {
  user: null,
  token: localStorage.getItem("authToken") || "",
  companies: [],
  projects: [],
  draftExpenses: [],
  reports: [],
  imageDataUrl: null,
  catalogKind: null,
  decisionReportId: null,
  decisionStatus: null
};

const money = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL"
});

const statusLabels = {
  pending: "Pendente",
  approved: "Aprovado",
  returned: "Devolvido"
};

const roleLabels = {
  admin: "Administrador",
  employee: "Colaborador"
};

const dom = {
  authScreen: document.querySelector("#authScreen"),
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
  decisionCancelButton: document.querySelector("#decisionCancelButton")
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
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
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

function isPdf(url = "") {
  return String(url).toLowerCase().split("?")[0].endsWith(".pdf");
}

function receiptPreviewHtml(url, label = "Comprovante") {
  const safeUrl = escapeHtml(url || receiptPlaceholder());
  if (isPdf(url)) {
    return `<a class="pdf-thumb" href="${safeUrl}" target="_blank" rel="noopener">PDF</a>`;
  }
  return `<a href="${safeUrl}" target="_blank" rel="noopener"><img src="${safeUrl}" alt="${escapeHtml(label)}" onerror="this.src='${receiptPlaceholder()}'"></a>`;
}

function optionHtml(value) {
  return `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`;
}

function renderOptions(selected = {}) {
  dom.companySelect.innerHTML = state.companies.map(optionHtml).join("");
  dom.projectSelect.innerHTML = state.projects.map(optionHtml).join("");

  if (selected.company) dom.companySelect.value = selected.company;
  if (selected.project) dom.projectSelect.value = selected.project;
}

function applyAuthState() {
  const logged = Boolean(state.user);
  dom.authScreen.hidden = logged;
  dom.appShell.hidden = !logged;
  dom.authScreen.classList.toggle("is-hidden", logged);
  dom.appShell.classList.toggle("is-hidden", !logged);

  if (!logged) return;

  dom.userName.textContent = state.user.name;
  dom.userRole.textContent = roleLabels[state.user.role] || state.user.role;
  document.querySelectorAll(".admin-only").forEach(item => item.classList.toggle("is-hidden", state.user.role !== "admin"));
  document.querySelectorAll(".employee-only").forEach(item => item.classList.toggle("is-hidden", state.user.role === "admin"));

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
}

function renderDrafts() {
  const total = state.draftExpenses.reduce((sum, expense) => sum + expense.amount, 0);

  dom.draftCount.textContent = `${state.draftExpenses.length} ${state.draftExpenses.length === 1 ? "item" : "itens"}`;
  dom.draftTotal.textContent = money.format(total);
  dom.submitReportButton.disabled = state.draftExpenses.length === 0;
  dom.draftList.innerHTML = "";

  if (!state.draftExpenses.length) {
    dom.draftList.append(empty("Nenhum comprovante em aberto."));
    return;
  }

  const template = document.querySelector("#expenseTemplate");
  state.draftExpenses.forEach(expense => {
    const node = template.content.cloneNode(true);
    const image = node.querySelector("img");
    image.src = expense.imageUrl || receiptPlaceholder();
    image.alt = `Comprovante de ${expense.supplier}`;
    node.querySelector("strong").textContent = expense.supplier;
    node.querySelector(".item-head span").textContent = money.format(expense.amount);
    node.querySelector("p").textContent = `${expense.company} - ${expense.project}`;
    node.querySelector("small").textContent = `${formatDate(expense.date)} - ${expense.description || "Sem descricao"}`;
    node.querySelector("button").addEventListener("click", () => removeExpense(expense.id));
    dom.draftList.append(node);
  });
}

function renderReports() {
  const openReports = state.reports.filter(report => report.status !== "approved");
  dom.reportCount.textContent = `${openReports.length} ${openReports.length === 1 ? "em aberto" : "em aberto"}`;
  dom.reportList.innerHTML = "";

  if (!openReports.length) {
    dom.reportList.append(empty("Nenhum pedido em aberto."));
    return;
  }

  openReports.forEach(report => dom.reportList.append(reportNode(report, false, report.status === "returned")));
}

function renderAdmin() {
  dom.adminList.innerHTML = "";

  if (state.user?.role !== "admin") {
    dom.adminList.append(empty("Acesso restrito ao administrador."));
    return;
  }

  const adminReports = state.reports.filter(report => report.status === "pending");

  if (!adminReports.length) {
    dom.adminList.append(empty("Nenhum pedido pendente no momento."));
    return;
  }

  adminReports.forEach(report => dom.adminList.append(reportNode(report, true)));
}

function renderApproved() {
  dom.approvedList.innerHTML = "";
  const approvedReports = state.reports.filter(report => report.status === "approved");
  dom.approvedCount.textContent = `${approvedReports.length} ${approvedReports.length === 1 ? "aprovado" : "aprovados"}`;

  if (!approvedReports.length) {
    dom.approvedList.append(empty("Nenhum pedido aprovado ainda."));
    return;
  }

  approvedReports.forEach(report => dom.approvedList.append(reportNode(report, false, true)));
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
  node.querySelector("small").textContent = `Enviado em ${new Date(report.createdAt).toLocaleString("pt-BR")}`;
  if (report.decisionReason) {
    const reason = document.createElement("div");
    reason.className = "decision-reason";
    reason.textContent = `Motivo: ${report.decisionReason}`;
    node.querySelector(".item-body").insertBefore(reason, node.querySelector("details"));
  }
  if (report.status === "approved") {
    const approved = document.createElement("div");
    approved.className = "decision-reason approved-note";
    approved.textContent = `Aprovado em ${new Date(report.updatedAt).toLocaleString("pt-BR")}`;
    node.querySelector(".item-body").insertBefore(approved, node.querySelector("details"));
  }

  report.expenses.forEach((expense, index) => {
    const item = document.createElement("div");
    item.className = withActions ? "mini-expense checklist-expense" : "mini-expense";
    item.innerHTML = withActions
      ? `
        <input class="expense-check" type="checkbox" aria-label="Conferir despesa ${index + 1}">
        <span class="expense-number">${String(index + 1).padStart(2, "0")}</span>
        ${receiptPreviewHtml(expense.imageUrl, `Comprovante ${index + 1}`)}
        <div>
          <strong>${escapeHtml(expense.supplier)} - ${money.format(expense.amount)}</strong>
          <p>${escapeHtml(expense.company)} - ${escapeHtml(expense.project)} - ${formatDate(expense.date)}</p>
          <small>${escapeHtml(expense.description || "Sem descricao")}</small>
        </div>
      `
      : `
        ${receiptPreviewHtml(expense.imageUrl)}
        <div>
          <strong>${escapeHtml(expense.supplier)} - ${money.format(expense.amount)}</strong>
          <p>${escapeHtml(expense.company)} - ${escapeHtml(expense.project)} - ${formatDate(expense.date)}</p>
        </div>
      `;
    expenseList.append(item);
  });

  if (withActions) {
    const actions = node.querySelector(".status-actions");
    actions.append(actionButton("Aprovar", "approved", report.status === "approved"));
    actions.append(actionButton("Devolver", "returned", report.status === "returned", false, "warning"));

    actions.querySelectorAll("button").forEach(button => {
      button.addEventListener("click", () => handleReportAction(report.id, button.dataset.status));
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

function renderAll() {
  applyAuthState();
  renderOptions();
  renderDrafts();
  renderReports();
  renderAdmin();
  renderApproved();
}

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
    if (!data.user) {
      state.user = null;
      state.token = "";
      localStorage.removeItem("authToken");
      applyAuthState();
      return;
    }
    await loadApp();
  } catch (error) {
    state.user = null;
    applyAuthState();
  }
}

async function login(event) {
  event.preventDefault();
  const payload = Object.fromEntries(new FormData(dom.loginForm).entries());
  dom.loginMessage.textContent = "";

  try {
    const data = await api("/api/login", {
      method: "POST",
      body: JSON.stringify(payload)
    });
    state.user = data.user;
    state.token = data.token || "";
    if (state.token) localStorage.setItem("authToken", state.token);
    await loadApp();
    dom.loginForm.reset();
    showToast(`Bem-vindo, ${state.user.name}.`);
  } catch (error) {
    dom.loginMessage.textContent = error.message;
    showToast(error.message);
  }
}

async function logout() {
  try {
    await api("/api/logout", { method: "POST", body: "{}" });
  } catch (error) {
    showToast(error.message);
  }

  state.user = null;
  state.token = "";
  localStorage.removeItem("authToken");
  state.draftExpenses = [];
  state.reports = [];
  state.imageDataUrl = null;
  clearPhotoInputs();
  activateView(state.user?.role === "admin" ? "adminView" : "employeeView");
  applyAuthState();
}

function openCatalogModal(kind) {
  if (!state.user) {
    showToast("Faca login para cadastrar.");
    return;
  }
  const label = kind === "company" ? "empresa" : "obra";
  state.catalogKind = kind;
  dom.catalogTitle.textContent = kind === "company" ? "Nova empresa" : "Nova obra";
  dom.catalogLabel.textContent = `Nome da ${label}`;
  dom.catalogNameInput.value = "";
  dom.catalogModal.hidden = false;
  dom.catalogModal.classList.remove("is-hidden");
  window.setTimeout(() => dom.catalogNameInput.focus(), 50);
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
    const data = await api(path, {
      method: "POST",
      body: JSON.stringify({ name: value.trim() })
    });

    if (kind === "company") {
      state.companies = data.companies;
      renderOptions({ company: data.name, project: dom.projectSelect.value });
    } else {
      state.projects = data.projects;
      renderOptions({ company: dom.companySelect.value, project: data.name });
    }

    closeCatalogModal();
    showToast(`${label[0].toUpperCase()}${label.slice(1)} salva no servidor.`);
  } catch (error) {
    showToast(error.message);
  }
}

async function addExpense(event) {
  event.preventDefault();
  if (!dom.form.reportValidity()) return;
  if (!state.imageDataUrl) {
    showToast("Anexe o comprovante.");
    return;
  }

  const formData = new FormData(dom.form);
  const payload = Object.fromEntries(formData.entries());
  payload.imageDataUrl = state.imageDataUrl;

  try {
    const data = await api("/api/expenses", {
      method: "POST",
      body: JSON.stringify(payload)
    });
    state.draftExpenses.push(data.expense);
    state.companies = data.companies;
    state.projects = data.projects;
    dom.form.elements.supplier.value = "";
    dom.form.elements.amount.value = "";
    dom.form.elements.description.value = "";
    state.imageDataUrl = null;
    clearPhotoInputs();
    dom.receiptPreview.innerHTML = "<span>Sem foto</span>";
    renderAll();
    showToast("Comprovante adicionado ao relatorio em aberto.");
  } catch (error) {
    showToast(error.message);
  }
}

async function removeExpense(id) {
  try {
    await api(`/api/expenses/${id}`, { method: "DELETE" });
    state.draftExpenses = state.draftExpenses.filter(expense => expense.id !== id);
    renderAll();
    showToast("Comprovante removido.");
  } catch (error) {
    showToast(error.message);
  }
}

async function submitReport() {
  try {
    const data = await api("/api/reports", {
      method: "POST",
      body: "{}"
    });
    const existingReport = state.reports.some(report => report.id === data.report.id);
    state.reports = existingReport
      ? state.reports.map(report => (report.id === data.report.id ? data.report : report))
      : [data.report, ...state.reports];
    state.draftExpenses = [];
    renderAll();
    showToast(`${data.report.code} enviado para gestao.`);
  } catch (error) {
    showToast(error.message);
  }
}

async function updateReportStatus(id, status) {
  try {
    const data = await api(`/api/reports/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ status })
    });
    state.reports = state.reports.map(report => (report.id === id ? data.report : report));
    renderAll();
    showToast(`Pedido marcado como ${statusLabels[status].toLowerCase()}.`);
  } catch (error) {
    showToast(error.message);
  }
}

function handleReportAction(id, status) {
  if (status === "returned") {
    openDecisionModal(id, status);
    return;
  }

  updateReportStatus(id, status);
}

function openDecisionModal(id, status) {
  state.decisionReportId = id;
  state.decisionStatus = status;
  const isReturn = status === "returned";
  dom.decisionTitle.textContent = "Devolver pedido";
  dom.decisionLabel.textContent = "Explique o que o colaborador deve corrigir";
  dom.decisionReasonInput.value = "";
  dom.decisionModal.hidden = false;
  dom.decisionModal.classList.remove("is-hidden");
  window.setTimeout(() => dom.decisionReasonInput.focus(), 50);
}

function closeDecisionModal() {
  state.decisionReportId = null;
  state.decisionStatus = null;
  dom.decisionModal.classList.add("is-hidden");
  dom.decisionModal.hidden = true;
  dom.decisionForm.reset();
}

async function saveDecision(event) {
  event.preventDefault();
  const id = state.decisionReportId;
  const status = state.decisionStatus;
  const reason = dom.decisionReasonInput.value.trim();
  if (!id || !status || !reason) return;

  try {
    const data = await api(`/api/reports/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ status, reason })
    });
    state.reports = state.reports.map(report => (report.id === id ? data.report : report));
    closeDecisionModal();
    renderAll();
    showToast("Pedido devolvido ao colaborador.");
  } catch (error) {
    showToast(error.message);
  }
}

function readImage(file) {
  return new Promise((resolve, reject) => {
    if (!file) return resolve(null);
    const allowed = String(file.type || "").startsWith("image/") || file.type === "application/pdf";
    if (!allowed) {
      reject(new Error("Selecione uma imagem ou PDF do comprovante."));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Nao foi possivel ler a imagem."));
    reader.readAsDataURL(file);
  });
}

function clearPhotoInputs() {
  dom.receiptInput.value = "";
}

async function handleImageSelection(file) {
  if (!file) return;
  if (file.type === "application/pdf") {
    dom.receiptPreview.innerHTML = `
      <div class="file-preview">
        <strong>PDF</strong>
        <span>${escapeHtml(file.name)}</span>
      </div>
    `;
  } else {
    const previewUrl = URL.createObjectURL(file);
    dom.receiptPreview.innerHTML = `<img src="${previewUrl}" alt="Previa do comprovante">`;
    const image = dom.receiptPreview.querySelector("img");
    image.onload = () => URL.revokeObjectURL(previewUrl);
    image.onerror = () => {
      URL.revokeObjectURL(previewUrl);
      dom.receiptPreview.innerHTML = "<span>Arquivo selecionado</span>";
    };
  }

  state.imageDataUrl = await readImage(file);
  showToast("Comprovante anexado.");
}

function bindEvents() {
  document.querySelectorAll(".tab").forEach(button => {
    button.addEventListener("click", () => activateView(button.dataset.view));
  });

  document.querySelectorAll(".add-catalog").forEach(button => {
    button.addEventListener("click", event => {
      event.preventDefault();
      event.stopPropagation();
      openCatalogModal(button.dataset.kind);
    });
  });

  dom.loginForm.addEventListener("submit", login);
  dom.logoutButton.addEventListener("click", logout);
  dom.catalogForm.addEventListener("submit", saveCatalog);
  dom.catalogCloseButton.addEventListener("click", closeCatalogModal);
  dom.catalogCancelButton.addEventListener("click", closeCatalogModal);
  dom.catalogModal.addEventListener("click", event => {
    if (event.target === dom.catalogModal) closeCatalogModal();
  });
  dom.form.addEventListener("submit", addExpense);
  dom.submitReportButton.addEventListener("click", submitReport);
  dom.decisionForm.addEventListener("submit", saveDecision);
  dom.decisionCloseButton.addEventListener("click", closeDecisionModal);
  dom.decisionCancelButton.addEventListener("click", closeDecisionModal);
  dom.decisionModal.addEventListener("click", event => {
    if (event.target === dom.decisionModal) closeDecisionModal();
  });

  dom.receiptInput.addEventListener("change", async event => {
    try {
      await handleImageSelection(event.target.files[0]);
    } catch (error) {
      showToast(error.message);
    }
  });
}

bindEvents();
checkSession();
