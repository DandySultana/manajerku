const Module = require('module');
const fs = require('fs');
const fsPromises = require('fs/promises');
const path = require('path');
const { execSync } = require('child_process');
const { PassThrough } = require('stream');
const http = require('http');

// Pastikan seluruh file sesi (SESI_BOT_UTAMA.data.json, patches.cache.json, .open-wa) berada di folder botwa
if (process.cwd() !== __dirname) {
  process.chdir(__dirname);
}

// Fix kompabilitas Windows untuk @open-wa/core v5.10.0:
// Windows menolak fsync()/open() (EPERM/EINVAL/EISDIR) pada direktori saat menyimpan SESI_BOT_UTAMA.data.json
if (process.platform === 'win32') {
  const originalFsPromisesOpen = fsPromises.open.bind(fsPromises);
  fsPromises.open = async function patchedWindowsDirOpen(filePath, flags, mode) {
    let isDir = false;
    try {
      isDir = fs.lstatSync(String(filePath)).isDirectory();
    } catch {
      isDir = false;
    }

    let handle;
    try {
      handle = await originalFsPromisesOpen(filePath, flags, mode);
    } catch (err) {
      if (isDir && err && ['EPERM', 'EINVAL', 'EISDIR', 'EACCES'].includes(err.code)) {
        return {
          fd: -1,
          sync: async () => {},
          close: async () => {},
          stat: async () => fs.lstatSync(String(filePath)),
        };
      }
      throw err;
    }

    if (isDir && handle && typeof handle.sync === 'function') {
      const originalSync = handle.sync.bind(handle);
      handle.sync = async function safeDirSync() {
        try {
          return await originalSync();
        } catch (err) {
          if (err && ['EPERM', 'EINVAL', 'EISDIR'].includes(err.code)) {
            return;
          }
          throw err;
        }
      };
    }

    return handle;
  };
}

// Fallback aman untuk @open-wa/wa-automate v5.10.0 di Windows ketika binary zstd.exe belum terpasang di PATH
let hasSystemZstd = false;
try {
  execSync(process.platform === 'win32' ? 'where zstd.exe' : 'which zstd', {
    stdio: 'ignore',
  });
  hasSystemZstd = true;
} catch {
  hasSystemZstd = false;
}

if (!hasSystemZstd) {
  const originalModuleLoad = Module._load;
  Module._load = function patchedSimpleZstdLoad(request, parent, isMain) {
    if (request === 'simple-zstd') {
      return {
        SimpleZSTD: class SimpleZSTD {
          static async create() {
            return new SimpleZSTD();
          }
          async destroy() {}
          async compress() {
            return new PassThrough();
          }
          async compressBuffer(buf) {
            return buf;
          }
          async decompress() {
            return new PassThrough();
          }
          async decompressBuffer(buf) {
            return buf;
          }
        },
        ZSTDCompress: () => new PassThrough(),
        ZSTDDecompress: () => new PassThrough(),
        compress: async (buf) => buf,
        compressBuffer: async (buf) => buf,
        decompress: async (buf) => buf,
        decompressBuffer: async (buf) => buf,
        createDictionary: async () => Buffer.alloc(0),
        clearDictionaryCache: async () => {},
      };
    }
    return originalModuleLoad.call(this, request, parent, isMain);
  };
}

const { create } = require('@open-wa/wa-automate');

// Konfigurasi koneksi dua arah antara BotWA dan Aplikasi Web Manajerku
const MANAJERKU_WEB_URL = process.env.MANAJERKU_WEB_URL || 'http://localhost:3000';
const BOTWA_PORT = Number(process.env.OPENWA_PORT || 8085);
const BOTWA_API_KEY = process.env.OPENWA_API_KEY || 'manajerku-secret';

// Menyimpan ID pesan keluar yang dikirim oleh BotWA agar tidak memicu loop balasan
const sentBotMessageIds = new Set();
// Mencegah pesan masuk dengan ID yang sama diproses dua kali saat reconnect WA Web
const processedInboundIds = new Set();

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withTimeout(promise, ms, label) {
  let timer = null;
  return Promise.race([
    Promise.resolve(promise),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Timeout (${ms}ms): ${label}`)), ms);
    }),
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function tandaiPesanKeluar(msgId) {
  if (!msgId || typeof msgId !== 'string') return;
  sentBotMessageIds.add(msgId);
  setTimeout(() => sentBotMessageIds.delete(msgId), 120000);
}

/**
 * Normalisasi nomor WhatsApp Indonesia ke format E.164 (+628xxx) & Chat ID (@c.us)
 */
function normalisasiNomorWa(rawPhone) {
  if (!rawPhone) return null;
  const rawStr = String(rawPhone).trim();
  if (/(@g\.us|@broadcast|@newsletter)$/i.test(rawStr)) {
    return null;
  }

  const digits = rawStr
    .replace(/@(c\.us|s\.whatsapp\.net|lid)$/i, '')
    .replace(/\D/g, '');

  let normalized = digits;
  if (normalized.startsWith('08')) {
    normalized = '628' + normalized.slice(2);
  } else if (normalized.startsWith('8') && normalized.length >= 9) {
    normalized = '62' + normalized;
  } else if (normalized.startsWith('0') && normalized.length >= 9) {
    normalized = '62' + normalized.slice(1);
  }

  if (normalized.length < 10 || normalized.length > 15) {
    return null;
  }

  return {
    e164: '+' + normalized,
    digits: normalized,
    chatId: normalized + '@c.us',
  };
}

/**
 * Mengambil nomor WhatsApp pengirim secara akurat meskipun WhatsApp Multi-Device memakai ID @lid
 */
async function resolveSenderPhoneFromMessage(client, message) {
  const candidates = [
    message.from,
    message.sender && message.sender.id,
    message.sender && message.sender.userid,
    message.chat && message.chat.contact && message.chat.contact.id,
    message.chat && message.chat.contact && message.chat.contact.userid,
    message.author,
  ].filter(Boolean);

  for (const cand of candidates) {
    if (!String(cand).includes('@lid')) {
      const norm = normalisasiNomorWa(cand);
      if (norm && norm.e164.startsWith('+62')) {
        return norm;
      }
    }
  }

  // Fallback jika semua ID berbentuk @lid: lookup detail kontak dengan batas timeout aman
  try {
    if (typeof client.getContact === 'function' && message.from) {
      const contact = await withTimeout(client.getContact(message.from), 3500, 'client.getContact');
      const pnCand =
        (contact &&
          (contact.userid ||
            contact.id ||
            (contact.phoneNumber && contact.phoneNumber.user))) ||
        '';
      if (pnCand && !String(pnCand).includes('@lid')) {
        const norm = normalisasiNomorWa(pnCand);
        if (norm) return norm;
      }
    }
  } catch {
    // Abaikan jika kontak tidak expose nomor PN atau timeout
  }

  // Fallback in-page: konversi @lid ke nomor HP asli lewat modul WAWebApiContact / ContactCollection
  if (message.from && String(message.from).includes('@lid') && typeof client.evaluate === 'function') {
    try {
      const pnResolved = await withTimeout(
        client.evaluate((lidId) => {
          const safeReq = (m) => {
            try {
              return typeof window.require === 'function' ? window.require(m) : null;
            } catch {
              return null;
            }
          };
          try {
            const wf = (window.Store && window.Store.WidFactory) || safeReq('WAWebWidFactory');
            const lidWid = wf && typeof wf.createWid === 'function' ? wf.createWid(lidId) : lidId;
            const apiContact = safeReq('WAWebApiContact');
            if (apiContact && typeof apiContact.getPhoneNumber === 'function') {
              const pnWid = apiContact.getPhoneNumber(lidWid);
              if (pnWid && pnWid.user && !String(pnWid._serialized || '').includes('@lid')) {
                return String(pnWid.user);
              }
            }
            const cols = safeReq('WAWebCollections') || {};
            const contactCol = (window.Store && window.Store.Contact) || cols.Contact;
            const c = contactCol && contactCol.get ? contactCol.get(lidId) || contactCol.get(lidWid) : null;
            if (c && c.phoneNumber && c.phoneNumber.user) {
              return String(c.phoneNumber.user);
            }
          } catch {}
          return null;
        }, message.from),
        2500,
        'resolveLidPhoneInPage'
      );
      if (pnResolved) {
        const norm = normalisasiNomorWa(pnResolved);
        if (norm) return norm;
      }
    } catch {
      // Abaikan jika LID mapping belum tersedia di browser
    }
  }

  for (const cand of candidates) {
    const norm = normalisasiNomorWa(cand);
    if (norm) return norm;
  }

  return null;
}

/**
 * Mengirim pesan langsung melalui WhatsApp Web Store / WAWeb modules di context browser.
 * Mendukung chat aktif (@lid / @c.us) maupun nomor supplier baru hasil scraping Playwright
 * tanpa terblokir bug return undefined di wapi.js:71 atau 'Not a contact'.
 */
async function kirimPesanViaStoreInPage(client, candidateIds, content, quotedMsgId) {
  return withTimeout(
    client.evaluate(
      async ({ ids, text, quoteId }) => {
        const debugErrors = [];
        let notRegisteredOnWa = false;
        const safeRequire = (modName) => {
          try {
            if (typeof window.require === 'function') {
              return window.require(modName);
            }
          } catch {}
          return null;
        };

        const findModuleByRegex = (regex, predicate) => {
          try {
            const dbg = safeRequire('__debug');
            const map = dbg && dbg.modulesMap;
            if (!map) return null;
            for (const key of Object.keys(map)) {
              if (!regex.test(key)) continue;
              const mod = safeRequire(key);
              if (mod && (!predicate || predicate(mod))) {
                return mod;
              }
            }
          } catch {}
          return null;
        };

        const collections = safeRequire('WAWebCollections') || {};
        const ChatCollection =
          (window.Store && window.Store.Chat) ||
          collections.Chat ||
          (safeRequire('WAWebChatCollection') &&
            (safeRequire('WAWebChatCollection').ChatCollection ||
              safeRequire('WAWebChatCollection').default));

        if (!ChatCollection) {
          return {
            ok: false,
            reason: 'STORE_NOT_READY',
            errors: ['ChatCollection tidak ditemukan di window.Store maupun WAWebCollections'],
          };
        }

        const WidFactory =
          (window.Store && window.Store.WidFactory) ||
          safeRequire('WAWebWidFactory') ||
          findModuleByRegex(/WidFactory/i, (m) => typeof m.createWid === 'function');

        const WapQuery =
          (window.Store && window.Store.WapQuery) ||
          safeRequire('WAWebQueryExistsJob') ||
          findModuleByRegex(
            /QueryExist/i,
            (m) => typeof m.queryExist === 'function' || typeof m.queryWidExists === 'function'
          );

        const FindChatAction =
          safeRequire('WAWebFindChatAction') ||
          findModuleByRegex(
            /FindChat/i,
            (m) =>
              typeof m.findOrCreateLatestChat === 'function' ||
              typeof m.findChat === 'function'
          );

        const ContactCollection =
          (window.Store && window.Store.Contact) ||
          collections.Contact ||
          (safeRequire('WAWebContactCollection') &&
            (safeRequire('WAWebContactCollection').ContactCollection ||
              safeRequire('WAWebContactCollection').default));

        const MsgCollection =
          (window.Store && window.Store.Msg) ||
          collections.Msg ||
          (safeRequire('WAWebMsgCollection') &&
            (safeRequire('WAWebMsgCollection').MsgCollection ||
              safeRequire('WAWebMsgCollection').default));

        const sendTextMod = safeRequire('WAWebSendTextMsgChatAction');
        const SendTextMsgToChat =
          (window.Store && window.Store.SendTextMsgToChat) ||
          (sendTextMod && sendTextMod.sendTextMsgToChat) ||
          (findModuleByRegex(/SendTextMsg/i, (m) => typeof m.sendTextMsgToChat === 'function') || {})
            .sendTextMsgToChat;

        const addSendMod = safeRequire('WAWebSendMsgChatAction');
        const addAndSendMsgToChat =
          (window.Store && window.Store.addAndSendMsgToChat) ||
          (addSendMod && addSendMod.addAndSendMsgToChat) ||
          (findModuleByRegex(/SendMsgChatAction/i, (m) => typeof m.addAndSendMsgToChat === 'function') || {})
            .addAndSendMsgToChat;

        const CmdObj =
          (window.Store && window.Store.Cmd) ||
          (safeRequire('WAWebCmd') && safeRequire('WAWebCmd').Cmd);

        const MsgKeyMod = safeRequire('WAWebMsgKey');
        const MsgKey = (window.Store && window.Store.MsgKey) || (MsgKeyMod && (MsgKeyMod.default || MsgKeyMod));
        const UserPrefs = safeRequire('WAWebUserPrefsMeUser');

        // Hotfix prototype sendMessage bawaan wapi.js yang lupa keyword `return`
        try {
          if (
            ChatCollection.modelClass &&
            ChatCollection.modelClass.prototype &&
            typeof SendTextMsgToChat === 'function'
          ) {
            const fnStr = String(ChatCollection.modelClass.prototype.sendMessage || '');
            if (fnStr.includes('SendTextMsgToChat') && !fnStr.includes('return')) {
              ChatCollection.modelClass.prototype.sendMessage = function () {
                return SendTextMsgToChat(this, ...arguments);
              };
            }
          }
        } catch {}

        const createWidSafe = (id) => {
          try {
            if (WidFactory && typeof WidFactory.createWid === 'function') {
              return WidFactory.createWid(id);
            }
            if (WidFactory && typeof WidFactory.createWidFromWidLike === 'function') {
              return WidFactory.createWidFromWidLike(id);
            }
          } catch {}
          return id;
        };

        const resolveCanonicalWid = async (id) => {
          const initialWid = createWidSafe(id);
          if (!WapQuery) return initialWid;

          const digits = String(id).replace(/@.*/, '').replace(/\D/g, '');
          const queries = [
            () => (typeof WapQuery.queryWidExists === 'function' ? WapQuery.queryWidExists(initialWid) : null),
            () => (typeof WapQuery.queryExist === 'function' ? WapQuery.queryExist(initialWid) : null),
            () => (typeof WapQuery.queryExist === 'function' ? WapQuery.queryExist(id) : null),
            () =>
              digits && typeof WapQuery.queryPhoneExists === 'function'
                ? WapQuery.queryPhoneExists(digits)
                : null,
          ];

          for (const runQ of queries) {
            try {
              const res = await runQ();
              if (res && (res.wid || res.jid)) {
                return res.wid || createWidSafe(res.jid);
              }
            } catch (err) {
              debugErrors.push(`query(${id}): ${err && err.message ? err.message : String(err)}`);
            }
          }
          return initialWid;
        };

        const resolveOrOpenChat = async (id, allowCreate) => {
          let chat = ChatCollection.get(id);
          if (chat) return chat;

          const wid = createWidSafe(id);
          if (wid && typeof wid !== 'string') {
            chat = ChatCollection.get(wid);
            if (chat) return chat;
          }

          if (!allowCreate) return null;

          const canonicalWid = await resolveCanonicalWid(id);
          if (canonicalWid && canonicalWid !== wid) {
            chat = ChatCollection.get(canonicalWid);
            if (chat) return chat;
          }

          const targetWids = [];
          const seenSerialized = new Set();
          for (const candidateWid of [canonicalWid, wid]) {
            if (!candidateWid) continue;
            const key =
              typeof candidateWid === 'string'
                ? candidateWid
                : candidateWid._serialized || String(candidateWid);
            if (!seenSerialized.has(key)) {
              seenSerialized.add(key);
              targetWids.push(candidateWid);
            }
          }

          // Cara 1: WAWebFindChatAction (standar WhatsApp Web 2024-2026 untuk membuka chat nomor baru)
          if (FindChatAction) {
            for (const tw of targetWids) {
              if (typeof FindChatAction.findOrCreateLatestChat === 'function') {
                try {
                  const found = await FindChatAction.findOrCreateLatestChat(tw, 'newChat');
                  const c = (found && found.chat) || found;
                  if (c) return c;
                } catch (err) {
                  const msg = err && err.message ? err.message : String(err);
                  debugErrors.push(`findOrCreateLatestChat(${id}): ${msg}`);
                  if (/No LID for user|not registered|unregistered/i.test(msg)) {
                    notRegisteredOnWa = true;
                    return null;
                  }
                }
              }
              if (typeof FindChatAction.findChat === 'function') {
                try {
                  const found = await FindChatAction.findChat(tw);
                  const c = (found && found.chat) || found;
                  if (c) return c;
                } catch (err) {
                  const msg = err && err.message ? err.message : String(err);
                  debugErrors.push(`findChat(${id}): ${msg}`);
                  if (/No LID for user|not registered|unregistered/i.test(msg)) {
                    notRegisteredOnWa = true;
                    return null;
                  }
                }
              }
            }
          }

          // Cara 2: ChatCollection.find
          if (typeof ChatCollection.find === 'function') {
            for (const tw of targetWids) {
              try {
                chat = await ChatCollection.find(tw);
                if (chat) return chat;
              } catch (err) {
                debugErrors.push(`Chat.find(${id}): ${err && err.message ? err.message : String(err)}`);
              }
            }
          }

          // Cara 3: Pastikan Contact ter-hydrate dulu lalu ChatCollection.find / gadd
          if (ContactCollection && typeof ContactCollection.find === 'function') {
            try {
              await ContactCollection.find(canonicalWid);
              if (typeof ChatCollection.find === 'function') {
                chat = await ChatCollection.find(canonicalWid);
                if (chat) return chat;
              }
            } catch (err) {
              debugErrors.push(`Contact.find(${id}): ${err && err.message ? err.message : String(err)}`);
            }
          }

          return null;
        };

        const extractLatestOutgoingId = (chat) => {
          try {
            const models =
              (chat.msgs &&
                (typeof chat.msgs.getModelsArray === 'function'
                  ? chat.msgs.getModelsArray()
                  : chat.msgs.models || chat.msgs._models || (Array.isArray(chat.msgs) ? chat.msgs : null))) ||
              [];
            for (let i = models.length - 1; i >= 0; i--) {
              const m = models[i];
              if (m && (m.__x_isSentByMe || (m.id && m.id.fromMe))) {
                if (m.id && m.id._serialized) return m.id._serialized;
              }
            }
            if (chat.lastReceivedKey && chat.lastReceivedKey._serialized) {
              return chat.lastReceivedKey._serialized;
            }
          } catch {}
          return null;
        };

        const trySendToChat = async (chat, rawId) => {
          const resolvedChatId = (chat.id && chat.id._serialized) || rawId;

          // Metode 1: SendTextMsgToChat (native action WhatsApp Web)
          if (typeof SendTextMsgToChat === 'function') {
            try {
              const res = await SendTextMsgToChat(chat, text);
              const failedResult =
                res === false ||
                (res && typeof res === 'object' && res.messageSendResult === 'ERROR');
              if (!failedResult) {
                return {
                  ok: true,
                  method: 'SendTextMsgToChat',
                  chatId: resolvedChatId,
                  msgId:
                    (res && res.id && res.id._serialized) ||
                    extractLatestOutgoingId(chat),
                };
              }
              debugErrors.push(`SendTextMsgToChat(${rawId}) returned error result`);
            } catch (err) {
              debugErrors.push(`SendTextMsgToChat(${rawId}): ${err && err.message ? err.message : String(err)}`);
            }
          } else {
            debugErrors.push('SendTextMsgToChat unavailable');
          }

          // Metode 2: addAndSendMsgToChat dengan MsgKey / template global
          if (typeof addAndSendMsgToChat === 'function' && MsgCollection) {
            try {
              const msgModels =
                (typeof MsgCollection.getModelsArray === 'function'
                  ? MsgCollection.getModelsArray()
                  : MsgCollection.models || MsgCollection._models || []) || [];
              const templateMsg =
                msgModels.find((m) => m && m.__x_isSentByMe && !m.quotedMsg) || msgModels[0];

              const newId =
                window.WAPI && typeof window.WAPI.getNewMessageId === 'function'
                  ? await window.WAPI.getNewMessageId(resolvedChatId)
                  : MsgKey && typeof MsgKey.newId === 'function'
                    ? new MsgKey({
                        from:
                          (UserPrefs && typeof UserPrefs.getMaybeMeUser === 'function' && UserPrefs.getMaybeMeUser()) ||
                          (templateMsg && templateMsg.from),
                        to: createWidSafe(resolvedChatId),
                        id: MsgKey.newId(),
                        selfDir: 'out',
                      })
                    : null;

              if (templateMsg && newId) {
                const tempMsg = Object.create(templateMsg);
                let extras = {};
                if (quoteId) {
                  const quotedMsg = MsgCollection.get(quoteId);
                  if (quotedMsg) {
                    extras = {
                      quotedMsg,
                      quotedParticipant: quotedMsg.author || quotedMsg.from,
                      quotedStanzaID: quotedMsg.id && quotedMsg.id.id,
                    };
                  }
                }
                Object.assign(tempMsg, {
                  ack: 0,
                  id: newId,
                  local: true,
                  self: 'out',
                  t: Math.floor(Date.now() / 1000),
                  from:
                    (UserPrefs && typeof UserPrefs.getMaybeMeUser === 'function' && UserPrefs.getMaybeMeUser()) ||
                    templateMsg.from,
                  to: createWidSafe(resolvedChatId),
                  isNewMsg: true,
                  type: 'chat',
                  body: text,
                  quotedMsg: null,
                  ...extras,
                });
                const sendTuple = await Promise.all(await addAndSendMsgToChat(chat, tempMsg));
                if (!sendTuple || sendTuple[1] === 'success' || sendTuple[1] === 'OK') {
                  return {
                    ok: true,
                    method: 'addAndSendMsgToChat',
                    chatId: resolvedChatId,
                    msgId: (newId && newId._serialized) || extractLatestOutgoingId(chat),
                  };
                }
                debugErrors.push(`addAndSendMsgToChat(${rawId}) status: ${String(sendTuple[1])}`);
              }
            } catch (err) {
              debugErrors.push(
                `addAndSendMsgToChat(${rawId}): ${err && err.message ? err.message : String(err)}`
              );
            }
          } else {
            debugErrors.push('addAndSendMsgToChat unavailable');
          }

          // Metode 3: Buka chat di UI via WAWebCmd lalu kirim via composer footer (tanpa reload halaman)
          if (CmdObj && typeof CmdObj.openChatBottom === 'function') {
            try {
              await CmdObj.openChatBottom(chat);
              let composer = null;
              for (let step = 0; step < 15; step++) {
                composer =
                  document.querySelector('footer div[contenteditable="true"][data-tab]') ||
                  document.querySelector('footer div[contenteditable="true"]');
                if (composer) break;
                await new Promise((r) => setTimeout(r, 120));
              }
              if (composer) {
                composer.focus();
                try {
                  const dt = new DataTransfer();
                  dt.setData('text/plain', text);
                  composer.dispatchEvent(
                    new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })
                  );
                } catch {
                  document.execCommand('insertText', false, text);
                }
                await new Promise((r) => setTimeout(r, 200));
                const sendBtn =
                  document.querySelector('footer button[data-tab="11"]') ||
                  document.querySelector('footer button[aria-label*="Send" i]') ||
                  document.querySelector('footer button[aria-label*="Kirim" i]') ||
                  (document.querySelector('footer span[data-icon="wds-ic-send-filled"]') &&
                    document.querySelector('footer span[data-icon="wds-ic-send-filled"]').closest('button')) ||
                  (document.querySelector('footer span[data-icon="send"]') &&
                    document.querySelector('footer span[data-icon="send"]').closest('button'));
                if (sendBtn) {
                  sendBtn.click();
                  await new Promise((r) => setTimeout(r, 250));
                  return {
                    ok: true,
                    method: 'Cmd.openChatBottom+Composer',
                    chatId: resolvedChatId,
                    msgId: extractLatestOutgoingId(chat),
                  };
                }
                debugErrors.push(`Cmd.openChatBottom(${rawId}): tombol kirim tidak ditemukan`);
              } else {
                debugErrors.push(`Cmd.openChatBottom(${rawId}): composer footer tidak muncul`);
              }
            } catch (err) {
              debugErrors.push(`Cmd.openChatBottom(${rawId}): ${err && err.message ? err.message : String(err)}`);
            }
          }

          return null;
        };

        // Pass 1: Prioritaskan chat yang sudah terbuka di Store.Chat (hindari masalah @lid saat membalas)
        for (const id of ids) {
          const existingChat = await resolveOrOpenChat(id, false);
          if (existingChat) {
            const sent = await trySendToChat(existingChat, id);
            if (sent) return sent;
          }
        }

        // Pass 2: Buka / buat chat baru (untuk nomor supplier baru hasil scraping Playwright)
        for (const id of ids) {
          const openedChat = await resolveOrOpenChat(id, true);
          if (openedChat) {
            const sent = await trySendToChat(openedChat, id);
            if (sent) return sent;
          } else {
            debugErrors.push(`resolveOrOpenChat(${id}) mengembalikan null`);
          }
        }

        return {
          ok: false,
          reason: notRegisteredOnWa ? 'NOT_REGISTERED_ON_WA' : 'CHAT_NOT_FOUND_OR_SEND_FAILED',
          errors: debugErrors,
        };
      },
      { ids: candidateIds, text: content, quoteId: quotedMsgId || null }
    ),
    15000,
    'kirimPesanViaStoreInPage'
  );
}

/**
 * Catat & kirim pesan keluar melalui WhatsApp agar terhindar dari hang @lid / 'Not a contact' / echo loop
 */
async function kirimPesanWaAman(client, targetIdsOrId, content, options = {}) {
  const rawList = Array.isArray(targetIdsOrId) ? targetIdsOrId : [targetIdsOrId];
  const candidateIds = [...new Set(rawList.filter((v) => typeof v === 'string' && v.trim().length > 0))];
  if (candidateIds.length === 0) {
    throw new Error('Tidak ada ID chat tujuan yang valid');
  }

  let storeFailureDetail = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const storeRes = await kirimPesanViaStoreInPage(
        client,
        candidateIds,
        content,
        options.quotedMsgId
      );
      if (storeRes && storeRes.ok) {
        tandaiPesanKeluar(storeRes.msgId);
        return storeRes.msgId || true;
      }

      const reasonStr = storeRes ? storeRes.reason : 'unknown';
      const detailStr =
        storeRes && Array.isArray(storeRes.errors) && storeRes.errors.length > 0
          ? storeRes.errors.join(' | ')
          : '-';
      storeFailureDetail = `Store send (${reasonStr}): ${detailStr}`;
      console.warn(`[BOTWA STORE WARN] ${candidateIds[0]} -> ${storeFailureDetail}`);

      if (reasonStr === 'NOT_REGISTERED_ON_WA') {
        const notWaErr = new Error('Nomor tidak terdaftar di WhatsApp');
        notWaErr.code = 'NOT_REGISTERED_ON_WA';
        notWaErr.statusCode = 422;
        throw notWaErr;
      }

      // Jika WA Web baru saja reload (FRAME NAV DETECTED), tunggu sebentar lalu coba sekali lagi
      if (storeRes && storeRes.reason === 'STORE_NOT_READY' && attempt === 1) {
        await sleep(1500);
        continue;
      }
      break;
    } catch (err) {
      if (err && err.code === 'NOT_REGISTERED_ON_WA') {
        throw err;
      }
      const errMsg = err && err.message ? err.message : String(err);
      storeFailureDetail = `Store eval error: ${errMsg}`;
      console.warn(`[BOTWA STORE ERROR] ${candidateIds[0]} -> ${errMsg}`);
      if (/Execution context|Target closed|STORE_NOT_READY/i.test(errMsg) && attempt === 1) {
        await sleep(1500);
        continue;
      }
      break;
    }
  }

  // Fallback ke API OpenWA standar (utamakan @c.us terlebih dulu agar tidak memicu bug OGCP pada @lid)
  const sortedForOpenWa = [...candidateIds].sort((a, b) => {
    const aLid = a.includes('@lid') ? 1 : 0;
    const bLid = b.includes('@lid') ? 1 : 0;
    return aLid - bLid;
  });

  let fallbackFailureDetail = null;
  for (const fallbackId of sortedForOpenWa) {
    try {
      const sentResult = await withTimeout(
        client.sendText(fallbackId, content),
        10000,
        `client.sendText(${fallbackId})`
      );
      if (typeof sentResult === 'string') {
        tandaiPesanKeluar(sentResult);
      } else if (sentResult && sentResult.id) {
        tandaiPesanKeluar(sentResult.id);
      }
      return sentResult;
    } catch (err) {
      fallbackFailureDetail = err && err.message ? err.message : String(err);
    }
  }

  const combinedMsg = [storeFailureDetail, fallbackFailureDetail ? `OpenWA: ${fallbackFailureDetail}` : null]
    .filter(Boolean)
    .join(' || ');
  throw new Error(combinedMsg || 'Gagal mengirim pesan WhatsApp ke semua kandidat ID');
}

/**
 * Meneruskan balasan supplier (atau perintah asisten Owner) ke Webhook AI Manajerku
 */
async function teruskanResponKeManajerku(fromPhone, messageText) {
  const res = await withTimeout(
    fetch(`${MANAJERKU_WEB_URL}/api/v1/webhooks/whatsapp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fromPhone,
        messageText,
        skipOpenWaDispatch: true,
      }),
    }),
    30000,
    'webhook manajerku'
  );

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Webhook HTTP ${res.status}: ${errText}`);
  }

  return res.json();
}

/**
 * Gateway HTTP di Port 8085:
 * Menerima tugas pengiriman pesan ke supplier hasil scraping Playwright dari Web Manajerku (/sendText)
 */
function jalankanHttpGatewayServer(client) {
  const server = http.createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, apiKey, Authorization');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const reqUrl = (req.url || '/').split('?')[0];

    if (req.method === 'GET' && (reqUrl === '/' || reqUrl === '/health')) {
      let hostNum = null;
      try {
        hostNum = await client.getHostNumber();
      } catch {}
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          online: true,
          service: 'Manajerku BotWA OpenWA Gateway (Kirim RFQ & Terima Respon Supplier)',
          hostNumber: hostNum || null,
        })
      );
      return;
    }

    if (req.method === 'GET' && reqUrl === '/diag') {
      try {
        const diag = await withTimeout(
          client.evaluate(() => {
            const safeReq = (m) => {
              try {
                return typeof window.require === 'function' ? window.require(m) : null;
              } catch {
                return null;
              }
            };
            const collections = safeReq('WAWebCollections') || {};
            const chatCol = (window.Store && window.Store.Chat) || collections.Chat;
            const findAct = safeReq('WAWebFindChatAction');
            const sendAct = safeReq('WAWebSendTextMsgChatAction');
            const addSendAct = safeReq('WAWebSendMsgChatAction');
            const wq = (window.Store && window.Store.WapQuery) || safeReq('WAWebQueryExistsJob');
            const wf = (window.Store && window.Store.WidFactory) || safeReq('WAWebWidFactory');
            const cmd = (window.Store && window.Store.Cmd) || (safeReq('WAWebCmd') && safeReq('WAWebCmd').Cmd);
            return {
              hasWindowRequire: typeof window.require === 'function',
              hasWindowStore: Boolean(window.Store),
              hasChatCollection: Boolean(chatCol),
              hasChatFind: Boolean(chatCol && typeof chatCol.find === 'function'),
              hasFindOrCreateLatestChat: Boolean(findAct && typeof findAct.findOrCreateLatestChat === 'function'),
              hasFindChat: Boolean(findAct && typeof findAct.findChat === 'function'),
              hasStoreSendText: Boolean(window.Store && typeof window.Store.SendTextMsgToChat === 'function'),
              hasActionSendText: Boolean(sendAct && typeof sendAct.sendTextMsgToChat === 'function'),
              hasAddAndSend: Boolean((window.Store && window.Store.addAndSendMsgToChat) || (addSendAct && addSendAct.addAndSendMsgToChat)),
              hasQueryExist: Boolean(wq && (typeof wq.queryExist === 'function' || typeof wq.queryWidExists === 'function')),
              hasWidFactory: Boolean(wf && typeof wf.createWid === 'function'),
              hasCmdOpenChatBottom: Boolean(cmd && typeof cmd.openChatBottom === 'function'),
            };
          }),
          5000,
          'diag'
        );
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, diag }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: err && err.message ? err.message : String(err) }));
      }
      return;
    }

    let rawBody = '';
    req.on('data', (chunk) => {
      rawBody += chunk;
    });

    req.on('end', async () => {
      let body = {};
      try {
        body = rawBody ? JSON.parse(rawBody) : {};
      } catch {
        body = {};
      }

      if (BOTWA_API_KEY) {
        const incomingKey = req.headers['apikey'] || req.headers['authorization'] || '';
        const cleanedAuth = String(incomingKey).replace(/^Bearer\s+/i, '').trim();
        if (cleanedAuth && cleanedAuth !== BOTWA_API_KEY) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'Unauthorized API Key' }));
          return;
        }
      }

      try {
        // Endpoint pengecekan koneksi nomor OpenWA aktif
        if (reqUrl === '/getHostNumber') {
          let hostNum = '62895351009379';
          try {
            const h = await client.getHostNumber();
            if (h) hostNum = String(h);
          } catch {}
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ response: hostNum }));
          return;
        }

        // Endpoint pengiriman pesan ke nomor WA Supplier / Reseller / Owner dari Playwright & Manajerku
        if (reqUrl === '/sendText') {
          const args = body.args || body;
          const rawTo = String(args.to || '').trim();
          const content = String(args.content || args.text || '').trim();
          const norm = normalisasiNomorWa(rawTo);
          const candidateTargets = [];
          if (norm) candidateTargets.push(norm.chatId);
          if (rawTo.includes('@')) candidateTargets.push(rawTo);
          else if (!norm && rawTo) candidateTargets.push(`${rawTo}@c.us`);

          if (!content || candidateTargets.length === 0) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: 'Nomor tujuan atau konten pesan kosong' }));
            return;
          }

          await kirimPesanWaAman(client, candidateTargets, content);
          console.log(`[BOTWA -> WA OUT] Pesan terkirim ke ${candidateTargets[0]}`);

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, response: true, to: candidateTargets[0] }));
          return;
        }

        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'Endpoint tidak ditemukan' }));
      } catch (err) {
        const errMsg = err && err.message ? err.message : String(err);
        const statusCode = err && typeof err.statusCode === 'number' ? err.statusCode : 500;
        const errCode = err && err.code ? err.code : 'SEND_FAILED';
        console.error('[BOTWA GATEWAY ERROR]:', errMsg);
        res.writeHead(statusCode, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, code: errCode, error: errMsg }));
      }
    });
  });

  server.on('error', (err) => {
    console.warn(`[BOTWA GATEWAY PORT ${BOTWA_PORT}]:`, err.message);
  });

  server.listen(BOTWA_PORT, () => {
    console.log('==================================================================');
    console.log(`GATEWAY BOTWA AKTIF DI      : http://localhost:${BOTWA_PORT}`);
    console.log(`TERHUBUNG KE WEB MANAJERKU  : ${MANAJERKU_WEB_URL}`);
    console.log('PERAN BOTWA:');
    console.log('  1. Mengirim pertanyaan Auto-RFQ ke nomor WA supplier hasil Playwright');
    console.log('  2. Menangkap & memproses balasan supplier ke Manajerku AI secara realtime');
    console.log('==================================================================');
  });
}

async function tanganiPesanMasuk(client, message) {
  try {
    if (!message || message.fromMe || message.isGroupMsg) return;
    if (!message.from || /(@g\.us|@broadcast|@newsletter|status@broadcast)$/i.test(message.from)) return;
    if (message.id && sentBotMessageIds.has(message.id)) return;

    if (message.id) {
      if (processedInboundIds.has(message.id)) return;
      processedInboundIds.add(message.id);
      if (processedInboundIds.size > 1000) {
        const firstKey = processedInboundIds.values().next().value;
        if (firstKey) processedInboundIds.delete(firstKey);
      }
    }

    const pesanAsli = (message.caption || message.body || '').trim();
    if (!pesanAsli) return;

    const senderNorm = await resolveSenderPhoneFromMessage(client, message);
    if (!senderNorm) return;

    // Kandidat balasan berurutan: prioritaskan chat aktif (@lid atau @c.us) lalu nomor ternormalisasi @c.us
    const replyTargets = [...new Set([message.from, senderNorm.chatId].filter(Boolean))];
    const msgOptions = message.id ? { quotedMsgId: message.id } : {};

    console.log(`[BOTWA <- WA IN] Dari ${senderNorm.e164} (${message.from}): "${pesanAsli}"`);

    const lowerMsg = pesanAsli.toLowerCase();
    if (
      lowerMsg === 'p' ||
      lowerMsg === 'ping' ||
      lowerMsg === 'tes' ||
      lowerMsg === 'menu' ||
      lowerMsg === '!menu'
    ) {
      await kirimPesanWaAman(
        client,
        replyTargets,
        '🤖 *BotWA Gateway Manajerku Aktif (Port 8085)!*\n\n' +
          'Alur kerja sistem:\n' +
          '1. Scraping nomor WA supplier dilakukan lewat *Playwright* di Web App (`/supplier` -> *+ Scraping Baru*).\n' +
          '2. BotWA otomatis mengirimkan pertanyaan Auto-RFQ ke nomor WA supplier tersebut.\n' +
          '3. Balasan harga & MOQ dari supplier langsung diproses AI Manajerku di `/whatsapp`.',
        msgOptions
      );
      console.log(`[BOTWA -> WA OUT] Balasan !menu terkirim ke ${senderNorm.e164}`);
      return;
    }

    if (lowerMsg.startsWith('!cari ') || lowerMsg.startsWith('!scrape ')) {
      const keyword = pesanAsli.replace(/^!(cari|scrape)\s+/i, '').trim();
      await kirimPesanWaAman(
        client,
        replyTargets,
        `🤖 Permintaan cari *${keyword || 'supplier'}* diterima!\n\n` +
          'Sesuai arsitektur sistem, silakan jalankan scraping nomor WA melalui *Playwright* di Web App Manajerku:\n' +
          '1. Buka *Database Supplier* -> *+ Scraping Baru*\n' +
          `2. Masukkan kata kunci "${keyword || 'supplier'}"\n` +
          '3. BotWA ini akan otomatis mengirim pertanyaan Auto-RFQ ke seluruh nomor supplier yang ditemukan dan menangkap balasannya.',
        msgOptions
      );
      console.log(`[BOTWA -> WA OUT] Panduan !cari dikirim ke ${senderNorm.e164}`);
      return;
    }

    const webhookRes = await teruskanResponKeManajerku(senderNorm.e164, pesanAsli);
    if (!webhookRes || !webhookRes.success) return;

    const routedRole = webhookRes.routedRole || '';
    const data = webhookRes.data || {};

    // 1. Jika pengirim adalah Supplier yang sedang dalam sesi Auto-RFQ
    if (routedRole === 'NEGOTIATOR_SUPPLIER') {
      console.log(
        `[RESPON SUPPLIER DIPROSES] ${data.supplierName || senderNorm.e164} | Status Slot: ${data.slotCompletenessStatus || '-'}`
      );

      if (data.agentReplyToSupplier) {
        await kirimPesanWaAman(client, replyTargets, data.agentReplyToSupplier, msgOptions);
        console.log(`[BOTWA -> SUPPLIER] Membalas otomatis ke ${senderNorm.e164}`);
      }

      // Kabari Owner setiap kali supplier menjawab (balasan sebagian, stok kosong, maupun penawaran lengkap)
      const ownerNotifyText = data.ownerNotificationMessage || data.ownerRecommendationMessage;
      if (ownerNotifyText && data.ownerPhone) {
        const ownerNorm = normalisasiNomorWa(data.ownerPhone);
        if (ownerNorm) {
          try {
            await kirimPesanWaAman(client, ownerNorm.chatId, ownerNotifyText);
            console.log(
              `[BOTWA -> OWNER] Notifikasi respon supplier (${data.supplierName || senderNorm.e164}) dikirim ke ${ownerNorm.e164}`
            );
          } catch (ownerErr) {
            console.error(
              `[BOTWA -> OWNER ERROR] Gagal mengabari owner ${ownerNorm.e164}:`,
              ownerErr && ownerErr.message ? ownerErr.message : ownerErr
            );
          }
        }
      }
      return;
    }

    // 2. Jika pengirim adalah Owner / Staf Kasir terdaftar (Asisten Internal)
    if (routedRole.startsWith('ASSISTANT_')) {
      const replyText =
        data.replyMessage ||
        (data.poNumber
          ? `PO ${data.poNumber} berhasil diterbitkan ke ${data.supplierName} (Total Rp ${Number(
              data.totalAmountRp || 0
            ).toLocaleString('id-ID')}).`
          : null);

      if (replyText) {
        await kirimPesanWaAman(client, replyTargets, replyText, msgOptions);
        console.log(`[BOTWA -> OWNER] Balasan asisten dikirim ke ${senderNorm.e164}`);
      }
    }

    // 3. Nomor pribadi asing (UNKNOWN_SENDER_SAFE_REPLY) diabaikan agar tidak spam chat pribadi
  } catch (err) {
    console.error('[BOTWA INBOUND ERROR]:', err && err.message ? err.message : err);
  }
}

function start(client) {
  console.log('==================================================================');
  console.log('BOT WHATSAPP MANAJERKU (AUTO-RFQ OUTREACH & RESPONDER) SIAP!');
  console.log('==================================================================');

  jalankanHttpGatewayServer(client);

  // Dispatch non-blocking agar satu pesan lambat/error tidak pernah mengunci pesan berikutnya di ListenerManager
  client.onMessage(
    (message) => {
      void tanganiPesanMasuk(client, message);
    },
    { concurrency: 8, timeout: 45000 }
  );
}

create({
  sessionId: 'SESI_BOT_UTAMA',
  sessionDataPath: path.resolve(__dirname),
  multiDevice: true,
  useChrome: true,
  headless: false,
  qrTimeout: 0,
  authTimeout: 0,
  blockCrashLogs: true,
  disableSpins: true,
  ghPatch: true,
  cachedPatch: true,
  skipBrokenMethodsCheck: true,
  logLevel: 'warn',
  logConsole: false,
  logConsoleErrors: false,
  chromiumArgs: [
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--no-sandbox',
  ],
})
  .then((client) => start(client))
  .catch((err) => console.error('Terjadi error:', err));
