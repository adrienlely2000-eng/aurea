/* Aurea — interface : navigation, vues, formulaires, automatismes. */

const App = (() => {
  const F = Finance;
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  const state = {
    view: "dashboard",
    period: null,
    today: F.todayISO(),
    txQ: "",
    txKind: "all",
    txCat: "",
    txAcc: "",
    year: new Date().getFullYear()
  };

  const lock = { screen: "home", profileId: "", error: "" };
  const IDLE_MS = 3 * 60 * 1000;
  const NEWS_ID = "2026-08-30-2";
  const NEWS_KEY = "aurea.news.seen";
  let idleTimer = 0;
  let newsPrompted = false;

  function bumpIdle() {
    clearTimeout(idleTimer);
    if (!Store.isUnlocked()) return;
    idleTimer = setTimeout(() => {
      if (!Store.isUnlocked()) return;
      dismissModal();
      Store.lock();
      lock.screen = "home";
      lock.error = "";
      lock.profileId = "";
      render();
      toast("Verrouillé tout seul — tu n’as plus touché.");
    }, IDLE_MS);
  }

  ["pointerdown", "keydown", "touchstart", "scroll"].forEach((ev) => {
    document.addEventListener(ev, bumpIdle, { passive: true });
  });

  let lastDeleted = null;
  let csvDraft = { rows: [] };

  function db() {
    return Store.get();
  }

  function esc(value) {
    return String(value ?? "").replace(/[&<>"']/g, (c) => (
      { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
    ));
  }

  function focusId() {
    const acc = F.focusAccount(db());
    return acc ? acc.id : "";
  }

  function ensureFocus() {
    const data = db();
    const acc = F.focusAccount(data);
    if (acc && data.settings.focusAccountId !== acc.id) {
      data.settings.focusAccountId = acc.id;
      Store.save();
    }
    return acc;
  }

  function ensurePeriod() {
    const day = db().settings.monthStartDay || 1;
    const realToday = F.todayISO();
    const oldToday = state.today;
    state.today = realToday;
    if (!state.period) {
      state.period = F.periodOf(state.today, day);
      return;
    }
    const wasOnTodayMonth = F.inPeriod(oldToday, state.period);
    if (wasOnTodayMonth && !F.inPeriod(state.today, state.period)) {
      state.period = F.periodOf(state.today, day);
    }
  }

  function toast(text, action) {
    const el = document.createElement("div");
    el.className = "toast";
    el.innerHTML = esc(text) + (action ? ` <button class="btn ghost" data-undo="1">Annuler</button>` : "");
    if (action) el.querySelector("[data-undo]").onclick = () => { action(); el.remove(); render(); };
    $("#toast-root").appendChild(el);
    setTimeout(() => el.remove(), 4200);
  }

  function closeModal() {
    const root = $("#modal-root");
    root.hidden = true;
    root.innerHTML = "";
  }

  function dismissModal() {
    const form = $("#modal-root form[data-form]");
    if (form && form.checkValidity()) {
      form.requestSubmit();
      return;
    }
    closeModal();
  }

  function openModal(html) {
    const root = $("#modal-root");
    root.hidden = false;
    root.innerHTML = `<div class="modal">${html}</div>`;
    const first = root.querySelector("input, select, textarea, button.gold");
    if (first) first.focus();
  }

  function accountOptions(selected, extra = "") {
    const list = db().accounts;
    if (!list.length) return `<option value="">Aucun compte</option>`;
    return extra + list.map((a) =>
      `<option value="${esc(a.id)}" ${a.id === selected ? "selected" : ""}>${esc(a.name)}</option>`
    ).join("");
  }

  function catButtons(kind, selected) {
    return `<div class="cat-picks" id="cat-picks">${
      db().categories.filter((c) => c.kind === kind).map((c) =>
        `<button type="button" data-cat="${esc(c.id)}" class="${c.id === selected ? "is-on" : ""}">${esc(c.icon)} ${esc(c.name)}</button>`
      ).join("")
    }</div>`;
  }

  function setNav() {
    $$("[data-view]").forEach((btn) => {
      btn.classList.toggle("is-active", btn.dataset.view === state.view);
    });
    const name = db().settings.firstName || "Vous";
    const acc = F.focusAccount(db());
    const snap = F.snapshot(db(), state.period, state.today, acc && acc.id);
    $("#side-foot").innerHTML = `${esc(acc ? acc.name : name)}<b>${esc(F.money(snap.now))}</b>après dépenses ${esc(F.money(snap.afterCharges))}<button class="btn ghost" data-action="lock" style="margin-top:12px;width:100%">Verrouiller</button>`;
    $("#period-nav").innerHTML = `
      <button class="icon-btn" data-action="period-prev" aria-label="Mois précédent">‹</button>
      <strong>${esc(F.monthLabel(state.period))}</strong>
      <button class="icon-btn" data-action="period-next" aria-label="Mois suivant">›</button>
      <button class="btn ghost" data-action="period-now">Aujourd’hui</button>`;
  }

  function empty(text, actionLabel, action) {
    return `<div class="empty"><p>${esc(text)}</p>${
      action ? `<button class="btn gold" data-action="${esc(action)}">${esc(actionLabel)}</button>` : ""
    }</div>`;
  }

  /* ---------- Vues ---------- */

  function recapBlock(recap, title, dismiss) {
    return `
      <article class="card" style="margin-bottom:16px">
        <div class="split">
          <p class="kicker">${esc(title)}</p>
          ${dismiss ? `<button class="btn ghost" data-action="dismiss-recap" data-id="${esc(recap.startISO)}">OK</button>` : ""}
        </div>
        <p>Dépensé <b>${esc(F.money(recap.spent))}</b> · Reçu <b>${esc(F.money(recap.earned))}</b> · Forfaits <b>${esc(F.money(recap.forfaits))}</b></p>
      </article>`;
  }

  function viewDashboard() {
    const data = db();
    const accId = focusId();
    const snap = F.snapshot(data, state.period, state.today, accId);
    const due = [];
    const cats = F.byCategory(data, state.period, "expense", accId).slice(0, 6);
    const months = F.lastMonths(data, state.period, 6, accId);
    const cmp = F.monthCompare(data, state.period, accId);
    const recent = [...data.transactions]
      .filter((t) => !accId || t.accountId === accId || t.toAccountId === accId)
      .sort((a, b) => b.date.localeCompare(a.date) || (b.createdAt || 0) - (a.createdAt || 0))
      .slice(0, 8);
    const insights = F.insights(data, state.period, state.today, accId);
    const afterTone = snap.afterCharges < 0 ? "neg" : "gold";
    const budgetAlerts = F.budgets(data, state.period, accId).filter((b) => b.ratio >= 0.8);
    const viewingNow = F.inPeriod(state.today, state.period);
    const elapsed = F.daysInPeriod(state.period) - F.daysLeftInPeriod(state.period, state.today) + (viewingNow ? 1 : 0);
    let recapHtml = "";
    if (!viewingNow) {
      const recap = F.monthRecap(data, state.period, accId);
      recapHtml = recapBlock(recap, "Récap " + recap.label, false);
    } else if (elapsed <= 7) {
      const prev = F.shiftPeriod(state.period, -1, data.settings.monthStartDay || 1);
      const recap = F.monthRecap(data, prev, accId);
      let seen = "";
      try { seen = localStorage.getItem("aurea.recap.seen") || ""; } catch (err) { seen = ""; }
      if (seen !== recap.startISO && (recap.spent > 0 || recap.earned > 0 || recap.forfaits > 0)) {
        recapHtml = recapBlock(recap, "Récap de " + recap.label, true);
      }
    }

    const dueBanner = due.length ? `
      <div class="card" style="display:flex;justify-content:space-between;gap:12px;align-items:center;flex-wrap:wrap">
        <div>
          <p class="kicker">À pointer</p>
          <p class="hint" style="margin:0">${due.length} prélèvement${due.length > 1 ? "s" : ""} arrivé${due.length > 1 ? "s" : ""} — validez-les pour tenir vos soldes à jour.</p>
        </div>
        <button class="btn gold" data-action="open-due">Pointer les charges</button>
      </div>` : "";

    const upcomingRows = [
      ...snap.charges.map((item) => ({
        kind: "rec",
        id: item.rec.id,
        icon: F.categoryById(data, item.rec.categoryId).icon,
        name: item.rec.name,
        date: item.nextDate,
        amount: item.amount,
        extra: item.daysUntil === 0 ? " · aujourd’hui" : item.daysUntil ? " · dans " + item.daysUntil + " j" : ""
      })),
      ...((snap.incoming && snap.incoming.recs) || []).map((item) => ({
        kind: "rec",
        id: item.rec.id,
        icon: F.categoryById(data, item.rec.categoryId).icon,
        name: item.rec.name,
        date: item.nextDate,
        amount: item.amount,
        extra: " · arrive ici",
        incoming: true
      })),
      ...((snap.incoming && snap.incoming.planned) || []).map((t) => ({
        kind: "tx",
        id: t.id,
        icon: F.categoryById(data, t.categoryId).icon,
        name: t.label,
        date: t.date,
        amount: t.amount,
        extra: " · arrive ici",
        incoming: true
      })),
      ...snap.planned.filter((t) => t.kind === "expense").map((t) => ({
        kind: "tx",
        id: t.id,
        icon: F.categoryById(data, t.categoryId).icon,
        name: t.label,
        date: t.date,
        amount: t.amount,
        extra: " · à pointer"
      })),
      ...snap.planned.filter((t) => t.kind === "income").map((t) => ({
        kind: "tx",
        id: t.id,
        icon: F.categoryById(data, t.categoryId).icon,
        name: t.label,
        date: t.date,
        amount: t.amount,
        extra: " · à pointer",
        incoming: true
      }))
    ].sort((a, b) => String(a.date).localeCompare(String(b.date)));

    const accName = (snap.account && snap.account.name) || "ce compte";
    const accountPicker = data.accounts.length > 1 ? `
      <div class="cat-picks" style="margin:0 0 16px">
        ${data.accounts.map((a) => `<button type="button" data-action="focus-account" data-id="${esc(a.id)}" class="${a.id === accId ? "is-on" : ""}">${esc(a.name)}</button>`).join("")}
      </div>` : "";

    return `
      ${accountPicker}
      ${dueBanner}
      ${recapHtml}
      <div class="grid grid-kpis" style="margin-top:${due.length || data.accounts.length > 1 ? "16px" : "0"}">
        <article class="card metal">
          <p class="kicker">Maintenant</p>
          <p class="hero-num">${esc(F.money(snap.now))}</p>
          <p class="hint">${esc(accName)} · solde réel (comme à la banque)</p>
        </article>
        <article class="card">
          <p class="kicker">Une fois les dépenses faites</p>
          <p class="hero-num ${afterTone}">${esc(F.money(snap.afterCharges))}</p>
          <p class="hint">${
            snap.incoming && snap.incoming.total > 0 && snap.chargesTotal > 0
              ? `${esc(F.money(snap.now))} − ${esc(F.money(snap.chargesTotal))} + ${esc(F.money(snap.incoming.total))} qui arrive (ex. épargne)`
              : snap.incoming && snap.incoming.total > 0
                ? `${esc(F.money(snap.now))} + ${esc(F.money(snap.incoming.total))} encore à recevoir sur ce compte`
              : snap.chargesTotal > 0
              ? `${esc(F.money(snap.now))} − ${esc(F.money(snap.chargesTotal))} encore à venir ce mois (forfaits, dettes, mouvements datés)`
              : "Aucune dépense encore prévue sur ce mois"
          }</p>
        </article>
      </div>
      <form data-form="quick-balance" class="card" style="margin-top:16px;display:flex;flex-wrap:wrap;gap:10px;align-items:flex-end">
        <div class="field" style="flex:1;min-width:180px">
          <label>Solde réel du compte (comme sur l’appli banque)</label>
          <input name="balance" inputmode="decimal" value="${esc(snap.now)}" />
        </div>
        <button class="btn gold" type="submit">Actualiser</button>
      </form>
      <form data-form="quick-expense" class="card" style="margin-top:16px">
        <p class="kicker">Dépense rapide</p>
        <div style="display:flex;flex-wrap:wrap;gap:10px;align-items:flex-end;margin-top:8px">
          <div class="field" style="flex:1;min-width:120px"><label>Montant</label><input name="amount" inputmode="decimal" placeholder="12,50" required /></div>
          <div class="field" style="flex:2;min-width:160px"><label>Quoi</label><input name="label" placeholder="Loyer, EDF, Carrefour…" /></div>
          <input type="hidden" name="categoryId" value="cat-autre" />
          <button class="btn gold" type="submit">OK</button>
        </div>
        <div class="split" style="margin-top:10px;align-items:center">
          <p class="hint" data-quick-cat><b>· Autre</b><small> · écris ce que c’est, Aurea choisit. Ou ouvre la liste.</small></p>
          <button type="button" class="btn ghost" data-action="pick-quick-cat">Catégories</button>
        </div>
      </form>
      <form data-form="quick-remb" class="card" style="margin-top:16px">
        <p class="kicker">Remboursement</p>
        <p class="hint">On t’a rendu de l’argent. Ça s’ajoute, ce n’est pas un salaire.</p>
        <div style="display:flex;flex-wrap:wrap;gap:10px;align-items:flex-end;margin-top:8px">
          <div class="field" style="flex:1;min-width:120px"><label>Montant</label><input name="amount" inputmode="decimal" placeholder="15" required /></div>
          <div class="field" style="flex:2;min-width:160px"><label>Quoi (optionnel)</label><input name="label" placeholder="Remboursé par…" /></div>
          <button class="btn gold" type="submit">OK</button>
        </div>
      </form>
      ${snap.afterCharges < 0 ? `
      <article class="card tight-alert" style="margin-top:16px">
        <p class="kicker">Attention</p>
        <p>Après les forfaits et mouvements prévus, tu seras à <b>découvert de ${esc(F.money(-snap.afterCharges))}</b>.</p>
      </article>` : snap.chargesTotal > 0 && snap.afterCharges < 50 ? `
      <article class="card tight-alert" style="margin-top:16px">
        <p class="kicker">C’est serré</p>
        <p>Après les forfaits, il te restera <b>${esc(F.money(snap.afterCharges))}</b>.</p>
      </article>` : ""}
      ${budgetAlerts.length ? `
      <article class="card tight-alert" style="margin-top:16px">
        <p class="kicker">${budgetAlerts.some((b) => b.ratio >= 1) ? "Budget dépassé" : "Budget bientôt atteint"}</p>
        ${budgetAlerts.map((b) => `<p>${esc(b.name)} : <b>${esc(F.money(b.used))}</b> / ${esc(F.money(b.cap))}${
          b.ratio >= 1 ? " · dépassé de " + esc(F.money(-b.left)) : " · encore " + esc(F.money(b.left))
        }</p>`).join("")}
        <button class="btn ghost" style="margin-top:10px" data-view="budget">Voir le budget</button>
      </article>` : ""}
      ${cmp.hasPrev && cmp.spentPrev > 0 ? `
      <article class="card" style="margin-top:16px">
        <p class="kicker">Par rapport à ${esc(cmp.prevLabel)}</p>
        <p>${
          cmp.diff > 1
            ? `Tu as déjà dépensé <b>${esc(F.money(cmp.diff))}</b> de plus (${esc(F.money(cmp.spentNow))} vs ${esc(F.money(cmp.spentPrev))}).`
            : cmp.diff < -1
              ? `Tu as dépensé <b>${esc(F.money(-cmp.diff))}</b> de moins (${esc(F.money(cmp.spentNow))} vs ${esc(F.money(cmp.spentPrev))}).`
              : `Même rythme : ${esc(F.money(cmp.spentNow))}.`
        }${cmp.top && Math.abs(cmp.top.total - cmp.topPrev) > 1 ? ` · ${esc(cmp.top.name)} : ${esc(F.money(cmp.top.total))} (${(cmp.top.total - cmp.topPrev) > 0 ? "+" : "−"}${esc(F.money(Math.abs(cmp.top.total - cmp.topPrev)))}).` : ""}</p>
      </article>` : ""}

      ${snap.debtsRemaining > 0 ? `
      <article class="card" style="margin-top:16px">
        <div class="split">
          <div>
            <p class="kicker">Dettes en cours</p>
            <p class="hero-num" style="font-size:1.8rem">${esc(F.money(snap.debtsRemaining))}</p>
            <p class="hint">${snap.debts.length} paiement${snap.debts.length > 1 ? "s" : ""} en plusieurs fois · les mensualités de ce mois sont déjà dans « une fois les dépenses faites »</p>
          </div>
          <button class="btn ghost" data-view="recurrings">Détail</button>
        </div>
      </article>` : ""}

      <div class="grid grid-3" style="margin-top:16px">
        <article class="card">
          <p class="kicker">Dépensé ce mois</p>
          <p class="hero-num" style="font-size:1.8rem">${esc(F.money(snap.spent))}</p>
          ${snap.plannedOut ? `<p class="hint">dont ${esc(F.money(snap.plannedOut))} encore à venir</p>` : ""}
        </article>
        <article class="card">
          <form data-form="quick-salary">
            <p class="kicker">Reçu ce mois</p>
            <p class="hero-num pos" style="font-size:1.8rem">${esc(F.money(snap.earned))}</p>
            <p class="hint">${snap.earned > 0 ? "Salaire déjà noté. Un extra ? Ajoute-le." : "Tu viens d’être payé ? Note le montant, c’est tout."}</p>
            <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:flex-end;margin-top:10px">
              <div class="field" style="flex:1;min-width:120px">
                <label>Salaire reçu</label>
                <input name="amount" inputmode="decimal" placeholder="1850" required />
              </div>
              <button class="btn gold" type="submit">OK</button>
            </div>
          </form>
        </article>
        <article class="card">
          <p class="kicker">Reste à vivre</p>
          <p class="hero-num ${snap.resteAVivre < 0 ? "neg" : ""}" style="font-size:1.8rem">${esc(F.money(snap.resteAVivre))}</p>
          <p class="hint">${
            (snap.earned > 0 || snap.monthlyIncome > 0)
              ? `${esc(F.money(snap.earned > 0 ? snap.earned : snap.monthlyIncome))} de revenu − ${esc(F.money(snap.monthlyFixedLeft))} encore à payer ce mois`
              : snap.monthlyFixedLeft > 0
                ? `${esc(F.money(snap.now))} de solde − ${esc(F.money(snap.monthlyFixedLeft))} de forfaits encore à payer`
                : "Plus aucun forfait à payer ce mois-ci (déjà passé, ça compte le mois prochain)"
          }</p>
        </article>
      </div>

      <div class="grid grid-2" style="margin-top:16px">
        <article class="card">
          <div class="split">
            <p class="kicker">Pas encore passé à la banque</p>
            <button class="btn ghost" data-action="quick-add">Ajouter</button>
          </div>
          <p class="hint">Uniquement aujourd’hui et plus tard. Un forfait le 12 ou le 27, le 28, c’est déjà passé — il est dans ton solde réel (Actualiser si besoin). Clique ici seulement quand la banque vient de prélever.</p>
          <div class="list">
            ${
              upcomingRows.length
                ? upcomingRows.map((item) => `
                  <button class="row" data-action="${item.kind === "rec" ? "pay-recurring" : "pointer-tx"}" data-id="${esc(item.id)}">
                    <span class="glyph">${esc(item.icon)}</span>
                    <span><b>${esc(item.name)}</b><small>${esc(F.formatDate(item.date))}${esc(item.extra)}</small></span>
                    <span class="amt ${item.incoming ? "in" : "out"}">${item.incoming ? "+" : "−"} ${esc(F.money(item.amount))}</span>
                  </button>`).join("")
                : `<p class="hint">Ajoute un mouvement avec une date : il sera retiré de « une fois les dépenses faites ».</p>`
            }
          </div>
          ${snap.incomeLeft ? `<p class="hint">Revenu encore possible${snap.incomes.some((x) => x.estimated) ? " (estimation)" : ""} : ${esc(F.money(snap.incomeLeft))}</p>` : ""}
        </article>
        <article class="card">
          <p class="kicker">Ce que Aurea voit</p>
          ${insights.map((i) => `<div class="insight"><b>${esc(i.title)}</b><span class="hint">${esc(i.text)}</span></div>`).join("")}
        </article>
      </div>

      <div class="grid grid-2" style="margin-top:16px">
        <article class="card">
          <p class="kicker">Où va l’argent</p>
          ${
            cats.length
              ? `<div class="chart-wrap">
                  ${Charts.donut(cats.map((c) => ({ value: c.total, color: c.color })))}
                  <div class="legend">${cats.map((c) => {
                    const pct = Math.round((c.total / cats.reduce((s, x) => s + x.total, 0)) * 100);
                    return `<div><span class="swatch" style="background:${esc(c.color)}"></span>${esc(c.name)} · ${esc(F.money(c.total))} · ${pct}%</div>`;
                  }).join("")}</div>
                </div>`
              : empty("Pas encore de dépenses ce mois-ci.", "Ajouter", "quick-add")
          }
        </article>
        <article class="card">
          <p class="kicker">6 derniers mois</p>
          ${Charts.bars(months)}
          <p class="hint">Terracotta : dépenses · bleu : revenus</p>
        </article>
      </div>

      <div class="section-title">
        <h2>Derniers mouvements</h2>
        <button class="btn ghost" data-view="transactions">Tout voir</button>
      </div>
      <article class="card">
        ${recent.length ? txList(recent) : empty("Aucun mouvement pour l’instant.", "Ajouter une dépense", "quick-add")}
      </article>
    `;
  }

  function txListGrouped(txs) {
    const groups = [];
    txs.forEach((t) => {
      const last = groups[groups.length - 1];
      if (!last || last.date !== t.date) groups.push({ date: t.date, items: [t] });
      else last.items.push(t);
    });
    return groups.map((g) => `<p class="kicker" style="padding:10px 8px 0">${esc(F.formatDateLong(g.date))}</p>${txList(g.items)}`).join("");
  }

  function txList(txs) {
    const data = db();
    return `<div class="list">${txs.map((t) => {
      const cat = F.categoryById(data, t.categoryId);
      const acc = F.accountById(data, t.accountId);
      const sign = t.kind === "income" ? "+" : t.kind === "transfer" ? "↔" : "−";
      const cls = t.kind === "income" ? "in" : t.kind === "expense" ? "out" : "";
      const planned = t.date > state.today;
      return `<button class="row" data-action="edit-tx" data-id="${esc(t.id)}">
        <span class="glyph">${esc(t.kind === "transfer" ? "↔" : cat.icon)}</span>
        <span><b>${esc(t.label)}</b><small>${esc(F.formatDate(t.date))} · ${esc(acc ? acc.name : "")}${t.kind === "transfer" ? " → " + esc((F.accountById(data, t.toAccountId) || {}).name || "") : ""}${planned ? " · prévu" : ""}</small></span>
        <span class="amt ${cls}">${sign} ${esc(F.money(t.amount))}</span>
      </button>`;
    }).join("")}</div>`;
  }

  function viewAccounts() {
    const data = db();
    return `
      <div class="section-title">
        <h2>Comptes</h2>
        <button class="btn gold" data-action="new-account">Nouveau compte</button>
      </div>
      <p class="hint">Le tableau de bord suit un compte à la fois. Clique un compte pour le suivre.</p>
      <div class="account-grid">
        ${
          data.accounts.map((a) => `
            <button class="card metal" data-action="edit-account" data-id="${esc(a.id)}" style="text-align:left;width:100%">
              <div class="split"><span class="chip">${esc(typeLabel(a.type))}</span>${data.settings.focusAccountId === a.id || (!data.settings.focusAccountId && F.focusAccount(data) && F.focusAccount(data).id === a.id) ? `<span class="chip">suivi</span>` : ""}</div>
              <div>
                <p class="kicker">${esc(a.name)}</p>
                <p class="hero-num" style="font-size:2rem">${esc(F.money(a.balance))}</p>
              </div>
            </button>
          `).join("") || empty("Ajoutez votre compte courant pour démarrer.", "Ajouter un compte", "new-account")
        }
      </div>
    `;
  }

  function typeLabel(type) {
    return { checking: "Courant", savings: "Épargne", cash: "Espèces", card: "Carte" }[type] || "Compte";
  }

  function viewTransactions() {
    const data = db();
    let txs = F.txsInPeriod(data, state.period, {
      q: state.txQ,
      categoryId: state.txCat || undefined,
      accountId: state.txAcc || undefined
    });
    if (state.txKind !== "all") txs = txs.filter((t) => t.kind === state.txKind);
    txs.sort((a, b) => b.date.localeCompare(a.date));
      const spent = F.sumByKind(txs, "expense");
    const earned = F.sumByKind(txs, "income");
    return `
      <div class="section-title">
        <h2>Mouvements</h2>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn" data-action="import-csv">Relevé CSV</button>
          <button class="btn gold" data-action="quick-add">Ajouter</button>
        </div>
      </div>
      <div class="filters">
        <input type="search" id="tx-q" value="${esc(state.txQ)}" placeholder="Rechercher un libellé…" />
        <select id="tx-kind">
          <option value="all" ${state.txKind === "all" ? "selected" : ""}>Tous</option>
          <option value="expense" ${state.txKind === "expense" ? "selected" : ""}>Dépenses</option>
          <option value="income" ${state.txKind === "income" ? "selected" : ""}>Revenus</option>
          <option value="transfer" ${state.txKind === "transfer" ? "selected" : ""}>Virements</option>
        </select>
        <select id="tx-cat">
          <option value="">Catégories</option>
          ${data.categories.map((c) => `<option value="${esc(c.id)}" ${state.txCat === c.id ? "selected" : ""}>${esc(c.name)}</option>`).join("")}
        </select>
        <select id="tx-acc">
          <option value="">Comptes</option>
          ${data.accounts.map((a) => `<option value="${esc(a.id)}" ${state.txAcc === a.id ? "selected" : ""}>${esc(a.name)}</option>`).join("")}
        </select>
      </div>
      <p class="hint">${txs.length} ligne${txs.length > 1 ? "s" : ""} · sorties ${esc(F.money(spent))} · entrées ${esc(F.money(earned))}</p>
      <article class="card">${txs.length ? txListGrouped(txs) : empty("Aucun mouvement sur cette période.", "Ajouter", "quick-add")}</article>
    `;
  }

  function viewRecurrings() {
    const data = db();
    const snap = F.snapshot(data, state.period, state.today, focusId());
    const forfaits = data.recurrings.filter((r) => r.kind !== "income" && r.mode !== "debt");
    const dettes = data.recurrings.filter((r) => r.mode === "debt");
    const revenus = data.recurrings.filter((r) => r.kind === "income");
    const accId = focusId();
    const forfaitsMonth = forfaits
      .filter((r) => r.active !== false && (!accId || r.accountId === accId))
      .reduce((s, r) => s + F.monthlyEquivalent(r), 0);
    const dettesMonth = dettes
      .filter((r) => r.active !== false && (!accId || r.accountId === accId))
      .reduce((s, r) => s + F.monthlyEquivalent(r), 0);
    const depenseMois = forfaitsMonth + dettesMonth;
    const groups = [
      { title: "Forfaits & abos", list: forfaits, empty: "Mobile, internet, Netflix… Ajoute-les un par un.", action: "new-recurring", label: "Ajouter un forfait" },
      { title: "Dettes & paiements en plusieurs fois", list: dettes, empty: "Amazon en 10 fois, crédit tel… Indique la mensualité et les mois restants.", action: "new-debt", label: "Ajouter une dette" },
      { title: "Revenus récurrents", list: revenus, empty: "Saisissez chaque revenu quand il arrive. Le montant peut varier.", action: "log-income", label: "Saisir un revenu" }
    ];
    return `
      <div class="section-title">
        <h2>Forfaits & dettes</h2>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn" data-action="new-recurring">Ajouter un forfait</button>
          <button class="btn gold" data-action="new-debt">Ajouter une dette</button>
        </div>
      </div>
      <article class="card metal" style="margin-bottom:16px">
        <p class="kicker">Dépense par mois</p>
        <p class="hero-num">${esc(F.money(depenseMois))}</p>
        <p class="hint">${esc(F.money(forfaitsMonth))} de forfaits + ${esc(F.money(dettesMonth))} de dettes (mensualités)</p>
      </article>
      <div class="grid grid-3">
        <article class="card"><p class="kicker">Forfaits / mois</p><p class="hero-num" style="font-size:1.8rem">${esc(F.money(forfaitsMonth))}</p></article>
        <article class="card"><p class="kicker">Dettes restantes</p><p class="hero-num" style="font-size:1.8rem">${esc(F.money(snap.debtsRemaining))}</p><p class="hint">${esc(F.money(dettesMonth))} / mois · ${snap.debts.length} en cours</p></article>
        <article class="card"><p class="kicker">Reste à vivre</p><p class="hero-num ${snap.resteAVivre < 0 ? "neg" : "gold"}" style="font-size:1.8rem">${esc(F.money(snap.resteAVivre))}</p><p class="hint">${snap.monthlyFixedLeft > 0 ? "forfaits encore à payer ce mois" : "plus rien à payer ce mois-ci"}</p></article>
      </div>
      <p class="hint" style="margin-top:8px">Raccourcis forfaits :</p>
      <div class="cat-picks" style="margin-bottom:8px">
        ${Store.TEMPLATES.map((t) => `<button type="button" data-action="quick-forfait" data-name="${esc(t.name)}" data-cat="${esc(t.categoryId)}">${esc(t.name)}</button>`).join("")}
      </div>
      ${groups.map((g) => `
          <div class="section-title"><h2>${esc(g.title)}</h2></div>
          <article class="card">
            ${
              g.list.length
                ? `<div class="list">${g.list.sort((a, b) => {
                    const sa = F.subStatus(a, state.today);
                    const sb = F.subStatus(b, state.today);
                    if (a.active !== b.active) return Number(b.active) - Number(a.active);
                    return sa.daysUntil - sb.daysUntil;
                  }).map((r) => {
                    const cat = F.categoryById(data, r.categoryId);
                    const st = F.subStatus(r, state.today);
                    const left = r.mode === "debt" ? Number(r.remainingInstallments != null ? r.remainingInstallments : r.installments) || 0 : 0;
                    const stLabel = !r.active ? "pause" : st.status === "today" ? "Aujourd’hui" : st.status === "upcoming" ? "Dans " + st.daysUntil + " j" : "Passé";
                    return `<div class="row" style="grid-template-columns:auto 1fr auto auto auto">
                      <span class="glyph">${esc(cat.icon)}</span>
                      <button data-action="edit-recurring" data-id="${esc(r.id)}" style="background:none;border:0;text-align:left;padding:0">
                        <b>${esc(r.name)}</b>
                        <small>le ${esc(r.dayOfMonth || 1)} de chaque mois${r.mode === "debt" ? " · " + left + " mois restants · reste " + F.money(F.remainingDebt(r)) : ""}</small>
                      </button>
                      <span class="chip ${st.status === "today" ? "" : st.status === "upcoming" ? "blue" : "muted"}">${esc(stLabel)}</span>
                      <span class="amt ${r.kind === "income" ? "in" : "out"}">${r.kind === "income" ? "+" : "−"} ${esc(F.money(r.amount))}</span>
                      <label class="switch" title="Actif"><input type="checkbox" data-toggle-rec="${esc(r.id)}" ${r.active ? "checked" : ""}/></label>
                    </div>`;
                  }).join("")}</div>`
                : empty(g.empty, g.label, g.action)
            }
          </article>`).join("")}
    `;
  }

  function freqLabel(r) {
    return { weekly: "Chaque semaine", monthly: "Chaque mois", quarterly: "Chaque trimestre", yearly: "Chaque année" }[r.frequency] || "Mensuel";
  }

  function viewBudget() {
    const data = db();
    const rows = F.budgets(data, state.period, focusId());
    const spentMap = Object.fromEntries(F.byCategory(data, state.period, "expense", focusId()).map((c) => [c.id, c.total]));
    const cats = data.categories.filter((c) => c.kind === "expense");
    return `
      <div class="section-title">
        <h2>Budget du mois</h2>
        <button class="btn gold" data-action="edit-budgets">Fixer les plafonds</button>
      </div>
      <p class="hint">Les jauges se remplissent toutes seules à partir de vos mouvements.</p>
      <div class="grid">
        ${
          rows.length
            ? rows.map((b) => {
                const pct = Math.min(100, Math.round(b.ratio * 100));
                const cls = b.ratio >= 1 ? "warn" : b.ratio >= 0.8 ? "" : "ok";
                return `<article class="card">
                  <div class="split"><b>${esc(b.icon)} ${esc(b.name)}</b><span>${esc(F.money(b.used))} / ${esc(F.money(b.cap))}</span></div>
                  <div class="progress ${cls}" style="margin-top:10px"><span style="width:${pct}%"></span></div>
                  <p class="hint">${b.left >= 0 ? esc(F.money(b.left)) + " encore disponibles" : "dépassé de " + esc(F.money(-b.left))}</p>
                </article>`;
              }).join("")
            : empty("Aucun plafond pour l’instant. Fixez un budget courses, sorties, etc.", "Fixer les plafonds", "edit-budgets")
        }
      </div>
      <div class="section-title"><h2>Sans plafond</h2></div>
      <article class="card">
        <div class="list">
          ${cats.filter((c) => !Number(c.budget) && spentMap[c.id]).map((c) => `
            <div class="row">
              <span class="glyph">${esc(c.icon)}</span>
              <span><b>${esc(c.name)}</b><small>pas de budget</small></span>
              <span class="amt out">${esc(F.money(spentMap[c.id]))}</span>
            </div>`).join("") || `<p class="hint">Rien d’autre dépensé hors budget.</p>`}
        </div>
      </article>
    `;
  }

  function viewForecast() {
    const data = db();
    const snap = F.snapshot(data, state.period, state.today, focusId());
    const points = F.forecast(data, 45, state.today, focusId());
    const cal = monthCalendar(state.period.start);
    const last = points[points.length - 1];
    return `
      <div class="section-title"><h2>Prévisions</h2></div>
      <div class="grid grid-3">
        <article class="card"><p class="kicker">Fin de période</p><p class="hero-num ${snap.endOfMonth < 0 ? "neg" : ""}" style="font-size:1.8rem">${esc(F.money(snap.endOfMonth))}</p><p class="hint">Charges restantes + revenus encore dus</p></article>
        <article class="card"><p class="kicker">Si le rythme actuel continue</p><p class="hero-num ${snap.afterAll < 0 ? "neg" : "gold"}" style="font-size:1.8rem">${esc(F.money(snap.afterAll))}</p><p class="hint">Inclut vos dépenses variables déjà observées</p></article>
        <article class="card"><p class="kicker">Dans 45 jours</p><p class="hero-num" style="font-size:1.8rem">${esc(F.money(last ? last.balance : snap.now))}</p><p class="hint">Abonnements projetés, hors imprévus</p></article>
      </div>
      <article class="card" style="margin-top:16px">
        <p class="kicker">Solde projeté</p>
        ${Charts.area(points)}
      </article>
      <div class="section-title"><h2>Calendrier</h2></div>
      <article class="card">${cal}</article>
    `;
  }

  function monthCalendar(date) {
    const data = db();
    const y = date.getFullYear();
    const m = date.getMonth();
    const first = new Date(y, m, 1);
    const startWeek = (first.getDay() + 6) % 7;
    const lastDate = new Date(y, m + 1, 0).getDate();
    const days = ["L", "M", "M", "J", "V", "S", "D"];
    let html = days.map((d) => `<b>${d}</b>`).join("");
    for (let i = 0; i < startWeek; i++) html += `<div class="day mute"></div>`;
    for (let d = 1; d <= lastDate; d++) {
      const iso = F.toISO(new Date(y, m, d));
      const recs = data.recurrings.filter((r) => {
        if (!r.active) return false;
        if (focusId() && r.accountId !== focusId()) return false;
        const period = F.periodOf(iso, 1);
        return F.dueDateInPeriod(r, period) === iso;
      });
      const planned = data.transactions.filter((t) => t.date === iso && t.kind !== "transfer" && (!focusId() || t.accountId === focusId()));
      const hasOut = recs.some((r) => r.kind !== "income") || planned.some((t) => t.kind === "expense");
      const hasIn = recs.some((r) => r.kind === "income") || planned.some((t) => t.kind === "income");
      const cls = [
        iso === state.today ? "is-today" : "",
        hasOut ? "has-out" : "",
        hasIn ? "has-in" : ""
      ].join(" ");
      const tip = recs.map((r) => r.name).concat(planned.map((t) => t.label)).join(", ");
      const n = recs.length + planned.length;
      html += `<div class="day ${cls}" title="${esc(tip)}"><div>${d}</div>${n ? `<small>${n}</small>` : ""}</div>`;
    }
    return `<div class="cal">${html}</div><p class="hint">Les cases colorées signalent un prélèvement ou un revenu prévu.</p>`;
  }

  function viewYear() {
    const data = db();
    const y = state.year || state.period.start.getFullYear();
    state.year = y;
    const summary = F.yearSummary(data, y, focusId());
    const accName = (F.focusAccount(data) && F.focusAccount(data).name) || "ce compte";
    return `
      <div class="section-title">
        <h2>Année ${esc(y)}</h2>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn" data-action="year-prev">‹ ${esc(y - 1)}</button>
          <button class="btn" data-action="year-next">${esc(y + 1)} ›</button>
        </div>
      </div>
      <p class="hint">${esc(accName)} · totaux de janvier à décembre, sans changer ton solde réel.</p>
      <div class="grid grid-3">
        <article class="card"><p class="kicker">Dépensé</p><p class="hero-num" style="font-size:1.8rem">${esc(F.money(summary.spent))}</p></article>
        <article class="card"><p class="kicker">Reçu</p><p class="hero-num pos" style="font-size:1.8rem">${esc(F.money(summary.earned))}</p></article>
        <article class="card"><p class="kicker">Épargne notée</p><p class="hero-num gold" style="font-size:1.8rem">${esc(F.money(summary.epargne))}</p><p class="hint">Mouvements catégorie Épargne</p></article>
      </div>
      <div class="grid grid-2" style="margin-top:16px">
        <article class="card metal">
          <p class="kicker">Forfaits sur 12 mois</p>
          <p class="hero-num">${esc(F.money(summary.forfaitsYear))}</p>
          <p class="hint">${summary.forfaitsCount} forfait${summary.forfaitsCount > 1 ? "s" : ""} · ${esc(F.money(summary.forfaitsYear / 12))} / mois</p>
        </article>
        <article class="card">
          <p class="kicker">Dettes sur 12 mois</p>
          <p class="hero-num">${esc(F.money(summary.dettesYear))}</p>
          <p class="hint">${summary.dettesCount ? esc(F.money(summary.dettesLeft)) + " encore à rembourser · " + esc(F.money(summary.dettesYear / 12)) + " / mois" : "Aucune dette en cours"}</p>
        </article>
      </div>
      <article class="card" style="margin-top:16px">
        <p class="kicker">Mois par mois</p>
        ${Charts.bars(summary.months)}
        <p class="hint">Terracotta : dépenses · bleu : revenus</p>
      </article>
    `;
  }

  function viewGoals() {
    const data = db();
    return `
      <div class="section-title">
        <h2>Objectifs</h2>
        <button class="btn gold" data-action="new-goal">Nouvel objectif</button>
      </div>
      <p class="hint">Vacances, fonds d’urgence, projet… Aurea suit l’avancement.</p>
      <div class="grid">
        ${
          data.goals.map((g) => {
            const ratio = g.target ? Math.min(1, (Number(g.current) || 0) / Number(g.target)) : 0;
            return `<article class="card">
              <div class="split">
                <div>
                  <p class="kicker">${esc(g.name)}</p>
                  <p class="hero-num" style="font-size:1.8rem">${esc(F.money(g.current))}</p>
                  <p class="hint">objectif ${esc(F.money(g.target))}${g.deadline ? " · " + esc(F.formatDate(g.deadline)) : ""}</p>
                </div>
                <div>
                  <button class="btn ghost" data-action="edit-goal" data-id="${esc(g.id)}">Modifier</button>
                </div>
              </div>
              <div class="progress ok" style="margin-top:12px"><span style="width:${Math.round(ratio * 100)}%"></span></div>
            </article>`;
          }).join("") || empty("Aucun objectif. Un fonds d’urgence de 3 mois de charges est un bon départ.", "Créer un objectif", "new-goal")
        }
      </div>
    `;
  }

  function viewSettings() {
    const s = db().settings;
    const me = Store.activeProfile();
    const others = Store.profiles().filter((p) => !me || p.id !== me.id);
    return `
      <div class="section-title"><h2>Réglages</h2></div>
      <article class="card">
        <form class="form-grid" data-form="settings">
          <div class="field"><label>Prénom</label><input name="firstName" value="${esc(s.firstName)}" /></div>
          <div class="field"><label>Thème</label>
            <select name="theme">
              <option value="dark" ${s.theme === "dark" ? "selected" : ""}>Sombre</option>
              <option value="light" ${s.theme === "light" ? "selected" : ""}>Clair</option>
            </select>
          </div>
          <div class="field"><label>Début de période (jour)</label><input name="monthStartDay" type="number" min="1" max="28" value="${esc(s.monthStartDay || 1)}" /></div>
          <div class="field"><label>Coussin de sécurité</label><input name="safetyBuffer" type="number" min="0" step="10" value="${esc(s.safetyBuffer || 0)}" />
            <small class="hint">Retiré du « par jour restant » pour garder une marge.</small>
          </div>
          <div class="full"><button class="btn gold" type="submit">Enregistrer</button></div>
        </form>
      </article>
      <div class="section-title"><h2>Espaces protégés</h2></div>
      <article class="card">
        <p class="hint">Toi et ton père avez chacun votre espace, avec un mot de passe. L’un ne voit pas les comptes de l’autre.</p>
        <p class="hint" style="margin-top:8px">Espace ouvert : <strong>${esc((me && me.name) || s.firstName || "Vous")}</strong></p>
        ${others.length ? `<p class="hint">Autres personnes : ${others.map((p) => esc(p.name)).join(", ")}</p>` : ""}
        <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:12px">
          <button class="btn" data-action="lock">Verrouiller</button>
          <button class="btn" data-action="add-person">Ajouter une personne</button>
          <button class="btn" data-action="change-password">Changer le mot de passe</button>
        </div>
      </article>
      <div class="section-title"><h2>Données</h2></div>
      <article class="card">
        <p class="hint">Tout est enregistré sur Neon quand le serveur tourne. Le relevé CSV vient de ta banque : tu coches seulement les lignes qui comptent, le solde réel ne bouge pas.</p>
        <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:12px">
          <button class="btn" data-action="export-json">Exporter</button>
          <button class="btn" data-action="import-json">Importer une sauvegarde</button>
          <button class="btn" data-action="import-csv">Importer un relevé CSV</button>
          <button class="btn" data-action="load-demo">Charger un exemple</button>
          <button class="btn warn" data-action="reset-data">Tout effacer</button>
        </div>
      </article>
    `;
  }

  const views = {
    dashboard: viewDashboard,
    accounts: viewAccounts,
    transactions: viewTransactions,
    recurrings: viewRecurrings,
    year: viewYear,
    budget: viewBudget,
    forecast: viewForecast,
    goals: viewGoals,
    settings: viewSettings
  };

  const params = new URLSearchParams(location.search);
  if (params.get("view") && ["dashboard", "accounts", "transactions", "recurrings", "year", "budget", "forecast", "goals", "settings"].includes(params.get("view"))) {
    state.view = params.get("view");
  }

  function render() {
    if (!Store.isUnlocked()) {
      document.body.classList.add("is-locked");
      document.body.classList.remove("is-onboarding");
      openLock();
      return;
    }
    document.body.classList.remove("is-locked");
    if (location.hash === "#demo") {
      history.replaceState(null, "", location.pathname + location.search);
      loadDemo();
      return;
    }
    ensurePeriod();
    ensureFocus();
    document.documentElement.dataset.theme = db().settings.theme || "dark";
    setNav();
    $("#main").innerHTML = (views[state.view] || viewDashboard)();
    document.body.classList.toggle("is-onboarding", !db().settings.setupDone);
    if (!db().settings.setupDone) openOnboard();
    else $("#onboard-root").hidden = true;
    bumpIdle();
    maybeShowNews();
  }

  function maybeShowNews() {
    if (newsPrompted || !Store.isUnlocked() || !db().settings.setupDone) return;
    try {
      if (localStorage.getItem(NEWS_KEY) === NEWS_ID) return;
    } catch (err) {
      return;
    }
    const modal = $("#modal-root");
    if (modal && !modal.hidden) return;
    newsPrompted = true;
    openModal(`
      <div class="split"><p class="kicker">Nouveautés</p><button class="icon-btn" data-action="ack-news">✕</button></div>
      <p class="hero-num" style="font-size:1.55rem">Nouvelle mise à jour</p>
      <p class="hint">Laisse la fenêtre noire ouverte. Aurea s’est mis à jour tout seul.</p>
      <ul class="hint" style="margin:14px 0 0;padding-left:18px;line-height:1.65">
        <li><b>Il se souvient des noms.</b> Tu corriges « virement Alysson » en Cadeaux une fois : la prochaine fois, Aurea propose Cadeaux tout seul. Pareil pour Lidl, EDF…</li>
        <li><b>Récap du mois</b> : Dépensé · Reçu · Forfaits. Tu le vois en changeant de mois en haut (‹ ›). En début de mois, c’est le récap du mois d’avant (bouton OK pour fermer).</li>
      </ul>
      <button class="btn gold block" style="margin-top:18px" data-action="ack-news">C’est noté</button>
    `);
  }

  function ackNews() {
    try { localStorage.setItem(NEWS_KEY, NEWS_ID); } catch (err) {}
    closeModal();
  }

  /* ---------- Formulaires ---------- */

  function txForm(existing) {
    const isEdit = !!(existing && existing.id);
    const t = existing || {
      kind: "expense",
      amount: "",
      label: "",
      date: state.today,
      accountId: focusId() || (db().accounts[0] && db().accounts[0].id),
      categoryId: "cat-autre",
      note: "",
      toAccountId: ""
    };
    openModal(`
      <div class="split">
        <p class="kicker">${isEdit ? "Modifier" : "Nouveau mouvement"}</p>
        <button class="icon-btn" data-action="close-modal">✕</button>
      </div>
      <div class="tabs" id="kind-tabs">
        <button type="button" data-kind="expense" class="${t.kind === "expense" ? "is-on" : ""}">Dépense</button>
        <button type="button" data-kind="income" class="${t.kind === "income" ? "is-on" : ""}">Revenu</button>
        <button type="button" data-kind="transfer" class="${t.kind === "transfer" ? "is-on" : ""}">Virement</button>
      </div>
      <form data-form="tx" data-id="${esc(t.id || "")}">
        <input type="hidden" name="kind" value="${esc(t.kind)}" />
        <input type="hidden" name="categoryId" value="${esc(t.categoryId || "")}" />
        <div class="field full" style="margin-top:12px">
          <label>Montant</label>
          <input class="amount-input" name="amount" inputmode="decimal" placeholder="0,00" value="${esc(t.amount)}" required />
        </div>
        <div class="form-grid">
          <div class="field full"><label>Libellé</label><input name="label" value="${esc(t.label)}" placeholder="Courses, loyer, salaire…" required /></div>
          <div class="field"><label>Date</label><input type="date" name="date" value="${esc(t.date)}" required />
            <small class="hint">Date future = pas encore retiré de Maintenant, seulement de « une fois les dépenses faites ».</small>
          </div>
          <div class="field"><label>Compte</label><select name="accountId">${accountOptions(t.accountId)}</select></div>
          <div class="field" id="to-acc" style="${t.kind === "transfer" ? "" : "display:none"}"><label>Vers</label><select name="toAccountId">${accountOptions(t.toAccountId)}</select></div>
          <div class="field full" id="cat-wrap" style="${t.kind === "transfer" ? "display:none" : ""}"><label>Catégorie</label>${catButtons(t.kind === "income" ? "income" : "expense", t.categoryId)}</div>
          <div class="field full"><label>Note</label><input name="note" value="${esc(t.note || "")}" placeholder="Optionnel" /></div>
        </div>
        <div style="display:flex;gap:8px;margin-top:16px">
          <button class="btn gold" type="submit">Enregistrer</button>
          ${isEdit ? `<button class="btn warn" type="button" data-action="delete-tx" data-id="${esc(t.id)}">Supprimer</button>` : ""}
        </div>
      </form>
    `);
  }

  function accountForm(existing) {
    const a = existing || { name: "", type: "checking", balance: "", includeInTotal: true };
    openModal(`
      <div class="split"><p class="kicker">${existing ? "Compte" : "Nouveau compte"}</p><button class="icon-btn" data-action="close-modal">✕</button></div>
      <form data-form="account" data-id="${esc(a.id || "")}">
        <div class="form-grid">
          <div class="field full"><label>Nom</label><input name="name" value="${esc(a.name)}" placeholder="Compte courant" required /></div>
          <div class="field"><label>Type</label>
            <select name="type">
              <option value="checking" ${a.type === "checking" ? "selected" : ""}>Courant</option>
              <option value="savings" ${a.type === "savings" ? "selected" : ""}>Épargne</option>
              <option value="cash" ${a.type === "cash" ? "selected" : ""}>Espèces</option>
              <option value="card" ${a.type === "card" ? "selected" : ""}>Carte</option>
            </select>
          </div>
          <div class="field"><label>${existing ? "Corriger le solde" : "Solde actuel"}</label><input name="balance" inputmode="decimal" value="${esc(a.balance)}" required /></div>
          <label class="switch full"><input type="checkbox" name="includeInTotal" ${a.includeInTotal !== false ? "checked" : ""}/> Inclure dans le total</label>
        </div>
        <div style="display:flex;gap:8px;margin-top:16px">
          <button class="btn gold" type="submit">Enregistrer</button>
          ${existing ? `<button class="btn warn" type="button" data-action="delete-account" data-id="${esc(a.id)}">Supprimer</button>` : ""}
        </div>
      </form>
    `);
  }

  function recurringForm(existing, preset) {
    const isEdit = !!(existing && existing.id);
    const mode = existing && existing.mode ? existing.mode : (preset || "forever");
    const r = existing || {
      name: "",
      amount: "",
      kind: mode === "income" ? "income" : "expense",
      mode: mode === "income" ? "forever" : mode,
      frequency: "monthly",
      dayOfMonth: Math.min(28, new Date().getDate()),
      weekday: new Date().getDay(),
      accountId: focusId() || (db().accounts[0] && db().accounts[0].id),
      categoryId: mode === "debt" ? "cat-dettes" : mode === "income" ? "cat-salaire" : "cat-forfaits",
      nextDate: state.today,
      active: true,
      variable: mode === "income",
      installments: 10,
      remainingInstallments: 10
    };
    if (!isEdit && r.kind !== "income") r.variable = false;
    const isDebt = (r.mode === "debt") || mode === "debt";
    const tab = r.kind === "income" ? "income" : isDebt ? "debt" : "expense";
    openModal(`
      <div class="split"><p class="kicker">${isEdit ? "Modifier" : (isDebt ? "Nouvelle dette" : r.kind === "income" ? "Nouveau revenu" : "Nouveau forfait")}</p><button class="icon-btn" data-action="close-modal">✕</button></div>
      <form data-form="recurring" data-id="${esc(r.id || "")}">
        <input type="hidden" name="kind" value="${esc(r.kind === "income" ? "income" : "expense")}" />
        <input type="hidden" name="mode" value="${esc(isDebt ? "debt" : "forever")}" />
        <input type="hidden" name="categoryId" value="${esc(r.categoryId)}" />
        <div class="tabs" id="r-kind">
          <button type="button" data-rkind="expense" class="${tab === "expense" ? "is-on" : ""}">Forfait</button>
          <button type="button" data-rkind="debt" class="${tab === "debt" ? "is-on" : ""}">Dette / x fois</button>
          <button type="button" data-rkind="income" class="${tab === "income" ? "is-on" : ""}">Revenu</button>
        </div>
        <div class="form-grid" style="margin-top:12px">
          <div class="field full"><label>Nom</label><input name="name" value="${esc(r.name)}" placeholder="${isDebt ? "Amazon 10x" : "Forfait mobile"}" required /></div>
          <div class="field"><label>${isDebt ? "Mensualité" : "Montant"}</label><input name="amount" inputmode="decimal" value="${esc(r.amount)}" required /></div>
          <div class="field" id="debt-fields" style="${isDebt ? "" : "display:none"}">
            <label>Mois restants</label>
            <input name="remainingInstallments" type="number" min="1" max="120" value="${esc(r.remainingInstallments || r.installments || 10)}" />
          </div>
          <div class="field" id="freq-wrap" style="${isDebt ? "display:none" : ""}"><label>Fréquence</label>
            <select name="frequency">
              <option value="monthly" ${r.frequency === "monthly" ? "selected" : ""}>Mensuel</option>
              <option value="weekly" ${r.frequency === "weekly" ? "selected" : ""}>Hebdo</option>
              <option value="quarterly" ${r.frequency === "quarterly" ? "selected" : ""}>Trimestriel</option>
              <option value="yearly" ${r.frequency === "yearly" ? "selected" : ""}>Annuel</option>
            </select>
          </div>
          <div class="field"><label>Jour du mois</label>
            <input name="dayOfMonth" type="number" min="1" max="31" value="${esc(r.dayOfMonth || 1)}" />
            <small class="hint">27 = tous les 27 de chaque mois</small>
          </div>
          <div class="field"><label>Compte</label><select name="accountId">${accountOptions(r.accountId)}</select></div>
          <p class="hint full">Si le nom contient un autre compte (ex. PEL), l’argent part d’ici et arrive là-bas.</p>
          <div class="field full"><label>Catégorie</label>${catButtons(r.kind === "income" ? "income" : "expense", r.categoryId)}</div>
          <label class="switch full" id="var-wrap" style="${isDebt || r.kind !== "income" ? "display:none" : ""}"><input type="checkbox" name="variable" ${r.variable !== false ? "checked" : ""}/> Le montant change à chaque fois</label>
          <label class="switch full"><input type="checkbox" name="active" ${r.active !== false ? "checked" : ""}/> Actif</label>
        </div>
        <p class="hint" id="debt-hint" style="${isDebt ? "" : "display:none"}">Exemple : Amazon 450 € en 10 fois → mensualité 45 € et 10 mois restants.</p>
        <div style="display:flex;gap:8px;margin-top:16px;flex-wrap:wrap">
          <button class="btn gold" type="submit">Enregistrer</button>
          ${isEdit ? `<button class="btn" type="button" data-action="pay-recurring" data-id="${esc(r.id)}">Pointer comme payé</button>` : ""}
          ${isEdit ? `<button class="btn warn" type="button" data-action="delete-recurring" data-id="${esc(r.id)}">Supprimer</button>` : ""}
        </div>
      </form>
    `);
  }

  function goalForm(existing) {
    const g = existing || { name: "", target: "", current: 0, deadline: "" };
    openModal(`
      <div class="split"><p class="kicker">${existing ? "Objectif" : "Nouvel objectif"}</p><button class="icon-btn" data-action="close-modal">✕</button></div>
      <form data-form="goal" data-id="${esc(g.id || "")}">
        <div class="form-grid">
          <div class="field full"><label>Nom</label><input name="name" value="${esc(g.name)}" placeholder="Fonds d’urgence" required /></div>
          <div class="field"><label>Objectif</label><input name="target" inputmode="decimal" value="${esc(g.target)}" required /></div>
          <div class="field"><label>Déjà mis de côté</label><input name="current" inputmode="decimal" value="${esc(g.current || 0)}" /></div>
          <div class="field full"><label>Date visée</label><input type="date" name="deadline" value="${esc(g.deadline || "")}" /></div>
        </div>
        <div style="display:flex;gap:8px;margin-top:16px">
          <button class="btn gold" type="submit">Enregistrer</button>
          ${existing ? `<button class="btn warn" type="button" data-action="delete-goal" data-id="${esc(g.id)}">Supprimer</button>` : ""}
        </div>
      </form>
    `);
  }

  function budgetsForm() {
    const cats = db().categories.filter((c) => c.kind === "expense");
    openModal(`
      <div class="split"><p class="kicker">Plafonds mensuels</p><button class="icon-btn" data-action="close-modal">✕</button></div>
      <form data-form="budgets">
        <div class="form-grid">
          ${cats.map((c) => `<div class="field"><label>${esc(c.icon)} ${esc(c.name)}</label><input name="${esc(c.id)}" type="number" min="0" step="1" value="${esc(c.budget || 0)}" /></div>`).join("")}
        </div>
        <button class="btn gold" style="margin-top:16px" type="submit">Enregistrer</button>
      </form>
    `);
  }

  function dueModal() {
    const due = db().recurrings.filter((r) => r.active && r.nextDate && r.nextDate <= state.today);
    openModal(`
      <div class="split"><p class="kicker">Pointer les charges</p><button class="icon-btn" data-action="close-modal">✕</button></div>
      <p class="hint">Les charges au montant fixe sont enregistrées d’un coup. Un revenu variable vous demandera le vrai montant.</p>
      <div class="list">
        ${due.map((r) => `
          <div class="row">
            <span class="glyph">${esc(F.categoryById(db(), r.categoryId).icon)}</span>
            <span><b>${esc(r.name)}</b><small>${esc(F.formatDate(r.nextDate))}</small></span>
            <span class="amt ${r.kind === "income" ? "in" : "out"}">${esc(F.money(r.amount))}</span>
          </div>`).join("")}
      </div>
      <button class="btn gold block" style="margin-top:16px" data-action="pay-all-due">Tout pointer</button>
    `);
  }

  function parseAmount(raw) {
    if (raw == null) return 0;
    const n = Number(String(raw).replace(/\s/g, "").replace(",", "."));
    return Number.isFinite(n) ? Math.abs(n) : 0;
  }

  function isPlusAmount(raw) {
    return /^\s*\+/.test(String(raw || ""));
  }

  function addTx(payload, skipSave) {
    const data = db();
    const tx = {
      id: Store.uid("tx"),
      createdAt: Date.now(),
      kind: payload.kind,
      amount: parseAmount(payload.amount),
      label: payload.label.trim(),
      date: payload.date,
      accountId: payload.accountId,
      toAccountId: payload.toAccountId || "",
      categoryId: payload.categoryId || "",
      note: payload.note || "",
      recurringId: payload.recurringId || "",
      importKey: payload.importKey || "",
      skipBalance: !!payload.alreadyInBank
    };
    if (tx.kind === "expense" && !tx.toAccountId) {
      const dest = F.accountFromLabel(data, tx.label, tx.accountId);
      if (dest) tx.toAccountId = dest.id;
    }
    const future = tx.date > state.today;
    tx.applied = payload.waitPointer ? false : !future;
    if (payload.alreadyInBank) tx.applied = true;
    data.transactions.push(tx);
    if (tx.applied && !tx.skipBalance) F.applyToBalance(data, tx, 1);
    if (!payload.alreadyInBank) F.rememberCategory(data, tx.label, tx.categoryId);
    if (!skipSave) Store.save();
    return tx;
  }

  function removeTx(id) {
    const data = db();
    const idx = data.transactions.findIndex((t) => t.id === id);
    if (idx < 0) return;
    const tx = data.transactions[idx];
    if (tx.applied !== false && !tx.skipBalance) F.applyToBalance(data, tx, -1);
    data.transactions.splice(idx, 1);
    Store.save();
    lastDeleted = tx;
    toast("Mouvement supprimé", () => {
      data.transactions.push(tx);
      if (tx.applied !== false && !tx.skipBalance) F.applyToBalance(data, tx, 1);
      Store.save();
    });
  }

  function pointerTx(id) {
    const data = db();
    const tx = data.transactions.find((t) => t.id === id);
    if (!tx) return;
    if (tx.applied !== false) {
      toast("Déjà pointé");
      return;
    }
    F.applyToBalance(data, tx, 1);
    tx.applied = true;
    Store.save();
    toast((tx.label || "Dépense") + " pointé — solde réel mis à jour");
  }

  function markCsvDuplicates(rows) {
    const accId = focusId();
    const known = new Set(
      db().transactions
        .filter((t) => !accId || t.accountId === accId)
        .map((t) => t.importKey || F.csvFingerprint(t.date, t.amount, t.label))
    );
    rows.forEach((row) => {
      row.dup = known.has(row.key);
      if (row.dup || row.noise) row.checked = false;
    });
    return rows;
  }

  function paintQuickCat(form, auto) {
    if (!form) return;
    const cat = F.categoryById(db(), form.categoryId.value);
    const slot = form.querySelector("[data-quick-cat]");
    if (!slot) return;
    slot.innerHTML = `<b>${esc(cat.icon)} ${esc(cat.name)}</b><small> · ${auto ? "choisi d’après le texte" : "choisi dans la liste"}</small>`;
  }

  function quickCatModal() {
    const form = document.querySelector("[data-form='quick-expense']");
    const current = form && form.categoryId ? form.categoryId.value : "cat-autre";
    const cats = db().categories.filter((c) => c.kind === "expense");
    openModal(`
      <div class="split"><p class="kicker">Catégorie</p><button class="icon-btn" data-action="close-modal">✕</button></div>
      <p class="hint">Toutes les catégories. Tu peux aussi juste écrire « loyer » ou « EDF » : Aurea le devine.</p>
      <div class="cat-picks" style="margin-top:12px">
        ${cats.map((c) => `<button type="button" data-action="set-quick-cat" data-id="${esc(c.id)}" class="${c.id === current ? "is-on" : ""}">${esc(c.icon)} ${esc(c.name)}</button>`).join("")}
      </div>
    `);
  }

  function csvModal() {
    const rows = csvDraft.rows || [];
    const n = rows.filter((r) => r.checked).length;
    const total = rows.filter((r) => r.checked).reduce((s, r) => s + (Number(r.amount) || 0), 0);
    openModal(`
      <div class="split"><p class="kicker">Relevé CSV</p><button class="icon-btn" data-action="close-modal">✕</button></div>
      <p class="hint">Coche seulement ce qui compte pour toi. Les soldes, totaux et lignes déjà notées sont décochés.</p>
      <div style="display:flex;flex-wrap:wrap;gap:8px;margin:12px 0">
        <button class="btn ghost" type="button" data-action="csv-all">Tout cocher</button>
        <button class="btn ghost" type="button" data-action="csv-none">Tout décocher</button>
        <button class="btn ghost" type="button" data-action="csv-out">Que les dépenses</button>
        <button class="btn ghost" type="button" data-action="csv-month">Que ce mois</button>
      </div>
      <p class="hint">${n} ligne${n > 1 ? "s" : ""} choisie${n > 1 ? "s" : ""} · ${esc(F.money(total))}</p>
      <div class="list csv-pick" style="max-height:42vh;overflow:auto;margin-top:8px">
        ${rows.map((row, i) => `
          <label class="row" data-action="csv-toggle" data-i="${i}" style="cursor:pointer;${row.checked ? "" : "opacity:.55"}">
            <input type="checkbox" ${row.checked ? "checked" : ""} style="width:18px;height:18px;flex-shrink:0;pointer-events:none" />
            <span><b>${esc(row.label)}</b><small>${esc(F.formatDate(row.date))}${row.dup ? " · déjà noté" : ""}${row.noise ? " · souvent inutile" : ""}</small></span>
            <span class="amt ${row.kind === "income" ? "in" : "out"}">${row.kind === "income" ? "+" : "−"} ${esc(F.money(row.amount))}</span>
          </label>`).join("")}
      </div>
      <button class="btn gold block" type="button" style="margin-top:16px" data-action="csv-import" ${n ? "" : "disabled"}>Importer la sélection</button>
    `);
  }

  function importCsvSelection() {
    const acc = F.focusAccount(db());
    if (!acc) {
      toast("Ajoute un compte d’abord");
      return;
    }
    const picked = (csvDraft.rows || []).filter((r) => r.checked);
    if (!picked.length) {
      toast("Coche au moins une ligne");
      return;
    }
    picked.forEach((row) => {
      const guessed = F.suggestCategory(row.label, db());
      const guessedCat = guessed && db().categories.find((c) => c.id === guessed);
      const categoryId = row.kind === "income"
        ? (guessedCat && guessedCat.kind === "income" ? guessed : "cat-autre-in")
        : (guessed || "cat-autre");
      addTx({
        kind: row.kind,
        amount: row.amount,
        label: row.label,
        date: row.date,
        accountId: acc.id,
        categoryId,
        importKey: row.key,
        alreadyInBank: true
      }, true);
    });
    Store.save();
    csvDraft.rows = [];
    closeModal();
    render();
    toast(picked.length + " ligne" + (picked.length > 1 ? "s" : "") + " importée" + (picked.length > 1 ? "s" : "") + " — le solde réel n’a pas bougé");
  }

  function payAmountModal(rec) {
    openModal(`
      <div class="split"><p class="kicker">${rec.kind === "income" ? "Revenu reçu" : "Montant réel"}</p><button class="icon-btn" data-action="close-modal">✕</button></div>
      <p class="hint">${rec.kind === "income" ? "Tapez le montant vraiment reçu cette fois, même s’il change par rapport au mois dernier." : "Confirmez le montant prélevé."}</p>
      <form data-form="pay-recurring" data-id="${esc(rec.id)}">
        <div class="field">
          <label>${esc(rec.name)}</label>
          <input class="amount-input" name="amount" inputmode="decimal" value="${esc(rec.amount)}" required />
        </div>
        <button class="btn gold" style="margin-top:16px" type="submit">Enregistrer</button>
      </form>
    `);
  }

  function isVariableRec(rec) {
    if (!rec) return false;
    if (rec.variable === true) return true;
    if (rec.variable === false) return false;
    return rec.kind === "income";
  }

  const payingNow = new Set();

  function payRecurring(id, amountOverride) {
    if (payingNow.has(id)) return "busy";
    const data = db();
    const rec = data.recurrings.find((r) => r.id === id);
    if (!rec) return;
    const period = state.period || F.periodOf(state.today, data.settings.monthStartDay || 1);
    const already = data.transactions.some((t) => t.recurringId === rec.id && t.date && F.inPeriod(t.date, period));
    if (already) {
      toast("Déjà pointé ce mois-ci");
      return "skip";
    }
    if (amountOverride == null && isVariableRec(rec)) {
      payAmountModal(rec);
      return "prompt";
    }
    payingNow.add(id);
    const amount = amountOverride == null ? rec.amount : amountOverride;
    addTx({
      kind: rec.kind,
      amount,
      label: rec.name,
      date: rec.nextDate && rec.nextDate < state.today ? rec.nextDate : state.today,
      accountId: rec.accountId,
      categoryId: rec.categoryId,
      recurringId: rec.id
    }, true);
    if (isVariableRec(rec) && parseAmount(amount) > 0) rec.amount = parseAmount(amount);
    if (rec.mode === "debt") {
      const left = Math.max(0, (Number(rec.remainingInstallments != null ? rec.remainingInstallments : rec.installments) || 1) - 1);
      rec.remainingInstallments = left;
      rec.remainingAmount = left * (Number(rec.amount) || 0);
      if (left <= 0) rec.active = false;
    }
    rec.nextDate = F.advanceNext(rec, rec.nextDate || state.today);
    Store.save();
    payingNow.delete(id);
    toast(rec.mode === "debt" && rec.remainingInstallments <= 0 ? rec.name + " — dernière mensualité, dette soldée" : rec.kind === "income" ? "Revenu enregistré" : rec.name + " pointé — solde réel mis à jour");
    return "done";
  }

  function saveFromForm(form) {
    const fd = new FormData(form);
    const obj = Object.fromEntries(fd.entries());
    obj.active = form.querySelector('[name="active"]') ? form.querySelector('[name="active"]').checked : obj.active;
    obj.variable = form.querySelector('[name="variable"]') ? form.querySelector('[name="variable"]').checked : obj.variable;
    obj.includeInTotal = form.querySelector('[name="includeInTotal"]') ? form.querySelector('[name="includeInTotal"]').checked : obj.includeInTotal;
    return obj;
  }

  /* ---------- Verrouillage ---------- */

  function lockLetter(name) {
    const ch = String(name || "?").trim().charAt(0);
    return esc(ch ? ch.toUpperCase() : "?");
  }

  function openLock() {
    const root = $("#onboard-root");
    root.hidden = false;
    const people = Store.profiles();
    if (!people.length && lock.screen === "home") lock.screen = "create";
    const err = lock.error ? `<p class="lock-err">${esc(lock.error)}</p>` : "";
    const picked = people.find((p) => p.id === lock.profileId);
    let inner = "";
    if (lock.screen === "login" && picked) {
      inner = `
        <p class="kicker">Espace protégé</p>
        <h2 class="hero-num" style="font-size:2rem">${esc(picked.name)}</h2>
        <p class="hint">Entre le mot de passe de cet espace.</p>
        <form data-lock-form="login" style="margin-top:18px">
          <input type="hidden" name="profileId" value="${esc(picked.id)}" />
          <div class="field"><label>Mot de passe</label><input name="password" type="password" autocomplete="current-password" required minlength="4" /></div>
          ${err}
          <div style="display:flex;gap:8px;margin-top:18px;flex-wrap:wrap">
            <button class="btn gold" type="submit">Ouvrir</button>
            <button class="btn ghost" type="button" data-lock-action="home">Retour</button>
          </div>
        </form>`;
    } else if (lock.screen === "create") {
      const legacy = Store.hasLegacyData();
      const suggested = Store.legacyName() || "";
      inner = `
        <p class="kicker">${people.length ? "Nouvelle personne" : "Espace protégé"}</p>
        <h2 class="hero-num" style="font-size:2rem">${people.length ? "Ajouter quelqu’un" : "C’est à toi."}</h2>
        <p class="hint">${people.length
          ? "Ton père (ou une autre personne) aura son propre espace, invisible du tien."
          : (legacy
            ? "Tes comptes actuels restent ici. Choisis un mot de passe pour que personne d’autre ne les ouvre."
            : "Toi et ton père aurez chacun un espace, avec un mot de passe.")}</p>
        <form data-lock-form="create" style="margin-top:18px">
          <div class="form-grid">
            <div class="field full"><label>Prénom</label><input name="name" value="${esc(suggested)}" placeholder="Adrien" required /></div>
            <div class="field"><label>Mot de passe</label><input name="password" type="password" autocomplete="new-password" required minlength="4" /></div>
            <div class="field"><label>Encore une fois</label><input name="confirm" type="password" autocomplete="new-password" required minlength="4" /></div>
          </div>
          <p class="hint">Au moins 4 caractères. Un code simple suffit, tant que l’autre ne le connaît pas.</p>
          ${err}
          <div style="display:flex;gap:8px;margin-top:18px;flex-wrap:wrap">
            <button class="btn gold" type="submit">${people.length ? "Créer l’espace" : "Créer mon espace"}</button>
            ${people.length ? `<button class="btn ghost" type="button" data-lock-action="home">Retour</button>` : ""}
          </div>
        </form>`;
    } else {
      inner = `
        <p class="kicker">Aurea</p>
        <h2 class="hero-num" style="font-size:2rem">Qui est là ?</h2>
        <p class="hint">Chaque personne a ses comptes, cachés derrière un mot de passe.</p>
        ${Store.isCloud() ? `<p class="hint">Enregistré sur Neon — tes données ne restent plus seulement dans le navigateur.</p>` : `<p class="hint">Pour sauver sur Neon : double-clique <b>start.bat</b> puis ouvre http://127.0.0.1:3847</p>`}
        <div class="profile-list">
          ${people.map((p) => `
            <button type="button" data-lock-action="pick" data-id="${esc(p.id)}">
              <span class="avatar">${lockLetter(p.name)}</span>
              <span>${esc(p.name)}</span>
            </button>`).join("")}
        </div>
        ${err}
        <button class="btn ghost" type="button" data-lock-action="create">Ajouter une personne</button>`;
    }
    root.innerHTML = `<div class="onboard">${inner}</div>`;
    const first = root.querySelector("input");
    if (first) first.focus();
  }

  function personForm(fromSettings) {
    lock.screen = "create";
    lock.error = "";
    lock.profileId = "";
    if (fromSettings && Store.isUnlocked()) {
      openModal(`
        <div class="split"><p class="kicker">Ajouter une personne</p><button class="icon-btn" data-action="close-modal">✕</button></div>
        <p class="hint">Elle aura son propre espace, avec son mot de passe. Tu restes sur le tien.</p>
        <form data-form="add-person" style="margin-top:12px">
          <div class="form-grid">
            <div class="field full"><label>Prénom</label><input name="name" placeholder="Papa" required /></div>
            <div class="field"><label>Mot de passe</label><input name="password" type="password" autocomplete="new-password" required minlength="4" /></div>
            <div class="field"><label>Encore une fois</label><input name="confirm" type="password" autocomplete="new-password" required minlength="4" /></div>
          </div>
          <div style="margin-top:16px"><button class="btn gold" type="submit">Créer l’espace</button></div>
        </form>
      `);
      return;
    }
    render();
  }

  function passwordForm() {
    openModal(`
      <div class="split"><p class="kicker">Mot de passe</p><button class="icon-btn" data-action="close-modal">✕</button></div>
      <form data-form="change-password" style="margin-top:12px">
        <div class="form-grid">
          <div class="field full"><label>Mot de passe actuel</label><input name="current" type="password" autocomplete="current-password" required /></div>
          <div class="field"><label>Nouveau</label><input name="password" type="password" autocomplete="new-password" required minlength="4" /></div>
          <div class="field"><label>Encore une fois</label><input name="confirm" type="password" autocomplete="new-password" required minlength="4" /></div>
        </div>
        <div style="margin-top:16px"><button class="btn gold" type="submit">Changer</button></div>
      </form>
    `);
  }

  async function handleLockForm(form) {
    const type = form.dataset.lockForm;
    const obj = saveFromForm(form);
    lock.error = "";
    if (type === "login") {
      const ok = await Store.unlock(obj.profileId, obj.password);
      if (!ok) {
        lock.error = "Mot de passe incorrect.";
        lock.screen = "login";
        lock.profileId = obj.profileId;
        openLock();
        return;
      }
      lock.screen = "home";
      state.view = "dashboard";
      state.period = null;
      render();
      const me = Store.activeProfile();
      toast("Bonjour " + ((me && me.name) || ""));
      return;
    }
    if (type === "create") {
      if (obj.password !== obj.confirm) {
        lock.error = "Les deux mots de passe ne sont pas pareils.";
        lock.screen = "create";
        openLock();
        return;
      }
      const result = await Store.createProfile(obj.name, obj.password, { switchTo: true });
      if (!result.ok) {
        lock.error = result.error;
        lock.screen = "create";
        openLock();
        return;
      }
      lock.screen = "home";
      lock.error = "";
      state.view = "dashboard";
      state.period = null;
      render();
      toast("Espace créé. Verrouille en partant, pour que l’autre ne voie pas tes comptes.");
    }
  }

  /* ---------- Onboarding ---------- */

  const onboard = { step: 0, draft: { firstName: "", accountName: "Compte courant", balance: "", income: "", incomeDay: 1, incomeVariable: true, picks: [] } };

  function openOnboard() {
    const root = $("#onboard-root");
    root.hidden = false;
    const d = onboard.draft;
    const steps = [
      `<p class="kicker">Bienvenue</p>
       <h2 class="hero-num" style="font-size:2.2rem">Voyez clair, sans tableur.</h2>
       <p class="hint">Aurea tient vos comptes, forfaits et projections au même endroit. Trois chiffres suffisent : maintenant, après les charges, et ce qu’il vous reste par jour.</p>
       <div class="field" style="margin-top:18px"><label>Votre prénom</label><input id="ob-name" value="${esc(d.firstName)}" placeholder="Adrien" /></div>
       <div style="display:flex;gap:8px;margin-top:18px;flex-wrap:wrap">
         <button class="btn gold" data-ob="next">Continuer</button>
         <button class="btn ghost" data-action="load-demo">Voir un exemple</button>
       </div>`,
      `<p class="kicker">Étape 2 / 4</p>
       <h2 style="font-family:var(--serif);font-weight:500">Votre solde actuel</h2>
       <p class="hint">Le montant que vous voyez sur votre application bancaire, maintenant.</p>
       <div class="form-grid" style="margin-top:16px">
         <div class="field"><label>Nom du compte</label><input id="ob-acc" value="${esc(d.accountName)}" /></div>
         <div class="field"><label>Solde en euros</label><input id="ob-bal" inputmode="decimal" value="${esc(d.balance)}" placeholder="1240,50" /></div>
       </div>
       <div style="display:flex;gap:8px;margin-top:18px"><button class="btn" data-ob="back">Retour</button><button class="btn gold" data-ob="next">Continuer</button></div>`,
      `<p class="kicker">Étape 3 / 4</p>
       <h2 style="font-family:var(--serif);font-weight:500">Votre revenu</h2>
       <p class="hint">Pas besoin que ce soit toujours le même. Indiquez un ordre de grandeur, ou passez : vous saisirez le vrai montant chaque mois.</p>
       <div class="form-grid" style="margin-top:16px">
         <div class="field"><label>Montant habituel (approx.)</label><input id="ob-inc" inputmode="decimal" value="${esc(d.income)}" placeholder="ex. 1600" /></div>
         <div class="field"><label>Jour approximatif</label><input id="ob-incday" type="number" min="1" max="28" value="${esc(d.incomeDay)}" /></div>
         <label class="switch full"><input type="checkbox" id="ob-inc-var" ${d.incomeVariable !== false ? "checked" : ""}/> Le montant change chaque mois</label>
       </div>
       <div style="display:flex;gap:8px;margin-top:18px;flex-wrap:wrap">
         <button class="btn" data-ob="back">Retour</button>
         <button class="btn gold" data-ob="next">Continuer</button>
         <button class="btn ghost" data-ob="skip-income">Passer</button>
       </div>`,
      `<p class="kicker">Étape 4 / 4</p>
       <h2 style="font-family:var(--serif);font-weight:500">Vos charges fixes</h2>
       <p class="hint">Cochez, puis indiquez le montant. Aurea calculera tout seul le solde « une fois tout payé ».</p>
       <div class="list" id="ob-picks" style="margin-top:12px">
         ${Store.TEMPLATES.map((t, i) => {
           const pick = d.picks[i] || { on: false, amount: "" };
           return `<label class="row" style="grid-template-columns:auto 1fr 120px">
             <input type="checkbox" data-i="${i}" ${pick.on ? "checked" : ""} />
             <span><b>${esc(t.name)}</b><small>mensuel</small></span>
             <input data-amt="${i}" inputmode="decimal" placeholder="€" value="${esc(pick.amount)}" />
           </label>`;
         }).join("")}
       </div>
       <div style="display:flex;gap:8px;margin-top:18px"><button class="btn" data-ob="back">Retour</button><button class="btn gold" data-ob="finish">Terminer</button></div>`
    ];
    root.innerHTML = `<div class="onboard">${steps[onboard.step]}</div>`;
  }

  function readOnboardStep() {
    const d = onboard.draft;
    if (onboard.step === 0) d.firstName = ($("#ob-name") && $("#ob-name").value.trim()) || d.firstName;
    if (onboard.step === 1) {
      d.accountName = ($("#ob-acc") && $("#ob-acc").value.trim()) || d.accountName;
      d.balance = ($("#ob-bal") && $("#ob-bal").value) || d.balance;
    }
    if (onboard.step === 2) {
      d.income = ($("#ob-inc") && $("#ob-inc").value) || d.income;
      d.incomeDay = ($("#ob-incday") && $("#ob-incday").value) || d.incomeDay;
      if ($("#ob-inc-var")) d.incomeVariable = $("#ob-inc-var").checked;
    }
    if (onboard.step === 3) {
      d.picks = Store.TEMPLATES.map((t, i) => ({
        on: !!document.querySelector(`[data-i="${i}"]:checked`),
        amount: (document.querySelector(`[data-amt="${i}"]`) || {}).value || ""
      }));
    }
  }

  function finishOnboard() {
    readOnboardStep();
    const data = Store.blank();
    data.settings.firstName = onboard.draft.firstName || "";
    data.settings.setupDone = true;
    const acc = {
      id: Store.uid("acc"),
      name: onboard.draft.accountName || "Compte courant",
      type: "checking",
      balance: parseAmount(onboard.draft.balance),
      includeInTotal: true
    };
    data.accounts.push(acc);
    if (parseAmount(onboard.draft.income) > 0) {
      const day = Math.min(28, Math.max(1, Number(onboard.draft.incomeDay) || 1));
      const next = F.toISO(F.nextOccurrence({ frequency: "monthly", dayOfMonth: day, nextDate: state.today }, F.parseISO(state.today)));
      data.recurrings.push({
        id: Store.uid("rec"),
        name: "Revenu",
        amount: parseAmount(onboard.draft.income),
        kind: "income",
        frequency: "monthly",
        dayOfMonth: day,
        accountId: acc.id,
        categoryId: "cat-salaire",
        nextDate: next,
        startDate: next,
        active: true,
        variable: onboard.draft.incomeVariable !== false
      });
    }
    Store.TEMPLATES.forEach((t, i) => {
      const pick = onboard.draft.picks[i];
      if (!pick || !pick.on || !parseAmount(pick.amount)) return;
      const next = F.toISO(F.nextOccurrence({ frequency: "monthly", dayOfMonth: 5, nextDate: state.today }, F.parseISO(state.today)));
      data.recurrings.push({
        id: Store.uid("rec"),
        name: t.name,
        amount: parseAmount(pick.amount),
        kind: "expense",
        frequency: t.frequency,
        dayOfMonth: 5,
        accountId: acc.id,
        categoryId: t.categoryId,
        nextDate: next,
        startDate: next,
        active: true
      });
    });
    Store.replace(data);
    $("#onboard-root").hidden = true;
    state.view = "dashboard";
    render();
    toast("C’est prêt. Ajoutez un achat dès que vous voulez.");
  }

  function loadDemo() {
    const data = Store.blank();
    data.settings.setupDone = true;
    data.settings.firstName = "Alex";
    const courant = { id: "acc-c", name: "Compte courant", type: "checking", balance: 1842.37, includeInTotal: true };
    const livret = { id: "acc-l", name: "Livret A", type: "savings", balance: 3200, includeInTotal: true };
    data.accounts = [courant, livret];
    const today = F.parseISO(state.today);
    const p = F.periodOf(state.today, 1);
    const day = today.getDate();
    function recOn(name, amount, kind, categoryId, monthDay, accountId, overdue) {
      const d = new Date(today.getFullYear(), today.getMonth(), Math.min(monthDay, 28));
      let iso = F.toISO(d);
      if (!overdue && iso < state.today) iso = F.toISO(F.addMonths(d, 1));
      if (overdue && iso > state.today) iso = F.toISO(F.addDays(today, -2));
      return {
        id: Store.uid("rec"),
        name,
        amount,
        kind,
        frequency: "monthly",
        dayOfMonth: monthDay,
        accountId,
        categoryId,
        nextDate: iso,
        startDate: iso,
        active: true
      };
    }
    data.recurrings = [
      recOn("Salaire", 2100, "income", "cat-salaire", 1, courant.id, false),
      recOn("Loyer", 680, "expense", "cat-logement", 3, courant.id, true),
      recOn("Forfait mobile", 19.99, "expense", "cat-forfaits", Math.min(28, day + 2), courant.id, false),
      recOn("Internet", 32.99, "expense", "cat-forfaits", 12, courant.id, true),
      recOn("Netflix", 13.49, "expense", "cat-forfaits", Math.min(28, day + 4), courant.id, false),
      recOn("Électricité", 74, "expense", "cat-energie", Math.min(28, day + 1), courant.id, false),
      recOn("Assurance habitation", 18.5, "expense", "cat-assurances", 7, courant.id, false)
    ];
    const samples = [
      ["Carrefour", 54.2, "cat-courses", -2],
      ["Lidl", 23.9, "cat-courses", -6],
      ["Essence", 48, "cat-transport", -4],
      ["Restaurant", 31.5, "cat-sorties", -1],
      ["Pharmacie", 12.4, "cat-sante", -8],
      ["Salaire", 2100, "cat-salaire", -20, "income"]
    ];
    samples.forEach((s, i) => {
      const date = F.toISO(F.addDays(today, s[3]));
      if (date < p.startISO) return;
      const kind = s[4] || "expense";
      const tx = {
        id: Store.uid("tx"),
        createdAt: Date.now() - i,
        kind,
        amount: s[1],
        label: s[0],
        date,
        accountId: courant.id,
        categoryId: s[2],
        note: "",
        recurringId: s[0] === "Salaire" ? data.recurrings[0].id : ""
      };
      data.transactions.push(tx);
    });
    data.categories.find((c) => c.id === "cat-courses").budget = 280;
    data.categories.find((c) => c.id === "cat-sorties").budget = 120;
    data.categories.find((c) => c.id === "cat-forfaits").budget = 80;
    data.goals = [{ id: Store.uid("goal"), name: "Fonds d’urgence", target: 3000, current: 1250, deadline: F.toISO(F.addMonths(today, 8)) }];
    Store.replace(data);
    $("#onboard-root").hidden = true;
    state.view = "dashboard";
    render();
    toast("Exemple chargé — vous pourrez tout effacer dans Réglages.");
  }
  /* ---------- Events ---------- */

  function go(view) {
    if (!Store.isUnlocked()) return;
    state.view = view;
    $("#sidebar").classList.remove("open");
    closeModal();
    render();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  document.addEventListener("click", (e) => {
    const lockAct = e.target.closest("[data-lock-action]");
    if (lockAct) {
      const a = lockAct.dataset.lockAction;
      if (a === "home") {
        lock.screen = "home";
        lock.error = "";
        lock.profileId = "";
      }
      if (a === "create") {
        lock.screen = "create";
        lock.error = "";
      }
      if (a === "pick") {
        lock.screen = "login";
        lock.profileId = lockAct.dataset.id;
        lock.error = "";
      }
      openLock();
      return;
    }
    const viewBtn = e.target.closest("[data-view]");
    if (viewBtn && !viewBtn.closest("form")) {
      e.preventDefault();
      go(viewBtn.dataset.view);
      return;
    }
    const ob = e.target.closest("[data-ob]");
    if (ob) {
      readOnboardStep();
    if (ob.dataset.ob === "next") onboard.step = Math.min(3, onboard.step + 1);
    if (ob.dataset.ob === "back") onboard.step = Math.max(0, onboard.step - 1);
    if (ob.dataset.ob === "skip-income") {
      onboard.draft.income = "";
      onboard.step = 3;
    }
      if (ob.dataset.ob === "finish") return finishOnboard();
      openOnboard();
      return;
    }
    const act = e.target.closest("[data-action]");
    if (!act) return;
    const id = act.dataset.id;
    const data = db();
    switch (act.dataset.action) {
      case "toggle-nav":
        $("#sidebar").classList.toggle("open");
        break;
      case "period-prev":
        state.period = F.shiftPeriod(state.period, -1, data.settings.monthStartDay || 1);
        render();
        break;
      case "period-next":
        state.period = F.shiftPeriod(state.period, 1, data.settings.monthStartDay || 1);
        render();
        break;
      case "period-now":
        state.period = F.periodOf(state.today, data.settings.monthStartDay || 1);
        render();
        break;
      case "quick-add":
        if (!data.accounts.length) return accountForm();
        txForm();
        break;
      case "focus-account":
        data.settings.focusAccountId = id;
        state.txAcc = id;
        Store.save();
        render();
        break;
      case "close-modal":
        dismissModal();
        break;
      case "ack-news":
        ackNews();
        break;
      case "lock":
        Store.lock();
        lock.screen = "home";
        lock.error = "";
        lock.profileId = "";
        closeModal();
        render();
        break;
      case "add-person":
        personForm(true);
        break;
      case "change-password":
        passwordForm();
        break;
      case "new-account":
        accountForm();
        break;
      case "edit-account":
        accountForm(data.accounts.find((a) => a.id === id));
        break;
      case "delete-account":
        if (!confirm("Supprimer ce compte ? Les mouvements liés restent dans l’historique.")) break;
        data.accounts = data.accounts.filter((a) => a.id !== id);
        Store.save();
        closeModal();
        render();
        break;
      case "edit-tx":
        txForm(data.transactions.find((t) => t.id === id));
        break;
      case "pointer-tx":
        act.disabled = true;
        pointerTx(id);
        render();
        break;
      case "delete-tx":
        removeTx(id);
        closeModal();
        render();
        break;
      case "new-recurring":
        if (!data.accounts.length) return accountForm();
        recurringForm();
        break;
      case "new-debt":
        if (!data.accounts.length) return accountForm();
        recurringForm(null, "debt");
        break;
      case "quick-forfait":
        if (!data.accounts.length) return accountForm();
        recurringForm({
          name: act.dataset.name || "",
          categoryId: act.dataset.cat || "cat-forfaits",
          kind: "expense",
          mode: "forever",
          amount: "",
          frequency: "monthly",
          dayOfMonth: Math.min(28, new Date().getDate()),
          accountId: focusId() || (data.accounts[0] && data.accounts[0].id),
          nextDate: state.today,
          active: true,
          variable: false
        });
        break;
      case "edit-recurring":
        recurringForm(data.recurrings.find((r) => r.id === id));
        break;
      case "delete-recurring":
        data.recurrings = data.recurrings.filter((r) => r.id !== id);
        Store.save();
        closeModal();
        render();
        toast("Charge supprimée");
        break;
      case "pay-recurring":
        act.disabled = true;
        if (payRecurring(id) === "prompt") break;
        closeModal();
        render();
        break;
      case "pay-all-due": {
        const due = data.recurrings.filter((r) => r.active && r.nextDate && r.nextDate <= state.today);
        due.filter((r) => !isVariableRec(r)).forEach((r) => payRecurring(r.id, r.amount));
        const variableDue = due.filter((r) => isVariableRec(r));
        if (variableDue.length) {
          payRecurring(variableDue[0].id);
          break;
        }
        closeModal();
        render();
        break;
      }
      case "log-income":
        if (!data.accounts.length) { accountForm(); break; }
        txForm({
          kind: "income",
          amount: "",
          label: "Revenu du mois",
          date: state.today,
          accountId: focusId() || data.accounts[0].id,
          categoryId: "cat-salaire",
          note: "",
          toAccountId: ""
        });
        break;
      case "open-due":
        dueModal();
        break;
      case "new-goal":
        goalForm();
        break;
      case "edit-goal":
        goalForm(data.goals.find((g) => g.id === id));
        break;
      case "delete-goal":
        data.goals = data.goals.filter((g) => g.id !== id);
        Store.save();
        closeModal();
        render();
        break;
      case "edit-budgets":
        budgetsForm();
        break;
      case "export-json": {
        const blob = new Blob([Store.exportJson()], { type: "application/json" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = "aurea-" + ((Store.activeProfile() && Store.activeProfile().name) || "sauvegarde").replace(/\s+/g, "-") + ".json";
        a.click();
        break;
      }
      case "import-json":
        $("#import-file").click();
        break;
      case "import-csv":
        $("#import-csv").click();
        break;
      case "dismiss-recap":
        try { localStorage.setItem("aurea.recap.seen", id || ""); } catch (err) {}
        render();
        break;
      case "pick-quick-cat":
        quickCatModal();
        break;
      case "set-quick-cat": {
        const form = document.querySelector("[data-form='quick-expense']");
        if (form && form.categoryId) {
          form.categoryId.value = id;
          paintQuickCat(form, false);
        }
        closeModal();
        break;
      }
      case "csv-toggle": {
        e.preventDefault();
        const i = Number(act.dataset.i);
        if (csvDraft.rows[i]) csvDraft.rows[i].checked = !csvDraft.rows[i].checked;
        csvModal();
        break;
      }
      case "csv-all":
        csvDraft.rows.forEach((r) => { r.checked = !r.dup && !r.noise; });
        csvModal();
        break;
      case "csv-none":
        csvDraft.rows.forEach((r) => { r.checked = false; });
        csvModal();
        break;
      case "csv-out":
        csvDraft.rows.forEach((r) => { r.checked = r.kind === "expense" && !r.dup && !r.noise; });
        csvModal();
        break;
      case "csv-month":
        csvDraft.rows.forEach((r) => { r.checked = F.inPeriod(r.date, state.period) && !r.dup && !r.noise; });
        csvModal();
        break;
      case "csv-import":
        importCsvSelection();
        break;
      case "year-prev":
        state.year = (state.year || state.period.start.getFullYear()) - 1;
        render();
        break;
      case "year-next":
        state.year = (state.year || state.period.start.getFullYear()) + 1;
        render();
        break;
      case "load-demo":
        loadDemo();
        break;
      case "reset-data":
        if (!confirm("Effacer tes données seulement ? L’espace de l’autre personne reste.")) break;
        Store.reset();
        onboard.step = 0;
        render();
        break;
      case "open-search":
        go("transactions");
        setTimeout(() => { const i = $("#tx-q"); if (i) i.focus(); }, 50);
        break;
      default:
        break;
    }
  });

  document.addEventListener("input", (e) => {
    if (e.target.id === "tx-q") {
      state.txQ = e.target.value;
      const keep = e.target.selectionStart;
      render();
      const again = $("#tx-q");
      if (again) {
        again.focus();
        again.setSelectionRange(keep, keep);
      }
    }
    if (e.target.closest("[data-form='quick-expense']") && e.target.name === "label") {
      const form = e.target.closest("form");
      const suggested = F.suggestCategory(e.target.value, db());
      if (suggested) {
        const cat = db().categories.find((c) => c.id === suggested);
        if (cat && cat.kind === "expense") {
          form.categoryId.value = suggested;
          paintQuickCat(form, true);
        }
        return;
      }
      if (String(e.target.value || "").trim()) {
        form.categoryId.value = "cat-autre";
        paintQuickCat(form, true);
      }
    }
    if (e.target.closest("[data-form='tx']") && e.target.name === "label") {
      const suggested = F.suggestCategory(e.target.value, db());
      if (!suggested) return;
      const form = e.target.form;
      const kind = form.kind.value;
      const cat = db().categories.find((c) => c.id === suggested);
      if (!cat || cat.kind !== (kind === "income" ? "income" : "expense")) return;
      form.categoryId.value = suggested;
      $$("#cat-picks [data-cat]").forEach((b) => b.classList.toggle("is-on", b.dataset.cat === suggested));
    }
  });

  document.addEventListener("change", (e) => {
    if (e.target.id === "tx-kind") { state.txKind = e.target.value; render(); }
    if (e.target.id === "tx-cat") { state.txCat = e.target.value; render(); }
    if (e.target.id === "tx-acc") { state.txAcc = e.target.value; render(); }
    if (e.target.dataset.toggleRec) {
      const rec = db().recurrings.find((r) => r.id === e.target.dataset.toggleRec);
      if (rec) {
        rec.active = e.target.checked;
        Store.save();
        render();
      }
    }
    if (e.target.id === "import-file" && e.target.files[0]) {
      const file = e.target.files[0];
      file.text().then((text) => {
        Store.importJson(text);
        render();
        toast("Import terminé");
      }).catch(() => toast("Fichier illisible"));
      e.target.value = "";
    }
    if (e.target.id === "import-csv" && e.target.files[0]) {
      const file = e.target.files[0];
      file.arrayBuffer().then((buf) => {
        const utf8 = new TextDecoder("utf-8").decode(buf);
        const win = new TextDecoder("windows-1252").decode(buf);
        const score = (s) => (s.match(/[éèêàùçôîÉÈÀ]/g) || []).length - (s.match(/\uFFFD/g) || []).length;
        const text = score(win) > score(utf8) ? win : utf8;
        const parsed = F.parseBankCsv(text);
        if (parsed.error) {
          toast(parsed.error);
          return;
        }
        csvDraft.rows = markCsvDuplicates(parsed.rows);
        csvModal();
      }).catch(() => toast("Fichier illisible"));
      e.target.value = "";
    }
  });

  document.addEventListener("submit", (e) => {
    const lockForm = e.target.closest("[data-lock-form]");
    if (lockForm) {
      e.preventDefault();
      handleLockForm(lockForm);
      return;
    }
    const form = e.target.closest("[data-form]");
    if (!form) return;
    e.preventDefault();
    const type = form.dataset.form;
    const data = db();
    const obj = saveFromForm(form);
    if (type === "quick-balance") {
      const acc = F.focusAccount(data);
      if (acc) acc.balance = parseAmount(obj.balance);
      Store.save();
      toast("Solde mis à jour");
      render();
    }
    if (type === "quick-expense") {
      const acc = F.focusAccount(data);
      if (!acc) {
        toast("Ajoute un compte d’abord");
        return;
      }
      const amount = parseAmount(obj.amount);
      if (!amount) {
        toast("Indique un montant");
        return;
      }
      const addMoney = isPlusAmount(obj.amount);
      const cat = data.categories.find((c) => c.id === obj.categoryId);
      const guessed = F.suggestCategory(obj.label, data);
      const guessedCat = guessed && data.categories.find((c) => c.id === guessed);
      const categoryId = addMoney
        ? (guessedCat && guessedCat.kind === "income" ? guessed : "cat-autre-in")
        : (guessed || obj.categoryId || "cat-autre");
      addTx({
        kind: addMoney ? "income" : "expense",
        amount,
        label: (obj.label || "").trim() || (addMoney ? "Argent reçu" : (cat && cat.name) || "Dépense"),
        date: state.today,
        accountId: acc.id,
        categoryId,
        waitPointer: true
      });
      toast(addMoney
        ? "Noté en plus — clique dessus pour pointer quand c’est arrivé à la banque"
        : "Noté — clique dessus pour pointer quand c’est passé à la banque");
      render();
    }
    if (type === "quick-salary") {
      const acc = F.focusAccount(data);
      if (!acc) {
        toast("Ajoute un compte d’abord");
        return;
      }
      const amount = parseAmount(obj.amount);
      if (!amount) {
        toast("Indique le montant du salaire");
        return;
      }
      const rec = data.recurrings.find((r) => r.active && r.kind === "income" && (!focusId() || r.accountId === focusId()));
      addTx({
        kind: "income",
        amount,
        label: (rec && rec.name) || "Salaire",
        date: state.today,
        accountId: acc.id,
        categoryId: (rec && rec.categoryId) || "cat-salaire",
        recurringId: rec ? rec.id : ""
      });
      if (rec) rec.amount = amount;
      toast("Salaire noté");
      render();
    }
    if (type === "quick-remb") {
      const acc = F.focusAccount(data);
      if (!acc) {
        toast("Ajoute un compte d’abord");
        return;
      }
      const amount = parseAmount(obj.amount);
      if (!amount) {
        toast("Indique le montant remboursé");
        return;
      }
      addTx({
        kind: "income",
        amount,
        label: (obj.label || "").trim() || "Remboursement",
        date: state.today,
        accountId: acc.id,
        categoryId: "cat-remb",
        waitPointer: true
      });
      toast("Remboursement noté — clique dessus pour pointer quand c’est arrivé à la banque");
      render();
    }
    if (type === "tx") {
      if (form.dataset.id) {
        const old = data.transactions.find((t) => t.id === form.dataset.id);
        if (old && old.applied !== false && !old.skipBalance) F.applyToBalance(data, old, -1);
        const dest = obj.kind === "expense" ? F.accountFromLabel(data, obj.label, obj.accountId) : null;
        Object.assign(old, {
          kind: obj.kind,
          amount: parseAmount(obj.amount),
          label: obj.label.trim(),
          date: obj.date,
          accountId: obj.accountId,
          toAccountId: dest ? dest.id : (obj.toAccountId || ""),
          categoryId: obj.categoryId,
          note: obj.note || ""
        });
        old.applied = old.date <= state.today;
        if (old.applied && !old.skipBalance) F.applyToBalance(data, old, 1);
        F.rememberCategory(data, old.label, old.categoryId);
      } else {
        addTx(obj, true);
      }
      Store.save();
      closeModal();
      render();
      toast("Enregistré");
    }
    if (type === "account") {
      const bal = parseAmount(obj.balance);
      if (form.dataset.id) {
        const acc = data.accounts.find((a) => a.id === form.dataset.id);
        acc.name = obj.name.trim();
        acc.type = obj.type;
        acc.includeInTotal = !!obj.includeInTotal;
        acc.balance = bal;
      } else {
        data.accounts.push({
          id: Store.uid("acc"),
          name: obj.name.trim(),
          type: obj.type,
          balance: bal,
          includeInTotal: obj.includeInTotal !== false
        });
      }
      Store.save();
      closeModal();
      render();
    }
    if (type === "recurring") {
      const recObj = {
        name: obj.name.trim(),
        amount: parseAmount(obj.amount),
        kind: obj.kind === "income" ? "income" : "expense",
        mode: obj.mode === "debt" ? "debt" : "forever",
        frequency: obj.mode === "debt" ? "monthly" : (obj.frequency || "monthly"),
        dayOfMonth: Number(obj.dayOfMonth) || 1,
        accountId: obj.accountId,
        categoryId: obj.categoryId || (obj.mode === "debt" ? "cat-dettes" : "cat-forfaits"),
        nextDate: (() => {
          const day = Math.min(31, Math.max(1, Number(obj.dayOfMonth) || 1));
          const t = F.parseISO(state.today);
          let d = new Date(t.getFullYear(), t.getMonth(), Math.min(day, new Date(t.getFullYear(), t.getMonth() + 1, 0).getDate()));
          if (F.toISO(d) < state.today) d = F.addMonths(d, 1);
          return F.toISO(d);
        })(),
        active: obj.active !== false,
        variable: obj.kind === "income" ? obj.variable !== false : !!obj.variable,
        remainingInstallments: obj.mode === "debt" ? Math.max(1, Number(obj.remainingInstallments) || 1) : undefined,
        installments: obj.mode === "debt" ? Math.max(1, Number(obj.remainingInstallments) || Number(obj.installments) || 1) : undefined,
        remainingAmount: obj.mode === "debt" ? parseAmount(obj.amount) * Math.max(1, Number(obj.remainingInstallments) || 1) : undefined
      };
      recObj.startDate = recObj.nextDate;
      if (recObj.kind !== "income") {
        const dest = F.accountFromLabel(data, recObj.name, recObj.accountId);
        recObj.toAccountId = dest ? dest.id : "";
      }
      if (form.dataset.id) {
        const prev = data.recurrings.find((r) => r.id === form.dataset.id);
        recObj.lastSettledKey = prev && prev.lastSettledKey;
        Object.assign(prev, recObj);
      } else {
        if (recObj.mode === "debt" && recObj.dayOfMonth <= F.parseISO(state.today).getDate()) recObj.lastSettledKey = state.today.slice(0, 7);
        data.recurrings.push({ id: Store.uid("rec"), ...recObj });
      }
      Store.save();
      closeModal();
      render();
      toast("Enregistré");
    }
    if (type === "pay-recurring") {
      payRecurring(form.dataset.id, obj.amount);
      closeModal();
      render();
    }
    if (type === "goal") {
      const g = {
        name: obj.name.trim(),
        target: parseAmount(obj.target),
        current: parseAmount(obj.current),
        deadline: obj.deadline || ""
      };
      if (form.dataset.id) Object.assign(data.goals.find((x) => x.id === form.dataset.id), g);
      else data.goals.push({ id: Store.uid("goal"), ...g });
      Store.save();
      closeModal();
      render();
    }
    if (type === "budgets") {
      data.categories.forEach((c) => {
        if (obj[c.id] != null) c.budget = parseAmount(obj[c.id]);
      });
      Store.save();
      closeModal();
      render();
    }
    if (type === "settings") {
      data.settings.firstName = obj.firstName.trim();
      data.settings.theme = obj.theme;
      data.settings.monthStartDay = Math.min(28, Math.max(1, Number(obj.monthStartDay) || 1));
      data.settings.safetyBuffer = parseAmount(obj.safetyBuffer);
      Store.renameActive(data.settings.firstName);
      Store.save();
      state.period = F.periodOf(state.today, data.settings.monthStartDay);
      render();
      toast("Réglages enregistrés");
    }
    if (type === "add-person") {
      if (obj.password !== obj.confirm) {
        toast("Les deux mots de passe ne sont pas pareils.");
        return;
      }
      Store.createProfile(obj.name, obj.password, { switchTo: false }).then((result) => {
        if (!result.ok) {
          toast(result.error);
          return;
        }
        closeModal();
        render();
        toast("Espace " + result.profile.name + " créé. Il s’ouvre avec Verrouiller.");
      });
    }
    if (type === "change-password") {
      if (obj.password !== obj.confirm) {
        toast("Les deux mots de passe ne sont pas pareils.");
        return;
      }
      Store.changePassword(obj.current, obj.password).then((result) => {
        if (!result.ok) {
          toast(result.error);
          return;
        }
        closeModal();
        toast("Mot de passe changé");
      });
    }
  });

  document.addEventListener("click", (e) => {
    const cat = e.target.closest("[data-cat]");
    if (cat) {
      const form = cat.closest("form");
      form.categoryId.value = cat.dataset.cat;
      $$(".cat-picks [data-cat]", form).forEach((b) => b.classList.toggle("is-on", b === cat));
    }
    const kind = e.target.closest("#kind-tabs [data-kind]");
    if (kind) {
      const form = kind.closest("form") || $("#modal-root form");
      form.kind.value = kind.dataset.kind;
      $$("#kind-tabs [data-kind]").forEach((b) => b.classList.toggle("is-on", b === kind));
      $("#to-acc").style.display = kind.dataset.kind === "transfer" ? "" : "none";
      $("#cat-wrap").style.display = kind.dataset.kind === "transfer" ? "none" : "";
      const wrap = $("#cat-wrap");
      if (wrap && kind.dataset.kind !== "transfer") {
        wrap.innerHTML = `<label>Catégorie</label>` + catButtons(kind.dataset.kind === "income" ? "income" : "expense", form.categoryId.value);
      }
    }
    const rkind = e.target.closest("#r-kind [data-rkind]");
    if (rkind) {
      const form = rkind.closest("form");
      const type = rkind.dataset.rkind;
      form.kind.value = type === "income" ? "income" : "expense";
      if (form.mode) form.mode.value = type === "debt" ? "debt" : "forever";
      $$("#r-kind [data-rkind]").forEach((b) => b.classList.toggle("is-on", b === rkind));
      const debtFields = form.querySelector("#debt-fields");
      const freqWrap = form.querySelector("#freq-wrap");
      const debtHint = form.querySelector("#debt-hint");
      const varWrap = form.querySelector("#var-wrap");
      if (debtFields) debtFields.style.display = type === "debt" ? "" : "none";
      if (freqWrap) freqWrap.style.display = type === "debt" ? "none" : "";
      if (debtHint) debtHint.style.display = type === "debt" ? "" : "none";
      if (varWrap) varWrap.style.display = type === "income" ? "" : "none";
      if (type === "debt") form.categoryId.value = "cat-dettes";
      if (type === "expense") form.categoryId.value = form.categoryId.value === "cat-dettes" ? "cat-forfaits" : form.categoryId.value;
      const wrap = form.querySelector(".cat-picks") && form.querySelector(".cat-picks").parentElement;
      if (wrap) wrap.innerHTML = `<label>Catégorie</label>` + catButtons(type === "income" ? "income" : "expense", form.categoryId.value);
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (!Store.isUnlocked()) {
        if (lock.screen !== "home" && Store.profiles().length) {
          lock.screen = "home";
          lock.error = "";
          openLock();
        }
        return;
      }
      dismissModal();
      $("#sidebar").classList.remove("open");
    }
    if (!Store.isUnlocked()) return;
    const tag = (e.target.tagName || "").toLowerCase();
    if (tag === "input" || tag === "textarea" || tag === "select") return;
    if (e.key === "n" || e.key === "N") {
      e.preventDefault();
      if (db().accounts.length) txForm();
    }
  });

  setInterval(() => {
    if (F.todayISO() === state.today) return;
    if (!Store.isUnlocked()) {
      state.today = F.todayISO();
      return;
    }
    render();
  }, 60 * 1000);

  return { render, go };
})();

Store.boot().then(() => App.render()).catch(() => App.render());
