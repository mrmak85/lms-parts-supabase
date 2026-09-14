/**
 * LMS Strip Width Calculator
 * Generalized for any straight-segment profile (C, U, V, Z, hat, etc.) —
 * build the profile as an ordered list of flat segments and the bends
 * between them, each bend with its own angle. Bend deduction is
 * estimated automatically from thickness / bend radius / K-factor, and
 * can be overridden per bend or refined via calibration against a
 * measured part.
 */
(function () {
  'use strict';

  function init(root) {
    var q = function (id) { return root.querySelector('[data-id="' + id + '"]'); };

    var thickness = q('thickness');
    var radius = q('radius');
    var kfactor = q('kfactor');
    var segBuilder = q('segBuilder');
    var addSegBtn = q('addSegBtn');
    var removeSegBtn = q('removeSegBtn');
    var resultValue = q('resultValue');
    var breakdown = q('breakdown');
    var measuredWidth = q('measuredWidth');
    var calibNote = q('calibNote');
    var calibBtn = q('calibBtn');
    var savedCalibWrap = q('savedCalibWrap');
    var savedCalibList = q('savedCalibList');

    if (!segBuilder || !resultValue) return;

    // Profile state: segments.length is always bends.length + 1.
    // Reproduces the classic Return-Leg-Web-Leg-Return (C-channel) shape
    // by default, just to keep the starting point familiar — but any
    // shape can be built from here.
    var segments = [25, 89, 300, 89, 25];
    var bends = [
      { angle: 90, override: null },
      { angle: 90, override: null },
      { angle: 90, override: null },
      { angle: 90, override: null }
    ];

    // Per-thickness correction (mm), applied to every bend's auto
    // deduction once calibrated. { thicknessValue: correctionMm }
    var calibrations = {};

    function fmt(n) { return isFinite(n) ? n.toFixed(2) : '0.00'; }
    function fmt1(n) { return isFinite(n) ? n.toFixed(1) : '0.0'; }

    function currentThicknessKey() {
      var t = parseFloat(thickness.value);
      return isFinite(t) ? t.toString() : null;
    }

    // Bend deduction estimate via the K-factor method:
    //   Bend Allowance (BA) = angle(rad) x (R + K x T)
    //   Setback (SB)         = tan(angle/2) x (R + T)
    //   Bend Deduction (BD)  = 2 x SB - BA
    function autoDeduction(angleDeg, R, T, K) {
      var rad = (angleDeg || 0) * Math.PI / 180;
      var BA = rad * (R + K * T);
      var SB = Math.tan(rad / 2) * (R + T);
      return 2 * SB - BA;
    }

    function bendDeductionValue(bend) {
      if (bend.override !== null && isFinite(bend.override)) return bend.override;
      var T = parseFloat(thickness.value) || 0;
      var R = parseFloat(radius.value) || 0;
      var K = parseFloat(kfactor.value) || 0;
      var correction = 0;
      var key = currentThicknessKey();
      if (key !== null && calibrations.hasOwnProperty(key)) correction = calibrations[key];
      return autoDeduction(bend.angle, R, T, K) + correction;
    }

    function renderSegBuilder() {
      var html = '';
      for (var i = 0; i < segments.length; i++) {
        html += '<div class="lms-swc-seg-row">' +
          '<label>Segment ' + (i + 1) + '</label>' +
          '<div class="lms-swc-field-row">' +
            '<input type="number" data-seg="' + i + '" value="' + segments[i] + '" step="any">' +
            '<span class="lms-swc-unit">mm</span>' +
          '</div>' +
        '</div>';
        if (i < bends.length) {
          var b = bends[i];
          var dedVal = bendDeductionValue(b);
          var isOverridden = b.override !== null;
          html += '<div class="lms-swc-bend-row">' +
            '<div class="lms-swc-bend-angle">' +
              '<label>Bend ' + (i + 1) + ' angle</label>' +
              '<div class="lms-swc-field-row">' +
                '<input type="number" data-bend-angle="' + i + '" value="' + b.angle + '" step="any">' +
                '<span class="lms-swc-unit">&deg;</span>' +
              '</div>' +
            '</div>' +
            '<div class="lms-swc-bend-ded">' +
              '<label>Deduction ' + (isOverridden ? '(manual)' : '(auto)') + '</label>' +
              '<div class="lms-swc-field-row">' +
                '<input type="number" data-bend-ded="' + i + '" value="' + fmt(dedVal) + '" step="any">' +
                '<span class="lms-swc-unit">mm</span>' +
              '</div>' +
            '</div>' +
            (isOverridden ? '<button type="button" class="lms-swc-reset-btn" data-bend-reset="' + i + '" title="Reset to auto">&#8635;</button>' : '') +
          '</div>';
        }
      }
      segBuilder.innerHTML = html;
      bindSegEvents();
    }

    function bindSegEvents() {
      segBuilder.querySelectorAll('[data-seg]').forEach(function (el) {
        el.addEventListener('input', function () {
          segments[parseInt(el.dataset.seg, 10)] = parseFloat(el.value) || 0;
          calculate();
        });
      });
      segBuilder.querySelectorAll('[data-bend-angle]').forEach(function (el) {
        el.addEventListener('input', function () {
          var idx = parseInt(el.dataset.bendAngle, 10);
          bends[idx].angle = parseFloat(el.value) || 0;
          // Angle changed: re-derive the auto deduction shown, unless overridden.
          renderSegBuilder();
          calculate();
        });
      });
      segBuilder.querySelectorAll('[data-bend-ded]').forEach(function (el) {
        el.addEventListener('change', function () {
          var idx = parseInt(el.dataset.bendDed, 10);
          var v = parseFloat(el.value);
          bends[idx].override = isFinite(v) ? v : null;
          renderSegBuilder();
          calculate();
        });
      });
      segBuilder.querySelectorAll('[data-bend-reset]').forEach(function (el) {
        el.addEventListener('click', function () {
          var idx = parseInt(el.dataset.bendReset, 10);
          bends[idx].override = null;
          renderSegBuilder();
          calculate();
        });
      });
    }

    function calculate() {
      var segSum = segments.reduce(function (a, b) { return a + (parseFloat(b) || 0); }, 0);
      var dedSum = bends.reduce(function (a, b) { return a + bendDeductionValue(b); }, 0);
      var result = segSum - dedSum;

      resultValue.textContent = fmt1(result);

      var segParts = segments.map(function (s) { return fmt1(s); }).join(' + ');
      var dedParts = bends.map(function (b, i) { return 'B' + (i + 1) + ': ' + fmt(bendDeductionValue(b)); }).join(', ');
      breakdown.innerHTML =
        'Sum of segments = ' + segParts + ' = ' + fmt1(segSum) + ' mm<br>' +
        'Bend deductions (' + bends.length + ') = ' + (dedParts || 'none') + ' = ' + fmt1(dedSum) + ' mm total<br>' +
        '<span class="lms-swc-final">Strip width = ' + fmt1(segSum) + ' &minus; ' + fmt1(dedSum) + ' = ' + fmt1(result) + ' mm</span>';
    }

    function applyCalibrationNote() {
      var key = currentThicknessKey();
      if (key !== null && calibrations.hasOwnProperty(key)) {
        calibNote.style.display = 'block';
        calibNote.textContent = 'Thickness ' + key + ' mm is calibrated: ' + (calibrations[key] >= 0 ? '+' : '') + fmt(calibrations[key]) + ' mm applied to every bend\'s auto deduction.';
      } else {
        calibNote.style.display = 'none';
      }
    }

    function renderSavedCalibrations() {
      var keys = Object.keys(calibrations);
      if (keys.length === 0) { savedCalibWrap.style.display = 'none'; return; }
      savedCalibWrap.style.display = 'block';
      savedCalibList.innerHTML = '';
      keys.sort(function (a, b) { return parseFloat(a) - parseFloat(b); }).forEach(function (k) {
        var chip = document.createElement('span');
        chip.className = 'lms-swc-chip';
        chip.innerHTML = k + ' mm &rarr; <b>' + (calibrations[k] >= 0 ? '+' : '') + fmt(calibrations[k]) + '</b> mm<span class="lms-swc-x" data-key="' + k + '">&times;</span>';
        savedCalibList.appendChild(chip);
      });
      savedCalibList.querySelectorAll('.lms-swc-x').forEach(function (el) {
        el.addEventListener('click', function (e) {
          delete calibrations[e.target.getAttribute('data-key')];
          renderSavedCalibrations();
          applyCalibrationNote();
          renderSegBuilder();
          calculate();
        });
      });
    }

    function calibrate() {
      var measured = parseFloat(measuredWidth.value);
      var key = currentThicknessKey();
      if (!isFinite(measured) || key === null || bends.length === 0) {
        window.alert('Build a profile with at least one bend, set a thickness, and enter a valid measured width first.');
        return;
      }
      var segSum = segments.reduce(function (a, b) { return a + (parseFloat(b) || 0); }, 0);
      // Current total deduction using auto values (ignore any per-bend manual overrides for this calc).
      var T = parseFloat(thickness.value) || 0;
      var R = parseFloat(radius.value) || 0;
      var K = parseFloat(kfactor.value) || 0;
      var autoDedSum = bends.reduce(function (a, b) { return a + autoDeduction(b.angle, R, T, K); }, 0);
      var neededDedSum = segSum - measured;
      var correctionTotal = neededDedSum - autoDedSum;
      var correctionPerBend = correctionTotal / bends.length;

      calibrations[key] = correctionPerBend;
      bends.forEach(function (b) { b.override = null; }); // let the new correction drive the auto value
      renderSavedCalibrations();
      applyCalibrationNote();
      renderSegBuilder();
      calculate();
    }

    addSegBtn.addEventListener('click', function () {
      segments.push(segments[segments.length - 1] || 50);
      bends.push({ angle: 90, override: null });
      renderSegBuilder();
      calculate();
    });
    removeSegBtn.addEventListener('click', function () {
      if (segments.length <= 1) return;
      segments.pop();
      bends.pop();
      renderSegBuilder();
      calculate();
    });
    thickness.addEventListener('input', function () { applyCalibrationNote(); renderSegBuilder(); calculate(); });
    radius.addEventListener('input', function () { renderSegBuilder(); calculate(); });
    kfactor.addEventListener('input', function () { renderSegBuilder(); calculate(); });
    calibBtn.addEventListener('click', calibrate);

    renderSegBuilder();
    renderSavedCalibrations();
    applyCalibrationNote();
    calculate();
  }

  function boot() {
    document.querySelectorAll('[data-lms-swc]').forEach(init);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
