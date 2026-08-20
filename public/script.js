let config = { ...(window.SIBIR_OPTIKA_CONFIG || {}) };
const qs = (selector) => document.querySelector(selector);
const qsa = (selector) => Array.from(document.querySelectorAll(selector));

function setText(selector, value) {
  const el = qs(selector);
  if (el && value) el.textContent = value;
}

function setLink(selector, href, text) {
  const el = qs(selector);
  if (!el) return;
  if (href) el.href = href;
  if (text) el.textContent = text;
}

function setOptionalLink(selector, href, text) {
  const el = qs(selector);
  if (!el) return;
  const holder = el.closest('li') || el.closest('.contact-card') || el;
  const normalizedHref = normalizePublicUrl(href);
  if (!normalizedHref) {
    holder.style.display = 'none';
    return;
  }
  holder.style.display = '';
  el.classList.remove('is-disabled');
  el.removeAttribute('aria-disabled');
  el.href = normalizedHref;
  if (text) el.textContent = text;
}

function normalizePublicUrl(value) {
  const raw = String(value || '').trim();
  if (!raw || raw === '#') return '';
  if (/^(https?:|mailto:|tel:)/i.test(raw)) return raw;
  if (/^@?[a-zA-Z0-9_]{4,}$/.test(raw)) return `https://t.me/${raw.replace(/^@/, '')}`;
  if (/^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/.test(raw)) return `https://${raw}`;
  return raw;
}

function setVisibleQuickLink(selector, href, text, emptyText = '') {
  const el = qs(selector);
  if (!el) return;
  const holder = el.closest('li') || el.closest('.so-contact-list > div') || el;
  const normalizedHref = normalizePublicUrl(href);
  if (normalizedHref) {
    holder.style.display = '';
    el.href = normalizedHref;
    el.classList.remove('is-disabled');
    el.removeAttribute('aria-disabled');
    if (text) el.textContent = text;
    return;
  }
  holder.style.display = 'none';
  el.removeAttribute('href');
  el.classList.add('is-disabled');
  el.setAttribute('aria-disabled', 'true');
  el.textContent = emptyText;
}

function setDisabledButtonLink(selector, href, text, emptyText = 'не указано') {
  const el = qs(selector);
  if (!el) return;
  el.style.display = '';
  const normalizedHref = normalizePublicUrl(href);
  if (normalizedHref) {
    el.href = normalizedHref;
    el.classList.remove('is-disabled');
    el.removeAttribute('aria-disabled');
    el.textContent = text;
    return;
  }
  el.removeAttribute('href');
  el.classList.add('is-disabled');
  el.setAttribute('aria-disabled', 'true');
  el.textContent = emptyText;
}

function getSalonOneYandexMapUrl() {
  return config.salonOneYandexMapUrl || config.yandexMapUrl || '';
}

function getSalonOneGisUrl() {
  return config.salonOneGisUrl || config.gisUrl || '';
}

function getSalonTwoYandexMapUrl() {
  return config.salonTwoYandexMapUrl || '';
}

function getSalonTwoGisUrl() {
  return config.salonTwoGisUrl || '';
}

function getSalonOneRouteUrl() {
  return config.salonOneRouteUrl || config.salonOneYandexMapUrl || config.yandexMapUrl || '';
}

function getSalonTwoRouteUrl() {
  return config.salonTwoRouteUrl || config.salonTwoYandexMapUrl || '';
}

function formatPhoneMask(value) {
  const digits = value.replace(/\D/g, '').slice(0, 11);
  let normalized = digits;
  if (normalized.startsWith('8')) normalized = '7' + normalized.slice(1);
  if (!normalized.startsWith('7')) normalized = '7' + normalized;
  const d = normalized.slice(1);
  let result = '+7';
  if (d.length > 0) result += ' (' + d.slice(0, 3);
  if (d.length >= 3) result += ')';
  if (d.length > 3) result += ' ' + d.slice(3, 6);
  if (d.length > 6) result += '-' + d.slice(6, 8);
  if (d.length > 8) result += '-' + d.slice(8, 10);
  return result;
}

function buildWhatsAppMessage(data) {
  return [
    `Новая заявка с сайта ${config.name || 'Сибирь Оптика'}`,
    ``,
    `Имя: ${data.name}`,
    `Телефон: ${data.phone}`,
    `Что нужно: ${data.service}`,
    `Есть рецепт: ${data.recipe}`,
    `Комментарий: ${data.message || '-'}`
  ].join('\n');
}

async function loadPublicSettings() {
  try {
    const response = await fetch('/api/settings?ts=' + Date.now(), { cache: 'no-store' });
    const data = await response.json().catch(() => ({}));
    if (response.ok && data.success && data.settings) {
      config = { ...config, ...data.settings };
      if (config.phoneText) config.phoneDigits = config.phoneText.replace(/\D/g, '');
      if (config.publicEmail) config.email = config.publicEmail;
      return true;
    }
  } catch (error) {}
  return false;
}

async function refreshPublicSettings() {
  const loaded = await loadPublicSettings();
  if (loaded) applyConfig();
}

function applyConfig() {
  setText('#brandName', config.name || 'Сибирь Оптика');
  setText('#brandCity', config.city || 'Новосибирск');
  setText('#heroEyebrow', `${config.name || 'Сибирь Оптика'} • изготовление линз мастером`);
  setText('#contactTitle', config.name || 'Сибирь Оптика');
  setText('#fullAddress', config.fullAddress || 'Новосибирск, ул. Дуси Ковальчук 179/2; ул. Учительская 33');
  setText('#workTime', config.workTime || 'Режим работы уточняется');
  setText('#salonOneName', config.salonOneName || 'Дуси Ковальчук');
  setText('#salonOneAddress', config.salonOneAddress || 'Новосибирск, ул. Дуси Ковальчук 179/2, кор. 16/2');
  setText('#salonTwoName', config.salonTwoName || 'Учительская');
  setText('#salonTwoAddress', config.salonTwoAddress || 'Новосибирск, ул. Учительская 33');
  const phoneText = config.phoneText || 'указать номер';
  const phoneHref = config.phoneDigits ? `tel:+${config.phoneDigits}` : '#';
  setLink('#headerPhone', phoneHref, phoneText);
  setLink('#callLink', phoneHref, 'Позвонить');
  setLink('#contactPhoneText', phoneHref, phoneText);
  setLink('#mobileCall', phoneHref, 'Позвонить');
  const whatsappDigits = (config.whatsappPhone || '').replace(/\D/g, '');
  const whatsappHref = whatsappDigits ? `https://wa.me/${whatsappDigits}` : '';
  setOptionalLink('#whatsappLink', whatsappHref, 'WhatsApp');
  setVisibleQuickLink('#quickWhatsappLink', whatsappHref, 'написать');
  setOptionalLink('#contactTelegramButton', config.telegramUrl, 'Telegram');
  setVisibleQuickLink('#telegramLink', config.telegramUrl, 'открыть');
  const emailHref = config.email ? `mailto:${config.email}` : '';
  setVisibleQuickLink('#emailLink', emailHref, 'написать');
  setVisibleQuickLink('#salonOneYandexMapLink', getSalonOneYandexMapUrl(), 'Яндекс Карты', 'не указано');
  setVisibleQuickLink('#salonOneGisLink', getSalonOneGisUrl(), '2ГИС', 'не указано');
  setVisibleQuickLink('#salonTwoYandexMapLink', getSalonTwoYandexMapUrl(), 'Яндекс Карты', 'не указано');
  setVisibleQuickLink('#salonTwoGisLink', getSalonTwoGisUrl(), '2ГИС', 'не указано');
  setVisibleQuickLink('#salonOneRouteLink', getSalonOneRouteUrl(), 'Маршрут', 'не указано');
  setVisibleQuickLink('#salonTwoRouteLink', getSalonTwoRouteUrl(), 'Маршрут', 'не указано');
  setVisibleQuickLink('#yandexMapLink', getSalonOneYandexMapUrl(), 'смотреть', 'не указано');
  setVisibleQuickLink('#gisLink', getSalonOneGisUrl(), 'смотреть', 'не указано');
  setDisabledButtonLink('#routeLink', getSalonOneRouteUrl(), 'Построить маршрут', 'не указано');
  setVisibleQuickLink('#mobileRoute', getSalonOneRouteUrl(), 'Маршрут', 'Маршрут');
  setText('#priceGlasses', config.prices?.glasses || 'от 3 500 ₽');
  setText('#priceReplacement', config.prices?.replacement || 'от 2 000 ₽');
  setText('#priceContacts', config.prices?.contacts || 'от 1 200 ₽');
  setText('#priceRepair', config.prices?.repair || 'от 300 ₽');
  setText('#priceGlassesHero', config.prices?.glasses || 'от 3 500 ₽');
  setText('#priceReplacementHero', config.prices?.replacement || 'от 2 000 ₽');
}

function initDisabledLinks() {
  document.addEventListener('click', (event) => {
    const disabledLink = event.target.closest('a.is-disabled');
    if (disabledLink) event.preventDefault();
  });
}

function initPhoneMask() {
  const input = qs('#phone');
  if (!input) return;
  input.addEventListener('input', () => {
    input.value = formatPhoneMask(input.value);
  });
  input.addEventListener('focus', () => {
    if (!input.value) input.value = '+7';
  });
}

function initMobileMenu() {
  const toggle = qs('#menuToggle');
  const menu = qs('#mobileMenu');
  if (!toggle || !menu) return;
  toggle.addEventListener('click', () => menu.classList.toggle('open'));
  menu.querySelectorAll('a').forEach((link) => link.addEventListener('click', () => menu.classList.remove('open')));
}


let productsSnapshot = '';
let catalogSearchInitialized = false;

function refreshCatalogControls() {
  fillSelect('#categoryFilter', uniqueValues('category'), 'Все разделы');
  fillSelect('#brandFilter', uniqueValues('brand'), 'Все бренды');
  fillSelect('#typeFilter', uniqueValues('type'), 'Все типы');
}

function renderCatalog() {
  refreshCatalogControls();
  renderCatalogShowcase();
  renderFilteredProducts();
}

async function loadPublicProducts() {
  try {
    const response = await fetch('/api/products?ts=' + Date.now(), { cache: 'no-store' });
    const data = await response.json();
    if (!data.success || !Array.isArray(data.products)) return false;
    const nextSnapshot = JSON.stringify(data.products.map((product) => ({
      id: product.id,
      active: product.active,
      title: product.title,
      image: product.image,
      updatedAt: product.updatedAt || ''
    })));
    const changed = nextSnapshot !== productsSnapshot;
    window.CRM_PRODUCTS = data.products;
    productsSnapshot = nextSnapshot;
    return changed;
  } catch (error) {
    return false;
  }
}

async function refreshPublicProducts() {
  const changed = await loadPublicProducts();
  if (changed && catalogSearchInitialized) renderCatalog();
}


function cleanPublicText(value) {
  if (!value) return '';
  return String(value)
    .replace(/из\s*1с/gi, '')
    .replace(/из\s*1c/gi, '')
    .replace(/из\s+номенклатуры\s+1с/gi, '')
    .replace(/из\s+отч[её]тов\s+1с/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function hasInternalPublicText(value) {
  const text = String(value || '').toLowerCase();
  return text.includes('1с') || text.includes('1c') || text.includes('crm') || text.includes('номенклатур') || text.includes('учёт') || text.includes('учет') || text.includes('config.js') || text.includes('отчёт') || text.includes('отчет') || text.includes('техничес') || text.includes('служеб');
}

function getDefaultPublicDescription(product) {
  const text = [product.section, product.category, product.type, product.title].filter(Boolean).join(' ').toLowerCase();
  if (product.section === 'services' || text.includes('услуг') || text.includes('мастер') || text.includes('ремонт')) return 'Оставьте заявку, чтобы подобрать удобное время визита.';
  if (text.includes('контакт')) return 'Оставьте заявку, чтобы уточнить наличие нужных параметров.';
  if (text.includes('линз')) return 'Оставьте заявку, чтобы подобрать линзы и уточнить итоговую стоимость.';
  if (text.includes('оправ') || text.includes('очк')) return 'Оставьте заявку, чтобы уточнить наличие и выбрать удобный салон для примерки.';
  return 'Оставьте заявку, чтобы уточнить наличие и удобный салон для просмотра.';
}

function getPublicProductDescription(product) {
  const description = cleanPublicText(product.description);
  if (!description || hasInternalPublicText(description) || description.toLowerCase().includes('сотрудник')) {
    return getDefaultPublicDescription(product);
  }
  return description;
}

function getPublicProductPrice(product) {
  const price = cleanPublicText(product.price);
  if (!price || hasInternalPublicText(price) || price.toLowerCase().includes('сотрудник')) return 'цена по запросу';
  return price;
}

function getPublicAvailability(product) {
  const availability = cleanPublicText(product.availability);
  if (!availability || hasInternalPublicText(availability) || availability.toLowerCase().includes('сотрудник')) return 'наличие уточняется';
  return availability;
}

function getPublicBadge(value) {
  const badge = cleanPublicText(value);
  if (!badge || hasInternalPublicText(badge)) return '';
  return badge;
}

function getProducts() {
  return Array.isArray(window.CRM_PRODUCTS) ? window.CRM_PRODUCTS : [];
}

function getActiveProducts() {
  return getProducts().filter((product) => product.active !== false);
}

function updateCatalogVisibility() {
  const activeProducts = getActiveProducts();
  const section = qs('#products');
  const links = qsa('[data-catalog-nav]');
  const isVisible = activeProducts.length > 0;
  if (section) {
    section.hidden = !isVisible;
    section.style.display = isVisible ? '' : 'none';
  }
  links.forEach((link) => {
    link.hidden = !isVisible;
    link.style.display = isVisible ? '' : 'none';
  });
  return isVisible;
}

function uniqueValues(field) {
  return Array.from(new Set(getActiveProducts().map((p) => p[field]).filter(Boolean))).sort();
}

function fillSelect(selector, values, defaultText) {
  const select = qs(selector);
  if (!select) return;
  select.innerHTML = '';
  const defaultOption = document.createElement('option');
  defaultOption.value = 'all';
  defaultOption.textContent = defaultText;
  select.appendChild(defaultOption);
  values.forEach((value) => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = value;
    select.appendChild(option);
  });
}


function getProductDetailRows(product) {
  return [
    ['Категория', product.category],
    ['Бренд', product.brand],
    ['Тип', product.type],
    ['Параметры', product.shape],
    ['Наличие', getPublicAvailability(product)],
    ['Цена', getPublicProductPrice(product)]
  ].map(([name, value]) => [name, cleanPublicText(value)]).filter(([, value]) => value && !hasInternalPublicText(value));
}

function closeProductDetails() {
  const existing = qs('.product-details-modal');
  if (existing) existing.remove();
  document.body.classList.remove('modal-open');
}

function showProductDetails(product) {
  closeProductDetails();
  const overlay = document.createElement('div');
  overlay.className = 'product-details-modal';
  const dialog = document.createElement('div');
  dialog.className = 'product-details-dialog';
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'product-details-close';
  close.textContent = 'Закрыть';
  close.addEventListener('click', closeProductDetails);
  const label = document.createElement('div');
  label.className = 'product-details-label';
  label.textContent = product.category || 'Товар';
  const title = document.createElement('h3');
  title.textContent = product.title || 'Товар';
  const description = document.createElement('p');
  description.className = 'product-details-description';
  description.textContent = getPublicProductDescription(product);
  const rows = document.createElement('div');
  rows.className = 'product-details-rows';
  getProductDetailRows(product).forEach(([name, value]) => {
    const row = document.createElement('div');
    const key = document.createElement('span');
    const val = document.createElement('strong');
    key.textContent = name;
    val.textContent = value;
    row.appendChild(key);
    row.appendChild(val);
    rows.appendChild(row);
  });
  dialog.appendChild(close);
  dialog.appendChild(label);
  dialog.appendChild(title);
  dialog.appendChild(description);
  if (rows.children.length) dialog.appendChild(rows);
  overlay.appendChild(dialog);
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) closeProductDetails();
  });
  document.body.appendChild(overlay);
  document.body.classList.add('modal-open');
}

function createProductCard(product) {
  const card = document.createElement('article');
  card.className = 'product-card';
  const image = document.createElement('div');
  image.className = 'product-image';
  if (product.image) {
    image.classList.add('has-photo');
    image.style.backgroundImage = `linear-gradient(180deg, rgba(7,26,51,0.04), rgba(7,26,51,0.08)), url('${product.image}')`;
    image.style.backgroundSize = 'cover';
    image.style.backgroundPosition = 'center';
  } else {
    if (product.gradient) image.style.background = product.gradient;
    const visual = document.createElement('div');
    visual.className = `product-visual ${product.visual || 'frame'}`;
    visual.appendChild(document.createElement('span'));
    image.appendChild(visual);
  }
  const badges = document.createElement('div');
  badges.className = 'product-badges';
  const categoryBadge = document.createElement('span');
  categoryBadge.className = 'product-badge';
  categoryBadge.textContent = product.category || 'Товар';
  badges.appendChild(categoryBadge);
  const publicBadge = getPublicBadge(product.badge);
  if (publicBadge) {
    const badge = document.createElement('span');
    badge.className = 'product-badge gold';
    badge.textContent = publicBadge;
    badges.appendChild(badge);
  }
  image.appendChild(badges);
  const body = document.createElement('div');
  body.className = 'product-body';
  const category = document.createElement('div');
  category.className = 'product-category';
  category.textContent = product.brand ? `${product.brand} • ${product.type || product.category || 'товар'}` : product.type || product.category || 'товар';
  const title = document.createElement('h3');
  title.className = 'product-title';
  title.textContent = product.title || 'Товар';
  const description = document.createElement('p');
  description.className = 'product-description';
  description.textContent = getPublicProductDescription(product);
  const details = document.createElement('button');
  details.type = 'button';
  details.className = 'product-details-action';
  details.textContent = product.section === 'services' ? 'Подробнее' : 'Характеристики';
  details.addEventListener('click', () => showProductDetails(product));
  const footer = document.createElement('div');
  footer.className = 'product-footer';
  const price = document.createElement('div');
  price.className = 'product-price';
  const priceLabel = document.createElement('span');
  priceLabel.textContent = getPublicAvailability(product);
  const priceValue = document.createElement('strong');
  priceValue.textContent = getPublicProductPrice(product);
  price.appendChild(priceLabel);
  price.appendChild(priceValue);
  const action = document.createElement('button');
  action.type = 'button';
  action.className = 'product-action';
  action.textContent = product.section === 'services' ? 'Записаться' : 'Купить';
  action.addEventListener('click', () => {
    const form = qs('#appointmentForm');
    const service = qs('#service');
    const message = qs('#message');
    if (form) {
      form.dataset.productId = product.id || '';
      form.dataset.productTitle = product.title || '';
      form.dataset.leadType = product.section === 'services' ? 'appointment' : 'reservation';
    }
    if (service) service.value = product.leadService || 'Другое';
    if (message) {
      const brandText = product.brand ? `, бренд: ${product.brand}` : '';
      const typeText = product.type ? `, тип: ${product.type}` : '';
      message.value = `Интересует: ${product.title || 'позиция с сайта'}${brandText}${typeText}`;
    }
    const opticalRoute = qs('#optical-route');
    if (opticalRoute) opticalRoute.scrollIntoView({ behavior: 'smooth' });
  });
  footer.appendChild(price);
  footer.appendChild(details);
  footer.appendChild(action);
  body.appendChild(category);
  body.appendChild(title);
  body.appendChild(description);
  body.appendChild(footer);
  card.appendChild(image);
  card.appendChild(body);
  return card;
}

function renderGrid(selector, products, emptySelector) {
  const grid = qs(selector);
  const empty = emptySelector ? qs(emptySelector) : null;
  if (!grid) return;
  grid.classList.remove('product-strip');
  grid.classList.add('products-grid');
  grid.innerHTML = '';
  products.forEach((product) => grid.appendChild(createProductCard(product)));
  if (empty) empty.classList.toggle('visible', products.length === 0);
}

function renderStrip(selector, products) {
  const grid = qs(selector);
  if (!grid) return;
  grid.classList.remove('products-grid');
  grid.classList.add('product-strip');
  grid.innerHTML = '';
  products.forEach((product) => grid.appendChild(createProductCard(product)));
}

function productMatchesSearch(product, query) {
  if (!query) return true;
  const searchText = [product.title, product.category, product.brand, product.type, product.shape, getPublicProductDescription(product)].filter(Boolean).join(' ').toLowerCase();
  return searchText.includes(query.toLowerCase());
}

function getFilteredProducts() {
  const query = qs('#catalogSearchInput')?.value.trim() || '';
  const category = qs('#categoryFilter')?.value || 'all';
  const brand = qs('#brandFilter')?.value || 'all';
  const type = qs('#typeFilter')?.value || 'all';
  return getActiveProducts().filter((p) => productMatchesSearch(p, query) && (category === 'all' || p.category === category) && (brand === 'all' || p.brand === brand) && (type === 'all' || p.type === type));
}

function hasCatalogSearch() {
  const query = qs('#catalogSearchInput')?.value.trim() || '';
  const category = qs('#categoryFilter')?.value || 'all';
  const brand = qs('#brandFilter')?.value || 'all';
  const type = qs('#typeFilter')?.value || 'all';
  return query.length > 0 || category !== 'all' || brand !== 'all' || type !== 'all';
}

function createBrandLane(title, products, searchValue) {
  const lane = document.createElement('section');
  lane.className = 'brand-lane';
  const head = document.createElement('div');
  head.className = 'brand-lane-head';
  const titleBox = document.createElement('div');
  const label = document.createElement('span');
  label.textContent = 'Подборка';
  const h3 = document.createElement('h3');
  h3.textContent = title;
  titleBox.appendChild(label);
  titleBox.appendChild(h3);
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'brand-lane-link';
  button.textContent = 'Показать все';
  button.addEventListener('click', () => {
    const searchInput = qs('#catalogSearchInput');
    const brandFilter = qs('#brandFilter');
    if (brandFilter && Array.from(brandFilter.options).some((option) => option.value === searchValue)) {
      brandFilter.value = searchValue;
      if (searchInput) searchInput.value = '';
    } else if (searchInput) {
      searchInput.value = searchValue;
      if (brandFilter) brandFilter.value = 'all';
    }
    renderFilteredProducts();
    qs('#catalog-search')?.scrollIntoView({ behavior: 'smooth' });
  });
  head.appendChild(titleBox);
  head.appendChild(button);
  const row = document.createElement('div');
  row.className = 'brand-lane-row';
  products.forEach((product) => row.appendChild(createProductCard(product)));
  lane.appendChild(head);
  lane.appendChild(row);
  return lane;
}

function isSectionProduct(product, section, keywords = []) {
  const text = [product.section, product.category, product.type, product.title].filter(Boolean).join(' ').toLowerCase();
  return product.section === section || keywords.some((keyword) => text.includes(keyword));
}

function getShowcaseGroups() {
  const products = getActiveProducts();
  const used = new Set();
  const makeGroup = (title, predicate, searchValue) => {
    const items = takeSorted(products.filter((product) => !used.has(product.id) && predicate(product)), 12);
    items.forEach((product) => used.add(product.id));
    return [title, items, searchValue];
  };
  const groups = [
    makeGroup('Изготовление и услуги мастера', (product) => isSectionProduct(product, 'services', ['услуг', 'мастер', 'ремонт', 'замена']), 'услуги мастера'),
    makeGroup('Оправы и очки', (product) => isSectionProduct(product, 'frames', ['оправ', 'очк']), 'оправы'),
    makeGroup('Очковые линзы', (product) => isSectionProduct(product, 'lenses', ['очковые линзы', 'линзы для очков']), 'очковые линзы'),
    makeGroup('Контактные линзы', (product) => isSectionProduct(product, 'contacts', ['контактные']), 'контактные линзы'),
    makeGroup('Аксессуары и уход', (product) => isSectionProduct(product, 'accessories', ['аксессуар', 'спрей', 'футляр', 'салфет']), 'аксессуары')
  ];
  const remaining = takeSorted(products.filter((product) => !used.has(product.id)), 12);
  if (remaining.length) groups.push(['Другие товары', remaining, '']);
  return groups.filter(([, items]) => items.length > 0);
}

function renderCatalogShowcase() {
  const showcase = qs('#catalogShowcase');
  if (!showcase) return;
  showcase.innerHTML = '';
  if (!updateCatalogVisibility()) return;
  getShowcaseGroups().forEach(([title, products, searchValue]) => {
    showcase.appendChild(createBrandLane(title, products, searchValue));
  });
}

function renderFilteredProducts() {
  const grid = qs('#filteredProductsGrid');
  const empty = qs('#emptyFilteredProducts');
  const showcase = qs('#catalogShowcase');
  if (!updateCatalogVisibility()) {
    if (grid) {
      grid.innerHTML = '';
      grid.hidden = true;
      grid.style.display = 'none';
    }
    if (showcase) {
      showcase.innerHTML = '';
      showcase.hidden = true;
      showcase.style.display = 'none';
    }
    if (empty) {
      empty.textContent = '';
      empty.classList.remove('visible');
    }
    setText('#resultsCount', '');
    return;
  }
  if (!hasCatalogSearch()) {
    if (grid) {
      grid.innerHTML = '';
      grid.hidden = true;
      grid.style.display = 'none';
    }
    if (showcase) {
      showcase.hidden = false;
      showcase.style.display = '';
    }
    if (empty) {
      empty.textContent = '';
      empty.classList.remove('visible');
    }
    setText('#resultsCount', 'Выберите интересующий товар или воспользуйтесь поиском по названию, бренду или разделу.');
    return;
  }
  if (showcase) {
    showcase.hidden = true;
    showcase.style.display = 'none';
  }
  if (grid) {
    grid.hidden = false;
    grid.style.display = '';
  }
  const products = getFilteredProducts();
  if (empty) empty.textContent = 'Ничего не найдено. Попробуйте изменить бренд, запрос или фильтры.';
  renderGrid('#filteredProductsGrid', products, '#emptyFilteredProducts');
  setText('#resultsCount', `Найдено: ${products.length}`);
}

function initCatalogSearch() {
  refreshCatalogControls();
  renderCatalogShowcase();
  const searchInput = qs('#catalogSearchInput');
  const categoryFilter = qs('#categoryFilter');
  const brandFilter = qs('#brandFilter');
  const typeFilter = qs('#typeFilter');
  const clearFilters = qs('#clearFilters');
  [searchInput, categoryFilter, brandFilter, typeFilter].forEach((el) => {
    if (!el) return;
    el.addEventListener('input', renderFilteredProducts);
    el.addEventListener('change', renderFilteredProducts);
  });
  if (clearFilters) clearFilters.addEventListener('click', () => {
    if (searchInput) searchInput.value = '';
    if (categoryFilter) categoryFilter.value = 'all';
    if (brandFilter) brandFilter.value = 'all';
    if (typeFilter) typeFilter.value = 'all';
    renderFilteredProducts();
  });
  catalogSearchInitialized = true;
  renderFilteredProducts();
}

function takeSorted(products, limit) {
  return products.slice().sort((a, b) => (a.sort || 0) - (b.sort || 0)).slice(0, limit);
}

function initSectionGrids() {
  const products = getProducts();
  const frames = takeSorted(products.filter((p) => p.section === 'frames'), 12);
  const allLenses = products.filter((p) => p.section === 'lenses');
  const lensPreview = [
    ...takeSorted(allLenses.filter((p) => p.category === 'Очковые линзы'), 8),
    ...takeSorted(allLenses.filter((p) => p.category === 'Контактные линзы'), 8)
  ];
  const services = takeSorted(products.filter((p) => p.section === 'services'), 6);
  renderStrip('#framesGrid', frames);
  renderStrip('#lensesGrid', lensPreview);
  renderStrip('#servicesGrid', services);
}

function getUtm(name) {
  return new URLSearchParams(window.location.search).get(name) || '';
}

async function sendLeadToCrm(formData) {
  const response = await fetch('/api/leads', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(formData)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.success) throw new Error(data.error || 'Не удалось отправить заявку');
  return data;
}


function showLeadSuccessModal(options = {}) {
  const title = options.title || 'Заявка отправлена';
  const text = options.text || 'Спасибо! Мы свяжемся с вами и уточним удобное время визита.';
  const note = options.note || 'Обычно отвечаем в рабочее время салонов.';
  let modal = qs('#leadSuccessModal');

  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'leadSuccessModal';
    modal.className = 'lead-success-modal';
    modal.innerHTML = `
      <div class="lead-success-modal__backdrop" data-lead-success-close></div>
      <div class="lead-success-modal__card" role="dialog" aria-modal="true" aria-labelledby="leadSuccessTitle">
        <button class="lead-success-modal__close" type="button" aria-label="Закрыть" data-lead-success-close>×</button>
        <div class="lead-success-modal__icon">✓</div>
        <h3 id="leadSuccessTitle"></h3>
        <p class="lead-success-modal__text"></p>
        <p class="lead-success-modal__note"></p>
        <button class="btn btn-primary" type="button" data-lead-success-close>Понятно</button>
      </div>
    `;
    document.body.appendChild(modal);
    modal.addEventListener('click', (event) => {
      if (event.target.closest('[data-lead-success-close]')) {
        modal.classList.remove('is-open');
        document.body.classList.remove('modal-open');
      }
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && modal.classList.contains('is-open')) {
        modal.classList.remove('is-open');
        document.body.classList.remove('modal-open');
      }
    });
  }

  const titleEl = modal.querySelector('#leadSuccessTitle');
  const textEl = modal.querySelector('.lead-success-modal__text');
  const noteEl = modal.querySelector('.lead-success-modal__note');
  if (titleEl) titleEl.textContent = title;
  if (textEl) textEl.textContent = text;
  if (noteEl) noteEl.textContent = note;
  modal.classList.add('is-open');
  document.body.classList.add('modal-open');
}


function initForm() {
  const form = qs('#appointmentForm');
  const status = qs('#formStatus');
  if (!form || !status) return;
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const formData = {
      type: form.dataset.leadType || 'appointment',
      name: form.name.value.trim(),
      phone: form.phone.value.trim(),
      service: form.service.value,
      recipe: form.recipe.value,
      message: form.message.value.trim(),
      productId: form.dataset.productId || '',
      productTitle: form.dataset.productTitle || '',
      page: window.location.pathname,
      source: 'site',
      utmSource: getUtm('utm_source'),
      utmMedium: getUtm('utm_medium'),
      utmCampaign: getUtm('utm_campaign')
    };
    if (!formData.name || !formData.phone || !formData.service) {
      status.textContent = 'Пожалуйста, заполните имя, телефон и выберите услугу.';
      return;
    }
    status.textContent = 'Отправляем заявку...';
    try {
      const result = await sendLeadToCrm(formData);
      const crmNumber = result?.lead?.leadNumber ? ` №${result.lead.leadNumber}` : '';
      status.textContent = crmNumber ? `Вы оформили заявку${crmNumber}. Мы свяжемся с вами для уточнения деталей.` : 'Вы оформили заявку. Мы свяжемся с вами для уточнения деталей.';
      showLeadSuccessModal({
        title: crmNumber ? `Вы оформили заявку${crmNumber}` : 'Вы оформили заявку',
        text: 'Спасибо! Заявка получена. Сотрудник салона свяжется с вами, уточнит детали и подтвердит удобное время визита.',
        note: crmNumber ? `Сохраните номер заявки:${crmNumber}. По нему можно проверить статус на сайте.` : 'Пожалуйста, приезжайте после подтверждения времени.'
      });
      form.reset();
      form.dataset.productId = '';
      form.dataset.productTitle = '';
      form.dataset.leadType = 'appointment';
      return;
    } catch (error) {
      const message = buildWhatsAppMessage(formData);
      try {
        const saved = JSON.parse(localStorage.getItem('sibir-optika-leads') || '[]');
        saved.push({ ...formData, createdAt: new Date().toISOString() });
        localStorage.setItem('sibir-optika-leads', JSON.stringify(saved));
      } catch (e) {}
      if (config.email) {
        const subject = encodeURIComponent(`Заявка с сайта ${config.name || 'Сибирь Оптика'}`);
        const body = encodeURIComponent(message);
        window.location.href = `mailto:${config.email}?subject=${subject}&body=${body}`;
        status.textContent = 'Заявка подготовлена. Открылось письмо с данными для отправки в салон.';
        form.reset();
        return;
      }
      status.textContent = 'Заявку сейчас не удалось отправить. Попробуйте позвонить в салон.';
    }
  });
}


function initOpticalRoute() {
  const widget = qs('[data-optical-route]');
  if (!widget) return;

  const state = {
    purpose: null,
    recipe: null,
    urgency: null,
    salon: null,
    labels: {}
  };

  const steps = ['purpose', 'recipe', 'urgency', 'salon'];
  const result = qs('#routeResult');
  const progressFill = qs('#routeProgressFill');
  const progressText = qs('#routeProgressText');
  const routeTitle = qs('#routeResultTitle');
  const routeGrid = qs('#routeResultGrid');
  const routePlan = qs('#routeResultPlan');
  const routeForm = qs('#routeLeadForm');
  const routeStatus = qs('#routeStatus');
  const routeHelper = qs('#routeHelper');
  const fillAppointmentBtn = qs('#routeFillAppointment');
  const routePhone = qs('#routePhone');
  const routeName = qs('#routeName');
  let lastRoute = null;

  widget.querySelectorAll('.route-option').forEach((button) => {
    button.setAttribute('aria-pressed', 'false');
  });

  function selectedCount() {
    return steps.filter((step) => state[step]).length;
  }

  function updateProgress() {
    const count = selectedCount();
    if (progressFill) progressFill.style.width = `${(count / steps.length) * 100}%`;
    if (progressText) progressText.textContent = `${count} из ${steps.length}`;
    if (routeHelper) {
      routeHelper.textContent = count === steps.length
        ? 'План готов. Ниже показано, что будет после заявки и когда можно приезжать.'
        : `Выбрано ${count} из ${steps.length}. Ответьте ещё на ${steps.length - count} ${steps.length - count === 1 ? 'вопрос' : 'вопроса'}.`;
    }
  }

  function getSalons() {
    return {
      dusi: {
        key: 'dusi',
        title: 'Дуси Ковальчук 179/2',
        shortTitle: 'Дуси Ковальчук',
        time: 'изготовление очков от 1 часа',
        speedText: 'от 1 часа',
        address: 'вход с Красного проспекта, ориентир — напротив дома 163 по Красному проспекту, за театром «13 трамвай», метро «Заельцовская»',
        hours: 'ежедневно 09:30–20:00'
      },
      uchitelskaya: {
        key: 'uchitelskaya',
        title: 'Учительская 33',
        shortTitle: 'Учительская 33',
        time: 'изготовление очков от 24 часов',
        speedText: 'от 24 часов',
        address: 'салон находится на Учительской, напротив церкви',
        hours: 'ежедневно 10:00–19:00'
      }
    };
  }

  function pickRecommendedSalon() {
    const salons = getSalons();

    if (state.salon === 'auto') {
      if (state.urgency === 'today') {
        return {
          ...salons.dusi,
          autoPicked: true,
          decision: 'Советуем Дуси Ковальчук, потому что вы выбрали срочный срок. В этом салоне изготовление очков возможно от 1 часа.',
          mismatch: false
        };
      }
      if (state.urgency === 'not-urgent') {
        return {
          ...salons.uchitelskaya,
          autoPicked: true,
          decision: 'Советуем Учительскую 33: срок не срочный, можно спокойно записаться в удобный салон на Учительской.',
          mismatch: false
        };
      }
      return {
        ...salons.dusi,
        autoPicked: true,
        decision: 'Советуем Дуси Ковальчук как более быстрый вариант: изготовление очков возможно от 1 часа.',
        mismatch: false
      };
    }

    if (state.salon === 'uchitelskaya') {
      const isFastConflict = state.urgency === 'today';
      return {
        ...salons.uchitelskaya,
        autoPicked: false,
        mismatch: isFastConflict,
        decision: isFastConflict
          ? 'Вы выбрали Учительскую 33 и срочный срок. Важно: на Учительской изготовление очков от 24 часов. Если очки нужны как можно быстрее, лучше выбрать Дуси Ковальчук.'
          : 'Вы выбрали Учительскую 33 — удобный салон на Учительской, напротив церкви.'
      };
    }

    return {
      ...salons.dusi,
      autoPicked: false,
      mismatch: false,
      decision: state.urgency === 'today'
        ? 'Вы выбрали Дуси Ковальчук — это логичный вариант для срочного заказа, потому что здесь изготовление очков возможно от 1 часа.'
        : 'Вы выбрали Дуси Ковальчук — быстрый салон с изготовлением очков от 1 часа.'
    };
  }

  function planItems(salon) {
    const items = [];
    if (state.recipe === 'no' || state.recipe === 'unsure' || state.purpose === 'diagnostics') {
      items.push('Записаться на диагностику зрения без оплаты.');
    } else {
      items.push('Взять с собой рецепт или данные предыдущих очков.');
    }

    if (state.purpose === 'frames' || state.purpose === 'sunglasses' || state.purpose === 'new-glasses') {
      items.push('Примерить оправы и солнцезащитные очки в салоне.');
    }

    if (state.purpose === 'own-frame') {
      items.push('Взять свою оправу: в салоне проверят, можно ли собрать очки в эту оправу.');
    }

    if (state.purpose === 'pickup') {
      items.push('Проверить, что заказ уже подтверждён как готовый.');
      items.push(`Приехать в салон ${salon.title} в часы работы с номером заказа или телефоном, на который оформляли заказ.`);
    } else {
      items.push('Заказать изготовление очков любой сложности под выбранную задачу.');
      items.push(`Приехать в салон ${salon.title} после подтверждения времени визита.`);
    }
    return items;
  }

  function nextSteps(salon) {
    if (state.purpose === 'pickup') {
      return [
        'Если вам уже подтвердили готовность заказа, отдельная заявка на сайте не нужна.',
        'Приезжайте в выбранный салон в часы работы.',
        'Возьмите с собой номер заказа или телефон, на который оформляли заказ.',
        'Если готовность не подтверждали, сначала позвоните в салон и уточните статус заказа.'
      ];
    }

    const steps = [
      'Вы оставляете заявку на сайте.',
      'Сотрудник салона связывается с вами и уточняет детали: рецепт, оправу, срочность и удобное время.',
      'Салон подтверждает, когда лучше приехать. До подтверждения времени специально приезжать не нужно.',
      `Вы приезжаете в салон ${salon.title} и оформляете заказ.`
    ];

    if (state.urgency === 'today' && salon.key === 'dusi') {
      steps.splice(2, 0, 'Для срочного заказа сотрудник отдельно подтвердит возможность изготовления от 1 часа: срок зависит от рецепта, наличия линз и выбранной оправы.');
    }

    if (state.urgency === 'today' && salon.key === 'uchitelskaya') {
      steps.splice(2, 0, 'На Учительской изготовление от 24 часов. Если нужен срок быстрее, сотрудник может предложить салон на Дуси Ковальчук.');
    }

    return steps;
  }

  function buildRoute() {
    const salon = pickRecommendedSalon();
    const route = {
      salon,
      purpose: state.labels.purpose || '-',
      recipe: state.labels.recipe || '-',
      urgency: state.labels.urgency || '-',
      salonChoice: state.labels.salon || '-',
      plan: planItems(salon),
      next: nextSteps(salon),
      warning: ''
    };

    route.note = state.purpose === 'pickup'
      ? 'Для получения готового заказа заявка на сайте не нужна. Приезжайте после подтверждения готовности заказа.'
      : salon.decision;

    if (salon.mismatch) {
      route.warning = 'Срок не совпадает с выбранным салоном: на Учительской изготовление от 24 часов. Для самого быстрого варианта выберите Дуси Ковальчук.';
    }

    if (state.urgency === 'today' && salon.key === 'dusi') {
      route.warning = 'Срочный срок от 1 часа возможен не для всех заказов. Точное время подтвердит сотрудник салона после заявки.';
    }

    if (salon.autoPicked) {
      route.autoHelp = [
        'Если важна скорость — сайт предлагает Дуси Ковальчук, потому что там изготовление очков возможно от 1 часа.',
        'Если срок не срочный — можно выбрать Учительскую 33, где изготовление очков от 24 часов.',
        'Окончательное время визита всё равно подтвердит сотрудник салона после заявки.'
      ];
    } else {
      route.autoHelp = [];
    }

    return route;
  }

  function renderRoute() {
    updateProgress();

    if (selectedCount() !== steps.length) {
      if (result) result.hidden = true;
      lastRoute = null;
      return;
    }

    lastRoute = buildRoute();

    if (routeTitle) routeTitle.textContent = 'Ваш предварительный план визита';

    if (routeGrid) {
      routeGrid.innerHTML = [
        ['Что нужно', lastRoute.purpose],
        ['Рецепт', lastRoute.recipe],
        ['Срок', lastRoute.urgency],
        ['Салон', `${lastRoute.salon.title} — ${lastRoute.salon.time}`]
      ].map(([label, value]) => `<div class="route-result-item"><span>${label}</span><strong>${value}</strong></div>`).join('');
    }

    if (routePlan) {
      const warning = lastRoute.warning
        ? `<div class="route-warning"><strong>Важно по сроку:</strong><p>${lastRoute.warning}</p></div>`
        : '';

      const recommendation = lastRoute.salon.autoPicked && lastRoute.note
        ? `<div class="route-recommendation"><strong>Рекомендация салона</strong><p>${lastRoute.note}</p></div>`
        : '';

      routePlan.innerHTML = `
        ${warning}
        ${recommendation}
        <div class="route-next-steps">
          <strong>${state.purpose === 'pickup' ? 'Как забрать готовый заказ:' : 'Что будет после заявки:'}</strong>
          <ol>${lastRoute.next.map((item) => `<li>${item}</li>`).join('')}</ol>
        </div>
        <div class="route-next-steps">
          <strong>План визита:</strong>
          <ol>${lastRoute.plan.map((item) => `<li>${item}</li>`).join('')}</ol>
        </div>
        <p><strong>Ориентир:</strong> ${lastRoute.salon.address}. <strong>Режим:</strong> ${lastRoute.salon.hours}.</p>
      `;
    }

    if (routeForm) {
      routeForm.hidden = state.purpose === 'pickup';
    }
    if (result) result.hidden = false;
  }

  widget.addEventListener('click', (event) => {
    const button = event.target.closest('.route-option');
    if (!button || !widget.contains(button)) return;

    const step = button.dataset.step;
    if (!steps.includes(step)) return;

    state[step] = button.dataset.value || '';
    state.labels[step] = button.dataset.label || button.textContent.trim();

    widget.querySelectorAll(`.route-option[data-step="${step}"]`).forEach((item) => {
      item.classList.remove('is-active');
      item.setAttribute('aria-pressed', 'false');
    });

    button.classList.add('is-active');
    button.setAttribute('aria-pressed', 'true');
    renderRoute();

    const nextStep = steps[steps.indexOf(step) + 1];
    const nextBlock = nextStep ? widget.querySelector(`[data-route-step="${nextStep}"]`) : result;
    if (nextBlock) nextBlock.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });

  if (routePhone) {
    routePhone.addEventListener('input', () => {
      routePhone.value = formatPhoneMask(routePhone.value);
    });
    routePhone.addEventListener('focus', () => {
      if (!routePhone.value) routePhone.value = '+7';
    });
  }

  function buildRouteMessage(route) {
    const lines = [
      'Подбор визита на сайте',
      '',
      'Что выбрал клиент:',
      `• Задача: ${route.purpose}`,
      `• Рецепт: ${route.recipe}`,
      `• Срок: ${route.urgency}`,
      `• Салон: ${route.salon.title}`
    ];

    if (route.warning) {
      lines.push('', `Важно: ${route.warning}`);
    }

    return lines.join('\n');
  }

  function fillOrdinaryForm(route) {
    const opticalRoute = qs('#optical-route');
    if (opticalRoute) opticalRoute.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }


  if (routeForm) {
    routeForm.addEventListener('submit', async (event) => {
      event.preventDefault();

      if (!lastRoute) {
        if (routeStatus) routeStatus.textContent = 'Сначала выберите ответы на 4 вопроса.';
        return;
      }

      if (state.purpose === 'pickup') {
        if (routeStatus) routeStatus.textContent = 'Для получения готового заказа заявка не нужна. Приезжайте после подтверждения готовности заказа.';
        return;
      }

      const name = routeName ? routeName.value.trim() : '';
      const phone = routePhone ? routePhone.value.trim() : '';

      if (!name || !phone) {
        if (routeStatus) routeStatus.textContent = 'Укажите имя и телефон, чтобы мы могли связаться и записать вас.';
        return;
      }

      const formData = {
        type: 'optical-route',
        name,
        phone,
        service: 'Подбор визита',
        recipe: lastRoute.recipe,
        message: buildRouteMessage(lastRoute),
        productId: '',
        productTitle: 'Подбор визита',
        page: window.location.pathname + '#optical-route',
        source: 'site-optical-route',
        utmSource: getUtm('utm_source'),
        utmMedium: getUtm('utm_medium'),
        utmCampaign: getUtm('utm_campaign')
      };

      if (routeStatus) routeStatus.textContent = 'Отправляем заявку...';

      try {
        const result = await sendLeadToCrm(formData);
        const crmNumber = result?.lead?.leadNumber || '';

        if (routeStatus) {
          routeStatus.textContent = crmNumber
            ? `Вы оформили заявку №${crmNumber}. Сотрудник салона свяжется с вами и подтвердит время визита.`
            : 'Вы оформили заявку. Сотрудник салона свяжется с вами и подтвердит время визита.';
        }

        showLeadSuccessModal({
          title: crmNumber ? `Вы оформили заявку №${crmNumber}` : 'Вы оформили заявку',
          text: 'Спасибо! Заявка получена. Сотрудник салона свяжется с вами, уточнит детали и подтвердит удобное время визита.',
          note: crmNumber ? `Сохраните номер заявки №${crmNumber}. По нему можно проверить статус на сайте.` : `Пожалуйста, приезжайте после подтверждения времени. Выбранный салон: ${lastRoute.salon.title}.`
        });

        routeForm.reset();
        return;
      } catch (error) {
        try {
          const saved = JSON.parse(localStorage.getItem('sibir-optika-route-leads') || '[]');
          saved.push({ ...formData, createdAt: new Date().toISOString() });
          localStorage.setItem('sibir-optika-route-leads', JSON.stringify(saved));
        } catch (e) {}
        if (routeStatus) routeStatus.textContent = 'Сейчас не удалось отправить заявку. Попробуйте обычную форму или позвоните в салон.';
      }
    });
  }

  updateProgress();
}

function initReviewsCarousel() {
  const carousel = qs('[data-reviews-carousel]');
  if (!carousel) return;

  const track = carousel.querySelector('[data-reviews-track]');
  const prev = carousel.querySelector('[data-reviews-prev]');
  const next = carousel.querySelector('[data-reviews-next]');
  if (!track) return;

  function getStep() {
    const card = track.querySelector('.review-card');
    if (!card) return 340;
    const styles = window.getComputedStyle(track);
    const gap = parseInt(styles.columnGap || styles.gap || '18', 10);
    return card.getBoundingClientRect().width + gap;
  }

  prev?.addEventListener('click', () => {
    track.scrollBy({ left: -getStep(), behavior: 'smooth' });
  });

  next?.addEventListener('click', () => {
    track.scrollBy({ left: getStep(), behavior: 'smooth' });
  });
}


function initVideoPlaceholders() {
  document.querySelectorAll('[data-video-placeholder]').forEach((button) => {
    button.addEventListener('click', () => {
      if (typeof showToast === 'function') showToast('Видео скоро появится', 'Сюда можно будет добавить ролик о HOYA, NeoLook, Nikon и сложных очковых линзах.', 'info');
    });
  });
}

function initLeadStatusChecker() {
  const form = qs('#leadStatusForm');
  if (!form) return;

  const numberInput = qs('#leadStatusNumber');
  const phoneInput = qs('#leadStatusPhone');
  const result = qs('#leadStatusResult');

  function onlyDigits(value, limit = 20) {
    return String(value || '').replace(/\D/g, '').slice(0, limit);
  }

  numberInput?.addEventListener('input', () => {
    numberInput.value = onlyDigits(numberInput.value, 8);
  });

  phoneInput?.addEventListener('input', () => {
    phoneInput.value = onlyDigits(phoneInput.value, 4);
  });

  function renderStatus(data) {
    const lead = data.lead || {};
    const meta = [
      lead.service ? `Что нужно: ${lead.service}` : '',
      lead.salon ? `Салон: ${lead.salon}` : '',
      lead.updatedAt ? `Обновлено: ${new Date(lead.updatedAt).toLocaleString('ru-RU')}` : ''
    ].filter(Boolean);

    result.hidden = false;
    result.classList.remove('is-error');
    result.innerHTML = `
      <h3>Заявка №${lead.leadNumber}</h3>
      <p><strong>${lead.statusTitle}</strong></p>
      <p>${lead.statusText}</p>
      ${meta.length ? `<div class="lead-status-meta">${meta.map((item) => `<span>${item}</span>`).join('')}</div>` : ''}
    `;
  }

  function renderError(message) {
    result.hidden = false;
    result.classList.add('is-error');
    result.innerHTML = `
      <h3>Заявка не найдена</h3>
      <p>${message}</p>
    `;
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const number = onlyDigits(numberInput?.value, 8);
    const phoneLast4 = onlyDigits(phoneInput?.value, 4);

    if (number.length < 3 || phoneLast4.length !== 4) {
      renderError('Проверьте номер заявки и последние 4 цифры телефона.');
      return;
    }

    result.hidden = false;
    result.classList.remove('is-error');
    result.innerHTML = '<p>Проверяем статус заявки...</p>';

    try {
      const response = await fetch(`/api/lead-status?number=${encodeURIComponent(number)}&phoneLast4=${encodeURIComponent(phoneLast4)}`);
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Не удалось найти заявку. Проверьте номер и телефон.');
      }
      renderStatus(data);
    } catch (error) {
      renderError(error.message || 'Не удалось проверить заявку. Попробуйте позже или свяжитесь с салоном.');
    }
  });
}


async function bootstrap() {
  await loadPublicSettings();
  applyConfig();
  initDisabledLinks();
  await loadPublicProducts();
  initPhoneMask();
  initMobileMenu();
  initCatalogSearch();
  initSectionGrids();
  initForm();
  initOpticalRoute();
  initReviewsCarousel();
  initVideoPlaceholders();
  initLeadStatusChecker();
  window.addEventListener('focus', () => {
    refreshPublicSettings();
    refreshPublicProducts();
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      refreshPublicSettings();
      refreshPublicProducts();
    }
  });
  setInterval(refreshPublicSettings, 10000);
  setInterval(refreshPublicProducts, 10000);
}

bootstrap();
