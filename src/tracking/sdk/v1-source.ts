export const trackerV1Source = `"use strict";
(function () {
  try {
    if (window.__LEADGUARD_MONITORING__) return;
    var script = document.currentScript;
    var siteKey = script && script.getAttribute("data-site-key");
    if (!siteKey) return;
    var endpoint;
    try {
      endpoint = new URL("/api/tracking/v1/events", script.src).toString();
    } catch (e) {
      return;
    }
    var debug = false;
    try {
      debug = new URLSearchParams(window.location.search).get("leadguard_debug") === "1";
    } catch (e) {}
    function log() {
      if (debug && typeof console !== "undefined" && console.info) {
        console.info.apply(console, ["[LeadGuard]"].concat([].slice.call(arguments)));
      }
    }
    var consent = "unknown";
    var heldClickIds = null;
    var pendingLead = null;
    var token = null;
    var VID = "_lg_vid";
    var SID = "_lg_sid";
    var TOK = "_lg_tok";
    var SESSION_MS = 30 * 60 * 1000;
    var VISITOR_MS = 90 * 24 * 60 * 60 * 1000;
    function uuid() {
      if (crypto && crypto.randomUUID) return crypto.randomUUID();
      var buf = new Uint8Array(16);
      crypto.getRandomValues(buf);
      buf[6] = (buf[6] & 15) | 64;
      buf[8] = (buf[8] & 63) | 128;
      var hex = [];
      for (var i = 0; i < 16; i++) hex.push(("0" + buf[i].toString(16)).slice(-2));
      return (
        hex.slice(0, 4).join("") +
        "-" +
        hex.slice(4, 6).join("") +
        "-" +
        hex.slice(6, 8).join("") +
        "-" +
        hex.slice(8, 10).join("") +
        "-" +
        hex.slice(10).join("")
      );
    }
    function readCookie(name) {
      var parts = ("; " + document.cookie).split("; " + name + "=");
      if (parts.length < 2) return null;
      return parts.pop().split(";").shift() || null;
    }
    function writeCookie(name, value, maxAge) {
      var parts = [name + "=" + value, "Path=/", "SameSite=Lax", "Max-Age=" + String(maxAge)];
      if (location.protocol === "https:") parts.push("Secure");
      document.cookie = parts.join("; ");
    }
    function clearCookie(name) {
      writeCookie(name, "", 0);
    }
    function validId(value) {
      return typeof value === "string" && value.length > 0 && value.length <= 512 && /^[\\u0021-\\u007E]+$/.test(value);
    }
    function readClickIds() {
      var params = new URLSearchParams(window.location.search);
      var ids = { gclid: null, gbraid: null, wbraid: null };
      ["gclid", "gbraid", "wbraid"].forEach(function (key) {
        var value = params.get(key);
        if (value && validId(value)) ids[key] = value;
      });
      return ids;
    }
    function hasIds(ids) {
      return Boolean(ids && (ids.gclid || ids.gbraid || ids.wbraid));
    }
    function send(payload, onDone) {
      var body = JSON.stringify(payload);
      var done = false;
      function finish(ok, json) {
        if (done) return;
        done = true;
        if (onDone) onDone(ok, json);
      }
      try {
        fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: body,
          keepalive: true,
          credentials: "omit",
        })
          .then(function (res) {
            return res.json().then(function (json) {
              finish(res.ok, json);
            }).catch(function () { finish(false, null); });
          })
          .catch(function () { finish(false, null); });
      } catch (e) {
        finish(false, null);
      }
    }
    function visitorId() {
      var existing = readCookie(VID);
      if (existing) return existing;
      var created = uuid();
      writeCookie(VID, created, Math.floor(VISITOR_MS / 1000));
      return created;
    }
    function sessionId() {
      var existing = readCookie(SID);
      if (existing) return existing;
      var created = uuid();
      writeCookie(SID, created, Math.floor(SESSION_MS / 1000));
      return created;
    }
    function refreshSession() {
      var sid = readCookie(SID);
      if (sid) writeCookie(SID, sid, Math.floor(SESSION_MS / 1000));
    }
    function capture() {
      if (consent !== "granted") return;
      refreshSession();
      var ids = heldClickIds || readClickIds();
      heldClickIds = null;
      var payload = {
        type: "session",
        eventId: uuid(),
        siteKey: siteKey,
        consent: "granted",
        visitorId: visitorId(),
        sessionId: sessionId(),
        landingUrl: String(window.location.href).split("#")[0],
        landingPath: window.location.pathname,
        landingOrigin: window.location.origin,
        referrerDomain: document.referrer || null,
        clickIds: ids,
        utm: {
          utm_source: new URLSearchParams(window.location.search).get("utm_source"),
          utm_medium: new URLSearchParams(window.location.search).get("utm_medium"),
          utm_campaign: new URLSearchParams(window.location.search).get("utm_campaign"),
          utm_content: new URLSearchParams(window.location.search).get("utm_content"),
          utm_term: new URLSearchParams(window.location.search).get("utm_term"),
        },
      };
      send(payload, function (ok, json) {
        if (ok && json && typeof json.sessionTimeoutMinutes === "number" && json.sessionTimeoutMinutes > 0) {
          SESSION_MS = json.sessionTimeoutMinutes * 60 * 1000;
        }
        if (ok && json && json.attributionToken) {
          token = json.attributionToken;
          writeCookie(TOK, token, Math.floor(VISITOR_MS / 1000));
        } else if (!token) {
          token = readCookie(TOK);
        }
        if (pendingLead) {
          var lead = pendingLead;
          pendingLead = null;
          api.trackLead(lead);
        }
        log("initialized");
      });
    }
    var readyWaiters = [];
    var sdkReady = false;
    function signalReady() {
      sdkReady = true;
      while (readyWaiters.length) {
        var waiter = readyWaiters.shift();
        if (waiter) waiter();
      }
    }
    var api = {
      ready: function () {
        if (sdkReady) return Promise.resolve();
        return new Promise(function (resolve) {
          readyWaiters.push(resolve);
        });
      },
      setConsent: function (value) {
        try {
          var next = value && typeof value === "object" ? value.attribution : value;
          if (next === "granted") {
            consent = "granted";
            capture();
          } else if (next === "denied") {
            consent = "denied";
            heldClickIds = null;
            pendingLead = null;
            token = null;
            clearCookie(VID);
            clearCookie(SID);
            clearCookie(TOK);
          }
        } catch (e) {}
      },
      getAttributionToken: function () {
        return token || readCookie(TOK);
      },
      attachAttributionToken: function (selector) {
        try {
          if (consent !== "granted") return;
          var form = typeof selector === "string" ? document.querySelector(selector) : selector;
          if (!form) return;
          var current = api.getAttributionToken();
          if (!current) return;
          var input = form.querySelector('input[name="leadguard_attribution_token"]');
          if (!input) {
            input = document.createElement("input");
            input.type = "hidden";
            input.name = "leadguard_attribution_token";
            form.appendChild(input);
          }
          input.value = current;
        } catch (e) {}
      },
      trackLead: function (options) {
        try {
          if (consent !== "granted") {
            pendingLead = options || {};
            return;
          }
          var opts = options || {};
          send(
            {
              type: "lead",
              eventId: opts.eventId || uuid(),
              siteKey: siteKey,
              consent: "granted",
              visitorId: visitorId(),
              sessionId: sessionId(),
              attributionToken: api.getAttributionToken(),
              externalLeadId: opts.externalLeadId || null,
              landingPath: window.location.pathname,
              landingOrigin: window.location.origin,
            },
            function () {}
          );
        } catch (e) {}
      },
    };
    window.LeadGuard = api;
    heldClickIds = hasIds(readClickIds()) ? readClickIds() : null;
    signalReady();
  } catch (e) {}
})();
`;
