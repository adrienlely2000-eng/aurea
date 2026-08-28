/* Aurea — calculs : soldes, charges, projections, insights. */

const Finance = (() => {
  const pad = (n) => String(n).padStart(2, "0");

  function toISO(date) {
    const d = date instanceof Date ? date : new Date(date);
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }

  function todayISO() {
    return toISO(new Date());
  }

  function parseISO(iso) {
    const [y, m, d] = String(iso).split("-").map(Number);
    return new Date(y, m - 1, d);
  }

  function addMonths(date, n) {
    const d = new Date(date.getFullYear(), date.getMonth() + n, 1);
    const day = date.getDate();
    const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    d.setDate(Math.min(day, last));
    return d;
  }

  function addDays(date, n) {
    const d = new Date(date);
    d.setDate(d.getDate() + n);
    return d;
  }

  function startOfDay(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
  }

  function periodOf(iso, monthStartDay = 1) {
    const date = parseISO(iso);
    const day = date.getDate();
    let start;
    if (day >= monthStartDay) {
      start = new Date(date.getFullYear(), date.getMonth(), monthStartDay);
    } else {
      start = new Date(date.getFullYear(), date.getMonth() - 1, monthStartDay);
    }
    const end = addDays(addMonths(start, 1), -1);
    return { start, end, startISO: toISO(start), endISO: toISO(end) };
  }

  function shiftPeriod(period, delta, monthStartDay = 1) {
    const nextStart = addMonths(period.start, delta);
    return periodOf(toISO(nextStart), monthStartDay);
  }

  function inPeriod(iso, period) {
    return iso >= period.startISO && iso <= period.endISO;
  }

  function daysBetween(a, b) {
    return Math.round((startOfDay(b) - startOfDay(a)) / 86400000);
  }

  function daysLeftInPeriod(period, today = todayISO()) {
    const t = parseISO(today);
    if (t > period.end) return 0;
    if (t < period.start) return daysBetween(period.start, period.end) + 1;
    return daysBetween(t, period.end) + 1;
  }

  function daysInPeriod(period) {
    return daysBetween(period.start, period.end) + 1;
  }

  function nextOccurrence(rec, fromDate) {
    const from = startOfDay(fromDate);
    if (rec.frequency === "weekly") {
      const weekday = Number(rec.weekday ?? parseISO(rec.nextDate || rec.startDate).getDay());
      const d = new Date(from);
      const delta = (weekday - d.getDay() + 7) % 7;
      d.setDate(d.getDate() + (delta === 0 ? 0 : delta));
      if (d < from) d.setDate(d.getDate() + 7);
      return d;
    }
    if (rec.frequency === "yearly") {
      const anchor = parseISO(rec.startDate || rec.nextDate);
      let d = new Date(from.getFullYear(), anchor.getMonth(), Math.min(anchor.getDate(), 28));
      const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
      d.setDate(Math.min(anchor.getDate(), last));
      if (d < from) {
        d = new Date(from.getFullYear() + 1, anchor.getMonth(), 1);
        const last2 = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
        d.setDate(Math.min(anchor.getDate(), last2));
      }
      return d;
    }
    if (rec.frequency === "quarterly") {
      let d = parseISO(rec.nextDate || rec.startDate);
      while (d < from) d = addMonths(d, 3);
      return d;
    }
    const day = Number(rec.dayOfMonth || parseISO(rec.nextDate || rec.startDate || todayISO()).getDate());
    let d = new Date(from.getFullYear(), from.getMonth(), 1);
    const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    d.setDate(Math.min(day, last));
    if (d < from) d = addMonths(d, 1);
    return d;
  }

  function advanceNext(rec, fromISO) {
    const from = addDays(parseISO(fromISO), 1);
    const next = nextOccurrence({ ...rec, nextDate: rec.nextDate }, from);
    return toISO(next);
  }

  function occurrencesInRange(rec, startISO, endISO) {
    if (!rec.active) return [];
    const dates = [];
    let guard = 0;
    let cursor = rec.nextDate && rec.nextDate < startISO ? rec.nextDate : startISO;
    if (rec.startDate && rec.startDate > cursor) cursor = rec.startDate;
    let d = nextOccurrence(rec, parseISO(cursor));
    if (rec.nextDate && rec.nextDate >= startISO) {
      const nd = parseISO(rec.nextDate);
      if (nd < d) d = nd;
    }
    while (toISO(d) <= endISO && guard < 80) {
      const iso = toISO(d);
      if (iso >= startISO && (!rec.startDate || iso >= rec.startDate)) dates.push(iso);
      if (rec.mode === "debt") {
        const left = Number(rec.remainingInstallments || rec.installments || 0);
        if (left && dates.length >= left) break;
      }
      if (rec.frequency === "weekly") d = addDays(d, 7);
      else if (rec.frequency === "quarterly") d = addMonths(d, 3);
      else if (rec.frequency === "yearly") d = addMonths(d, 12);
      else d = addMonths(d, 1);
      guard += 1;
    }
    return dates;
  }

  function isDebt(rec) {
    return !!(rec && rec.mode === "debt");
  }

  function remainingDebt(rec) {
    if (!isDebt(rec) || rec.active === false) return 0;
    if (rec.remainingAmount != null && rec.remainingAmount !== "") return Math.max(0, Number(rec.remainingAmount) || 0);
    const n = Number(rec.remainingInstallments != null ? rec.remainingInstallments : rec.installments) || 0;
    return Math.max(0, n * (Number(rec.amount) || 0));
  }

  function totalDebts(data, accountId) {
    return (data.recurrings || [])
      .filter((r) => isDebt(r) && r.active !== false && (!accountId || r.accountId === accountId))
      .reduce((s, r) => s + remainingDebt(r), 0);
  }

  function monthlyEquivalent(rec) {
    const amt = Number(rec.amount) || 0;
    if (rec.frequency === "weekly") return (amt * 52) / 12;
    if (rec.frequency === "quarterly") return amt / 3;
    if (rec.frequency === "yearly") return amt / 12;
    return amt;
  }

  function money(n) {
    const v = Number(n) || 0;
    return new Intl.NumberFormat("fr-FR", {
      style: "currency",
      currency: "EUR",
      maximumFractionDigits: 2
    }).format(v);
  }

  function moneyShort(n) {
    const v = Number(n) || 0;
    const abs = Math.abs(v);
    if (abs >= 10000) {
      return new Intl.NumberFormat("fr-FR", {
        style: "currency",
        currency: "EUR",
        maximumFractionDigits: 0
      }).format(v);
    }
    return money(v);
  }

  function formatDate(iso) {
    if (!iso) return "—";
    const d = parseISO(iso);
    return d.toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
  }

  function formatDateLong(iso) {
    if (!iso) return "—";
    const d = parseISO(iso);
    return d.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
  }

  function monthLabel(period) {
    const d = period.start;
    const label = d.toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
    return label.charAt(0).toUpperCase() + label.slice(1);
  }

  function categoryById(data, id) {
    return data.categories.find((c) => c.id === id) || { name: "Autre", icon: "·", color: "#9aa3b0", id: "cat-autre" };
  }

  function accountById(data, id) {
    return data.accounts.find((a) => a.id === id);
  }

  function includedAccounts(data) {
    return data.accounts.filter((a) => a.includeInTotal !== false);
  }

  function currentBalance(data, accountId) {
    if (accountId) {
      const acc = accountById(data, accountId);
      return acc ? Number(acc.balance) || 0 : 0;
    }
    return includedAccounts(data).reduce((s, a) => s + (Number(a.balance) || 0), 0);
  }

  function txsInPeriod(data, period, extra = {}) {
    return data.transactions.filter((t) => {
      if (!inPeriod(t.date, period)) return false;
      if (extra.accountId && t.accountId !== extra.accountId && t.toAccountId !== extra.accountId) return false;
      if (extra.kind && t.kind !== extra.kind) return false;
      if (extra.categoryId && t.categoryId !== extra.categoryId) return false;
      if (extra.q) {
        const q = extra.q.toLowerCase();
        const hay = (t.label + " " + (t.note || "")).toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }

  function sumByKind(txs, kind) {
    return txs.filter((t) => t.kind === kind).reduce((s, t) => s + (Number(t.amount) || 0), 0);
  }

  function foldText(value) {
    return String(value || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim();
  }

  function tokenHit(hay, needle) {
    if (!needle || needle.length < 2) return false;
    if (hay === needle) return true;
    const esc = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp("(^|[^a-z0-9])" + esc + "([^a-z0-9]|$)", "i").test(hay);
  }

  function accountFromLabel(data, text, excludeId) {
    const hay = foldText(text);
    if (!hay) return null;
    let best = null;
    let bestLen = 0;
    (data.accounts || []).forEach((a) => {
      if (a.id === excludeId) return;
      const name = foldText(a.name);
      if (!name) return;
      if (tokenHit(hay, name) && name.length > bestLen) {
        best = a;
        bestLen = name.length;
      }
      name.split(/\s+/).forEach((part) => {
        if (part.length >= 3 && tokenHit(hay, part) && part.length > bestLen) {
          best = a;
          bestLen = part.length;
        }
      });
    });
    return best;
  }

  function counterpartFor(data, tx) {
    if (tx.toAccountId && tx.toAccountId !== tx.accountId) {
      const to = accountById(data, tx.toAccountId);
      if (to) return to;
    }
    return accountFromLabel(data, tx.label || tx.name, tx.accountId);
  }

  function applyToBalance(data, tx, sign) {
    const amt = Number(tx.amount) || 0;
    const dir = sign === -1 ? -1 : 1;
    const from = accountById(data, tx.accountId);
    const named = tx.kind === "expense" ? counterpartFor(data, tx) : null;
    if (tx.kind === "transfer" || named) {
      const to = tx.kind === "transfer" ? accountById(data, tx.toAccountId) : named;
      if (from) from.balance = (Number(from.balance) || 0) - amt * dir;
      if (to) to.balance = (Number(to.balance) || 0) + amt * dir;
      return;
    }
    if (!from) return;
    if (tx.kind === "income") from.balance = (Number(from.balance) || 0) + amt * dir;
    else from.balance = (Number(from.balance) || 0) - amt * dir;
  }

  function focusAccount(data) {
    const id = data.settings && data.settings.focusAccountId;
    if (id) {
      const acc = accountById(data, id);
      if (acc) return acc;
    }
    const named = (data.accounts || []).find((a) => /individuel/i.test(a.name || ""));
    if (named) return named;
    return (data.accounts && data.accounts[0]) || null;
  }

  function dueDateInPeriod(rec, period) {
    const day = Number(rec.dayOfMonth || 1);
    const last = period.end.getDate();
    const d = new Date(period.start.getFullYear(), period.start.getMonth(), Math.min(day, last));
    if (toISO(d) < period.startISO) d.setMonth(d.getMonth() + 1);
    return toISO(d);
  }

  function subStatus(rec, today = todayISO()) {
    const t = parseISO(today);
    const period = periodOf(today, 1);
    const dueISO = dueDateInPeriod(rec, period);
    const due = parseISO(dueISO);
    const daysUntil = Math.round((due - t) / 86400000);
    if (dueISO === today) return { status: "today", daysUntil: 0, date: dueISO };
    if (dueISO > today) return { status: "upcoming", daysUntil, date: dueISO };
    const next = addMonths(due, rec.frequency === "quarterly" ? 3 : rec.frequency === "yearly" ? 12 : 1);
    const nextISO = toISO(next);
    return { status: "debited", daysUntil: Math.round((next - t) / 86400000), date: nextISO };
  }

  function chargedInPeriod(data, recId, period) {
    if (!recId) return false;
    return (data.transactions || []).some((t) => t.recurringId === recId && t.date && inPeriod(t.date, period));
  }

  function remainingCharges(data, period, today = todayISO(), accountId) {
    const items = [];
    data.recurrings.filter((r) => r.active && r.kind !== "income" && (!accountId || r.accountId === accountId)).forEach((rec) => {
      if (isDebt(rec) && Number(rec.remainingInstallments || rec.installments || 0) <= 0) return;
      const dueISO = dueDateInPeriod(rec, period);
      if (!inPeriod(dueISO, period)) return;
      if (dueISO < today) return;
      if (chargedInPeriod(data, rec.id, period)) return;
      const st = subStatus(rec, today);
      items.push({
        rec,
        amount: Number(rec.amount) || 0,
        count: 1,
        nextDate: dueISO,
        dates: [dueISO],
        daysUntil: st.status === "upcoming" || st.status === "today" ? st.daysUntil : 0
      });
    });
    items.sort((a, b) => String(a.nextDate).localeCompare(String(b.nextDate)));
    return items;
  }

  function remainingIncome(data, period, today = todayISO(), accountId) {
    const items = [];
    const current = inPeriod(today, period);
    data.recurrings.filter((r) => r.active && r.kind === "income" && (!accountId || r.accountId === accountId)).forEach((rec) => {
      const dueISO = dueDateInPeriod(rec, period);
      if (!inPeriod(dueISO, period)) return;
      if (dueISO < today) return;
      if (chargedInPeriod(data, rec.id, period)) return;
      items.push({
        rec,
        amount: Number(rec.amount) || 0,
        count: 1,
        nextDate: dueISO,
        estimated: rec.variable !== false
      });
    });
    return items;
  }

  function settleDebts(data, today = todayISO()) {
    const key = today.slice(0, 7);
    const t = parseISO(today);
    let changed = false;
    data.recurrings.forEach((rec) => {
      if (!isDebt(rec) || rec.active === false) return;
      if (rec.lastSettledKey === key) return;
      const day = Number(rec.dayOfMonth || 1);
      if (t.getDate() < day) return;
      rec.lastSettledKey = key;
      const left = Math.max(0, (Number(rec.remainingInstallments != null ? rec.remainingInstallments : rec.installments) || 1) - 1);
      rec.remainingInstallments = left;
      rec.remainingAmount = left * (Number(rec.amount) || 0);
      if (left <= 0) rec.active = false;
      changed = true;
    });
    return changed;
  }

  function dueSoon(data, days = 7, today = todayISO()) {
    const limit = toISO(addDays(parseISO(today), days));
    return data.recurrings
      .filter((r) => r.active)
      .map((r) => {
        const st = subStatus(r, today);
        return { ...r, nextDate: st.date };
      })
      .filter((r) => r.nextDate && r.nextDate >= today && r.nextDate <= limit)
      .sort((a, b) => a.nextDate.localeCompare(b.nextDate));
  }

  function plannedMovements(data, period, today, accountId) {
    return data.transactions
      .filter((t) => {
        if (t.kind === "transfer") return false;
        if (!t.date || !inPeriod(t.date, period)) return false;
        if (accountId && t.accountId !== accountId) return false;
        if (t.applied === false) return true;
        return t.date > today;
      })
      .sort((a, b) => String(a.date).localeCompare(String(b.date)));
  }

  function settleDue(data, today = todayISO()) {
    let changed = false;
    data.transactions.forEach((tx) => {
      if (tx.applied === false && tx.date && tx.date <= today) {
        applyToBalance(data, tx, 1);
        tx.applied = true;
        changed = true;
      }
    });
    return changed;
  }

  function namedIncoming(data, period, today, accountId) {
    const recs = [];
    const planned = [];
    if (!accountId) return { recs, planned, total: 0 };
    const current = inPeriod(today, period);
    data.recurrings
      .filter((r) => r.active && r.kind !== "income" && r.accountId !== accountId)
      .forEach((rec) => {
        const dest = accountFromLabel(data, rec.name, rec.accountId);
        if (!dest || dest.id !== accountId) return;
        const dueISO = dueDateInPeriod(rec, period);
        if (!inPeriod(dueISO, period)) return;
        if (dueISO < today) return;
        if (chargedInPeriod(data, rec.id, period)) return;
        recs.push({ rec, amount: Number(rec.amount) || 0, nextDate: dueISO });
      });
    (data.transactions || []).forEach((t) => {
      if (t.kind !== "expense" || t.accountId === accountId) return;
      if (!t.date || !inPeriod(t.date, period)) return;
      if (t.applied !== false && t.date <= today) return;
      const dest = counterpartFor(data, t);
      if (!dest || dest.id !== accountId) return;
      planned.push(t);
    });
    const total = recs.reduce((s, x) => s + x.amount, 0) + planned.reduce((s, t) => s + (Number(t.amount) || 0), 0);
    return { recs, planned, total };
  }

  function snapshot(data, period, today = todayISO(), accountId) {
    const focus = accountId || (focusAccount(data) && focusAccount(data).id) || null;
    const txs = txsInPeriod(data, period, focus ? { accountId: focus } : {});
    const done = txs.filter((t) => t.applied !== false);
    const spent = sumByKind(done, "expense");
    const earned = sumByKind(done, "income");
    const now = currentBalance(data, focus);
    const charges = remainingCharges(data, period, today, focus);
    const incomes = remainingIncome(data, period, today, focus);
    const planned = plannedMovements(data, period, today, focus);
    const plannedOut = planned.filter((t) => t.kind === "expense").reduce((s, t) => s + (Number(t.amount) || 0), 0);
    const plannedIn = planned.filter((t) => t.kind === "income").reduce((s, t) => s + (Number(t.amount) || 0), 0);
    const incoming = namedIncoming(data, period, today, focus);
    const chargesTotal = charges.reduce((s, x) => s + x.amount, 0) + plannedOut;
    const incomeLeft = incomes.reduce((s, x) => s + x.amount, 0) + plannedIn + incoming.total;
    const buffer = Number(data.settings.safetyBuffer) || 0;
    const afterCharges = now - chargesTotal + incoming.total + plannedIn;
    const endOfMonth = now - chargesTotal + incomeLeft;
    const left = daysLeftInPeriod(period, today);
    const variableSpent = done
      .filter((t) => t.kind === "expense" && !t.recurringId && t.date <= today)
      .reduce((s, t) => s + (Number(t.amount) || 0), 0);
    const elapsed = Math.max(1, daysInPeriod(period) - left + (inPeriod(today, period) ? 1 : 0));
    const dailyVariable = variableSpent / elapsed;
    const projectedVariable = dailyVariable * left;
    const afterAll = endOfMonth - projectedVariable;
    const safeToday = Math.max(0, afterCharges - buffer);
    const perDay = left > 0 ? Math.max(0, (afterCharges - buffer) / left) : 0;
    const monthlyFixed = data.recurrings
      .filter((r) => r.active && r.kind !== "income" && (!focus || r.accountId === focus))
      .reduce((s, r) => s + monthlyEquivalent(r), 0);
    const monthlyIncome = data.recurrings
      .filter((r) => r.active && r.kind === "income" && (!focus || r.accountId === focus))
      .reduce((s, r) => s + monthlyEquivalent(r), 0);
    const monthlyFixedLeft = charges.reduce((s, x) => s + x.amount, 0);
    const incomeVariable = data.recurrings.some((r) => r.active && r.kind === "income" && r.variable !== false);
    const incomeForReste = earned > 0 ? earned : monthlyIncome;
    const baseReste = incomeForReste > 0 ? incomeForReste : now;
    const resteAVivre = baseReste - monthlyFixedLeft;
    const focusAcc = focus ? accountById(data, focus) : null;
    const debts = (data.recurrings || []).filter((r) => isDebt(r) && r.active !== false && (!focus || r.accountId === focus));
    const debtsRemaining = debts.reduce((s, r) => s + remainingDebt(r), 0);

    return {
      now,
      spent,
      earned,
      charges,
      incomes,
      planned,
      plannedOut,
      plannedIn,
      chargesTotal,
      incomeLeft,
      afterCharges,
      endOfMonth,
      afterAll,
      projectedVariable,
      safeToday,
      perDay,
      left,
      monthlyFixed,
      monthlyFixedLeft,
      monthlyIncome,
      resteAVivre,
      incomeVariable,
      buffer,
      txs,
      variableSpent,
      incoming,
      accountId: focus,
      account: focusAcc,
      debts,
      debtsRemaining
    };
  }

  function byCategory(data, period, kind = "expense", accountId) {
    const map = new Map();
    txsInPeriod(data, period, accountId ? { accountId } : {})
      .filter((t) => t.kind === kind && t.applied !== false)
      .forEach((t) => {
        const id = t.categoryId || "cat-autre";
        map.set(id, (map.get(id) || 0) + (Number(t.amount) || 0));
      });
    return [...map.entries()]
      .map(([id, total]) => ({ ...categoryById(data, id), total }))
      .sort((a, b) => b.total - a.total);
  }

  function budgets(data, period, accountId) {
    const spent = byCategory(data, period, "expense", accountId);
    const spentMap = Object.fromEntries(spent.map((c) => [c.id, c.total]));
    return data.categories
      .filter((c) => c.kind === "expense" && Number(c.budget) > 0)
      .map((c) => {
        const used = spentMap[c.id] || 0;
        const cap = Number(c.budget) || 0;
        const ratio = cap > 0 ? used / cap : 0;
        return { ...c, used, cap, ratio, left: cap - used };
      })
      .sort((a, b) => b.ratio - a.ratio);
  }

  function lastMonths(data, period, count = 6, accountId) {
    const rows = [];
    for (let i = count - 1; i >= 0; i--) {
      const p = shiftPeriod(period, -i, data.settings.monthStartDay || 1);
      const txs = txsInPeriod(data, p, accountId ? { accountId } : {});
      rows.push({
        period: p,
        label: p.start.toLocaleDateString("fr-FR", { month: "short" }).replace(".", ""),
        spent: sumByKind(txs, "expense"),
        earned: sumByKind(txs, "income")
      });
    }
    return rows;
  }

  function monthCompare(data, period, accountId) {
    const prevPeriod = shiftPeriod(period, -1, data.settings.monthStartDay || 1);
    const nowTx = txsInPeriod(data, period, accountId ? { accountId } : {});
    const prevTx = txsInPeriod(data, prevPeriod, accountId ? { accountId } : {});
    const spentNow = sumByKind(nowTx, "expense");
    const spentPrev = sumByKind(prevTx, "expense");
    const catsNow = byCategory(data, period, "expense", accountId);
    const catsPrev = byCategory(data, prevPeriod, "expense", accountId);
    const top = catsNow[0] || null;
    const topPrev = top ? catsPrev.find((c) => c.id === top.id) : null;
    return {
      spentNow,
      spentPrev,
      diff: spentNow - spentPrev,
      prevLabel: monthLabel(prevPeriod),
      nowLabel: monthLabel(period),
      top,
      topPrev: topPrev ? topPrev.total : 0,
      hasPrev: spentPrev > 0 || spentNow > 0
    };
  }

  function forecast(data, days = 45, today = todayISO(), accountId) {
    const focus = accountId || (focusAccount(data) && focusAccount(data).id) || null;
    const start = parseISO(today);
    const points = [];
    let balance = currentBalance(data, focus);
    const monthStartDay = data.settings.monthStartDay || 1;
    const extraTx = data.transactions.filter((t) => t.kind !== "transfer" && t.date > today && (!focus || t.accountId === focus));
    const debtLeft = {};
    data.recurrings.filter((r) => isDebt(r) && r.active).forEach((r) => {
      debtLeft[r.id] = Number(r.remainingInstallments != null ? r.remainingInstallments : r.installments) || 0;
    });
    for (let i = 0; i < days; i++) {
      const iso = toISO(addDays(start, i));
      extraTx.filter((t) => t.date === iso).forEach((t) => {
        const amt = Number(t.amount) || 0;
        balance += t.kind === "income" ? amt : -amt;
      });
      data.recurrings
        .filter((r) => r.active && (!focus || r.accountId === focus))
        .forEach((rec) => {
          if (isDebt(rec) && !(debtLeft[rec.id] > 0)) return;
          const dates = occurrencesInRange(rec, iso, iso);
          if (!dates.length) return;
          const already = data.transactions.some((t) => t.recurringId === rec.id && t.date === iso);
          if (already) return;
          const amt = Number(rec.amount) || 0;
          balance += rec.kind === "income" ? amt : -amt;
          if (isDebt(rec)) debtLeft[rec.id] -= 1;
        });
      points.push({ date: iso, balance });
    }
    return points;
  }

  function insights(data, period, today = todayISO(), accountId) {
    const snap = snapshot(data, period, today, accountId);
    const list = [];
    if (snap.afterCharges < 0) {
      list.unshift({
        tone: "warn",
        title: "À découvert après les dépenses",
        text: "Une fois les forfaits et mouvements prévus payés, il manquera " + money(-snap.afterCharges) + "."
      });
    } else if (snap.chargesTotal > 0 && snap.afterCharges < 50) {
      list.unshift({
        tone: "warn",
        title: "C’est serré",
        text: "Après les forfaits, il te restera " + money(snap.afterCharges) + "."
      });
    }
    const cmp = monthCompare(data, period, accountId);
    if (cmp.hasPrev && cmp.spentPrev > 0) {
      const more = cmp.diff > 1;
      const less = cmp.diff < -1;
      list.push({
        tone: more ? "warn" : "muted",
        title: "Par rapport à " + cmp.prevLabel,
        text: more
          ? "Tu as déjà dépensé " + money(cmp.diff) + " de plus qu’en " + cmp.prevLabel + " (" + money(cmp.spentNow) + " vs " + money(cmp.spentPrev) + ")."
          : less
            ? "Tu as dépensé " + money(-cmp.diff) + " de moins qu’en " + cmp.prevLabel + "."
            : "Même rythme qu’en " + cmp.prevLabel + " (" + money(cmp.spentNow) + ")."
      });
      if (cmp.top && cmp.top.total > 0) {
        const delta = cmp.top.total - cmp.topPrev;
        if (Math.abs(delta) > 1) {
          list.push({
            tone: delta > 0 ? "warn" : "muted",
            title: cmp.top.name,
            text: delta > 0
              ? money(cmp.top.total) + " ce mois · " + money(delta) + " de plus qu’en " + cmp.prevLabel + "."
              : money(cmp.top.total) + " ce mois · " + money(-delta) + " de moins qu’en " + cmp.prevLabel + "."
          });
        }
      }
    }
    if (snap.charges.length || snap.plannedOut > 0) {
      list.push({
        tone: "gold",
        title: "Après vos dépenses",
        text:
          "Il restera " +
          money(snap.afterCharges) +
          " sur " +
          ((snap.account && snap.account.name) || "ce compte") +
          " une fois les dépenses encore prévues payées (" +
          money(snap.chargesTotal) +
          ")."
      });
    }
    if (snap.monthlyIncome > 0 || snap.earned > 0) {
      const base = snap.earned > 0 ? snap.earned : snap.monthlyIncome;
      const pct = base > 0 ? Math.round((snap.monthlyFixed / base) * 100) : 0;
      list.push({
        tone: pct > 70 ? "warn" : "muted",
        title: "Poids des forfaits",
        text:
          "Vos charges fixes représentent " +
          pct +
          " % " +
          (snap.earned > 0 ? "de ce que vous avez reçu ce mois" : "de votre revenu habituel (estimation)") +
          " · reste à vivre " +
          money(snap.resteAVivre) +
          "."
      });
    }
    if (snap.debtsRemaining > 0) {
      list.push({
        tone: "warn",
        title: "Dettes en cours",
        text:
          snap.debts.length +
          " crédit" +
          (snap.debts.length > 1 ? "s" : "") +
          " · " +
          money(snap.debtsRemaining) +
          " encore à rembourser (mensualités comprises dans les charges du mois)."
      });
    }
    const soon = dueSoon(data, 5, today);
    if (soon.length) {
      const first = soon[0];
      list.push({
        tone: "warn",
        title: "Prélèvement proche",
        text: first.name + " (" + money(first.amount) + ") le " + formatDate(first.nextDate) + "."
      });
    }
    const over = budgets(data, period).filter((b) => b.ratio >= 1);
    if (over.length) {
      list.push({
        tone: "warn",
        title: "Budget dépassé",
        text: over.map((b) => b.name).join(", ") + " — le plafond du mois est atteint."
      });
    }
    const cats = byCategory(data, period);
    if (cats[0] && cats[0].total > 0) {
      list.push({
        tone: "muted",
        title: "Plus gros poste",
        text: cats[0].name + " · " + money(cats[0].total) + " ce mois-ci."
      });
    }
    if (!list.length) {
      list.push({
        tone: "gold",
        title: "C’est parti",
        text: "Ajoutez vos comptes, votre salaire et vos forfaits : Aurea calcule tout seul le disponible maintenant et après les charges."
      });
    }
    return list.slice(0, 6);
  }

  function suggestCategory(label) {
    const s = String(label || "").toLowerCase();
    const rules = [
      ["cat-logement", /loyer|charges? loc|syndic|appartement/],
      ["cat-courses", /carrefour|auchan|leclerc|lidl|intermarch|monoprix|courses|superette|franprix|casino/],
      ["cat-transport", /sncf|uber|essence|totalenergies|navigo|essence|parking|carburant|ratp/],
      ["cat-forfaits", /orange|sfr|free|bouygues|netflix|spotify|disney|amazon prime|internet|forfait|youtube/],
      ["cat-energie", /edf|engie|électricité|electricite|gaz|enedis/],
      ["cat-assurances", /assurance|maif|macif|axa|allianz|gmf/],
      ["cat-sante", /pharmacie|mutuelle|médecin|medecin|doctolib|dentiste/],
      ["cat-restaurant", /restaurant|mcdonald|burger|kebab|uber eats|deliveroo/],
      ["cat-sorties", /café|cafe|bar |sortie/],
      ["cat-loisirs", /cinema|cinéma|steam|playstation|concert|fnac/],
      ["cat-shopping", /zara|shein|amazon|ikea|decathlon|hm /],
      ["cat-salaire", /salaire|paie|payroll|virement employ/]
    ];
    for (const [id, re] of rules) if (re.test(s)) return id;
    return null;
  }

  return {
    toISO,
    todayISO,
    parseISO,
    addMonths,
    addDays,
    periodOf,
    shiftPeriod,
    inPeriod,
    daysLeftInPeriod,
    daysInPeriod,
    nextOccurrence,
    advanceNext,
    occurrencesInRange,
    dueDateInPeriod,
    monthlyEquivalent,
    isDebt,
    remainingDebt,
    totalDebts,
    money,
    moneyShort,
    formatDate,
    formatDateLong,
    monthLabel,
    categoryById,
    accountById,
    focusAccount,
    currentBalance,
    txsInPeriod,
    sumByKind,
    applyToBalance,
    accountFromLabel,
    remainingCharges,
    remainingIncome,
    plannedMovements,
    settleDue,
    settleDebts,
    subStatus,
    dueSoon,
    snapshot,
    byCategory,
    budgets,
    lastMonths,
    monthCompare,
    forecast,
    insights,
    suggestCategory
  };
})();
