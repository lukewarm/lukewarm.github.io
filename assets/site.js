// maxhe.org: theme, small conveniences, and Fig. 1 (a live A/B test).
(function () {
  "use strict";

  var root = document.documentElement;
  var darkQuery = window.matchMedia("(prefers-color-scheme: dark)");

  // ------------------------------------------------------------------ theme

  function effectiveTheme() {
    return root.dataset.theme || (darkQuery.matches ? "dark" : "light");
  }

  function announceTheme() {
    var toggle = document.querySelector("[data-theme-toggle]");
    if (toggle) {
      toggle.setAttribute("aria-label", effectiveTheme() === "dark" ? "Switch to light theme" : "Switch to dark theme");
    }
    document.dispatchEvent(new CustomEvent("themechange"));
  }

  var themeToggle = document.querySelector("[data-theme-toggle]");
  if (themeToggle) {
    themeToggle.addEventListener("click", function () {
      var next = effectiveTheme() === "dark" ? "light" : "dark";
      root.dataset.theme = next;
      try {
        localStorage.setItem("theme", next);
      } catch (e) {
        /* storage can be unavailable; the choice then lasts for this page view */
      }
      announceTheme();
    });
  }
  if (darkQuery.addEventListener) {
    darkQuery.addEventListener("change", announceTheme);
  }
  announceTheme();

  // ------------------------------------------------------- small conveniences

  document.querySelectorAll("[data-year]").forEach(function (el) {
    el.textContent = String(new Date().getFullYear());
  });

  document.querySelectorAll("[data-copy]").forEach(function (button) {
    button.addEventListener("click", function () {
      var done = function (label) {
        button.textContent = label;
        setTimeout(function () {
          button.textContent = "Copy";
        }, 1600);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(button.dataset.copy).then(
          function () { done("Copied"); },
          function () { done("Select it"); }
        );
      } else {
        done("Select it");
      }
    });
  });

  var wechat = document.getElementById("wechat");
  if (wechat && typeof wechat.showModal === "function") {
    document.querySelectorAll("[data-open-wechat]").forEach(function (link) {
      link.addEventListener("click", function (event) {
        event.preventDefault();
        wechat.showModal();
      });
    });
    wechat.addEventListener("click", function (event) {
      if (event.target === wechat) wechat.close();  // a click on the backdrop
    });
  }

  // --------------------------------------------------- Fig. 1: a live A/B test

  var figure = document.querySelector("[data-ab]");
  if (!figure) return;

  var canvas = figure.querySelector("canvas");
  var ctx = canvas.getContext("2d");
  var stage = figure.querySelector(".stage");
  var out = {};
  ["n", "control", "treatment", "lift", "ci", "p", "verdict", "truth"].forEach(function (name) {
    out[name] = figure.querySelector("[data-ab-" + name + "]");
  });
  var interval = figure.querySelector("[data-ab-interval]");
  var point = figure.querySelector("[data-ab-point]");
  var truthMark = figure.querySelector("[data-ab-truth-mark]");
  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  var BASE_RATE = 0.1;          // control conversion rate
  var MAX_USERS = 40000;        // users per run
  var AXIS = 0.3;               // the interval axis spans -30% .. +30% relative lift
  var TRUE_LIFTS = [0.12, 0.07, 0.15, 0, 0.1, -0.08];
  var FORK_START = 0.3, FORK_END = 0.58, REVEAL = 0.66;

  // dots and stats start empty: resize() draws before the first run begins.
  var run = 0, rand, trueLift, carry = 0, finishedAt = 0;
  var stats = { nc: 0, xc: 0, nt: 0, xt: 0 };
  var dots = [];
  var colors = {}, width = 0, height = 0, ratio = 1;
  var running = false, onScreen = true, frameId = 0, lastTime = 0, lastReadout = 0;

  function mulberry32(seed) {
    return function () {
      seed = (seed + 0x6d2b79f5) | 0;
      var t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function normalCdf(x) {
    // Abramowitz & Stegun 7.1.26, for x >= 0
    var t = 1 / (1 + 0.3275911 * x / Math.SQRT2);
    var poly = ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t;
    return 0.5 * (1 + (1 - poly * Math.exp(-x * x / 2)));
  }

  function reset() {
    rand = mulberry32((Date.now() ^ Math.imul(run + 1, 0x9e3779b9)) >>> 0);
    trueLift = TRUE_LIFTS[run % TRUE_LIFTS.length];
    run += 1;
    stats = { nc: 0, xc: 0, nt: 0, xt: 0 };
    dots = [];
    carry = 0;
    finishedAt = 0;
    out.truth.textContent = "";
    truthMark.style.opacity = "0";
    figure.dataset.state = "running";
  }

  // The end of a run: show where the true lift was, on the same axis as the interval.
  function revealTruth() {
    out.truth.textContent = "· truth " + (trueLift === 0 ? "0%" : pct(trueLift, 0));
    truthMark.style.left = position(trueLift) + "%";
    truthMark.style.opacity = "1";
  }

  function newUser() {
    var treated = rand() < 0.5;
    var converted = rand() < BASE_RATE * (treated ? 1 + trueLift : 1);
    if (treated) {
      stats.nt += 1;
      stats.xt += converted ? 1 : 0;
    } else {
      stats.nc += 1;
      stats.xc += converted ? 1 : 0;
    }
    return { treated: treated, converted: converted };
  }

  function newDot(user, x) {
    return {
      x: x,
      jitter: rand() * 2 - 1,
      speed: 0.27 + rand() * 0.08,
      size: 2.1 + rand() * 1.1,
      treated: user.treated,
      converted: user.converted
    };
  }

  // Delta-method interval for the relative lift; z-test for the difference in rates.
  function summarize() {
    var nc = stats.nc, nt = stats.nt;
    if (nc < 30 || nt < 30 || stats.xc === 0) return null;
    var pc = stats.xc / nc, pt = stats.xt / nt;
    var vc = pc * (1 - pc) / (nc - 1), vt = pt * (1 - pt) / (nt - 1);
    var lift = pt / pc - 1;
    var se = Math.sqrt(vt / (pc * pc) + pt * pt * vc / Math.pow(pc, 4));
    var z = Math.abs(pt - pc) / Math.sqrt(vc + vt);
    return { pc: pc, pt: pt, lift: lift, lo: lift - 1.96 * se, hi: lift + 1.96 * se, p: 2 * (1 - normalCdf(z)) };
  }

  function pct(value, digits) {
    var text = (value * 100).toFixed(digits) + "%";
    return value > 0 ? "+" + text : text.replace("-", "−");
  }

  function position(value) {
    return (Math.max(-AXIS, Math.min(AXIS, value)) + AXIS) / (2 * AXIS) * 100;
  }

  function renderReadout() {
    var n = stats.nc + stats.nt;
    out.n.textContent = n.toLocaleString("en-US");
    var s = summarize();
    if (!s) {
      out.control.textContent = out.treatment.textContent = out.lift.textContent = "—";
      out.ci.textContent = "collecting…";
      out.p.textContent = "—";
      out.verdict.textContent = "";
      interval.style.width = "0";
      point.style.opacity = "0";
      figure.dataset.kind = "";
      return;
    }
    out.control.textContent = (s.pc * 100).toFixed(2) + "%";
    out.treatment.textContent = (s.pt * 100).toFixed(2) + "%";
    out.lift.textContent = pct(s.lift, 1);
    out.ci.textContent = "95% CI [" + pct(s.lo, 1) + ", " + pct(s.hi, 1) + "]";
    out.p.textContent = s.p < 0.0001 ? "<0.0001" : s.p.toFixed(4);
    var kind = s.lo > 0 ? "up" : s.hi < 0 ? "down" : "";
    var finished = n >= MAX_USERS;
    out.verdict.textContent = kind === "up" ? "significant ↑" : kind === "down" ? "significant ↓"
      : finished ? "inconclusive" : "not yet";
    out.verdict.dataset.kind = kind;
    figure.dataset.kind = kind;
    var left = position(s.lo), right = position(s.hi);
    interval.style.left = left + "%";
    interval.style.width = Math.max(0.6, right - left) + "%";
    point.style.left = position(s.lift) + "%";
    point.style.opacity = "1";
  }

  function readColors() {
    var style = getComputedStyle(figure);
    ["control", "treatment", "muted", "faint", "rule", "ink"].forEach(function (name) {
      colors[name] = style.getPropertyValue("--" + name).trim();
    });
  }

  function resize() {
    ratio = Math.min(window.devicePixelRatio || 1, 2);
    width = stage.clientWidth;
    height = stage.clientHeight;
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    draw();
  }

  function laneY(treated) {
    return treated ? 0.74 : 0.26;
  }

  function dotY(dot) {
    var stream = 0.5 + dot.jitter * 0.07;
    var f = Math.max(0, Math.min(1, (dot.x - FORK_START) / (FORK_END - FORK_START)));
    var eased = f * f * (3 - 2 * f);
    var lane = laneY(dot.treated) + dot.jitter * 0.1;
    return stream + (lane - stream) * eased;
  }

  function drawGuides() {
    ctx.strokeStyle = colors.rule;
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 5]);
    [true, false].forEach(function (treated) {
      ctx.beginPath();
      ctx.moveTo(0, height * 0.5);
      ctx.lineTo(width * FORK_START, height * 0.5);
      ctx.bezierCurveTo(
        width * (FORK_START + FORK_END) / 2, height * 0.5,
        width * (FORK_START + FORK_END) / 2, height * laneY(treated),
        width * FORK_END, height * laneY(treated)
      );
      ctx.lineTo(width, height * laneY(treated));
      ctx.stroke();
    });
    ctx.setLineDash([]);
    ctx.strokeStyle = colors.rule;
    ctx.beginPath();
    ctx.moveTo(width * REVEAL, height * 0.1);
    ctx.lineTo(width * REVEAL, height * 0.9);
    ctx.stroke();
  }

  function draw() {
    if (!width || !height || !colors.ink) return;
    ctx.clearRect(0, 0, width, height);
    drawGuides();
    for (var i = 0; i < dots.length; i += 1) {
      var dot = dots[i];
      var x = dot.x * width;
      var y = dotY(dot) * height;
      var fade = Math.min(1, dot.x / 0.05, (1 - dot.x) / 0.06);
      var color = dot.x < FORK_START ? colors.muted : dot.treated ? colors.treatment : colors.control;
      ctx.globalAlpha = Math.max(0, fade);
      if (dot.x >= REVEAL && dot.converted) {
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(x, y, dot.size + 1.4, 0, Math.PI * 2);
        ctx.fill();
      } else if (dot.x >= REVEAL) {
        ctx.globalAlpha = Math.max(0, fade) * 0.35;
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
  }

  function step(dt, now) {
    var n = stats.nc + stats.nt;
    if (n < MAX_USERS) {
      // Arrivals speed up as the test runs: about 15 seconds from the first user to the last.
      carry += (240 + 0.25 * n) * dt;
      var arrivals = Math.min(Math.floor(carry), MAX_USERS - n);
      carry -= arrivals;
      var shown = 0;
      for (var i = 0; i < arrivals; i += 1) {
        var user = newUser();
        if (shown < 2 && rand() < 0.5) {
          dots.push(newDot(user, 0));
          shown += 1;
        }
      }
      if (stats.nc + stats.nt >= MAX_USERS) {
        finishedAt = now;
        figure.dataset.state = "done";
        revealTruth();
      }
    } else if (finishedAt && now - finishedAt > 6000) {
      reset();
    }
    for (var j = 0; j < dots.length; j += 1) {
      dots[j].x += dots[j].speed * dt;
    }
    dots = dots.filter(function (dot) { return dot.x < 1; });
    if (now - lastReadout > 120) {
      renderReadout();
      lastReadout = now;
    }
  }

  function tick(now) {
    frameId = 0;
    if (!running) return;
    var dt = Math.min(0.05, Math.max(0, (now - lastTime) / 1000));
    lastTime = now;
    step(dt, now);
    draw();
    frameId = requestAnimationFrame(tick);
  }

  function start() {
    if (running || reduceMotion.matches || !onScreen || document.hidden) return;
    running = true;
    lastTime = performance.now();
    frameId = requestAnimationFrame(tick);
  }

  function stop() {
    running = false;
    if (frameId) cancelAnimationFrame(frameId);
    frameId = 0;
  }

  // Without motion: a finished run, drawn once.
  function staticRun() {
    reset();
    while (stats.nc + stats.nt < MAX_USERS) newUser();
    for (var i = 0; i < 260; i += 1) {
      // Decorative dots only; they are not counted as users.
      var treated = rand() < 0.5;
      dots.push(newDot({ treated: treated, converted: rand() < BASE_RATE * (treated ? 1 + trueLift : 1) }, rand()));
    }
    figure.dataset.state = "done";
    revealTruth();
    renderReadout();
    draw();
  }

  function begin() {
    stop();
    if (reduceMotion.matches) {
      staticRun();
    } else {
      reset();
      renderReadout();
      start();
    }
  }

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
      if (onScreen) start(); else stop();
    }).observe(figure);
  }
  document.addEventListener("visibilitychange", function () {
    if (document.hidden) stop(); else start();
  });
  if (reduceMotion.addEventListener) {
    reduceMotion.addEventListener("change", begin);
  }
  figure.querySelector("[data-ab-replay]").addEventListener("click", begin);
  begin();
})();
