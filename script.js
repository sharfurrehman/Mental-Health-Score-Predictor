const API_URL = "https://mental-health-score-predictor-eru4.onrender.com"; // change the port if your server runs elsewhere

// Assumes the model predicts a score from 0-10 where higher means better well-being.
const MAX_SCORE = 10;
const BANDS = [
  { min: 8, label: "Signal: strong", color: "#3ddc97", note: "Your habits point to a healthy, resilient baseline. Keep it up." },
  { min: 6, label: "Signal: steady", color: "#9db4ff", note: "Mostly balanced, with room to improve sleep, activity, or screen time." },
  { min: 4, label: "Signal: strained", color: "#f0b429", note: "This profile suggests pressure. Small changes to sleep and screen time may help." },
  { min: -Infinity, label: "Signal: low", color: "#ff6b6b", note: "This profile suggests significant strain. Consider talking to someone you trust." },
];

const NUMBER_FIELDS = [
  "Age", "Daily_Unlocks", "Avg_Daily_Usage_Hours", "Study_Hours", "Physical_Activity_Hours", "Sleep_Hours_Per_Night",
];
const INTEGER_FIELDS = ["Age", "Daily_Unlocks"];
const TEXT_FIELDS = [
  "Gender", "Country", "Academic_Level", "Most_Used_Platform", "Purpose_Of_Use", "Stress_Level",
];

const form = document.getElementById("predict-form");
const submitBtn = document.getElementById("submit-btn");
const states = {};
["empty", "loading", "result", "error"].forEach((k) => { states[k] = document.getElementById(`state-${k}`); });

// Build the option pills from each .seg's data-options list.
document.querySelectorAll(".seg").forEach((seg) => {
  seg.dataset.options.split(",").forEach((value) => {
    const label = document.createElement("label");
    label.className = "opt";
    const input = document.createElement("input");
    input.type = "radio";
    input.name = seg.dataset.name;
    input.value = value;
    const text = document.createElement("span");
    text.textContent = value;
    label.append(input, text);
    seg.append(label);
  });
});

function showState(name) {
  Object.entries(states).forEach(([key, el]) => { el.hidden = key !== name; });
}

function fieldWrap(name) {
  const control = form.querySelector(`[name="${name}"]`);
  return control ? control.closest(".field") : null;
}

function setFieldError(name, message) {
  const wrap = fieldWrap(name);
  const slot = form.querySelector(`.err[data-for="${name}"]`);
  if (wrap) wrap.classList.toggle("invalid", Boolean(message));
  if (slot) slot.textContent = message || "";
}

function clearErrors() {
  form.querySelectorAll(".err").forEach((el) => { el.textContent = ""; });
  form.querySelectorAll(".field.invalid").forEach((el) => el.classList.remove("invalid"));
}

function readForm() {
  const fd = new FormData(form);
  const data = {};
  [...NUMBER_FIELDS, ...TEXT_FIELDS].forEach((key) => {
    const raw = (fd.get(key) || "").toString().trim();
    if (raw === "") data[key] = null;
    else data[key] = NUMBER_FIELDS.includes(key) ? Number(raw) : raw;
  });
  return data;
}

function validate(data) {
  const errors = {};
  for (const [key, value] of Object.entries(data)) {
    if (value === null || Number.isNaN(value)) {
      errors[key] = TEXT_FIELDS.includes(key) && key !== "Country" ? "Choose one option." : "This field is required.";
    }
  }
  const check = (key, min, max, integer = false) => {
    if (errors[key]) return;
    const v = data[key];
    if (integer && !Number.isInteger(v)) errors[key] = "Enter a whole number.";
    else if (v < min) errors[key] = `Must be at least ${min}.`;
    else if (max !== undefined && v > max) errors[key] = `Must be at most ${max}.`;
  };
  check("Age", 10, 100, true);
  check("Daily_Unlocks", 0, undefined, true);
  ["Avg_Daily_Usage_Hours", "Study_Hours", "Physical_Activity_Hours", "Sleep_Hours_Per_Night"].forEach((k) => check(k, 0, 24));
  return errors;
}

function showError(title, message) {
  document.getElementById("error-title").textContent = title;
  document.getElementById("error-message").textContent = message;
  showState("error");
}

function showResult(score) {
  const band = BANDS.find((b) => score >= b.min);
  const bar = document.getElementById("arc-bar");
  const dot = document.getElementById("arc-dot");
  const valueEl = document.getElementById("score-value");
  const decimals = Number.isInteger(score) ? 0 : 2;

  document.getElementById("score-label").textContent = band.label;
  document.getElementById("score-note").textContent = band.note;
  bar.style.stroke = band.color;
  bar.style.color = band.color;
  dot.style.fill = band.color;
  showState("result");

  // Draw the arc, pointer dot, and number at a point between 0 and the final score.
  const draw = (v) => {
    const frac = Math.max(0, Math.min(1, v / MAX_SCORE));
    const angle = Math.PI * frac;
    bar.style.strokeDashoffset = 100 * (1 - frac);
    dot.setAttribute("cx", 100 - 80 * Math.cos(angle));
    dot.setAttribute("cy", 100 - 80 * Math.sin(angle));
    valueEl.textContent = v.toFixed(decimals);
  };

  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return draw(score);
  const start = performance.now();
  const step = (now) => {
    const t = Math.min(1, (now - start) / 1100);
    draw(score * (1 - Math.pow(1 - t, 3)));
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// FastAPI 422 responses look like { detail: [{ loc: ["body", "Age"], msg: "..." }] }
function applyServerValidation(detail) {
  let applied = false;
  if (!Array.isArray(detail)) return applied;
  detail.forEach((item) => {
    const field = Array.isArray(item.loc) ? item.loc[item.loc.length - 1] : null;
    if (field && fieldWrap(field)) {
      setFieldError(field, item.msg);
      applied = true;
    }
  });
  return applied;
}

async function submitPrediction(data) {
  showState("loading");
  submitBtn.disabled = true;
  try {
    const response = await fetch(`${API_URL}/predict`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });

    let body = null;
    try { body = await response.json(); } catch { /* non-JSON response */ }

    if (response.status === 422) {
      const applied = applyServerValidation(body && body.detail);
      showError("Some answers need fixing",
        applied ? "Check the highlighted fields and try again." : "The server rejected the submitted data.");
      return;
    }
    if (!response.ok) {
      showError("The server hit a problem", `The API returned status ${response.status}. Check the backend logs on Render for details.`);
      return;
    }
    if (!body || typeof body.predicted_score !== "number") {
      showError("Unexpected response", "The API did not return a predicted_score.");
      return;
    }
    showResult(body.predicted_score);
  } catch (err) {
    showError("Can't reach the API",
      `Make sure the backend is running at ${API_URL.replace("/predict", "")}, then try again.`);
  } finally {
    submitBtn.disabled = false;
  }
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  clearErrors();
  const data = readForm();
  const errors = validate(data);
  const keys = Object.keys(errors);
  if (keys.length) {
    keys.forEach((k) => setFieldError(k, errors[k]));
    form.querySelector(`[name="${keys[0]}"]`).focus();
    showError("Some answers need fixing", "Complete the highlighted fields and try again.");
    return;
  }
  submitPrediction(data);
});

// Clear a field's error as soon as the person changes it.
["input", "change"].forEach((type) => {
  form.addEventListener(type, (event) => {
    if (event.target.name) setFieldError(event.target.name, "");
  });
});

form.addEventListener("reset", () => { clearErrors(); showState("empty"); });
document.getElementById("retry-btn").addEventListener("click", () => showState("empty"));
document.getElementById("again-btn").addEventListener("click", () => {
  form.reset();
  window.scrollTo({ top: 0, behavior: "smooth" });
});
