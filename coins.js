// coins.js — Adaptador da API Banco FoxSrv / DC-Coin-Bot

import fs from "fs";
import path from "path";

const BASE = process.env.BANK_API_BASE || "https://coin.foxsrv.net";
const SESS_FILE = path.resolve("./coin_sessions.json");

let sessions = {};
try {
  if (fs.existsSync(SESS_FILE)) {
    sessions = JSON.parse(fs.readFileSync(SESS_FILE, "utf8"));
  }
} catch {
  sessions = {};
}

function saveSessions() {
  try {
    fs.writeFileSync(SESS_FILE, JSON.stringify(sessions, null, 2));
  } catch (e) {
    console.error("Erro salvando arquivo de sessão:", e);
  }
}

async function callApi(endpoint, method = "GET", body = null, session = null) {
  const url = BASE + endpoint;
  const headers = {};
  if (body) headers["Content-Type"] = "application/json";
  if (session) headers["Authorization"] = `Bearer ${session}`;

  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  });

  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { ok: false, status: res.status, text };
  }
}

export default {

  getSession(did) {
    return sessions[did] || null;
  },

  setSession(did, sessionId) {
    sessions[did] = sessionId;
    saveSessions();
  },

  async register(username, password) {
    return callApi("/api/register", "POST", { username, password });
  },

  async login(username, password) {
    return callApi("/api/login", "POST", { username, password });
  },

  async getBalance(session) {
    return callApi("/api/get_balance", "GET", null, session);
  },

  async transfer(session, toId, amount) {
    return callApi("/api/transfer", "POST", { toId, amount }, session);
  },

  async claim(session) {
    return callApi("/api/claim", "POST", {}, session);
  },

  async getTx(txid) {
    return callApi(`/api/tx/${txid}`, "GET");
  },

  async getTransactions(uid, page = 1) {
    return callApi(`/api/transactions?userId=${uid}&page=${page}`, "GET");
  },

  async getCardInfo(session) {
    return callApi("/api/card/info", "GET", null, session);
  },

  async resetCard(session) {
    return callApi("/api/card/reset", "POST", {}, session);
  },

  async createBill(session, toId, amount, time = null) {
    return callApi("/api/bill/create", "POST", { toId, amount, time }, session);
  },

  async payBill(session, billId) {
    return callApi("/api/bill/pay", "POST", { billId }, session);
  }
};
