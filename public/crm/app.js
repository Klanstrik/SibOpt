
const state = {
  leads: [],
  closedLeads: [],
  ticketLeads: [],
  products: [],
  settings: {},
  dashboard: null,
  accountingRows: [],
  accountingSummary: {},
  dashboardPollingId: null,
  activeTab: 'dashboard',
  user: null
};

const statusLabels = {
  new: 'Новая',
  in_progress: 'В работе',
  confirmed: 'Подтверждена',
  visited: 'Пришёл',
  completed: 'Выполнена',
  bought: 'Купил',
  no_show: 'Не пришёл',
  no_answer: 'Не дозвонились',
  refused: 'Отказ клиента',
  cancelled: 'Отменена'
};

const typeLabels = {
  appointment: 'Запись',
  reservation: 'Бронь',
  availability: 'Уточнение',
  'optical-route': 'Подбор визита'
};

const closedStatuses = new Set(['completed', 'bought', 'no_show', 'no_answer', 'refused', 'cancelled']);

const pageMeta = {
  dashboard: {
    title: 'Главная',
    subtitle: 'Вы в админке. Здесь можно работать с заявками, бронью и каталогом сайта.'
  },
  leads: {
    title: 'Заявки',
    subtitle: 'Активные заявки, которые ещё нужно обработать.'
  },
  closed: {
    title: 'Закрытые заявки',
    subtitle: 'Выполненные, не пришедшие, отказы и отменённые заявки хранятся здесь.'
  },
  tickets: {
    title: 'Номера заявок',
    subtitle: 'Поиск заявки по номеру, который клиент получил после отправки формы.'
  },
  products: {
    title: 'Каталог',
    subtitle: 'Товары и услуги, которые показываются на сайте.'
  },
  reports: {
    title: 'Бухгалтерия',
    subtitle: 'Понятная таблица заявок и выгрузка в Excel или CSV без pgAdmin.'
  },
  settings: {
    title: 'Настройки',
    subtitle: 'Телефон, адрес, график и правила предварительной брони.'
  }
};

const qs = (selector) => document.querySelector(selector);
const qsa = (selector) => Array.from(document.querySelectorAll(selector));

function setHtml(selectorOrElement, html) {
  const element = typeof selectorOrElement === 'string' ? qs(selectorOrElement) : selectorOrElement;
  if (!element) return false;
  element.innerHTML = html;
  return true;
}

function setText(selectorOrElement, text) {
  const element = typeof selectorOrElement === 'string' ? qs(selectorOrElement) : selectorOrElement;
  if (!element) return false;
  element.textContent = text;
  return true;
}


function can(permission) {
  return Boolean(state.user?.permissions?.includes(permission));
}

function applyRoleUi() {
  const allowedTabs = new Set(['dashboard']);
  if (can('leads:read')) {
    allowedTabs.add('leads');
    allowedTabs.add('tickets');
    allowedTabs.add('closed');
  }
  if (can('products')) allowedTabs.add('products');
  if (can('reports')) allowedTabs.add('reports');
  if (can('settings')) allowedTabs.add('settings');

  qsa('.nav-btn').forEach((button) => {
    const visible = allowedTabs.has(button.dataset.tab);
    button.hidden = !visible;
    button.classList.toggle('hidden', !visible);
  });

  const deleteAllowed = can('leads:delete');
  qsa('[data-action="delete-lead"]').forEach((button) => {
    button.hidden = !deleteAllowed;
    button.classList.toggle('hidden', !deleteAllowed);
  });

  const roleTitle = state.user?.title || 'Сотрудник';
  const roleBadge = qs('#roleBadge');
  if (roleBadge) roleBadge.textContent = roleTitle;

  if (!allowedTabs.has(state.activeTab)) setTab([...allowedTabs][0]);
}

function formatDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('ru-RU');
}

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  })[char]);
}

function formatLeadMessage(value) {
  const text = String(value || '').trim();
  if (!text) return '<span class="empty-message">Комментария нет.</span>';

  return text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      if (line.endsWith(':')) return `<strong>${escapeHtml(line)}</strong>`;
      if (line.startsWith('•')) return `<span class="message-bullet">${escapeHtml(line)}</span>`;
      if (line.startsWith('Важно:')) return `<span class="message-warning">${escapeHtml(line)}</span>`;
      return `<span>${escapeHtml(line)}</span>`;
    })
    .join('');
}

function getLeadDisplayNumber(lead) {
  if (!lead) return '';
  if (lead.leadNumber) return String(lead.leadNumber);
  const text = [lead.productTitle, lead.message, lead.id].filter(Boolean).join(' ');
  const match = text.match(/(?:№|N|Nº|номер|план визита\s*№?)\s*([0-9]{3,8})/i);
  if (match) return match[1];
  if (lead.id) return String(lead.id).slice(-6);
  return '';
}

function showToast(title, message = '', type = 'success') {
  const stack = qs('#toastStack');
  if (!stack) return;
  const item = document.createElement('div');
  item.className = `toast ${type === 'error' ? 'toast-error' : ''}`.trim();
  item.innerHTML = `<strong>${escapeHtml(title)}</strong>${message ? `<span>${escapeHtml(message)}</span>` : ''}`;
  stack.appendChild(item);
  setTimeout(() => item.remove(), 3500);
}

function updateUnprocessedBadge() {
  const badge = qs('#unprocessedLeadsBadge');
  if (!badge) return;
  const stats = state.dashboard?.stats || {};
  const count = Number(stats.unprocessedLeads ?? stats.newLeads ?? 0);
  badge.textContent = count > 99 ? '99+' : String(count);
  badge.classList.toggle('hidden', count <= 0);
}

function startDashboardPolling() {
  if (state.dashboardPollingId) return;
  state.dashboardPollingId = window.setInterval(() => {
    const app = qs('#appShell');
    if (document.hidden || !app || app.classList.contains('hidden')) return;
    loadDashboard().catch(() => {});
  }, 15000);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    },
    credentials: 'same-origin',
    ...options
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Ошибка запроса');
  return data;
}

async function checkAuth() {
  const data = await api('/api/auth/me');
  state.user = data.user || null;
  return data.authenticated;
}

function showLogin() {
  const login = qs('#loginScreen');
  const app = qs('#appShell');
  if (login) { login.hidden = false; login.classList.remove('hidden'); }
  if (app) { app.hidden = true; app.classList.add('hidden'); }
}

function showApp() {
  const login = qs('#loginScreen');
  const app = qs('#appShell');
  if (login) { login.hidden = true; login.classList.add('hidden'); }
  if (app) { app.hidden = false; app.classList.remove('hidden'); }
}

async function login(event) {
  event.preventDefault();
  const status = qs('#loginStatus');
  if (status) status.textContent = 'Проверяем пароль...';
  try {
    await api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ role: qs('#loginRole')?.value || 'admin', password: qs('#password').value })
    });
    state.user = (await api('/api/auth/me')).user || null;
    showApp();
    applyRoleUi();
    showToast('Вход выполнен', `Роль: ${state.user?.title || 'сотрудник'}.`);
    await loadAll();
    startDashboardPolling();
  } catch (error) {
    if (status) status.textContent = error.message || 'Неверный пароль. Попробуйте ещё раз.';
    showToast('Не удалось войти', error.message || 'Проверьте пароль администратора.', 'error');
  }
}

async function logout() {
  await api('/api/auth/logout', { method: 'POST', body: JSON.stringify({}) }).catch(() => {});
  showLogin();
  if (state.dashboardPollingId) {
    window.clearInterval(state.dashboardPollingId);
    state.dashboardPollingId = null;
  }
  showToast('Вы вышли из CRM');
}

function setTab(tab) {
  state.activeTab = tab;
  qsa('.nav-btn').forEach((button) => button.classList.toggle('active', button.dataset.tab === tab));
  qsa('.tab').forEach((section) => section.classList.remove('visible'));
  const targetTab = qs(`#tab-${tab}`);
  if (targetTab) targetTab.classList.add('visible');
  const meta = pageMeta[tab] || pageMeta.dashboard;
  setText('#pageTitle', meta.title);
  setText('#pageSubtitle', meta.subtitle);
  if (tab === 'reports') loadAccountingReport().catch((error) => showToast('Ошибка', error.message, 'error'));
  if (tab === 'tickets') loadTickets().catch((error) => showToast('Ошибка', error.message, 'error'));
  if (tab === 'closed') loadClosedLeads().catch((error) => showToast('Ошибка', error.message, 'error'));
}


async function loadAll() {
  const tasks = [loadDashboard()];
  if (can('leads:read')) tasks.push(loadLeads(), loadClosedLeads(), loadTickets());
  if (can('products')) tasks.push(loadProducts());
  if (can('settings')) tasks.push(loadSettings());
  if (can('reports')) tasks.push(loadAccountingReport());
  await Promise.all(tasks);
  applyRoleUi();
}

async function loadDashboard() {
  state.dashboard = await api('/api/admin/dashboard');
  renderDashboard();
  updateUnprocessedBadge();
}

async function loadLeads() {
  const params = new URLSearchParams();
  const q = qs('#leadSearch')?.value.trim();
  const status = qs('#statusFilter')?.value;
  const type = qs('#typeFilter')?.value;
  if (q) params.set('q', q);
  if (status) params.set('status', status);
  if (type) params.set('type', type);
  params.set('scope', 'active');
  const data = await api(`/api/admin/leads?${params.toString()}`);
  state.leads = data.leads || [];
  renderLeads();
}

async function loadClosedLeads() {
  const params = new URLSearchParams();
  const q = qs('#closedSearch')?.value.trim();
  const status = qs('#closedStatusFilter')?.value;
  const type = qs('#closedTypeFilter')?.value;
  if (q) params.set('q', q);
  if (status) params.set('status', status);
  if (type) params.set('type', type);
  params.set('scope', 'archive');
  const data = await api(`/api/admin/leads?${params.toString()}`);
  state.closedLeads = data.leads || [];
  renderClosedLeads();
}


async function loadTickets() {
  const params = new URLSearchParams();
  const q = qs('#ticketSearch')?.value.trim();
  const status = qs('#ticketStatusFilter')?.value;
  const type = qs('#ticketTypeFilter')?.value;
  if (q) params.set('q', q.replace(/^№\s*/i, '').trim());
  if (status) params.set('status', status);
  if (type) params.set('type', type);
  params.set('scope', 'all');
  const data = await api(`/api/admin/leads?${params.toString()}`);
  state.ticketLeads = data.leads || [];
  renderTickets();
}

function getAccountingParams() {
  const params = new URLSearchParams();
  const q = qs('#accountingSearch')?.value.trim();
  const status = qs('#accountingStatusFilter')?.value;
  const type = qs('#accountingTypeFilter')?.value;
  const dateFrom = qs('#accountingDateFrom')?.value;
  const dateTo = qs('#accountingDateTo')?.value;
  if (q) params.set('q', q);
  if (status) params.set('status', status);
  if (type) params.set('type', type);
  if (dateFrom) params.set('dateFrom', dateFrom);
  if (dateTo) params.set('dateTo', dateTo);
  return params;
}

async function loadAccountingReport() {
  const data = await api(`/api/admin/reports/accounting?${getAccountingParams().toString()}`);
  state.accountingRows = data.rows || [];
  state.accountingSummary = data.summary || {};
  renderAccountingReport();
}

function renderAccountingReport() {
  const summary = state.accountingSummary || {};
  const rows = state.accountingRows || [];
  const total = Number(summary.total || 0);
  const statusCounts = summary.statusCounts || {};
  const boughtCount = Number(statusCounts['Купил'] || 0);
  const newCount = Number(statusCounts['Новая'] || 0);
  setHtml('#accountingSummary', `
    <div><strong>${escapeHtml(total)}</strong><span>Заявок в отчёте</span></div>
    <div><strong>${escapeHtml(newCount)}</strong><span>Новых заявок</span></div>
    <div><strong>${escapeHtml(boughtCount)}</strong><span>Статус “Купил”</span></div>
  `);
  setHtml('#accountingReportBody', rows.map((row) => `
    <tr>
      <td>${escapeHtml(row.date)}</td>
      <td>${escapeHtml(row.status)}</td>
      <td>${escapeHtml(row.type)}</td>
      <td>${escapeHtml(row.name)}</td>
      <td>${escapeHtml(row.phone)}</td>
      <td>${escapeHtml(row.item)}</td>
      <td>${escapeHtml(row.recipe)}</td>
      <td>${escapeHtml(row.message)}</td>
      <td>${escapeHtml(row.adminNote)}</td>
      <td>${escapeHtml(row.source)}</td>
    </tr>
  `).join('') || '<tr><td colspan="10">По выбранным фильтрам заявок нет.</td></tr>');
}

function downloadAccountingReport(format) {
  const params = getAccountingParams();
  const extension = format === 'excel' ? 'xls' : 'csv';
  window.location.href = `/api/admin/reports/accounting.${extension}?${params.toString()}`;
}

async function loadProducts() {
  const data = await api('/api/admin/products');
  state.products = data.products || [];
  renderProducts();
}

async function loadSettings() {
  const data = await api('/api/admin/settings');
  state.settings = data.settings || {};
  renderSettings();
}

function renderDashboard() {
  const dashboard = state.dashboard || {};
  const stats = dashboard.stats || {};
  const cards = [
    ['Всего заявок', stats.leadsTotal || 0],
    ['Активные', stats.activeLeads || 0],
    ['Закрытые', stats.closedLeads || stats.archivedLeads || 0],
    ['Сегодня', stats.leadsToday || 0],
    ['Новые', stats.newLeads || 0],
    ['Товары на сайте', stats.activeProducts || 0]
  ];
  setHtml('#statsGrid', cards.map(([label, value]) => `
    <article class="stat-card">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
    </article>
  `).join(''));

  const recent = dashboard.recent || [];
  setHtml('#recentLeadsBody', recent.map((lead) => `
    <tr>
      <td>${escapeHtml(getLeadDisplayNumber(lead) ? `№${getLeadDisplayNumber(lead)}` : '')}</td>
      <td>${escapeHtml(formatDate(lead.createdAt))}</td>
      <td>${escapeHtml(lead.name)}</td>
      <td>${escapeHtml(lead.phone)}</td>
      <td>${escapeHtml(typeLabels[lead.type] || lead.type)}</td>
      <td><span class="status-pill status-${escapeHtml(lead.status || 'new')}">${escapeHtml(statusLabels[lead.status] || lead.status)}</span></td>
    </tr>
  `).join('') || '<tr><td colspan="5">Заявок пока нет.</td></tr>');
}

function renderLeadCards(list, leads, emptyTitle, emptySubtitle) {
  if (!list) return;
  if (!leads.length) {
    setHtml(list, `
      <div class="panel">
        <h2>${escapeHtml(emptyTitle)}</h2>
        <p class="panel-subtitle">${escapeHtml(emptySubtitle)}</p>
      </div>
    `);
    return;
  }

  setHtml(list, leads.map((lead) => `
    <article class="lead-card" data-id="${escapeHtml(lead.id)}">
      <div class="lead-top">
        <div>
          <h3><span class="lead-number-badge">№${escapeHtml(getLeadDisplayNumber(lead))}</span>${escapeHtml(lead.name || 'Без имени')}</h3>
          <div class="meta">
            <span>Номер заявки: №${escapeHtml(getLeadDisplayNumber(lead))}</span>
            <span>${escapeHtml(formatDate(lead.createdAt))}</span>
            <span>${escapeHtml(lead.phone)}</span>
            <span>${escapeHtml(typeLabels[lead.type] || lead.type)}</span>
            <span>${escapeHtml(lead.service || 'Услуга не указана')}</span>
            ${lead.productTitle ? `<span>${escapeHtml(lead.productTitle)}</span>` : ''}
          </div>
        </div>
        <span class="status-pill status-${escapeHtml(lead.status || 'new')}">${escapeHtml(statusLabels[lead.status] || lead.status)}</span>
      </div>

      <div class="lead-grid">
        <div class="lead-main">
          <div class="lead-message">${formatLeadMessage(lead.message)}</div>
          <div class="meta">
            ${lead.recipe ? `<span>Рецепт: ${escapeHtml(lead.recipe)}</span>` : ''}
            ${lead.page ? `<span>Страница: ${escapeHtml(lead.page)}</span>` : ''}
            
          </div>
          <label class="lead-note">
            <span>Заметка сотрудника</span>
            <textarea rows="3" data-role="admin-note" placeholder="Например: позвонить после 17:00">${escapeHtml(lead.adminNote || '')}</textarea>
          </label>
        </div>

        <div class="lead-side">
          <label>
            <span>Статус заявки</span>
            <select data-role="lead-status">
              ${Object.entries(statusLabels).map(([value, label]) => `<option value="${value}" ${lead.status === value ? 'selected' : ''}>${label}</option>`).join('')}
            </select>
          </label>
          <div class="lead-actions">
            <button class="primary-btn" type="button" data-action="save-lead">Сохранить</button>
            ${can('leads:delete') ? '<button class="secondary-btn" type="button" data-action="delete-lead">Удалить</button>' : ''}
          </div>
        </div>
      </div>
    </article>
  `).join(''));
}

function renderLeads() {
  renderLeadCards(
    qs('#leadsList'),
    state.leads,
    'Активных заявок нет',
    'Новые и текущие заявки будут появляться здесь. Закрытые заявки автоматически уходят в отдельный раздел.'
  );
}

function renderClosedLeads() {
  renderLeadCards(
    qs('#closedLeadsList'),
    state.closedLeads,
    'Закрытых заявок пока нет',
    'Когда заявка получит статус “Выполнена”, “Не пришёл”, “Отказ клиента” или “Отменена”, она будет храниться здесь.'
  );
}

function getLeadScopeLabel(lead) {
  const status = lead?.status || 'new';
  return closedStatuses.has(status) ? 'Закрытая заявка' : 'Активная заявка';
}

function renderTickets() {
  const query = qs('#ticketSearch')?.value.trim();
  const count = state.ticketLeads.length;
  const totalText = query
    ? `Найдено: ${count}`
    : `Всего заявок с номерами: ${count}`;

  setHtml('#ticketSummary', `
    <div><strong>${escapeHtml(totalText)}</strong><span>Ищите по номеру, телефону, имени или комментарию.</span></div>
    <div><strong>Номер клиента</strong><span>Это тот же номер, который клиент видит после отправки формы.</span></div>
  `);

  const list = qs('#ticketsList');
  if (!list) return;

  if (!state.ticketLeads.length) {
    setHtml(list, `
      <div class="panel ticket-empty">
        <h2>${query ? 'Заявка не найдена' : 'Номера заявок пока не найдены'}</h2>
        <p class="panel-subtitle">${query ? 'Проверьте номер: можно вводить только цифры без символа №. Также попробуйте поиск по телефону клиента.' : 'Новые заявки появятся здесь после отправки формы на сайте.'}</p>
      </div>
    `);
    return;
  }

  setHtml(list, state.ticketLeads.map((lead) => `
    <article class="lead-card ticket-card" data-id="${escapeHtml(lead.id)}">
      <div class="lead-top">
        <div>
          <h3><span class="lead-number-badge ticket-number-badge">№${escapeHtml(getLeadDisplayNumber(lead))}</span>${escapeHtml(lead.name || 'Без имени')}</h3>
          <div class="meta">
            <span>${escapeHtml(getLeadScopeLabel(lead))}</span>
            <span>${escapeHtml(formatDate(lead.createdAt))}</span>
            <span>${escapeHtml(lead.phone)}</span>
            <span>${escapeHtml(typeLabels[lead.type] || lead.type)}</span>
            <span>${escapeHtml(lead.service || 'Услуга не указана')}</span>
          </div>
        </div>
        <span class="status-pill status-${escapeHtml(lead.status || 'new')}">${escapeHtml(statusLabels[lead.status] || lead.status)}</span>
      </div>

      <div class="lead-grid">
        <div class="lead-main">
          <div class="lead-message">${formatLeadMessage(lead.message)}</div>
          <div class="meta">
            ${lead.productTitle ? `<span>Тема: ${escapeHtml(lead.productTitle)}</span>` : ''}
            ${lead.recipe ? `<span>Рецепт: ${escapeHtml(lead.recipe)}</span>` : ''}
            
            ${lead.adminNote ? `<span>Заметка: ${escapeHtml(lead.adminNote)}</span>` : ''}
          </div>
          <label class="lead-note">
            <span>Заметка сотрудника</span>
            <textarea rows="3" data-role="admin-note" placeholder="Например: клиент назвал номер заявки по телефону">${escapeHtml(lead.adminNote || '')}</textarea>
          </label>
        </div>

        <div class="lead-side">
          <label>
            <span>Статус заявки</span>
            <select data-role="lead-status">
              ${Object.entries(statusLabels).map(([value, label]) => `<option value="${value}" ${lead.status === value ? 'selected' : ''}>${label}</option>`).join('')}
            </select>
          </label>
          <div class="lead-actions">
            <button class="primary-btn" type="button" data-action="save-lead">Сохранить</button>
            ${can('leads:delete') ? '<button class="secondary-btn" type="button" data-action="delete-lead">Удалить</button>' : ''}
          </div>
        </div>
      </div>
    </article>
  `).join(''));
}

function renderProducts() {
  setText('#productsCount', `${state.products.length} позиций`);
  const list = qs('#productsList');
  if (!list) return;
  if (!state.products.length) {
    setHtml(list, `
      <div class="panel">
        <h2>Каталог пустой</h2>
        <p class="panel-subtitle">Добавьте первый товар или услугу через форму слева.</p>
      </div>
    `);
    return;
  }

  setHtml(list, state.products.map((product) => `
    <article class="product-card" data-id="${escapeHtml(product.id)}">
      <div class="product-top">
        <div>
          <h3>${escapeHtml(product.title)}</h3>
          <div class="meta">
            <span>${escapeHtml(product.section)}</span>
            <span>${escapeHtml(product.category || 'без категории')}</span>
            <span>${escapeHtml(product.brand || 'без бренда')}</span>
            <span>${escapeHtml(product.price || 'цена не указана')}</span>
            <span>${product.active ? 'активный' : 'скрыт'}</span>
            ${product.image ? '<span>с фото</span>' : ''}
          </div>
        </div>
        <div class="product-actions">
          <button class="secondary-btn" type="button" data-action="edit-product">Редактировать</button>
          <button class="secondary-btn" type="button" data-action="toggle-product">${product.active ? 'Скрыть' : 'Показать'}</button>
          <button class="secondary-btn danger-btn" type="button" data-action="delete-product">Удалить</button>
        </div>
      </div>
      <div class="product-summary">
        ${product.image ? `<div class="product-photo-preview"><img src="${escapeHtml(product.image)}" alt="${escapeHtml(product.title)}" loading="lazy" /></div>` : ''}
        <p>${escapeHtml(product.description || 'Описание не добавлено.')}</p>
        <div class="product-summary-row">
          ${Array.isArray(product.tags) && product.tags.length ? product.tags.map((tag) => `<span class="product-tag">${escapeHtml(tag)}</span>`).join('') : '<span class="product-tag">без тегов</span>'}
        </div>
      </div>
    </article>
  `).join(''));
}

function renderSettings() {
  const settings = state.settings || {};
  qs('#businessName').value = settings.businessName || '';
  qs('#address').value = settings.address || '';
  qs('#phone').value = settings.phone || '';
  qs('#workTime').value = settings.workTime || '';
  qs('#bookingHoldHours').value = settings.bookingHoldHours || 24;
  qs('#reservationText').value = settings.reservationText || '';
  qs('#notificationEmail').value = settings.notificationEmail || '';
  qs('#publicEmail').value = settings.publicEmail || '';
  qs('#whatsappPhone').value = settings.whatsappPhone || '';
  qs('#telegramUrl').value = settings.telegramUrl || '';
  qs('#salonOneName').value = settings.salonOneName || 'Дуси Ковальчук';
  qs('#salonOneAddress').value = settings.salonOneAddress || 'Новосибирск, ул. Дуси Ковальчук 179/2, кор. 16/2';
  qs('#salonOneYandexMapUrl').value = settings.salonOneYandexMapUrl || settings.yandexMapUrl || '';
  qs('#salonOneGisUrl').value = settings.salonOneGisUrl || settings.gisUrl || '';
  qs('#salonOneRouteUrl').value = settings.salonOneRouteUrl || '';
  qs('#salonTwoName').value = settings.salonTwoName || 'Учительская';
  qs('#salonTwoAddress').value = settings.salonTwoAddress || 'Новосибирск, ул. Учительская 33';
  qs('#salonTwoYandexMapUrl').value = settings.salonTwoYandexMapUrl || '';
  qs('#salonTwoGisUrl').value = settings.salonTwoGisUrl || '';
  qs('#salonTwoRouteUrl').value = settings.salonTwoRouteUrl || '';
}

async function saveLead(card) {
  const id = card.dataset.id;
  const status = card.querySelector('[data-role="lead-status"]').value;
  const adminNote = card.querySelector('[data-role="admin-note"]').value;
  await api(`/api/admin/leads/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify({ status, adminNote })
  });
  const movedToArchive = closedStatuses.has(status);
  showToast('Заявка сохранена', movedToArchive ? 'Заявка перенесена в закрытые.' : 'Изменения применены.');
  await loadAll();
}

async function deleteLead(card) {
  if (!confirm('Удалить заявку из CRM?')) return;
  const id = card.dataset.id;
  await api(`/api/admin/leads/${encodeURIComponent(id)}`, {
    method: 'DELETE'
  });
  showToast('Заявка удалена');
  await loadAll();
}

function fillProductForm(product = null) {
  qs('#productFormTitle').textContent = product ? 'Редактировать товар' : 'Добавить товар';
  qs('#productId').value = product?.id || '';
  qs('#productTitle').value = product?.title || '';
  qs('#productSection').value = product?.section || 'frames';
  qs('#productCategory').value = product?.category || '';
  qs('#productBrand').value = product?.brand || '';
  qs('#productType').value = product?.type || '';
  qs('#productPrice').value = product?.price || '';
  qs('#productAvailability').value = product?.availability || '';
  qs('#productImage').value = product?.image || '';
  const fileInput = qs('#productImageFile');
  if (fileInput) fileInput.value = '';
  qs('#productDescription').value = product?.description || '';
  qs('#productTags').value = Array.isArray(product?.tags) ? product.tags.join(', ') : '';
  qs('#productActive').checked = product ? product.active !== false : false;
  qs('#productStatus').textContent = product ? 'Редактирование выбранного товара.' : '';
}

function getProductFormData() {
  return {
    title: qs('#productTitle').value.trim(),
    section: qs('#productSection').value,
    category: qs('#productCategory').value.trim(),
    brand: qs('#productBrand').value.trim(),
    type: qs('#productType').value.trim(),
    price: qs('#productPrice').value.trim(),
    availability: qs('#productAvailability').value.trim(),
    image: qs('#productImage').value.trim(),
    description: qs('#productDescription').value.trim(),
    tags: qs('#productTags').value.split(',').map((item) => item.trim()).filter(Boolean),
    active: qs('#productActive').checked
  };
}

async function uploadProductImageIfNeeded() {
  const input = qs('#productImageFile');
  const file = input?.files?.[0];
  if (!file) return '';
  const formData = new FormData();
  formData.append('image', file);
  const response = await fetch('/api/admin/uploads/product-image', {
    method: 'POST',
    body: formData,
    credentials: 'same-origin'
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.success) throw new Error(data.error || 'Не удалось загрузить фото');
  return data.url || '';
}

async function saveProduct(event) {
  event.preventDefault();
  const id = qs('#productId').value;
  const data = getProductFormData();
  if (!data.title) {
    qs('#productStatus').textContent = 'Введите название.';
    showToast('Не удалось сохранить', 'Введите название товара.', 'error');
    return;
  }
  const uploadedImage = await uploadProductImageIfNeeded();
  if (uploadedImage) data.image = uploadedImage;
  if (id) {
    await api(`/api/admin/products/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(data)
    });
    showToast('Товар обновлён');
  } else {
    await api('/api/admin/products', {
      method: 'POST',
      body: JSON.stringify(data)
    });
    showToast('Товар добавлен');
  }
  qs('#productStatus').textContent = 'Сохранено.';
  fillProductForm();
  await loadProducts();
  await loadDashboard();
}

async function toggleProduct(card) {
  const product = state.products.find((item) => item.id === card.dataset.id);
  if (!product) return;
  const nextActive = product.active === false;
  if (!nextActive && !confirm('Скрыть товар в каталоге CRM? Его можно будет вернуть кнопкой “Показать”.')) return;
  await api(`/api/admin/products/${encodeURIComponent(card.dataset.id)}`, {
    method: 'PATCH',
    body: JSON.stringify({ active: nextActive })
  });
  showToast(nextActive ? 'Товар показан' : 'Товар скрыт', nextActive ? 'Он снова показывается на сайте.' : 'Он остался в CRM, но больше не показывается на сайте.');
  await loadProducts();
  await loadDashboard();
}

async function deleteProduct(card) {
  if (!confirm('Удалить товар из каталога полностью? Он исчезнет из CRM и с сайта. Это действие нельзя будет отменить.')) return;
  await api(`/api/admin/products/${encodeURIComponent(card.dataset.id)}`, {
    method: 'DELETE'
  });
  showToast('Товар удалён', 'Позиция полностью удалена из каталога.');
  fillProductForm();
  await loadProducts();
  await loadDashboard();
}

async function saveSettings(event) {
  event.preventDefault();
  const data = {
    businessName: qs('#businessName').value.trim(),
    address: qs('#address').value.trim(),
    phone: qs('#phone').value.trim(),
    workTime: qs('#workTime').value.trim(),
    bookingHoldHours: Number(qs('#bookingHoldHours').value || 24),
    reservationText: qs('#reservationText').value.trim(),
    notificationEmail: qs('#notificationEmail').value.trim(),
    publicEmail: qs('#publicEmail').value.trim(),
    whatsappPhone: qs('#whatsappPhone').value.trim(),
    telegramUrl: qs('#telegramUrl').value.trim(),
    salonOneName: qs('#salonOneName').value.trim(),
    salonOneAddress: qs('#salonOneAddress').value.trim(),
    salonOneYandexMapUrl: qs('#salonOneYandexMapUrl').value.trim(),
    salonOneGisUrl: qs('#salonOneGisUrl').value.trim(),
    salonOneRouteUrl: qs('#salonOneRouteUrl').value.trim(),
    salonTwoName: qs('#salonTwoName').value.trim(),
    salonTwoAddress: qs('#salonTwoAddress').value.trim(),
    salonTwoYandexMapUrl: qs('#salonTwoYandexMapUrl').value.trim(),
    salonTwoGisUrl: qs('#salonTwoGisUrl').value.trim(),
    salonTwoRouteUrl: qs('#salonTwoRouteUrl').value.trim()
  };
  await api('/api/admin/settings', {
    method: 'PUT',
    body: JSON.stringify(data)
  });
  qs('#settingsStatus').textContent = 'Настройки сохранены.';
  showToast('Настройки сохранены');
  await loadSettings();
}

function exportLeadsCsv() {
  const header = ['Номер заявки', 'Дата', 'Имя', 'Телефон', 'Тип', 'Статус', 'Услуга', 'Товар', 'Комментарий', 'Заметка'];
  const rows = state.leads.map((lead) => [
    getLeadDisplayNumber(lead) ? `№${getLeadDisplayNumber(lead)}` : '',
    formatDate(lead.createdAt),
    lead.name,
    lead.phone,
    typeLabels[lead.type] || lead.type,
    statusLabels[lead.status] || lead.status,
    lead.service,
    lead.productTitle,
    lead.message,
    lead.adminNote
  ]);
  const csv = [header, ...rows].map((row) => row.map((cell) => `"${String(cell || '').replace(/"/g, '""')}"`).join(';')).join('\n');
  const blob = new Blob([`\ufeff${csv}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `sibir-optika-leads-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
  showToast('CSV выгружен');
}

function bindEvents() {
  qs('#loginForm')?.addEventListener('submit', login);
  qs('#logoutBtn')?.addEventListener('click', logout);
  qs('#refreshBtn')?.addEventListener('click', async () => {
    await loadAll();
    showToast('Данные обновлены');
  });
  qs('#productForm')?.addEventListener('submit', saveProduct);
  qs('#resetProductBtn')?.addEventListener('click', () => fillProductForm());
  qs('#settingsForm')?.addEventListener('submit', saveSettings);
  qs('#exportLeadsBtn')?.addEventListener('click', exportLeadsCsv);
  qs('#accountingApplyFiltersBtn')?.addEventListener('click', () => loadAccountingReport().catch((error) => showToast('Ошибка', error.message, 'error')));
  qs('#accountingResetFiltersBtn')?.addEventListener('click', () => {
    qs('#accountingSearch').value = '';
    qs('#accountingStatusFilter').value = '';
    qs('#accountingTypeFilter').value = '';
    qs('#accountingDateFrom').value = '';
    qs('#accountingDateTo').value = '';
    loadAccountingReport().catch((error) => showToast('Ошибка', error.message, 'error'));
  });
  qs('#downloadAccountingExcelBtn')?.addEventListener('click', () => downloadAccountingReport('excel'));
  qs('#downloadAccountingCsvBtn')?.addEventListener('click', () => downloadAccountingReport('csv'));

  qsa('.nav-btn').forEach((button) => {
    button.addEventListener('click', () => setTab(button.dataset.tab));
  });

  qsa('[data-open-tab]').forEach((button) => {
    button.addEventListener('click', () => setTab(button.dataset.openTab));
  });

  qs('#leadSearch')?.addEventListener('input', () => loadLeads().catch((error) => showToast('Ошибка', error.message, 'error')));
  qs('#statusFilter')?.addEventListener('change', () => loadLeads().catch((error) => showToast('Ошибка', error.message, 'error')));
  qs('#typeFilter')?.addEventListener('change', () => loadLeads().catch((error) => showToast('Ошибка', error.message, 'error')));

  qs('#ticketSearchBtn')?.addEventListener('click', () => loadTickets().catch((error) => showToast('Ошибка', error.message, 'error')));
  qs('#ticketSearch')?.addEventListener('input', () => loadTickets().catch((error) => showToast('Ошибка', error.message, 'error')));
  qs('#ticketStatusFilter')?.addEventListener('change', () => loadTickets().catch((error) => showToast('Ошибка', error.message, 'error')));
  qs('#ticketTypeFilter')?.addEventListener('change', () => loadTickets().catch((error) => showToast('Ошибка', error.message, 'error')));
  qs('#ticketResetBtn')?.addEventListener('click', () => {
    qs('#ticketSearch').value = '';
    qs('#ticketStatusFilter').value = '';
    qs('#ticketTypeFilter').value = '';
    loadTickets().catch((error) => showToast('Ошибка', error.message, 'error'));
  });

  qs('#closedSearch')?.addEventListener('input', () => loadClosedLeads().catch((error) => showToast('Ошибка', error.message, 'error')));
  qs('#closedStatusFilter')?.addEventListener('change', () => loadClosedLeads().catch((error) => showToast('Ошибка', error.message, 'error')));
  qs('#closedTypeFilter')?.addEventListener('change', () => loadClosedLeads().catch((error) => showToast('Ошибка', error.message, 'error')));
  qs('#closedResetBtn')?.addEventListener('click', () => {
    qs('#closedSearch').value = '';
    qs('#closedStatusFilter').value = '';
    qs('#closedTypeFilter').value = '';
    loadClosedLeads().catch((error) => showToast('Ошибка', error.message, 'error'));
  });

  document.addEventListener('click', (event) => {
    const target = event.target.closest('[data-action]');
    if (!target) return;
    const card = target.closest('[data-id]');
    if (!card) return;
    const action = target.dataset.action;
    if (action === 'save-lead') saveLead(card).catch((error) => showToast('Ошибка', error.message, 'error'));
    if (action === 'delete-lead') deleteLead(card).catch((error) => showToast('Ошибка', error.message, 'error'));
    if (action === 'toggle-product') toggleProduct(card).catch((error) => showToast('Ошибка', error.message, 'error'));
    if (action === 'delete-product') deleteProduct(card).catch((error) => showToast('Ошибка', error.message, 'error'));
    if (action === 'edit-product') {
      const product = state.products.find((item) => item.id === card.dataset.id);
      fillProductForm(product);
      setTab('products');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  });
}

async function init() {
  bindEvents();
  showLogin();
  try {
    const authenticated = await checkAuth();
    if (authenticated) {
      showApp();
      applyRoleUi();
      await loadAll();
      startDashboardPolling();
    }
  } catch (error) {
    showLogin();
  }
}

init();
