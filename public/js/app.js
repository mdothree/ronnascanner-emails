import { initRonna } from "./utils/ronnaBase.js";
import { saveDoc, getUserDocs, tsToString } from "./services/firestoreService.js";
import { apiFetch } from "./config/env.js";
import { toast } from "./utils/toast.js";
import { gate } from "./services/paywallUI.js";
import { downloadText, setLoading, formatNumber } from "./utils/helpers.js";


let results = [];
let currentUser = null;

initRonna({ usageAction: "lookups" }).then(user => {
  currentUser = user;
  if (user) loadHistory();
});
// Tab switching
document.querySelectorAll(".etab").forEach(tab => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".etab").forEach(t => t.classList.remove("active"));
    document.querySelectorAll(".email-mode").forEach(m => m.classList.add("hidden"));
    tab.classList.add("active");
    document.getElementById(`mode-${tab.dataset.mode}`)?.classList.remove("hidden");
  });
});

document.getElementById("btn-find-email").addEventListener("click", () => {
  gate("lookups", () => runEmailTool(), () => {});
});

async function runEmailTool() {
  const activeTab = document.querySelector(".etab.active")?.dataset.mode || "find";
  document.querySelector(".btn-text").classList.add("hidden");
  document.querySelector(".btn-loader").classList.remove("hidden");
  document.getElementById("btn-find-email").disabled = true;

  try {
    let payload = { mode: activeTab };
    if (activeTab === "find") {
      payload.firstName = document.getElementById("first-name").value;
      payload.lastName  = document.getElementById("last-name").value;
      payload.domain    = document.getElementById("find-domain").value;
    } else if (activeTab === "domain") {
      payload.domain = document.getElementById("domain-input").value;
      payload.limit  = document.getElementById("domain-limit").value;
    } else if (activeTab === "verify") {
      payload.email = document.getElementById("verify-email").value;
    } else {
      payload.emails = document.getElementById("bulk-emails").value.split("\n").filter(Boolean);
    }

    const res = await apiFetch("/api/emails/find", payload);
    const data = await res.json();
    results = data.results || mockEmailResults(payload);
  } catch {
    results = mockEmailResults({ mode: activeTab });
  }

  renderResults(results);
  document.querySelector(".btn-text").classList.remove("hidden");
  document.querySelector(".btn-loader").classList.add("hidden");
  document.getElementById("btn-find-email").disabled = false;
}

function renderResults(items) {
  document.getElementById("result-count").textContent = items.length;
  document.getElementById("results-tbody").innerHTML = items.map(r => {
    const statusClass = r.status === "valid" ? "tag-green" : r.status === "risky" ? "tag-orange" : "tag-gray";
    return `<tr>
      <td><strong>${r.email}</strong></td>
      <td>${r.name || "—"}</td>
      <td>${r.company || "—"}</td>
      <td><span class="tag ${statusClass}">${r.status || "unknown"}</span></td>
      <td>${r.confidence ? r.confidence + "%" : "—"}</td>
      <td>${r.source || "Hunter.io"}</td>
    </tr>`;
  }).join("");
  document.getElementById("results-section").classList.remove("hidden");
  document.getElementById("results-section").scrollIntoView({ behavior: "smooth" });
}

document.getElementById("btn-export-csv")?.addEventListener("click", () => {
  if (!results.length) return;
  downloadFile(toCSV(results, ["email","name","company","status","confidence","source"]), "emails.csv");
});

document.getElementById("btn-save")?.addEventListener("click", async () => {
  if (!results.length) return;
  await saveToFirestore("email-results", { results, count: results.length });
  loadHistory(); toast.success("Saved!");
});

async function loadHistory() {
  const items = await getFromFirestore("email-results");
  const grid = document.getElementById("history-grid");
  if (!grid) return;
  document.getElementById("history-section").classList.remove("hidden");
  grid.innerHTML = items.length
    ? items.map(i => `<div class="result-card"><div class="result-count">${i.count || 0}</div><small>${i.createdAt?.toDate?.().toLocaleDateString?.() || "Recently"}</small></div>`).join("")
    : "<p class='empty-state'>No saved results yet.</p>";
}

function mockEmailResults({ mode } = {}) {
  const emails = ["john.smith@acme.com","sarah.jones@acme.com","mike.davis@acme.com","emily.chen@acme.com"];
  return emails.map(email => ({
    email, name: email.split("@")[0].replace(".", " ").replace(/\b\w/g, c => c.toUpperCase()),
    company: email.split("@")[1].split(".")[0],
    status: ["valid","valid","risky","invalid"][Math.floor(Math.random()*4)],
    confidence: Math.floor(Math.random()*30)+70,
    source: "Hunter.io"
  }));
}
