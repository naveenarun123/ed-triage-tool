/* ============================================================================
   ED Triage Disposition Checklist — incidental cerebrovascular findings

   The DECISION ENGINE below is carried over unchanged from the original tool
   (verified against manuscript Table 4 decision matrix + Table 5 age modifier).
   Every edit in this file is in the UI layer beneath it. If you change a rule,
   change it here and nowhere else.
   ========================================================================== */

'use strict';

/* ================= DECISION ENGINE ======================================= */

var TIERS = ["RETURN_ED", "EXPERT", "EXPEDITED", "ROUTINE", "NO_REFERRAL"];

var META = {
  RETURN_ED: { name: "Return to the ED now", short: "Return to ED", timing: "Immediately", cls: "t1",
    action: "Send the patient back to the Emergency Department now for re-evaluation and imaging. Do not wait for an outpatient appointment." },
  EXPERT: { name: "Neurovascular expert review", short: "Expert review", timing: "Within 12–24 hours", cls: "t2",
    action: "Contact the on-call neurosurgery / neuro-endovascular service for review within 12–24 hours. Early-morning contact is acceptable for a finding identified overnight." },
  EXPEDITED: { name: "Expedited neurosurgery clinic", short: "Expedited clinic", timing: "Within 1–2 weeks", cls: "t3",
    action: "Arrange an expedited neurosurgery clinic appointment within 1–2 weeks and give the patient explicit return precautions." },
  ROUTINE: { name: "Routine neurosurgery clinic", short: "Routine clinic", timing: "Within 4–6 weeks", cls: "t4",
    action: "Refer to routine neurosurgery clinic within 4–6 weeks. Provide standard return precautions at discharge." },
  NO_REFERRAL: { name: "Reassurance — no referral needed", short: "No referral", timing: "No scheduled neurosurgical follow-up", cls: "t5",
    action: "No neurosurgical follow-up is required for this finding. Complete the 24-hour safety-net phone call and give the patient clear return precautions." }
};

function esc(t, n) { var i = Math.max(0, TIERS.indexOf(t) - (n || 1)); return TIERS[i]; }
function deesc(t, n) { var i = Math.min(TIERS.length - 1, TIERS.indexOf(t) + (n || 1)); return TIERS[i]; }

var CANT_MISS = ["thunderclap", "worsening_headache", "visual_diplopia", "focal_deficit", "ams"];
var SXTEXT = {
  thunderclap: "thunderclap / worst-ever headache",
  worsening_headache: "new or worsening severe headache",
  visual_diplopia: "new visual change or double vision",
  focal_deficit: "new focal neurological deficit",
  ams: "altered mental status"
};

function sizeBand(mm) { if (mm >= 10) return ">=10"; if (mm >= 7) return ">=7"; if (mm >= 3) return "3-7"; return "<3"; }
function ageBand(a) { if (a < 50) return "<50"; if (a <= 74) return "50-74"; if (a <= 84) return "75-84"; return ">=85"; }
function riskLevel(rf) { return rf.length >= 2 ? "high" : "low"; }

function readLabel(r) {
  return r === "indeterminate" ? "an indeterminate / small aneurysm" :
    r === "classic_infundibulum" ? "a classic infundibulum" :
      "a finding whose imaging language favors an aneurysm";
}
function locLabel(l) {
  return l === "anterior" ? "the anterior circulation" :
    l === "posterior" ? "the posterior circulation" : "the cavernous segment of the ICA";
}
function bandLabel(b) {
  return b === "<3" ? "under 3 mm" : b === "3-7" ? "3–7 mm" : b === ">=7" ? "7 mm or larger" : "10 mm or larger";
}
function riskLabel(rf) {
  var n = rf.length;
  return n >= 2 ? ("higher-risk (" + n + " vascular risk factors)")
                : ("lower-risk (" + n + " risk factor" + (n === 1 ? "" : "s") + ")");
}
function findingSentence(inp) {
  return "Finding: " + readLabel(inp.read) + " in " + locLabel(inp.location) + ", " +
    bandLabel(sizeBand(inp.size_mm)) + ", in a " + riskLabel(inp.risk_factors) + " patient.";
}

function decide(inp) {
  var trace = [], flags = [];
  var band = sizeBand(inp.size_mm), rl = riskLevel(inp.risk_factors), ab = ageBand(inp.age);
  var present = inp.symptoms.filter(function (s) { return CANT_MISS.indexOf(s) >= 0; });

  // Step 0: safety-net symptoms
  if (present.length) {
    // Headaches concerning for SAH are LP-gated; other red-flag symptoms are unconditional.
    var haSAH = present.filter(function (p) { return p === "thunderclap" || p === "worsening_headache"; });
    var other = present.filter(function (p) { return p !== "thunderclap" && p !== "worsening_headache"; });
    if (other.length) {
      trace.push("The patient has an active red-flag symptom: " + other.map(function (p) { return SXTEXT[p]; }).join(", ") + ".");
      return { tier: "RETURN_ED", trace: trace.concat(["A red-flag symptom takes priority over the aneurysm characteristics — the patient returns to the ED now."]), flags: flags };
    }
    if (haSAH.length && inp.lp_done !== true) {
      trace.push("A " + haSAH.map(function (p) { return SXTEXT[p]; }).join(" and ") + " was reported and no lumbar puncture was done at the first visit, so subarachnoid bleeding has not been excluded.");
      return { tier: "RETURN_ED", trace: trace.concat(["Because bleeding cannot be ruled out at the bedside, the patient returns to the ED for a lumbar puncture and re-evaluation."]), flags: flags };
    }
    if (haSAH.length && inp.lp_done === true) {
      trace.push("A " + haSAH.map(function (p) { return SXTEXT[p]; }).join(" and ") + " was reported, but a lumbar puncture was already performed at the first visit — so this alone is not an automatic return. The tool continues to assess the lesion.");
    }
  }

  // Step 1: immediate radiological triggers
  if (inp.read === "likely_aneurysm") {
    trace.push("The radiology read favors an aneurysm rather than a benign infundibulum.");
    return { tier: "RETURN_ED", trace: trace.concat(["This is an automatic trigger — the patient returns to the ED now."]), flags: flags };
  }
  if (inp.daughter_sac) {
    trace.push("A bleb / daughter sac is present, a marker of instability.");
    return { tier: "RETURN_ED", trace: trace.concat(["This is an automatic trigger — the patient returns to the ED now."]), flags: flags };
  }
  if (inp.size_mm >= 10) {
    trace.push("The largest diameter is " + inp.size_mm + " mm — 10 mm or greater.");
    return { tier: "RETURN_ED", trace: trace.concat(["At this size, rupture risk rises sharply; this is an automatic return to the ED."]), flags: flags };
  }

  // Step 1b: base tier
  var base = null;
  if (inp.location === "cavernous") {
    if (inp.cavernous_symptoms) {
      trace.push("The lesion is in the cavernous ICA and the patient has cavernous-sinus symptoms (a cranial-nerve palsy or retro-orbital pain).");
      return { tier: "RETURN_ED", trace: trace.concat(["A symptomatic cavernous lesion warrants urgent evaluation — the patient returns to the ED now."]), flags: flags };
    }
    base = "ROUTINE";
    trace.push("The lesion is in the cavernous ICA and is asymptomatic. Because this segment lies outside the dura, a rupture would not cause a subarachnoid hemorrhage, so the baseline is a routine clinic referral.");
  } else if (inp.location === "posterior") {
    if (inp.read === "indeterminate") {
      if (band === ">=7") base = "RETURN_ED";
      else if (band === "3-7") base = (rl === "high") ? "RETURN_ED" : "EXPERT";
      else if (band === "<3") base = "EXPERT";
    } else if (inp.read === "classic_infundibulum") {
      if (band === "3-7") base = (rl === "high") ? "EXPERT" : "EXPEDITED";
      else if (band === "<3") base = "EXPEDITED";
    }
    if (base === "RETURN_ED") {
      trace.push(findingSentence(inp) + " Posterior-circulation lesions of this size/risk are treated as an immediate return.");
      return { tier: "RETURN_ED", trace: trace.concat(["The patient returns to the ED now."]), flags: flags };
    }
    if (base) trace.push(findingSentence(inp) + " Posterior-circulation lesions are escalated a step relative to the anterior circulation, giving a baseline of " + META[base].name.toLowerCase() + ".");
  } else if (inp.location === "anterior") {
    if (inp.read === "classic_infundibulum") {
      if (band === "<3" && inp.classic_all_criteria === true && rl === "low" && !inp.irregular && !inp.daughter_sac) {
        base = "NO_REFERRAL";
        trace.push("This is a classic infundibulum that meets every benign criterion — under 3 mm, smooth, an apical branch vessel, a typical branch point, no bleb — in a lower-risk patient. This is the one finding the protocol considers benign enough to need no referral.");
      } else if (band === "3-7") { base = (rl === "high") ? "EXPEDITED" : "ROUTINE"; }
      else if (band === "<3") { base = "ROUTINE"; }
      if (base && base !== "NO_REFERRAL") trace.push(findingSentence(inp) + " Baseline for an anterior classic infundibulum of this size/risk is " + META[base].name.toLowerCase() + ".");
    } else if (inp.read === "indeterminate") {
      if (band === ">=7") base = "EXPERT";
      else if (band === "3-7") base = (rl === "high") ? "EXPERT" : "EXPEDITED";
      else if (band === "<3") base = "EXPEDITED";
      if (base) trace.push(findingSentence(inp) + " Baseline for an anterior indeterminate finding of this size/risk is " + META[base].name.toLowerCase() + ".");
    }
  }

  if (base === null) {
    flags.push("This exact combination of inputs is not spelled out in the protocol.");
    trace.push("No rule in the protocol matches this specific combination of location, read, size, and risk.");
    return { tier: "EXPERT", trace: trace.concat(["Rather than guess, the tool defaults to neurovascular expert review and flags the case for a human decision."]), flags: flags };
  }

  // Step 2: age modifier (never overrides Return-to-ED)
  var final = base;
  if (base !== "RETURN_ED") {
    if (ab === "<50") {
      if (inp.irregular) {
        final = esc(base, 1);
        trace.push("The patient is under 50 and the wall is irregular. In a younger patient an irregular lesion is treated more cautiously, so the recommendation is raised one step, from " + META[base].name.toLowerCase() + " to " + META[final].name.toLowerCase() + ".");
      } else trace.push("The patient is under 50 with a regular-walled lesion; the baseline recommendation stands (a low threshold is kept for younger patients).");
    } else if (ab === "50-74") {
      trace.push("The patient is 50–74, the age band the underlying rupture-risk data are built on, so the baseline recommendation applies unchanged.");
    } else if (ab === "75-84") {
      if (band === "<3" && !inp.irregular) {
        final = deesc(base, 1);
        if (final !== base) {
          trace.push("The patient is 75–84 with a small (under 3 mm), smooth lesion. In this age group such a low-acuity finding can be stepped down one level, from " + META[base].name.toLowerCase() + " to " + META[final].name.toLowerCase() + ".");
        } else {
          trace.push("The patient is 75–84 with a small (under 3 mm), smooth lesion, which supports a lower level of urgency — but the baseline is already the lowest tier (" + META[base].name.toLowerCase() + "), so there is nothing further to step down.");
        }
      } else trace.push("The patient is 75–84, but the lesion is either 3 mm or larger or irregular, so no step-down is applied.");
    } else if (ab === ">=85") {
      var immediate = (inp.size_mm >= 10) || (inp.location === "posterior" && inp.size_mm >= 7) || inp.daughter_sac;
      if (immediate) {
        final = "RETURN_ED";
        trace.push("The patient is 85 or older, but the lesion is large, posterior and ≥7 mm, or has a bleb — features urgent enough to return to the ED regardless of age.");
      } else if (rl === "low" || inp.read === "classic_infundibulum") {
        final = "NO_REFERRAL";
        trace.push("The patient is 85 or older with a lower-risk or classic-infundibulum finding and no urgent features. Here the balance of risk and benefit favors reassurance rather than intervention, so only a safety-net call is recommended.");
      } else {
        trace.push("The patient is 85 or older with a higher-risk, non-classic lesion and no urgent features. The protocol does not settle this specific case, so the baseline recommendation is kept.");
        flags.push("Age 85+ with a higher-risk, non-classic lesion is not explicitly resolved by the protocol — the baseline was kept; expert review is advised.");
      }
    }
  } else {
    trace.push("The baseline is already a return to the ED, so the age adjustment does not apply.");
  }
  return { tier: final, trace: trace, flags: flags };
}

/* ================= UI ====================================================
   The interface is the decision matrix itself. All five dispositions stay on
   screen; each answer eliminates the ones it makes unreachable.

   Reachability is computed by enumerating every completion of the unanswered
   fields through decide() above, so the matrix can never disagree with the
   engine. The enumeration runs once at load into a packed index table.
   ======================================================================== */

var q = function (s, r) { return (r || document).querySelector(s); };
var qa = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

var STEP_COUNT = 5;
var BAND_VALUE = { "<3": 2, "3-7": 5, "7-10": 8, ">=10": 11 };
var BAND_TEXT  = { "<3": "under 3 mm", "3-7": "3–7 mm", "7-10": "7–10 mm", ">=10": "10 mm or larger" };

var CANT_MISS_SCRIPT = [
  "Thunderclap or worst-ever headache",
  "New or worsening severe headache",
  "Visual change or double vision",
  "New focal neurological deficit",
  "Altered mental status or reduced consciousness"
];

/* ── Enumeration domains ────────────────────────────────────────────────
   Canonical representatives, one per class the engine can distinguish.
   Symptom sets collapse to three classes because decide() branches only on
   "unconditional red flag" / "SAH-concerning headache" / "none". Sizes and
   ages use the band representatives already proven threshold-faithful. */
var DOMAIN = {
  sx:    [[], ["thunderclap"], ["focal_deficit"]],
  lp:    [true, false, null],
  loc:   ["anterior", "posterior", "cavernous"],
  read:  ["classic_infundibulum", "indeterminate", "likely_aneurysm"],
  band:  ["<3", "3-7", "7-10", ">=10"],
  irr:   [true, false],
  dau:   [true, false],
  cav:   [true, false],
  all:   [true, false],
  risk:  [[], ["uncontrolled_htn", "active_smoking"]],
  age:   [30, 60, 80, 90]
};
var COLS = ["sx", "lp", "loc", "read", "band", "irr", "dau", "cav", "all", "risk", "age"];
var NCOL = COLS.length + 1;          // + tier index
var TIER_COL = COLS.length;

var TABLE = null, NROW = 0;

function buildTable() {
  var sizes = COLS.map(function (c) { return DOMAIN[c].length; });
  NROW = sizes.reduce(function (a, b) { return a * b; }, 1);
  TABLE = new Int8Array(NROW * NCOL);

  var idx = new Array(COLS.length).fill(0);
  for (var row = 0; row < NROW; row++) {
    var rest = row;
    for (var c = COLS.length - 1; c >= 0; c--) {
      idx[c] = rest % sizes[c];
      rest = (rest - idx[c]) / sizes[c];
    }
    var loc = DOMAIN.loc[idx[2]];
    var inp = {
      age: DOMAIN.age[idx[10]],
      symptoms: DOMAIN.sx[idx[0]],
      lp_done: DOMAIN.lp[idx[1]],
      location: loc,
      // gather() forces this substitution for cavernous lesions; mirror it here.
      read: loc === "cavernous" ? "indeterminate" : DOMAIN.read[idx[3]],
      size_mm: BAND_VALUE[DOMAIN.band[idx[4]]],
      irregular: DOMAIN.irr[idx[5]],
      daughter_sac: DOMAIN.dau[idx[6]],
      cavernous_symptoms: DOMAIN.cav[idx[7]],
      classic_all_criteria: DOMAIN.all[idx[8]],
      risk_factors: DOMAIN.risk[idx[9]]
    };
    var base = row * NCOL;
    for (var k = 0; k < COLS.length; k++) TABLE[base + k] = idx[k];
    TABLE[base + TIER_COL] = TIERS.indexOf(decide(inp).tier);
  }
}

/* Tiers still reachable given the answers fixed so far.
   `fixed` maps column name to a domain index; unlisted columns stay free. */
function reachableTiers(fixed) {
  var keys = Object.keys(fixed);
  var checks = keys.map(function (k) { return [COLS.indexOf(k), fixed[k]]; });
  var seen = [false, false, false, false, false];
  var found = 0;
  for (var row = 0; row < NROW; row++) {
    var base = row * NCOL, ok = true;
    for (var c = 0; c < checks.length; c++) {
      if (TABLE[base + checks[c][0]] !== checks[c][1]) { ok = false; break; }
    }
    if (!ok) continue;
    var t = TABLE[base + TIER_COL];
    if (!seen[t]) { seen[t] = true; if (++found === 5) break; }
  }
  return seen;
}

/* Current answers expressed as domain indices. Fields the form has hidden as
   irrelevant are left free rather than guessed. */
function fixedFromForm() {
  var f = {};
  var sxOther = ["visual_diplopia", "focal_deficit", "ams"].some(function (v) {
    return q('input[name=sx][value=' + v + ']').checked;
  });
  var sxHeadache = q('input[name=sx][value=thunderclap]').checked ||
                   q('input[name=sx][value=worsening_headache]').checked;
  if (sxOther) f.sx = 2;
  else if (sxHeadache) f.sx = 1;
  else if (el.sxNone.checked) f.sx = 0;

  var lp = checkedValue('lp');
  if (lp) f.lp = lp === 'yes' ? 0 : 1;

  var loc = checkedValue('location');
  if (loc) f.loc = DOMAIN.loc.indexOf(loc);

  if (loc === 'cavernous') {
    var cav = checkedValue('cavsx');
    if (cav) f.cav = cav === 'yes' ? 0 : 1;
  } else {
    var rd = checkedValue('read');
    if (rd) f.read = DOMAIN.read.indexOf(rd);
    if (rd !== 'likely_aneurysm') {
      var b = currentBand();
      if (b) f.band = DOMAIN.band.indexOf(b);
    }
    f.irr = q('#irregular').checked ? 0 : 1;
    f.dau = q('#daughter').checked ? 0 : 1;
    if (rd === 'classic_infundibulum') {
      var ac = checkedValue('allcrit');
      if (ac) f.all = ac === 'yes' ? 0 : 1;
    }
  }

  if (el.rfNone.checked || qa('input[name=rf]:checked').length) {
    f.risk = qa('input[name=rf]:checked').length >= 2 ? 1 : 0;
  }
  var age = parseFloat(el.age.value);
  if (!isNaN(age)) f.age = DOMAIN.age.indexOf(AGE_REP(age));
  return f;
}

function AGE_REP(a) { return a < 50 ? 30 : a <= 74 ? 60 : a <= 84 ? 80 : 90; }

function currentBand() {
  var exact = parseFloat(el.size.value);
  if (!isNaN(exact) && exact > 0) {
    return exact >= 10 ? ">=10" : exact >= 7 ? "7-10" : exact >= 3 ? "3-7" : "<3";
  }
  return state.band;
}

/* ── State ──────────────────────────────────────────────────────────────── */

var el = {};
var state = { band: null, submitted: false, lastResult: null, lastInput: null };

function init() {
  el.form      = q('#triage');
  el.matrix    = q('#matrix');
  el.count     = q('#matrixCount');
  el.readout   = q('#readout');
  el.verdict   = q('#verdict');
  el.errorBox  = q('#errorBox');
  el.printDoc  = q('#printDoc');
  el.printRow  = q('#printRow');
  el.size      = q('#size');
  el.age       = q('#age');
  el.sxNone    = q('#sxNone');
  el.rfNone    = q('#rfNone');
  el.lpWrap    = q('#lpWrap');
  el.cavWrap   = q('#cavWrap');
  el.cavNote   = q('#cavNote');
  el.lesion    = q('#lesionBlock');
  el.allcrit   = q('#allcritWrap');
  el.redflag   = q('#redflagAlert');
  el.riskCount = q('#riskCount');
  el.tiers     = q('.tiers');
  el.tiles     = {};
  qa('.tier').forEach(function (n) { el.tiles[n.dataset.tier] = n; });

  buildTable();

  el.form.addEventListener('change', onChange);
  el.form.addEventListener('input', onChange);
  el.form.addEventListener('submit', onSubmit);
  qa('.band').forEach(function (b) {
    b.addEventListener('click', function () { setBand(b.dataset.band); });
  });
  q('#resetBtn').addEventListener('click', resetForm);
  q('#printBtn').addEventListener('click', doPrint);

  q('#foot').textContent =
    'Decision logic v1.2, derived from the ED–Neurosurgery incidental intracranial aneurysm ' +
    'triage protocol (Table 4 decision matrix and Table 5 age modifier). Runs entirely in ' +
    'your browser; no data is transmitted or stored.';

  sync();
}

function onChange(e) {
  var t = e.target;
  if (t === el.size && el.size.value !== '') {
    state.band = null;
    qa('.band').forEach(function (b) { b.setAttribute('aria-pressed', 'false'); });
  }
  if (t.name === 'sxnone' && t.checked) uncheckAll('input[name=sx]');
  if (t.name === 'sx' && t.checked) el.sxNone.checked = false;
  if (t.name === 'rfnone' && t.checked) uncheckAll('input[name=rf]');
  if (t.name === 'rf' && t.checked) el.rfNone.checked = false;
  sync();
}

function uncheckAll(sel) { qa(sel).forEach(function (n) { n.checked = false; }); }

function setBand(band) {
  state.band = (state.band === band) ? null : band;
  qa('.band').forEach(function (b) {
    b.setAttribute('aria-pressed', String(b.dataset.band === state.band));
  });
  if (state.band) el.size.value = '';
  sync();
}

function checkedValue(name) {
  var n = q('input[name=' + name + ']:checked');
  return n ? n.value : null;
}

/* ── Reactive sync ──────────────────────────────────────────────────────── */

function sync() {
  var sxHeadache = q('input[name=sx][value=thunderclap]').checked ||
                   q('input[name=sx][value=worsening_headache]').checked;
  var sxOther = ["visual_diplopia", "focal_deficit", "ams"].some(function (v) {
    return q('input[name=sx][value=' + v + ']').checked;
  });
  var loc = checkedValue('location');
  var read = checkedValue('read');
  var isCav = loc === 'cavernous';

  el.lpWrap.hidden = !sxHeadache;
  el.redflag.hidden = !sxOther;
  el.cavWrap.hidden = !isCav;
  el.cavNote.hidden = !isCav;
  el.lesion.hidden = isCav;
  el.allcrit.hidden = read !== 'classic_infundibulum';

  var rf = qa('input[name=rf]:checked').length;
  el.riskCount.textContent = rf === 0
    ? (el.rfNone.checked ? 'None recorded; classified lower-risk.' : '')
    : rf + (rf === 1 ? ' selected; classified lower-risk.'
                     : ' selected; classified higher-risk, which can raise urgency by one step.');
  el.riskCount.classList.toggle('is-high', rf >= 2);

  var done = stepsDone();
  qa('.q').forEach(function (n) {
    n.classList.toggle('is-answered', !!done[Number(n.dataset.step)]);
  });

  paintMatrix(done);
  renderReadout();
}

function stepsDone() {
  var d = {};
  var sxHeadache = q('input[name=sx][value=thunderclap]').checked ||
                   q('input[name=sx][value=worsening_headache]').checked;
  var loc = checkedValue('location');
  d[1] = (el.sxNone.checked || qa('input[name=sx]:checked').length > 0) &&
         (!sxHeadache || !!checkedValue('lp'));
  d[2] = !!loc && (loc !== 'cavernous' || !!checkedValue('cavsx'));
  if (loc === 'cavernous') {
    d[3] = true;
  } else {
    var read = checkedValue('read');
    var sizeOk = read === 'likely_aneurysm' ? true : !!currentBand();
    var critOk = read !== 'classic_infundibulum' || !!checkedValue('allcrit');
    d[3] = !!read && sizeOk && critOk;
  }
  d[4] = el.rfNone.checked || qa('input[name=rf]:checked').length > 0;
  d[5] = !isNaN(parseFloat(el.age.value));
  return d;
}

/* ── The matrix ─────────────────────────────────────────────────────────── */

function paintMatrix(done) {
  var fixed = fixedFromForm();
  var live = reachableTiers(fixed);
  var n = live.filter(Boolean).length;
  var complete = done[1] && done[2] && done[3] && done[4] && done[5];

  TIERS.forEach(function (tier, i) {
    var tile = el.tiles[tier];
    var isLive = live[i];
    tile.classList.toggle('is-out', !isLive);
    tile.classList.toggle('is-only', isLive && n === 1);
    tile.setAttribute('aria-disabled', String(!isLive));
    var st = q('.tier__state', tile);
    st.textContent = !isLive ? 'Ruled out'
                   : (n === 1 ? (complete ? 'Recommended' : 'Only remaining') : 'Possible');
  });

  el.matrix.classList.toggle('is-resolved', n === 1);

  /* Below 860px the matrix is a horizontal strip, so the surviving column can
     sit off-screen. Bring it into view without moving the page itself. */
  if (n === 1 && el.tiers.scrollWidth > el.tiers.clientWidth + 4) {
    var win = TIERS.find(function (t, i) { return live[i]; });
    var tile = el.tiles[win];
    if (tile) {
      var target = tile.offsetLeft - (el.tiers.clientWidth - tile.offsetWidth) / 2;
      el.tiers.scrollTo({ left: Math.max(0, target), behavior: 'smooth' });
    }
  }
  el.count.innerHTML = n === 1
    ? '<b>1</b> disposition remains'
    : '<b>' + n + '</b> of 5 dispositions remain';
}

/* A running plain-language line of what has been entered, under the matrix. */
function renderReadout() {
  var bits = [];
  var loc = checkedValue('location');
  var read = checkedValue('read');
  var sxN = qa('input[name=sx]:checked').length;

  if (sxN) bits.push(sxN + ' red flag' + (sxN === 1 ? '' : 's'));
  else if (el.sxNone.checked) bits.push('no red flags');
  if (loc) bits.push(loc === 'cavernous' ? 'cavernous ICA' : loc + ' circulation');
  if (loc === 'cavernous') {
    var c = checkedValue('cavsx');
    if (c) bits.push(c === 'yes' ? 'sinus symptoms' : 'asymptomatic');
  } else {
    if (read) bits.push(read === 'classic_infundibulum' ? 'classic infundibulum'
                      : read === 'indeterminate' ? 'indeterminate' : 'favors aneurysm');
    var b = currentBand();
    if (b && read !== 'likely_aneurysm') bits.push(BAND_TEXT[b]);
    if (q('#irregular').checked) bits.push('irregular wall');
    if (q('#daughter').checked) bits.push('bleb');
  }
  var rf = qa('input[name=rf]:checked').length;
  if (rf) bits.push(rf + ' risk factor' + (rf === 1 ? '' : 's'));
  else if (el.rfNone.checked) bits.push('no risk factors');
  var age = parseFloat(el.age.value);
  if (!isNaN(age)) bits.push(age + ' y');

  el.readout.textContent = bits.length ? bits.join('  ·  ') : 'No findings entered yet';
  el.readout.classList.toggle('is-empty', !bits.length);

  /* The criteria lists explain the matrix before anything is entered. Once the
     clinician starts answering they are noise, so the matrix compacts to names,
     timing and status and stops crowding the questions below. */
  el.matrix.classList.toggle('is-compact', bits.length > 0);
}

/* ── Input gathering, validation, submit ────────────────────────────────── */

function gather() {
  var sx = qa('input[name=sx]:checked').map(function (x) { return x.value; });
  var rf = qa('input[name=rf]:checked').map(function (x) { return x.value; });
  var loc = checkedValue('location');
  var rd = checkedValue('read');
  var lp = checkedValue('lp');
  var cav = checkedValue('cavsx');
  var ac = checkedValue('allcrit');

  var exact = parseFloat(el.size.value);
  var sizeMm = !isNaN(exact) && exact > 0 ? exact
             : (state.band ? BAND_VALUE[state.band] : 0);

  return {
    age: parseFloat(el.age.value),
    symptoms: sx,
    lp_done: lp === 'yes' ? true : (lp === 'no' ? false : null),
    location: loc,
    read: loc === 'cavernous' ? 'indeterminate' : rd,
    size_mm: sizeMm,
    irregular: q('#irregular').checked,
    daughter_sac: q('#daughter').checked,
    cavernous_symptoms: cav === 'yes',
    classic_all_criteria: ac === 'yes',
    risk_factors: rf,
    _loc: loc,
    _read: rd,
    _sizeExact: !isNaN(exact) && exact > 0 ? exact : null,
    _sizeBand: state.band
  };
}

function validate() {
  var e = [];
  var loc = checkedValue('location');
  var read = checkedValue('read');
  var sxHeadache = q('input[name=sx][value=thunderclap]').checked ||
                   q('input[name=sx][value=worsening_headache]').checked;

  if (!el.sxNone.checked && qa('input[name=sx]:checked').length === 0) {
    e.push({ msg: 'Record the red-flag symptoms present, or select “None of these”.', focus: '#sxNone' });
  }
  if (sxHeadache && !checkedValue('lp')) {
    e.push({ msg: 'Indicate whether a lumbar puncture was performed, since a headache concerning for bleeding is recorded.', focus: 'input[name=lp]' });
  }
  if (!loc) e.push({ msg: 'Select the location of the finding.', focus: 'input[name=location]' });
  if (loc === 'cavernous' && !checkedValue('cavsx')) {
    e.push({ msg: 'Indicate whether cavernous-sinus symptoms are present.', focus: 'input[name=cavsx]' });
  }
  if (loc && loc !== 'cavernous') {
    if (!read) e.push({ msg: 'Select how the radiology read described the finding.', focus: 'input[name=read]' });
    if (read !== 'likely_aneurysm' && !currentBand()) {
      e.push({ msg: 'Select a size band, or enter the largest diameter in millimetres.', focus: '.band' });
    }
    if (read === 'classic_infundibulum' && !checkedValue('allcrit')) {
      e.push({ msg: 'Indicate whether all classic-infundibulum criteria are met.', focus: 'input[name=allcrit]' });
    }
  }
  if (!el.rfNone.checked && qa('input[name=rf]:checked').length === 0) {
    e.push({ msg: 'Record the vascular risk factors present, or select “None of these”.', focus: '#rfNone' });
  }
  if (isNaN(parseFloat(el.age.value))) e.push({ msg: 'Enter the patient age.', focus: '#age' });
  return e;
}

function showErrors(errs) {
  el.errorBox.innerHTML = '<b>Required before a recommendation can be generated</b><ul>' +
    errs.map(function (x) { return '<li>' + escapeHtml(x.msg) + '</li>'; }).join('') + '</ul>';
  el.errorBox.hidden = false;
  var first = errs[0] && q(errs[0].focus);
  if (first) { first.setAttribute('aria-invalid', 'true'); first.focus(); }
  el.errorBox.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function onSubmit(e) {
  e.preventDefault();
  qa('[aria-invalid]').forEach(function (n) { n.removeAttribute('aria-invalid'); });
  var inp = gather();
  var errs = validate();
  if (errs.length) { el.verdict.hidden = true; showErrors(errs); return; }
  el.errorBox.hidden = true;

  var r = decide(inp);
  state.submitted = true;
  state.lastResult = r;
  state.lastInput = inp;

  el.verdict.innerHTML = renderVerdict(r, inp);
  el.verdict.hidden = false;
  el.printRow.hidden = false;
  sync();
  el.verdict.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderVerdict(r, inp) {
  var m = META[r.tier];
  var h = '';

  h += '<div class="verdict__head" data-tier="' + m.cls + '">' +
       '<p class="verdict__kicker">Recommended disposition</p>' +
       '<h2 class="verdict__name">' + escapeHtml(m.name) + '</h2>' +
       '<p class="verdict__timing">' + escapeHtml(m.timing) + '</p></div>' +
       '<p class="verdict__action">' + escapeHtml(m.action) + '</p>';

  r.flags.forEach(function (f) {
    h += '<div class="note note--flag"><b>Requires clinician judgment</b>' + escapeHtml(f) + '</div>';
  });

  h += '<div class="note note--safety"><b>Can’t-miss symptoms during the 24-hour safety-net call</b>' +
       'If any is reported, instruct the patient to return to the ED immediately.<ul>' +
       CANT_MISS_SCRIPT.map(function (s) { return '<li>' + escapeHtml(s) + '</li>'; }).join('') +
       '</ul></div>';

  h += '<section class="basis"><h3>Basis for this recommendation</h3><ol>' +
       r.trace.map(function (t) { return '<li>' + escapeHtml(t) + '</li>'; }).join('') +
       '</ol></section>';

  h += '<section class="basis"><h3>Inputs used</h3><p class="chips">' +
       inputTags(inp).map(function (t) { return '<span>' + escapeHtml(t) + '</span>'; }).join('') +
       '</p></section>';
  return h;
}

function inputTags(inp) {
  var tags = ['Age ' + inp.age];
  tags.push(locLabel(inp._loc).replace('the ', ''));
  if (inp._loc !== 'cavernous') {
    tags.push(readLabel(inp._read).replace(/^an? /, ''));
    if (inp._read !== 'likely_aneurysm') tags.push(sizeText(inp));
  } else {
    tags.push(inp.cavernous_symptoms ? 'cavernous-sinus symptoms' : 'asymptomatic');
  }
  tags.push(riskLevel(inp.risk_factors) + '-risk · ' + inp.risk_factors.length +
            ' factor' + (inp.risk_factors.length === 1 ? '' : 's'));
  if (inp.irregular) tags.push('irregular wall');
  if (inp.daughter_sac) tags.push('bleb');
  if (inp.symptoms.length) tags.push(inp.symptoms.length + ' red-flag symptom' + (inp.symptoms.length === 1 ? '' : 's'));
  return tags;
}

function sizeText(inp) {
  if (inp._sizeExact !== null) return inp._sizeExact + ' mm measured';
  if (inp._sizeBand) return BAND_TEXT[inp._sizeBand] + ' (band)';
  return 'size not recorded';
}

/* ── Print ──────────────────────────────────────────────────────────────── */

function doPrint() {
  if (!state.lastResult) return;
  buildPrintDoc(state.lastResult, state.lastInput);
  window.print();
}
window.addEventListener('beforeprint', function () {
  if (state.lastResult) buildPrintDoc(state.lastResult, state.lastInput);
});

function buildPrintDoc(r, inp) {
  var m = META[r.tier];
  var now = new Date();
  var stamp = now.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: '2-digit' }) +
              ' · ' + now.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  var h = '';
  h += '<div class="printdoc__head">' +
       '<img class="printdoc__logo" src="assets/bidmc-logo.png" alt="Beth Israel Deaconess Medical Center"/>' +
       '<div class="printdoc__titles"><h2>Incidental Cerebrovascular Finding: Disposition Record</h2>' +
       '<p>ED Triage Disposition Checklist · Neurosurgery &amp; Emergency Medicine</p></div>' +
       '<div class="printdoc__meta">' + escapeHtml(stamp) + '<br/>Decision logic v1.2</div></div>';
  h += '<h3>Recommended disposition</h3><div class="printdoc__disp">' +
       '<p class="name">' + escapeHtml(m.name) + '</p>' +
       '<p class="timing">Timing: ' + escapeHtml(m.timing) + '</p>' +
       '<p class="action">' + escapeHtml(m.action) + '</p></div>';
  h += '<h3>Inputs used</h3><p class="printdoc__tags">' +
       inputTags(inp).map(function (t) { return '<span>' + escapeHtml(t) + '</span>'; }).join('') + '</p>';
  h += '<h3>Basis for this recommendation</h3><ol>' +
       r.trace.map(function (t) { return '<li>' + escapeHtml(t) + '</li>'; }).join('') + '</ol>';
  r.flags.forEach(function (f) {
    h += '<div class="printdoc__flag"><b>Requires clinician judgment.</b> ' + escapeHtml(f) + '</div>';
  });
  h += '<div class="printdoc__safety"><p>Can’t-miss symptoms during the 24-hour safety-net call. ' +
       'If any is reported, instruct the patient to return to the ED immediately.</p><ul>' +
       CANT_MISS_SCRIPT.map(function (s) { return '<li>' + escapeHtml(s) + '</li>'; }).join('') + '</ul></div>';
  h += '<div class="printdoc__signoff">' +
       '<label>Safety-net call completed by<span></span></label>' +
       '<label>Date and time of call<span></span></label>' +
       '<label>Patient reached<span></span></label>' +
       '<label>Appointment booked for<span></span></label>' +
       '<label class="printdoc__notes">Notes<span></span></label></div>';
  h += '<p class="printdoc__foot"><b>Decision support only, not a substitute for clinical judgment.</b> ' +
       'Assumes an incidental finding with no acute bleeding in a discharged, stable patient. Any acute or ' +
       'deteriorating presentation is an emergency regardless of this output. Derived from the ED–Neurosurgery ' +
       'incidental intracranial aneurysm triage protocol (Table 4 decision matrix, Table 5 age modifier). ' +
       'Generated on this device; no patient data was transmitted or stored.</p>';
  el.printDoc.innerHTML = h;
}

/* ── Reset ──────────────────────────────────────────────────────────────── */

function resetForm() {
  qa('input', el.form).forEach(function (i) {
    if (i.type === 'checkbox' || i.type === 'radio') i.checked = false; else i.value = '';
    i.removeAttribute('aria-invalid');
  });
  state.band = null; state.submitted = false;
  state.lastResult = null; state.lastInput = null;
  qa('.band').forEach(function (b) { b.setAttribute('aria-pressed', 'false'); });
  el.verdict.hidden = true;
  el.verdict.innerHTML = '';
  el.printRow.hidden = true;
  el.errorBox.hidden = true;
  el.printDoc.innerHTML = '';
  sync();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else { init(); }

/* Exposed for the test harness. */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    decide: decide, META: META, TIERS: TIERS, sizeBand: sizeBand, ageBand: ageBand,
    DOMAIN: DOMAIN, COLS: COLS, BAND_VALUE: BAND_VALUE
  };
}
