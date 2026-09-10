/**
 * LMS Strip Width Calculator
 * Boots one independent instance for every [lms_strip_width_calculator]
 * shortcode found on the page, so several can safely coexist.
 */
(function () {
	'use strict';

	function init( root ) {
		var q = function ( id ) {
			return root.querySelector( '[data-id="' + id + '"]' );
		};

		var topFlange      = q( 'topFlange' );
		var sideLeg         = q( 'sideLeg' );
		var bottomWeb        = q( 'bottomWeb' );
		var thickness        = q( 'thickness' );
		var bendCount        = q( 'bendCount' );
		var bendDeduction    = q( 'bendDeduction' );
		var measuredWidth    = q( 'measuredWidth' );
		var calibNote        = q( 'calibNote' );
		var savedCalibWrap   = q( 'savedCalibWrap' );
		var savedCalibList   = q( 'savedCalibList' );
		var resultValue      = q( 'resultValue' );
		var breakdown        = q( 'breakdown' );
		var bendStepper       = q( 'bendStepper' );
		var calibBtn          = q( 'calibBtn' );

		if ( ! topFlange || ! resultValue ) {
			return;
		}

		// In-memory calibration store for this instance/session:
		// { thicknessValue: deductionValue }
		var calibrations = { '2': 2.75 };

		function fmt( n ) {
			return isFinite( n ) ? n.toFixed( 1 ) : '0.0';
		}

		function currentThicknessKey() {
			var t = parseFloat( thickness.value );
			return isFinite( t ) ? t.toString() : null;
		}

		function applyCalibrationIfPresent() {
			var key = currentThicknessKey();
			if ( key !== null && calibrations.hasOwnProperty( key ) ) {
				bendDeduction.value = calibrations[ key ];
				calibNote.style.display = 'block';
				calibNote.textContent = 'Thickness ' + key + ' mm is calibrated: deduction ' + fmt( calibrations[ key ] ) + ' mm per bend';
			} else {
				calibNote.style.display = 'none';
			}
		}

		function renderSavedCalibrations() {
			var keys = Object.keys( calibrations );
			if ( keys.length === 0 ) {
				savedCalibWrap.style.display = 'none';
				return;
			}
			savedCalibWrap.style.display = 'block';
			savedCalibList.innerHTML = '';
			keys
				.sort( function ( a, b ) {
					return parseFloat( a ) - parseFloat( b );
				} )
				.forEach( function ( k ) {
					var chip = document.createElement( 'span' );
					chip.className = 'lms-swc-chip';
					chip.innerHTML = k + ' mm &rarr; <b>' + fmt( calibrations[ k ] ) + '</b> mm<span class="lms-swc-x" data-key="' + k + '">&times;</span>';
					savedCalibList.appendChild( chip );
				} );
			savedCalibList.querySelectorAll( '.lms-swc-x' ).forEach( function ( el ) {
				el.addEventListener( 'click', function ( e ) {
					delete calibrations[ e.target.getAttribute( 'data-key' ) ];
					renderSavedCalibrations();
					applyCalibrationIfPresent();
				} );
			} );
		}

		function calculate() {
			var tf = parseFloat( topFlange.value ) || 0;
			var sl = parseFloat( sideLeg.value ) || 0;
			var bw = parseFloat( bottomWeb.value ) || 0;
			var bc = parseFloat( bendCount.value ) || 0;
			var bd = parseFloat( bendDeduction.value ) || 0;

			var outerSum = tf * 2 + sl * 2 + bw;
			var totalDeduction = bd * bc;
			var result = outerSum - totalDeduction;

			resultValue.textContent = fmt( result );
			breakdown.innerHTML =
				'Sum of outer dimensions = ' + tf + '&times;2 + ' + sl + '&times;2 + ' + bw + ' = ' + fmt( outerSum ) + ' mm<br>' +
				'Bend deduction = ' + bd + ' &times; ' + bc + ' = ' + fmt( totalDeduction ) + ' mm<br>' +
				'<span class="lms-swc-final">Strip width = ' + fmt( outerSum ) + ' &minus; ' + fmt( totalDeduction ) + ' = ' + fmt( result ) + ' mm</span>';
		}

		function calibrate() {
			var measured = parseFloat( measuredWidth.value );
			var tf = parseFloat( topFlange.value ) || 0;
			var sl = parseFloat( sideLeg.value ) || 0;
			var bw = parseFloat( bottomWeb.value ) || 0;
			var bc = parseFloat( bendCount.value ) || 0;
			var key = currentThicknessKey();

			if ( ! isFinite( measured ) || key === null || bc === 0 ) {
				window.alert( 'Enter a valid measured width, thickness and a non-zero bend count first.' );
				return;
			}

			var outerSum = tf * 2 + sl * 2 + bw;
			var deduction = ( outerSum - measured ) / bc;

			calibrations[ key ] = deduction;
			bendDeduction.value = deduction.toFixed( 2 );
			renderSavedCalibrations();
			applyCalibrationIfPresent();
			calculate();
		}

		[ topFlange, sideLeg, bottomWeb, bendCount, bendDeduction ].forEach( function ( el ) {
			el.addEventListener( 'input', calculate );
		} );
		thickness.addEventListener( 'input', function () {
			applyCalibrationIfPresent();
			calculate();
		} );
		bendStepper.addEventListener( 'click', function () {
			bendCount.value = ( parseInt( bendCount.value, 10 ) || 0 ) + 1;
			calculate();
		} );
		calibBtn.addEventListener( 'click', calibrate );

		renderSavedCalibrations();
		applyCalibrationIfPresent();
		calculate();
	}

	function boot() {
		document.querySelectorAll( '[data-lms-swc]' ).forEach( init );
	}

	if ( document.readyState === 'loading' ) {
		document.addEventListener( 'DOMContentLoaded', boot );
	} else {
		boot();
	}
})();
