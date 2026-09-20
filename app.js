const storageKey = "wxyy-2-thin-section-index";
const LEGACY_BATCH_ID = "legacy";

const form = document.querySelector("#sampleForm");
const photoInput = document.querySelector("#photoInput");
const sampleGrid = document.querySelector("#sampleGrid");
const comparePane = document.querySelector("#comparePane");
const compareContext = document.querySelector("#compareContext");
const mineralFilter = document.querySelector("#mineralFilter");
const polarFilter = document.querySelector("#polarFilter");
const batchFilter = document.querySelector("#batchFilter");
const batchList = document.querySelector("#batchList");
const newBatchBtn = document.querySelector("#newBatchBtn");
const archiveBatchBtn = document.querySelector("#archiveBatchBtn");
const activeBatchLabel = document.querySelector("#activeBatchLabel");
const formBatchName = document.querySelector("#formBatchName");
const archiveIssues = document.querySelector("#archiveIssues");

let pendingPhoto = "";
let lastIssues = [];

function createLegacyBatch(compare = []) {
  return {
    id: LEGACY_BATCH_ID,
    rootId: LEGACY_BATCH_ID,
    name: "历史未归档",
    rootName: "历史未归档",
    status: "legacy",
    revision: 0,
    createdAt: new Date().toISOString(),
    archivedAt: null,
    compare
  };
}

function migrate() {
  const fallback = () => ({
    version: 2,
    samples: [],
    batches: [createLegacyBatch()],
    activeBatchId: LEGACY_BATCH_ID,
    viewBatchId: "all",
    batchSeq: 0
  });
  let data;
  try {
    data = JSON.parse(localStorage.getItem(storageKey) || "null");
  } catch (error) {
    data = null;
  }
  if (!data) return fallback();
  if (data.version === 2) {
    if (!Array.isArray(data.batches) || !data.batches.some((batch) => batch.id === LEGACY_BATCH_ID)) {
      data.batches = [createLegacyBatch(), ...(data.batches || [])];
    }
    if (!Array.isArray(data.samples)) data.samples = [];
    if (!data.activeBatchId) data.activeBatchId = LEGACY_BATCH_ID;
    if (!data.viewBatchId) data.viewBatchId = "all";
    if (typeof data.batchSeq !== "number") data.batchSeq = 0;
    return data;
  }
  // v1 → v2：既有样本与对比选择整体迁入“历史未归档”，不丢任何数据
  return {
    version: 2,
    samples: (data.samples || []).map((sample) => ({ ...sample, batchId: LEGACY_BATCH_ID })),
    batches: [createLegacyBatch(Array.isArray(data.compare) ? data.compare : [])],
    activeBatchId: LEGACY_BATCH_ID,
    viewBatchId: "all",
    batchSeq: 0
  };
}

const state = migrate();

function save() {
  localStorage.setItem(storageKey, JSON.stringify(state));
}

function batchById(id) {
  return state.batches.find((batch) => batch.id === id);
}

function samplesOf(batchId) {
  return state.samples.filter((sample) => sample.batchId === batchId);
}

function batchStatusLabel(batch) {
  if (batch.status === "archived") return "已归档";
  if (batch.status === "legacy") return "历史未归档";
  return "草稿";
}

function formatTime(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleString("zh-CN", { hour12: false });
}

function readFileAsDataUrl(file) {
  return new Promise((resolve) => {
    if (!file) return resolve("");
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(reader.result));
    reader.readAsDataURL(file);
  });
}

// 归档前核对：编号不得重复，照片、矿物、结构必须填写完整
function validateBatch(batch) {
  const samples = samplesOf(batch.id);
  const counts = new Map();
  samples.forEach((sample) => {
    const code = sample.code.trim();
    counts.set(code, (counts.get(code) || 0) + 1);
  });
  const issues = [];
  samples.forEach((sample) => {
    const code = sample.code.trim();
    const reasons = [];
    if (!code) reasons.push("缺少样本编号");
    if (!sample.photo) reasons.push("缺少显微照片");
    if (!sample.minerals) reasons.push("缺少主要矿物");
    if (!sample.texture) reasons.push("缺少颗粒结构");
    if (code && counts.get(code) > 1) reasons.push("编号重复");
    if (reasons.length) issues.push({ code: code || "（未填写编号）", reasons });
  });
  return issues;
}

function filteredSamples() {
  const mineral = mineralFilter.value.trim();
  const polarization = polarFilter.value;
  const batchId = state.viewBatchId;
  return state.samples.filter((sample) => {
    const batchMatch = batchId === "all" || sample.batchId === batchId;
    const mineralMatch = !mineral || (sample.minerals || "").includes(mineral);
    const polarMatch = !polarization || sample.polarization === polarization;
    return batchMatch && mineralMatch && polarMatch;
  });
}

function renderBatchFilter() {
  const options = ['<option value="all">全部批次</option>'].concat(
    state.batches.map((batch) => `<option value="${batch.id}">${batch.name}（${batchStatusLabel(batch)}）</option>`)
  );
  batchFilter.innerHTML = options.join("");
  batchFilter.value = batchById(state.viewBatchId) ? state.viewBatchId : "all";
  state.viewBatchId = batchFilter.value;
}

function renderBatchDesk() {
  const active = batchById(state.activeBatchId) || batchById(LEGACY_BATCH_ID);
  activeBatchLabel.textContent = `${active.name}（${batchStatusLabel(active)}）`;
  formBatchName.textContent = active.name;
  archiveBatchBtn.disabled = active.status !== "draft";
  archiveBatchBtn.title = active.status === "draft" ? "" : "只有草稿批次可以归档";

  batchList.innerHTML = state.batches.map((batch) => {
    const count = samplesOf(batch.id).length;
    const locked = batch.status === "archived";
    const isActive = batch.id === active.id;
    const times = [`创建于 ${formatTime(batch.createdAt)}`];
    if (batch.archivedAt) times.push(`归档于 ${formatTime(batch.archivedAt)}`);
    return `
      <li class="batch-item ${isActive ? "is-active" : ""} ${locked ? "is-locked" : ""}">
        <div class="batch-meta">
          <strong>${batch.name}</strong><span class="chip chip-${batch.status}">${batchStatusLabel(batch)}</span>
          <p>${count} 个样本 · ${times.join(" · ")}</p>
        </div>
        <div class="batch-actions">
          <button type="button" data-view="${batch.id}">查看</button>
          ${!locked && !isActive ? `<button type="button" data-activate="${batch.id}">设为当前</button>` : ""}
          ${locked ? `<button type="button" data-revise="${batch.id}">创建修订批次</button>` : ""}
        </div>
      </li>`;
  }).join("");
}

function renderIssues() {
  if (!lastIssues.length) {
    archiveIssues.hidden = true;
    archiveIssues.innerHTML = "";
    return;
  }
  archiveIssues.hidden = false;
  archiveIssues.innerHTML = `
    <strong>归档未通过，批次仍为草稿，请修正以下样本：</strong>
    <ul>${lastIssues.map((issue) => `<li><b>${issue.code}</b>：${issue.reasons.join("、")}</li>`).join("")}</ul>`;
}

function renderGrid() {
  const rows = filteredSamples();
  const emptyText = state.samples.length
    ? "当前筛选条件下没有样本。"
    : "还没有样本，先从左侧录入一张薄片照片。";
  sampleGrid.innerHTML = rows.length ? rows.map((sample) => {
    const batch = batchById(sample.batchId) || batchById(LEGACY_BATCH_ID);
    const locked = batch.status === "archived";
    const checked = batch.compare.includes(sample.id);
    return `
    <article class="sample-card ${locked ? "is-locked" : ""}">
      ${sample.photo ? `<img src="${sample.photo}" alt="${sample.code}显微照片">` : "<div class=\"photo-placeholder\"></div>"}
      <div class="sample-body">
        <h3>${sample.code}</h3>
        <p class="batch-tag">${locked ? "🔒 " : ""}${batch.name} · ${batchStatusLabel(batch)}</p>
        <p>${sample.location || "未记录地点"} · ${sample.magnification || "未记录倍数"} · ${sample.polarization}</p>
        <p>矿物：${sample.minerals || "未记录"}</p>
        <p>结构：${sample.texture || "未记录"}</p>
        <p>${sample.comment || "未填写批注"}</p>
        <div class="card-actions">
          <label><input type="checkbox" data-compare="${sample.id}" ${checked ? "checked" : ""} ${locked ? "disabled" : ""}>对比</label>
          ${locked ? "<span class=\"locked-note\">已归档锁定</span>" : `<button type="button" data-delete="${sample.id}">删除</button>`}
        </div>
      </div>
    </article>`;
  }).join("") : `<p>${emptyText}</p>`;
}

function renderCompare() {
  const viewing = state.viewBatchId !== "all" ? batchById(state.viewBatchId) : null;
  const batch = viewing || batchById(state.activeBatchId) || batchById(LEGACY_BATCH_ID);
  const locked = batch.status === "archived";
  compareContext.textContent = locked
    ? `${batch.name} · 已归档，对比选择已锁定（只读）`
    : `${batch.name} · 可勾选两张样本并排对比`;
  const compareSamples = batch.compare
    .map((id) => state.samples.find((sample) => sample.id === id))
    .filter(Boolean)
    .slice(0, 2);
  comparePane.innerHTML = compareSamples.length ? compareSamples.map((sample) => `
    <article class="compare-item">
      ${sample.photo ? `<img src="${sample.photo}" alt="${sample.code}对比图">` : ""}
      <h3>${sample.code}</h3>
      <p>${sample.polarization} · ${sample.minerals || "未记录矿物"}</p>
      <p>${sample.texture || "未记录结构"}</p>
    </article>
  `).join("") : `<p>${locked ? "该批次归档时未选择对比样本。" : "勾选两张样本卡片后可并排对比。"}</p>`;
}

function render() {
  renderBatchFilter();
  renderBatchDesk();
  renderIssues();
  renderGrid();
  renderCompare();
}

function createRevision(parentId) {
  const parent = batchById(parentId);
  if (!parent || parent.status !== "archived") return;
  const revision = 1 + Math.max(0, ...state.batches
    .filter((batch) => batch.rootId === parent.rootId)
    .map((batch) => batch.revision));
  const batch = {
    id: crypto.randomUUID(),
    rootId: parent.rootId,
    name: `${parent.rootName} · 修订 ${revision}`,
    rootName: parent.rootName,
    status: "draft",
    revision,
    createdAt: new Date().toISOString(),
    archivedAt: null,
    compare: []
  };
  // 把旧批次样本复制进修订批次继续编辑，旧批次保持不改动
  const idMap = new Map();
  const copies = samplesOf(parent.id).map((sample) => {
    const copy = { ...sample, id: crypto.randomUUID(), batchId: batch.id, createdAt: new Date().toISOString() };
    idMap.set(sample.id, copy.id);
    return copy;
  });
  batch.compare = parent.compare.map((id) => idMap.get(id)).filter(Boolean).slice(0, 2);
  state.batches.push(batch);
  state.samples = [...copies, ...state.samples];
  state.activeBatchId = batch.id;
  state.viewBatchId = batch.id;
  lastIssues = [];
}

photoInput.addEventListener("change", async () => {
  pendingPhoto = await readFileAsDataUrl(photoInput.files[0]);
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = new FormData(form);
  if (!pendingPhoto && photoInput.files[0]) {
    pendingPhoto = await readFileAsDataUrl(photoInput.files[0]);
  }
  const target = batchById(state.activeBatchId);
  const batchId = target && target.status !== "archived" ? target.id : LEGACY_BATCH_ID;
  state.samples.unshift({
    id: crypto.randomUUID(),
    batchId,
    photo: pendingPhoto,
    code: data.get("code").trim(),
    location: data.get("location").trim(),
    magnification: data.get("magnification").trim(),
    polarization: data.get("polarization"),
    minerals: data.get("minerals").trim(),
    texture: data.get("texture").trim(),
    comment: data.get("comment").trim(),
    createdAt: new Date().toISOString()
  });
  state.viewBatchId = batchId;
  pendingPhoto = "";
  photoInput.value = "";
  form.reset();
  save();
  render();
});

sampleGrid.addEventListener("click", (event) => {
  const deleteId = event.target.dataset.delete;
  if (!deleteId) return;
  const sample = state.samples.find((item) => item.id === deleteId);
  const batch = sample && batchById(sample.batchId);
  if (batch && batch.status === "archived") return; // 已归档样本锁定，不可删除
  state.samples = state.samples.filter((item) => item.id !== deleteId);
  state.batches.forEach((item) => {
    item.compare = item.compare.filter((id) => id !== deleteId);
  });
  save();
  render();
});

sampleGrid.addEventListener("change", (event) => {
  const id = event.target.dataset.compare;
  if (!id) return;
  const sample = state.samples.find((item) => item.id === id);
  const batch = sample && batchById(sample.batchId);
  if (!batch || batch.status === "archived") return; // 已归档批次的对比选择锁定
  if (event.target.checked) {
    batch.compare = [id, ...batch.compare.filter((item) => item !== id)].slice(0, 2);
  } else {
    batch.compare = batch.compare.filter((item) => item !== id);
  }
  save();
  render();
});

batchList.addEventListener("click", (event) => {
  const { view, activate, revise } = event.target.dataset;
  if (view) {
    state.viewBatchId = view;
  } else if (activate) {
    const batch = batchById(activate);
    if (!batch || batch.status === "archived") return;
    state.activeBatchId = activate;
    state.viewBatchId = activate;
    lastIssues = [];
  } else if (revise) {
    createRevision(revise);
  } else {
    return;
  }
  save();
  render();
});

newBatchBtn.addEventListener("click", () => {
  state.batchSeq += 1;
  const name = `批次 ${state.batchSeq}`;
  const batch = {
    id: crypto.randomUUID(),
    rootId: "",
    name,
    rootName: name,
    status: "draft",
    revision: 0,
    createdAt: new Date().toISOString(),
    archivedAt: null,
    compare: []
  };
  batch.rootId = batch.id;
  state.batches.push(batch);
  state.activeBatchId = batch.id;
  state.viewBatchId = batch.id;
  lastIssues = [];
  save();
  render();
});

archiveBatchBtn.addEventListener("click", () => {
  const batch = batchById(state.activeBatchId);
  if (!batch || batch.status !== "draft") return;
  if (!samplesOf(batch.id).length) {
    lastIssues = [{ code: batch.name, reasons: ["批次内没有样本，无法归档"] }];
    render();
    return;
  }
  const issues = validateBatch(batch);
  if (issues.length) {
    lastIssues = issues; // 缺项或重复：保持草稿并指出样本编号与原因
    render();
    return;
  }
  batch.status = "archived";
  batch.archivedAt = new Date().toISOString();
  state.activeBatchId = LEGACY_BATCH_ID;
  state.viewBatchId = batch.id;
  lastIssues = [];
  save();
  render();
});

[mineralFilter, polarFilter].forEach((field) => field.addEventListener("input", render));

batchFilter.addEventListener("change", () => {
  state.viewBatchId = batchFilter.value;
  save();
  render();
});

document.querySelector("#exportBtn").addEventListener("click", () => {
  const checklist = state.samples.map((sample) => {
    const batch = batchById(sample.batchId);
    return {
      样本编号: sample.code,
      批次: batch ? batch.name : "历史未归档",
      归档状态: batch ? batchStatusLabel(batch) : "历史未归档",
      采样地点: sample.location,
      放大倍数: sample.magnification,
      偏光类型: sample.polarization,
      主要矿物: sample.minerals,
      颗粒结构: sample.texture,
      老师批注: sample.comment
    };
  });
  const blob = new Blob([JSON.stringify(checklist, null, 2)], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "thin-section-checklist.json";
  link.click();
  URL.revokeObjectURL(link.href);
});

save();
render();
