/// <reference types="chrome" />

const READER_URL = chrome.runtime.getURL('reader/index.html');
const HOMEPAGE_URL = 'https://paperflow.pages.dev';

// On install, register dynamic rules that redirect arxiv + pdf URLs to the reader page.
//
// Note: we use `#src=\0` (URL fragment) instead of `?src=\0` because
// DNR's regexSubstitution does NOT url-encode the matched group. A PDF URL
// like `https://cdn.example.com/paper.pdf?token=abc&exp=123` embedded as
// `?src=...` would be parsed by URLSearchParams as `src=...&exp=...` — the
// `&` splits the original URL. Fragments don't participate in query parsing,
// so `#src=<raw url>` survives intact and reader reads via `location.hash`.
async function registerRules() {
  const rules: chrome.declarativeNetRequest.Rule[] = [
    {
      id: 1,
      priority: 1,
      action: {
        type: chrome.declarativeNetRequest.RuleActionType.REDIRECT,
        redirect: { regexSubstitution: `${READER_URL}#src=\\0` },
      },
      condition: {
        regexFilter: '^https://arxiv\\.org/(html|pdf)/.+',
        resourceTypes: [chrome.declarativeNetRequest.ResourceType.MAIN_FRAME],
      },
    },
    {
      id: 2,
      priority: 1,
      action: {
        type: chrome.declarativeNetRequest.RuleActionType.REDIRECT,
        redirect: { regexSubstitution: `${READER_URL}#src=\\0` },
      },
      condition: {
        regexFilter: '^https?://.+\\.pdf(\\?.*)?$',
        resourceTypes: [chrome.declarativeNetRequest.ResourceType.MAIN_FRAME],
        // excludedRequestDomains filters by *target* domain (the domain being
        // loaded), which is what we want — Rule 1 already handles arxiv.org.
        // excludedInitiatorDomains filters by the *source* page, which is
        // unreliable for address-bar navigation (no initiator).
        excludedRequestDomains: ['arxiv.org'],
      },
    },
  ];

  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: [1, 2],
    addRules: rules,
  });
}

chrome.runtime.onInstalled.addListener(registerRules);
chrome.runtime.onStartup.addListener(registerRules);

chrome.action.onClicked.addListener(() => {
  void chrome.tabs.create({ url: HOMEPAGE_URL });
});

// PDF CORS fallback — reader page messages SW with url, SW fetches and returns bytes.
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.kind === 'pdf-proxy-fetch' && typeof msg.url === 'string') {
    (async () => {
      try {
        const res = await fetch(msg.url);
        if (!res.ok) {
          sendResponse({ kind: 'error', message: `HTTP ${res.status}` });
          return;
        }
        const buf = await res.arrayBuffer();
        const size = buf.byteLength;
        if (size > 30 * 1024 * 1024) {
          sendResponse({
            kind: 'error',
            message: `PDF is ${(size / 1024 / 1024).toFixed(1)} MB — exceeds 30 MB SW proxy limit.`,
          });
          return;
        }
        // Return as transferable — but chrome.runtime.sendResponse can't transfer ArrayBuffer directly.
        // Convert to base64 for the reader to decode.
        const bytes = new Uint8Array(buf);
        let bin = '';
        for (const b of bytes) bin += String.fromCharCode(b);
        sendResponse({ kind: 'ok', base64: btoa(bin), size });
      } catch (err) {
        sendResponse({ kind: 'error', message: String(err) });
      }
    })();
    return true;  // keep sendResponse alive for async
  }
  return false;
});

// ─── Auth + sync lifecycle (Phase B · Task B9) ─────────────────────────────
//
// Extends the service worker with auth-session refresh, broadcast to reader
// tabs, and offline queue drain on startup. Orthogonal to DNR redirect logic
// above — these additions are pure side-effect wiring.

import { supabase } from '../reader/lib/supabase'
import { drain as drainSyncQueue } from '../reader/lib/sync-queue'

// chrome.alarms fires every 30 min to keep the Supabase session alive.
// Supabase access tokens default to a 1h TTL; 30 min gives us 2x safety.
// Alarms survive service worker termination and re-fire after Chrome wakes
// the worker back up, which is the critical property for MV3.
const SESSION_REFRESH_ALARM = 'paperflow:refresh-session'

// Chrome only exposes `chrome.alarms` when the `"alarms"` permission is
// granted to the running instance. A fresh build's manifest declares it, but
// Chrome caches the permission set from the previous Load-unpacked — adding
// `alarms` to an already-loaded extension requires the user to remove and
// re-add it. This guard keeps the SW from crashing in that stale-permission
// window instead of silently losing the 30-min session-refresh feature.
if (chrome.alarms) {
  chrome.runtime.onInstalled.addListener(() => {
    chrome.alarms.create(SESSION_REFRESH_ALARM, { periodInMinutes: 30 })
  })
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name !== SESSION_REFRESH_ALARM) return
    // getSession() reads from storage and triggers autoRefresh when near expiry.
    // Any failure is non-fatal — next alarm will retry.
    void supabase.auth.getSession().catch(() => { /* swallow */ })
  })
}

// Broadcast auth state changes to any reader tab that has registered a
// chrome.runtime.onMessage listener. The reader uses onAuthStateChange
// locally too, but the broadcast lets server-workerless contexts (like
// the options page) pick up changes without re-subscribing.
//
// We swallow send errors because catchAll "no receiver" is expected when
// no tab is listening.
supabase.auth.onAuthStateChange((event, session) => {
  chrome.runtime
    .sendMessage({ type: 'paperflow:auth-change', event, session })
    .catch(() => { /* no listeners — fine */ })
})

// On service worker wake-up (Chrome start, extension reload, alarm fire)
// drain any writes that were queued while offline. The drain itself is
// a no-op when navigator.onLine is false.
chrome.runtime.onStartup.addListener(() => {
  void drainSyncQueue().catch(() => { /* swallow */ })
})
