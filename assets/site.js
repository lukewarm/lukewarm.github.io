// maxhe.org: theme and small conveniences. Fig. 1, the experiment game, is in game.js.
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
})();
