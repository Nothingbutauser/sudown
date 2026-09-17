(() => {
  "use strict";
  // suneung worker
  const API_BASE = "https://suneung-worker.hyeseong2thac.workers.dev";

  const MONTHS = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
  const TOTAL_STEPS = 5;

  const state = {
    currentStep: 1,
    maxReachedStep: 1,
    years: new Set(),
    grade: null,
    months: new Set(),
    subjects: new Map(), // code -> { code, category, name }
    results: [], // { filename, url }
    selectedResults: new Set(), // indices into state.results
    resultGroups: [], // 문제/정답/해설로 묶인 결과
  };

  const el = {
    yearsGrid: document.getElementById("years-grid"),
    monthsGrid: document.getElementById("months-grid"),
    gradeSegmented: document.getElementById("grade-segmented"),
    subjectsContainer: document.getElementById("subjects-container"),
    wizardNav: document.getElementById("wizard-nav"),
    backBtn: document.getElementById("back-btn"),
    nextBtn: document.getElementById("next-btn"),
    backToEdit: document.getElementById("back-to-edit"),
    searchStatus: document.getElementById("search-status"),
    resultCount: document.getElementById("result-count"),
    resultsToolbar: document.getElementById("results-toolbar"),
    resultsList: document.getElementById("results-list"),
    selectAllResults: document.getElementById("select-all-results"),
    zipBtn: document.getElementById("zip-btn"),
    toast: document.getElementById("toast"),
    stepNodes: [...document.querySelectorAll(".step-node")],
    stepLines: [...document.querySelectorAll(".step-line")],
  };

  const reduceMotion = () =>
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  let toastTimer = null;
  function showToast(message, isError = false) {
    el.toast.textContent = message;
    el.toast.classList.toggle("error", isError);
    el.toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.toast.classList.remove("show"), 3200);
  }

  // ---------- Wizard: step validity / navigation ----------

  function canAdvance(step) {
    switch (step) {
      case 1: return state.years.size > 0;
      case 2: return state.grade !== null;
      case 3: return state.months.size > 0;
      case 4: return state.subjects.size > 0;
      default: return true;
    }
  }

  function updateStepperUI() {
    el.stepNodes.forEach((node) => {
      const idx = Number(node.dataset.step);
      const isDone = idx < state.currentStep;
      const isCurrent = idx === state.currentStep;
      const wasDone = node.classList.contains("done");

      node.classList.toggle("done", isDone);
      node.classList.toggle("current", isCurrent);
      node.disabled = idx > state.maxReachedStep;
      node.setAttribute("aria-current", isCurrent ? "step" : "false");

      if (isDone && !wasDone && !reduceMotion()) {
        node.classList.add("pop");
        node.addEventListener("animationend", () => node.classList.remove("pop"), { once: true });
      }
    });

    el.stepLines.forEach((line) => {
      const idx = Number(line.dataset.line);
      line.classList.toggle("done", idx < state.currentStep);
    });
  }

  function updateNavUI() {
    el.backBtn.disabled = state.currentStep === 1;
    el.nextBtn.textContent = state.currentStep === 4 ? "기출문제 검색" : "다음";
    el.nextBtn.disabled = !canAdvance(state.currentStep);
    el.wizardNav.hidden = state.currentStep === 5;
  }

  function refresh() {
    updateStepperUI();
    updateNavUI();
  }

  const TRANSITION_MS = 200; // CSS out-animation(.16s) + 여유분

  let isTransitioning = false;

  function goToStep(target, direction) {
    if (isTransitioning) return;

    const current = document.querySelector(".screen.active");
    const nextScreen = document.querySelector(`.screen[data-screen="${target}"]`);
    if (!nextScreen || current === nextScreen) return;

    state.currentStep = target;
    state.maxReachedStep = Math.max(state.maxReachedStep, target);
    refresh();

    const activate = () => {
      nextScreen.classList.add("active");
      if (!reduceMotion()) {
        const inClass = direction === "forward" ? "anim-in-forward" : "anim-in-back";
        nextScreen.classList.add(inClass);
        const clearIn = () => nextScreen.classList.remove(inClass);
        nextScreen.addEventListener("animationend", clearIn, { once: true });
        setTimeout(clearIn, TRANSITION_MS + 100);
      }
      isTransitioning = false;
    };

    if (!current) {
      activate();
      return;
    }

    if (reduceMotion()) {
      current.classList.remove("active");
      activate();
      return;
    }

    isTransitioning = true;
    const outClass = direction === "forward" ? "anim-out-forward" : "anim-out-back";
    let settled = false;
    // animationend가 정상적으로 오면 그때 넘어가고, 혹시 못 받더라도
    // 타임아웃으로 반드시 다음 화면으로 넘어가도록 이중 안전장치를 둔다.
    const finishOut = () => {
      if (settled) return;
      settled = true;
      current.classList.remove("active", outClass);
      activate();
    };
    current.classList.add(outClass);
    current.addEventListener("animationend", finishOut, { once: true });
    setTimeout(finishOut, TRANSITION_MS);
  }

  el.backBtn.addEventListener("click", () => {
    if (state.currentStep > 1) goToStep(state.currentStep - 1, "back");
  });

  el.nextBtn.addEventListener("click", () => {
    if (!canAdvance(state.currentStep)) return;
    if (state.currentStep < 4) {
      goToStep(state.currentStep + 1, "forward");
    } else if (state.currentStep === 4) {
      startSearch();
    }
  });

  el.backToEdit.addEventListener("click", () => goToStep(4, "back"));

  el.stepNodes.forEach((node) => {
    node.addEventListener("click", () => {
      const target = Number(node.dataset.step);
      if (target > state.maxReachedStep || target === state.currentStep) return;
      goToStep(target, target > state.currentStep ? "forward" : "back");
    });
  });

  // ---------- Years (Worker 프록시 필요) ----------

  async function loadYears() {
    try {
      const res = await fetch(`${API_BASE}/years`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "연도 목록을 불러오지 못했습니다.");
      renderYears(data.years);
    } catch (err) {
      el.yearsGrid.innerHTML = `<p class="hint">연도 목록을 불러오지 못했습니다. 잠시 후 새로고침해 주세요.</p>`;
      showToast(err.message, true);
    }
  }

  function renderYears(years) {
    el.yearsGrid.innerHTML = "";
    years.forEach((year) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "chip";
      btn.textContent = `${year}년`;
      btn.dataset.year = String(year);
      btn.addEventListener("click", () => {
        if (state.years.has(year)) {
          state.years.delete(year);
          btn.classList.remove("selected");
        } else {
          state.years.add(year);
          btn.classList.add("selected");
        }
        refresh();
      });
      el.yearsGrid.appendChild(btn);
    });
  }

  // ---------- Months ----------

  function renderMonths() {
    el.monthsGrid.innerHTML = "";
    MONTHS.forEach((month) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "chip";
      btn.textContent = `${month}월`;
      btn.addEventListener("click", () => {
        if (state.months.has(month)) {
          state.months.delete(month);
          btn.classList.remove("selected");
        } else {
          state.months.add(month);
          btn.classList.add("selected");
        }
        refresh();
      });
      el.monthsGrid.appendChild(btn);
    });
  }

  // ---------- Grade / Subjects (전부 클라이언트에서 처리, 네트워크 불필요) ----------

  el.gradeSegmented.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-grade]");
    if (!btn) return;
    const grade = Number(btn.dataset.grade);
    state.grade = grade;
    state.subjects.clear();

    [...el.gradeSegmented.querySelectorAll("button")].forEach((b) => {
      b.setAttribute("aria-checked", String(b === btn));
    });

    renderSubjects(getSubjectsForGrade(grade));
    refresh();
  });

  function renderSubjects(categories) {
    el.subjectsContainer.innerHTML = "";

    if (categories.length === 0) {
      el.subjectsContainer.innerHTML = `<p class="hint">과목 목록을 찾을 수 없습니다.</p>`;
      return;
    }

    categories.forEach(({ category, subjects }) => {
      const group = document.createElement("div");
      group.className = "subject-group";

      const title = document.createElement("p");
      title.className = "subject-group-title";
      title.textContent = category;
      group.appendChild(title);

      const chips = document.createElement("div");
      chips.className = "subject-chips";

      subjects.forEach(({ code, name }) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "subject-chip";
        btn.textContent = name;
        btn.addEventListener("click", () => {
          if (state.subjects.has(code)) {
            state.subjects.delete(code);
            btn.classList.remove("selected");
          } else {
            state.subjects.set(code, { code, category, name });
            btn.classList.add("selected");
          }
          refresh();
        });
        chips.appendChild(btn);
      });

      group.appendChild(chips);
      el.subjectsContainer.appendChild(group);
    });
  }

  // ---------- Select all (year / month chips) ----------

  document.querySelectorAll("[data-select-all]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const kind = btn.dataset.selectAll;
      if (kind === "years") {
        const chips = [...el.yearsGrid.querySelectorAll(".chip")];
        const allSelected = chips.every((c) => c.classList.contains("selected"));
        chips.forEach((c) => {
          const year = Number(c.dataset.year);
          if (allSelected) {
            state.years.delete(year);
            c.classList.remove("selected");
          } else {
            state.years.add(year);
            c.classList.add("selected");
          }
        });
      } else if (kind === "months") {
        const chips = [...el.monthsGrid.querySelectorAll(".chip")];
        const allSelected = chips.every((c) => c.classList.contains("selected"));
        chips.forEach((c, i) => {
          const month = MONTHS[i];
          if (allSelected) {
            state.months.delete(month);
            c.classList.remove("selected");
          } else {
            state.months.add(month);
            c.classList.add("selected");
          }
        });
      }
      refresh();
    });
  });

  // ---------- Search (Worker 프록시 필요) ----------

  async function startSearch() {
    goToStep(5, "forward");

    el.resultsToolbar.hidden = true;
    el.resultsList.innerHTML = "";
    el.resultCount.textContent = "";
    el.searchStatus.textContent = "검색 중입니다…";
    el.searchStatus.classList.remove("error");

    const body = {
      years: [...state.years],
      grade: state.grade,
      months: [...state.months],
      subjects: [...state.subjects.values()].map(({ code, category }) => ({ code, category })),
    };

    try {
      const res = await fetch(`${API_BASE}/search`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "검색 중 오류가 발생했습니다.");

      state.results = data.results;
      state.selectedResults = new Set(data.results.map((_, i) => i));

      if (data.results.length === 0) {
        el.searchStatus.textContent = "조건에 맞는 시험지가 없습니다. 조건을 다시 선택해 주세요.";
      } else {
        el.searchStatus.textContent = "";
        renderResults();
      }
    } catch (err) {
      el.searchStatus.textContent = err.message;
      el.searchStatus.classList.add("error");
      showToast(err.message, true);
    }
  }

  // ---------- 결과 묶기 (문제 / 정답 / 해설) ----------

  const FILE_TYPE_LABELS = [
    { key: "problem", label: "문제" },
    { key: "answer", label: "정답" },
    { key: "solution", label: "해설" },
  ];

  // 영어 영역처럼 듣기평가/대본이 함께 배포되는 경우를 위한 5분류 라벨.
  // (문제 안에 이미 "듣기"라는 단어가 섞여 있을 수 있어, 아래 detectFileType에서
  //  "대본" → "듣기" → "정답" → "해설" 순으로 먼저 걸러낸다.)
  const ENGLISH_FILE_TYPE_LABELS = [
    { key: "problem", label: "문제" },
    { key: "listening", label: "듣기" },
    { key: "script", label: "대본" },
    { key: "answer", label: "정답" },
    { key: "solution", label: "해설" },
  ];

  function detectFileType(nameWithoutExt) {
    if (/해설/.test(nameWithoutExt)) return "solution";
    if (/정답/.test(nameWithoutExt)) return "answer";
    if (/대본/.test(nameWithoutExt)) return "script";
    if (/듣기/.test(nameWithoutExt)) return "listening";
    return "problem";
  }

  function buildResultGroups(results) {
    const groups = new Map();

    results.forEach((item, index) => {
      const noExt = item.filename.replace(/\.[^.\s]+$/, "");
      const type = detectFileType(noExt);

      // 문제/정답/해설 표시어를 지운 나머지를 같은 시험지를 묶는 기준(key)이자
      // 카드 제목으로 사용한다.
      const title = noExt
        .replace(/정답\s*(및|[,/])?\s*해설/g, "")
        .replace(/해설/g, "")
        .replace(/정답/g, "")
        .replace(/듣기\s*대본/g, "")
        .replace(/대본/g, "")
        .replace(/듣기/g, "")
        .replace(/문제/g, "")
        .replace(/[_[\]()]+/g, " ")
        .replace(/\s{2,}/g, " ")
        .trim();

      const key = title || noExt;

      if (!groups.has(key)) {
        const examYearMatch = title.match(/(\d{4})\s*학년도/);
        const subtitle = examYearMatch
          ? `${Number(examYearMatch[1]) - 1}년 시행`
          : "";

        groups.set(key, {
          title: title || item.filename,
          subtitle,
          files: { problem: null, listening: null, script: null, answer: null, solution: null },
          indices: [],
        });
      }

      const group = groups.get(key);
      // 같은 종류(예: 문제)의 파일이 여러 개 잡히면 먼저 찾은 것을 유지한다.
      if (!group.files[type]) {
        group.files[type] = { ...item, index };
      }
      group.indices.push(index);
    });

    return [...groups.values()];
  }

  function renderResults() {
    const groups = buildResultGroups(state.results);
    state.resultGroups = groups;

    el.resultCount.textContent = `${groups.length}개 시험지 (파일 ${state.results.length}개)`;
    el.resultsToolbar.hidden = false;
    el.selectAllResults.checked = true;
    el.resultsList.innerHTML = "";
    el.resultsList.classList.add("exam-grid");

    const gradeLabel = state.grade ? `고${state.grade}` : "";

    groups.forEach((group) => {
      const li = document.createElement("li");
      li.className = "exam-card";

      // 헤더: 체크박스 + 제목/부제 + 학년 배지
      const header = document.createElement("div");
      header.className = "exam-card-header";

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.className = "exam-card-check";
      checkbox.checked = true;
      checkbox.setAttribute("aria-label", `${group.title} 전체 선택`);
      checkbox.addEventListener("change", () => {
        group.indices.forEach((i) => {
          if (checkbox.checked) state.selectedResults.add(i);
          else state.selectedResults.delete(i);
        });
        syncSelectAllCheckbox();
      });

      const titleWrap = document.createElement("div");
      titleWrap.className = "exam-card-title-wrap";

      const titleEl = document.createElement("p");
      titleEl.className = "exam-card-title";
      titleEl.textContent = group.title;
      titleEl.title = group.title;
      titleWrap.appendChild(titleEl);

      if (group.subtitle) {
        const subEl = document.createElement("p");
        subEl.className = "exam-card-subtitle";
        subEl.textContent = group.subtitle;
        titleWrap.appendChild(subEl);
      }

      header.appendChild(checkbox);
      header.appendChild(titleWrap);

      if (gradeLabel) {
        const badge = document.createElement("span");
        badge.className = "exam-card-badge";
        badge.textContent = gradeLabel;
        header.appendChild(badge);
      }

      // 파일 종류별 다운로드 버튼
      // 듣기(mp3 등)나 대본 파일이 하나라도 있으면 영어 영역용 5분류
      // (문제/듣기/대본/정답/해설)로, 그렇지 않으면 기본 3분류로 표시한다.
      const isListeningExam = Boolean(group.files.listening || group.files.script);
      const labels = isListeningExam ? ENGLISH_FILE_TYPE_LABELS : FILE_TYPE_LABELS;

      const fileRow = document.createElement("div");
      fileRow.className = "exam-card-files";
      fileRow.classList.add(isListeningExam ? "cols-5" : "cols-3");

      labels.forEach(({ key, label }) => {
        const file = group.files[key];
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "exam-file-btn";
        btn.textContent = label;

        if (file) {
          btn.addEventListener("click", () => downloadSingle(file));
        } else {
          btn.disabled = true;
          btn.classList.add("missing");
          btn.title = "해당 파일이 없습니다";
        }

        fileRow.appendChild(btn);
      });

      li.append(header, fileRow);
      el.resultsList.appendChild(li);
    });
  }

  function syncSelectAllCheckbox() {
    el.selectAllResults.checked = state.selectedResults.size === state.results.length;
  }

  el.selectAllResults.addEventListener("change", () => {
    const checked = el.selectAllResults.checked;
    state.selectedResults = checked ? new Set(state.results.map((_, i) => i)) : new Set();
    [...el.resultsList.querySelectorAll(".exam-card-check")].forEach((cb) => {
      cb.checked = checked;
    });
  });

  // ---------- Downloads (Worker 프록시를 통해 파일명까지 지정해서 받음) ----------

  function downloadSingle(item) {
    const params = new URLSearchParams({ url: item.url, filename: item.filename });
    const a = document.createElement("a");
    a.href = `${API_BASE}/download?${params.toString()}`;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // ZIP으로 묶지 않고, 선택한 파일을 순서대로 하나씩 내려받는다.
  // (Cloudflare Workers 무료 플랜은 요청당 CPU 시간이 10ms로 짧아서
  //  여러 파일을 서버에서 압축하는 방식은 파일이 조금만 많아져도 실패하기 쉽다.)
  el.zipBtn.addEventListener("click", async () => {
    const items = [...state.selectedResults].map((i) => state.results[i]);
    if (items.length === 0) {
      showToast("선택된 파일이 없습니다.", true);
      return;
    }

    const originalLabel = el.zipBtn.querySelector(".stamp-label").textContent;
    el.zipBtn.disabled = true;

    for (let i = 0; i < items.length; i++) {
      el.zipBtn.querySelector(".stamp-label").textContent = `받는 중… (${i + 1}/${items.length})`;
      downloadSingle(items[i]);
      // 브라우저가 동시 다운로드를 팝업으로 막지 않도록 살짝 간격을 둔다.
      if (i < items.length - 1) await wait(350);
    }

    el.zipBtn.disabled = false;
    el.zipBtn.querySelector(".stamp-label").textContent = originalLabel;
    showToast(`${items.length}개 파일 다운로드를 시작했습니다.`);
  });

  // ---------- Init ----------

  renderMonths();
  loadYears();
  refresh();
})();
