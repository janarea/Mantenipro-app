/** ManteniPro Push API — Cloudflare Worker + D1 + Firebase Cloud Messaging HTTP v1.
 * Required binding: DB (D1 database `mantenipro-db`)
 * Required variables/secrets: FIREBASE_PROJECT_ID (Text), FIREBASE_SERVICE_ACCOUNT_JSON (Secret)
 * Cron: every minute (`* * * * *`).
 */
const APP_ORIGIN = 'https://janarea.github.io';
const OAUTH_URL = 'https://oauth2.googleapis.com/token';
const FCM_SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
const FCM_ENDPOINT = project => `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(project)}/messages:send`;
let oauthCache = { token: null, expiresAt: 0 };

function json(data, status = 200, origin = APP_ORIGIN) {
  return new Response(JSON.stringify(data), { status, headers: {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'Authorization,Content-Type',
    'access-control-max-age': '86400',
    'cache-control': 'no-store',
    'vary': 'Origin'
  }});
}
function b64url(bytes) {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}
function textB64url(value) { return b64url(new TextEncoder().encode(value)); }
async function sha256(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}
function randomToken(bytes = 32) {
  const raw = crypto.getRandomValues(new Uint8Array(bytes));
  return b64url(raw);
}
function fromPem(pem) {
  const b64 = pem.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, '');
  const binary = atob(b64); const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}
async function getOAuthToken(env) {
  if (oauthCache.token && oauthCache.expiresAt > Date.now() + 60000) return oauthCache.token;
  const account = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_JSON || '{}');
  if (!account.client_email || !account.private_key || !env.FIREBASE_PROJECT_ID) throw new Error('Firebase server credentials are incomplete');
  if (account.project_id && account.project_id !== env.FIREBASE_PROJECT_ID) throw new Error('Firebase service account project_id does not match FIREBASE_PROJECT_ID');
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT', kid: account.private_key_id };
  const claim = { iss: account.client_email, scope: FCM_SCOPE, aud: OAUTH_URL, iat: now, exp: now + 3600 };
  const unsigned = `${textB64url(JSON.stringify(header))}.${textB64url(JSON.stringify(claim))}`;
  const key = await crypto.subtle.importKey('pkcs8', fromPem(account.private_key), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned));
  const assertion = `${unsigned}.${b64url(new Uint8Array(signature))}`;
  const response = await fetch(OAUTH_URL, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }) });
  const payload = await response.json();
  if (!response.ok || !payload.access_token) throw new Error(`Google OAuth ${response.status}: ${payload.error_description || payload.error || 'token error'}`);
  oauthCache = { token: payload.access_token, expiresAt: Date.now() + (Number(payload.expires_in) || 3600) * 1000 };
  return oauthCache.token;
}
async function sendFcm(env, registrationToken, payload) {
  const token = await getOAuthToken(env);
  const response = await fetch(FCM_ENDPOINT(env.FIREBASE_PROJECT_ID), { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ message: {
    token: registrationToken,
    data: Object.fromEntries(Object.entries({
      title: String(payload.title || 'ManteniPro').slice(0, 120),
      body: String(payload.body || 'Tienes un aviso pendiente.').slice(0, 500),
      tag: String(payload.tag || 'mantenipro'),
      url: String(payload.data?.url || './'),
      ...(payload.data || {})
    }).map(([k, v]) => [String(k), String(v ?? '')])),
    webpush: { headers: { Urgency: 'high', TTL: '86400' } }
  }}) });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = JSON.stringify(result);
    const error = new Error(`FCM ${response.status}: ${message.slice(0, 500)}`);
    error.status = response.status; error.payload = result; throw error;
  }
  return result;
}
async function authenticate(request, env) {
  const auth = request.headers.get('authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (token.length < 32) return null;
  const hash = await sha256(token);
  const row = await env.DB.prepare('SELECT id FROM installations WHERE token_hash=? AND active=1').bind(hash).first();
  if (row) await env.DB.prepare('UPDATE installations SET last_seen_at=?, updated_at=? WHERE id=?').bind(Math.floor(Date.now()/1000), Math.floor(Date.now()/1000), row.id).run();
  return row || null;
}
function safeTimezone(value) {
  const candidate = typeof value === 'string' ? value.slice(0, 80) : 'Europe/Madrid';
  try { new Intl.DateTimeFormat('en-US', { timeZone: candidate }); return candidate; }
  catch (_) { return 'Europe/Madrid'; }
}

async function handleApi(request, env) {
  const url = new URL(request.url);
  const origin = request.headers.get('origin') || '';
  if (origin && origin !== APP_ORIGIN) return json({ error: 'Origin not allowed' }, 403);
  if (request.method === 'OPTIONS') return json({ ok: true });
  if (request.method === 'GET' && url.pathname === '/health') return json({ ok: true, service: 'mantenipro-push', firebaseConfigured: Boolean(env.FIREBASE_SERVICE_ACCOUNT_JSON && env.FIREBASE_PROJECT_ID), databaseConfigured: Boolean(env.DB) });
  if (request.method === 'POST' && url.pathname === '/api/installations') {
    const now = Math.floor(Date.now()/1000);
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    const ipHash = await sha256(`${env.RATE_LIMIT_SALT || env.FIREBASE_PROJECT_ID}:${ip}`);
    const limit = await env.DB.prepare('SELECT window_started_at,request_count FROM registration_rate_limits WHERE ip_hash=?').bind(ipHash).first();
    if (limit && now - Number(limit.window_started_at) < 3600 && Number(limit.request_count) >= 50) {
      return json({ error: 'Demasiados registros desde esta conexión. Inténtalo más tarde.' }, 429);
    }
    if (!limit || now - Number(limit.window_started_at) >= 3600) {
      await env.DB.prepare(`INSERT INTO registration_rate_limits (ip_hash,window_started_at,request_count,updated_at)
        VALUES (?,?,1,?) ON CONFLICT(ip_hash) DO UPDATE SET window_started_at=excluded.window_started_at,request_count=1,updated_at=excluded.updated_at`)
        .bind(ipHash, now, now).run();
    } else {
      await env.DB.prepare('UPDATE registration_rate_limits SET request_count=request_count+1,updated_at=? WHERE ip_hash=?')
        .bind(now, ipHash).run();
    }
    const body = await request.json().catch(() => ({}));
    const timezone = safeTimezone(body.timezone);
    const id = crypto.randomUUID(); const installationToken = randomToken(32);
    await env.DB.prepare('INSERT INTO installations (id,token_hash,timezone,active,created_at,updated_at,last_seen_at) VALUES (?,?,?,1,?,?,?)')
      .bind(id, await sha256(installationToken), timezone, now, now, now).run();
    return json({ installationId: id, installationToken });
  }
  const installation = await authenticate(request, env);
  if (!installation) return json({ error: 'Unauthorized installation' }, 401);
  if (request.method === 'POST' && url.pathname === '/api/push/register') {
    const body = await request.json().catch(() => null);
    const fcmToken = String(body?.fcmToken || '');
    if (fcmToken.length < 40 || fcmToken.length > 4096) return json({ error: 'Invalid FCM token' }, 400);
    const now = Math.floor(Date.now()/1000);
    await env.DB.prepare('UPDATE push_subscriptions SET active=0 WHERE installation_id=? AND fcm_token IS NOT NULL AND fcm_token<>?')
      .bind(installation.id, fcmToken).run();
    await env.DB.prepare(`INSERT INTO push_subscriptions (id,installation_id,endpoint,p256dh,auth,fcm_token,active,created_at,last_seen_at)
      VALUES (?,?,?,'fcm','fcm',?,1,?,?)
      ON CONFLICT(fcm_token) DO UPDATE SET installation_id=excluded.installation_id, endpoint=excluded.endpoint, active=1, last_seen_at=excluded.last_seen_at`)
      .bind(crypto.randomUUID(), installation.id, `fcm:${await sha256(fcmToken)}`, fcmToken, now, now).run();
    return json({ ok: true });
  }
  if (request.method === 'POST' && url.pathname === '/api/reminders/sync') {
    const body = await request.json().catch(() => null);
    if (!body || !Array.isArray(body.reminders) || body.reminders.length > 500) return json({ error: 'Invalid reminders snapshot' }, 400);
    const now = Math.floor(Date.now()/1000);
    const existing = await env.DB.prepare("SELECT id,fire_at,status FROM reminders WHERE installation_id=? AND status IN ('pending','sending')").bind(installation.id).all();
    const incoming = new Map();
    for (const item of body.reminders) {
      const sourceId = String(item.id || ''); const id = `${installation.id}:${sourceId}`; const fireAt = Number(item.fireAt);
      if (!sourceId || sourceId.length > 180 || !Number.isInteger(fireAt) || fireAt < 0 || fireAt > now + 60*60*24*366*5) continue;
      incoming.set(id, { id, fireAt, title: String(item.title || 'ManteniPro').slice(0,120), body: String(item.body || '').slice(0,500), timezone: safeTimezone(item.timezone), repeatRule: ['none','daily','weekly','monthly'].includes(item.repeatRule) ? item.repeatRule : 'none', taskId: item.taskId ? String(item.taskId).slice(0,180) : '', jobId: item.jobId ? String(item.jobId).slice(0,180) : '' });
    }
    const statements = [];
    for (const row of existing.results || []) if (!incoming.has(row.id) && row.status === 'pending') statements.push(env.DB.prepare("UPDATE reminders SET status='cancelled',updated_at=? WHERE id=? AND installation_id=? AND status='pending'").bind(now, row.id, installation.id));
    for (const item of incoming.values()) {
      statements.push(env.DB.prepare(`INSERT INTO reminders (id,installation_id,title,body,fire_at,timezone,repeat_rule,status,created_at,updated_at,attempt_count)
        VALUES (?,?,?,?,?,?,?,'pending',?,?,0)
        ON CONFLICT(id) DO UPDATE SET title=excluded.title,body=excluded.body,timezone=excluded.timezone,repeat_rule=excluded.repeat_rule,
        status=CASE WHEN reminders.fire_at<>excluded.fire_at OR reminders.status IN ('cancelled','failed') THEN 'pending' ELSE reminders.status END,
        fire_at=excluded.fire_at,updated_at=excluded.updated_at,attempt_count=CASE WHEN reminders.fire_at<>excluded.fire_at THEN 0 ELSE reminders.attempt_count END`)
        .bind(item.id, installation.id, item.title, item.body, item.fireAt, item.timezone, item.repeatRule, now, now));
    }
    if (statements.length) await env.DB.batch(statements);
    return json({ ok: true, synchronized: incoming.size, cancelled: (existing.results || []).filter(x => !incoming.has(x.id)).length });
  }
  if (request.method === 'POST' && url.pathname === '/api/push/test') {
    const row = await env.DB.prepare('SELECT fcm_token FROM push_subscriptions WHERE installation_id=? AND active=1 ORDER BY last_seen_at DESC LIMIT 1').bind(installation.id).first();
    if (!row?.fcm_token) return json({ error: 'No FCM device registered' }, 409);
    await sendFcm(env, row.fcm_token, { title: 'ManteniPro · Prueba Push', body: 'La conexión con el servicio de notificaciones funciona.', tag: 'mantenipro-test', data: { url: './', kind: 'test' } });
    return json({ ok: true });
  }
  return json({ error: 'Not found' }, 404);
}
function zonedParts(epochSeconds, timezone) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: timezone || 'Europe/Madrid', year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', second:'2-digit', hourCycle:'h23' }).formatToParts(new Date(epochSeconds * 1000));
  const out={}; for(const part of parts) if(part.type!=='literal') out[part.type]=Number(part.value);
  return out;
}
function localPartsToEpoch(parts, timezone) {
  const target=Date.UTC(parts.year,parts.month-1,parts.day,parts.hour,parts.minute,parts.second||0);
  let guess=target;
  for(let i=0;i<4;i++) {
    const actual=zonedParts(Math.floor(guess/1000),timezone);
    const represented=Date.UTC(actual.year,actual.month-1,actual.day,actual.hour,actual.minute,actual.second);
    const delta=target-represented;
    if(!delta) break;
    guess+=delta;
  }
  return Math.floor(guess/1000);
}
function nextRecurringFire(reminder) {
  const tz=reminder.timezone || 'Europe/Madrid';
  const p=zonedParts(reminder.fire_at,tz);
  const date=new Date(Date.UTC(p.year,p.month-1,p.day));
  if(reminder.repeat_rule==='daily') date.setUTCDate(date.getUTCDate()+1);
  else if(reminder.repeat_rule==='weekly') date.setUTCDate(date.getUTCDate()+7);
  else if(reminder.repeat_rule==='monthly') {
    const wantedDay=p.day;
    date.setUTCDate(1); date.setUTCMonth(date.getUTCMonth()+1);
    const lastDay=new Date(Date.UTC(date.getUTCFullYear(),date.getUTCMonth()+1,0)).getUTCDate();
    date.setUTCDate(Math.min(wantedDay,lastDay));
  }
  return localPartsToEpoch({year:date.getUTCFullYear(),month:date.getUTCMonth()+1,day:date.getUTCDate(),hour:p.hour,minute:p.minute,second:p.second},tz);
}

async function sendDueReminders(env) {
  const now = Math.floor(Date.now()/1000);
  await env.DB.prepare("UPDATE reminders SET status='pending',updated_at=? WHERE status='sending' AND updated_at<?").bind(now, now-300).run();
  const due = await env.DB.prepare("SELECT * FROM reminders WHERE status='pending' AND fire_at<=? ORDER BY fire_at LIMIT 10").bind(now).all();
  for (const reminder of due.results || []) {
    const claim = await env.DB.prepare("UPDATE reminders SET status='sending',updated_at=? WHERE id=? AND status='pending'").bind(now, reminder.id).run();
    if (!claim.meta?.changes) continue;
    const subs = await env.DB.prepare('SELECT id,fcm_token FROM push_subscriptions WHERE installation_id=? AND active=1 AND fcm_token IS NOT NULL').bind(reminder.installation_id).all();
    let sent = 0; let errors = [];
    for (const sub of subs.results || []) {
      try {
        const data = { url: './' };
        const sourceId = String(reminder.id).slice(String(reminder.installation_id).length + 1);
        if (sourceId.startsWith('job:')) data.jobId = sourceId.slice(4).split(':')[0];
        if (sourceId.startsWith('task:')) data.taskId = sourceId.slice(5);
        await sendFcm(env, sub.fcm_token, { title: reminder.title, body: reminder.body, tag: `mantenipro-${reminder.id}`, data });
        sent++;
      } catch (error) {
        errors.push(error.message);
        if (error.status === 404 || /UNREGISTERED|registration-token-not-registered/i.test(error.message)) {
          await env.DB.prepare('UPDATE push_subscriptions SET active=0 WHERE id=?').bind(sub.id).run();
        }
      }
    }
    if (sent > 0) {
      if (String(reminder.id).slice(String(reminder.installation_id).length + 1).startsWith('task:') && ['daily','weekly','monthly'].includes(reminder.repeat_rule)) {
        const nextFire = nextRecurringFire(reminder);
        await env.DB.prepare("UPDATE reminders SET status='pending',fire_at=?,sent_at=?,attempt_count=0,last_error=NULL,updated_at=? WHERE id=?").bind(nextFire, now, now, reminder.id).run();
      } else {
        await env.DB.prepare("UPDATE reminders SET status='sent',sent_at=?,last_error=NULL,updated_at=? WHERE id=?").bind(now, now, reminder.id).run();
      }
    } else {
      const attempts = (Number(reminder.attempt_count)||0)+1;
      const terminal = attempts >= 5 || !(subs.results || []).length;
      await env.DB.prepare('UPDATE reminders SET status=?,attempt_count=?,fire_at=?,last_error=?,updated_at=? WHERE id=?')
        .bind(terminal ? 'failed' : 'pending', attempts, terminal ? reminder.fire_at : now + Math.min(3600, 60 * 2 ** attempts), errors.join(' | ').slice(0,1000) || 'No active FCM subscriptions', now, reminder.id).run();
    }
  }
}
export default {
  async fetch(request, env) {
    try { return await handleApi(request, env); }
    catch (error) { console.error('ManteniPro Push API error:', error); return json({ error: 'Internal service error' }, 500); }
  },
  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(Promise.all([
      sendDueReminders(env),
      env.DB.prepare('DELETE FROM registration_rate_limits WHERE updated_at < ?').bind(Math.floor(Date.now()/1000) - 86400).run()
    ]));
  }
};
