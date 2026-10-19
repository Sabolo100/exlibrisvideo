/* Ex Libris Video — befektetői prezentáció: lapozás, áttekintő nézet, teljes képernyő, indítókapu, részletes ablakok,
   videó, és a diák kódból vezérelt „poénjai” (valódi felismerési dobozok a polcvideón, videóhoz szinkronizált
   lépéslisták, gépelés-verseny, számlálók). A diák 1280×720-as vásznon készülnek; a vászon transform: scale()-lel
   igazodik a nézetablakhoz. Az alapállapot a végleges kép: minden demó a dia elhagyásakor visszaáll rá. */
(function () {
  'use strict';

  var W = 1280, H = 720;
  var $ = function (id) { return document.getElementById(id); };
  var all = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };
  var body = document.body;
  var deck = $('deck'), stage = $('stage');
  var slides = all('.slide', stage);
  var bar = $('deckBar'), titleEl = $('deckTitle'), curNum = $('curNum'), totNum = $('totNum');
  var prevBtn = $('prevBtn'), nextBtn = $('nextBtn'), edgePrev = $('edgePrev'), edgeNext = $('edgeNext');
  var overview = $('overview'), ovGrid = $('ovGrid');
  var gate = $('gate');
  var current = -1;
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  // az áttekintő bélyegképei a betöltéskori (végleges) állapotból készülnek, nem a futó demóból
  var pristine = slides.map(function (sl) { return sl.cloneNode(true); });
  totNum.textContent = slides.length;

  /* ------------------------------------------------------------ skálázás */
  function fit() {
    var full = body.classList.contains('is-fs');
    var availW = deck.clientWidth - (full ? 0 : 40);
    var availH = deck.clientHeight - (full ? 0 : 32);
    var s = Math.min(availW / W, availH / H);
    if (!isFinite(s) || s <= 0) s = 1;
    stage.style.transform = 'translate(-50%, -50%) scale(' + s + ')';
  }

  /* ------------------------------------------------------------ lapozás */
  function show(i, push) {
    i = Math.max(0, Math.min(slides.length - 1, i));
    var moved = i !== current;
    var prevSlide = current >= 0 ? slides[current] : null;
    slides.forEach(function (sl, n) {
      sl.classList.toggle('is-active', n === i);
      sl.classList.toggle('is-prev', moved && n < i);
      sl.classList.toggle('is-next', moved && n > i);
    });
    current = i;
    curNum.textContent = i + 1;
    bar.style.width = ((i + 1) / slides.length * 100) + '%';
    titleEl.textContent = (i + 1) + ' · ' + (slides[i].getAttribute('data-title') || '');
    prevBtn.disabled = i === 0;
    nextBtn.disabled = i === slides.length - 1;
    edgePrev.style.display = i === 0 ? 'none' : '';
    edgeNext.style.display = i === slides.length - 1 ? 'none' : '';
    if (ovGrid) Array.prototype.forEach.call(ovGrid.children, function (c, n) { c.classList.toggle('is-current', n === i); });
    if (push !== false) { try { history.replaceState(null, '', '#' + (i + 1)); } catch (e) { /* noop */ } }
    if (moved) { if (prevSlide) leave(prevSlide); enter(slides[i]); }
  }
  function next() { if (current < slides.length - 1) show(current + 1); }
  function prev() { if (current > 0) show(current - 1); }
  function goto(id) { for (var n = 0; n < slides.length; n++) if (slides[n].getAttribute('data-id') === id) { show(n); return; } }

  prevBtn.addEventListener('click', prev);
  nextBtn.addEventListener('click', next);
  edgePrev.addEventListener('click', prev);
  edgeNext.addEventListener('click', next);
  stage.addEventListener('click', function (e) {
    var g = e.target.closest && e.target.closest('[data-goto]');
    if (g) { e.preventDefault(); goto(g.getAttribute('data-goto')); }
  });

  /* ------------------------------------------------------------ indítókapu és teljes képernyő */
  function isFull() { return !!(document.fullscreenElement || document.webkitFullscreenElement); }
  function toggleFullscreen() {
    var el = document.documentElement;
    if (!isFull()) {
      var req = el.requestFullscreen || el.webkitRequestFullscreen;
      if (req) { try { var p = req.call(el); if (p && p.catch) p.catch(function () { /* elutasítva */ }); } catch (e) { /* noop */ } }
    } else {
      var ex = document.exitFullscreen || document.webkitExitFullscreen;
      if (ex) { try { var q = ex.call(document); if (q && q.catch) q.catch(function () { /* noop */ }); } catch (e) { /* noop */ } }
    }
  }
  function onFullChange() {
    body.classList.toggle('is-fs', isFull());
    if (!isFull()) body.classList.remove('is-idle');
    fit();
    scaleThumbs();
  }
  document.addEventListener('fullscreenchange', onFullChange);
  document.addEventListener('webkitfullscreenchange', onFullChange);
  $('fsBtn').addEventListener('click', toggleFullscreen);

  var started = false;
  function start(full) {
    if (started) return;
    started = true;
    if (full) toggleFullscreen();
    gate.classList.add('is-gone');
    setTimeout(function () { gate.style.display = 'none'; }, 700);
    fit();
    var at = current < 0 ? 0 : current;
    current = -1;
    show(at, false);
  }
  $('gateFull').addEventListener('click', function () { start(true); });
  $('gateWin').addEventListener('click', function () { start(false); });

  /* ------------------------------------------------------------ billentyűk */
  function dialogOpen() { return !!document.querySelector('dialog[open]'); }
  document.addEventListener('keydown', function (e) {
    if (e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return;
    if (!started) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); start(true); }
      else if (e.key === 'Escape') { e.preventDefault(); start(false); }
      return;
    }
    if (dialogOpen()) return; // a dialógus maga kezeli (Esc)
    if (overview.classList.contains('is-open')) {
      if (e.key === 'Escape' || e.key === 'o' || e.key === 'O') { e.preventDefault(); closeOverview(); }
      return;
    }
    var onControl = e.target && e.target.closest && e.target.closest('button, a, [role="button"], input, textarea, select, video');
    switch (e.key) {
      case 'ArrowRight': case 'PageDown': e.preventDefault(); next(); break;
      case 'ArrowLeft': case 'PageUp': e.preventDefault(); prev(); break;
      case ' ': case 'Enter': if (onControl) return; e.preventDefault(); next(); break;
      case 'Backspace': e.preventDefault(); prev(); break;
      case 'Home': e.preventDefault(); show(0); break;
      case 'End': e.preventDefault(); show(slides.length - 1); break;
      case 'o': case 'O': case 'Escape': e.preventDefault(); openOverview(); break;
      case 'f': case 'F': e.preventDefault(); toggleFullscreen(); break;
      case 'b': case 'B': case '.': e.preventDefault(); stage.style.visibility = stage.style.visibility === 'hidden' ? '' : 'hidden'; break;
      default: break;
    }
  });

  /* ------------------------------------------------------------ érintés: lapozás ujjhúzással */
  var tx = 0, ty = 0, tracking = false;
  deck.addEventListener('touchstart', function (e) {
    if (e.touches.length !== 1) { tracking = false; return; }
    tracking = true; tx = e.touches[0].clientX; ty = e.touches[0].clientY;
  }, { passive: true });
  deck.addEventListener('touchend', function (e) {
    if (!tracking) return;
    tracking = false;
    var t = e.changedTouches[0], dx = t.clientX - tx, dy = t.clientY - ty;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) { if (dx < 0) next(); else prev(); }
  }, { passive: true });

  /* ------------------------------------------------------------ teljes képernyőn a keret elbújik, ha nem mozog az egér */
  var idleTimer = 0;
  function wake() {
    body.classList.remove('is-idle');
    clearTimeout(idleTimer);
    if (isFull() && !overview.classList.contains('is-open')) idleTimer = setTimeout(function () { body.classList.add('is-idle'); }, 2600);
  }
  document.addEventListener('mousemove', wake);
  document.addEventListener('mousedown', wake);

  /* ------------------------------------------------------------ áttekintő nézet (a diák klónjai, alapállapotban) */
  var ovBuilt = false;
  function buildOverview() {
    if (ovBuilt) return;
    slides.forEach(function (sl, i) {
      var cell = document.createElement('button');
      cell.type = 'button';
      cell.className = 'ov-cell';
      cell.setAttribute('aria-label', (i + 1) + '. dia: ' + (sl.getAttribute('data-title') || ''));
      var frame = document.createElement('div');
      frame.className = 'ov-frame';
      var clone = pristine[i].cloneNode(true);
      clone.classList.remove('is-active', 'is-prev', 'is-next');
      clone.removeAttribute('id');
      all('[id]', clone).forEach(function (n) { n.removeAttribute('id'); });
      all('[data-open], [data-vid], [data-goto], [data-demo]', clone).forEach(function (n) {
        n.removeAttribute('data-open'); n.removeAttribute('data-vid'); n.removeAttribute('data-goto'); n.removeAttribute('data-demo'); n.setAttribute('tabindex', '-1');
      });
      all('video', clone).forEach(function (v) { v.removeAttribute('src'); v.preload = 'none'; });
      all('.is-wait', clone).forEach(function (n) { n.classList.remove('is-wait'); });
      frame.appendChild(clone);
      var cap = document.createElement('div');
      cap.className = 'ov-cap';
      cap.textContent = (i + 1) + ' · ' + (sl.getAttribute('data-title') || '');
      cell.appendChild(frame);
      cell.appendChild(cap);
      cell.addEventListener('click', function () { closeOverview(); show(i); });
      ovGrid.appendChild(cell);
    });
    ovBuilt = true;
    scaleThumbs();
  }
  function scaleThumbs() {
    if (!ovBuilt) return;
    Array.prototype.forEach.call(ovGrid.children, function (cell) {
      var frame = cell.querySelector('.ov-frame');
      var clone = frame.querySelector('.slide');
      if (frame.clientWidth) clone.style.transform = 'scale(' + (frame.clientWidth / W) + ')';
    });
  }
  function openOverview() {
    buildOverview();
    overview.classList.add('is-open');
    body.classList.remove('is-idle');
    scaleThumbs();
    Array.prototype.forEach.call(ovGrid.children, function (c, n) { c.classList.toggle('is-current', n === current); });
    var cur = ovGrid.children[current];
    if (cur && cur.scrollIntoView) cur.scrollIntoView({ block: 'nearest' });
  }
  function closeOverview() { overview.classList.remove('is-open'); wake(); }
  $('ovBtn').addEventListener('click', openOverview);
  $('ovClose').addEventListener('click', closeOverview);

  /* ------------------------------------------------------------ videó ablak (a teljes promóvideó, saját tárhelyről) */
  var vdlg = $('vdlg'), vplayer = $('vplayer'), vtitle = $('vtitle');
  function openVideo(src, label, poster) {
    if (!src || !vdlg) return;
    vtitle.textContent = label || '';
    vplayer.poster = poster || '';
    vplayer.src = src;
    if (typeof vdlg.showModal === 'function') vdlg.showModal(); else vdlg.setAttribute('open', '');
    var p = vplayer.play(); if (p && p.catch) p.catch(function () { /* a felhasználó indítja */ });
    pauseSlideVideos();
  }
  function closeVideo() { if (vdlg && vdlg.open) vdlg.close(); }
  vdlg.addEventListener('close', function () { vplayer.pause(); vplayer.removeAttribute('src'); vplayer.load(); if (current >= 0) playSlideVideos(slides[current], false); });
  $('vclose').addEventListener('click', closeVideo);
  vdlg.addEventListener('click', function (e) { if (e.target === vdlg) closeVideo(); });
  document.addEventListener('click', function (e) {
    var v = e.target.closest && e.target.closest('[data-vid]');
    if (!v) return;
    e.preventDefault(); e.stopPropagation();
    openVideo(v.getAttribute('data-vid'), v.getAttribute('data-vtitle'), v.getAttribute('data-vposter'));
  });

  /* ------------------------------------------------------------ részletes ablakok (natív <dialog>) */
  document.addEventListener('click', function (e) {
    var o = e.target.closest && e.target.closest('[data-open]');
    if (o && !o.closest('.ov-frame')) {
      var d = $('dlg-' + o.getAttribute('data-open'));
      if (d && typeof d.showModal === 'function') { e.preventDefault(); d.showModal(); pauseSlideVideos(); }
      return;
    }
    var x = e.target.closest && e.target.closest('[data-close]');
    if (x) { var dd = x.closest('dialog'); if (dd) dd.close(); }
  });
  all('dialog.dlg').forEach(function (d) {
    d.addEventListener('click', function (e) { if (e.target === d) d.close(); });
    d.addEventListener('close', function () { if (current >= 0) playSlideVideos(slides[current], false); });
  });

  /* ------------------------------------------------------------ cím másolása */
  all('[data-copy]').forEach(function (btn) {
    var label = btn.textContent, timer = 0;
    var done = function () { btn.textContent = btn.getAttribute('data-done') || '✓'; clearTimeout(timer); timer = setTimeout(function () { btn.textContent = label; }, 2200); };
    btn.addEventListener('click', function () {
      var text = btn.getAttribute('data-copy') || '';
      var fallback = function () {
        try {
          var ta = document.createElement('textarea');
          ta.value = text; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;opacity:0';
          document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta); done();
        } catch (e) { /* a cím úgyis látszik */ }
      };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, fallback);
      else fallback();
    });
  });

  /* ================================================================ DEMÓK: a dia aktiválásakor indulnak, elhagyáskor visszaállnak */

  /* --- videók a diákon: elejéről indulnak, elhagyáskor megállnak; kattintásra szünet/folytatás */
  function slideVideos(sl) { return all('video[data-auto]', sl); }
  function playSlideVideos(sl, rewind) {
    if (reduce) return; // csökkentett mozgásnál a poszter marad, kattintásra indul
    slideVideos(sl).forEach(function (v) {
      if (rewind) { try { v.currentTime = 0; } catch (e) { /* noop */ } }
      var p = v.play(); if (p && p.catch) p.catch(function () { /* automatikus lejátszás tiltva */ });
    });
  }
  function pauseSlideVideos() { slides.forEach(function (sl) { slideVideos(sl).forEach(function (v) { v.pause(); }); }); }
  all('.slide video').forEach(function (v) {
    v.addEventListener('click', function (e) { e.stopPropagation(); if (v.paused) { var p = v.play(); if (p && p.catch) p.catch(function () {}); } else v.pause(); });
  });

  /* --- lépéslista a videó idejéhez kötve: <ol class="sy" data-for="<videó id>"> <li data-t="mp"> */
  function syncLists(sl) {
    return all('[data-for]', sl).map(function (ol) {
      var v = $(ol.getAttribute('data-for'));
      var items = all('[data-t]', ol).map(function (li) { return { el: li, t: parseFloat(li.getAttribute('data-t')) }; });
      return { v: v, items: items };
    }).filter(function (s) { return s.v && s.items.length; });
  }
  function tickSync(list) {
    list.forEach(function (s) {
      var t = s.v.currentTime, dur = s.v.duration || 0, on = -1;
      s.items.forEach(function (it, n) { if (t + 0.05 >= it.t) on = n; });
      s.items.forEach(function (it, n) {
        it.el.classList.toggle('is-on', n === on);
        it.el.classList.toggle('is-done', n < on);
        if (n === on) {
          var end = n + 1 < s.items.length ? s.items[n + 1].t : dur;
          var p = end > it.t ? Math.min(1, (t - it.t) / (end - it.t)) : 1;
          it.el.style.setProperty('--p', p.toFixed(3));
        }
      });
    });
  }
  function clearSync(sl) { all('[data-t]', sl).forEach(function (li) { li.classList.remove('is-on', 'is-done'); li.style.removeProperty('--p'); }); }

  /* --- buborékok a videó idejéhez kötve: <span class="cb" data-cb="<videó id>" data-from="mp" data-to="mp"> */
  function cbs(sl) { return all('[data-cb]', sl).map(function (el) { return { el: el, v: $(el.getAttribute('data-cb')), a: parseFloat(el.getAttribute('data-from')), b: parseFloat(el.getAttribute('data-to')) }; }).filter(function (c) { return c.v; }); }
  function tickCb(list) { list.forEach(function (c) { var t = c.v.currentTime; c.el.classList.toggle('is-on', t >= c.a && t < c.b); }); }

  /* --- címlap: a valódi polcvideó + a valódi felismerési adatok (dobozok, számláló, a polcra érkező gerincfotók) */
  var TRK = null;
  try { TRK = JSON.parse($('trk').textContent); } catch (e) { TRK = null; }
  function boxAt(obs, t) {
    // obs: [[t, x0, y0, x1, y1], …]; a két megfigyelés között lineárisan, az utolsó után 0,32 mp-ig látszik
    if (t < obs[0][0] - 0.02 || t > obs[obs.length - 1][0] + 0.32) return null;
    var i = 0;
    while (i + 1 < obs.length && obs[i + 1][0] <= t) i++;
    var a = obs[i], b = obs[i + 1];
    if (!b || b[0] - a[0] < 1e-6) return a; // ugyanabban a kockában kétszer észlelt gerinc
    if (b[0] - a[0] > 1.1) return t - a[0] < 0.32 ? a : null;
    var u = (t - a[0]) / (b[0] - a[0]);
    return [t, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u, a[3] + (b[3] - a[3]) * u, a[4] + (b[4] - a[4]) * u];
  }
  function tracksDemo(sl) {
    var root = sl.querySelector('[data-demo="tracks"]');
    if (!root || !TRK) return null;
    var v = root.querySelector('video'), svg = root.querySelector('.cv-boxes'), num = root.querySelector('.cv-count'), rec = root.querySelector('.cv-rec b');
    var imgs = all('.cv-row img', root);
    var byId = {};
    imgs.forEach(function (im) { byId[im.getAttribute('data-b')] = im; });
    var rects = TRK.books.map(function (b) {
      var r = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      r.style.display = 'none';
      svg.appendChild(r);
      return r;
    });
    var shown = {}, hold = 0;
    function reset() {
      shown = {};
      imgs.forEach(function (im) { im.classList.add('is-wait'); im.classList.remove('is-in'); });
      num.textContent = '0';
    }
    function finalState() {
      imgs.forEach(function (im) { im.classList.remove('is-wait', 'is-in'); });
      rects.forEach(function (r) { r.style.display = 'none'; });
      num.textContent = String(TRK.books.length);
      if (rec) rec.textContent = '00:09';
    }
    function tick() {
      if (reduce) return; // csökkentett mozgásnál a végállapot marad (teljes polc, végső szám)
      var t = v.currentTime, count = 0;
      TRK.books.forEach(function (b, n) {
        var bb = boxAt(b.obs, t), r = rects[n];
        if (b.first <= t + 1e-6) {
          count++;
          if (!shown[b.id]) { shown[b.id] = true; var im = byId[b.id]; if (im) { im.classList.remove('is-wait'); im.classList.add('is-in'); } }
        }
        if (!bb) { r.style.display = 'none'; return; }
        r.style.display = '';
        r.setAttribute('x', bb[1].toFixed(0)); r.setAttribute('y', bb[2].toFixed(0));
        r.setAttribute('width', (bb[3] - bb[1]).toFixed(0)); r.setAttribute('height', (bb[4] - bb[2]).toFixed(0));
        r.classList.toggle('is-new', t - b.first < 0.9);
      });
      num.textContent = String(count);
      if (rec) rec.textContent = '00:0' + Math.min(9, Math.floor(t));
    }
    function onEnded() { hold = setTimeout(function () { reset(); try { v.currentTime = 0; } catch (e) { /* noop */ } var p = v.play(); if (p && p.catch) p.catch(function () {}); }, 2600); }
    v.addEventListener('ended', onEnded);
    return {
      enter: function () { if (reduce) { finalState(); return; } reset(); },
      tick: tick,
      leave: function () { clearTimeout(hold); finalState(); },
    };
  }

  /* --- gépelés-verseny: bal oldalon könyvenként gépel, jobb oldalon egy pásztázás után ömlenek a sorok */
  function raceDemo(sl) {
    var root = sl.querySelector('[data-demo="race"]');
    if (!root) return null;
    var slow = root.querySelector('[data-race="slow"]'), fast = root.querySelector('[data-race="fast"]');
    var slowItems = JSON.parse(slow.getAttribute('data-items')), fastItems = JSON.parse(fast.getAttribute('data-items'));
    var clocks = all('[data-clock]', root), totals = all('[data-total]', root);
    var finalSlow = slow.innerHTML, finalFast = fast.innerHTML;
    var finalTotals = totals.map(function (t) { return t.textContent; });
    var t0 = 0, raf = 0, timers = [];
    var DUR = 12; // mp
    function row(list, n, text) { var li = document.createElement('li'); li.innerHTML = '<span>' + n + '</span><i></i>'; li.querySelector('i').textContent = text; li.querySelector('i').style.fontStyle = 'normal'; list.appendChild(li); while (list.children.length > 6) list.removeChild(list.firstChild); return li; }
    function run() {
      slow.innerHTML = ''; fast.innerHTML = '';
      totals[0].textContent = '0'; totals[1].textContent = '0';
      t0 = performance.now();
      // kézzel: kb. 2,6 mp könyvenként, betűnként gépelve
      var per = 2.6, n = 0;
      (function typeNext() {
        if (n >= slowItems.length || (performance.now() - t0) / 1000 > DUR - per) return;
        var text = slowItems[n], li = row(slow, n + 1, ''), i = 0, el = li.querySelector('i');
        li.classList.add('is-typing');
        var k = setInterval(function () {
          i++; el.textContent = text.slice(0, i);
          if (i >= text.length) { clearInterval(k); li.classList.remove('is-typing'); totals[0].textContent = String(n + 1); n++; timers.push(setTimeout(typeNext, 420)); }
        }, Math.max(28, (per * 1000 - 420) / text.length));
        timers.push(k);
      })();
      // videóval: 8 mp pásztázás közben ömlenek a sorok (a valódi felvétel sorrendjében)
      fastItems.forEach(function (text, i) {
        timers.push(setTimeout(function () { row(fast, i + 1, text); totals[1].textContent = String(i + 1); }, 800 + (i / fastItems.length) * 7600));
      });
      (function clock() {
        var s = Math.min(DUR, (performance.now() - t0) / 1000);
        clocks.forEach(function (c) { c.textContent = '00:' + String(Math.floor(s)).padStart(2, '0'); });
        if (s < DUR) raf = requestAnimationFrame(clock);
      })();
    }
    function stop() { timers.forEach(function (x) { clearTimeout(x); clearInterval(x); }); timers = []; cancelAnimationFrame(raf); }
    return {
      enter: function () { if (!reduce) run(); },
      leave: function () { stop(); slow.innerHTML = finalSlow; fast.innerHTML = finalFast; totals.forEach(function (t, i) { t.textContent = finalTotals[i]; }); clocks.forEach(function (c) { c.textContent = '00:' + String(DUR).padStart(2, '0'); }); },
    };
  }

  /* --- számlálók tizedesvesszővel: <b data-count="77.7" data-from="54.4" data-dec="1" data-suffix=" %"> (a szöveg a végső érték) */
  function countDemo(sl) {
    var els = all('[data-count]', sl);
    if (!els.length) return null;
    var finals = els.map(function (el) { return el.innerHTML; }), raf = 0;
    function fmt(x, dec) { return x.toFixed(dec).replace('.', ','); }
    return {
      enter: function () {
        if (reduce) return;
        var t0 = performance.now();
        els.forEach(function (el) { el.setAttribute('data-run', '1'); });
        (function step() {
          var done = true;
          els.forEach(function (el) {
            var delay = parseFloat(el.getAttribute('data-delay') || '1.2') * 1000, dur = 1400;
            var u = Math.max(0, Math.min(1, (performance.now() - t0 - delay) / dur));
            if (u < 1) done = false;
            var e = 1 - Math.pow(1 - u, 3);
            var a = parseFloat(el.getAttribute('data-from') || '0'), b = parseFloat(el.getAttribute('data-count'));
            var txt = fmt(a + (b - a) * e, parseInt(el.getAttribute('data-dec') || '0', 10)) + (el.getAttribute('data-suffix') || '');
            var tgt = el.querySelector('[data-num]') || el;
            tgt.textContent = txt;
          });
          if (!done) raf = requestAnimationFrame(step);
        })();
      },
      leave: function () { cancelAnimationFrame(raf); els.forEach(function (el, i) { el.innerHTML = finals[i]; }); },
    };
  }

  /* --- export-formátumok felvillannak, amikor a videóban kinyílik az exportmenü */
  function lightDemo(sl) {
    var els = all('[data-light]', sl);
    if (!els.length) return null;
    var v = $(els[0].getAttribute('data-light'));
    return { tick: function () { els.forEach(function (el, i) { el.classList.toggle('is-on', v && v.currentTime >= parseFloat(el.getAttribute('data-at')) + i * 0.18); }); }, leave: function () { els.forEach(function (el) { el.classList.remove('is-on'); }); } };
  }

  /* --- demók diánként, egyetlen rAF-hurok az aktív diára */
  var DEMOS = slides.map(function (sl) {
    return { sync: syncLists(sl), cb: cbs(sl), list: [tracksDemo(sl), raceDemo(sl), countDemo(sl), lightDemo(sl)].filter(Boolean) };
  });
  var loop = 0;
  function frame() {
    if (current < 0) return;
    var d = DEMOS[current];
    tickSync(d.sync); tickCb(d.cb);
    d.list.forEach(function (x) { if (x.tick) x.tick(); });
    loop = requestAnimationFrame(frame);
  }
  function enter(sl) {
    var d = DEMOS[slides.indexOf(sl)];
    d.list.forEach(function (x) { if (x.enter) x.enter(); });
    playSlideVideos(sl, true);
    // a következő dia videói előre töltődnek
    var nx = slides[slides.indexOf(sl) + 1];
    if (nx) slideVideos(nx).forEach(function (v) { if (v.preload !== 'auto') v.preload = 'auto'; });
    cancelAnimationFrame(loop);
    loop = requestAnimationFrame(frame);
  }
  function leave(sl) {
    var d = DEMOS[slides.indexOf(sl)];
    slideVideos(sl).forEach(function (v) { v.pause(); });
    d.list.forEach(function (x) { if (x.leave) x.leave(); });
    clearSync(sl);
    d.cb.forEach(function (c) { c.el.classList.remove('is-on'); });
  }
  document.addEventListener('visibilitychange', function () {
    if (current < 0) return;
    if (document.hidden) pauseSlideVideos(); else if (!dialogOpen()) playSlideVideos(slides[current], false);
  });

  /* ------------------------------------------------------------ indulás */
  window.addEventListener('resize', function () { fit(); scaleThumbs(); });
  window.addEventListener('orientationchange', fit);
  window.addEventListener('hashchange', function () {
    var n = parseInt((location.hash || '').replace('#', ''), 10);
    if (isFinite(n) && n > 0 && n - 1 !== current && started) show(n - 1, false);
  });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(fit).catch(function () { /* noop */ });

  var startAt = parseInt((location.hash || '').replace('#', ''), 10);
  fit();
  // mélylinkkel (#7) vagy ?start / ?nogate esetén nincs kapu
  if ((isFinite(startAt) && startAt > 0) || /[?&](start|nogate)\b/.test(location.search)) {
    gate.style.display = 'none';
    gate.classList.add('is-gone');
    started = true;
    show(isFinite(startAt) && startAt > 0 ? startAt - 1 : 0, false);
  } else {
    slides.forEach(function (sl) { sl.classList.remove('is-active'); });
    titleEl.textContent = '';
  }
})();
