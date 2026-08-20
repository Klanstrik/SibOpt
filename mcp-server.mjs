import dotenv from "dotenv";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import pg from "pg";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "data");
const PUBLIC_DIR = path.join(__dirname, "public");

const DATABASE_URL = process.env.DATABASE_URL || "";
const DATABASE_SSL = String(process.env.DATABASE_SSL || "").toLowerCase() === "true";
const EXPOSE_PERSONAL_DATA = String(process.env.MCP_EXPOSE_PERSONAL_DATA || "false").toLowerCase() === "true";

const CLOSED_LEAD_STATUSES = new Set(["completed", "bought", "no_show", "no_answer", "refused", "cancelled"]);

let pool = null;
let postgresState = {
  checked: false,
  connected: false,
  error: ""
};

const server = new McpServer({
  name: "sibir-optika-dev-mcp",
  version: "1.1.0"
});

function toText(value) {
  if (value === null || value === undefined) return "";
  return String(value);
}

function normalizeText(value) {
  return toText(value).toLowerCase().trim();
}

function toIso(value) {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString();
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asJsonArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      return [];
    }
  }
  return [];
}

function maskPhone(phone) {
  const raw = toText(phone);
  if (!raw) return "";
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 5) return "***";
  return `${digits.slice(0, 2)}***${digits.slice(-2)}`;
}

function maskName(name) {
  const raw = toText(name).trim();
  if (!raw) return "";
  return `${raw.slice(0, 1)}***`;
}

function jsonResponse(value) {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(value, null, 2)
      }
    ]
  };
}

async function readJson(fileName, fallback) {
  try {
    const filePath = path.join(DATA_DIR, fileName);
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw || "null") ?? fallback;
  } catch (error) {
    return fallback;
  }
}

async function getPool() {
  if (!DATABASE_URL) return null;
  if (!pool) {
    pool = new pg.Pool({
      connectionString: DATABASE_URL,
      ssl: DATABASE_SSL ? { rejectUnauthorized: false } : false,
      max: 3,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 2_000
    });
  }
  return pool;
}

async function checkPostgres() {
  if (postgresState.checked) return postgresState;
  postgresState.checked = true;

  if (!DATABASE_URL) {
    postgresState.connected = false;
    postgresState.error = "DATABASE_URL is not configured";
    return postgresState;
  }

  try {
    const db = await getPool();
    await db.query("select 1");
    postgresState.connected = true;
    postgresState.error = "";
  } catch (error) {
    postgresState.connected = false;
    postgresState.error = error?.message || String(error);
  }

  return postgresState;
}

async function tableExists(tableName) {
  const db = await getPool();
  const result = await db.query("select to_regclass($1) as name", [`public.${tableName}`]);
  return Boolean(result.rows[0]?.name);
}

async function columnExists(tableName, columnName) {
  const db = await getPool();
  const result = await db.query(
    `
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = $1
        and column_name = $2
      limit 1
    `,
    [tableName, columnName]
  );
  return result.rowCount > 0;
}

async function canUsePostgresTables() {
  const state = await checkPostgres();
  if (!state.connected) return false;
  try {
    return (await tableExists("leads")) || (await tableExists("products")) || (await tableExists("settings"));
  } catch (error) {
    postgresState.connected = false;
    postgresState.error = error?.message || String(error);
    return false;
  }
}

function rowToLead(row) {
  if (row.data && typeof row.data === "object") {
    const data = row.data;
    return {
      ...data,
      id: row.id || data.id || "",
      createdAt: toIso(row.created_at) || data.createdAt || "",
      updatedAt: toIso(row.updated_at) || data.updatedAt || "",
      deletedAt: toIso(row.deleted_at) || data.deletedAt || ""
    };
  }

  return {
    id: row.id || "",
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
    deletedAt: toIso(row.deleted_at) || undefined,
    type: row.type || "appointment",
    status: row.status || "new",
    name: row.name || "",
    phone: row.phone || "",
    service: row.service || "",
    recipe: row.recipe || "",
    message: row.message || "",
    productId: row.product_id || "",
    productTitle: row.product_title || "",
    page: row.page || "",
    source: row.source || "site",
    utmSource: row.utm_source || "",
    utmMedium: row.utm_medium || "",
    utmCampaign: row.utm_campaign || "",
    adminNote: row.admin_note || "",
    assignedTo: row.assigned_to || "",
    history: asJsonArray(row.history)
  };
}

function rowToProduct(row) {
  if (row.data && typeof row.data === "object") {
    const data = row.data;
    return {
      ...data,
      id: row.id || data.id || "",
      active: row.active ?? data.active ?? false,
      sort: Number(row.sort ?? data.sort ?? 0),
      createdAt: toIso(row.created_at) || data.createdAt || "",
      updatedAt: toIso(row.updated_at) || data.updatedAt || ""
    };
  }

  return {
    id: row.id || "",
    section: row.section || "",
    title: row.title || "",
    category: row.category || "",
    brand: row.brand || "",
    type: row.type || "",
    shape: row.shape || "",
    price: row.price || "",
    availability: row.availability || "",
    badge: row.badge || "",
    description: row.description || "",
    tags: asJsonArray(row.tags),
    visual: row.visual || "frame",
    leadService: row.lead_service || "",
    image: row.image || "",
    gradient: row.gradient || "",
    active: row.active === true,
    sort: Number(row.sort || 0),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at)
  };
}

async function readLeads() {
  if (await canUsePostgresTables()) {
    const db = await getPool();
    if (await tableExists("leads")) {
      const hasDataColumn = await columnExists("leads", "data");
      const hasReadableColumns = await columnExists("leads", "name");
      const query = hasDataColumn && !hasReadableColumns
        ? "select id, data, created_at, updated_at, deleted_at from leads order by created_at desc nulls last, id desc"
        : "select * from leads order by created_at desc nulls last, id desc";
      const result = await db.query(query);
      return { storage: "postgres", data: result.rows.map(rowToLead) };
    }
  }
  return { storage: "json-files", data: asArray(await readJson("leads.json", [])) };
}

async function readProducts() {
  if (await canUsePostgresTables()) {
    const db = await getPool();
    if (await tableExists("products")) {
      const hasDataColumn = await columnExists("products", "data");
      const hasReadableColumns = await columnExists("products", "title");
      const query = hasDataColumn && !hasReadableColumns
        ? "select id, data, active, sort, created_at, updated_at from products order by sort asc nulls last, id asc"
        : "select * from products order by sort asc nulls last, id asc";
      const result = await db.query(query);
      return { storage: "postgres", data: result.rows.map(rowToProduct) };
    }
  }
  return { storage: "json-files", data: asArray(await readJson("products.json", [])) };
}

async function readSettings() {
  if (await canUsePostgresTables()) {
    const db = await getPool();
    if (await tableExists("settings")) {
      const result = await db.query("select data from settings where id = 1");
      return { storage: "postgres", data: result.rows[0]?.data || {} };
    }
  }
  const settings = await readJson("settings.json", {});
  return { storage: "json-files", data: settings && typeof settings === "object" && !Array.isArray(settings) ? settings : {} };
}

function safeLead(lead, includeSensitive = false) {
  const canShowSensitive = includeSensitive && EXPOSE_PERSONAL_DATA;

  return {
    id: lead.id || "",
    createdAt: lead.createdAt || "",
    updatedAt: lead.updatedAt || "",
    deletedAt: lead.deletedAt || "",
    type: lead.type || "",
    status: lead.status || "",
    name: canShowSensitive ? lead.name || "" : maskName(lead.name),
    phone: canShowSensitive ? lead.phone || "" : maskPhone(lead.phone),
    service: lead.service || "",
    recipe: lead.recipe || "",
    message: canShowSensitive ? lead.message || "" : lead.message ? "скрыто" : "",
    productId: lead.productId || "",
    productTitle: lead.productTitle || "",
    page: lead.page || "",
    source: lead.source || "",
    utmSource: lead.utmSource || "",
    utmMedium: lead.utmMedium || "",
    utmCampaign: lead.utmCampaign || "",
    adminNote: canShowSensitive ? lead.adminNote || "" : lead.adminNote ? "скрыто" : "",
    assignedTo: lead.assignedTo || "",
    historyCount: Array.isArray(lead.history) ? lead.history.length : 0,
    personalDataMasked: !canShowSensitive
  };
}

function publicProduct(product) {
  return {
    id: product.id || "",
    section: product.section || "",
    title: product.title || "",
    category: product.category || "",
    brand: product.brand || "",
    type: product.type || "",
    shape: product.shape || "",
    price: product.price || "",
    availability: product.availability || "",
    badge: product.badge || "",
    description: product.description || "",
    tags: Array.isArray(product.tags) ? product.tags : [],
    visual: product.visual || "",
    leadService: product.leadService || "",
    image: product.image || "",
    gradient: product.gradient || "",
    active: Boolean(product.active),
    sort: Number(product.sort || 0),
    createdAt: product.createdAt || "",
    updatedAt: product.updatedAt || ""
  };
}

function extractTag(html, regex) {
  const match = html.match(regex);
  return match ? match[1].replace(/\s+/g, " ").trim() : "";
}

async function listHtmlFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".html"))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b, "ru"));
}

function groupCount(items, fieldName, fallback = "unknown") {
  const map = {};
  for (const item of items) {
    const key = item[fieldName] || fallback;
    map[key] = (map[key] || 0) + 1;
  }
  return map;
}

server.registerTool(
  "get_mcp_status",
  {
    description: "Проверить подключение MCP к проекту: PostgreSQL, JSON fallback, режим персональных данных и доступные директории.",
    inputSchema: {}
  },
  async () => {
    const state = await checkPostgres();
    const canUsePg = await canUsePostgresTables();
    return jsonResponse({
      project: "Сибирь-Оптика",
      mcpServer: "sibir-optika-dev-mcp",
      version: "1.1.0",
      mode: "read-only",
      databaseUrlConfigured: Boolean(DATABASE_URL),
      postgresConnected: state.connected,
      postgresError: state.error || undefined,
      activeStorage: canUsePg ? "postgres" : "json-files",
      personalDataExposed: EXPOSE_PERSONAL_DATA,
      paths: {
        projectRoot: __dirname,
        dataDir: DATA_DIR,
        publicDir: PUBLIC_DIR
      },
      tools: [
        "get_mcp_status",
        "get_project_summary",
        "get_crm_summary",
        "list_leads",
        "search_products",
        "get_business_settings",
        "search_seo_pages",
        "audit_seo_pages",
        "audit_data_quality",
        "get_sales_report"
      ]
    });
  }
);

server.registerTool(
  "get_project_summary",
  {
    description: "Кратко описать проект Сибирь-Оптика для разработки, собеседования или резюме.",
    inputSchema: {}
  },
  async () => {
    const leadsResult = await readLeads();
    const productsResult = await readProducts();
    const settingsResult = await readSettings();
    const htmlFiles = await listHtmlFiles(PUBLIC_DIR).catch(() => []);

    return jsonResponse({
      project: "Сибирь-Оптика",
      stack: ["Node.js", "HTTP server", "HTML/CSS/JS", "CRM", "PostgreSQL", "JSON fallback", "MCP"],
      storage: {
        leads: leadsResult.storage,
        products: productsResult.storage,
        settings: settingsResult.storage
      },
      modules: {
        publicWebsite: true,
        crm: true,
        productCatalog: true,
        seoPages: htmlFiles.length,
        postgresSupport: Boolean(DATABASE_URL),
        mcpReadOnlyServer: true
      },
      counts: {
        leads: leadsResult.data.length,
        products: productsResult.data.length,
        activeProducts: productsResult.data.filter((product) => product.active === true).length,
        htmlPages: htmlFiles.length
      },
      resumeText: "Добавил к проекту read-only MCP-сервер на Node.js для интеграции с AI-инструментами: сервер читает CRM-заявки, каталог, настройки и SEO-страницы из PostgreSQL через DATABASE_URL с fallback на JSON-файлы, маскирует персональные данные и не изменяет боевые данные."
    });
  }
);

server.registerTool(
  "get_crm_summary",
  {
    description: "Сводка по CRM Сибирь-Оптика: заявки, товары, статусы, настройки без персональных данных.",
    inputSchema: {}
  },
  async () => {
    const leadsResult = await readLeads();
    const productsResult = await readProducts();
    const settingsResult = await readSettings();

    const leads = leadsResult.data.filter((lead) => !lead.deletedAt);
    const products = productsResult.data;
    const settings = settingsResult.data;

    const brands = groupCount(products, "brand");
    const categories = groupCount(products, "category");

    return jsonResponse({
      storage: {
        leads: leadsResult.storage,
        products: productsResult.storage,
        settings: settingsResult.storage
      },
      leadsTotal: leads.length,
      leadStatuses: groupCount(leads, "status"),
      leadTypes: groupCount(leads, "type"),
      activeLeads: leads.filter((lead) => !CLOSED_LEAD_STATUSES.has(lead.status || "new")).length,
      closedLeads: leads.filter((lead) => CLOSED_LEAD_STATUSES.has(lead.status || "new")).length,
      productsTotal: products.length,
      activeProducts: products.filter((product) => product.active === true).length,
      inactiveProducts: products.filter((product) => product.active !== true).length,
      productCategories: categories,
      topBrands: Object.entries(brands)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 15)
        .map(([brand, count]) => ({ brand, count })),
      business: {
        businessName: settings.businessName || "",
        address: settings.address || "",
        phone: settings.phone || "",
        workTime: settings.workTime || "",
        publicEmail: settings.publicEmail || "",
        salonOneName: settings.salonOneName || "",
        salonOneAddress: settings.salonOneAddress || "",
        salonTwoName: settings.salonTwoName || "",
        salonTwoAddress: settings.salonTwoAddress || ""
      }
    });
  }
);

server.registerTool(
  "list_leads",
  {
    description: "Показать заявки из CRM. Читает PostgreSQL через DATABASE_URL, при недоступности БД использует JSON. По умолчанию персональные данные маскируются.",
    inputSchema: {
      status: z.string().optional().describe("Фильтр по статусу заявки, например new, in_progress, bought"),
      type: z.string().optional().describe("Фильтр по типу заявки, например appointment"),
      includeDeleted: z.boolean().optional().describe("Показывать удалённые заявки"),
      limit: z.number().int().min(1).max(50).optional().describe("Сколько заявок вернуть, максимум 50"),
      includeSensitive: z.boolean().optional().describe("Показать имена, телефоны и сообщения только если MCP_EXPOSE_PERSONAL_DATA=true")
    }
  },
  async ({ status, type, includeDeleted = false, limit = 10, includeSensitive = false }) => {
    const leadsResult = await readLeads();

    let result = leadsResult.data;
    if (!includeDeleted) result = result.filter((lead) => !lead.deletedAt);
    if (status) result = result.filter((lead) => lead.status === status);
    if (type) result = result.filter((lead) => lead.type === type);

    result = result
      .slice()
      .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime())
      .slice(0, limit)
      .map((lead) => safeLead(lead, includeSensitive));

    return jsonResponse({
      storage: leadsResult.storage,
      count: result.length,
      personalDataExposed: includeSensitive && EXPOSE_PERSONAL_DATA,
      note: includeSensitive && !EXPOSE_PERSONAL_DATA ? "Персональные данные скрыты. Для показа нужно запустить MCP с MCP_EXPOSE_PERSONAL_DATA=true." : undefined,
      leads: result
    });
  }
);

server.registerTool(
  "search_products",
  {
    description: "Найти товары в каталоге по названию, бренду, категории, типу, описанию или тегам. Читает PostgreSQL или JSON fallback.",
    inputSchema: {
      query: z.string().optional().describe("Поисковая строка, например Ray-Ban, линзы, оправа"),
      active: z.enum(["all", "active", "inactive"]).optional().describe("Фильтр активности товара"),
      limit: z.number().int().min(1).max(50).optional().describe("Сколько товаров вернуть, максимум 50")
    }
  },
  async ({ query = "", active = "all", limit = 10 }) => {
    const productsResult = await readProducts();
    const q = normalizeText(query);

    let result = productsResult.data;
    if (active === "active") result = result.filter((product) => product.active === true);
    if (active === "inactive") result = result.filter((product) => product.active !== true);

    if (q) {
      result = result.filter((product) => {
        const haystack = [
          product.id,
          product.section,
          product.title,
          product.category,
          product.brand,
          product.type,
          product.shape,
          product.description,
          Array.isArray(product.tags) ? product.tags.join(" ") : ""
        ]
          .map(normalizeText)
          .join(" ");
        return haystack.includes(q);
      });
    }

    result = result
      .slice()
      .sort((a, b) => Number(a.sort || 0) - Number(b.sort || 0))
      .slice(0, limit)
      .map(publicProduct);

    return jsonResponse({
      storage: productsResult.storage,
      count: result.length,
      query,
      active,
      products: result
    });
  }
);

server.registerTool(
  "get_business_settings",
  {
    description: "Получить публичные настройки бизнеса: адреса, график, телефоны, салоны. Служебные поля скрываются.",
    inputSchema: {}
  },
  async () => {
    const settingsResult = await readSettings();
    const settings = settingsResult.data;

    return jsonResponse({
      storage: settingsResult.storage,
      businessName: settings.businessName || "",
      address: settings.address || "",
      phone: settings.phone || "",
      workTime: settings.workTime || "",
      bookingHoldHours: settings.bookingHoldHours || "",
      reservationText: settings.reservationText || "",
      publicEmail: settings.publicEmail || "",
      whatsappPhone: settings.whatsappPhone || "",
      telegramUrl: settings.telegramUrl || "",
      yandexMapUrl: settings.yandexMapUrl || "",
      gisUrl: settings.gisUrl || "",
      salonOneName: settings.salonOneName || "",
      salonOneAddress: settings.salonOneAddress || "",
      salonOneYandexMapUrl: settings.salonOneYandexMapUrl || "",
      salonOneGisUrl: settings.salonOneGisUrl || "",
      salonOneRouteUrl: settings.salonOneRouteUrl || "",
      salonTwoName: settings.salonTwoName || "",
      salonTwoAddress: settings.salonTwoAddress || "",
      salonTwoYandexMapUrl: settings.salonTwoYandexMapUrl || "",
      salonTwoGisUrl: settings.salonTwoGisUrl || "",
      salonTwoRouteUrl: settings.salonTwoRouteUrl || ""
    });
  }
);

server.registerTool(
  "get_sales_report",
  {
    description: "CRM-отчёт по заявкам и закрытым сделкам за период. Без раскрытия персональных данных.",
    inputSchema: {
      dateFrom: z.string().optional().describe("Дата начала YYYY-MM-DD"),
      dateTo: z.string().optional().describe("Дата конца YYYY-MM-DD"),
      assignedTo: z.string().optional().describe("Фильтр по менеджеру/ответственному")
    }
  },
  async ({ dateFrom, dateTo, assignedTo }) => {
    const leadsResult = await readLeads();
    let leads = leadsResult.data.filter((lead) => !lead.deletedAt);

    if (dateFrom) leads = leads.filter((lead) => String(lead.createdAt || "") >= dateFrom);
    if (dateTo) leads = leads.filter((lead) => String(lead.createdAt || "") <= `${dateTo}T23:59:59.999Z`);
    if (assignedTo) leads = leads.filter((lead) => normalizeText(lead.assignedTo) === normalizeText(assignedTo));

    const closed = leads.filter((lead) => CLOSED_LEAD_STATUSES.has(lead.status || "new"));
    const active = leads.filter((lead) => !CLOSED_LEAD_STATUSES.has(lead.status || "new"));
    const byStatus = groupCount(leads, "status");
    const bySource = groupCount(leads, "source");
    const byService = groupCount(leads, "service");
    const byAssignedTo = groupCount(leads, "assignedTo", "not_assigned");

    return jsonResponse({
      storage: leadsResult.storage,
      filters: { dateFrom: dateFrom || "", dateTo: dateTo || "", assignedTo: assignedTo || "" },
      total: leads.length,
      active: active.length,
      closed: closed.length,
      conversionPercent: leads.length ? Number(((closed.length / leads.length) * 100).toFixed(2)) : 0,
      byStatus,
      bySource,
      byService,
      byAssignedTo
    });
  }
);

server.registerTool(
  "audit_data_quality",
  {
    description: "Проверить качество данных CRM, каталога и настроек: пустые контакты, незаполненные поля товаров, тестовые заявки.",
    inputSchema: {}
  },
  async () => {
    const leadsResult = await readLeads();
    const productsResult = await readProducts();
    const settingsResult = await readSettings();

    const leads = leadsResult.data;
    const products = productsResult.data;
    const settings = settingsResult.data;

    const importantSettings = [
      "businessName",
      "phone",
      "publicEmail",
      "whatsappPhone",
      "telegramUrl",
      "salonOneAddress",
      "salonOneYandexMapUrl",
      "salonOneGisUrl",
      "salonTwoAddress",
      "salonTwoYandexMapUrl",
      "salonTwoGisUrl"
    ];

    const emptySettings = importantSettings.filter((field) => !toText(settings[field]).trim());
    const productsWithoutImage = products.filter((product) => !toText(product.image).trim()).map((product) => product.id || product.title).slice(0, 50);
    const productsWithoutDescription = products.filter((product) => !toText(product.description).trim()).map((product) => product.id || product.title).slice(0, 50);
    const likelyTestLeads = leads
      .filter((lead) => /test|тест|йцук|asdf|qwer|фыв/i.test(`${lead.name || ""} ${lead.phone || ""} ${lead.message || ""}`))
      .map((lead) => safeLead(lead, false))
      .slice(0, 20);

    return jsonResponse({
      storage: {
        leads: leadsResult.storage,
        products: productsResult.storage,
        settings: settingsResult.storage
      },
      emptyImportantSettings: emptySettings,
      productsWithoutImageCount: products.filter((product) => !toText(product.image).trim()).length,
      productsWithoutImage,
      productsWithoutDescriptionCount: products.filter((product) => !toText(product.description).trim()).length,
      productsWithoutDescription,
      inactiveProductsCount: products.filter((product) => product.active !== true).length,
      likelyTestLeadsCount: likelyTestLeads.length,
      likelyTestLeads
    });
  }
);

server.registerTool(
  "search_seo_pages",
  {
    description: "Найти SEO-страницы сайта по имени файла, title, description или h1.",
    inputSchema: {
      query: z.string().min(1).describe("Что искать: бренд, услуга, ключевое слово или часть URL"),
      limit: z.number().int().min(1).max(50).optional().describe("Сколько страниц вернуть, максимум 50")
    }
  },
  async ({ query, limit = 10 }) => {
    const q = normalizeText(query);
    const files = await listHtmlFiles(PUBLIC_DIR);
    const pages = [];

    for (const file of files) {
      const html = await fs.readFile(path.join(PUBLIC_DIR, file), "utf8");
      const title = extractTag(html, /<title[^>]*>([\s\S]*?)<\/title>/i);
      const description = extractTag(html, /<meta[^>]+name=["']description["'][^>]+content=["']([\s\S]*?)["'][^>]*>/i);
      const h1 = extractTag(html, /<h1[^>]*>([\s\S]*?)<\/h1>/i).replace(/<[^>]+>/g, "").trim();
      const haystack = normalizeText(`${file} ${title} ${description} ${h1}`);

      if (haystack.includes(q)) {
        pages.push({ file, url: `/${file}`, title, description, h1 });
      }

      if (pages.length >= limit) break;
    }

    return jsonResponse({ count: pages.length, query, pages });
  }
);

server.registerTool(
  "audit_seo_pages",
  {
    description: "Проверить HTML-страницы на базовые SEO-проблемы: title, description, h1, canonical, OpenGraph, JSON-LD, FAQ Schema.",
    inputSchema: {
      limit: z.number().int().min(1).max(200).optional().describe("Сколько проблемных страниц вернуть, максимум 200")
    }
  },
  async ({ limit = 50 }) => {
    const files = await listHtmlFiles(PUBLIC_DIR);
    const problems = [];
    const titleMap = new Map();
    const descriptionMap = new Map();
    let pagesWithFaqSchema = 0;
    let pagesWithBreadcrumbSchema = 0;
    let pagesWithOpenGraph = 0;

    for (const file of files) {
      const html = await fs.readFile(path.join(PUBLIC_DIR, file), "utf8");
      const title = extractTag(html, /<title[^>]*>([\s\S]*?)<\/title>/i);
      const description = extractTag(html, /<meta[^>]+name=["']description["'][^>]+content=["']([\s\S]*?)["'][^>]*>/i);
      const h1 = extractTag(html, /<h1[^>]*>([\s\S]*?)<\/h1>/i).replace(/<[^>]+>/g, "").trim();
      const canonical = extractTag(html, /<link[^>]+rel=["']canonical["'][^>]+href=["']([\s\S]*?)["'][^>]*>/i);
      const hasOpenGraph = /property=["']og:title["']/i.test(html) && /property=["']og:description["']/i.test(html);
      const hasJsonLd = /application\/ld\+json/i.test(html);
      const hasFaqSchema = /"@type"\s*:\s*"FAQPage"/i.test(html);
      const hasBreadcrumbSchema = /"@type"\s*:\s*"BreadcrumbList"/i.test(html);
      const issues = [];

      if (hasFaqSchema) pagesWithFaqSchema += 1;
      if (hasBreadcrumbSchema) pagesWithBreadcrumbSchema += 1;
      if (hasOpenGraph) pagesWithOpenGraph += 1;

      if (!title) issues.push("missing_title");
      if (title && title.length < 25) issues.push("short_title");
      if (title && title.length > 75) issues.push("long_title");
      if (!description) issues.push("missing_description");
      if (description && description.length < 70) issues.push("short_description");
      if (description && description.length > 190) issues.push("long_description");
      if (!h1) issues.push("missing_h1");
      if (!canonical) issues.push("missing_canonical");
      if (!hasOpenGraph) issues.push("missing_opengraph");
      if (!hasJsonLd) issues.push("missing_json_ld");

      if (title) titleMap.set(title, [...(titleMap.get(title) || []), file]);
      if (description) descriptionMap.set(description, [...(descriptionMap.get(description) || []), file]);

      if (issues.length) {
        problems.push({ file, url: `/${file}`, issues, titleLength: title.length, descriptionLength: description.length, h1 });
      }
    }

    const duplicateTitles = Array.from(titleMap.entries())
      .filter(([, value]) => value.length > 1)
      .map(([title, filesWithTitle]) => ({ title, files: filesWithTitle.slice(0, 10), count: filesWithTitle.length }));

    const duplicateDescriptions = Array.from(descriptionMap.entries())
      .filter(([, value]) => value.length > 1)
      .map(([description, filesWithDescription]) => ({ description, files: filesWithDescription.slice(0, 10), count: filesWithDescription.length }));

    return jsonResponse({
      checkedFiles: files.length,
      pagesWithOpenGraph,
      pagesWithFaqSchema,
      pagesWithBreadcrumbSchema,
      problemPagesReturned: Math.min(problems.length, limit),
      totalProblemPages: problems.length,
      problems: problems.slice(0, limit),
      duplicateTitles: duplicateTitles.slice(0, 20),
      duplicateDescriptions: duplicateDescriptions.slice(0, 20)
    });
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Sibir Optika read-only development MCP server is running on stdio");
}

main().catch((error) => {
  console.error("Fatal MCP error:", error);
  process.exit(1);
});
