// ═══════════════════════════════════════════════════════════
// FEIGIN TRACK — App Logic
// File System Access API + Ollama AI Integration
// ═══════════════════════════════════════════════════════════

// ── State ──
let fileHandle = null;       // File System Access API handle
let trackingData = '';       // Content of tracking.txt
let projectCounter = 1;      // For adding new project blocks
let snackCounter = 0;        // For adding snack items

// ── Russian day/month names ──
const DAYS_RU = ['Воскресенье', 'Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота'];
const DAYS_SHORT_RU = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
const MONTHS_RU = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'
];

// ═══ INITIALIZATION ═══
document.addEventListener('DOMContentLoaded', () => {
  updateDateDisplay();
  setupNavigation();
  setupMobileToggle();
  checkOllamaStatus();

  // Load today's chat history
  loadChatHistory();

  // Provider toggle
  function setProvider(p) {
    currentProvider = p;
    localStorage.setItem('feigin_provider', p);
    document.getElementById('providerOllama').classList.toggle('active', p === 'ollama');
    document.getElementById('providerGemini').classList.toggle('active', p === 'gemini');
  }
  setProvider(currentProvider);
  document.getElementById('providerOllama').addEventListener('click', () => setProvider('ollama'));
  document.getElementById('providerGemini').addEventListener('click', () => setProvider('gemini'));

  // Open chat panel by default (or restore state)
  if (localStorage.getItem('feigin_chat_panel_open') !== '0') {
    document.getElementById('aiRightPanel').classList.add('open');
  }

  // Try restore local draft before file loads
  loadDraftFormData();

  // Setup auto-save draft (input + change covers time/date pickers)
  function saveDraft() {
    const data = collectFormData();
    localStorage.setItem('feigin_draft_date', data.dateStr);
    localStorage.setItem('feigin_draft_entry', data.entry);
  }
  document.getElementById('sectionForm').addEventListener('input', saveDraft);
  document.getElementById('sectionForm').addEventListener('change', saveDraft);

  // Morning form buttons
  document.getElementById('morningFinalBtn').addEventListener('click', openMorningFinal);
  document.getElementById('morningFinalCloseBtn').addEventListener('click', closeMorningFinal);
  document.getElementById('morningFinalSaveBtn').addEventListener('click', async () => {
    closeMorningFinal();
    await submitDay();
  });
  document.getElementById('morningFinalOverlay').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeMorningFinal();
  });

  // Final form buttons
  document.getElementById('dayFinalBtn').addEventListener('click', openDayFinal);
  document.getElementById('dayFinalCloseBtn').addEventListener('click', closeDayFinal);
  document.getElementById('dayFinalSaveBtn').addEventListener('click', async () => {
    closeDayFinal();
    await submitDay();
  });
  document.getElementById('dayFinalOverlay').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeDayFinal();
  });

  document.getElementById('weekFinalBtn').addEventListener('click', openWeekFinal);
  document.getElementById('weekFinalCloseBtn').addEventListener('click', closeWeekFinal);
  document.getElementById('weekFinalSaveBtn').addEventListener('click', async () => {
    closeWeekFinal();
    await submitDay();
  });
  document.getElementById('weekFinalOverlay').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeWeekFinal();
  });

  tryRestoreFileHandle();
});

// ── Date Display ──
function updateDateDisplay() {
  const now = new Date();
  const dateStr = `${now.getDate()} ${MONTHS_RU[now.getMonth()]} ${now.getFullYear()}`;
  const dayStr = DAYS_RU[now.getDay()];

  document.getElementById('currentDate').textContent = dateStr;
  document.getElementById('currentDay').textContent = dayStr;
}

// ── Navigation ──
function setupNavigation() {
  document.querySelectorAll('.sidebar-nav-item').forEach(item => {
    item.addEventListener('click', () => {
      document.querySelectorAll('.sidebar-nav-item').forEach(i => i.classList.remove('active'));
      item.classList.add('active');
      
      const section = item.dataset.section;
      document.getElementById('sectionForm').style.display = 'none';
      document.getElementById('sectionHistory').style.display = 'none';
      document.getElementById('sectionMap').style.display = 'none';
      if (section === 'form') {
        document.getElementById('sectionForm').style.display = 'block';
      } else if (section === 'history') {
        document.getElementById('sectionHistory').style.display = 'block';
        renderHistoryList();
      } else if (section === 'map') {
        document.getElementById('sectionMap').style.display = 'block';
        renderMap();
      }
    });
  });
}

// ── Mobile Toggle ──
function setupMobileToggle() {
  const toggle = document.getElementById('mobileToggle');
  const sidebar = document.getElementById('sidebar');
  toggle.addEventListener('click', () => {
    sidebar.classList.toggle('open');
  });
}

// ═══ FILE SYSTEM ACCESS API ═══

// Try to restore previously selected directory handle from IndexedDB
async function tryRestoreFileHandle() {
  try {
    const db = await openDB();
    const tx = db.transaction('handles', 'readonly');
    const store = tx.objectStore('handles');
    const request = store.get('trackingDir');

    request.onsuccess = async () => {
      if (request.result) {
        const dirHandle = request.result.handle;
        // Verify permission
        const perm = await dirHandle.queryPermission({ mode: 'readwrite' });
        if (perm === 'granted') {
          await setupFileFromDir(dirHandle);
          return;
        }
        // Try to request permission
        const newPerm = await dirHandle.requestPermission({ mode: 'readwrite' });
        if (newPerm === 'granted') {
          await setupFileFromDir(dirHandle);
          return;
        }
      }
      // No stored handle or permission denied — show modal
      showModal();
    };

    request.onerror = () => showModal();
  } catch (e) {
    showModal();
  }
}

// Open IndexedDB for storing directory handle
function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('FeiginTrackDB', 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('handles');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// Save directory handle to IndexedDB
async function saveDirHandle(dirHandle) {
  const db = await openDB();
  const tx = db.transaction('handles', 'readwrite');
  const store = tx.objectStore('handles');
  store.put({ handle: dirHandle }, 'trackingDir');
}

// Setup file from directory
async function setupFileFromDir(dirHandle) {
  try {
    fileHandle = await dirHandle.getFileHandle('tracking.txt', { create: true });
    await loadTrackingData();
    updateWeekGrid();
    updateStreak();
    hideModal();
    showToast('✅ Файл tracking.txt подключён', 'success');
    checkMorningReview();
  } catch (e) {
    console.error('Error setting up file:', e);
    showToast('❌ Ошибка подключения файла', 'error');
    showModal();
  }
}

// Select folder button handler
document.getElementById('selectFolderBtn').addEventListener('click', async () => {
  try {
    const dirHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
    await saveDirHandle(dirHandle);
    await setupFileFromDir(dirHandle);
  } catch (e) {
    if (e.name !== 'AbortError') {
      showToast('❌ Ошибка при выборе папки', 'error');
    }
  }
});

// Load existing data from tracking.txt
async function loadTrackingData(updateForm = true) {
  if (!fileHandle) return;
  try {
    const file = await fileHandle.getFile();
    trackingData = await file.text();
    if (updateForm) loadTodayFormData();
  } catch (e) {
    trackingData = '';
  }
}

// Write data to tracking.txt
async function writeTrackingData(content) {
  if (!fileHandle) {
    showToast('⚠️ Сначала выберите папку для данных', 'error');
    showModal();
    return false;
  }
  try {
    const writable = await fileHandle.createWritable();
    await writable.write(content);
    await writable.close();
    return true;
  } catch (e) {
    console.error('Write error:', e);
    showToast('❌ Ошибка записи в файл', 'error');
    return false;
  }
}

// ═══ PARSING AND BLOCK EXTRACTION ═══

function extractDailyBlocks(text) {
  const blocks = [];
  const regex = /═══════════════════════════════════════\n📅 (\d{4}-\d{2}-\d{2})([\s\S]*?)(?=═══════════════════════════════════════\n📅|$)/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    blocks.push({
      dateStr: match[1],
      fullText: match[0].trim()
    });
  }
  return blocks;
}

function loadDraftFormData() {
  const now = new Date();
  const dateStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
  
  if (localStorage.getItem('feigin_draft_date') === dateStr) {
    const text = localStorage.getItem('feigin_draft_entry');
    if (text) {
      parseTextToForm(text);
      return true;
    }
  }
  return false;
}

function loadTodayFormData() {
  const now = new Date();
  const dateStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
  
  const blocks = extractDailyBlocks(trackingData);
  const todayBlock = blocks.find(b => b.dateStr === dateStr);
  
  if (todayBlock) {
    const draftDate = localStorage.getItem('feigin_draft_date');
    if (draftDate === dateStr) {
       const draftText = localStorage.getItem('feigin_draft_entry');
       if (draftText && draftText !== todayBlock.fullText) {
          parseTextToForm(draftText);
          return;
       }
    }
    parseTextToForm(todayBlock.fullText);
  } else {
    // Fallback to draft if file has no today block yet
    loadDraftFormData();
  }
}

function parseTextToForm(text) {
  // Morning
  const morningMainMatch = text.match(/🎯 Главное: ([\s\S]*?)(?=🌟 Намерение:|$)/);
  if (morningMainMatch) document.getElementById('morningMain').value = morningMainMatch[1].trim() === '—' ? '' : morningMainMatch[1].trim();
  const morningFeelMatch = text.match(/🌟 Намерение: ([\s\S]*?)(?=⚡ Энергия|$)/);
  if (morningFeelMatch) document.getElementById('morningFeel').value = morningFeelMatch[1].trim() === '—' ? '' : morningFeelMatch[1].trim();
  const morningEnergyMatch = text.match(/⚡ Энергия \/ 🚧 Сопротивление: ([\s\S]*?)(?=\n🎯 ЦЕЛИ НА НЕДЕЛЮ|\n🏥 ЗДОРОВЬЕ|$)/);
  if (morningEnergyMatch) document.getElementById('morningEnergy').value = morningEnergyMatch[1].trim() === '—' ? '' : morningEnergyMatch[1].trim();

  // Weekly Goals
  const goalsMatch = text.match(/🎯 ЦЕЛИ НА НЕДЕЛЮ\n───────────────────────────────────────\n([\s\S]*?)(?=\n🏥 ЗДОРОВЬЕ)/);
  if (goalsMatch) {
    let val = goalsMatch[1].trim();
    document.getElementById('weeklyGoals').value = val === '—' ? '' : val;
  }

  // Health
  const wakeMatch = text.match(/⏰ Пробуждение: (.*?) — (.*)/);
  if (wakeMatch) {
    document.getElementById('wakeTime').value = wakeMatch[1] === '—' ? '' : wakeMatch[1];
    document.getElementById('wakeComment').value = wakeMatch[2] === '—' ? '' : wakeMatch[2];
  }
  const breakfastMatch = text.match(/🍳 Завтрак: (.*)/);
  if (breakfastMatch) document.getElementById('breakfast').value = breakfastMatch[1] === '—' ? '' : breakfastMatch[1];
  const lunchMatch = text.match(/🥗 Обед: (.*)/);
  if (lunchMatch) document.getElementById('lunch').value = lunchMatch[1] === '—' ? '' : lunchMatch[1];
  const dinnerMatch = text.match(/🍽️ Ужин: (.*)/);
  if (dinnerMatch) document.getElementById('dinner').value = dinnerMatch[1] === '—' ? '' : dinnerMatch[1];
  const workoutMatch = text.match(/💪 Тренировка: (.*)/);
  if (workoutMatch) document.getElementById('workout').value = workoutMatch[1] === '—' ? '' : workoutMatch[1];
  const sleepMatch = text.match(/🌙 Отход ко сну: (.*?) — (.*)/);
  if (sleepMatch) {
    document.getElementById('sleepTime').value = sleepMatch[1] === '—' ? '' : sleepMatch[1];
    document.getElementById('sleepComment').value = sleepMatch[2] === '—' ? '' : sleepMatch[2];
  }

  // Creativity
  const creativityMatch = text.match(/🎨 КРЕАТИВНОСТЬ\n───────────────────────────────────────\n([\s\S]*?)(?=🤝 СОЦИАЛКИ)/);
  if (creativityMatch) {
    let val = creativityMatch[1].trim();
    document.getElementById('creativity').value = val === '—' ? '' : val;
  }

  // Social (now ends before ПРОБЛЕМЫ if present)
  const socialMatch = text.match(/🤝 СОЦИАЛКИ\n───────────────────────────────────────\n([\s\S]*?)(?=⚠️ ПРОБЛЕМЫ|$)/);
  if (socialMatch) {
    let val = socialMatch[1].trim();
    document.getElementById('social').value = val === '—' ? '' : val;
  }

  // Problems
  const problemsMatch = text.match(/⚠️ ПРОБЛЕМЫ\n───────────────────────────────────────\n([\s\S]*?)(?=💡 ИДЕИ И МЫСЛИ|$)/);
  if (problemsMatch) {
    let val = problemsMatch[1].trim();
    document.getElementById('problems').value = val === '—' ? '' : val;
  }

  // Ideas (stop before day final if present)
  const ideasMatch = text.match(/💡 ИДЕИ И МЫСЛИ\n───────────────────────────────────────\n([\s\S]*?)(?=📝 ИТОГ ДНЯ|$)/);
  if (ideasMatch) {
    let val = ideasMatch[1].trim();
    document.getElementById('ideas').value = val === '—' ? '' : val;
  }

  // Day Final
  const dayProgressMatch = text.match(/🚀 Продвижение: ([\s\S]*?)(?=✨ Момент:|$)/);
  if (dayProgressMatch) document.getElementById('dayProgress').value = dayProgressMatch[1].trim() === '—' ? '' : dayProgressMatch[1].trim();
  const dayMomentMatch = text.match(/✨ Момент: ([\s\S]*?)(?=🙈 Избегал:|$)/);
  if (dayMomentMatch) document.getElementById('dayMoment').value = dayMomentMatch[1].trim() === '—' ? '' : dayMomentMatch[1].trim();
  const dayAvoidedMatch = text.match(/🙈 Избегал: ([\s\S]*?)(?=💭 Состояние:|$)/);
  if (dayAvoidedMatch) document.getElementById('dayAvoided').value = dayAvoidedMatch[1].trim() === '—' ? '' : dayAvoidedMatch[1].trim();
  const dayStateMatch = text.match(/💭 Состояние: ([\s\S]*?)(?=📊 ИТОГ НЕДЕЛИ|$)/);
  if (dayStateMatch) document.getElementById('dayState').value = dayStateMatch[1].trim() === '—' ? '' : dayStateMatch[1].trim();

  // Week Final
  const weekExistedMatch = text.match(/🏗️ Что стало существовать: ([\s\S]*?)(?=🎭 Настоящий|$)/);
  if (weekExistedMatch) document.getElementById('weekExisted').value = weekExistedMatch[1].trim() === '—' ? '' : weekExistedMatch[1].trim();
  const weekRealMatch = text.match(/🎭 Настоящий vs версия: ([\s\S]*?)(?=🔧 Что застряло:|$)/);
  if (weekRealMatch) document.getElementById('weekReal').value = weekRealMatch[1].trim() === '—' ? '' : weekRealMatch[1].trim();
  const weekStuckMatch = text.match(/🔧 Что застряло: ([\s\S]*?)(?=📚 Что впитал:|$)/);
  if (weekStuckMatch) document.getElementById('weekStuck').value = weekStuckMatch[1].trim() === '—' ? '' : weekStuckMatch[1].trim();
  const weekAbsorbedMatch = text.match(/📚 Что впитал: ([\s\S]*?)(?=🤝 Живые связи:|$)/);
  if (weekAbsorbedMatch) document.getElementById('weekAbsorbed').value = weekAbsorbedMatch[1].trim() === '—' ? '' : weekAbsorbedMatch[1].trim();
  const weekConnectionsMatch = text.match(/🤝 Живые связи: ([\s\S]*?)(?=🧪 Эксперимент:|$)/);
  if (weekConnectionsMatch) document.getElementById('weekConnections').value = weekConnectionsMatch[1].trim() === '—' ? '' : weekConnectionsMatch[1].trim();
  const weekExperimentMatch = text.match(/🧪 Эксперимент: ([\s\S]*?)$/);
  if (weekExperimentMatch) document.getElementById('weekExperiment').value = weekExperimentMatch[1].trim() === '—' ? '' : weekExperimentMatch[1].trim();

  // Snacks
  const snacksList = document.getElementById('snacksList');
  snacksList.innerHTML = '';
  snackCounter = 0;
  const snackMatches = [...text.matchAll(/🍎 Перекус: (.*)/g)];
  snackMatches.forEach(m => {
    const val = m[1] === '—' ? '' : m[1];
    if (val) addSnackWithData(val);
  });

  // Stimulants
  const stimulantsListEl = document.getElementById('stimulantsList');
  stimulantsListEl.innerHTML = '';
  stimulantCounter = 0;
  const stimulantMatches = [...text.matchAll(/⚡ Стимулятор: (.*?) — (.*)/g)];
  stimulantMatches.forEach(m => {
    const t = m[1] === '—' ? '' : m[1];
    const n = m[2] === '—' ? '' : m[2];
    if (n) addStimulantWithData(t, n);
  });

  // Projects
  const projectsMatch = text.match(/📂 ПРОЕКТЫ\n───────────────────────────────────────\n([\s\S]*?)(?=🎨 КРЕАТИВНОСТЬ)/);
  const projectsList = document.getElementById('projectsList');
  projectsList.innerHTML = '';
  projectCounter = 1;

  if (projectsMatch) {
    const pLines = projectsMatch[1].trim().split('\n');
    let hasProjects = false;
    for (const line of pLines) {
      if (line.startsWith('📌 ') && !line.includes('📌 Без названия: —')) {
        hasProjects = true;
        const lineContent = line.substring(3); // Remove '📌 '
        let parts = lineContent.split(':');
        if(parts.length > 1) {
             const name = parts[0].trim() === 'Без названия' ? '' : parts[0].trim();
             const comment = parts.slice(1).join(':').trim() === '—' ? '' : parts.slice(1).join(':').trim();
             addProjectWithData(name, comment);
        } else {
             addProjectWithData(lineContent.trim(), '');
        }
      }
    }
    if (!hasProjects) {
      addProjectWithData('', '');
    }
  } else {
    addProjectWithData('', '');
  }
}

function addProjectWithData(name, comment) {
  const projectsList = document.getElementById('projectsList');
  const newBlock = document.createElement('div');
  newBlock.className = 'project-block';
  newBlock.dataset.project = projectCounter++;
  newBlock.innerHTML = `
    <button class="project-remove" onclick="removeProject(this)" title="Удалить">✕</button>
    <div class="form-group">
      <label class="form-label"><span class="label-icon">📌</span> Название проекта</label>
      <input type="text" class="form-input project-name" placeholder="Над чем работал?" value="${name.replace(/"/g, '&quot;')}">
    </div>
    <div class="form-group">
      <label class="form-label"><span class="label-icon">💬</span> Что делал</label>
      <textarea class="form-textarea project-comment" placeholder="Детали работы...">${comment}</textarea>
    </div>
  `;
  projectsList.appendChild(newBlock);
}

// ═══ FORM DATA COLLECTION ═══

function collectFormData() {
  const now = new Date();
  const dateStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
  const dayName = DAYS_RU[now.getDay()];
  const readableDate = `${now.getDate()} ${MONTHS_RU[now.getMonth()]} ${now.getFullYear()}`;

  // Morning
  const morningMain = document.getElementById('morningMain').value.trim() || '—';
  const morningFeel = document.getElementById('morningFeel').value.trim() || '—';
  const morningEnergy = document.getElementById('morningEnergy').value.trim() || '—';
  const hasMorning = [morningMain, morningFeel, morningEnergy].some(v => v !== '—');

  // Health
  const wakeTime = document.getElementById('wakeTime').value || '—';
  const wakeComment = document.getElementById('wakeComment').value.trim() || '—';
  const breakfast = document.getElementById('breakfast').value.trim() || '—';
  const lunch = document.getElementById('lunch').value.trim() || '—';
  const dinner = document.getElementById('dinner').value.trim() || '—';
  const workout = document.getElementById('workout').value.trim() || '—';
  const sleepTime = document.getElementById('sleepTime').value || '—';
  const sleepComment = document.getElementById('sleepComment').value.trim() || '—';

  // Snacks
  const snackInputs = document.querySelectorAll('.snack-input');
  let snacksText = '';
  snackInputs.forEach(inp => {
    const v = inp.value.trim();
    if (v) snacksText += `🍎 Перекус: ${v}\n`;
  });

  // Stimulants
  const stimulantItems = document.querySelectorAll('.stimulant-item');
  let stimulantsText = '';
  stimulantItems.forEach(item => {
    const t = item.querySelector('.stimulant-time').value.trim();
    const n = item.querySelector('.stimulant-name').value.trim();
    if (n) stimulantsText += `⚡ Стимулятор: ${t || '—'} — ${n}\n`;
  });

  // Projects
  const projectBlocks = document.querySelectorAll('.project-block');
  let projectsText = '';
  projectBlocks.forEach(block => {
    const name = block.querySelector('.project-name').value.trim();
    const comment = block.querySelector('.project-comment').value.trim();
    if (name || comment) {
      projectsText += `📌 ${name || 'Без названия'}: ${comment || '—'}\n`;
    }
  });
  if (!projectsText) projectsText = '—\n';

  // Creativity
  const creativity = document.getElementById('creativity').value.trim() || '—';

  // Social
  const social = document.getElementById('social').value.trim() || '—';

  // Weekly Goals
  const weeklyGoals = document.getElementById('weeklyGoals').value.trim() || '—';

  // Problems
  const problems = document.getElementById('problems').value.trim() || '—';

  // Ideas
  const ideas = document.getElementById('ideas').value.trim() || '—';

  // Day Final
  const dayProgress = document.getElementById('dayProgress').value.trim() || '—';
  const dayMoment = document.getElementById('dayMoment').value.trim() || '—';
  const dayAvoided = document.getElementById('dayAvoided').value.trim() || '—';
  const dayState = document.getElementById('dayState').value.trim() || '—';
  const hasDayFinal = [dayProgress, dayMoment, dayAvoided, dayState].some(v => v !== '—');

  // Week Final
  const weekExisted = document.getElementById('weekExisted').value.trim() || '—';
  const weekReal = document.getElementById('weekReal').value.trim() || '—';
  const weekStuck = document.getElementById('weekStuck').value.trim() || '—';
  const weekAbsorbed = document.getElementById('weekAbsorbed').value.trim() || '—';
  const weekConnections = document.getElementById('weekConnections').value.trim() || '—';
  const weekExperiment = document.getElementById('weekExperiment').value.trim() || '—';
  const hasWeekFinal = [weekExisted, weekReal, weekStuck, weekAbsorbed, weekConnections, weekExperiment].some(v => v !== '—');

  const morningSection = hasMorning ? `
🌅 УТРО
───────────────────────────────────────
🎯 Главное: ${morningMain}
🌟 Намерение: ${morningFeel}
⚡ Энергия / 🚧 Сопротивление: ${morningEnergy}
` : '';

  const dayFinalSection = hasDayFinal ? `
📝 ИТОГ ДНЯ
───────────────────────────────────────
🚀 Продвижение: ${dayProgress}
✨ Момент: ${dayMoment}
🙈 Избегал: ${dayAvoided}
💭 Состояние: ${dayState}
` : '';

  const weekFinalSection = hasWeekFinal ? `
📊 ИТОГ НЕДЕЛИ
───────────────────────────────────────
🏗️ Что стало существовать: ${weekExisted}
🎭 Настоящий vs версия: ${weekReal}
🔧 Что застряло: ${weekStuck}
📚 Что впитал: ${weekAbsorbed}
🤝 Живые связи: ${weekConnections}
🧪 Эксперимент: ${weekExperiment}
` : '';

  // Build text block
  const entry = `═══════════════════════════════════════
📅 ${dateStr} (${dayName}) — ${readableDate}
═══════════════════════════════════════
${morningSection}
🎯 ЦЕЛИ НА НЕДЕЛЮ
───────────────────────────────────────
${weeklyGoals}

🏥 ЗДОРОВЬЕ
───────────────────────────────────────
⏰ Пробуждение: ${wakeTime} — ${wakeComment}
🍳 Завтрак: ${breakfast}
🥗 Обед: ${lunch}
🍽️ Ужин: ${dinner}
${snacksText}${stimulantsText}💪 Тренировка: ${workout}
🌙 Отход ко сну: ${sleepTime} — ${sleepComment}

📂 ПРОЕКТЫ
───────────────────────────────────────
${projectsText}
🎨 КРЕАТИВНОСТЬ
───────────────────────────────────────
${creativity}

🤝 СОЦИАЛКИ
───────────────────────────────────────
${social}

⚠️ ПРОБЛЕМЫ
───────────────────────────────────────
${problems}

💡 ИДЕИ И МЫСЛИ
───────────────────────────────────────
${ideas}
${dayFinalSection}${weekFinalSection}
`;

  return { dateStr, entry };
}

// ═══ SUBMIT ═══

async function submitDay() {
  if (!fileHandle) {
    showToast('⚠️ Сначала выберите папку для данных', 'error');
    showModal();
    return;
  }

  const btn = document.getElementById('submitBtn');
  btn.disabled = true;
  btn.innerHTML = '<span>⏳</span> Сохраняю...';

  const { dateStr, entry } = collectFormData();

  // Reload latest data from file without touching the form
  await loadTrackingData(false);

  // Parse blocks
  const blocks = extractDailyBlocks(trackingData);
  const existingIndex = blocks.findIndex(b => b.dateStr === dateStr);

  // Replace or prepend
  if (existingIndex !== -1) {
    blocks[existingIndex].fullText = entry.trim();
  } else {
    blocks.unshift({ dateStr, fullText: entry.trim() });
  }

  // Rebuild
  trackingData = blocks.map(b => b.fullText).join('\n\n') + '\n\n';

  const success = await writeTrackingData(trackingData);

  if (success) {
    btn.classList.add('success');
    btn.innerHTML = '<span>✅</span> Сохранено!';
    showToast('✅ День успешно сохранён (можно дозаполнять)', 'success');
    updateWeekGrid();
    updateStreak();

    setTimeout(() => {
      btn.classList.remove('success');
      btn.innerHTML = '<span>💾</span> Сохранить день';
      btn.disabled = false;
    }, 2000);
  } else {
    btn.innerHTML = '<span>💾</span> Сохранить день';
    btn.disabled = false;
  }
}

// ═══ FORM HELPERS ═══

function clearForm() {
  document.getElementById('morningMain').value = '';
  document.getElementById('morningFeel').value = '';
  document.getElementById('morningEnergy').value = '';
  document.getElementById('wakeTime').value = '';
  document.getElementById('wakeComment').value = '';
  document.getElementById('breakfast').value = '';
  document.getElementById('lunch').value = '';
  document.getElementById('dinner').value = '';
  document.getElementById('workout').value = '';
  document.getElementById('sleepTime').value = '';
  document.getElementById('sleepComment').value = '';
  document.getElementById('creativity').value = '';
  document.getElementById('social').value = '';
  document.getElementById('weeklyGoals').value = '';
  document.getElementById('problems').value = '';
  document.getElementById('ideas').value = '';
  document.getElementById('dayProgress').value = '';
  document.getElementById('dayMoment').value = '';
  document.getElementById('dayAvoided').value = '';
  document.getElementById('dayState').value = '';
  document.getElementById('weekExisted').value = '';
  document.getElementById('weekReal').value = '';
  document.getElementById('weekStuck').value = '';
  document.getElementById('weekAbsorbed').value = '';
  document.getElementById('weekConnections').value = '';
  document.getElementById('weekExperiment').value = '';
  document.getElementById('snacksList').innerHTML = '';
  snackCounter = 0;
  document.getElementById('stimulantsList').innerHTML = '';
  stimulantCounter = 0;

  // Reset projects to single empty one
  const projectsList = document.getElementById('projectsList');
  projectsList.innerHTML = `
    <div class="project-block" data-project="0">
      <button class="project-remove" onclick="removeProject(this)" title="Удалить">✕</button>
      <div class="form-group">
        <label class="form-label"><span class="label-icon">📌</span> Название проекта</label>
        <input type="text" class="form-input project-name" placeholder="Над чем работал?">
      </div>
      <div class="form-group">
        <label class="form-label"><span class="label-icon">💬</span> Что делал</label>
        <textarea class="form-textarea project-comment" placeholder="Детали работы..."></textarea>
      </div>
    </div>
  `;
  projectCounter = 1;
}

function addProject() {
  const projectsList = document.getElementById('projectsList');
  const newBlock = document.createElement('div');
  newBlock.className = 'project-block';
  newBlock.dataset.project = projectCounter++;
  newBlock.innerHTML = `
    <button class="project-remove" onclick="removeProject(this)" title="Удалить">✕</button>
    <div class="form-group">
      <label class="form-label"><span class="label-icon">📌</span> Название проекта</label>
      <input type="text" class="form-input project-name" placeholder="Над чем работал?">
    </div>
    <div class="form-group">
      <label class="form-label"><span class="label-icon">💬</span> Что делал</label>
      <textarea class="form-textarea project-comment" placeholder="Детали работы..."></textarea>
    </div>
  `;
  projectsList.appendChild(newBlock);
}

function removeProject(btn) {
  const block = btn.closest('.project-block');
  const list = document.getElementById('projectsList');
  if (list.children.length > 1) {
    block.style.opacity = '0';
    block.style.transform = 'translateY(-8px)';
    setTimeout(() => block.remove(), 200);
  }
}

// ═══ STATISTICS ═══

function getEntryDates() {
  const dates = [];
  const regex = /📅\s(\d{4}-\d{2}-\d{2})/g;
  let match;
  while ((match = regex.exec(trackingData)) !== null) {
    dates.push(match[1]);
  }
  return dates;
}

function updateWeekGrid() {
  const grid = document.getElementById('weekGrid');
  const today = new Date();
  const entryDates = getEntryDates();

  // Get Monday of current week
  const monday = new Date(today);
  const dayOfWeek = today.getDay();
  const diff = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  monday.setDate(today.getDate() + diff);

  let html = '';
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    const dateStr = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    const isToday = dateStr === `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
    const isFilled = entryDates.includes(dateStr);

    let dotClass = 'week-day-dot';
    if (isToday) dotClass += ' today';
    if (isFilled) dotClass += ' filled';
    if (!isFilled) dotClass += ' empty';

    html += `
      <div class="week-day">
        <span class="week-day-label">${DAYS_SHORT_RU[(i + 1) % 7]}</span>
        <div class="${dotClass}">
          ${isFilled ? '✓' : d.getDate()}
        </div>
      </div>
    `;
  }
  grid.innerHTML = html;
}

function updateStreak() {
  const entryDates = getEntryDates();
  if (entryDates.length === 0) {
    document.getElementById('streakCount').textContent = '0';
    return;
  }

  // Sort dates descending
  const sorted = [...new Set(entryDates)].sort().reverse();
  let streak = 0;
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  for (let i = 0; i < sorted.length; i++) {
    const expected = new Date(today);
    expected.setDate(today.getDate() - i);
    const expectedStr = `${expected.getFullYear()}-${String(expected.getMonth()+1).padStart(2,'0')}-${String(expected.getDate()).padStart(2,'0')}`;

    if (sorted.includes(expectedStr)) {
      streak++;
    } else {
      break;
    }
  }

  document.getElementById('streakCount').textContent = streak;
}

// ═══ AI + CHAT ═══

const OLLAMA_URL = 'http://localhost:11434';
const OLLAMA_MODEL = 'qwen2.5-coder:14b';

const GEMINI_API_KEY = 'AIzaSyAGTz80Xtjcb3RCMvsfV9vpnBKsmu2GXSk';
const GEMINI_MODEL = 'gemini-3.1-flash-lite-preview';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:streamGenerateContent?alt=sse&key=${GEMINI_API_KEY}`;

// Active provider: 'ollama' | 'gemini'
let currentProvider = localStorage.getItem('feigin_provider') || 'ollama';

const SYSTEM_PROMPT = `Ты — личный аналитик дня для трекера FEIGIN TRACK. Отвечаешь только на русском языке.

Правила:
- Пятница (שישי) и суббота (שבת / Шабат) — дни отдыха и восстановления. Отсутствие тренировок, проектов и активности в эти дни — это НОРМА, не критикуй это.
- При анализе дня всегда структурируй ответ по двум блокам:
  ✅ Позитивные аспекты
  ⚠️ Точки роста (негативные аспекты или пробелы)
- Не давай советов если не просят — только анализ фактов
- Не пересказывай то, что пользователь сам написал — давай только выводы и инсайты
- Отвечай кратко, используй эмодзи и списки`;

// ── Chat state ──
let chatMessages = [];
let isChatBusy = false;

function dateKey(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() - offsetDays);
  return `feigin_chat_${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function getChatKey() { return dateKey(0); }

function saveChatHistory() {
  localStorage.setItem(getChatKey(), JSON.stringify(chatMessages));
}

function loadChatHistory() {
  // Load today + last 2 days so recent messages are never lost
  let combined = [];
  for (let i = 2; i >= 0; i--) {
    const saved = localStorage.getItem(dateKey(i));
    if (saved) {
      try {
        const msgs = JSON.parse(saved);
        if (i > 0 && msgs.length > 0) {
          // Add a date separator for past days
          const d = new Date();
          d.setDate(d.getDate() - i);
          combined.push({ role: 'separator', content: `── ${d.getDate()} ${MONTHS_RU[d.getMonth()]} ──`, time: '' });
        }
        combined = combined.concat(msgs);
      } catch (e) {}
    }
  }
  chatMessages = JSON.parse(localStorage.getItem(getChatKey()) || '[]');
  renderAllMessages(combined);
}

function renderAllMessages(allMsgs) {
  const msgs = allMsgs || chatMessages;
  const el = document.getElementById('chatMessages');
  el.innerHTML = '';
  if (msgs.length === 0) {
    el.innerHTML = '<div class="chat-empty">Напиши что-нибудь или нажми<br>«Анализировать день»</div>';
    return;
  }
  msgs.forEach(m => renderMessage(m));
}

function nowTime() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}

function renderMessage(msg, animate = false) {
  const el = document.getElementById('chatMessages');
  const empty = el.querySelector('.chat-empty');
  if (empty) empty.remove();

  if (msg.role === 'separator') {
    const sep = document.createElement('div');
    sep.className = 'chat-separator';
    sep.textContent = msg.content;
    el.appendChild(sep);
    return sep;
  }

  const div = document.createElement('div');
  div.className = `chat-message ${msg.role}${animate ? ' new' : ''}`;
  div.innerHTML = `<div class="chat-bubble"></div><div class="chat-time">${msg.time}</div>`;
  div.querySelector('.chat-bubble').textContent = msg.content;
  el.appendChild(div);
  el.scrollTop = el.scrollHeight;
  return div;
}


function buildSystemContext() {
  const now = new Date();
  const day = now.getDay();
  const dateStr = `${now.getDate()} ${MONTHS_RU[now.getMonth()]} ${now.getFullYear()}`;
  const dayName = DAYS_RU[day];
  const shabbatNote = (day === 5 || day === 6)
    ? '\nСегодня Шабат — день отдыха и восстановления. Оцени его как таковой, не критикуй отсутствие активности.'
    : '';
  const todayData = getTodayData();
  return `${SYSTEM_PROMPT}${shabbatNote}\n\nТЕКУЩАЯ ДАТА: ${dateStr} (${dayName})\n\nДанные трекера за сегодня (${dateStr}):\n${todayData}`;
}

async function streamOllama(prompt, bubbleEl, panelEl) {
  const response = await fetch(`${OLLAMA_URL}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: OLLAMA_MODEL, prompt, stream: true })
  });
  if (!response.ok) throw new Error(`Ollama ошибка ${response.status}`);

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '', result = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const json = JSON.parse(line);
        if (json.response) {
          result += json.response;
          bubbleEl.textContent = result;
          panelEl.scrollTop = panelEl.scrollHeight;
        }
      } catch (e) {}
    }
  }
  return result;
}

async function streamGemini(userText, bubbleEl, panelEl) {
  const systemContext = buildSystemContext();
  const contents = [];

  // Always inject system context + today's data as a synthetic opening turn
  contents.push({ role: 'user', parts: [{ text: systemContext }] });
  contents.push({ role: 'model', parts: [{ text: 'Понял, готов анализировать.' }] });

  // Add conversation history (skip separators and the last user msg we just added)
  const history = chatMessages.slice(0, -1);
  for (const msg of history) {
    if (msg.role === 'separator') continue;
    contents.push({
      role: msg.role === 'user' ? 'user' : 'model',
      parts: [{ text: msg.content }]
    });
  }

  // Current user message
  contents.push({ role: 'user', parts: [{ text: userText }] });

  const response = await fetch(GEMINI_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents })
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(`Gemini ошибка ${response.status}: ${err?.error?.message || ''}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '', result = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const jsonStr = line.slice(6).trim();
      if (!jsonStr || jsonStr === '[DONE]') continue;
      try {
        const json = JSON.parse(jsonStr);
        const text = json?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text) {
          result += text;
          bubbleEl.textContent = result;
          panelEl.scrollTop = panelEl.scrollHeight;
        }
      } catch (e) {}
    }
  }
  return result;
}

async function sendChatMessage(userText) {
  if (!userText.trim() || isChatBusy) return;
  isChatBusy = true;
  document.getElementById('chatSendBtn').disabled = true;

  // Always reload tracking data so AI sees latest saved info (without touching form)
  if (fileHandle) await loadTrackingData(false);

  const userMsg = { role: 'user', content: userText.trim(), time: nowTime() };
  chatMessages.push(userMsg);
  renderMessage(userMsg, true);
  saveChatHistory();
  document.getElementById('chatInput').value = '';

  // Typing indicator
  const panel = document.getElementById('chatMessages');
  const typingDiv = document.createElement('div');
  typingDiv.className = 'chat-message assistant typing';
  typingDiv.innerHTML = '<div class="chat-bubble">●●●</div>';
  panel.appendChild(typingDiv);
  panel.scrollTop = panel.scrollHeight;
  const bubble = typingDiv.querySelector('.chat-bubble');
  bubble.textContent = '';

  let fullResponse = '';
  try {
    if (currentProvider === 'gemini') {
      fullResponse = await streamGemini(userText.trim(), bubble, panel);
    } else {
      // Build Ollama prompt with full conversation history
      const ctx = buildSystemContext();
      const historyText = chatMessages.slice(0, -1)
        .filter(m => m.role !== 'separator')
        .map(m => `${m.role === 'user' ? 'Пользователь' : 'Аналитик'}: ${m.content}`)
        .join('\n\n');
      const fullPrompt = `${ctx}\n\n${historyText ? historyText + '\n\n' : ''}Пользователь: ${userText.trim()}\nАналитик:`;
      fullResponse = await streamOllama(fullPrompt, bubble, panel);
    }
  } catch (e) {
    fullResponse = `❌ Ошибка: ${e.message}`;
    bubble.textContent = fullResponse;
  }

  typingDiv.remove();
  const assistantMsg = { role: 'assistant', content: fullResponse, time: nowTime() };
  chatMessages.push(assistantMsg);
  renderMessage(assistantMsg, true);
  saveChatHistory();

  isChatBusy = false;
  document.getElementById('chatSendBtn').disabled = false;
}

// Send button
document.getElementById('chatSendBtn').addEventListener('click', () => {
  sendChatMessage(document.getElementById('chatInput').value);
});

// Enter to send (Shift+Enter = newline)
document.getElementById('chatInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendChatMessage(document.getElementById('chatInput').value);
  }
});

// Analyze day button
document.getElementById('aiDayBtn').addEventListener('click', async () => {
  if (!fileHandle) {
    showToast('⚠️ Сначала подключите файл данных', 'error');
    return;
  }
  await loadTrackingData();
  const todayData = getTodayData();
  if (todayData === 'Нет данных за сегодня') {
    showToast('📭 Нет данных за сегодня. Заполните что-то и сохраните.', 'info');
    return;
  }
  document.getElementById('aiRightPanel').classList.add('open');
  const btn = document.getElementById('aiDayBtn');
  btn.classList.add('loading');
  btn.innerHTML = '<span class="ai-btn-icon">⏳</span><span>Анализирую...</span>';
  await sendChatMessage(`Проанализируй мой сегодняшний день. Выдели ✅ позитивные аспекты и ⚠️ точки роста.\n\n${todayData}`);
  btn.classList.remove('loading');
  btn.innerHTML = '<span class="ai-btn-icon">⚡</span><span>Анализировать день</span>';
});

// Analyze week button
document.getElementById('aiWeekBtn').addEventListener('click', async () => {
  if (!fileHandle) {
    showToast('⚠️ Сначала подключите файл данных', 'error');
    return;
  }
  await loadTrackingData();
  const weekData = getLastWeekData();
  if (weekData === 'Нет данных' || weekData === 'Нет данных за последнюю неделю') {
    showToast('📭 Нет данных за последнюю неделю', 'info');
    return;
  }
  document.getElementById('aiRightPanel').classList.add('open');
  const btn = document.getElementById('aiWeekBtn');
  btn.classList.add('loading');
  btn.innerHTML = '<span class="ai-btn-icon">⏳</span><span>Анализирую...</span>';
  await sendChatMessage(`Проанализируй мою неделю по всем 4 сферам. Выдели ✅ позитивные аспекты и ⚠️ точки роста по каждой сфере.\n\nДанные за неделю:\n${weekData}`);
  btn.classList.remove('loading');
  btn.innerHTML = '<span class="ai-btn-icon">📊</span><span>Анализ недели</span>';
});

// Panel close/open
document.getElementById('aiCloseBtn').addEventListener('click', () => {
  document.getElementById('aiRightPanel').classList.remove('open');
  localStorage.setItem('feigin_chat_panel_open', '0');
});

// Ollama status check
async function checkOllamaStatus() {
  const statusEl = document.getElementById('ollamaStatus');
  const statusText = document.getElementById('ollamaStatusText');
  try {
    const res = await fetch(`${OLLAMA_URL}/api/tags`);
    if (res.ok) {
      statusEl.className = 'status-indicator connected';
      statusText.textContent = `Ollama ✓ ${OLLAMA_MODEL}`;
    } else {
      statusEl.className = 'status-indicator disconnected';
      statusText.textContent = 'Ollama — ошибка';
    }
  } catch (e) {
    statusEl.className = 'status-indicator disconnected';
    statusText.textContent = 'Ollama не запущена';
  }
}

function getYesterdayData() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  const dateStr = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  const blocks = extractDailyBlocks(trackingData);
  const block = blocks.find(b => b.dateStr === dateStr);
  if (!block) return null;
  return { dateStr, dateLabel: `${d.getDate()} ${MONTHS_RU[d.getMonth()]} ${d.getFullYear()}`, fullText: block.fullText };
}

async function checkMorningReview() {
  const now = new Date();
  const todayStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
  const reviewKey = `feigin_morning_review_${todayStr}`;

  if (localStorage.getItem(reviewKey)) return;  // already done today

  const yesterday = getYesterdayData();
  if (!yesterday) return;  // no data for yesterday

  localStorage.setItem(reviewKey, '1');

  // Brief delay so user orients first
  await new Promise(r => setTimeout(r, 1800));

  document.getElementById('aiRightPanel').classList.add('open');
  localStorage.setItem('feigin_chat_panel_open', '1');

  await sendChatMessage(
`🌅 Утренний обзор — ${yesterday.dateLabel}

Проанализируй мой вчерашний день и помоги настроиться на сегодня:

1. **Что хорошо прошло вчера** — отметь конкретные успехи
2. **Что осталось незавершённым** — что стоит продолжить или закрыть сегодня
3. **3 конкретные рекомендации на сегодня** — на основе вчерашних данных, паттернов и незакрытых вопросов

Данные за вчера (${yesterday.dateLabel}):
${yesterday.fullText}`
  );
}

function getTodayData() {
  const now = new Date();
  const dateStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
  const blocks = extractDailyBlocks(trackingData);
  const todayBlock = blocks.find(b => b.dateStr === dateStr);
  return todayBlock ? todayBlock.fullText : 'Нет данных за сегодня';
}

function getLastWeekData() {
  const blocks = extractDailyBlocks(trackingData);
  if (blocks.length === 0) return 'Нет данных';
  const today = new Date();
  const weekAgo = new Date(today);
  weekAgo.setDate(today.getDate() - 7);
  const weekBlocks = blocks.filter(b => {
    const d = new Date(b.dateStr);
    return d >= weekAgo && d <= today;
  });
  return weekBlocks.length > 0
    ? weekBlocks.map(b => b.fullText).join('\n\n---\n\n')
    : 'Нет данных за последнюю неделю';
}

// ═══ HISTORY RENDERER ═══

function renderHistoryList() {
  const listEl = document.getElementById('historyList');
  const viewEl = document.getElementById('historyEntryView');
  const blocks = extractDailyBlocks(trackingData);
  
  if (blocks.length === 0) {
    listEl.innerHTML = '<div style="padding: 16px; color: var(--text-muted);">Нет записей</div>';
    viewEl.innerHTML = '<div class="history-empty-state"><span class="icon">📭</span><p>У вас ещё нет сохранённых дней</p></div>';
    return;
  }
  
  // Sort descending by date
  blocks.sort((a, b) => new Date(b.dateStr) - new Date(a.dateStr));
  
  listEl.innerHTML = blocks.map((b, i) => {
    const d = new Date(b.dateStr);
    const dateStr = `${d.getDate()} ${MONTHS_RU[d.getMonth()]} ${d.getFullYear()}`;
    const dayName = DAYS_RU[d.getDay()];
    return `
      <div class="history-list-item ${i === 0 ? 'active' : ''}" data-date="${b.dateStr}" onclick="showHistoryEntry('${b.dateStr}')">
        <div class="h-date">${dateStr}</div>
        <div class="h-day">${dayName}</div>
      </div>
    `;
  }).join('');
  
  // Select first item by default
  if (blocks.length > 0) {
    showHistoryEntry(blocks[0].dateStr);
  }
}

window.showHistoryEntry = function(dateStr) {
  // Update active state
  document.querySelectorAll('.history-list-item').forEach(el => {
    if (el.dataset.date === dateStr) {
      el.classList.add('active');
    } else {
      el.classList.remove('active');
    }
  });
  
  const blocks = extractDailyBlocks(trackingData);
  const block = blocks.find(b => b.dateStr === dateStr);
  const viewEl = document.getElementById('historyEntryView');
  
  if (block) {
    viewEl.innerHTML = `<div>${block.fullText.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>`;
  }
};

// AI Panel Close Logic
document.getElementById('aiCloseBtn').addEventListener('click', () => {
  document.getElementById('aiRightPanel').classList.remove('open');
});

// ═══ UI HELPERS ═══

function showModal() {
  document.getElementById('modalOverlay').classList.add('show');
}

function hideModal() {
  document.getElementById('modalOverlay').classList.remove('show');
}

function showToast(message, type = 'success') {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.className = `toast ${type} show`;

  setTimeout(() => {
    toast.classList.remove('show');
  }, 3000);
}

// ═══ EXPORT ACTIONS ═══

async function copyTodayData() {
  const data = getTodayData();
  if (data === 'Нет данных за сегодня') {
    showToast('📭 Нет данных за сегодня', 'info');
    return;
  }
  try {
    await navigator.clipboard.writeText(data);
    showToast('📋 Копия на сегодня сделана!', 'success');
  } catch (err) {
    showToast('❌ Ошибка копирования', 'error');
  }
}

async function copyWeekData() {
  const data = getLastWeekData();
  if (data === 'Нет данных за последнюю неделю' || data === 'Нет данных') {
    showToast('📭 Нет данных за неделю', 'info');
    return;
  }
  try {
    await navigator.clipboard.writeText(data);
    showToast('📋 Копия за неделю сделана!', 'success');
  } catch (err) {
    showToast('❌ Ошибка копирования', 'error');
  }
}

// ═══ SNACKS ═══

function addSnack() {
  addSnackWithData('');
}

function addSnackWithData(value) {
  const list = document.getElementById('snacksList');
  const div = document.createElement('div');
  div.className = 'snack-item';
  div.dataset.snack = snackCounter++;
  div.innerHTML = `
    <input type="text" class="form-input snack-input" placeholder="🍎 Перекус..." value="${value.replace(/"/g, '&quot;')}">
    <button class="snack-remove" onclick="removeSnack(this)" title="Удалить">✕</button>
  `;
  list.appendChild(div);
}

function removeSnack(btn) {
  btn.closest('.snack-item').remove();
}

// ═══ STIMULANTS ═══

let stimulantCounter = 0;

function addStimulant() {
  addStimulantWithData('', '');
}

function addStimulantWithData(time, name) {
  const list = document.getElementById('stimulantsList');
  const div = document.createElement('div');
  div.className = 'snack-item stimulant-item';
  div.dataset.stimulant = stimulantCounter++;
  div.innerHTML = `
    <input type="text" class="form-input stimulant-time" placeholder="Время" value="${time.replace(/"/g, '&quot;')}" style="max-width:110px;flex-shrink:0">
    <input type="text" class="form-input stimulant-name" placeholder="Что? (кофе, матча, энергетик...)" value="${name.replace(/"/g, '&quot;')}">
    <button class="snack-remove" onclick="removeStimulant(this)" title="Удалить">✕</button>
  `;
  list.appendChild(div);
}

function removeStimulant(btn) {
  btn.closest('.stimulant-item').remove();
}

// ═══ CARDS GALLERY ═══

const CARD_TYPE_INFO = {
  ideas:      { icon: '💡', label: 'Идея' },
  problems:   { icon: '⚠️', label: 'Проблема' },
  goals:      { icon: '🎯', label: 'Цели' },
  progress:   { icon: '🚀', label: 'Прогресс' },
  moment:     { icon: '✨', label: 'Момент' },
  experiment: { icon: '🧪', label: 'Эксперимент' },
};

const CARDS_FILTERS = [
  { key: 'all',        icon: '✦',  label: 'Все' },
  { key: 'ideas',      icon: '💡', label: 'Идеи' },
  { key: 'problems',   icon: '⚠️', label: 'Проблемы' },
  { key: 'goals',      icon: '🎯', label: 'Цели' },
  { key: 'progress',   icon: '🚀', label: 'Прогресс' },
  { key: 'moment',     icon: '✨', label: 'Моменты' },
  { key: 'experiment', icon: '🧪', label: 'Эксперименты' },
];

let activeCardsFilter = 'all';

function extractAllCards() {
  const blocks = extractDailyBlocks(trackingData);
  const cards = [];
  const SEP = '───────────────────────────────────────';

  blocks.forEach(block => {
    const d = new Date(block.dateStr);
    const dateLabel = `${d.getDate()} ${MONTHS_RU[d.getMonth()]} ${d.getFullYear()}`;
    const t = block.fullText;

    const push = (type, val) => {
      const v = (val || '').trim();
      if (v && v !== '—') cards.push({ type, date: block.dateStr, dateLabel, content: v });
    };

    const sec = (header, nextHeader) => {
      const rx = new RegExp(header + '\\n' + SEP + '\\n([\\s\\S]*?)(?=' + nextHeader + '|$)');
      const m = t.match(rx);
      return m ? m[1].trim() : null;
    };

    push('ideas',    sec('💡 ИДЕИ И МЫСЛИ',    '📝 ИТОГ'));
    push('problems', sec('⚠️ ПРОБЛЕМЫ',         '💡 ИДЕИ'));
    push('goals',    sec('🎯 ЦЕЛИ НА НЕДЕЛЮ',   '\n🏥'));

    const pm = t.match(/🚀 Продвижение: ([\s\S]*?)(?=✨ Момент:|$)/);
    if (pm) push('progress', pm[1]);
    const mm = t.match(/✨ Момент: ([\s\S]*?)(?=🙈 Избегал:|$)/);
    if (mm) push('moment', mm[1]);
    const em = t.match(/🧪 Эксперимент: ([\s\S]*?)$/);
    if (em) push('experiment', em[1]);
  });

  return cards.sort((a, b) => new Date(b.date) - new Date(a.date));
}

function renderCardsGallery() {
  const filtersEl = document.getElementById('cardsFilters');
  const gridEl = document.getElementById('cardsGridArea');
  const cards = extractAllCards();

  // Filters
  filtersEl.innerHTML = CARDS_FILTERS.map(f => {
    const cnt = f.key === 'all' ? cards.length : cards.filter(c => c.type === f.key).length;
    if (cnt === 0 && f.key !== 'all') return '';
    return `<button class="cards-filter-btn ${activeCardsFilter === f.key ? 'active' : ''}" data-filter="${f.key}">
      ${f.icon} ${f.label} <span class="cards-filter-count">${cnt}</span>
    </button>`;
  }).join('');

  filtersEl.querySelectorAll('.cards-filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      activeCardsFilter = btn.dataset.filter;
      renderCardsGallery();
    });
  });

  // Cards
  const filtered = activeCardsFilter === 'all' ? cards : cards.filter(c => c.type === activeCardsFilter);

  if (filtered.length === 0) {
    gridEl.innerHTML = `<div class="cards-empty"><span>✦</span><p>Нет записей в этой категории</p></div>`;
    return;
  }

  gridEl.innerHTML = filtered.map((card, i) => {
    const info = CARD_TYPE_INFO[card.type] || { icon: '•', label: card.type };
    const safe = card.content.replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return `<div class="knowledge-card ${card.type}" style="animation-delay:${i * 0.03}s" onclick="this.classList.toggle('expanded')">
      <div class="card-type-badge">${info.icon} ${info.label}</div>
      <div class="card-content-text">${safe}</div>
      <div class="card-date-tag">${card.dateLabel}</div>
    </div>`;
  }).join('');
}

document.getElementById('morningFabBtn').addEventListener('click', async () => {
  if (!fileHandle) {
    showToast('⚠️ Сначала подключите файл данных', 'error');
    return;
  }
  await loadTrackingData(false);
  const yesterday = getYesterdayData();
  if (!yesterday) {
    showToast('📭 Нет записи за вчера', 'info');
    return;
  }
  document.getElementById('aiRightPanel').classList.add('open');
  localStorage.setItem('feigin_chat_panel_open', '1');
  await sendChatMessage(
`🌅 Утренний обзор — ${yesterday.dateLabel}

Проанализируй мой вчерашний день и помоги настроиться на сегодня:

1. **Что хорошо прошло вчера** — отметь конкретные успехи
2. **Что осталось незавершённым** — что стоит продолжить или закрыть сегодня
3. **3 конкретные рекомендации на сегодня** — на основе вчерашних данных, паттернов и незакрытых вопросов

Данные за вчера (${yesterday.dateLabel}):
${yesterday.fullText}`
  );
});

document.getElementById('cardsFabBtn').addEventListener('click', () => {
  activeCardsFilter = 'all';
  document.getElementById('cardsOverlay').classList.add('show');
  renderCardsGallery();
});

document.getElementById('cardsCloseBtn').addEventListener('click', () => {
  document.getElementById('cardsOverlay').classList.remove('show');
});

document.getElementById('cardsOverlay').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) document.getElementById('cardsOverlay').classList.remove('show');
});

// ═══ FINAL FORMS ═══

function openMorningFinal() {
  document.getElementById('morningFinalOverlay').classList.add('show');
}
function closeMorningFinal() {
  document.getElementById('morningFinalOverlay').classList.remove('show');
}

function openDayFinal() {
  document.getElementById('dayFinalOverlay').classList.add('show');
}
function closeDayFinal() {
  document.getElementById('dayFinalOverlay').classList.remove('show');
}
function openWeekFinal() {
  document.getElementById('weekFinalOverlay').classList.add('show');
}
function closeWeekFinal() {
  document.getElementById('weekFinalOverlay').classList.remove('show');
}

// ═══ MAP ═══

let selectedMapDate = null;

function renderMap() {
  const container = document.getElementById('mapSvgContainer');
  const blocks = extractDailyBlocks(trackingData);

  if (blocks.length === 0) {
    container.innerHTML = '<div class="map-empty-state"><span>🗺️</span><p>Нет записей. Сохраните хотя бы один день.</p></div>';
    return;
  }

  const sorted = [...blocks].sort((a, b) => new Date(a.dateStr) - new Date(b.dateStr));

  const COLS = 5;
  const NODE_R = 32;
  const SPACING_X = 115;
  const SPACING_Y = 115;
  const PAD_X = 58;
  const PAD_Y = 58;

  const positions = sorted.map((block, i) => {
    const row = Math.floor(i / COLS);
    const col = i % COLS;
    const actualCol = row % 2 === 0 ? col : (COLS - 1 - col);
    return {
      x: PAD_X + actualCol * SPACING_X,
      y: PAD_Y + row * SPACING_Y,
      block
    };
  });

  const totalRows = Math.ceil(sorted.length / COLS);
  const usedCols = Math.min(sorted.length, COLS);
  const SVG_W = PAD_X * 2 + (usedCols - 1) * SPACING_X;
  const SVG_H = Math.max(300, PAD_Y * 2 + (totalRows - 1) * SPACING_Y);

  let svg = `<svg viewBox="0 0 ${SVG_W} ${SVG_H}" preserveAspectRatio="xMidYMid meet"
    xmlns="http://www.w3.org/2000/svg" style="width:100%;height:100%;display:block">
    <defs>
      <radialGradient id="mgNormal" cx="40%" cy="35%" r="65%">
        <stop offset="0%" stop-color="#c4b5fd"/>
        <stop offset="100%" stop-color="#5b21b6"/>
      </radialGradient>
      <radialGradient id="mgSelected" cx="40%" cy="35%" r="65%">
        <stop offset="0%" stop-color="#fde68a"/>
        <stop offset="100%" stop-color="#d97706"/>
      </radialGradient>
      <radialGradient id="mgShabbat" cx="40%" cy="35%" r="65%">
        <stop offset="0%" stop-color="#6ee7b7"/>
        <stop offset="100%" stop-color="#047857"/>
      </radialGradient>
      <filter id="glow" x="-60%" y="-60%" width="220%" height="220%">
        <feGaussianBlur stdDeviation="4" result="blur"/>
        <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
      </filter>
      <filter id="glowSel" x="-60%" y="-60%" width="220%" height="220%">
        <feGaussianBlur stdDeviation="7" result="blur"/>
        <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
      </filter>
    </defs>`;

  // Lines
  for (let i = 0; i < positions.length - 1; i++) {
    const p1 = positions[i], p2 = positions[i + 1];
    svg += `<line x1="${p1.x}" y1="${p1.y}" x2="${p2.x}" y2="${p2.y}"
      stroke="rgba(167,139,250,0.22)" stroke-width="1.5" stroke-dasharray="6 5"/>`;
  }

  // Nodes
  positions.forEach((pos) => {
    const isSelected = pos.block.dateStr === selectedMapDate;
    const d = new Date(pos.block.dateStr);
    const dow = d.getDay();
    const isShabbat = dow === 5 || dow === 6;
    const gradId = isSelected ? 'mgSelected' : (isShabbat ? 'mgShabbat' : 'mgNormal');
    const filterId = isSelected ? 'glowSel' : 'glow';
    const r = isSelected ? NODE_R + 4 : NODE_R;
    const dayLabel = `${d.getDate()} ${MONTHS_RU[d.getMonth()].slice(0, 3)}`;
    const dowLabel = DAYS_SHORT_RU[d.getDay()];

    svg += `<g class="map-node" data-date="${pos.block.dateStr}" style="cursor:pointer">`;
    if (isSelected) {
      svg += `<circle cx="${pos.x}" cy="${pos.y}" r="${r + 8}" fill="none" stroke="rgba(251,191,36,0.35)" stroke-width="2"/>`;
    }
    svg += `<circle cx="${pos.x}" cy="${pos.y}" r="${r}" fill="url(#${gradId})" filter="url(#${filterId})" opacity="0.92"/>`;
    svg += `<text x="${pos.x}" y="${pos.y - 5}" text-anchor="middle"
      fill="white" font-size="11" font-weight="700" font-family="Inter,sans-serif">${dayLabel}</text>`;
    svg += `<text x="${pos.x}" y="${pos.y + 11}" text-anchor="middle"
      fill="rgba(255,255,255,0.75)" font-size="9" font-family="Inter,sans-serif">${dowLabel}</text>`;
    svg += `</g>`;
  });

  svg += '</svg>';
  container.innerHTML = svg;

  container.querySelectorAll('.map-node').forEach(node => {
    node.addEventListener('click', () => selectMapNode(node.dataset.date));
  });
}

function selectMapNode(dateStr) {
  selectedMapDate = dateStr;

  const blocks = extractDailyBlocks(trackingData);
  const block = blocks.find(b => b.dateStr === dateStr);
  if (!block) return;

  const panel = document.getElementById('mapDetailPanel');
  const dateEl = document.getElementById('mapDetailDate');
  const contentEl = document.getElementById('mapDetailContent');

  const d = new Date(dateStr);
  dateEl.textContent = `${d.getDate()} ${MONTHS_RU[d.getMonth()]} ${d.getFullYear()} — ${DAYS_RU[d.getDay()]}`;
  contentEl.textContent = block.fullText;

  panel.classList.add('open');
  renderMap();
}

document.getElementById('mapDetailClose').addEventListener('click', () => {
  document.getElementById('mapDetailPanel').classList.remove('open');
  selectedMapDate = null;
  renderMap();
});
