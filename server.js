const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');
const { URL } = require('url');

try {
  require('dotenv').config();
} catch (error) {}

const PORT = Number(process.env.PORT || 3000);
const SITE_URL = String(process.env.SITE_URL || 'https://sibir-optika.ru').replace(/\/$/, '');
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const STAFF_PASSWORD = process.env.STAFF_PASSWORD || '';

const CRM_ROLES = {
  admin: { title: 'Администратор', password: ADMIN_PASSWORD, permissions: ['dashboard', 'leads:read', 'leads:update', 'leads:delete', 'products', 'settings', 'reports'] },
  staff: { title: 'Сотрудник', password: STAFF_PASSWORD, permissions: ['dashboard', 'leads:read', 'leads:update', 'reports'] }
};
const DATABASE_URL = process.env.DATABASE_URL || '';
const DATABASE_SSL = String(process.env.DATABASE_SSL || '').toLowerCase() === 'true';
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = path.join(__dirname, 'data');
const MAX_BODY_SIZE = 1024 * 1024;
const MAX_UPLOAD_SIZE = 5 * 1024 * 1024;
const UPLOAD_PRODUCTS_DIR = path.join(PUBLIC_DIR, 'uploads', 'products');
const SESSION_TTL = 1000 * 60 * 60 * 12;
const CLOSED_LEAD_STATUSES = new Set(['completed', 'bought', 'no_show', 'no_answer', 'refused', 'cancelled']);

const sessions = new Map();

let pool = null;
let storageMode = 'json';

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

function ensureDataFiles() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  for (const item of [
    ['leads.json', []],
    ['products.json', []],
    ['settings.json', {}]
  ]) {
    const filePath = path.join(DATA_DIR, item[0]);
    if (!fs.existsSync(filePath)) writeJsonFile(item[0], item[1]);
  }
}

function readJsonFile(fileName) {
  ensureDataFiles();
  const filePath = path.join(DATA_DIR, fileName);
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw || 'null');
  } catch (error) {
    return fileName === 'settings.json' ? {} : [];
  }
}

function writeJsonFile(fileName, value) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  const filePath = path.join(DATA_DIR, fileName);
  const tempPath = `${filePath}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(value, null, 2), 'utf8');
  fs.renameSync(tempPath, filePath);
}

function normalizeJsonDate(value) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function toIso(value) {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString();
}

function asJsonArray(value) {
  return Array.isArray(value) ? value : [];
}

async function initPostgres() {
  let pg;
  try {
    pg = require('pg');
  } catch (error) {
    throw new Error('Пакет pg не установлен. Выполните npm install.');
  }

  pool = new pg.Pool({
    connectionString: DATABASE_URL,
    ssl: DATABASE_SSL ? { rejectUnauthorized: false } : false
  });

  await migrateLegacyPostgresSchema();
  await ensurePostgresTables();
  await migrateJsonToPostgresIfNeeded();
  await ensureInitialHiddenProducts();
  await movePublicBackupTables();
  await ensureReadableViews();
  storageMode = 'postgres';
}

async function tableExists(tableName) {
  const result = await pool.query('select to_regclass($1) as name', [`public.${tableName}`]);
  return Boolean(result.rows[0]?.name);
}

async function columnExists(tableName, columnName) {
  const result = await pool.query(
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

function quoteIdent(value) {
  return String(value).replace(/"/g, '""');
}

async function objectExists(schemaName, objectName) {
  const result = await pool.query('select to_regclass($1) as name', [`${schemaName}.${objectName}`]);
  return Boolean(result.rows[0]?.name);
}

async function movePublicBackupTable(tableName) {
  if (!(await objectExists('public', tableName))) return;
  await pool.query('create schema if not exists backup');
  let targetName = tableName;
  if (await objectExists('backup', targetName)) {
    targetName = `${tableName}_${Date.now()}`;
    await pool.query(`alter table public."${quoteIdent(tableName)}" rename to "${quoteIdent(targetName)}"`);
    await pool.query(`alter table public."${quoteIdent(targetName)}" set schema backup`);
    return;
  }
  await pool.query(`alter table public."${quoteIdent(tableName)}" set schema backup`);
}

async function migrateLegacyPostgresSchema() {
  if (await tableExists('leads')) {
    const hasDataColumn = await columnExists('leads', 'data');
    const hasNameColumn = await columnExists('leads', 'name');
    if (hasDataColumn && !hasNameColumn) {
      await createReadableLeadsTable('leads_readable_migration');
      await pool.query(`
        insert into leads_readable_migration (
          id, lead_number, status, type, name, phone, service, recipe, message, product_id, product_title,
          page, source, utm_source, utm_medium, utm_campaign, admin_note, assigned_to,
          history, created_at, updated_at, deleted_at
        )
        select
          id,
          coalesce(nullif(data->>'leadNumber', ''), nullif(data->>'routeNumber', ''), ''),
          coalesce(nullif(data->>'status', ''), 'new'),
          coalesce(nullif(data->>'type', ''), 'appointment'),
          coalesce(data->>'name', ''),
          coalesce(data->>'phone', ''),
          coalesce(data->>'service', ''),
          coalesce(data->>'recipe', ''),
          coalesce(data->>'message', ''),
          coalesce(data->>'productId', ''),
          coalesce(data->>'productTitle', ''),
          coalesce(data->>'page', ''),
          coalesce(data->>'source', 'site'),
          coalesce(data->>'utmSource', ''),
          coalesce(data->>'utmMedium', ''),
          coalesce(data->>'utmCampaign', ''),
          coalesce(data->>'adminNote', ''),
          coalesce(data->>'assignedTo', ''),
          coalesce(data->'history', '[]'::jsonb),
          coalesce(created_at, now()),
          coalesce(updated_at, created_at, now()),
          deleted_at
        from leads
        on conflict (id) do nothing
      `);
      await pool.query('drop table if exists leads_json_backup');
      await pool.query('alter table leads rename to leads_json_backup');
      await pool.query('alter table leads_readable_migration rename to leads');
    }
  }

  if (await tableExists('products')) {
    const hasDataColumn = await columnExists('products', 'data');
    const hasTitleColumn = await columnExists('products', 'title');
    if (hasDataColumn && !hasTitleColumn) {
      await createReadableProductsTable('products_readable_migration');
      await pool.query(`
        insert into products_readable_migration (
          id, section, title, category, brand, type, shape, price, availability, badge,
          description, tags, visual, lead_service, image, gradient, active, sort, created_at, updated_at
        )
        select
          id,
          coalesce(data->>'section', ''),
          coalesce(data->>'title', ''),
          coalesce(data->>'category', ''),
          coalesce(data->>'brand', ''),
          coalesce(data->>'type', ''),
          coalesce(data->>'shape', ''),
          coalesce(data->>'price', ''),
          coalesce(data->>'availability', ''),
          coalesce(data->>'badge', ''),
          coalesce(data->>'description', ''),
          coalesce(data->'tags', '[]'::jsonb),
          coalesce(data->>'visual', 'frame'),
          coalesce(data->>'leadService', ''),
          coalesce(data->>'image', ''),
          coalesce(data->>'gradient', ''),
          active,
          sort,
          created_at,
          updated_at
        from products
        on conflict (id) do nothing
      `);
      await pool.query('drop table if exists products_json_backup');
      await pool.query('alter table products rename to products_json_backup');
      await pool.query('alter table products_readable_migration rename to products');
    }
  }
}

async function ensurePostgresTables() {
  await createReadableLeadsTable('leads');
  await createReadableProductsTable('products');

  await pool.query(`
    create table if not exists settings (
      id integer primary key default 1,
      data jsonb not null,
      updated_at timestamptz not null default now()
    )
  `);

  await pool.query('alter table leads add column if not exists lead_number text');
  await pool.query('create index if not exists idx_leads_created_at on leads (created_at desc)');
  await pool.query('create index if not exists idx_leads_updated_at on leads (updated_at desc)');
  await pool.query('create index if not exists idx_leads_deleted_at on leads (deleted_at)');
  await pool.query('create index if not exists idx_leads_status on leads (status)');
  await pool.query('create index if not exists idx_leads_phone on leads (phone)');
  await pool.query('create index if not exists idx_leads_lead_number on leads (lead_number)');
  await pool.query('create index if not exists idx_products_sort on products (sort)');
  await pool.query('create index if not exists idx_products_active on products (active)');
  await pool.query('create index if not exists idx_products_brand on products (brand)');
  await pool.query('create index if not exists idx_products_section on products (section)');
}

async function movePublicBackupTables() {
  await movePublicBackupTable('leads_json_backup');
  await movePublicBackupTable('products_json_backup');
}

async function ensureReadableViews() {
  await pool.query('drop view if exists public.zayavki_dlya_buhgalterii cascade');
  await pool.query('drop view if exists zayavki_dlya_buhgalterii cascade');
  await pool.query('drop view if exists public.tovary_dlya_prosmotra cascade');
  await pool.query('drop view if exists tovary_dlya_prosmotra cascade');
  await pool.query('drop view if exists leads_readable_migration cascade');
  await pool.query('drop view if exists leads_readable cascade');
  await pool.query('drop view if exists crm_leads_readable cascade');
  await pool.query('drop view if exists sales_report_readable cascade');
  await pool.query('drop view if exists leads_export_readable cascade');

  await pool.query(`
    create or replace view public.zayavki_dlya_buhgalterii as
    select
      to_char(created_at at time zone 'Asia/Novosibirsk', 'DD.MM.YYYY HH24:MI') as "Дата заявки",
      case status
        when 'new' then 'Новая'
        when 'in_progress' then 'В работе'
        when 'confirmed' then 'Подтверждена'
        when 'visited' then 'Пришёл в салон'
        when 'bought' then 'Купил'
        when 'no_answer' then 'Нет ответа'
        when 'cancelled' then 'Отменена'
        else coalesce(nullif(status, ''), 'Не указан')
      end as "Статус",
      case type
        when 'appointment' then 'Запись'
        when 'reservation' then 'Бронь товара'
        when 'contacts' then 'Контактные линзы'
        when 'product' then 'Товар'
        when 'repair' then 'Ремонт'
        else coalesce(nullif(type, ''), 'Не указан')
      end as "Тип заявки",
      nullif(name, '') as "Имя клиента",
      nullif(phone, '') as "Телефон",
      coalesce(nullif(product_title, ''), nullif(service, '')) as "Товар или услуга",
      nullif(recipe, '') as "Рецепт / параметры",
      nullif(message, '') as "Комментарий клиента",
      nullif(admin_note, '') as "Заметка сотрудника",
      nullif(page, '') as "Страница сайта",
      nullif(source, '') as "Источник",
      to_char(updated_at at time zone 'Asia/Novosibirsk', 'DD.MM.YYYY HH24:MI') as "Последнее изменение",
      nullif(lead_number, '') as "Номер заявки",
      id as "ID заявки"
    from public.leads
    where deleted_at is null
    order by created_at desc
  `);

  await pool.query(`
    create or replace view public.tovary_dlya_prosmotra as
    select
      case section
        when 'frames' then 'Оправы'
        when 'lenses' then 'Очковые линзы'
        when 'contacts' then 'Контактные линзы'
        when 'accessories' then 'Аксессуары'
        when 'services' then 'Услуги'
        else coalesce(nullif(section, ''), 'Без раздела')
      end as "Раздел",
      nullif(category, '') as "Категория",
      nullif(brand, '') as "Бренд",
      title as "Название",
      nullif(type, '') as "Тип",
      nullif(price, '') as "Цена",
      nullif(availability, '') as "Наличие",
      case when active then 'Да' else 'Нет' end as "Показывается на сайте",
      sort as "Сортировка",
      id as "ID товара"
    from public.products
    order by active desc, sort asc, title asc
  `);
}

async function createReadableLeadsTable(tableName) {
  await pool.query(`
    create table if not exists ${tableName} (
      id text primary key,
      lead_number text,
      status text not null default 'new',
      type text not null default 'appointment',
      name text not null default '',
      phone text not null default '',
      service text,
      recipe text,
      message text,
      product_id text,
      product_title text,
      page text,
      source text,
      utm_source text,
      utm_medium text,
      utm_campaign text,
      admin_note text,
      assigned_to text,
      history jsonb not null default '[]'::jsonb,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      deleted_at timestamptz
    )
  `);
}

async function createReadableProductsTable(tableName) {
  await pool.query(`
    create table if not exists ${tableName} (
      id text primary key,
      section text not null default '',
      title text not null default '',
      category text,
      brand text,
      type text,
      shape text,
      price text,
      availability text,
      badge text,
      description text,
      tags jsonb not null default '[]'::jsonb,
      visual text not null default 'frame',
      lead_service text,
      image text,
      gradient text,
      active boolean not null default false,
      sort integer not null default 0,
      created_at timestamptz,
      updated_at timestamptz
    )
  `);
}

async function migrateJsonToPostgresIfNeeded() {
  const leadsCount = Number((await pool.query('select count(*) as count from leads')).rows[0].count);
  const productsCount = Number((await pool.query('select count(*) as count from products')).rows[0].count);
  const settingsCount = Number((await pool.query('select count(*) as count from settings')).rows[0].count);

  if (leadsCount === 0) {
    const leads = Array.isArray(readJsonFile('leads.json')) ? readJsonFile('leads.json') : [];
    for (const lead of leads) {
      if (!lead || !lead.id) continue;
      await upsertLeadToPostgres(lead);
    }
  }

  if (productsCount === 0) {
    const products = Array.isArray(readJsonFile('products.json')) ? readJsonFile('products.json') : [];
    for (const product of products) {
      if (!product || !product.id) continue;
      await upsertProductToPostgres(product);
    }
  }

  if (settingsCount === 0) {
    const settings = readJsonFile('settings.json');
    if (settings && typeof settings === 'object' && !Array.isArray(settings)) {
      await upsertSettingsToPostgres(settings);
    }
  }
}

async function ensureInitialHiddenProducts() {
  const result = await pool.query('select data from settings where id = 1');
  const settings = result.rows[0]?.data || {};
  if (settings.catalogHiddenInitiallyApplied === true) return;
  await pool.query('update products set active = false');
  await upsertSettingsToPostgres({ ...settings, catalogHiddenInitiallyApplied: true });
}

function leadDbValues(lead) {
  const now = new Date().toISOString();
  return [
    lead.id,
    lead.leadNumber || '',
    lead.status || 'new',
    lead.type || 'appointment',
    lead.name || '',
    lead.phone || '',
    lead.service || '',
    lead.recipe || '',
    lead.message || '',
    lead.productId || '',
    lead.productTitle || '',
    lead.page || '',
    lead.source || 'site',
    lead.utmSource || '',
    lead.utmMedium || '',
    lead.utmCampaign || '',
    lead.adminNote || '',
    lead.assignedTo || '',
    JSON.stringify(asJsonArray(lead.history)),
    normalizeJsonDate(lead.createdAt) || now,
    normalizeJsonDate(lead.updatedAt) || normalizeJsonDate(lead.createdAt) || now,
    normalizeJsonDate(lead.deletedAt)
  ];
}

function productDbValues(product) {
  return [
    product.id,
    product.section || '',
    product.title || '',
    product.category || '',
    product.brand || '',
    product.type || '',
    product.shape || '',
    product.price || '',
    product.availability || '',
    product.badge || '',
    product.description || '',
    JSON.stringify(asJsonArray(product.tags)),
    product.visual || 'frame',
    product.leadService || '',
    product.image || '',
    product.gradient || '',
    product.active === true,
    Number(product.sort || 0),
    normalizeJsonDate(product.createdAt),
    normalizeJsonDate(product.updatedAt)
  ];
}

async function upsertLeadToPostgres(lead) {
  await pool.query(
    `
      insert into leads (
        id, lead_number, status, type, name, phone, service, recipe, message, product_id, product_title,
        page, source, utm_source, utm_medium, utm_campaign, admin_note, assigned_to,
        history, created_at, updated_at, deleted_at
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19::jsonb, $20, $21, $22)
      on conflict (id) do update set
        lead_number = excluded.lead_number,
        status = excluded.status,
        type = excluded.type,
        name = excluded.name,
        phone = excluded.phone,
        service = excluded.service,
        recipe = excluded.recipe,
        message = excluded.message,
        product_id = excluded.product_id,
        product_title = excluded.product_title,
        page = excluded.page,
        source = excluded.source,
        utm_source = excluded.utm_source,
        utm_medium = excluded.utm_medium,
        utm_campaign = excluded.utm_campaign,
        admin_note = excluded.admin_note,
        assigned_to = excluded.assigned_to,
        history = excluded.history,
        created_at = excluded.created_at,
        updated_at = excluded.updated_at,
        deleted_at = excluded.deleted_at
    `,
    leadDbValues(lead)
  );
}

async function upsertProductToPostgres(product) {
  await pool.query(
    `
      insert into products (
        id, section, title, category, brand, type, shape, price, availability, badge,
        description, tags, visual, lead_service, image, gradient, active, sort, created_at, updated_at
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13, $14, $15, $16, $17, $18, $19, $20)
      on conflict (id) do update set
        section = excluded.section,
        title = excluded.title,
        category = excluded.category,
        brand = excluded.brand,
        type = excluded.type,
        shape = excluded.shape,
        price = excluded.price,
        availability = excluded.availability,
        badge = excluded.badge,
        description = excluded.description,
        tags = excluded.tags,
        visual = excluded.visual,
        lead_service = excluded.lead_service,
        image = excluded.image,
        gradient = excluded.gradient,
        active = excluded.active,
        sort = excluded.sort,
        created_at = excluded.created_at,
        updated_at = excluded.updated_at
    `,
    productDbValues(product)
  );
}

async function upsertSettingsToPostgres(settings) {
  await pool.query(
    `
      insert into settings (id, data, updated_at)
      values (1, $1::jsonb, now())
      on conflict (id) do update set
        data = excluded.data,
        updated_at = now()
    `,
    [JSON.stringify(settings)]
  );
}

function rowToLead(row) {
  return {
    id: row.id,
    leadNumber: row.lead_number || '',
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
    deletedAt: toIso(row.deleted_at) || undefined,
    type: row.type || 'appointment',
    status: row.status || 'new',
    name: row.name || '',
    phone: row.phone || '',
    service: row.service || '',
    recipe: row.recipe || '',
    message: row.message || '',
    productId: row.product_id || '',
    productTitle: row.product_title || '',
    page: row.page || '',
    source: row.source || 'site',
    utmSource: row.utm_source || '',
    utmMedium: row.utm_medium || '',
    utmCampaign: row.utm_campaign || '',
    adminNote: row.admin_note || '',
    assignedTo: row.assigned_to || '',
    history: asJsonArray(row.history)
  };
}

function rowToProduct(row) {
  return {
    id: row.id,
    section: row.section || '',
    title: row.title || '',
    category: row.category || '',
    brand: row.brand || '',
    type: row.type || '',
    shape: row.shape || '',
    price: row.price || '',
    availability: row.availability || '',
    badge: row.badge || '',
    description: row.description || '',
    tags: asJsonArray(row.tags),
    visual: row.visual || 'frame',
    leadService: row.lead_service || '',
    image: row.image || '',
    gradient: row.gradient || '',
    active: row.active !== false,
    sort: Number(row.sort || 0),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at)
  };
}

async function readData(fileName) {
  if (storageMode !== 'postgres') return readJsonFile(fileName);

  if (fileName === 'leads.json') {
    const result = await pool.query('select * from leads order by created_at desc nulls last, id desc');
    return result.rows.map(rowToLead);
  }

  if (fileName === 'products.json') {
    const result = await pool.query('select * from products order by sort asc, id asc');
    return result.rows.map(rowToProduct);
  }

  if (fileName === 'settings.json') {
    const result = await pool.query('select data from settings where id = 1');
    return result.rows[0]?.data || {};
  }

  return [];
}

async function writeData(fileName, value) {
  if (storageMode !== 'postgres') {
    writeJsonFile(fileName, value);
    return;
  }

  if (fileName === 'leads.json') {
    const client = await pool.connect();
    try {
      await client.query('begin');
      await client.query('delete from leads');
      for (const lead of Array.isArray(value) ? value : []) {
        if (!lead || !lead.id) continue;
        await client.query(
          `
            insert into leads (
              id, lead_number, status, type, name, phone, service, recipe, message, product_id, product_title,
              page, source, utm_source, utm_medium, utm_campaign, admin_note, assigned_to,
              history, created_at, updated_at, deleted_at
            )
            values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19::jsonb, $20, $21, $22)
          `,
          leadDbValues(lead)
        );
      }
      await client.query('commit');
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
    return;
  }

  if (fileName === 'products.json') {
    const client = await pool.connect();
    try {
      await client.query('begin');
      await client.query('delete from products');
      for (const product of Array.isArray(value) ? value : []) {
        if (!product || !product.id) continue;
        await client.query(
          `
            insert into products (
              id, section, title, category, brand, type, shape, price, availability, badge,
              description, tags, visual, lead_service, image, gradient, active, sort, created_at, updated_at
            )
            values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13, $14, $15, $16, $17, $18, $19, $20)
          `,
          productDbValues(product)
        );
      }
      await client.query('commit');
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
    return;
  }

  if (fileName === 'settings.json') {
    await upsertSettingsToPostgres(value && typeof value === 'object' && !Array.isArray(value) ? value : {});
  }
}

function send(res, status, body, headers = {}) {
  const payload = typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': typeof body === 'string' ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers
  });
  res.end(payload);
}

function sendJson(res, status, body, headers = {}) {
  send(res, status, body, headers);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let total = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > MAX_BODY_SIZE) {
        reject(new Error('Body is too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}


function readRawBody(req, maxSize = MAX_UPLOAD_SIZE) {
  return new Promise((resolve, reject) => {
    let total = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > maxSize) {
        reject(new Error('Файл слишком большой. Максимум 5 МБ.'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function getMultipartBoundary(contentType) {
  const match = String(contentType || '').match(/boundary=(?:(?:"([^"]+)")|([^;]+))/i);
  return match ? (match[1] || match[2] || '').trim() : '';
}

function parseMultipartFile(buffer, boundary, fieldName) {
  const delimiter = Buffer.from(`--${boundary}`);
  let start = buffer.indexOf(delimiter);
  while (start !== -1) {
    start += delimiter.length;
    if (buffer.slice(start, start + 2).toString() === '--') break;
    if (buffer.slice(start, start + 2).toString() === '\r\n') start += 2;
    const next = buffer.indexOf(delimiter, start);
    if (next === -1) break;
    let part = buffer.slice(start, next);
    if (part.slice(-2).toString() === '\r\n') part = part.slice(0, -2);
    const headerEnd = part.indexOf(Buffer.from('\r\n\r\n'));
    if (headerEnd !== -1) {
      const headers = part.slice(0, headerEnd).toString('utf8');
      const body = part.slice(headerEnd + 4);
      const disposition = headers.match(/content-disposition:\s*form-data;([^\r\n]+)/i)?.[1] || '';
      const name = disposition.match(/name="([^"]+)"/i)?.[1] || '';
      const filename = disposition.match(/filename="([^"]*)"/i)?.[1] || '';
      const contentType = headers.match(/content-type:\s*([^\r\n]+)/i)?.[1]?.trim() || '';
      if (name === fieldName && filename) return { filename, contentType, body };
    }
    start = next;
  }
  return null;
}

function uploadExtension(filename, contentType) {
  const ext = path.extname(filename || '').toLowerCase();
  if (['.jpg', '.jpeg', '.png', '.webp'].includes(ext)) return ext === '.jpeg' ? '.jpg' : ext;
  if (contentType === 'image/jpeg') return '.jpg';
  if (contentType === 'image/png') return '.png';
  if (contentType === 'image/webp') return '.webp';
  return '';
}

async function handleAdminProductImageUpload(req, res) {
  if (!requireAuth(req, res, 'products')) return;
  try {
    const boundary = getMultipartBoundary(req.headers['content-type']);
    if (!boundary) {
      sendJson(res, 400, { success: false, error: 'Некорректная загрузка файла' });
      return;
    }
    const body = await readRawBody(req);
    const file = parseMultipartFile(body, boundary, 'image');
    if (!file || !file.body.length) {
      sendJson(res, 400, { success: false, error: 'Файл не выбран' });
      return;
    }
    const ext = uploadExtension(file.filename, file.contentType);
    if (!ext) {
      sendJson(res, 400, { success: false, error: 'Можно загрузить только JPG, PNG или WEBP' });
      return;
    }
    if (!fs.existsSync(UPLOAD_PRODUCTS_DIR)) fs.mkdirSync(UPLOAD_PRODUCTS_DIR, { recursive: true });
    const fileName = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`;
    const filePath = path.join(UPLOAD_PRODUCTS_DIR, fileName);
    fs.writeFileSync(filePath, file.body);
    sendJson(res, 201, { success: true, url: `/uploads/products/${fileName}` });
  } catch (error) {
    sendJson(res, 400, { success: false, error: error.message || 'Не удалось загрузить фото' });
  }
}

function cleanString(value, max = 500) {
  if (value === undefined || value === null) return '';
  return String(value).replace(/\s+/g, ' ').trim().slice(0, max);
}

function cleanMultiline(value, max = 2000) {
  if (value === undefined || value === null) return '';
  return String(value).replace(/\r/g, '').trim().slice(0, max);
}

function cleanBool(value) {
  return value === true;
}

function createId(prefix) {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const random = crypto.randomBytes(6).toString('hex');
  return `${prefix}_${date}_${random}`;
}

function createLeadNumber(existingLeads = []) {
  const used = new Set((Array.isArray(existingLeads) ? existingLeads : [])
    .map((lead) => String(lead.leadNumber || '').trim())
    .filter(Boolean));
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const number = String(crypto.randomInt(1000, 10000));
    if (!used.has(number)) return number;
  }
  return String(Date.now()).slice(-6);
}

function getCookie(req, name) {
  const raw = req.headers.cookie || '';
  const parts = raw.split(';').map((item) => item.trim());
  for (const part of parts) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    const key = part.slice(0, index);
    const value = part.slice(index + 1);
    if (key === name) return decodeURIComponent(value);
  }
  return '';
}

function getSession(req) {
  const token = getCookie(req, 'crm_session');
  if (!token) return null;
  const session = sessions.get(token);
  if (!session) return null;
  if (Date.now() - session.createdAt > SESSION_TTL) {
    sessions.delete(token);
    return null;
  }
  session.lastSeenAt = Date.now();
  return session;
}

function isAuthenticated(req) {
  return Boolean(getSession(req));
}

function getUser(req) {
  const session = getSession(req);
  if (!session) return null;
  const role = session.role || 'admin';
  const roleConfig = CRM_ROLES[role] || CRM_ROLES.admin;
  return { role, title: roleConfig.title, permissions: roleConfig.permissions };
}

function hasPermission(req, permission) {
  const user = getUser(req);
  return Boolean(user && user.permissions.includes(permission));
}

function requireAuth(req, res, permission = '') {
  const user = getUser(req);
  if (!user) {
    sendJson(res, 401, { success: false, error: 'Unauthorized' });
    return false;
  }
  if (permission && !user.permissions.includes(permission)) {
    sendJson(res, 403, { success: false, error: 'Недостаточно прав для этого действия.' });
    return false;
  }
  return true;
}

function setSessionCookie(res, token) {
  res.setHeader('Set-Cookie', `crm_session=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=43200`);
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', 'crm_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
}

function publicText(value) {
  return cleanString(value, 700)
    .replace(/из\s*1с/gi, '')
    .replace(/из\s*1c/gi, '')
    .replace(/из\s+номенклатуры\s+1с/gi, '')
    .replace(/из\s+отч[её]тов\s+1с/gi, '')
    .replace(/номенклатур[а-яё]*/gi, '')
    .replace(/по\s+уч[её]ту/gi, '')
    .replace(/в\s+1с/gi, '')
    .replace(/сотрудник\s+проверит/gi, 'мы уточним')
    .replace(/сотрудник\s+подтвердит/gi, 'мы подтвердим')
    .replace(/сотрудник\s+подтверждает/gi, 'мы подтверждаем')
    .replace(/сотрудник\s+уточнит/gi, 'мы уточним')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function hasInternalText(value) {
  const text = String(value || '').toLowerCase();
  return text.includes('1с') || text.includes('1c') || text.includes('crm') || text.includes('номенклатур') || text.includes('учёт') || text.includes('учет') || text.includes('отчёт') || text.includes('отчет') || text.includes('техничес') || text.includes('служеб');
}

function defaultPublicDescription(product) {
  const text = [product.section, product.category, product.type, product.title].filter(Boolean).join(' ').toLowerCase();
  if (product.section === 'services' || text.includes('услуг') || text.includes('мастер') || text.includes('ремонт')) return 'Оставьте заявку, чтобы подобрать удобное время визита.';
  if (text.includes('контакт')) return 'Оставьте заявку, чтобы уточнить наличие нужных параметров.';
  if (text.includes('линз')) return 'Оставьте заявку, чтобы подобрать линзы и уточнить итоговую стоимость.';
  if (text.includes('оправ') || text.includes('очк')) return 'Оставьте заявку, чтобы уточнить наличие и выбрать удобный салон для примерки.';
  return 'Оставьте заявку, чтобы уточнить наличие и удобный салон для просмотра.';
}

function publicProduct(product) {
  const description = publicText(product.description);
  const price = publicText(product.price);
  const availability = publicText(product.availability);
  const badge = publicText(product.badge);
  return {
    id: cleanString(product.id, 120),
    section: cleanString(product.section, 80),
    title: cleanString(product.title, 160),
    category: cleanString(product.category, 120),
    brand: cleanString(product.brand, 120),
    type: cleanString(product.type, 120),
    shape: publicText(product.shape).slice(0, 120),
    price: !price || hasInternalText(price) || price.toLowerCase().includes('сотрудник') ? 'цена по запросу' : price.slice(0, 80),
    availability: !availability || hasInternalText(availability) || availability.toLowerCase().includes('сотрудник') ? 'наличие уточняется' : availability.slice(0, 120),
    badge: !badge || hasInternalText(badge) ? '' : badge.slice(0, 80),
    description: !description || hasInternalText(description) || description.toLowerCase().includes('сотрудник') ? defaultPublicDescription(product) : description.slice(0, 700),
    tags: Array.isArray(product.tags) ? product.tags.map((tag) => publicText(tag).slice(0, 60)).filter((tag) => tag && !hasInternalText(tag)).slice(0, 12) : [],
    visual: cleanString(product.visual, 60) || 'frame',
    leadService: cleanString(product.leadService, 120),
    image: cleanString(product.image, 500),
    gradient: cleanString(product.gradient, 500),
    active: product.active === true,
    sort: Number(product.sort || 0)
  };
}

function normalizeProduct(input, existing = {}) {
  const id = cleanString(input.id || existing.id || createId('prod'), 120);
  return {
    id,
    section: cleanString(input.section ?? existing.section, 80) || 'frames',
    title: cleanString(input.title ?? existing.title, 160),
    category: cleanString(input.category ?? existing.category, 120),
    brand: cleanString(input.brand ?? existing.brand, 120),
    type: cleanString(input.type ?? existing.type, 120),
    shape: cleanString(input.shape ?? existing.shape, 120),
    price: cleanString(input.price ?? existing.price, 80),
    availability: cleanString(input.availability ?? existing.availability, 120),
    badge: cleanString(input.badge ?? existing.badge, 80),
    description: cleanString(input.description ?? existing.description, 700),
    tags: Array.isArray(input.tags)
      ? input.tags.map((tag) => cleanString(tag, 60)).filter(Boolean).slice(0, 12)
      : Array.isArray(existing.tags) ? existing.tags : [],
    visual: cleanString(input.visual ?? existing.visual, 60) || 'frame',
    leadService: cleanString(input.leadService ?? existing.leadService, 120),
    image: cleanString(input.image ?? existing.image, 500),
    gradient: cleanString(input.gradient ?? existing.gradient, 500),
    active: input.active === undefined ? existing.active === true : cleanBool(input.active),
    sort: Number(input.sort ?? existing.sort ?? 0),
    createdAt: existing.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

async function normalizeLead(input) {
  const now = new Date().toISOString();
  const type = cleanString(input.type, 80) || 'appointment';
  const productId = cleanString(input.productId, 120);
  const products = await readData('products.json');
  const product = productId ? products.find((item) => item.id === productId) : null;
  return {
    id: createId('lead'),
    leadNumber: cleanString(input.leadNumber || input.routeNumber || input.clientLeadNumber, 40),
    createdAt: now,
    updatedAt: now,
    type,
    status: 'new',
    name: cleanString(input.name, 120),
    phone: cleanString(input.phone, 80),
    service: cleanString(input.service, 160),
    recipe: cleanString(input.recipe, 120),
    message: cleanMultiline(input.message, 2000),
    productId,
    productTitle: cleanString(input.productTitle || product?.title, 160),
    page: cleanString(input.page, 500),
    source: cleanString(input.source, 120) || 'site',
    utmSource: cleanString(input.utmSource, 120),
    utmMedium: cleanString(input.utmMedium, 120),
    utmCampaign: cleanString(input.utmCampaign, 160),
    adminNote: '',
    assignedTo: '',
    history: [
      {
        at: now,
        action: 'created',
        value: 'new'
      }
    ]
  };
}

function updateLead(existing, input) {
  const now = new Date().toISOString();
  const next = { ...existing };
  const allowed = ['status', 'adminNote', 'assignedTo', 'name', 'phone', 'service', 'recipe', 'message', 'productTitle', 'leadNumber'];
  for (const key of allowed) {
    if (input[key] !== undefined) {
      next[key] = key === 'message' || key === 'adminNote' ? cleanMultiline(input[key], 2000) : cleanString(input[key], 300);
    }
  }
  next.updatedAt = now;
  const action = input.status && input.status !== existing.status ? 'status_changed' : 'updated';
  next.history = Array.isArray(existing.history) ? existing.history : [];
  next.history.push({
    at: now,
    action,
    value: next.status
  });
  return next;
}

async function getDashboard() {
  const leads = (await readData('leads.json')).filter((item) => !item.deletedAt);
  const products = await readData('products.json');
  const today = new Date().toISOString().slice(0, 10);
  const month = new Date().toISOString().slice(0, 7);
  const byStatus = {};
  const byType = {};
  for (const lead of leads) {
    byStatus[lead.status || 'new'] = (byStatus[lead.status || 'new'] || 0) + 1;
    byType[lead.type || 'appointment'] = (byType[lead.type || 'appointment'] || 0) + 1;
  }
  return {
    success: true,
    storage: storageMode,
    stats: {
      leadsTotal: leads.length,
      activeLeads: leads.filter((lead) => !CLOSED_LEAD_STATUSES.has(lead.status || 'new')).length,
      closedLeads: leads.filter((lead) => CLOSED_LEAD_STATUSES.has(lead.status || 'new')).length,
      leadsToday: leads.filter((lead) => String(lead.createdAt || '').startsWith(today)).length,
      leadsMonth: leads.filter((lead) => String(lead.createdAt || '').startsWith(month)).length,
      newLeads: leads.filter((lead) => lead.status === 'new').length,
      unprocessedLeads: leads.filter((lead) => lead.status === 'new').length,
      activeProducts: products.filter((product) => product.active === true).length,
      inactiveProducts: products.filter((product) => product.active === false).length
    },
    byStatus,
    byType,
    recent: leads.filter((lead) => !CLOSED_LEAD_STATUSES.has(lead.status || 'new')).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).slice(0, 8)
  };
}

async function handlePublicProducts(req, res) {
  const products = (await readData('products.json'))
    .map(publicProduct)
    .filter((product) => product.active === true)
    .sort((a, b) => (a.sort || 0) - (b.sort || 0));
  sendJson(res, 200, { success: true, products });
}

async function handleCreateLead(req, res) {
  try {
    const body = await readBody(req);
    const lead = await normalizeLead(body);
    if (!lead.name || !lead.phone) {
      sendJson(res, 400, { success: false, error: 'Name and phone are required' });
      return;
    }
    const leads = await readData('leads.json');
    if (!lead.leadNumber) lead.leadNumber = createLeadNumber(leads);
    leads.unshift(lead);
    await writeData('leads.json', leads);
    sendJson(res, 201, {
      success: true,
      lead: {
        id: lead.id,
        leadNumber: lead.leadNumber,
        status: lead.status,
        createdAt: lead.createdAt
      }
    });
  } catch (error) {
    sendJson(res, 400, { success: false, error: error.message || 'Invalid request' });
  }
}


const PUBLIC_STATUS_LABELS = {
  new: {
    title: 'Заявка получена',
    text: 'Мы получили ваше обращение. Сотрудник салона свяжется с вами для уточнения деталей.'
  },
  in_progress: {
    title: 'Заявка в работе',
    text: 'Сотрудник салона уже работает с заявкой и уточняет детали.'
  },
  confirmed: {
    title: 'Визит подтверждён',
    text: 'Визит согласован. Пожалуйста, приезжайте в салон в подтверждённое время.'
  },
  visited: {
    title: 'Клиент был в салоне',
    text: 'По заявке уже был визит в салон.'
  },
  completed: {
    title: 'Заявка выполнена',
    text: 'Обращение закрыто. Если остались вопросы, можно связаться с салоном.'
  },
  bought: {
    title: 'Заказ оформлен',
    text: 'По заявке оформлен заказ или покупка в салоне.'
  },
  no_show: {
    title: 'Визит не состоялся',
    text: 'По заявке не было визита в согласованное время.'
  },
  no_answer: {
    title: 'Не удалось дозвониться',
    text: 'Сотрудник пытался связаться с вами, но не дозвонился. Можно позвонить в салон самостоятельно.'
  },
  refused: {
    title: 'Отказ клиента',
    text: 'Заявка закрыта как отказ клиента.'
  },
  cancelled: {
    title: 'Заявка отменена',
    text: 'Заявка отменена. При необходимости можно оставить новое обращение.'
  }
};

function extractLeadMessageValue(message, label) {
  const text = String(message || '');
  const lines = text.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const lowerLabel = label.toLowerCase();
  const found = lines.find((line) => line.toLowerCase().replace(/^•\s*/, '').startsWith(lowerLabel));
  if (!found) return '';
  return found.replace(/^•\s*/, '').replace(new RegExp(`^${label}\\s*:?\\s*`, 'i'), '').trim();
}

function publicLeadStatusPayload(lead) {
  const status = lead.status || 'new';
  const statusInfo = PUBLIC_STATUS_LABELS[status] || PUBLIC_STATUS_LABELS.new;
  const serviceFromMessage = extractLeadMessageValue(lead.message, 'Задача');
  const salonFromMessage = extractLeadMessageValue(lead.message, 'Салон');
  return {
    leadNumber: lead.leadNumber || '',
    status,
    statusTitle: statusInfo.title,
    statusText: statusInfo.text,
    service: serviceFromMessage || lead.service || lead.productTitle || '',
    salon: salonFromMessage || '',
    updatedAt: lead.updatedAt || lead.createdAt || ''
  };
}

async function handlePublicLeadStatus(req, res, url) {
  const number = cleanString(url.searchParams.get('number') || url.searchParams.get('leadNumber') || '', 20).replace(/\D/g, '');
  const phoneLast4 = cleanString(url.searchParams.get('phoneLast4') || '', 8).replace(/\D/g, '').slice(-4);

  if (number.length < 3 || phoneLast4.length !== 4) {
    sendJson(res, 400, { success: false, error: 'Введите номер заявки и последние 4 цифры телефона.' });
    return;
  }

  const leads = (await readData('leads.json')).filter((item) => !item.deletedAt);
  const lead = leads.find((item) => String(item.leadNumber || '').replace(/\D/g, '') === number);

  if (!lead) {
    sendJson(res, 404, { success: false, error: 'Заявка не найдена. Проверьте номер заявки и последние 4 цифры телефона.' });
    return;
  }

  const phoneDigits = String(lead.phone || '').replace(/\D/g, '');
  if (!phoneDigits || phoneDigits.slice(-4) !== phoneLast4) {
    sendJson(res, 404, { success: false, error: 'Заявка не найдена. Проверьте номер заявки и последние 4 цифры телефона.' });
    return;
  }

  sendJson(res, 200, { success: true, lead: publicLeadStatusPayload(lead) });
}

async function handleLogin(req, res) {
  try {
    const body = await readBody(req);
    const password = cleanString(body.password, 300);
    const requestedRole = cleanString(body.role, 40) || 'admin';
    const role = CRM_ROLES[requestedRole] ? requestedRole : 'admin';
    const roleConfig = CRM_ROLES[role];
    const rolePassword = roleConfig.password;
    if (!rolePassword) {
      sendJson(res, 503, { success: false, error: `Пароль для роли «${roleConfig.title}» не задан. Укажите его в файле .env.` });
      return;
    }
    const actual = Buffer.from(password);
    const expected = Buffer.from(rolePassword);
    const ok = expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
    if (!ok) {
      sendJson(res, 401, { success: false, error: 'Неверный пароль.' });
      return;
    }
    const token = crypto.randomBytes(32).toString('hex');
    sessions.set(token, { role, createdAt: Date.now(), lastSeenAt: Date.now() });
    setSessionCookie(res, token);
    sendJson(res, 200, { success: true, user: { role, title: roleConfig.title, permissions: roleConfig.permissions } });
  } catch (error) {
    sendJson(res, 400, { success: false, error: 'Invalid request' });
  }
}

function handleLogout(req, res) {
  const token = getCookie(req, 'crm_session');
  if (token) sessions.delete(token);
  clearSessionCookie(res);
  sendJson(res, 200, { success: true });
}

function handleMe(req, res) {
  const user = getUser(req);
  sendJson(res, 200, { success: true, authenticated: Boolean(user), user });
}

async function handleAdminLeads(req, res, url) {
  if (!requireAuth(req, res, 'leads:read')) return;
  const leads = (await readData('leads.json')).filter((item) => !item.deletedAt);
  const status = url.searchParams.get('status') || '';
  const type = url.searchParams.get('type') || '';
  const scope = url.searchParams.get('scope') || 'active';
  const q = (url.searchParams.get('q') || '').toLowerCase();
  const filtered = leads.filter((lead) => {
    const currentStatus = lead.status || 'new';
    const isClosed = CLOSED_LEAD_STATUSES.has(currentStatus);
    if (scope === 'archive' && !isClosed) return false;
    if (scope !== 'archive' && scope !== 'all' && isClosed) return false;
    if (status && currentStatus !== status) return false;
    if (type && lead.type !== type) return false;
    if (q) {
      const text = [lead.leadNumber, lead.name, lead.phone, lead.service, lead.message, lead.productTitle, lead.adminNote].filter(Boolean).join(' ').toLowerCase();
      if (!text.includes(q)) return false;
    }
    return true;
  });
  sendJson(res, 200, { success: true, leads: filtered });
}

async function handleAdminLeadPatch(req, res, id) {
  if (!requireAuth(req, res, 'leads:update')) return;
  try {
    const body = await readBody(req);
    const leads = await readData('leads.json');
    const index = leads.findIndex((lead) => lead.id === id && !lead.deletedAt);
    if (index === -1) {
      sendJson(res, 404, { success: false, error: 'Lead not found' });
      return;
    }
    leads[index] = updateLead(leads[index], body);
    await writeData('leads.json', leads);
    sendJson(res, 200, { success: true, lead: leads[index] });
  } catch (error) {
    sendJson(res, 400, { success: false, error: 'Invalid request' });
  }
}

async function handleAdminLeadDelete(req, res, id) {
  if (!requireAuth(req, res, 'leads:delete')) return;
  const leads = await readData('leads.json');
  const index = leads.findIndex((lead) => lead.id === id && !lead.deletedAt);
  if (index === -1) {
    sendJson(res, 404, { success: false, error: 'Lead not found' });
    return;
  }
  leads[index].deletedAt = new Date().toISOString();
  leads[index].updatedAt = new Date().toISOString();
  await writeData('leads.json', leads);
  sendJson(res, 200, { success: true });
}

async function handleAdminProducts(req, res) {
  if (!requireAuth(req, res, 'products')) return;
  const products = (await readData('products.json')).map(publicProduct).sort((a, b) => (a.sort || 0) - (b.sort || 0));
  sendJson(res, 200, { success: true, products });
}

async function handleAdminProductPost(req, res) {
  if (!requireAuth(req, res, 'products')) return;
  try {
    const body = await readBody(req);
    const product = normalizeProduct(body);
    if (!product.title) {
      sendJson(res, 400, { success: false, error: 'Product title is required' });
      return;
    }
    const products = await readData('products.json');
    products.push(product);
    await writeData('products.json', products);
    sendJson(res, 201, { success: true, product: publicProduct(product) });
  } catch (error) {
    sendJson(res, 400, { success: false, error: 'Invalid request' });
  }
}

async function handleAdminProductPatch(req, res, id) {
  if (!requireAuth(req, res, 'products')) return;
  try {
    const body = await readBody(req);
    const products = await readData('products.json');
    const index = products.findIndex((product) => product.id === id);
    if (index === -1) {
      sendJson(res, 404, { success: false, error: 'Product not found' });
      return;
    }
    products[index] = normalizeProduct(body, products[index]);
    await writeData('products.json', products);
    sendJson(res, 200, { success: true, product: publicProduct(products[index]) });
  } catch (error) {
    sendJson(res, 400, { success: false, error: 'Invalid request' });
  }
}

async function handleAdminProductDelete(req, res, id) {
  if (!requireAuth(req, res, 'products')) return;
  const products = await readData('products.json');
  const index = products.findIndex((product) => product.id === id);
  if (index === -1) {
    sendJson(res, 404, { success: false, error: 'Product not found' });
    return;
  }
  products.splice(index, 1);
  await writeData('products.json', products);
  sendJson(res, 200, { success: true });
}

async function handlePublicSettings(req, res) {
  const settings = await readData('settings.json');
  const salonOneAddress = settings.salonOneAddress || 'Новосибирск, ул. Дуси Ковальчук 179/2, кор. 16/2';
  const salonTwoAddress = settings.salonTwoAddress || 'Новосибирск, ул. Учительская 33';
  sendJson(res, 200, {
    success: true,
    settings: {
      name: settings.businessName || '',
      fullAddress: settings.address || [salonOneAddress, salonTwoAddress].filter(Boolean).join('; '),
      phoneText: settings.phone || '',
      workTime: settings.workTime || '',
      email: settings.publicEmail || '',
      publicEmail: settings.publicEmail || '',
      whatsappPhone: settings.whatsappPhone || '',
      telegramUrl: settings.telegramUrl || '',
      salonOneName: settings.salonOneName || 'Дуси Ковальчук',
      salonOneAddress,
      salonOneYandexMapUrl: settings.salonOneYandexMapUrl || settings.yandexMapUrl || '',
      salonOneGisUrl: settings.salonOneGisUrl || settings.gisUrl || '',
      salonOneRouteUrl: settings.salonOneRouteUrl || '',
      salonTwoName: settings.salonTwoName || 'Учительская',
      salonTwoAddress,
      salonTwoYandexMapUrl: settings.salonTwoYandexMapUrl || '',
      salonTwoGisUrl: settings.salonTwoGisUrl || '',
      salonTwoRouteUrl: settings.salonTwoRouteUrl || ''
    }
  });
}

async function handleAdminSettings(req, res) {
  if (!requireAuth(req, res, 'settings')) return;
  sendJson(res, 200, { success: true, settings: await readData('settings.json') });
}

async function handleAdminSettingsPut(req, res) {
  if (!requireAuth(req, res, 'settings')) return;
  try {
    const body = await readBody(req);
    const existingSettings = await readData('settings.json');
    const settings = {
      businessName: cleanString(body.businessName, 160),
      address: cleanString(body.address, 300),
      phone: cleanString(body.phone, 80),
      workTime: cleanString(body.workTime, 160),
      bookingHoldHours: Math.max(1, Math.min(168, Number(body.bookingHoldHours || 24))),
      reservationText: cleanString(body.reservationText, 500),
      notificationEmail: cleanString(body.notificationEmail, 160),
      publicEmail: cleanString(body.publicEmail, 160),
      whatsappPhone: cleanString(body.whatsappPhone, 80),
      telegramUrl: cleanString(body.telegramUrl, 300),
      salonOneName: cleanString(body.salonOneName, 120),
      salonOneAddress: cleanString(body.salonOneAddress, 300),
      salonOneYandexMapUrl: cleanString(body.salonOneYandexMapUrl, 500),
      salonOneGisUrl: cleanString(body.salonOneGisUrl, 500),
      salonOneRouteUrl: cleanString(body.salonOneRouteUrl, 500),
      salonTwoName: cleanString(body.salonTwoName, 120),
      salonTwoAddress: cleanString(body.salonTwoAddress, 300),
      salonTwoYandexMapUrl: cleanString(body.salonTwoYandexMapUrl, 500),
      salonTwoGisUrl: cleanString(body.salonTwoGisUrl, 500),
      salonTwoRouteUrl: cleanString(body.salonTwoRouteUrl, 500),
      catalogHiddenInitiallyApplied: existingSettings.catalogHiddenInitiallyApplied === true
    };
    await writeData('settings.json', settings);
    sendJson(res, 200, { success: true, settings });
  } catch (error) {
    sendJson(res, 400, { success: false, error: 'Invalid request' });
  }
}


function reportDateValue(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('ru-RU', {
    timeZone: 'Asia/Novosibirsk',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date);
}

function reportStatusLabel(value) {
  return ({
    new: 'Новая',
    in_progress: 'В работе',
    confirmed: 'Подтверждена',
    visited: 'Пришёл в салон',
    completed: 'Выполнена',
    bought: 'Купил',
    no_show: 'Не пришёл',
    no_answer: 'Нет ответа',
    refused: 'Отказ клиента',
    cancelled: 'Отменена'
  })[value] || value || 'Не указан';
}

function reportTypeLabel(value) {
  return ({
    appointment: 'Запись',
    reservation: 'Бронь товара',
    availability: 'Уточнение наличия'
  })[value] || value || 'Не указан';
}

function getReportFilters(url) {
  return {
    q: (url.searchParams.get('q') || '').trim().toLowerCase(),
    status: (url.searchParams.get('status') || '').trim(),
    type: (url.searchParams.get('type') || '').trim(),
    dateFrom: (url.searchParams.get('dateFrom') || '').trim(),
    dateTo: (url.searchParams.get('dateTo') || '').trim()
  };
}

function leadMatchesReportFilters(lead, filters) {
  if (lead.deletedAt) return false;
  if (filters.status && lead.status !== filters.status) return false;
  if (filters.type && lead.type !== filters.type) return false;
  if (filters.dateFrom || filters.dateTo) {
    const createdAt = lead.createdAt ? new Date(lead.createdAt) : null;
    if (!createdAt || Number.isNaN(createdAt.getTime())) return false;
    if (filters.dateFrom) {
      const from = new Date(`${filters.dateFrom}T00:00:00`);
      if (!Number.isNaN(from.getTime()) && createdAt < from) return false;
    }
    if (filters.dateTo) {
      const to = new Date(`${filters.dateTo}T23:59:59.999`);
      if (!Number.isNaN(to.getTime()) && createdAt > to) return false;
    }
  }
  if (filters.q) {
    const text = [
      lead.leadNumber,
      lead.name,
      lead.phone,
      lead.service,
      lead.productTitle,
      lead.recipe,
      lead.message,
      lead.adminNote,
      lead.page,
      lead.source
    ].filter(Boolean).join(' ').toLowerCase();
    if (!text.includes(filters.q)) return false;
  }
  return true;
}

function leadToAccountingRow(lead) {
  const item = lead.productTitle || lead.service || '';
  return {
    createdAt: lead.createdAt || '',
    date: reportDateValue(lead.createdAt),
    status: reportStatusLabel(lead.status),
    type: reportTypeLabel(lead.type),
    name: lead.name || '',
    phone: lead.phone || '',
    item,
    service: lead.service || '',
    productTitle: lead.productTitle || '',
    recipe: lead.recipe || '',
    message: lead.message || '',
    adminNote: lead.adminNote || '',
    page: lead.page || '',
    source: lead.source || '',
    updatedAt: reportDateValue(lead.updatedAt),
    id: lead.id || ''
  };
}

async function getAccountingReport(url) {
  const filters = getReportFilters(url);
  const leads = (await readData('leads.json'))
    .filter((lead) => leadMatchesReportFilters(lead, filters))
    .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  const rows = leads.map(leadToAccountingRow);
  const statusCounts = {};
  const typeCounts = {};
  for (const row of rows) {
    statusCounts[row.status] = (statusCounts[row.status] || 0) + 1;
    typeCounts[row.type] = (typeCounts[row.type] || 0) + 1;
  }
  return {
    rows,
    summary: {
      total: rows.length,
      statusCounts,
      typeCounts
    }
  };
}

function accountingHeaders() {
  return [
    ['leadNumber', 'Номер заявки'],
    ['date', 'Дата заявки'],
    ['status', 'Статус'],
    ['type', 'Тип заявки'],
    ['name', 'Имя клиента'],
    ['phone', 'Телефон'],
    ['item', 'Товар или услуга'],
    ['recipe', 'Рецепт / параметры'],
    ['message', 'Комментарий клиента'],
    ['adminNote', 'Заметка сотрудника'],
    ['page', 'Страница сайта'],
    ['source', 'Источник'],
    ['updatedAt', 'Последнее изменение'],
    ['id', 'ID заявки']
  ];
}

function csvEscape(value) {
  return `"${String(value ?? '').replace(/"/g, '""')}"`;
}

function htmlEscape(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  })[char]);
}

function sendDownload(res, contentType, fileName, body) {
  res.writeHead(200, {
    'Content-Type': contentType,
    'Content-Disposition': `attachment; filename="${fileName}"`,
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

async function handleAccountingReport(req, res, url) {
  if (!requireAuth(req, res, 'reports')) return;
  const report = await getAccountingReport(url);
  sendJson(res, 200, { success: true, ...report });
}

async function handleAccountingReportCsv(req, res, url) {
  if (!requireAuth(req, res, 'reports')) return;
  const { rows } = await getAccountingReport(url);
  const headers = accountingHeaders();
  const csv = [
    headers.map(([, title]) => csvEscape(title)).join(';'),
    ...rows.map((row) => headers.map(([key]) => csvEscape(row[key])).join(';'))
  ].join('\n');
  const date = new Date().toISOString().slice(0, 10);
  sendDownload(res, 'text/csv; charset=utf-8', `sibir-optika-accounting-${date}.csv`, `\ufeff${csv}`);
}

async function handleAccountingReportExcel(req, res, url) {
  if (!requireAuth(req, res, 'reports')) return;
  const { rows } = await getAccountingReport(url);
  const headers = accountingHeaders();
  const tableHead = headers.map(([, title]) => `<th>${htmlEscape(title)}</th>`).join('');
  const tableRows = rows.map((row) => `<tr>${headers.map(([key]) => `<td>${htmlEscape(row[key])}</td>`).join('')}</tr>`).join('');
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>body{font-family:Arial,sans-serif}table{border-collapse:collapse;width:100%}th,td{border:1px solid #d9d9d9;padding:8px;text-align:left;vertical-align:top}th{background:#f1f4f8;font-weight:700}</style></head><body><h2>Заявки для бухгалтерии</h2><table><thead><tr>${tableHead}</tr></thead><tbody>${tableRows}</tbody></table></body></html>`;
  const date = new Date().toISOString().slice(0, 10);
  sendDownload(res, 'application/vnd.ms-excel; charset=utf-8', `sibir-optika-accounting-${date}.xls`, `\ufeff${html}`);
}

async function handleDashboard(req, res) {
  if (!requireAuth(req, res, 'dashboard')) return;
  sendJson(res, 200, await getDashboard());
}

function isCompressible(ext) {
  return ['.html', '.css', '.js', '.json', '.xml', '.txt', '.svg'].includes(ext);
}

function cacheHeaderFor(ext) {
  if (ext === '.html') return 'no-cache, must-revalidate';
  if (['.css', '.js', '.svg', '.png', '.jpg', '.jpeg', '.webp', '.ico'].includes(ext)) return 'public, max-age=31536000, immutable';
  return 'public, max-age=86400';
}

function serveStatic(req, res, url) {
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === '/') pathname = '/index.html';
  if (pathname === '/crm' || pathname === '/crm/') pathname = '/crm/index.html';
  const safePath = path.normalize(pathname).replace(/^(\.\.[/\\])+/, '');
  const filePath = path.join(PUBLIC_DIR, safePath);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    send(res, 403, 'Forbidden');
    return;
  }
  fs.stat(filePath, (error, stats) => {
    if (error || !stats.isFile()) {
      const fallback = path.join(PUBLIC_DIR, 'index.html');
      if (fs.existsSync(fallback)) {
        const html = fs.readFileSync(fallback);
        res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(req.method === 'HEAD' ? undefined : html);
        return;
      }
      send(res, 404, 'Not found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    const etag = `W/"${stats.size}-${Number(stats.mtimeMs).toString(36)}"`;
    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304, { ETag: etag, 'Cache-Control': cacheHeaderFor(ext) });
      res.end();
      return;
    }
    const headers = {
      'Content-Type': mimeTypes[ext] || 'application/octet-stream',
      'Cache-Control': cacheHeaderFor(ext),
      ETag: etag,
      'X-Content-Type-Options': 'nosniff'
    };
    const acceptEncoding = String(req.headers['accept-encoding'] || '');
    if (isCompressible(ext) && acceptEncoding.includes('gzip')) {
      headers['Content-Encoding'] = 'gzip';
      headers.Vary = 'Accept-Encoding';
      res.writeHead(200, headers);
      if (req.method === 'HEAD') return res.end();
      fs.createReadStream(filePath).pipe(zlib.createGzip()).pipe(res);
      return;
    }
    res.writeHead(200, headers);
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(filePath).pipe(res);
  });
}

async function route(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (req.method === 'GET' && url.pathname === '/api/products') return handlePublicProducts(req, res);
  if (req.method === 'POST' && url.pathname === '/api/leads') return handleCreateLead(req, res);
  if (req.method === 'GET' && url.pathname === '/api/lead-status') return handlePublicLeadStatus(req, res, url);
  if (req.method === 'POST' && url.pathname === '/api/auth/login') return handleLogin(req, res);
  if (req.method === 'POST' && url.pathname === '/api/auth/logout') return handleLogout(req, res);
  if (req.method === 'GET' && url.pathname === '/api/auth/me') return handleMe(req, res);
  if (req.method === 'GET' && url.pathname === '/api/settings') return handlePublicSettings(req, res);
  if (req.method === 'GET' && url.pathname === '/api/admin/dashboard') return handleDashboard(req, res);
  if (req.method === 'GET' && url.pathname === '/api/admin/leads') return handleAdminLeads(req, res, url);
  if (req.method === 'GET' && url.pathname === '/api/admin/reports/accounting') return handleAccountingReport(req, res, url);
  if (req.method === 'GET' && url.pathname === '/api/admin/reports/accounting.csv') return handleAccountingReportCsv(req, res, url);
  if (req.method === 'GET' && url.pathname === '/api/admin/reports/accounting.xls') return handleAccountingReportExcel(req, res, url);
  if (req.method === 'PATCH' && url.pathname.startsWith('/api/admin/leads/')) return handleAdminLeadPatch(req, res, url.pathname.split('/').pop());
  if (req.method === 'DELETE' && url.pathname.startsWith('/api/admin/leads/')) return handleAdminLeadDelete(req, res, url.pathname.split('/').pop());
  if (req.method === 'GET' && url.pathname === '/api/admin/products') return handleAdminProducts(req, res);
  if (req.method === 'POST' && url.pathname === '/api/admin/products') return handleAdminProductPost(req, res);
  if (req.method === 'POST' && url.pathname === '/api/admin/uploads/product-image') return handleAdminProductImageUpload(req, res);
  if (req.method === 'PATCH' && url.pathname.startsWith('/api/admin/products/')) return handleAdminProductPatch(req, res, url.pathname.split('/').pop());
  if (req.method === 'DELETE' && url.pathname.startsWith('/api/admin/products/')) return handleAdminProductDelete(req, res, url.pathname.split('/').pop());
  if (req.method === 'GET' && url.pathname === '/api/admin/settings') return handleAdminSettings(req, res);
  if (req.method === 'PUT' && url.pathname === '/api/admin/settings') return handleAdminSettingsPut(req, res);
  if (req.method === 'GET' || req.method === 'HEAD') return serveStatic(req, res, url);
  sendJson(res, 405, { success: false, error: 'Method not allowed' });
}

async function start() {
  ensureDataFiles();

  if (DATABASE_URL) {
    await initPostgres();
  }

  const server = http.createServer((req, res) => {
    route(req, res).catch((error) => {
      sendJson(res, 500, { success: false, error: error.message || 'Server error' });
    });
  });

  server.listen(PORT, () => {
    console.log(`Сибирь-Оптика CRM запущена: http://localhost:${PORT}`);
    console.log(`CRM: http://localhost:${PORT}/crm`);
    console.log(`Хранилище данных: ${storageMode}`);
  });

  process.on('SIGINT', async () => {
    if (pool) await pool.end();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    if (pool) await pool.end();
    process.exit(0);
  });
}

start().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
