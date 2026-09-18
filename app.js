// ---------- tiny IndexedDB wrapper ----------
const DB_NAME = 'ironlog';
let db;
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = (e) => {
      const d = e.target.result;
      if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv');
      if (!d.objectStoreNames.contains('history')) d.createObjectStore('history', { autoIncrement: true });
      if (!d.objectStoreNames.contains('photos')) d.createObjectStore('photos', { autoIncrement: true });
    };
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = (e) => reject(e);
  });
}
function kvGet(key) {
  return new Promise((res) => {
    const tx = db.transaction('kv', 'readonly').objectStore('kv').get(key);
    tx.onsuccess = () => res(tx.result);
    tx.onerror = () => res(undefined);
  });
}
function kvSet(key, val) {
  return new Promise((res) => {
    const tx = db.transaction('kv', 'readwrite').objectStore('kv').put(val, key);
    tx.onsuccess = () => res(true);
  });
}
function addRecord(store, val) {
  return new Promise((res) => {
    const tx = db.transaction(store, 'readwrite').objectStore(store).add(val);
    tx.onsuccess = () => res(true);
  });
}
function getAll(store) {
  return new Promise((res) => {
    const tx = db.transaction(store, 'readonly').objectStore(store).getAll();
    tx.onsuccess = () => res(tx.result);
  });
}

// ---------- state ----------
let plan = null;          // uploaded plan JSON
let flatWorkouts = [];    // flattened list of {week, day, exercises}
let currentExIndex = 0;
let currentWorkout = null;
let currentWorkoutIndex = 0;

// ---------- helpers ----------
const $ = (id) => document.getElementById(id);
const GRACE_DAYS = 4; // streak survives gaps up to this many days

function flattenPlan(p) {
  const list = [];
  p.weeks.forEach(w => {
    w.workouts.forEach(wo => {
      list.push({ week: w.week, day: wo.day, exercises: wo.exercises });
    });
  });
  return list;
}

function daysBetween(a, b) {
  return Math.floor((b - a) / 86400000);
}

async function refreshHome() {
  const history = await getAll('history');
  const lastDate = history.length ? new Date(history[history.length - 1].date) : null;
  const today = new Date();
  $('sinceNum').textContent = lastDate ? daysBetween(lastDate, today) : '—';

  // streak: count back from most recent, break if gap > GRACE_DAYS
  let streak = 0;
  if (history.length) {
    let prev = new Date(history[history.length - 1].date);
    streak = 1;
    for (let i = history.length - 2; i >= 0; i--) {
      const cur = new Date(history[i].date);
      if (daysBetween(cur, prev) <= GRACE_DAYS) { streak++; prev = cur; } else break;
    }
    if (daysBetween(lastDate, today) > GRACE_DAYS) streak = 0;
  }
  $('streakNum').textContent = streak;

  currentWorkoutIndex = (await kvGet('currentWorkoutIndex')) || 0;

  if (!plan) {
    $('noPlanPanel').style.display = 'block';
    $('planPanel').style.display = 'none';
    $('loadNewPlanBtn').style.display = 'none';
  } else {
    $('noPlanPanel').style.display = 'none';
    $('planPanel').style.display = 'block';
    $('loadNewPlanBtn').style.display = 'block';
    $('planTitle').textContent = plan.planName || 'Your Plan';
    const total = flatWorkouts.length;
    if (currentWorkoutIndex >= total) {
      $('planProgress').textContent = `All ${total} workouts complete. Load a new plan to keep going.`;
      $('startBtn').disabled = true;
    } else {
      const w = flatWorkouts[currentWorkoutIndex];
      $('planProgress').textContent = `Week ${w.week} · Workout ${w.day} — workout ${currentWorkoutIndex + 1} of ${total}`;
      $('startBtn').disabled = false;
    }
  }
}

// generic stick-figure fallback icon (per-exercise art can be swapped in later)
const ICON_SVG = `<svg viewBox="0 0 100 100" fill="none" stroke-width="4" stroke-linecap="round">
  <circle cx="50" cy="18" r="10"/>
  <line x1="50" y1="28" x2="50" y2="62"/>
  <line x1="50" y1="38" x2="28" y2="52"/>
  <line x1="50" y1="38" x2="72" y2="52"/>
  <line x1="50" y1="62" x2="32" y2="90"/>
  <line x1="50" y1="62" x2="68" y2="90"/>
</svg>`;

function showExercise() {
  const ex = currentWorkout.exercises[currentExIndex];
  $('exName').textContent = ex.name;
  $('exSets').textContent = ex.sets ?? '-';
  $('exReps').textContent = ex.reps ?? '-';
  $('exWeight').textContent = ex.weight ?? '-';
  $('exNotes').textContent = ex.notes || '';
  $('exerciseIcon').innerHTML = ICON_SVG;
  $('workoutLabel').textContent = `Week ${currentWorkout.week} · ${currentWorkout.day} — ${currentExIndex + 1}/${currentWorkout.exercises.length}`;
  $('progressFill').style.width = `${((currentExIndex) / currentWorkout.exercises.length) * 100}%`;
  $('nextExBtn').textContent = currentExIndex === currentWorkout.exercises.length - 1 ? 'Finish Workout' : 'Next Exercise';
}

function goTo(screenId) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  $(screenId).classList.add('active');
}

async function startWorkout() {
  currentWorkout = flatWorkouts[currentWorkoutIndex];
  currentExIndex = 0;
  showExercise();
  goTo('workout');
}

async function finishWorkout() {
  await addRecord('history', {
    date: new Date().toISOString(),
    week: currentWorkout.week,
    day: currentWorkout.day,
    exercises: currentWorkout.exercises
  });
  const newIndex = currentWorkoutIndex + 1;
  await kvSet('currentWorkoutIndex', newIndex);
  currentWorkoutIndex = newIndex;

  // every 3rd workout (end of week for a 3x/week plan) -> photo prompt
  if (newIndex % 3 === 0) {
    goTo('weekDone');
  } else {
    $('workoutDoneSub').textContent = 'Logged and saved.';
    goTo('workoutDone');
  }
}

async function renderStats() {
  const history = await getAll('history');
  const body = $('statsBody');
  if (!history.length) {
    body.innerHTML = '<p class="hint">Complete a few workouts to see stats here.</p>';
    return;
  }
  // average weight change per exercise name (first logged vs last logged, numeric weights only)
  const byName = {};
  history.forEach(h => h.exercises.forEach(ex => {
    const num = parseFloat(ex.weight);
    if (isNaN(num)) return;
    if (!byName[ex.name]) byName[ex.name] = [];
    byName[ex.name].push(num);
  }));
  let rows = '';
  Object.entries(byName).forEach(([name, vals]) => {
    if (vals.length < 2) return;
    const diff = vals[vals.length - 1] - vals[0];
    rows += `<div class="panel"><strong>${name}</strong><br><span class="hint">${diff >= 0 ? '+' : ''}${diff.toFixed(1)} since you started</span></div>`;
  });
  body.innerHTML = `
    <div class="stat-strip">
      <div class="stat"><div class="num">${history.length}</div><div class="label">workouts logged</div></div>
    </div>
    ${rows || '<p class="hint">Log numeric weights to see progression here.</p>'}
  `;
}

// ---------- wiring ----------
$('planFile').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const text = await file.text();
  try {
    const parsed = JSON.parse(text);
    await kvSet('plan', parsed);
    await kvSet('currentWorkoutIndex', 0);
    plan = parsed;
    flatWorkouts = flattenPlan(plan);
    refreshHome();
  } catch (err) {
    alert('That file could not be read as a valid plan JSON.');
  }
});

$('loadNewPlanBtn').addEventListener('click', () => {
  $('noPlanPanel').style.display = 'block';
  $('planPanel').style.display = 'none';
});

$('startBtn').addEventListener('click', startWorkout);
$('exitWorkout').addEventListener('click', () => goTo('home'));
$('nextExBtn').addEventListener('click', () => {
  if (currentExIndex < currentWorkout.exercises.length - 1) {
    currentExIndex++;
    showExercise();
  } else {
    finishWorkout();
  }
});
$('backHomeBtn').addEventListener('click', async () => { await refreshHome(); goTo('home'); });

let pendingPhotos = [];
$('photoInput').addEventListener('change', (e) => {
  pendingPhotos = Array.from(e.target.files);
  const grid = $('photoPreview');
  grid.innerHTML = '';
  pendingPhotos.forEach(f => {
    const img = document.createElement('img');
    img.src = URL.createObjectURL(f);
    grid.appendChild(img);
  });
});
$('savePhotosBtn').addEventListener('click', async () => {
  for (const file of pendingPhotos) {
    const dataUrl = await new Promise(res => {
      const r = new FileReader();
      r.onload = () => res(r.result);
      r.readAsDataURL(file);
    });
    await addRecord('photos', { date: new Date().toISOString(), data: dataUrl });
  }
  pendingPhotos = [];
  $('photoInput').value = '';
  $('photoPreview').innerHTML = '';
  await refreshHome();
  goTo('home');
});
$('skipPhotosBtn').addEventListener('click', async () => { await refreshHome(); goTo('home'); });

document.querySelectorAll('nav.tabs button').forEach(btn => {
  btn.addEventListener('click', async () => {
    document.querySelectorAll('nav.tabs button').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    if (btn.dataset.tab === 'stats') { await renderStats(); goTo('stats'); }
    else { await refreshHome(); goTo('home'); }
  });
});

// ---------- boot ----------
(async () => {
  db = await openDB();
  plan = await kvGet('plan');
  if (plan) flatWorkouts = flattenPlan(plan);
  currentWorkoutIndex = (await kvGet('currentWorkoutIndex')) || 0;
  await refreshHome();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('service-worker.js').catch(() => {});
  }
})();
