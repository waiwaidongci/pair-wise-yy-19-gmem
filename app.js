const storageKey = "wxyy-2-thin-section-index";

function pad2(n) {
  return String(n).padStart(2, "0");
}

function formatDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function defaultBatchName() {
  return `批次 ${formatDate(new Date().toISOString())}`;
}

function createBatch(name, { legacy = false, source = null } = {}) {
  return {
    id: crypto.randomUUID(),
    name,
    status: "draft", // draft | archived
    legacy,
    createdAt: new Date().toISOString(),
    archivedAt: null,
    sourceBatchId: source ? source.id : null,
    samples: [],
    compare: []
  };
}

function migrate(raw) {
  // 已是批次结构：校正指针
  if (raw && Array.isArray(raw.batches) && raw.batches.length) {
    const openDraft = raw.batches.find((b) => b.id === raw.activeBatchId && b.status === "draft");
    raw.activeBatchId = openDraft ? openDraft.id : null;
    if (!raw.batches.some((b) => b.id === raw.viewingBatchId)) {
      raw.viewingBatchId = raw.activeBatchId || raw.batches[raw.batches.length - 1].id;
    }
    return raw;
  }
  // 旧版样本索引：整体迁入「历史未归档」草稿批次，筛选/对比/导出均保留
  if (raw && Array.isArray(raw.samples)) {
    const legacy = createBatch("历史未归档", { legacy: true });
    legacy.samples = raw.samples;
    legacy.compare = Array.isArray(raw.compare)
      ? raw.compare.filter((id) => raw.samples.some((sample) => sample.id === id))
      : [];
    if (raw.samples[0] && raw.samples[0].createdAt) legacy.createdAt = raw.samples[0].createdAt;
    return { version: 2, batches: [legacy], activeBatchId: legacy.id, viewingBatchId: legacy.id };
  }
  // 首次使用：自动准备一个开放批次
  const first = createBatch(defaultBatchName());
  return { version: 2, batches: [first], activeBatchId: first.id, viewingBatchId: first.id };
}

const state = migrate(JSON.parse(localStorage.getItem(storageKey) || "null"));
save(); // 立即固化迁移/初始化结果，后续筛选、对比、导出都基于批次结构

const form = document.querySelector("#sampleForm");
const photoInput = document.querySelector("#photoInput");
const sampleGrid = document.querySelector("#sampleGrid");
const comparePane = document.querySelector("#comparePane");
const compareNote = document.querySelector("#compareNote");
const mineralFilter = document.querySelector("#mineralFilter");
const polarFilter = document.querySelector("#polarFilter");
const batchList = document.querySelector("#batchList");
const batchHint = document.querySelector("#batchHint");
const archiveIssues = document.querySelector("#archiveIssues");
const newBatchBtn = document.querySelector("#newBatchBtn");
const archiveBatchBtn = document.querySelector("#archiveBatchBtn");
const reviseBatchBtn = document.querySelector("#reviseBatchBtn");
const historyGate = document.querySelector("#historyGate");
const gateText = document.querySelector("#gateText");
const gateReviseBtn = document.querySelector("#gateReviseBtn");
const gateBackBtn = document.querySelector("#gateBackBtn");
const gateNewBtn = document.querySelector("#gateNewBtn");
const historyBanner = document.querySelector("#historyBanner");
const bannerReviseBtn = document.querySelector("#bannerReviseBtn");
const bannerBackBtn = document.querySelector("#bannerBackBtn");
const boardTitle = document.querySelector("#boardTitle");
const boardSub = document.querySelector("#boardSub");

let pendingPhoto = "";
// 归档校验失败的提示只与具体批次绑定，且不持久化（改样本后即清除）
let issuesForBatchId = null;
let issuesList = [];

function save() {
  localStorage.setItem(storageKey, JSON.stringify(state));
}

function activeBatch() {
  return state.batches.find((batch) => batch.id === state.activeBatchId && batch.status === "draft") || null;
}

function viewedBatch() {
  return state.batches.find((batch) => batch.id === state.viewingBatchId) || activeBatch() || state.batches[0] || null;
}

function clearIssues() {
  issuesForBatchId = null;
  issuesList = [];
}

function readFileAsDataUrl(file) {
  return new Promise((resolve) => {
    if (!file) return resolve("");
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(reader.result));
    reader.readAsDataURL(file);
  });
}

function filteredSamples(batch) {
  const mineral = mineralFilter.value.trim();
  const polarization = polarFilter.value;
  return batch.samples.filter((sample) => {
    const mineralMatch = !mineral || (sample.minerals || "").includes(mineral);
    const polarMatch = !polarization || sample.polarization === polarization;
    return mineralMatch && polarMatch;
  });
}

function validateBatch(batch) {
  const issues = [];
  const codeCounts = new Map();
  batch.samples.forEach((sample) => {
    codeCounts.set(sample.code, (codeCounts.get(sample.code) || 0) + 1);
  });
  batch.samples.forEach((sample) => {
    const reasons = [];
    if (!sample.photo) reasons.push("缺少显微照片");
    if (!(sample.minerals || "").trim()) reasons.push("未填写主要矿物");
    if (!(sample.texture || "").trim()) reasons.push("未填写颗粒结构");
    if (codeCounts.get(sample.code) > 1) {
      reasons.push(`编号重复（本批次内出现 ${codeCounts.get(sample.code)} 次）`);
    }
    if (reasons.length) issues.push({ code: sample.code, reasons });
  });
  return issues;
}

function renderBatchList(batch) {
  const ordered = state.batches.slice().sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  batchList.innerHTML = ordered.map((item) => `
    <button type="button" class="batch-row ${item.id === batch.id ? "is-active" : ""}" data-view="${item.id}">
      <span class="batch-name">${item.name}</span>
      <span class="badge badge-${item.status}">${item.status === "archived" ? "已归档" : "草稿"}</span>
      <span class="batch-meta">${item.samples.length} 个样本${item.archivedAt ? ` · 归档于 ${formatDate(item.archivedAt)}` : ""}</span>
    </button>
  `).join("");
}

function renderIssues(batch) {
  if (issuesForBatchId !== batch.id || !issuesList.length) {
    archiveIssues.hidden = true;
    archiveIssues.innerHTML = "";
    return;
  }
  archiveIssues.hidden = false;
  archiveIssues.innerHTML = `
    <strong>无法归档，批次仍保持草稿，请补正后重试：</strong>
    <ul>${issuesList.map((issue) => `<li><code>${issue.code}</code>：${issue.reasons.join("；")}</li>`).join("")}</ul>
  `;
}

function renderGrid(batch) {
  const locked = batch.status === "archived";
  const rows = filteredSamples(batch);
  sampleGrid.innerHTML = rows.length ? rows.map((sample) => `
    <article class="sample-card">
      ${sample.photo ? `<img src="${sample.photo}" alt="${sample.code}显微照片">` : "<div class=\"photo-placeholder\"></div>"}
      ${locked ? "<span class=\"card-badge\">已归档</span>" : ""}
      <div class="sample-body">
        <h3>${sample.code}</h3>
        <p>${sample.location || "未记录地点"} · ${sample.magnification || "未记录倍数"} · ${sample.polarization}</p>
        <p>矿物：${sample.minerals || "未记录"}</p>
        <p>结构：${sample.texture || "未记录"}</p>
        <p>${sample.comment || "未填写批注"}</p>
        <div class="card-actions">
          <label><input type="checkbox" data-compare="${sample.id}" ${batch.compare.includes(sample.id) ? "checked" : ""} ${locked ? "disabled" : ""}>对比</label>
          ${locked ? "<span class=\"card-lock\">已锁定</span>" : `<button type="button" data-delete="${sample.id}">删除</button>`}
        </div>
      </div>
    </article>
  `).join("") : `<p>${locked ? "该归档批次中没有样本。" : "还没有样本，先从左侧录入一张薄片照片。"}</p>`;
}

function renderCompare(batch) {
  const locked = batch.status === "archived";
  const compareSamples = batch.compare
    .map((id) => batch.samples.find((sample) => sample.id === id))
    .filter(Boolean)
    .slice(0, 2);

  comparePane.innerHTML = compareSamples.length ? compareSamples.map((sample) => `
    <article class="compare-item">
      ${sample.photo ? `<img src="${sample.photo}" alt="${sample.code}对比图">` : ""}
      <h3>${sample.code}</h3>
      <p>${sample.polarization} · ${sample.minerals || "未记录矿物"}</p>
      <p>${sample.texture || "未记录结构"}</p>
    </article>
  `).join("") : `<p>${locked ? "该批次归档时未保存对比选择。" : "勾选两张样本卡片后可并排对比。"}</p>`;

  compareNote.textContent = locked
    ? "该批次已归档，样本与对比选择均已锁定，仅可按历史查看；如需调整请创建修订批次。"
    : "对比选择随当前草稿批次保存，归档时一并锁定。";
}

function render() {
  const batch = viewedBatch();
  const active = activeBatch();
  if (!batch) return;
  const locked = batch.status === "archived";

  renderBatchList(batch);

  boardTitle.textContent = batch.name;
  boardSub.textContent = locked
    ? `已归档于 ${formatDate(batch.archivedAt)} · 只读历史，内容与对比选择已锁定`
    : `草稿 · ${batch.samples.length} 个样本 · 新录入样本归属此批次`;
  historyBanner.hidden = !locked;
  bannerBackBtn.hidden = !active;

  form.classList.toggle("hidden", locked);
  historyGate.hidden = !locked;
  if (locked) {
    gateText.textContent = `「${batch.name}」已于 ${formatDate(batch.archivedAt)} 归档，样本与对比选择均已锁定。如需改动，请创建新的修订批次，原归档批次不会被修改。`;
    gateBackBtn.hidden = !active;
  }

  archiveBatchBtn.hidden = locked;
  reviseBatchBtn.hidden = !locked;
  newBatchBtn.disabled = Boolean(active);
  reviseBatchBtn.disabled = Boolean(active);
  gateReviseBtn.disabled = Boolean(active);
  gateNewBtn.disabled = Boolean(active);
  batchHint.textContent = active
    ? "请先归档当前草稿批次，再新建或修订其他批次。"
    : "";

  renderGrid(batch);
  renderCompare(batch);
  renderIssues(batch);
}

photoInput.addEventListener("change", async () => {
  pendingPhoto = await readFileAsDataUrl(photoInput.files[0]);
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const batch = activeBatch();
  if (!batch || batch.id !== state.viewingBatchId) return; // 历史只读视图不能录入
  const data = new FormData(form);
  if (!pendingPhoto && photoInput.files[0]) {
    pendingPhoto = await readFileAsDataUrl(photoInput.files[0]);
  }
  batch.samples.unshift({
    id: crypto.randomUUID(),
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
  pendingPhoto = "";
  photoInput.value = "";
  form.reset();
  clearIssues();
  save();
  render();
});

sampleGrid.addEventListener("click", (event) => {
  const batch = viewedBatch();
  if (!batch || batch.status === "archived") return; // 归档样本锁定
  const deleteId = event.target.dataset.delete;
  if (deleteId) {
    batch.samples = batch.samples.filter((sample) => sample.id !== deleteId);
    batch.compare = batch.compare.filter((id) => id !== deleteId);
    clearIssues();
    save();
    render();
  }
});

sampleGrid.addEventListener("change", (event) => {
  const batch = viewedBatch();
  if (!batch || batch.status === "archived") return; // 归档批次的对比选择锁定
  const id = event.target.dataset.compare;
  if (!id) return;
  if (event.target.checked) {
    batch.compare = [id, ...batch.compare.filter((item) => item !== id)].slice(0, 2);
  } else {
    batch.compare = batch.compare.filter((item) => item !== id);
  }
  save();
  render();
});

[mineralFilter, polarFilter].forEach((field) => field.addEventListener("input", render));

batchList.addEventListener("click", (event) => {
  const viewId = event.target.closest("[data-view]")?.dataset.view;
  if (!viewId || !state.batches.some((batch) => batch.id === viewId)) return;
  state.viewingBatchId = viewId;
  render();
});

newBatchBtn.addEventListener("click", () => {
  if (activeBatch()) return;
  const name = window.prompt("新批次名称", defaultBatchName());
  if (name === null) return;
  const batch = createBatch(name.trim() || defaultBatchName());
  state.batches.push(batch);
  state.activeBatchId = batch.id;
  state.viewingBatchId = batch.id;
  clearIssues();
  save();
  render();
});

gateNewBtn.addEventListener("click", () => newBatchBtn.click());

archiveBatchBtn.addEventListener("click", () => {
  const batch = activeBatch();
  if (!batch || batch.id !== viewedBatch().id) return;
  if (!batch.samples.length) {
    issuesForBatchId = batch.id;
    issuesList = [];
    archiveIssues.hidden = false;
    archiveIssues.innerHTML = "<strong>无法归档，批次仍保持草稿：</strong><ul><li>批次内没有样本，无需归档</li></ul>";
    return;
  }
  const issues = validateBatch(batch);
  if (issues.length) {
    // 核对未通过：保持草稿，逐条指出样本编号与原因
    issuesForBatchId = batch.id;
    issuesList = issues;
    render();
    return;
  }
  batch.status = "archived";
  batch.archivedAt = new Date().toISOString();
  state.activeBatchId = null; // 归档后锁定，只能查看历史
  clearIssues();
  save();
  render();
});

function reviseViewedBatch() {
  const source = viewedBatch();
  if (!source || source.status !== "archived" || activeBatch()) return;
  // 修订 = 复制归档内容到全新草稿批次，旧批次保持不变
  const revision = createBatch(`${source.name} · 修订`, { source });
  const idMap = new Map();
  revision.samples = source.samples.map((sample) => {
    const copy = { ...sample, id: crypto.randomUUID() };
    idMap.set(sample.id, copy.id);
    return copy;
  });
  revision.compare = source.compare.map((id) => idMap.get(id)).filter(Boolean);
  state.batches.push(revision);
  state.activeBatchId = revision.id;
  state.viewingBatchId = revision.id;
  clearIssues();
  save();
  render();
}

reviseBatchBtn.addEventListener("click", reviseViewedBatch);
gateReviseBtn.addEventListener("click", reviseViewedBatch);
bannerReviseBtn.addEventListener("click", reviseViewedBatch);

function backToActive() {
  const active = activeBatch();
  if (!active) return;
  state.viewingBatchId = active.id;
  render();
}
gateBackBtn.addEventListener("click", backToActive);
bannerBackBtn.addEventListener("click", backToActive);

document.querySelector("#exportBtn").addEventListener("click", () => {
  // 导出覆盖全部批次（含历史未归档迁移数据），不丢任何样本
  const checklist = state.batches
    .slice()
    .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1))
    .flatMap((batch) => batch.samples.map((sample) => ({
      批次: batch.name,
      批次状态: batch.status === "archived" ? "已归档" : "草稿",
      归档时间: formatDate(batch.archivedAt),
      样本编号: sample.code,
      采样地点: sample.location,
      放大倍数: sample.magnification,
      偏光类型: sample.polarization,
      主要矿物: sample.minerals,
      颗粒结构: sample.texture,
      老师批注: sample.comment
    })));
  const blob = new Blob([JSON.stringify(checklist, null, 2)], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "thin-section-batches.json";
  link.click();
  URL.revokeObjectURL(link.href);
});

render();
