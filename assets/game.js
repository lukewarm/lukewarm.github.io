// Lucky Streak: six classic ways experiments fool people, played inside Fig. 1 on maxhe.org.
//
// On load, level 1 plays by itself as a demo and calls the early leader when nobody answers.
// Answering, or pressing "Play 6 levels", starts the game: three hearts, a score and six levels.
// Every level simulates a test with real statistics. Levels 2 to 6 flip a coin for whether their
// trap is real this time, then redraw the data until it clearly shows the side that came up, so a
// careful reading always wins and "it's always a trap" doesn't.
(function () {
  "use strict";

  var root = document.querySelector("[data-game]");
  if (!root) return;

  // ============================================================== utilities

  function mulberry32(seed) {
    return function () {
      seed = (seed + 0x6d2b79f5) | 0;
      var t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function freshSeed() {
    return (Date.now() ^ Math.floor(Math.random() * 4294967296)) >>> 0;
  }

  function clamp(value, lo, hi) {
    return Math.max(lo, Math.min(hi, value));
  }

  function normalCdf(x) {
    // Abramowitz & Stegun 7.1.26, for x >= 0
    var t = 1 / (1 + 0.3275911 * x / Math.SQRT2);
    var poly = ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t;
    return 1 - 0.5 * poly * Math.exp(-x * x / 2);
  }

  function twoSidedP(z) {
    return 2 * (1 - normalCdf(Math.abs(z)));
  }

  // The chi-square tail with 3 degrees of freedom: Cochran's Q across the four segments.
  function chiSquare3P(q) {
    return twoSidedP(Math.sqrt(q)) + Math.sqrt(2 * q / Math.PI) * Math.exp(-q / 2);
  }

  function gaussian(rand) {
    return Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand());
  }

  // A binomial draw from its normal approximation; every count drawn this way here is large.
  function binomial(rand, n, p) {
    return clamp(Math.round(n * p + Math.sqrt(n * p * (1 - p)) * gaussian(rand)), 0, n);
  }

  function poisson(rand, mean) {
    var limit = Math.exp(-mean), k = 0, product = rand();
    while (product > limit) {
      k += 1;
      product *= rand();
    }
    return k;
  }

  // Benjamini-Hochberg adjusted p-values.
  function bhAdjust(pValues) {
    var m = pValues.length;
    var order = pValues.map(function (p, i) { return i; }).sort(function (a, b) { return pValues[a] - pValues[b]; });
    var adjusted = new Array(m), running = 1;
    for (var rank = m; rank >= 1; rank -= 1) {
      var index = order[rank - 1];
      running = Math.min(running, pValues[index] * m / rank);
      adjusted[index] = Math.min(1, running);
    }
    return adjusted;
  }

  function pct(value, digits) {
    var text = Math.abs(value * 100).toFixed(digits === undefined ? 1 : digits);
    if (Number(text) === 0) return "0%";
    return (value > 0 ? "+" : "−") + text + "%";
  }

  function pctAbs(value, digits) {  // for "up 5%": the size of a change, its sign said in words
    return Math.abs(value * 100).toFixed(digits === undefined ? 1 : digits) + "%";
  }

  function interval(s, digits) {
    return "[" + pct(s.lo, digits) + ", " + pct(s.hi, digits) + "]";
  }

  function fmtP(p) {
    return p < 0.0001 ? "< 0.0001" : p < 0.001 ? p.toFixed(4) : p.toFixed(3);
  }

  function pEquals(p) {
    return p < 0.0001 ? "p < 0.0001" : "p = " + fmtP(p);
  }

  function fmtInt(n) {
    return Math.round(n).toLocaleString("en-US");
  }

  function dollars(x, cents) {
    return "$" + x.toLocaleString("en-US", { minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: cents ? 2 : 0 });
  }

  // Conversion rates: a z-test on the difference, and its 95% interval divided by the control rate
  // as the interval on the relative lift. One statistic for both, so they always agree.
  function compareRates(xc, nc, xt, nt) {
    if (nc < 30 || nt < 30 || xc === 0) return null;
    var pc = xc / nc, pt = xt / nt;
    var se = Math.sqrt(pc * (1 - pc) / (nc - 1) + pt * (1 - pt) / (nt - 1));
    var lift = pt / pc - 1, margin = 1.96 * se / pc;
    return { pc: pc, pt: pt, lift: lift, lo: lift - margin, hi: lift + margin, p: twoSidedP((pt - pc) / se) };
  }

  // Means from running sums: Welch's test with a normal reference (every sample here is large).
  function compareMeans(c, t) {
    if (c.n < 30 || t.n < 30 || c.sum <= 0) return null;
    var mc = c.sum / c.n, mt = t.sum / t.n;
    var vc = Math.max(c.sumSq - c.n * mc * mc, 0) / (c.n - 1) / c.n;
    var vt = Math.max(t.sumSq - t.n * mt * mt, 0) / (t.n - 1) / t.n;
    var se = Math.sqrt(vc + vt);
    var lift = mt / mc - 1, margin = 1.96 * se / mc;
    return { mc: mc, mt: mt, lift: lift, lo: lift - margin, hi: lift + margin, p: twoSidedP((mt - mc) / se) };
  }

  function verdictOf(s) {
    return !s ? "none" : s.lo > 0 ? "treatment" : s.hi < 0 ? "control" : "none";
  }

  // Users arriving this frame. The pace picks up as a test runs: about 15 s to 40,000 at speed 1.
  function arrivals(state, dt, target, speed) {
    state.carry += (240 + 0.25 * state.n) * dt * (speed || 1);
    var count = Math.min(Math.floor(state.carry), target - state.n);
    state.carry -= count;
    return Math.max(0, count);
  }

  function make(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function canvasFont(size, weight) {
    return (weight || 500) + " " + size + 'px "Geist Mono", ui-monospace, Menlo, monospace';
  }

  function drawText(ctx, text, x, y, size, weight, color, align) {
    ctx.font = canvasFont(size, weight);
    ctx.fillStyle = color;
    ctx.textAlign = align || "left";
    ctx.textBaseline = "middle";
    ctx.fillText(text, x, y);
  }

  function capsule(ctx, x, y, w, h) {
    var r = Math.min(w, h) / 2;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.arc(x + w - r, y + r, r, -Math.PI / 2, Math.PI / 2);
    ctx.lineTo(x + r, y + h);
    ctx.arc(x + r, y + r, r, Math.PI / 2, Math.PI * 1.5);
    ctx.closePath();
  }

  // ========================================================== shared pieces

  var STREAM_LABELS =
    '<span class="lane users">Users</span><span class="lane control">Control</span>' +
    '<span class="lane treatment">Treatment</span>' +
    '<span class="legend"><i class="ring"></i>user <i class="dot"></i>converted</span>';

  var FORK_START = 0.3, FORK_END = 0.58, REVEAL = 0.66, LOST_FADE = 0.07;

  // Users streaming left to right and forking into control (top) and treatment (bottom). Only a
  // couple of users per frame are drawn; the rest are counted but not shown.
  function Stream(rand) {
    this.rand = rand;
    this.dots = [];
    this.budget = 0;
  }

  Stream.prototype.add = function (treated, converted, lost, x) {
    var r = this.rand;
    this.dots.push({
      x: x || 0, jitter: r() * 2 - 1, speed: 0.27 + r() * 0.08, size: 2.1 + r() * 1.1,
      treated: treated, converted: converted, lost: lost
    });
  };

  Stream.prototype.maybeAdd = function (treated, converted, lost) {
    if (this.budget > 0 && this.rand() < 0.5) {
      this.add(treated, converted, lost);
      this.budget -= 1;
    }
  };

  Stream.prototype.update = function (dt) {
    this.budget = 2;
    for (var i = 0; i < this.dots.length; i += 1) this.dots[i].x += this.dots[i].speed * dt;
    this.dots = this.dots.filter(function (dot) { return dot.x < 1; });
  };

  // A still sample of users, for reduced motion.
  Stream.prototype.fill = function (count, sample) {
    this.dots = [];
    for (var i = 0; i < count; i += 1) {
      var user = sample();
      this.add(user.treated, user.converted, user.lost, this.rand());
    }
  };

  Stream.prototype.laneY = function (treated) {
    return treated ? 0.74 : 0.26;
  };

  Stream.prototype.dotY = function (dot) {
    var stream = 0.5 + dot.jitter * 0.07;
    var f = clamp((dot.x - FORK_START) / (FORK_END - FORK_START), 0, 1);
    var eased = f * f * (3 - 2 * f);
    var lane = this.laneY(dot.treated) + dot.jitter * 0.1;
    return stream + (lane - stream) * eased;
  };

  Stream.prototype.draw = function (ctx, w, h, colors) {
    var self = this;
    ctx.strokeStyle = colors.rule;
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 5]);
    [true, false].forEach(function (treated) {
      var mid = w * (FORK_START + FORK_END) / 2, lane = h * self.laneY(treated);
      ctx.beginPath();
      ctx.moveTo(0, h * 0.5);
      ctx.lineTo(w * FORK_START, h * 0.5);
      ctx.bezierCurveTo(mid, h * 0.5, mid, lane, w * FORK_END, lane);
      ctx.lineTo(w, lane);
      ctx.stroke();
    });
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(w * REVEAL, h * 0.1);
    ctx.lineTo(w * REVEAL, h * 0.9);
    ctx.stroke();
    for (var i = 0; i < this.dots.length; i += 1) {
      var dot = this.dots[i];
      var x = dot.x * w, y = this.dotY(dot) * h;
      var fade = clamp(Math.min(dot.x / 0.05, (1 - dot.x) / 0.06), 0, 1);
      if (dot.lost && dot.x > FORK_END) {
        var fall = (dot.x - FORK_END) / LOST_FADE;  // drops out of the lane before it can be counted
        if (fall >= 1) continue;
        y += fall * fall * 24;
        fade *= 1 - fall;
      }
      var color = dot.x < FORK_START ? colors.muted : dot.treated ? colors.treatment : colors.control;
      ctx.globalAlpha = fade;
      if (dot.x >= REVEAL && dot.converted) {
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(x, y, dot.size + 1.4, 0, Math.PI * 2);
        ctx.fill();
      } else if (dot.x >= REVEAL) {
        ctx.globalAlpha = fade * 0.35;
        ctx.fillStyle = colors.faint;
        ctx.beginPath();
        ctx.arc(x, y, dot.size * 0.75, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.3;
        ctx.beginPath();
        ctx.arc(x, y, dot.size, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  };

  // A row of labelled numbers under the stage. Returns the value cells.
  function readout(container, cells) {
    var list = make("dl", "readout");
    var values = cells.map(function (cell) {
      var item = make("div");
      item.appendChild(make("dt", "", cell[0]));
      var value = make("dd", cell[1] || "", "—");
      item.appendChild(value);
      list.appendChild(item);
      return value;
    });
    container.appendChild(list);
    return values;
  }

  // A lift and its 95% interval on an axis (default -30% to +30%), with markers for the early look
  // and, once a level is over, the true lift.
  function ciTrack(container, axis) {
    var min = axis ? axis[0] : -0.3, max = axis ? axis[1] : 0.3;
    var box = make("div", "ci");
    var row = make("div", "ci-row");
    var left = make("span");
    var name = make("span", "", "Lift");
    var lift = make("strong", "", "—");
    var rangeLabel = make("span", "ci-label");
    var range = make("span", "", "collecting…");
    left.appendChild(name);
    left.appendChild(document.createTextNode(" "));
    left.appendChild(lift);
    left.appendChild(document.createTextNode("  "));
    left.appendChild(rangeLabel);
    left.appendChild(range);
    var verdict = make("span", "verdict");
    row.appendChild(left);
    row.appendChild(verdict);
    var track = make("div", "track");
    track.setAttribute("aria-hidden", "true");
    var zero = make("span", "zero"), early = make("span", "interval-early"), bar = make("span", "interval");
    var point = make("span", "point"), truth = make("span", "truth-mark");
    [zero, early, bar, point, truth].forEach(function (node) { track.appendChild(node); });
    var ticks = make("div", "ticks");
    ticks.setAttribute("aria-hidden", "true");
    for (var k = 0; k <= 4; k += 1) {
      var value = min + (max - min) * k / 4;
      ticks.appendChild(make("span", "", Math.abs(value) < 1e-9 ? "0" : pct(value, 0)));
    }
    box.appendChild(row);
    box.appendChild(track);
    box.appendChild(ticks);
    container.appendChild(box);

    function position(value) {
      return (clamp(value, min, max) - min) / (max - min) * 100;
    }
    function place(node, s) {
      var a = position(s.lo), b = position(s.hi);
      node.style.left = a + "%";
      node.style.width = Math.max(0.6, b - a) + "%";
    }
    zero.style.left = position(0) + "%";

    return {
      show: function (s, finished, label) {
        name.textContent = label || "Lift";
        if (!s) {
          lift.textContent = "—";
          rangeLabel.textContent = "";
          range.textContent = "collecting…";
          verdict.textContent = "";
          bar.style.width = "0";
          point.style.opacity = "0";
          box.dataset.kind = verdict.dataset.kind = "";
          return;
        }
        var v = verdictOf(s), digits = Math.max(Math.abs(s.lo), Math.abs(s.hi)) >= 1 ? 0 : 1;
        lift.textContent = pct(s.lift, digits);
        rangeLabel.textContent = "95% CI ";
        range.textContent = interval(s, digits);
        verdict.textContent = v === "treatment" ? "significant ↑" : v === "control" ? "significant ↓"
          : finished ? "inconclusive" : "not yet";
        box.dataset.kind = verdict.dataset.kind = v === "treatment" ? "up" : v === "control" ? "down" : "";
        place(bar, s);
        point.style.left = position(s.lift) + "%";
        point.style.opacity = "1";
      },
      early: function (s) {
        if (!s) return;
        place(early, s);
        early.style.opacity = "1";
      },
      truth: function (value) {
        truth.style.left = position(value) + "%";
        truth.style.opacity = "1";
      }
    };
  }

  // ================================================================= levels
  //
  // A level is made from a random source and returns an object with:
  //   key, title, intro, lesson, description (the canvas's label), labels (HTML over the canvas)
  //   choices [{key, label, tone}], prompt (the question before the data is in)
  //   mount(container), refresh(phase)       its numbers under the stage
  //   update(dt, phase)                      advance; return "ask" (or "done" after a call) when ready
  //   draw(ctx, w, h, colors)
  //   status(), askLabel(), question(), summary() (what the canvas shows, in words)
  //   call(choice, auto)                     true if the test runs on after the call (level 1 only)
  //   result()                               {correct, title, message, detail, note}
  //   skipToAsk(), skipToEnd()               the same, without motion
  // Level 1 also has runningLabel() and autoCall(), for the demo.

  // ---------------------------------------------------------- 1. Call it

  function peekingLevel(rand) {
    var EARLY = 4000, FULL = 40000, BASE = 0.1;
    var LIFTS = [0.12, 0, 0.07, -0.1, 0.15, 0, -0.06, 0.1];
    var LABELS = { control: "Control wins", none: "No clear winner", treatment: "Treatment wins" };
    var trueLift = LIFTS[Math.floor(rand() * LIFTS.length)];
    var s = { n: 0, carry: 0, nc: 0, xc: 0, nt: 0, xt: 0 };
    var stream = new Stream(rand);
    var early = null, final = null, choice = null, auto = false, cells, track;

    function sample() {
      var treated = rand() < 0.5;
      return { treated: treated, converted: rand() < BASE * (treated ? 1 + trueLift : 1), lost: false };
    }
    function user() {
      var u = sample();
      if (u.treated) {
        s.nt += 1;
        s.xt += u.converted ? 1 : 0;
      } else {
        s.nc += 1;
        s.xc += u.converted ? 1 : 0;
      }
      s.n += 1;
      return u;
    }
    function stats() {
      return compareRates(s.xc, s.nc, s.xt, s.nt);
    }
    function fillTo(target) {
      while (s.n < target) user();
      stream.fill(220, sample);
    }
    function earlyLeader() {
      return early && early.lift < 0 ? "control" : "treatment";
    }
    // What happened, relative to the early look: following the early leader is the naive call.
    function outcome(right, verdict) {
      var followedLead = choice === earlyLeader();
      if (auto) {
        if (right) return "The early leader held up this time.";
        return verdict === "none" ? "The early lead faded." : "The early lead flipped.";
      }
      if (right) {
        if (verdict === "none") return "Called it.";
        return followedLead ? "Called it: the early lead held up." : "Called it, against the early lead.";
      }
      if (choice === "none") return "The full test found a winner after all.";
      if (verdict === "none") return followedLead ? "The early lead faded." : "Neither side pulled ahead.";
      return followedLead ? "The early lead flipped." : "The early leader was right after all.";
    }
    function truthNote(verdict) {
      var truth = "True lift " + pct(trueLift, 0);
      if (verdict === "none" && trueLift !== 0) return truth + ": real, but too small for this test to see.";
      if (verdict !== "none" && trueLift === 0) return truth + ": a false positive, the 1-in-20 kind.";
      return truth + ".";
    }

    return {
      key: "peeking",
      title: "Call it",
      intro: "An early look at a live test. Predict what the full test will say.",
      lesson: "Early looks swing wildly. Make the call when the test is done.",
      description: "Users stream in, split into a control and a treatment group, and convert or not.",
      labels: STREAM_LABELS,
      choices: [
        { key: "control", label: "Control wins", tone: "control" },
        { key: "none", label: "No clear winner", tone: "neutral" },
        { key: "treatment", label: "Treatment wins", tone: "treatment" }
      ],
      prompt: "What will the full test say?",
      mount: function (container) {
        cells = readout(container, [["Users"], ["Control", "control-value"], ["Treatment", "treatment-value"], ["p-value"]]);
        track = ciTrack(container);
      },
      refresh: function (phase) {
        var r = stats();
        cells[0].textContent = fmtInt(s.n);
        cells[1].textContent = r ? (r.pc * 100).toFixed(2) + "%" : "—";
        cells[2].textContent = r ? (r.pt * 100).toFixed(2) + "%" : "—";
        cells[3].textContent = r ? fmtP(r.p) : "—";
        track.show(r, phase === "reveal");
      },
      status: function () {
        return fmtInt(s.n) + " users";
      },
      update: function (dt, phase) {
        if (phase !== "ask") stream.update(dt);
        if (phase !== "play" && phase !== "continue") return null;
        var target = phase === "play" ? EARLY : FULL;
        var count = arrivals(s, dt, target);
        for (var i = 0; i < count; i += 1) {
          var u = user();
          stream.maybeAdd(u.treated, u.converted, false);
        }
        if (s.n < target) return null;
        if (phase === "play") {
          early = stats();
          return "ask";
        }
        final = stats();
        return "done";
      },
      draw: function (ctx, w, h, colors) {
        stream.draw(ctx, w, h, colors);
      },
      askLabel: function () {
        return "Early look · " + fmtInt(s.n) + " users";
      },
      question: function () {
        return "What will the full test say?";
      },
      autoCall: earlyLeader,
      call: function (key, isAuto) {
        choice = key;
        auto = isAuto;
        track.early(early);
        return true;
      },
      runningLabel: function () {
        return (auto ? "Called for you: " : "Your call: ") + LABELS[choice];
      },
      summary: function () {
        return "";
      },
      skipToAsk: function () {
        fillTo(EARLY);
        early = stats();
      },
      skipToEnd: function () {
        fillTo(FULL);
        final = stats();
      },
      result: function () {
        var verdict = verdictOf(final);
        var right = choice === verdict;
        track.truth(trueLift);
        return {
          correct: right,
          title: LABELS[verdict],
          message: outcome(right, verdict),
          detail: early && final ? "Early look " + pct(early.lift, 0) + " " + interval(early, 0) + " · full test "
            + pct(final.lift, 0) + " " + interval(final, 0) : "",
          note: truthNote(verdict)
        };
      }
    };
  }

  // ------------------------------------------------------- 2. Jelly beans

  var METRICS = ["Clicks", "Sessions", "Shares", "Saves", "Likes", "Replies", "Follows", "Searches", "Scrolls", "Opens",
    "Visits", "Views", "Signups", "Upgrades", "Invites", "Returns", "Comments", "Uploads", "Streaks", "Ratings"];

  function jellyBeansLevel(rand) {
    var USERS = 40000, STEPS = 60, SE = 0.02, SPEED = 2.2;
    var SCALE = SE * Math.sqrt(STEPS);   // a lift, in units of one batch's noise
    var DRIFT = 3.7 / Math.sqrt(STEPS);  // a real effect: an expected z of 3.7 at full size
    var real = rand() < 0.5;
    var target = Math.floor(rand() * METRICS.length);
    var sums = METRICS.map(function () { return new Float64Array(STEPS + 1); });
    var s = { n: 0, carry: 0 }, pick = -1, done = false, choice = null, cells, track;

    function simulate() {
      sums.forEach(function (sum, m) {
        var drift = real && m === target ? DRIFT : 0;
        for (var k = 1; k <= STEPS; k += 1) sum[k] = sum[k - 1] + gaussian(rand) + drift;
      });
    }
    // Metric m after k of STEPS equal batches of users: a z-test whose statistic is a random walk.
    function at(m, k) {
      if (k < 1) return null;
      var lift = SCALE * sums[m][k] / k, margin = 1.96 * SCALE / Math.sqrt(k);
      return { lift: lift, lo: lift - margin, hi: lift + margin, p: twoSidedP(sums[m][k] / Math.sqrt(k)) };
    }
    function batches() {
      return Math.min(STEPS, Math.floor(s.n / USERS * STEPS));
    }
    function finalPs() {
      return METRICS.map(function (name, m) { return at(m, STEPS).p; });
    }
    function lowest(k) {  // the dashboard's top mover
      var best = 0;
      for (var m = 1; m < METRICS.length; m += 1) if (at(m, k).p < at(best, k).p) best = m;
      return best;
    }

    // Redraw until exactly one metric ends significant, and upward: at 0.012 < p < 0.045 when it's
    // luck (clear of 0.05 even when rounded), or p < 0.001 when it's the real one.
    for (var attempt = 0; attempt < 400 && pick < 0; attempt += 1) {
      simulate();
      var ps = finalPs(), hits = [];
      ps.forEach(function (p, m) { if (p < 0.05) hits.push(m); });
      if (hits.length !== 1 || at(hits[0], STEPS).lift <= 0) continue;
      if (real ? hits[0] === target && ps[target] < 0.001 : ps[hits[0]] > 0.012 && ps[hits[0]] < 0.045) pick = hits[0];
    }
    if (pick < 0) pick = lowest(STEPS);

    return {
      key: "beans",
      title: "Jelly beans",
      intro: "One test, 20 metrics. Watch them light up, then judge the one that stays lit.",
      lesson: "Check 20 metrics and about one will cross p < 0.05 by luck. Adjust for how many you looked at.",
      description: "Twenty metrics, drawn as jelly beans, turn green or red while they are significantly up or down.",
      labels: "",
      choices: [
        { key: "luck", label: "Luck", tone: "neutral" },
        { key: "real", label: "Real", tone: "good" }
      ],
      prompt: "Real, or luck?",
      mount: function (container) {
        cells = readout(container, [["Users"], ["Metrics"], ["Significant"], ["Lowest p"]]);
        track = ciTrack(container, [-0.1, 0.1]);
      },
      refresh: function (phase) {
        var k = batches();
        cells[0].textContent = fmtInt(s.n);
        cells[1].textContent = String(METRICS.length);
        if (k < 1) {
          cells[2].textContent = cells[3].textContent = "—";
          track.show(null);
          return;
        }
        var count = 0;
        for (var m = 0; m < METRICS.length; m += 1) if (at(m, k).p < 0.05) count += 1;
        var top = lowest(k);
        cells[2].textContent = String(count);
        cells[3].textContent = fmtP(at(top, k).p);
        track.show(at(top, k), phase === "ask" || phase === "reveal", METRICS[top]);
      },
      status: function () {
        return fmtInt(s.n) + " users · 20 metrics";
      },
      update: function (dt, phase) {
        if (phase !== "play") return null;
        s.n += arrivals(s, dt, USERS, SPEED);
        if (s.n < USERS) return null;
        done = true;
        return "ask";
      },
      draw: function (ctx, w, h, colors) {
        var cols = 5, padX = 6, padY = 8;
        var cellW = (w - 2 * padX) / cols, cellH = (h - 2 * padY) / 4;
        var bw = Math.min(cellW - 10, 96), bh = Math.min(cellH - 14, 38);
        var k = batches();
        for (var m = 0; m < METRICS.length; m += 1) {
          var cx = padX + (m % cols + 0.5) * cellW, cy = padY + (Math.floor(m / cols) + 0.5) * cellH;
          var r = at(m, k), kind = !r || r.p >= 0.05 ? 0 : r.lift > 0 ? 1 : -1;
          ctx.fillStyle = kind > 0 ? colors.good : kind < 0 ? colors.bad : colors.rule;
          capsule(ctx, cx - bw / 2, cy - bh / 2, bw, bh);
          ctx.fill();
          ctx.globalAlpha = 0.28;  // a shine, so they read as beans
          ctx.fillStyle = "#fff";
          ctx.beginPath();
          ctx.ellipse(cx - bw * 0.2, cy - bh * 0.24, bw * 0.2, bh * 0.11, -0.15, 0, Math.PI * 2);
          ctx.fill();
          ctx.globalAlpha = 1;
          if (done && m === pick) {
            ctx.strokeStyle = colors.ink;
            ctx.lineWidth = 2;
            capsule(ctx, cx - bw / 2 - 4, cy - bh / 2 - 4, bw + 8, bh + 8);
            ctx.stroke();
          }
          drawText(ctx, METRICS[m], cx, cy - 5, 9.5, 600, kind ? colors.surface : colors.ink, "center");
          drawText(ctx, r ? pct(r.lift, 1) : "—", cx, cy + 7, 9, 400, kind ? colors.surface : colors.muted, "center");
        }
      },
      askLabel: function () {
        return "Full test · 20 metrics · 1 significant";
      },
      question: function () {
        var r = at(pick, STEPS);
        return METRICS[pick] + " is up " + pctAbs(r.lift, 1) + " (" + pEquals(r.p) + "). Real, or luck?";
      },
      call: function (key) {
        choice = key;
        return false;
      },
      summary: function () {
        var k = batches(), lit = [];
        for (var m = 0; m < METRICS.length; m += 1) {
          var r = at(m, k);
          if (r && r.p < 0.05) lit.push(METRICS[m] + " " + pct(r.lift, 1));
        }
        return lit.length ? "Significant: " + lit.join(", ") + "." : "No metric is significant.";
      },
      skipToAsk: function () {
        s.n = USERS;
        done = true;
      },
      result: function () {
        var adjusted = bhAdjust(finalPs())[pick], trueLift = real ? DRIFT * SCALE : 0;
        track.truth(trueLift);
        if (real) {
          return {
            correct: choice === "real",
            title: "Real",
            message: "Strong enough to survive 20 looks: adjusted for 20 metrics, " + pEquals(adjusted) + ".",
            note: "True lift " + pct(trueLift, 1) + " on " + METRICS[pick] + ". The other 19: zero."
          };
        }
        return {
          correct: choice === "luck",
          title: "Luck",
          message: "With 20 metrics, about one lands under p = 0.05 by chance. Adjusted for 20 looks, " + pEquals(adjusted) + ".",
          note: "True effect on all 20 metrics: zero."
        };
      }
    };
  }

  // ------------------------------------------------------ 3. Broken split

  function brokenSplitLevel(rand) {
    var USERS = 40000, BASE = 0.1, SPEED = 2.2;
    var broken = rand() < 0.5;
    var drop = 0.09 + rand() * 0.04;  // broken: the share of treatment's non-converters never logged
    var lift = 0.08 + rand() * 0.04;  // clean: a real lift about as big as the fake one
    var arm = new Uint8Array(USERS), converted = new Uint8Array(USERS);  // arm 2: treatment, never logged
    var stream = new Stream(rand);
    var s, final = null, choice = null, cells, track;

    function simulate() {
      for (var i = 0; i < USERS; i += 1) {
        var treated = rand() < 0.5;
        var c = rand() < BASE * (treated && !broken ? 1 + lift : 1);
        arm[i] = !treated ? 0 : broken && !c && rand() < drop ? 2 : 1;
        converted[i] = c ? 1 : 0;
      }
    }
    function reset() {
      s = { n: 0, carry: 0, nc: 0, xc: 0, nt: 0, xt: 0, lost: 0 };
    }
    function apply(i) {
      if (arm[i] === 0) {
        s.nc += 1;
        s.xc += converted[i];
      } else if (arm[i] === 1) {
        s.nt += 1;
        s.xt += converted[i];
      } else {
        s.lost += 1;
      }
      s.n += 1;
    }
    function stats() {
      return compareRates(s.xc, s.nc, s.xt, s.nt);
    }
    function srm() {  // the sample-ratio test: is the split what a 50:50 coin would give?
      var n = s.nc + s.nt;
      return twoSidedP((s.nt - n / 2) / Math.sqrt(n / 4));
    }
    function splitText() {
      var n = s.nc + s.nt;
      return (100 * s.nc / n).toFixed(1) + " : " + (100 * s.nt / n).toFixed(1);
    }
    function sampleUser() {
      var i = Math.floor(rand() * USERS);
      return { treated: arm[i] > 0, converted: converted[i] === 1, lost: arm[i] === 2 };
    }

    // Redraw until treatment is significantly up and the sample-ratio test tells the truth plainly.
    for (var attempt = 0; attempt < 60; attempt += 1) {
      simulate();
      reset();
      for (var i = 0; i < USERS; i += 1) apply(i);
      var r = stats(), p = srm();
      if (r && r.lo > 0 && (broken ? p < 0.0001 : p > 0.3)) break;
    }
    reset();

    return {
      key: "split",
      title: "Broken split",
      intro: "A 50:50 test, and treatment looks great. Check it before you ship it.",
      lesson: "Check the split before the lift. If the split is off, so is every number after it.",
      description: "Users stream in and split into control and treatment. Some treatment users may drop out before they are logged.",
      labels: STREAM_LABELS,
      choices: [
        { key: "distrust", label: "Don't trust it", tone: "bad" },
        { key: "ship", label: "Ship it", tone: "good" }
      ],
      prompt: "Ship it?",
      mount: function (container) {
        cells = readout(container, [["Users"], ["Split C : T"], ["Control", "control-value"], ["Treatment", "treatment-value"]]);
        track = ciTrack(container);
      },
      refresh: function (phase) {
        var r = stats(), n = s.nc + s.nt;
        cells[0].textContent = fmtInt(n);
        cells[1].textContent = n ? splitText() : "—";
        cells[2].textContent = r ? (r.pc * 100).toFixed(2) + "%" : "—";
        cells[3].textContent = r ? (r.pt * 100).toFixed(2) + "%" : "—";
        track.show(r, phase === "ask" || phase === "reveal");
      },
      status: function () {
        return fmtInt(s.nc + s.nt) + " users";
      },
      update: function (dt, phase) {
        if (phase !== "ask") stream.update(dt);
        if (phase !== "play") return null;
        var count = arrivals(s, dt, USERS, SPEED);
        for (var k = 0; k < count; k += 1) {
          var i = s.n;
          apply(i);
          stream.maybeAdd(arm[i] > 0, converted[i] === 1, arm[i] === 2);
        }
        if (s.n < USERS) return null;
        final = stats();
        return "ask";
      },
      draw: function (ctx, w, h, colors) {
        stream.draw(ctx, w, h, colors);
      },
      askLabel: function () {
        return "Full test · " + fmtInt(s.nc + s.nt) + " users · planned 50 : 50";
      },
      question: function () {
        return "Treatment is up " + pctAbs(final.lift, 1) + ", and it's significant. Ship it?";
      },
      call: function (key) {
        choice = key;
        return false;
      },
      summary: function () {
        return "Planned 50 : 50. Logged: " + fmtInt(s.nc) + " control users and " + fmtInt(s.nt) + " treatment users.";
      },
      skipToAsk: function () {
        while (s.n < USERS) apply(s.n);
        final = stats();
        stream.fill(220, sampleUser);
      },
      result: function () {
        var p = srm();
        track.truth(broken ? 0 : lift);
        if (broken) {
          return {
            correct: choice === "distrust",
            title: "Broken split",
            message: "Treatment lost " + fmtInt(s.lost) + " users before they were logged, the ones who bounced. That alone fakes a "
              + pct(final.lift, 0) + " lift.",
            note: "Planned 50 : 50, got " + splitText() + ". Sample-ratio test: " + pEquals(p) + ". True lift 0%."
          };
        }
        return {
          correct: choice === "ship",
          title: "Clean win",
          message: "The split held at " + splitText() + ", so the lift is real.",
          note: "Sample-ratio test: " + pEquals(p) + ". True lift " + pct(lift, 0) + "."
        };
      }
    };
  }

  // ---------------------------------------------------- 4. Hidden segment

  var SEGMENTS = [
    { name: "New", share: 0.25, base: 0.14 },
    { name: "Casual", share: 0.3, base: 0.18 },
    { name: "Regular", share: 0.25, base: 0.24 },
    { name: "Power", share: 0.2, base: 0.32 }
  ];

  function hiddenSegmentLevel(rand) {
    var USERS = 60000, SPEED = 2.4, AXIS = 0.3;
    var split = rand() < 0.5;
    // Split: new users gain and power users lose, by about enough to cancel out overall.
    var effects = split
      ? [0.15 + rand() * 0.05, 0.02 * (2 * rand() - 1), 0.02 * (2 * rand() - 1), -(0.08 + rand() * 0.03)]
      : [0, 0, 0, 0];
    var users = new Uint8Array(USERS);  // in arrival order: segment * 4 + arm * 2 + converted
    var totals, s, choice = null, cells, track;

    // The test's final counts: users and conversions in each segment and arm.
    function simulate() {
      var left = USERS, share = 1;
      totals = SEGMENTS.map(function (g, k) {
        var n = k === SEGMENTS.length - 1 ? left : binomial(rand, left, g.share / share);
        var nt = binomial(rand, n, 0.5);
        left -= n;
        share -= g.share;
        return { nc: n - nt, xc: binomial(rand, n - nt, g.base), nt: nt, xt: binomial(rand, nt, g.base * (1 + effects[k])) };
      });
    }
    // Deals the final counts out as users in a random order, so the test fills in like a live one.
    function deal() {
      var i = 0;
      function put(code, count) {
        for (var k = 0; k < count; k += 1) {
          users[i] = code;
          i += 1;
        }
      }
      totals.forEach(function (t, g) {
        put(g * 4 + 1, t.xc);
        put(g * 4, t.nc - t.xc);
        put(g * 4 + 3, t.xt);
        put(g * 4 + 2, t.nt - t.xt);
      });
      for (var j = USERS - 1; j > 0; j -= 1) {
        var r = Math.floor(rand() * (j + 1)), swap = users[j];
        users[j] = users[r];
        users[r] = swap;
      }
    }
    function counts() {
      return { nc: 0, xc: 0, nt: 0, xt: 0 };
    }
    function reset() {
      s = { n: 0, carry: 0, groups: SEGMENTS.map(counts), all: counts() };
    }
    function apply(i) {
      var code = users[i], g = s.groups[code >> 2], c = code & 1;
      if (code & 2) {
        g.nt += 1;
        g.xt += c;
        s.all.nt += 1;
        s.all.xt += c;
      } else {
        g.nc += 1;
        g.xc += c;
        s.all.nc += 1;
        s.all.xc += c;
      }
      s.n += 1;
    }
    function rates(t) {
      return compareRates(t.xc, t.nc, t.xt, t.nt);
    }
    // Cochran's Q: do the segments' lifts differ by more than their noise allows?
    function heterogeneity(rs) {
      var w = 0, wx = 0, q = 0;
      var se = rs.map(function (r) { return (r.hi - r.lo) / (2 * 1.96); });
      rs.forEach(function (r, g) {
        w += 1 / (se[g] * se[g]);
        wx += r.lift / (se[g] * se[g]);
      });
      rs.forEach(function (r, g) { q += Math.pow((r.lift - wx / w) / se[g], 2); });
      return chiSquare3P(q);
    }
    function trueOverall() {
      var base = 0, lifted = 0;
      SEGMENTS.forEach(function (g, k) {
        base += g.share * g.base;
        lifted += g.share * g.base * (1 + effects[k]);
      });
      return lifted / base - 1;
    }

    // Redraw until the overall result is plainly flat and the segments tell the truth plainly: when
    // split, new and power users both clearly move (p < 0.001); when not, exactly one segment
    // flukes to 0.012 < p < 0.045 and the segments don't differ.
    for (var attempt = 0; attempt < 500; attempt += 1) {
      simulate();
      var all = counts(), rs = totals.map(rates);
      totals.forEach(function (t) {
        all.nc += t.nc;
        all.xc += t.xc;
        all.nt += t.nt;
        all.xt += t.xt;
      });
      if (rates(all).p < 0.2) continue;
      var ps = rs.map(function (r) { return r.p; }), lowest = Math.min.apply(null, ps);
      if (split ? rs[0].lo > 0 && rs[0].p < 0.001 && rs[3].hi < 0 && rs[3].p < 0.001
        : ps.filter(function (p) { return p < 0.05; }).length === 1 && lowest > 0.012 && lowest < 0.045 && heterogeneity(rs) > 0.12) break;
    }
    deal();
    reset();

    return {
      key: "segment",
      title: "Hidden segment",
      intro: "Overall, this test looks flat. Break it down by user segment before you call it.",
      lesson: "Break results down by segment, then check that the segments really differ.",
      description: "A forest plot of the lift in four user segments and overall, narrowing as users arrive.",
      labels: "",
      choices: [
        { key: "flat", label: "Nothing happened", tone: "neutral" },
        { key: "split", label: "Some won, some lost", tone: "neutral" }
      ],
      prompt: "What happened?",
      mount: function (container) {
        cells = readout(container, [["Users"], ["Control", "control-value"], ["Treatment", "treatment-value"], ["p-value"]]);
        track = ciTrack(container, [-0.1, 0.1]);
      },
      refresh: function (phase) {
        var r = rates(s.all);
        cells[0].textContent = fmtInt(s.n);
        cells[1].textContent = r ? (r.pc * 100).toFixed(2) + "%" : "—";
        cells[2].textContent = r ? (r.pt * 100).toFixed(2) + "%" : "—";
        cells[3].textContent = r ? fmtP(r.p) : "—";
        track.show(r, phase === "ask" || phase === "reveal", "Overall");
      },
      status: function () {
        return fmtInt(s.n) + " users · 4 segments";
      },
      update: function (dt, phase) {
        if (phase !== "play") return null;
        var count = arrivals(s, dt, USERS, SPEED);
        for (var k = 0; k < count; k += 1) apply(s.n);
        return s.n < USERS ? null : "ask";
      },
      draw: function (ctx, w, h, colors) {
        var rows = SEGMENTS.length + 1, top = 8, bottom = 22;
        var x0 = clamp(w * 0.27, 84, 118), x1 = w - 16, rowH = (h - top - bottom) / rows;
        function X(v) {
          return x0 + (clamp(v, -AXIS, AXIS) + AXIS) / (2 * AXIS) * (x1 - x0);
        }
        ctx.strokeStyle = colors.rule;
        ctx.lineWidth = 1;
        [-0.15, 0.15].forEach(function (v) {
          ctx.beginPath();
          ctx.moveTo(X(v), top);
          ctx.lineTo(X(v), h - bottom);
          ctx.stroke();
        });
        ctx.setLineDash([3, 4]);
        ctx.strokeStyle = colors.faint;
        ctx.beginPath();
        ctx.moveTo(X(0), top);
        ctx.lineTo(X(0), h - bottom);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.strokeStyle = colors.rule;
        ctx.beginPath();
        ctx.moveTo(10, top + SEGMENTS.length * rowH);
        ctx.lineTo(w - 10, top + SEGMENTS.length * rowH);
        ctx.stroke();
        [-0.3, -0.15, 0, 0.15, 0.3].forEach(function (v) {
          drawText(ctx, v === 0 ? "0" : pct(v, 0), X(v), h - 10, 9, 400, colors.muted, "center");
        });
        for (var r = 0; r < rows; r += 1) {
          var overall = r === SEGMENTS.length, y = top + (r + 0.5) * rowH;
          var stats = rates(overall ? s.all : s.groups[r]);
          if (overall) {
            drawText(ctx, "Overall", 10, y, 10, 600, colors.ink);
          } else {
            drawText(ctx, SEGMENTS[r].name, 10, y - 6, 10, 500, colors.ink);
            drawText(ctx, Math.round(SEGMENTS[r].share * 100) + "% of users", 10, y + 7, 9, 400, colors.muted);
          }
          if (!stats) continue;
          var kind = verdictOf(stats);
          var color = kind === "treatment" ? colors.good : kind === "control" ? colors.bad : colors.faint;
          var a = X(stats.lo), b = X(stats.hi), c = X(stats.lift);
          ctx.fillStyle = color;
          if (overall) {  // the forest plot's diamond
            ctx.beginPath();
            ctx.moveTo(a, y);
            ctx.lineTo(c, y - 6);
            ctx.lineTo(b, y);
            ctx.lineTo(c, y + 6);
            ctx.closePath();
            ctx.fill();
          } else {
            ctx.fillRect(a, y - 2, Math.max(1, b - a), 4);
            ctx.fillStyle = colors.ink;
            ctx.beginPath();
            ctx.arc(c, y, 3.6, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      },
      askLabel: function () {
        return "Full test · " + fmtInt(USERS) + " users · 4 segments";
      },
      question: function () {
        return "Overall, no clear winner. What happened?";
      },
      call: function (key) {
        choice = key;
        return false;
      },
      summary: function () {
        return SEGMENTS.map(function (g, k) {
          var r = rates(s.groups[k]);
          return g.name + " users " + (r ? pct(r.lift, 0) + " " + interval(r, 0) + ", " + pEquals(r.p) : "not in yet");
        }).join("; ") + ".";
      },
      skipToAsk: function () {
        while (s.n < USERS) apply(s.n);
      },
      result: function () {
        var rs = s.groups.map(rates), q = heterogeneity(rs);
        track.truth(trueOverall());
        if (split) {
          return {
            correct: choice === "split",
            title: "Some won, some lost",
            message: "New users " + pct(rs[0].lift, 0) + ", power users " + pct(rs[3].lift, 0) + ": both real. The flat average hid them.",
            note: "Segments differ: heterogeneity " + pEquals(q) + ". True lifts: new " + pct(effects[0], 0)
              + ", power " + pct(effects[3], 0) + "."
          };
        }
        var lucky = 0;
        rs.forEach(function (r, g) { if (r.p < rs[lucky].p) lucky = g; });
        return {
          correct: choice === "flat",
          title: "Nothing happened",
          message: SEGMENTS[lucky].name + " users' " + pct(rs[lucky].lift, 0) + " (" + pEquals(rs[lucky].p)
            + ") is one lucky slice of four. Nothing really moved.",
          note: "Segments don't differ: heterogeneity " + pEquals(q) + ". True lift 0% in every segment."
        };
      }
    };
  }

  // --------------------------------------------------------- 5. The whale

  function whaleLevel(rand) {
    var USERS = 40000, BUY = 0.06, MEDIAN = 28, SIGMA = 0.85, SPEED = 2.2, LOG_MAX = 4.2;
    var BUY_LIFT = 0.06, SIZE_LIFT = 0.12, TRUE_LIFT = (1 + BUY_LIFT) * (1 + SIZE_LIFT) - 1;
    var whale = rand() < 0.5;
    var arm = new Uint8Array(USERS), spend = new Float64Array(USERS);
    var whaleAt = -1, biggest = 0, purchases = [], s, clock = 0, choice = null, cells, track;

    function simulate() {
      for (var i = 0; i < USERS; i += 1) {
        var treated = rand() < 0.5, lifted = treated && !whale;
        arm[i] = treated ? 1 : 0;
        spend[i] = rand() < BUY * (lifted ? 1 + BUY_LIFT : 1)
          ? MEDIAN * Math.exp(SIGMA * gaussian(rand)) * (lifted ? 1 + SIZE_LIFT : 1) : 0;
      }
      if (whale) {  // one huge order, landing in treatment partway through the test
        whaleAt = Math.floor(USERS * (0.45 + 0.25 * rand()));
        arm[whaleAt] = 1;
        spend[whaleAt] = 8000 + 4000 * rand();
      }
      biggest = 0;
      for (var j = 1; j < USERS; j += 1) if (spend[j] > spend[biggest]) biggest = j;
    }
    function sums() {
      return [{ n: 0, sum: 0, sumSq: 0 }, { n: 0, sum: 0, sumSq: 0 }];
    }
    function totals(upTo, skip) {
      var t = sums();
      for (var i = 0; i < upTo; i += 1) {
        if (i === skip) continue;
        var g = t[arm[i]];
        g.n += 1;
        g.sum += spend[i];
        g.sumSq += spend[i] * spend[i];
      }
      return compareMeans(t[0], t[1]);
    }
    function reset() {
      s = { n: 0, carry: 0, groups: sums(), shown: 0 };
    }
    function apply(i) {
      var g = s.groups[arm[i]];
      g.n += 1;
      g.sum += spend[i];
      g.sumSq += spend[i] * spend[i];
      s.n += 1;
      while (s.shown < purchases.length && purchases[s.shown].user < s.n) {
        purchases[s.shown].born = clock;
        s.shown += 1;
      }
    }
    function stats() {
      return compareMeans(s.groups[0], s.groups[1]);
    }

    // Redraw until the story is plain: with the whale, a big lift that vanishes without that one
    // order; without it, a broad, significant lift and no order anywhere near whale size.
    for (var attempt = 0; attempt < 120; attempt += 1) {
      simulate();
      var all = totals(USERS, -1);
      if (whale) {
        var without = totals(USERS, whaleAt);
        if (all.lift > 0.15 && all.lift < 0.45 && all.p > 0.1 && Math.abs(without.lift) < 0.05 && without.p > 0.2) break;
      } else if (all.p < 0.01 && all.lift > 0.1 && all.lift < 0.3 && spend[biggest] < 1500) {
        break;
      }
    }
    for (var i = 0; i < USERS; i += 1) {
      if (spend[i] > 0) purchases.push({ user: i, arm: arm[i], amount: spend[i], jitter: rand() * 2 - 1, born: -1 });
    }
    reset();

    return {
      key: "whale",
      title: "The whale",
      intro: "Revenue per user is up in treatment. Find out who's behind it.",
      lesson: "A mean can be one person. See who drives a revenue lift, and cap outliers before you celebrate.",
      description: "Every purchase in the test as a dot, by order size on a log scale, for control and treatment.",
      labels: "",
      choices: [
        { key: "whale", label: "One big spender", tone: "neutral" },
        { key: "real", label: "Everyone spent more", tone: "good" }
      ],
      prompt: "What's behind it?",
      mount: function (container) {
        cells = readout(container, [["Users"], ["Control", "control-value"], ["Treatment", "treatment-value"], ["p-value"]]);
        track = ciTrack(container, [-0.5, 0.5]);
      },
      refresh: function (phase) {
        var r = stats();
        cells[0].textContent = fmtInt(s.n);
        cells[1].textContent = r ? dollars(r.mc, true) : "—";
        cells[2].textContent = r ? dollars(r.mt, true) : "—";
        cells[3].textContent = r ? fmtP(r.p) : "—";
        track.show(r, phase === "ask" || phase === "reveal", "Revenue/user");
      },
      status: function () {
        return fmtInt(s.n) + " users · " + fmtInt(s.shown) + " orders";
      },
      update: function (dt, phase) {
        clock += dt;
        if (phase !== "play") return null;
        var count = arrivals(s, dt, USERS, SPEED);
        for (var k = 0; k < count; k += 1) apply(s.n);
        return s.n < USERS ? null : "ask";
      },
      draw: function (ctx, w, h, colors) {
        var x0 = clamp(w * 0.24, 78, 104), x1 = w - 16, axisY = h - 11;
        var lanes = [h * 0.3, h * 0.66], band = h * 0.1;
        function X(amount) {
          return x0 + clamp(Math.log(Math.max(1, amount)) / Math.LN10 / LOG_MAX, 0, 1) * (x1 - x0);
        }
        ctx.strokeStyle = colors.rule;
        ctx.lineWidth = 1;
        ["$1", "$10", "$100", "$1k", "$10k"].forEach(function (text, k) {
          var x = X(Math.pow(10, k));
          ctx.beginPath();
          ctx.moveTo(x, 8);
          ctx.lineTo(x, axisY - 10);
          ctx.stroke();
          drawText(ctx, text, x, axisY, 9, 400, colors.muted, "center");
        });
        drawText(ctx, "Control", 10, lanes[0], 9.5, 600, colors.control);
        drawText(ctx, "Treatment", 10, lanes[1], 9.5, 600, colors.treatment);
        drawText(ctx, "Order size", 10, axisY, 9, 400, colors.muted);
        var big = [];
        [0, 1].forEach(function (g) {
          ctx.fillStyle = g ? colors.treatment : colors.control;
          ctx.globalAlpha = 0.45;
          ctx.beginPath();
          for (var k = 0; k < s.shown; k += 1) {
            var p = purchases[k];
            if (p.arm !== g) continue;
            if (p.amount >= 1000) {
              big.push(p);
              continue;
            }
            var x = X(p.amount), y = lanes[g] + p.jitter * band, r = 2 * Math.min(1, (clock - p.born) / 0.25);
            ctx.moveTo(x + r, y);
            ctx.arc(x, y, r, 0, Math.PI * 2);
          }
          ctx.fill();
        });
        ctx.globalAlpha = 1;
        big.forEach(function (p) {
          var age = clock - p.born, x = X(p.amount), y = lanes[p.arm] + p.jitter * band * 0.4;
          var r = (2 + 4 * Math.log(p.amount / 300) / Math.LN10) * Math.min(1, age / 0.35);
          if (age < 0.9) {  // a splash as it lands
            ctx.strokeStyle = p.arm ? colors.treatment : colors.control;
            ctx.globalAlpha = 1 - age / 0.9;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(x, y, r + 30 * age, 0, Math.PI * 2);
            ctx.stroke();
            ctx.globalAlpha = 1;
          }
          ctx.fillStyle = p.arm ? colors.treatment : colors.control;
          ctx.beginPath();
          ctx.arc(x, y, r, 0, Math.PI * 2);
          ctx.fill();
          drawText(ctx, dollars(p.amount), Math.min(x1, x + r), y - r - 8, 9.5, 600, colors.ink, "right");
        });
      },
      askLabel: function () {
        return "Full test · " + fmtInt(USERS) + " users · " + fmtInt(purchases.length) + " orders";
      },
      question: function () {
        return "Revenue per user is up " + pctAbs(stats().lift, 0) + ". What's behind it?";
      },
      call: function (key) {
        choice = key;
        return false;
      },
      summary: function () {
        if (!s.shown) return "No orders yet.";
        var top = purchases[0];
        for (var k = 1; k < s.shown; k += 1) if (purchases[k].amount > top.amount) top = purchases[k];
        return "Most orders are $10 to $100. The biggest, " + dollars(top.amount) + ", is in " + (top.arm ? "treatment." : "control.");
      },
      skipToAsk: function () {
        while (s.n < USERS) apply(s.n);
        purchases.forEach(function (p) { p.born = -10; });
      },
      result: function () {
        var r = stats();
        track.truth(whale ? 0 : TRUE_LIFT);
        if (whale) {
          var without = totals(USERS, whaleAt);
          return {
            correct: choice === "whale",
            title: "One big spender",
            message: "One " + dollars(spend[whaleAt]) + " order. Without it, revenue per user is " + pct(without.lift, 1) + ".",
            note: "The t-test wasn't fooled (" + pEquals(r.p) + "), but the headline was. True lift 0%."
          };
        }
        return {
          correct: choice === "real",
          title: "Everyone spent more",
          message: "More buyers and bigger baskets, with no single order behind it.",
          note: pEquals(r.p) + ". Without the biggest order, still " + pct(totals(USERS, biggest).lift, 0) + ". True lift "
            + pct(TRUE_LIFT, 0) + "."
        };
      }
    };
  }

  // ------------------------------------------------ 6. Too good to be true

  function tooGoodLevel(rand) {
    var USERS = 40000, CLICKS = 0.45, BUY = 0.05, SPEED = 2.2, BINS = 11;
    var bug = rand() < 0.5;
    var factor = 2.5 + 0.8 * rand();    // real: treatment fixed a broken button, multiplying clicks
    var buyLift = 0.3 + 0.15 * rand();  // ...and purchases follow
    var arm = new Uint8Array(USERS), clicks = new Uint8Array(USERS), bought = new Uint8Array(USERS);
    var s, tallest = 1, choice = null, cells, track;

    function simulate() {
      for (var i = 0; i < USERS; i += 1) {
        var treated = rand() < 0.5, fixed = treated && !bug;
        var real = poisson(rand, CLICKS * (fixed ? factor : 1));
        arm[i] = treated ? 1 : 0;
        clicks[i] = Math.min(255, treated && bug ? 3 * real : real);  // the bug logs every click three times
        bought[i] = rand() < BUY * (fixed ? 1 + buyLift : 1) ? 1 : 0;
      }
    }
    function group() {
      var hist = [];
      for (var b = 0; b < BINS; b += 1) hist.push(0);
      return { n: 0, sum: 0, sumSq: 0, buys: 0, hist: hist };
    }
    function reset() {
      s = { n: 0, carry: 0, groups: [group(), group()] };
    }
    function apply(i) {
      var g = s.groups[arm[i]], c = clicks[i];
      g.n += 1;
      g.sum += c;
      g.sumSq += c * c;
      g.buys += bought[i];
      g.hist[Math.min(BINS - 1, c)] += 1;
      s.n += 1;
    }
    function clickStats() {
      return compareMeans(s.groups[0], s.groups[1]);
    }
    function buyStats() {
      var c = s.groups[0], t = s.groups[1];
      return compareRates(c.buys, c.n, t.buys, t.n);
    }

    // Redraw until purchases tell the truth plainly: flat with the bug, clearly up with the fix.
    for (var attempt = 0; attempt < 60; attempt += 1) {
      simulate();
      reset();
      for (var i = 0; i < USERS; i += 1) apply(i);
      var b = buyStats();
      if (bug ? b.p > 0.2 : b.p < 0.001) break;
    }
    s.groups.forEach(function (g) { tallest = Math.max.apply(null, [tallest].concat(g.hist)); });
    reset();

    return {
      key: "toogood",
      title: "Too good to be true",
      intro: "Clicks per user are through the roof. Celebrate, or investigate?",
      lesson: "Twyman's law: a result that looks too good to be true usually is. Look for the bug first.",
      description: "Histograms of clicks per user in control and treatment, filling in as users arrive.",
      labels: "",
      choices: [
        { key: "bug", label: "Find the bug", tone: "bad" },
        { key: "ship", label: "Ship it", tone: "good" }
      ],
      prompt: "Ship it?",
      mount: function (container) {
        cells = readout(container, [["Users"], ["Control", "control-value"], ["Treatment", "treatment-value"], ["Purchases"]]);
        track = ciTrack(container, [-1, 3]);
      },
      refresh: function (phase) {
        var r = clickStats(), b = buyStats();
        cells[0].textContent = fmtInt(s.n);
        cells[1].textContent = r ? r.mc.toFixed(2) : "—";
        cells[2].textContent = r ? r.mt.toFixed(2) : "—";
        cells[3].textContent = b ? pct(b.lift, 1) : "—";
        track.show(r, phase === "ask" || phase === "reveal", "Clicks/user");
      },
      status: function () {
        return fmtInt(s.n) + " users · clicks per user";
      },
      update: function (dt, phase) {
        if (phase !== "play") return null;
        var count = arrivals(s, dt, USERS, SPEED);
        for (var k = 0; k < count; k += 1) apply(s.n);
        return s.n < USERS ? null : "ask";
      },
      draw: function (ctx, w, h, colors) {
        var x0 = clamp(w * 0.24, 78, 104), x1 = w - 12, binW = (x1 - x0) / BINS;
        var bases = [h * 0.42, h * 0.8], maxH = h * 0.3;
        s.groups.forEach(function (g, k) {
          var base = bases[k], color = k ? colors.treatment : colors.control;
          drawText(ctx, k ? "Treatment" : "Control", 10, base - maxH * 0.4, 9.5, 600, color);
          ctx.strokeStyle = colors.rule;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(x0, base + 0.5);
          ctx.lineTo(x1, base + 0.5);
          ctx.stroke();
          ctx.fillStyle = color;
          for (var b = 0; b < BINS; b += 1) {
            var height = Math.sqrt(g.hist[b] / tallest) * maxH;  // square-root scale, so small bars show
            if (height > 0) ctx.fillRect(x0 + (b + 0.18) * binW, base - height, binW * 0.64, height);
          }
        });
        for (var b = 0; b < BINS; b += 1) {
          drawText(ctx, b === BINS - 1 ? "10+" : String(b), x0 + (b + 0.5) * binW, bases[1] + 11, 9, 400, colors.muted, "center");
        }
        drawText(ctx, "Clicks/user", 10, bases[1] + 11, 9, 400, colors.muted);
      },
      askLabel: function () {
        return "Full test · " + fmtInt(USERS) + " users";
      },
      question: function () {
        return "Clicks per user are up " + pctAbs(clickStats().lift, 0) + ". Ship it?";
      },
      call: function (key) {
        choice = key;
        return false;
      },
      summary: function () {
        return s.groups.map(function (g, k) {
          var shares = [];
          g.hist.forEach(function (count, b) {
            if (g.n && count >= 0.01 * g.n) shares.push(Math.round(100 * count / g.n) + "% with " + (b === BINS - 1 ? "10 or more" : b));
          });
          return (k ? "Treatment" : "Control") + " clicks per user: " + (shares.join(", ") || "not in yet");
        }).join(". ") + ".";
      },
      skipToAsk: function () {
        while (s.n < USERS) apply(s.n);
      },
      result: function () {
        var b = buyStats();
        track.truth(bug ? 0 : factor - 1);
        if (bug) {
          return {
            correct: choice === "bug",
            title: "A logging bug",
            message: "Treatment logged every click three times. Purchases: " + pct(b.lift, 1) + ", " + pEquals(b.p) + ".",
            note: "Treatment users have 0, 3, 6 or 9 clicks, never 1 or 2. True lift 0%."
          };
        }
        return {
          correct: choice === "ship",
          title: "A real win",
          message: "Purchases rose " + pct(b.lift, 0) + " too, and the clicks look natural.",
          note: "Treatment fixed a button that was broken on most phones. True lift " + pct(factor - 1, 0) + "."
        };
      }
    };
  }

  // =================================================================== game

  var LEVELS = [peekingLevel, jellyBeansLevel, brokenSplitLevel, hiddenSegmentLevel, whaleLevel, tooGoodLevel];
  var HEARTS = 3;
  var BONUS = 50, BONUS_SECONDS = 10;  // a speed bonus that runs out after BONUS_SECONDS
  var DEMO_ASK = 8;                    // seconds before the demo calls the early leader
  var DEMO_HOLD = 10;                  // seconds a demo result stays up
  var CAPTIONS = {
    demo: "Make your call at the early look, then watch the full test settle it. Telling real lifts from lucky streaks is my day job.",
    game: "Six classic ways an experiment can fool you. Telling real lifts from lucky streaks is my day job."
  };
  var RANKS = [[6, "p-value whisperer"], [5, "Staff-level skeptic"], [4, "Cautious analyst"]];

  var dom = {};
  ["label", "title", "hearts", "score", "pause", "start", "labels", "card", "stats", "console", "caption", "live"].forEach(function (name) {
    dom[name] = root.querySelector("[data-game-" + name + "]");
  });
  var canvas = root.querySelector("canvas");
  var ctx = canvas.getContext("2d");
  var stage = root.querySelector(".stage");
  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  var coarsePointer = window.matchMedia("(pointer: coarse)");

  var game = {
    mode: "demo", index: 0, level: null, phase: "idle", phaseTime: 0,
    hearts: HEARTS, score: 0, streak: 0, results: [], choice: null, bonus: 0
  };
  var colors = {}, width = 0, height = 0;
  var running = false, paused = false, onScreen = true, frameId = 0, lastTime = 0, lastRefresh = 0;
  var live = {};  // console parts that change every frame

  // ------------------------------------------------------------ level flow
  //
  // Each step below notes whether keyboard focus was on the card or the console, whose controls it
  // is about to replace, and if so puts focus on whatever comes next.

  function startLevel(index) {
    var hadFocus = controlsHaveFocus();
    game.index = index;
    game.level = LEVELS[index](mulberry32(freshSeed()));
    game.choice = null;
    dom.labels.innerHTML = game.level.labels;
    dom.stats.innerHTML = "";
    game.level.mount(dom.stats);
    root.dataset.level = game.level.key;
    delete root.dataset.correct;
    if (game.mode === "game") {  // a title card, up until the player starts the level
      setPhase("intro");
      showIntro();
      game.level.refresh("intro");
      renderHeader();
      renderConsole();
      describeCanvas();
      draw();
      announce("Level " + (game.index + 1) + " of " + LEVELS.length + ", " + game.level.title + ". " + game.level.intro);
    } else {
      beginPlay();
    }
    if (hadFocus) placeFocus();
  }

  function beginPlay() {
    var hadFocus = controlsHaveFocus();
    dom.card.hidden = true;
    if (reduceMotion.matches) {
      game.level.skipToAsk();
      ask();
    } else {
      setPhase("play");
      game.level.refresh("play");
      renderConsole();
      describeCanvas();
      ensureRunning();
    }
    renderHeader();
    if (hadFocus) placeFocus();
  }

  function ask() {
    var hadFocus = controlsHaveFocus();
    setPhase("ask");
    game.level.refresh("ask");
    draw();
    renderConsole();
    describeCanvas();
    announce(game.level.askLabel() + ". " + game.level.question() + " " + game.level.summary());
    if (hadFocus) placeFocus();
  }

  function makeCall(choice, auto) {
    if (game.phase !== "ask") return;
    var hadFocus = controlsHaveFocus();
    if (!auto) {
      if (game.mode === "demo") enterGame();
      setPaused(false);
    }
    game.choice = choice;
    game.bonus = game.mode === "game" && !reduceMotion.matches ? Math.round(bonusLeft()) : 0;
    if (!game.level.call(choice, auto)) {
      reveal();
    } else if (reduceMotion.matches) {
      game.level.skipToEnd();
      reveal();
    } else {
      setPhase("continue");
      game.level.refresh("continue");
      renderConsole();
    }
    ensureRunning();
    if (hadFocus) placeFocus();
  }

  function reveal() {
    var hadFocus = controlsHaveFocus();
    var result = game.level.result(), scored = null;
    if (game.mode === "game") {
      game.results.push(result.correct);
      if (result.correct) {
        var multiplier = Math.min(3, game.streak + 1);
        scored = { points: (100 + game.bonus) * multiplier, multiplier: multiplier };
        game.score += scored.points;
        game.streak += 1;
      } else {
        game.hearts -= 1;
        game.streak = 0;
      }
    }
    root.dataset.correct = String(result.correct);
    setPhase("reveal");
    game.level.refresh("reveal");
    draw();
    renderHeader();
    renderConsole(result, scored);
    describeCanvas();
    announce((result.correct ? "Right. " : "Wrong. ") + result.title + ". " + result.message + " " + (result.note || ""));
    if (hadFocus) placeFocus();
  }

  function next() {
    setPaused(false);
    bringIntoView();
    if (game.hearts <= 0 || game.index + 1 >= LEVELS.length) finishGame(); else startLevel(game.index + 1);
  }

  function enterGame() {
    game.mode = "game";
    game.hearts = HEARTS;
    game.score = 0;
    game.streak = 0;
    game.results = [];
    root.dataset.mode = "game";
    dom.caption.textContent = CAPTIONS.game;
    renderHeader();
  }

  function startGame() {
    stop();
    setPaused(false);
    enterGame();
    bringIntoView();
    startLevel(0);
  }

  function startDemo() {
    stop();
    game.mode = "demo";
    root.dataset.mode = "demo";
    dom.caption.textContent = CAPTIONS.demo;
    startLevel(0);
    ensureRunning();
  }

  // --------------------------------------------------------------- the end

  function readBest() {
    try {
      return Number(localStorage.getItem("luckyStreakBest")) || 0;
    } catch (e) {
      return 0;
    }
  }

  function saveBest(score) {
    try {
      localStorage.setItem("luckyStreakBest", String(score));
    } catch (e) {
      /* storage can be unavailable; the best score then lasts for this visit */
    }
  }

  function finishGame() {
    var hadFocus = controlsHaveFocus();
    stop();
    setPhase("final");
    var right = game.results.filter(Boolean).length, finished = game.hearts > 0;
    var best = readBest(), newBest = game.score > best;
    if (newBest) saveBest(game.score);
    var rank = "Fooled by randomness";
    if (finished) {
      for (var i = RANKS.length - 1; i >= 0; i -= 1) if (right >= RANKS[i][0]) rank = RANKS[i][1];
    }
    var squares = game.results.map(function (ok) { return ok ? "🟩" : "🟥"; }).join("")
      + "⬜".repeat(LEVELS.length - game.results.length);

    dom.card.innerHTML = "";
    dom.card.appendChild(make("span", "card-label", finished ? "Lucky Streak · all " + LEVELS.length + " levels"
      : "Out of hearts on level " + (game.index + 1)));
    dom.card.appendChild(make("span", "card-title", rank));
    dom.card.appendChild(make("span", "card-squares", squares)).setAttribute("aria-hidden", "true");
    dom.card.appendChild(make("span", "card-text", right + " of " + game.results.length + " right · " + fmtInt(game.score) + " points"));
    dom.card.appendChild(make("span", "card-note", newBest ? "A new personal best." : "Your best: " + fmtInt(best) + " points."));
    dom.card.hidden = false;

    var shareText = "Lucky Streak " + right + "/" + LEVELS.length + " " + squares + " " + fmtInt(game.score) + " points ("
      + rank + ")\nhttps://maxhe.org/#play";
    dom.console.innerHTML = "";
    live = {};
    dom.console.appendChild(make("p", "console-label", "Game over"));
    dom.console.appendChild(make("p", "console-question", finished ? "You made it through all six." : "The randomness won this time."));
    var actions = make("div", "actions");
    var share = make("button", "choice primary", "Share result");
    share.type = "button";
    share.addEventListener("click", function () {
      if (navigator.share && coarsePointer.matches) {
        navigator.share({ text: shareText }).catch(function () {});
      } else if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(shareText).then(function () {
          share.textContent = "Copied";
          announce("Your result is copied.");
        }, function () {
          share.textContent = "Couldn't copy";
        });
      }
    });
    var again = make("button", "choice", "Play again");
    again.type = "button";
    again.addEventListener("click", startGame);
    actions.appendChild(share);
    actions.appendChild(again);
    dom.console.appendChild(actions);
    renderHeader();
    announce("Game over. " + rank + ": " + right + " of " + game.results.length + " right, " + game.score + " points.");
    if (hadFocus) placeFocus();
  }

  // ------------------------------------------------------------- rendering

  function setPhase(phase) {
    game.phase = phase;
    game.phaseTime = 0;
    root.dataset.phase = phase;
  }

  // Short text on screen, and the words for screen readers.
  function setLabel(node, shown, spoken) {
    node.innerHTML = "";
    node.appendChild(make("span", "", shown)).setAttribute("aria-hidden", "true");
    node.appendChild(make("span", "visually-hidden", spoken));
  }

  function renderHeader() {
    var playing = game.mode === "game", hearts = Math.max(0, game.hearts), over = game.phase === "final";
    dom.label.textContent = over ? "Lucky Streak" : playing ? "Level " + (game.index + 1) + "/" + LEVELS.length : "Fig. 1";
    dom.title.textContent = over ? "Game over" : game.level ? game.level.title : "";
    dom.hearts.hidden = dom.score.hidden = !playing;
    setLabel(dom.hearts, "♥".repeat(hearts) + "♡".repeat(HEARTS - hearts), hearts + (hearts === 1 ? " heart" : " hearts") + " left");
    setLabel(dom.score, fmtInt(game.score) + " pts", "Score " + fmtInt(game.score));
    dom.pause.hidden = reduceMotion.matches || over;
    dom.start.textContent = playing ? "Restart" : "Play " + LEVELS.length + " levels";
  }

  function showIntro() {
    dom.card.innerHTML = "";
    dom.card.appendChild(make("span", "card-label", "Level " + (game.index + 1) + " of " + LEVELS.length));
    dom.card.appendChild(make("span", "card-title", game.level.title));
    dom.card.appendChild(make("span", "card-text", game.level.intro));
    var start = make("button", "choice primary", "Start");
    start.type = "button";
    start.addEventListener("click", function () {
      setPaused(false);
      beginPlay();
    });
    dom.card.appendChild(start);
    dom.card.hidden = false;
  }

  // The canvas's text alternative: what it shows and, once the data is in, what it says.
  function describeCanvas() {
    var summary = game.phase === "ask" || game.phase === "reveal" ? game.level.summary() : "";
    canvas.setAttribute("aria-label", game.level.description + (summary ? " " + summary : ""));
  }

  function statusText() {
    var level = game.level;
    if (game.phase === "intro") return "Get ready";
    if (game.phase === "continue") return level.runningLabel() + " · " + level.status();
    return "Live test · " + level.status();
  }

  function renderConsole(result, scored) {
    dom.console.innerHTML = "";
    live = {};
    if (game.phase === "reveal") renderResult(result, scored); else renderQuestion();
  }

  function renderQuestion() {
    var level = game.level, phase = game.phase, asking = phase === "ask";
    var label = make("p", "console-label", asking ? level.askLabel() : statusText());
    if (!asking) live.status = label;
    dom.console.appendChild(label);
    if (asking) {
      dom.console.appendChild(make("p", "console-question", level.question()));
    } else if (phase === "play" && game.mode === "game") {
      dom.console.appendChild(make("p", "console-brief", level.intro));  // the instructions, while the test runs
    } else {
      dom.console.appendChild(make("p", "console-question waiting", phase === "continue" ? "Running the full test…" : level.prompt));
    }
    var choices = make("div", "choices");
    level.choices.forEach(function (choice) {
      var button = make("button", "choice", choice.label);
      button.type = "button";
      button.dataset.choice = choice.key;
      button.dataset.tone = choice.tone;
      button.disabled = !asking;
      if (phase === "continue" && choice.key === game.choice) button.setAttribute("aria-pressed", "true");
      button.addEventListener("click", function () { makeCall(choice.key, false); });
      choices.appendChild(button);
    });
    dom.console.appendChild(choices);
    var foot = make("div", "console-foot");
    if (asking && !reduceMotion.matches) {
      var bar = make("span", "timer");
      live.timer = make("span");
      bar.appendChild(live.timer);
      foot.appendChild(bar);
      live.timerText = make("span", "console-note");
      foot.appendChild(live.timerText);
    } else if (asking) {
      foot.appendChild(make("span", "console-note", "Take your time."));
    }
    dom.console.appendChild(foot);
    updateTimer();
  }

  function renderResult(result, scored) {
    var head = make("div", "result-head");
    if (game.mode === "game") {
      head.appendChild(make("span", "badge", result.correct ? "✓ Right" : "✗ Wrong"));
      head.appendChild(make("span", "points", scored ? "+" + fmtInt(scored.points) + " pts"
        + (scored.multiplier > 1 ? " · ×" + scored.multiplier + " streak" : "") : "−1 heart"));
    } else {
      head.appendChild(make("span", "console-label", "The full test says"));
    }
    dom.console.appendChild(head);
    dom.console.appendChild(make("p", "result-title", result.title));
    dom.console.appendChild(make("p", "result-message", result.message));
    if (result.detail) dom.console.appendChild(make("p", "result-detail", result.detail));
    if (result.note) dom.console.appendChild(make("p", "result-note", result.note));
    var foot = make("div", "result-foot"), button;
    if (game.mode === "game") {
      var last = game.hearts <= 0 || game.index + 1 >= LEVELS.length;
      foot.appendChild(make("p", "result-lesson", game.level.lesson));
      button = make("button", "choice primary", last ? "See your result" : "Next level →");
      button.addEventListener("click", next);
    } else {
      button = make("button", "choice primary", "Play all " + LEVELS.length + " levels →");
      button.addEventListener("click", startGame);
    }
    button.type = "button";
    foot.appendChild(button);
    dom.console.appendChild(foot);
  }

  function bonusLeft() {
    return Math.max(0, BONUS * (1 - game.phaseTime / BONUS_SECONDS));
  }

  function updateTimer() {
    if (!live.timer) return;
    if (game.mode === "demo") {
      var left = Math.max(0, DEMO_ASK - game.phaseTime);
      live.timer.style.transform = "scaleX(" + (left / DEMO_ASK).toFixed(3) + ")";
      live.timerText.textContent = "Calling the early leader for you in " + Math.ceil(left) + "s";
    } else {
      var bonus = bonusLeft();
      live.timer.style.transform = "scaleX(" + (bonus / BONUS).toFixed(3) + ")";
      live.timerText.textContent = bonus > 0 ? "Speed bonus +" + Math.round(bonus) : "No rush. Take a careful look.";
    }
  }

  function announce(text) {
    if (game.mode === "game") dom.live.textContent = text;  // the demo loops, so it stays quiet
  }

  function controlsHaveFocus() {
    var active = document.activeElement;
    return !!active && (dom.console.contains(active) || dom.card.contains(active));
  }

  // Focus for the phase: the title card's Start, the first live button, or the console itself.
  function placeFocus() {
    var target = game.phase === "intro" ? dom.card.querySelector("button")
      : dom.console.querySelector("button:not([disabled])") || dom.console;
    target.focus({ preventScroll: true });
  }

  // After a click near the bottom of the figure (on a phone, say), scroll its top back into view.
  function bringIntoView() {
    if (root.getBoundingClientRect().top < 0) {
      root.scrollIntoView({ block: "start", behavior: reduceMotion.matches ? "auto" : "smooth" });
    }
  }

  function setPaused(value) {
    paused = value;
    dom.pause.setAttribute("aria-pressed", String(value));
    dom.pause.title = value ? "Resume" : "Pause";
  }

  // ------------------------------------------------------------------ loop

  function step(dt, now) {
    game.phaseTime += dt;
    var phase = game.phase;
    if (phase === "play" || phase === "ask" || phase === "continue" || phase === "reveal") {
      var signal = game.level.update(dt, phase);
      if (phase === "play" && signal === "ask") ask();
      else if (phase === "continue" && signal === "done") reveal();
    }
    if (game.phase === "ask") {
      updateTimer();
      if (game.mode === "demo" && game.phaseTime >= DEMO_ASK) makeCall(game.level.autoCall(), true);
    } else if (game.phase === "reveal" && game.mode === "demo" && game.phaseTime > DEMO_HOLD) {
      startDemo();
    }
    if (now - lastRefresh > 120 && (game.phase === "play" || game.phase === "continue")) {
      game.level.refresh(game.phase);
      if (live.status) live.status.textContent = statusText();
      lastRefresh = now;
    }
  }

  function draw() {
    if (!width || !height || !colors.ink || !game.level) return;
    ctx.clearRect(0, 0, width, height);
    game.level.draw(ctx, width, height, colors);
  }

  function tick(now) {
    frameId = 0;
    if (!running) return;
    var dt = Math.min(0.05, Math.max(0, (now - lastTime) / 1000));
    lastTime = now;
    step(dt, now);
    draw();
    if (running && !frameId) frameId = requestAnimationFrame(tick);  // unless step() restarted the loop
  }

  function ensureRunning() {
    if (running || paused || reduceMotion.matches || !onScreen || document.hidden) return;
    if (game.phase === "intro" || game.phase === "final") return;  // nothing moves until the player acts
    running = true;
    lastTime = performance.now();
    frameId = requestAnimationFrame(tick);
  }

  function stop() {
    running = false;
    if (frameId) cancelAnimationFrame(frameId);
    frameId = 0;
  }

  function readColors() {
    var style = getComputedStyle(root);
    ["control", "treatment", "muted", "faint", "rule", "ink", "good", "bad", "surface"].forEach(function (name) {
      colors[name] = style.getPropertyValue("--" + name).trim();
    });
  }

  function resize() {
    var ratio = Math.min(window.devicePixelRatio || 1, 2);
    width = stage.clientWidth;
    height = stage.clientHeight;
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    draw();
  }

  // ---------------------------------------------------------------- wiring

  dom.start.addEventListener("click", function () {
    startGame();
    placeFocus();
  });
  dom.pause.addEventListener("click", function () {
    setPaused(!paused);
    if (paused) stop(); else ensureRunning();
  });
  readColors();
  resize();
  if (window.ResizeObserver) {
    new ResizeObserver(resize).observe(stage);
  } else {
    window.addEventListener("resize", resize);
  }
  document.addEventListener("themechange", function () {
    readColors();
    draw();
  });
  if (window.IntersectionObserver) {
    new IntersectionObserver(function (entries) {
      onScreen = entries[0].isIntersecting;
      if (onScreen) ensureRunning(); else stop();
    }).observe(root);
  }
  document.addEventListener("visibilitychange", function () {
    if (document.hidden) stop(); else ensureRunning();
  });
  if (reduceMotion.addEventListener) {
    reduceMotion.addEventListener("change", function () {
      renderHeader();
      if (game.mode === "demo") startDemo();
    });
  }
  window.addEventListener("hashchange", function () {
    if (window.location.hash === "#play") startGame();
  });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(draw);
  if (window.location.hash === "#play") startGame(); else startDemo();
})();
