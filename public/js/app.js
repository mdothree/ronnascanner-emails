import { initRonna } from "./utils/ronnaBase.js";
import { authService } from "./services/authService.js";
import { saveDoc, getUserDocs, tsToString } from "./services/firestoreService.js";
import { apiFetch } from "./config/env.js";
import { toast } from "./utils/toast.js";
import { gate } from "./services/paywallUI.js";
import { downloadText, setLoading, formatNumber, escapeHtml, safeUrl } from "./utils/helpers.js";


let results = [];
let currentUser = null;

initRonna({ usageAction: "lookups" }).then(user => {
  currentUser = user;
  if (user) loadHistory();
});
// Tab switching (markup: .tool-tab[data-tool] → #tool-<name>.tool-view)
document.querySelectorAll(".tool-tab").forEach(tab => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tool-tab").forEach(t => t.classList.remove("active"));
    document.querySelectorAll(".tool-view").forEach(m => { m.classList.add("hidden"); m.classList.remove("active"); });
    tab.classList.add("active");
    const view = document.getElementById(`tool-${tab.dataset.tool}`);
    view?.classList.remove("hidden");
    view?.classList.add("active");
  });
});

["btn-find-email", "btn-verify", "btn-bulk"].forEach(id => {
  document.getElementById(id)?.addEventListener("click", () => {
    gate("lookups", () => runEmailTool(), () => {});
  });
});

async function runEmailTool() {
  const activeTab = document.querySelector(".tool-tab.active")?.dataset.tool || "find";
  const btn = document.getElementById({ find: "btn-find-email", verify: "btn-verify", bulk: "btn-bulk" }[activeTab] || "btn-find-email");
  btn.querySelector(".btn-text")?.classList.add("hidden");
  btn.querySelector(".btn-loader")?.classList.remove("hidden");
  btn.disabled = true;

  try {
    let payload = { mode: activeTab };
    if (activeTab === "find") {
      payload.firstName = document.getElementById("find-first").value;
      payload.lastName  = document.getElementById("find-last").value;
      payload.domain    = document.getElementById("find-domain").value;
    } else if (activeTab === "verify") {
      payload.email = document.getElementById("verify-input").value;
    } else {
      payload.emails = document.getElementById("bulk-input").value.split("\n").filter(Boolean);
    }

    const data = await apiFetch("/api/emails/find", payload);
    results = data?.results || null;
  } catch {
    results = null;
  }

  if (results) renderResults(results); else showUnavailable();
  btn.querySelector(".btn-text")?.classList.remove("hidden");
  btn.querySelector(".btn-loader")?.classList.add("hidden");
  btn.disabled = false;
}

function renderResults(items) {
  document.getElementById("emails-tbody").innerHTML = items.map(r => {
    const statusClass = r.status === "valid" ? "tag-green" : r.status === "risky" ? "tag-orange" : "tag-gray";
    return `<tr>
      <td><strong>${escapeHtml(r.email)}</strong>${r.name ? `<br /><small>${escapeHtml(r.name)}${r.company ? " · " + escapeHtml(r.company) : ""}</small>` : ""}</td>
      <td><span class="tag ${statusClass}">${escapeHtml(r.status || "unknown")}</span></td>
      <td>${r.confidence ? escapeHtml(r.confidence) + "%" : "—"}</td>
      <td>${escapeHtml(r.source || "—")}</td>
      <td>${r.email ? `<a href="${escapeHtml(safeUrl("mailto:" + r.email))}">Email</a>` : "—"}</td>
    </tr>`;
  }).join("");
  document.getElementById("results-panel").classList.remove("hidden");
  document.getElementById("results-panel").scrollIntoView({ behavior: "smooth" });
}

document.getElementById("btn-export-csv")?.addEventListener("click", () => {
  if (!results.length) return;
  downloadFile(toCSV(results, ["email","name","company","status","confidence","source"]), "emails.csv");
});

document.getElementById("btn-save")?.addEventListener("click", async () => {
  if (!results.length) return;
  if (!(await saveToFirestore("email-results", { results, count: results.length }))) return;
  loadHistory(); toast.success("Saved!");
});

async function loadHistory() {
  const grid = document.getElementById("history-grid");
  if (!grid) return; // no history UI on this page
  const items = await getFromFirestore("email-results");
  document.getElementById("history-section").classList.remove("hidden");
  grid.innerHTML = items.length
    ? items.map(i => `<div class="result-card"><div class="result-count">${escapeHtml(i.count || 0)}</div><small>${escapeHtml(i.createdAt?.toDate?.().toLocaleDateString?.() || "Recently")}</small></div>`).join("")
    : "<p class='empty-state'>No saved results yet.</p>";
}

// RONNA-MOCK-FALLBACK: never fabricate results when the scanner API is unavailable.
function showUnavailable() {
  // Keep the results table in the DOM so a later successful lookup can render into it.
  results = [];
  document.getElementById("results-panel")?.classList.remove("hidden");
  const tbody = document.getElementById("emails-tbody");
  if (tbody) tbody.innerHTML = '<tr><td colspan="5"><div class="empty-state" role="status"><p><strong>The scanner service is unavailable right now.</strong></p><p>No results were generated. Please try again later.</p></div></td></tr>';
  toast.error("Scanner service unavailable. No results were generated.");
}

// RONNA-LOADLIST-AWAIT-BUG (same class on this sub): saveToFirestore / getFromFirestore
// (and downloadFile / toCSV where used) were called but never defined → ReferenceError on
// Save / history load. Defined here on top of the shared Firestore service.
async function saveToFirestore(collectionName, data) {
  const user = authService.currentUser();
  if (!user) { document.getElementById("auth-modal")?.classList.remove("hidden"); return false; }
  try {
    await saveDoc(collectionName, user.uid, data);
    return true;
  } catch (e) {
    toast.error("Could not save. Please try again.");
    return false;
  }
}

async function getFromFirestore(collectionName) {
  const user = authService.currentUser();
  if (!user) return [];
  try {
    return await getUserDocs(collectionName, user.uid);
  } catch (e) {
    console.warn("[ronna] could not load history", e);
    return [];
  }
}

function toCSV(rows, cols) {
  const esc = v => `"${(v ?? "").toString().replace(/"/g, '""')}"`;
  return [cols.join(","), ...rows.map(r => cols.map(c => esc(r[c])).join(","))].join("\n");
}

function downloadFile(text, filename) {
  downloadText(text, filename, "text/csv");
}
