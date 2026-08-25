require("dotenv").config();

const express = require("express");
const axios = require("axios");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const cron = require("node-cron");
const Database = require("better-sqlite3");
const { Bot, InlineKeyboard } = require("grammy");


/* =====================================================
   CONFIG
===================================================== */

const PORT = Number(process.env.PORT || 3000);

const BOT_TOKEN =
  process.env.BOT_TOKEN;

const ADMIN_TELEGRAM_ID =
  String(process.env.ADMIN_TELEGRAM_ID || "").trim();

const NOWPAYMENTS_API_KEY =
  process.env.NOWPAYMENTS_API_KEY;

const NOWPAYMENTS_IPN_SECRET =
  process.env.NOWPAYMENTS_IPN_SECRET;

const PUBLIC_URL =
  String(process.env.PUBLIC_URL || "")
    .replace(/\/+$/, "");

const PRICE_CURRENCY =
  String(
    process.env.PRICE_CURRENCY || "usd"
  ).toLowerCase();

const DATABASE_FILE =
  process.env.DATABASE_FILE ||
  "./data/emadnet.db";

const BACKUP_DIR =
  process.env.BACKUP_DIR ||
  "./backups";

const BACKUP_ENABLED =
  String(
    process.env.BACKUP_ENABLED || "true"
  ).toLowerCase() === "true";

const BACKUP_CRON =
  process.env.BACKUP_CRON ||
  "0 3 * * *";

const BACKUP_RETENTION =
  Number(
    process.env.BACKUP_RETENTION || 14
  );

const PAYMENT_EXPIRE_MINUTES =
  Number(
    process.env.PAYMENT_EXPIRE_MINUTES || 60
  );

const VPN_PROVISION_URL =
  String(
    process.env.VPN_PROVISION_URL || ""
  ).trim();

const VPN_PROVISION_SECRET =
  String(
    process.env.VPN_PROVISION_SECRET || ""
  ).trim();


/* =====================================================
   VALIDATION
===================================================== */

if (!BOT_TOKEN) {
  console.error(
    "ERROR: BOT_TOKEN is missing."
  );

  process.exit(1);
}

if (!ADMIN_TELEGRAM_ID) {
  console.error(
    "ERROR: ADMIN_TELEGRAM_ID is missing."
  );

  process.exit(1);
}

if (!NOWPAYMENTS_API_KEY) {
  console.warn(
    "WARNING: NOWPAYMENTS_API_KEY is missing."
  );
}

if (!NOWPAYMENTS_IPN_SECRET) {
  console.warn(
    "WARNING: NOWPAYMENTS_IPN_SECRET is missing."
  );
}

if (!PUBLIC_URL) {
  console.warn(
    "WARNING: PUBLIC_URL is missing."
  );
}


/* =====================================================
   DIRECTORIES
===================================================== */

const databaseDirectory =
  path.dirname(
    path.resolve(DATABASE_FILE)
  );

fs.mkdirSync(
  databaseDirectory,
  {
    recursive: true
  }
);

fs.mkdirSync(
  path.resolve(BACKUP_DIR),
  {
    recursive: true
  }
);


/* =====================================================
   DATABASE
===================================================== */

const db =
  new Database(
    DATABASE_FILE
  );

db.pragma(
  "journal_mode = WAL"
);

db.pragma(
  "foreign_keys = ON"
);


/* =====================================================
   DATABASE TABLES
===================================================== */

db.exec(`

CREATE TABLE IF NOT EXISTS users (

  id INTEGER PRIMARY KEY AUTOINCREMENT,

  telegram_id TEXT UNIQUE NOT NULL,

  username TEXT,

  first_name TEXT,

  last_name TEXT,

  created_at TEXT DEFAULT CURRENT_TIMESTAMP,

  updated_at TEXT DEFAULT CURRENT_TIMESTAMP

);


CREATE TABLE IF NOT EXISTS plans (

  id INTEGER PRIMARY KEY AUTOINCREMENT,

  name TEXT NOT NULL,

  gb INTEGER NOT NULL,

  days INTEGER NOT NULL,

  price REAL NOT NULL,

  currency TEXT DEFAULT 'usd',

  active INTEGER DEFAULT 1,

  created_at TEXT DEFAULT CURRENT_TIMESTAMP

);


CREATE TABLE IF NOT EXISTS orders (

  id INTEGER PRIMARY KEY AUTOINCREMENT,

  order_code TEXT UNIQUE NOT NULL,

  telegram_id TEXT NOT NULL,

  plan_id INTEGER NOT NULL,

  plan_name TEXT NOT NULL,

  price REAL NOT NULL,

  price_currency TEXT NOT NULL,

  crypto_currency TEXT,

  payment_id TEXT,

  pay_address TEXT,

  pay_amount REAL,

  payment_url TEXT,

  status TEXT DEFAULT 'pending',

  subscription_url TEXT,

  provider_status TEXT,

  expires_at TEXT,

  created_at TEXT DEFAULT CURRENT_TIMESTAMP,

  paid_at TEXT,

  FOREIGN KEY (plan_id)
    REFERENCES plans(id)

);


CREATE TABLE IF NOT EXISTS payment_events (

  id INTEGER PRIMARY KEY AUTOINCREMENT,

  payment_id TEXT,

  order_code TEXT,

  status TEXT,

  payload TEXT,

  created_at TEXT DEFAULT CURRENT_TIMESTAMP

);


CREATE TABLE IF NOT EXISTS backups (

  id INTEGER PRIMARY KEY AUTOINCREMENT,

  file_name TEXT NOT NULL,

  created_at TEXT DEFAULT CURRENT_TIMESTAMP

);

`);


/* =====================================================
   DEFAULT PLANS
===================================================== */

const planCount =
  db.prepare(
    "SELECT COUNT(*) AS count FROM plans"
  ).get();

if (planCount.count === 0) {

  const insertPlan =
    db.prepare(`
      INSERT INTO plans
      (name, gb, days, price, currency)
      VALUES (?, ?, ?, ?, ?)
    `);

  insertPlan.run(
    "پلن اقتصادی",
    10,
    30,
    5,
    "usd"
  );

  insertPlan.run(
    "پلن استاندارد",
    30,
    30,
    10,
    "usd"
  );

  insertPlan.run(
    "پلن حرفه‌ای",
    50,
    60,
    15,
    "usd"
  );

  console.log(
    "Default plans created."
  );
}


/* =====================================================
   TELEGRAM BOT
===================================================== */

const bot =
  new Bot(BOT_TOKEN);


/* =====================================================
   EXPRESS
===================================================== */

const app =
  express();


/* =====================================================
   HEALTH
===================================================== */

app.get(
  "/health",
  (req, res) => {

    res.json({
      status: "ok",
      service: "Emad Net Telegram Bot",
      time:
        new Date().toISOString()
    });

  }
);


/* =====================================================
   ROOT
===================================================== */

app.get(
  "/",
  (req, res) => {

    res.send(
      "Emad Net Telegram Bot is running."
    );

  }
);


/* =====================================================
   JSON PARSER
===================================================== */

app.use(
  express.json({
    limit: "2mb"
  })
);


/* =====================================================
   HELPERS
===================================================== */

function createOrderCode() {

  const random =
    crypto
      .randomBytes(5)
      .toString("hex")
      .toUpperCase();

  return `EMAD-${Date.now()}-${random}`;

}


function isAdmin(
  telegramId
) {

  return (
    String(telegramId) ===
    ADMIN_TELEGRAM_ID
  );

}


function escapeHtml(
  value
) {

  return String(value || "")
    .replace(
      /&/g,
      "&amp;"
    )
    .replace(
      /</g,
      "&lt;"
    )
    .replace(
      />/g,
      "&gt;"
    );

}


/* =====================================================
   USER DATABASE
===================================================== */

function saveTelegramUser(
  from
) {

  if (!from) {
    return;
  }

  const telegramId =
    String(from.id);

  const existing =
    db.prepare(`
      SELECT id
      FROM users
      WHERE telegram_id = ?
    `).get(
      telegramId
    );

  if (existing) {

    db.prepare(`
      UPDATE users

      SET
        username = ?,
        first_name = ?,
        last_name = ?,
        updated_at = CURRENT_TIMESTAMP

      WHERE telegram_id = ?
    `).run(
      from.username || null,
      from.first_name || null,
      from.last_name || null,
      telegramId
    );

    return;

  }

  db.prepare(`
    INSERT INTO users
    (
      telegram_id,
      username,
      first_name,
      last_name
    )

    VALUES (?, ?, ?, ?)
  `).run(
    telegramId,
    from.username || null,
    from.first_name || null,
    from.last_name || null
  );

}


/* =====================================================
   NOWPAYMENTS REQUEST
===================================================== */

async function nowPaymentsRequest(
  method,
  endpoint,
  data
) {

  if (!NOWPAYMENTS_API_KEY) {

    throw new Error(
      "NOWPayments API key is not configured."
    );

  }

  const response =
    await axios({
      method,
      url:
        `https://api.nowpayments.io${endpoint}`,

      headers: {
        "x-api-key":
          NOWPAYMENTS_API_KEY,

        "Content-Type":
          "application/json"
      },

      data,

      timeout: 30000
    });

  return response.data;

}


/* =====================================================
   GET CURRENCIES
===================================================== */

async function getPaymentCurrencies() {

  return nowPaymentsRequest(
    "GET",
    "/v1/currencies"
  );

}


/* =====================================================
   CREATE PAYMENT
===================================================== */

async function createCryptoPayment(
  order
) {

  if (!PUBLIC_URL) {

    throw new Error(
      "PUBLIC_URL is not configured."
    );

  }

  const callback =
    `${PUBLIC_URL}/webhooks/nowpayments`;


  const payload = {

    price_amount:
      Number(order.price),

    price_currency:
      order.price_currency,

    pay_currency:
      order.crypto_currency,

    ipn_callback_url:
      callback,

    order_id:
      order.order_code,

    order_description:
      `Emad Net - ${order.plan_name}`

  };


  const payment =
    await nowPaymentsRequest(
      "POST",
      "/v1/payment",
      payload
    );


  return payment;

}


/* =====================================================
   SIGNATURE SORT
===================================================== */

function sortObject(
  object
) {

  if (
    object === null ||
    typeof object !== "object"
  ) {

    return object;

  }


  if (Array.isArray(object)) {

    return object.map(
      sortObject
    );

  }


  return Object.keys(object)
    .sort()
    .reduce(
      (
        result,
        key
      ) => {

        result[key] =
          sortObject(
            object[key]
          );

        return result;

      },
      {}
    );

}


/* =====================================================
   VERIFY NOWPAYMENTS IPN
===================================================== */

function verifyIPNSignature(
  payload,
  signature
) {

  if (
    !NOWPAYMENTS_IPN_SECRET ||
    !signature
  ) {

    return false;

  }


  const sorted =
    sortObject(payload);


  const body =
    JSON.stringify(
      sorted
    );


  const expected =
    crypto
      .createHmac(
        "sha512",
        NOWPAYMENTS_IPN_SECRET
      )
      .update(body)
      .digest("hex");


  try {

    return crypto.timingSafeEqual(
      Buffer.from(expected),
      Buffer.from(
        String(signature)
      )
    );

  } catch {

    return false;

  }

}


/* =====================================================
   VPN PROVISION
===================================================== */

async function provisionVPN(
  order
) {

  /*
    If VPN API is not configured,
    the payment is still recorded as paid.

    Later connect your VPN panel here.
  */

  if (!VPN_PROVISION_URL) {

    return {
      success: false,
      configured: false,
      subscriptionUrl: null
    };

  }


  try {

    const response =
      await axios.post(
        VPN_PROVISION_URL,

        {

          orderCode:
            order.order_code,

          telegramId:
            order.telegram_id,

          planId:
            order.plan_id,

          planName:
            order.plan_name,

          gb:
            order.gb,

          days:
            order.days

        },

        {

          headers: {

            Authorization:
              `Bearer ${VPN_PROVISION_SECRET}`,

            "Content-Type":
              "application/json"

          },

          timeout: 30000

        }
      );


    return {

      success: true,

      configured: true,

      subscriptionUrl:
        response.data
          ?.subscriptionUrl ||
        response.data
          ?.subscription_url ||
        null

    };

  } catch (error) {

    console.error(
      "VPN provision error:",
      error.message
    );

    return {

      success: false,

      configured: true,

      subscriptionUrl: null

    };

  }

}


/* =====================================================
   COMPLETE ORDER
===================================================== */

async function completeOrder(
  order,
  providerStatus
) {

  const current =
    db.prepare(`
      SELECT *
      FROM orders
      WHERE order_code = ?
    `).get(
      order.order_code
    );


  if (!current) {
    return;
  }


  if (
    current.status === "paid" &&
    current.subscription_url
  ) {

    return;

  }


  const plan =
    db.prepare(`
      SELECT *
      FROM plans
      WHERE id = ?
    `).get(
      current.plan_id
    );


  if (!plan) {

    console.error(
      "Plan not found for order:",
      current.order_code
    );

    return;

  }


  const provisionOrder = {

    ...current,

    gb:
      plan.gb,

    days:
      plan.days

  };


  const provision =
    await provisionVPN(
      provisionOrder
    );


  db.prepare(`
    UPDATE orders

    SET
      status = 'paid',
      provider_status = ?,
      subscription_url = ?,
      paid_at = CURRENT_TIMESTAMP

    WHERE order_code = ?
  `).run(
    providerStatus,
    provision.subscriptionUrl,
    current.order_code
  );


  let message =

    `✅ <b>پرداخت موفق بود!</b>\n\n` +

    `🧾 سفارش: <code>${escapeHtml(
      current.order_code
    )}</code>\n` +

    `📦 محصول: ${escapeHtml(
      current.plan_name
    )}\n\n`;


  if (
    provision.subscriptionUrl
  ) {

    message +=
      `🔗 <b>لینک اشتراک شما:</b>\n` +
      `<code>${escapeHtml(
        provision.subscriptionUrl
      )}</code>\n\n` +

      `🎉 اشتراک شما فعال شد.`;

  } else {

    message +=
      `⏳ پرداخت تأیید شد.\n\n` +

      `سیستم VPN هنوز به API ساخت اشتراک متصل نشده است.\n` +

      `سفارش شما ثبت شده و بعد از اتصال API ساخت اشتراک، لینک به‌صورت خودکار ارسال خواهد شد.`;

  }


  try {

    await bot.api.sendMessage(
      current.telegram_id,
      message,
      {
        parse_mode:
          "HTML"
      }
    );

  } catch (error) {

    console.error(
      "Telegram paid message error:",
      error.message
    );

  }

}


/* =====================================================
   NOWPAYMENTS WEBHOOK
===================================================== */

app.post(
  "/webhooks/nowpayments",
  async (req, res) => {

    try {

      const signature =
        req.headers[
          "x-nowpayments-sig"
        ];


      if (
        !verifyIPNSignature(
          req.body,
          signature
        )
      ) {

        console.warn(
          "Invalid NOWPayments IPN signature."
        );

        return res
          .status(401)
          .json({
            error:
              "Invalid signature"
          });

      }


      const payload =
        req.body;


      const paymentId =
        String(
          payload.payment_id || ""
        );


      const orderCode =
        String(
          payload.order_id || ""
        );


      const status =
        String(
          payload.payment_status ||
          ""
        ).toLowerCase();


      db.prepare(`
        INSERT INTO payment_events
        (
          payment_id,
          order_code,
          status,
          payload
        )

        VALUES (?, ?, ?, ?)
      `).run(

        paymentId,

        orderCode,

        status,

        JSON.stringify(
          payload
        )

      );


      const order =
        db.prepare(`
          SELECT *
          FROM orders
          WHERE order_code = ?
        `).get(
          orderCode
        );


      if (!order) {

        console.warn(
          "Order not found:",
          orderCode
        );

        return res.json({
          received: true
        });

      }


      db.prepare(`
        UPDATE orders

        SET
          provider_status = ?,
          payment_id = ?,
          pay_address = COALESCE(?, pay_address),
          pay_amount = COALESCE(?, pay_amount)

        WHERE order_code = ?
      `).run(

        status,

        paymentId,

        payload.pay_address ||
          null,

        payload.pay_amount ||
          null,

        orderCode

      );


      /*
        NOWPayments sends different statuses.

        finished / confirmed:
        payment is complete.

        partially_paid:
        payment is incomplete.

        failed / expired:
        order should not be fulfilled.
      */

      if (
        status === "finished" ||
        status === "confirmed"
      ) {

        await completeOrder(
          order,
          status
        );

      }


      if (
        status === "failed" ||
        status === "expired"
      ) {

        db.prepare(`
          UPDATE orders

          SET status = 'expired'

          WHERE order_code = ?
            AND status = 'pending'
        `).run(
          orderCode
        );

      }


      return res.json({
        received: true
      });

    } catch (error) {

      console.error(
        "IPN error:",
        error
      );

      return res
        .status(500)
        .json({
          error:
            "Webhook error"
        });

    }

  }
);


/* =====================================================
   START COMMAND
===================================================== */

bot.command(
  "start",
  async (ctx) => {

    saveTelegramUser(
      ctx.from
    );


    const keyboard =
      new InlineKeyboard()

        .text(
          "🛒 خرید VPN",
          "buy"
        )
        .row()

        .text(
          "📦 سفارش‌های من",
          "my_orders"
        )

        .row()

        .text(
          "🔗 اشتراک‌های من",
          "my_subscriptions"
        )
        .row()

        .text(
          "💬 پشتیبانی",
          "support"
        );


    await ctx.reply(

      `👋 <b>به Emad Net خوش آمدید</b>\n\n` +

      `🚀 فروش اشتراک VPN\n` +
      `⚡ تحویل سریع\n` +
      `💳 پرداخت کریپتویی\n\n` +

      `یکی از گزینه‌های زیر را انتخاب کنید:`,

      {
        parse_mode:
          "HTML",

        reply_markup:
          keyboard

      }

    );

  }
);


/* =====================================================
   BUY
===================================================== */

bot.callbackQuery(
  "buy",
  async (ctx) => {

    await ctx.answerCallbackQuery();

    const plans =
      db.prepare(`
        SELECT *
        FROM plans
        WHERE active = 1
        ORDER BY price ASC
      `).all();


    if (!plans.length) {

      return ctx.reply(
        "در حال حاضر محصولی برای فروش وجود ندارد."
      );

    }


    const keyboard =
      new InlineKeyboard();


    for (
      const plan of plans
    ) {

      keyboard.text(

        `${plan.name} | ${plan.gb}GB | ${plan.days} روز | $${plan.price}`,

        `plan:${plan.id}`

      );

      keyboard.row();

    }


    await ctx.reply(

      `🛒 <b>انتخاب پلن</b>\n\n` +

      `پلن موردنظر خود را انتخاب کنید:`,

      {

        parse_mode:
          "HTML",

        reply_markup:
          keyboard

      }

    );

  }
);


/* =====================================================
   PLAN SELECT
===================================================== */

bot.callbackQuery(
  /^plan:(\d+)$/,
  async (ctx) => {

    await ctx.answerCallbackQuery();


    const planId =
      Number(
        ctx.match[1]
      );


    const plan =
      db.prepare(`
        SELECT *
        FROM plans
        WHERE id = ?
          AND active = 1
      `).get(
        planId
      );


    if (!plan) {

      return ctx.reply(
        "این پلن دیگر موجود نیست."
      );

    }


    const keyboard =
      new InlineKeyboard()

        .text(
          "₿ Bitcoin",
          `pay:${plan.id}:btc`
        )
        .row()

        .text(
          "🔷 TRON",
          `pay:${plan.id}:trx`
        )
        .row()

        .text(
          "💵 USDT",
          `pay:${plan.id}:usdttrc20`
        )
        .row()

        .text(
          "🔙 بازگشت",
          "buy"
        );


    await ctx.reply(

      `📦 <b>${escapeHtml(
        plan.name
      )}</b>\n\n` +

      `💾 حجم: ${plan.gb} GB\n` +

      `⏱ مدت: ${plan.days} روز\n` +

      `💰 قیمت: $${plan.price}\n\n` +

      `ارز پرداخت را انتخاب کنید:`,

      {

        parse_mode:
          "HTML",

        reply_markup:
          keyboard

      }

    );

  }
);


/* =====================================================
   CREATE PAYMENT
===================================================== */

bot.callbackQuery(
  /^pay:(\d+):([a-zA-Z0-9_-]+)$/,
  async (ctx) => {

    await ctx.answerCallbackQuery();


    const planId =
      Number(
        ctx.match[1]
      );


    const cryptoCurrency =
      String(
        ctx.match[2]
      ).toLowerCase();


    const telegramId =
      String(
        ctx.from.id
      );


    saveTelegramUser(
      ctx.from
    );


    const plan =
      db.prepare(`
        SELECT *
        FROM plans
        WHERE id = ?
          AND active = 1
      `).get(
        planId
      );


    if (!plan) {

      return ctx.reply(
        "پلن پیدا نشد."
      );

    }


    const orderCode =
      createOrderCode();


    const expiresAt =
      new Date(
        Date.now() +
        PAYMENT_EXPIRE_MINUTES *
        60 *
        1000
      ).toISOString();


    db.prepare(`
      INSERT INTO orders
      (
        order_code,
        telegram_id,
        plan_id,
        plan_name,
        price,
        price_currency,
        crypto_currency,
        expires_at
      )

      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(

      orderCode,

      telegramId,

      plan.id,

      plan.name,

      Number(plan.price),

      plan.currency ||
        PRICE_CURRENCY,

      cryptoCurrency,

      expiresAt

    );


    const order =
      db.prepare(`
        SELECT *
        FROM orders
        WHERE order_code = ?
      `).get(
        orderCode
      );


    try {

      const payment =
        await createCryptoPayment(
          order
        );


      const payAddress =
        payment.pay_address ||
        "";

      const payAmount =
        payment.pay_amount ||
        "";

      const paymentUrl =
        payment.payment_url ||
        payment.invoice_url ||
        payment.pay_url ||
        "";


      db.prepare(`
        UPDATE orders

        SET
          payment_id = ?,
          pay_address = ?,
          pay_amount = ?,
          payment_url = ?,
          provider_status = ?

        WHERE order_code = ?
      `).run(

        String(
          payment.payment_id || ""
        ),

        payAddress,

        payAmount,

        paymentUrl,

        payment.payment_status ||
          "waiting",

        orderCode

      );


      const keyboard =
        new InlineKeyboard();


      if (paymentUrl) {

        keyboard.url(
          "💳 پرداخت",
          paymentUrl
        );

        keyboard.row();

      }


      keyboard.text(
        "🔄 بررسی وضعیت",
        `check:${orderCode}`
      );


      await ctx.reply(

        `💳 <b>پرداخت ایجاد شد</b>\n\n` +

        `🧾 سفارش:\n` +
        `<code>${escapeHtml(
          orderCode
        )}</code>\n\n` +

        `📦 ${escapeHtml(
          plan.name
        )}\n` +

        `💰 مبلغ: $${plan.price}\n` +

        `🪙 ارز: ${escapeHtml(
          cryptoCurrency.toUpperCase()
        )}\n\n` +

        (
          payAmount
            ? `💵 مبلغ پرداختی:\n<code>${escapeHtml(
                payAmount
              )}</code>\n\n`
            : ""
        ) +

        (
          payAddress
            ? `📍 آدرس پرداخت:\n<code>${escapeHtml(
                payAddress
              )}</code>\n\n`
            : ""
        ) +

        `⏳ اعتبار سفارش: ${PAYMENT_EXPIRE_MINUTES} دقیقه\n\n` +

        `بعد از پرداخت، سیستم به‌صورت خودکار تراکنش را بررسی و سفارش را تأیید می‌کند.`,

        {

          parse_mode:
            "HTML",

          reply_markup:
            keyboard

        }

      );

    } catch (error) {

      console.error(
        "Create payment error:",
        error.response?.data ||
        error.message
      );


      db.prepare(`
        UPDATE orders

        SET status = 'failed'

        WHERE order_code = ?
      `).run(
        orderCode
      );


      await ctx.reply(

        `❌ ایجاد پرداخت انجام نشد.\n\n` +

        `لطفاً چند لحظه بعد دوباره تلاش کنید.`

      );

    }

  }
);


/* =====================================================
   CHECK PAYMENT
===================================================== */

bot.callbackQuery(
  /^check:(.+)$/,
  async (ctx) => {

    await ctx.answerCallbackQuery();


    const orderCode =
      String(
        ctx.match[1]
      );


    const order =
      db.prepare(`
        SELECT *
        FROM orders
        WHERE order_code = ?
          AND telegram_id = ?
      `).get(

        orderCode,

        String(
          ctx.from.id
        )

      );


    if (!order) {

      return ctx.reply(
        "سفارش پیدا نشد."
      );

    }


    await ctx.reply(
      `🔄 وضعیت سفارش در حال بررسی است...\n\n` +
      `🧾 ${order.order_code}\n` +
      `📌 وضعیت: ${order.status}`
    );

  }
);


/* =====================================================
   MY ORDERS
===================================================== */

bot.callbackQuery(
  "my_orders",
  async (ctx) => {

    await ctx.answerCallbackQuery();


    const orders =
      db.prepare(`
        SELECT *
        FROM orders
        WHERE telegram_id = ?
        ORDER BY id DESC
        LIMIT 10
      `).all(

        String(
          ctx.from.id
        )

      );


    if (!orders.length) {

      return ctx.reply(
        "هنوز سفارشی ثبت نکرده‌اید."
      );

    }


    let text =
      "📦 <b>سفارش‌های من</b>\n\n";


    for (
      const order of orders
    ) {

      let icon =
        "⏳";


      if (
        order.status === "paid"
      ) {

        icon = "✅";

      } else if (
        order.status === "expired" ||
        order.status === "failed"
      ) {

        icon = "❌";

      }


      text +=

        `${icon} <b>${escapeHtml(
          order.plan_name
        )}</b>\n` +

        `🧾 <code>${escapeHtml(
          order.order_code
        )}</code>\n` +

        `💰 $${order.price}\n` +

        `📌 ${escapeHtml(
          order.status
        )}\n\n`;

    }


    await ctx.reply(
      text,
      {
        parse_mode:
          "HTML"
      }
    );

  }
);


/* =====================================================
   SUBSCRIPTIONS
===================================================== */

bot.callbackQuery(
  "my_subscriptions",
  async (ctx) => {

    await ctx.answerCallbackQuery();


    const rows =
      db.prepare(`
        SELECT *
        FROM orders
        WHERE telegram_id = ?
          AND status = 'paid'
          AND subscription_url IS NOT NULL
        ORDER BY id DESC
      `).all(

        String(
          ctx.from.id
        )

      );


    if (!rows.length) {

      return ctx.reply(
        "هنوز اشتراک فعالی برای شما ثبت نشده است."
      );

    }


    let text =
      "🔗 <b>اشتراک‌های من</b>\n\n";


    for (
      const row of rows
    ) {

      text +=

        `📦 ${escapeHtml(
          row.plan_name
        )}\n\n` +

        `<code>${escapeHtml(
          row.subscription_url
        )}</code>\n\n`;

    }


    await ctx.reply(
      text,
      {
        parse_mode:
          "HTML"
      }
    );

  }
);


/* =====================================================
   SUPPORT
===================================================== */

bot.callbackQuery(
  "support",
  async (ctx) => {

    await ctx.answerCallbackQuery();


    await ctx.reply(

      `💬 <b>پشتیبانی Emad Net</b>\n\n` +

      `اگر در خرید، پرداخت یا اشتراک مشکل دارید، پیام خود را همینجا ارسال کنید.\n\n` +

      `پشتیبانی به‌زودی به سیستم تیکت متصل می‌شود.`,

      {
        parse_mode:
          "HTML"
      }

    );

  }
);


/* =====================================================
   ADMIN COMMAND
===================================================== */

bot.command(
  "admin",
  async (ctx) => {

    if (
      !isAdmin(
        ctx.from.id
      )
    ) {

      return ctx.reply(
        "⛔ دسترسی ندارید."
      );

    }


    const users =
      db.prepare(
        "SELECT COUNT(*) AS count FROM users"
      ).get().count;


    const orders =
      db.prepare(
        "SELECT COUNT(*) AS count FROM orders"
      ).get().count;


    const paid =
      db.prepare(`
        SELECT COUNT(*) AS count
        FROM orders
        WHERE status = 'paid'
      `).get().count;


    const income =
      db.prepare(`
        SELECT COALESCE(
          SUM(price),
          0
        ) AS total

        FROM orders

        WHERE status = 'paid'
      `).get().total;


    await ctx.reply(

      `👨‍💼 <b>پنل مدیریت Emad Net</b>\n\n` +

      `👤 کاربران: ${users}\n` +

      `🛒 سفارش‌ها: ${orders}\n` +

      `✅ پرداخت موفق: ${paid}\n` +

      `💰 درآمد: $${income}`,

      {
        parse_mode:
          "HTML"
      }

    );

  }
);


/* =====================================================
   ADMIN PLANS
===================================================== */

bot.command(
  "plans",
  async (ctx) => {

    if (
      !isAdmin(
        ctx.from.id
      )
    ) {

      return ctx.reply(
        "⛔ دسترسی ندارید."
      );

    }


    const plans =
      db.prepare(`
        SELECT *
        FROM plans
        ORDER BY id ASC
      `).all();


    let text =
      "📦 <b>پلن‌ها</b>\n\n";


    for (
      const plan of plans
    ) {

      text +=

        `#${plan.id} ` +
        `${escapeHtml(
          plan.name
        )}\n` +

        `${plan.gb}GB / ` +
        `${plan.days} روز / ` +
        `$${plan.price}\n` +

        `فعال: ${
          plan.active
            ? "بله"
            : "خیر"
        }\n\n`;

    }


    await ctx.reply(
      text,
      {
        parse_mode:
          "HTML"
      }
    );

  }
);


/* =====================================================
   ADMIN ORDERS
===================================================== */

bot.command(
  "orders",
  async (ctx) => {

    if (
      !isAdmin(
        ctx.from.id
      )
    ) {

      return ctx.reply(
        "⛔ دسترسی ندارید."
      );

    }


    const orders =
      db.prepare(`
        SELECT *
        FROM orders
        ORDER BY id DESC
        LIMIT 20
      `).all();


    if (!orders.length) {

      return ctx.reply(
        "هیچ سفارشی وجود ندارد."
      );

    }


    let text =
      "🛒 <b>آخرین سفارش‌ها</b>\n\n";


    for (
      const order of orders
    ) {

      text +=

        `🧾 <code>${escapeHtml(
          order.order_code
        )}</code>\n` +

        `👤 ${escapeHtml(
          order.telegram_id
        )}\n` +

        `📦 ${escapeHtml(
          order.plan_name
        )}\n` +

        `💰 $${order.price}\n` +

        `📌 ${escapeHtml(
          order.status
        )}\n\n`;

    }


    await ctx.reply(
      text,
      {
        parse_mode:
          "HTML"
      }
    );

  }
);


/* =====================================================
   ADMIN BACKUP COMMAND
===================================================== */

bot.command(
  "backup",
  async (ctx) => {

    if (
      !isAdmin(
        ctx.from.id
      )
    ) {

      return ctx.reply(
        "⛔ دسترسی ندارید."
      );

    }


    try {

      const file =
        createBackup();


      await ctx.reply(
        `✅ بکاپ ساخته شد:\n\n<code>${escapeHtml(
          path.basename(file)
        )}</code>`,
        {
          parse_mode:
            "HTML"
        }
      );

    } catch (error) {

      console.error(
        error
      );

      await ctx.reply(
        "❌ ساخت بکاپ انجام نشد."
      );

    }

  }
);


/* =====================================================
   BACKUP
===================================================== */

function createBackup() {

  const timestamp =
    new Date()
      .toISOString()
      .replace(
        /[:.]/g,
        "-"
      );


  const fileName =
    `emadnet-${timestamp}.db`;


  const destination =
    path.join(
      path.resolve(
        BACKUP_DIR
      ),
      fileName
    );


  db.pragma(
    "wal_checkpoint(TRUNCATE)"
  );


  fs.copyFileSync(
    path.resolve(
      DATABASE_FILE
    ),
    destination
  );


  db.prepare(`
    INSERT INTO backups
    (file_name)
    VALUES (?)
  `).run(
    fileName
  );


  cleanupBackups();


  console.log(
    "Backup created:",
    destination
  );


  return destination;

}


/* =====================================================
   BACKUP CLEANUP
===================================================== */

function cleanupBackups() {

  const files =
    fs.readdirSync(
      path.resolve(
        BACKUP_DIR
      )
    )
    .filter(
      file =>
        file.endsWith(".db")
    )
    .map(
      file => {

        const fullPath =
          path.join(
            path.resolve(
              BACKUP_DIR
            ),
            file
          );

        return {

          file,

          fullPath,

          time:
            fs.statSync(
              fullPath
            ).mtimeMs

        };

      }
    )
    .sort(
      (
        a,
        b
      ) =>
        b.time -
        a.time
    );


  const remove =
    files.slice(
      BACKUP_RETENTION
    );


  for (
    const item of remove
  ) {

    try {

      fs.unlinkSync(
        item.fullPath
      );

    } catch {}

  }

}


/* =====================================================
   AUTO BACKUP
===================================================== */

if (
  BACKUP_ENABLED
) {

  cron.schedule(
    BACKUP_CRON,
    () => {

      try {

        createBackup();

      } catch (error) {

        console.error(
          "Automatic backup error:",
          error
        );

      }

    }
  );


  console.log(
    `Automatic backup enabled: ${BACKUP_CRON}`
  );

}


/* =====================================================
   EXPIRE ORDERS
===================================================== */

cron.schedule(
  "*/5 * * * *",
  () => {

    try {

      const now =
        new Date().toISOString();


      const result =
        db.prepare(`
          UPDATE orders

          SET status = 'expired'

          WHERE status = 'pending'

            AND expires_at IS NOT NULL

            AND expires_at < ?
        `).run(
          now
        );


      if (
        result.changes > 0
      ) {

        console.log(
          `Expired orders: ${result.changes}`
        );

      }

    } catch (error) {

      console.error(
        "Expire orders error:",
        error
      );

    }

  }
);


/* =====================================================
   BOT ERROR
===================================================== */

bot.catch(
  (error) => {

    console.error(
      "Telegram bot error:",
      error.error
    );

  }
);


/* =====================================================
   START EXPRESS
===================================================== */

app.listen(
  PORT,
  "0.0.0.0",
  () => {

    console.log(
      `Emad Net API running on port ${PORT}`
    );

  }
);


/* =====================================================
   START TELEGRAM
===================================================== */

(async () => {

  try {

    console.log(
      "Starting Telegram bot..."
    );


    await bot.api.setMyCommands([

      {
        command:
          "start",

        description:
          "شروع ربات"

      },

      {
        command:
          "plans",

        description:
          "لیست پلن‌ها"

      },

      {
        command:
          "orders",

        description:
          "سفارش‌ها"

      },

      {
        command:
          "backup",

        description:
          "ساخت بکاپ"

      },

      {
        command:
          "admin",

        description:
          "مدیریت"

      }

    ]);


    await bot.start({

      onStart:
        (info) => {

          console.log(
            `Telegram bot @${info.username} started.`
          );

        }

    });

  } catch (error) {

    console.error(
      "Telegram startup error:",
      error
    );

    process.exit(1);

  }

})();
