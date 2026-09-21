/**
 * Veronica Website - Admin Visitor Maps Dashboard Controller
 * Implements wireframe specifications:
 * 1. Removes .hero-banner on /maps so the navigation bar sits directly at top.
 * 2. Day-by-Day Interactive Timeline Dual-Slider with floating date hover tooltips (e.g. September 20th, 2026).
 * 3. Auto-refill / Zoom-in: Pulling a slider in rescales/refills the timeline so the chosen range becomes the new view bounds.
 * 4. "Full Range" button resets zoom back to the global bounds.
 * 5. Visitor Portfolio / Details Card directly under timeline with [x] deselect.
 * 6. Displaying max [N] filter showing newest visits in timeline range, backed by system_variables.db.
 * 7. Bidirectional selection (tick <-> generic map pin <-> portfolio) with Marian Blue glowing tick.
 */

document.addEventListener('DOMContentLoaded', () => {
    // 1. Remove .hero-banner from DOM on /maps to keep navbar clean and at the top
    const heroBanner = document.querySelector('.hero-banner');
    if (heroBanner) {
        heroBanner.remove();
    }

    // State & Data
    let visits = Array.isArray(window.VISITS_DATA) ? window.VISITS_DATA : [];
    let isAuthenticated = Boolean(window.SERVER_IS_AUTHENTICATED);
    let defaultMax = Number(window.DEFAULT_MAP_MAX) || 50;
    let selectedVisitId = null;

    // Normalize timestamps to epoch_ms
    visits.forEach((v) => {
        if (!v.epoch_ms) {
            const parsed = v.timestamp ? Date.parse(v.timestamp.replace(' ', 'T')) : NaN;
            v.epoch_ms = !isNaN(parsed) ? parsed : Date.now();
        }
    });

    // Auth Elements
    const loginContainer = document.getElementById('maps-login-container');
    const dashboardContainer = document.getElementById('maps-dashboard-container');
    const loginForm = document.getElementById('maps-login-form');
    const pwInput = document.getElementById('admin-password');
    const toggleBtn = document.getElementById('toggle-pw-btn');
    const pwIcon = document.getElementById('toggle-pw-icon');
    const errorAlert = document.getElementById('login-error-alert');
    const errorText = document.getElementById('login-error-text');
    const submitBtn = document.getElementById('login-submit-btn');

    // Dashboard Topbar Stats Elements
    const statTotalVisits = document.getElementById('stat-total-visits');
    const statUniqueIps = document.getElementById('stat-unique-ips');
    const statLocations = document.getElementById('stat-locations');

    // Timeline Elements
    const timelineRangeLabel = document.getElementById('timeline-range-label');
    const timelineVisitsCount = document.getElementById('timeline-visits-count');
    const timelineHighlight = document.getElementById('timeline-highlight-range');
    const timelineTicksContainer = document.getElementById('timeline-ticks-container');
    const sliderStart = document.getElementById('timeline-range-start');
    const sliderEnd = document.getElementById('timeline-range-end');
    const resetTimelineBtn = document.getElementById('timeline-reset-btn');
    const tooltipStart = document.getElementById('timeline-tooltip-start');
    const tooltipEnd = document.getElementById('timeline-tooltip-end');

    // Portfolio Elements
    const portfolioCard = document.getElementById('portfolio-card');
    const portfolioPlaceholder = document.getElementById('portfolio-placeholder');
    const portfolioContent = document.getElementById('portfolio-content');
    const portfolioCloseBtn = document.getElementById('portfolio-close-btn');
    const inspectLocationTitle = document.getElementById('inspect-location-title');
    const inspectPostalBadge = document.getElementById('inspect-postal-badge');
    const inspectTime = document.getElementById('inspect-time');
    const inspectIp = document.getElementById('inspect-ip');
    const inspectPage = document.getElementById('inspect-page');
    const inspectCoords = document.getElementById('inspect-coords');
    const inspectOrg = document.getElementById('inspect-org');
    const inspectUa = document.getElementById('inspect-ua');
    const inspectGmapsLink = document.getElementById('inspect-gmaps-link');

    // Map Elements & Controls
    const mapMaxInput = document.getElementById('map-max-input');
    const mapStatusBadge = document.getElementById('map-status-badge');
    const interactiveMapEl = document.getElementById('interactive-map');

    let map = null;
    let markers = [];
    let saveMaxTimeout = null;

    // Timeline Date State (Day-by-Day Granularity)
    let globalMinDate = null;
    let globalMaxDate = null;
    let viewMinDate = null;
    let viewMaxDate = null;
    let totalViewDays = 7;
    let isZoomed = false;

    // --- Helper: Format Ordinal Date (e.g., September 20th, 2026) ---
    function formatOrdinalDate(date) {
        if (!date || isNaN(date.getTime())) return '';
        const months = [
            'January', 'February', 'March', 'April', 'May', 'June',
            'July', 'August', 'September', 'October', 'November', 'December'
        ];
        const month = months[date.getMonth()];
        const day = date.getDate();
        const year = date.getFullYear();

        let suffix = 'th';
        if (day === 1 || day === 21 || day === 31) suffix = 'st';
        else if (day === 2 || day === 22) suffix = 'nd';
        else if (day === 3 || day === 23) suffix = 'rd';

        return `${month} ${day}${suffix}, ${year}`;
    }

    // --- 2. Password Visibility Toggle ---
    if (toggleBtn && pwInput && pwIcon) {
        toggleBtn.addEventListener('click', () => {
            if (pwInput.type === 'password') {
                pwInput.type = 'text';
                pwIcon.className = 'fa fa-eye-slash';
            } else {
                pwInput.type = 'password';
                pwIcon.className = 'fa fa-eye';
            }
        });
    }

    // --- 3. Seamless In-Page Login Handler ---
    if (loginForm) {
        loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const password = (pwInput ? pwInput.value : '').trim();
            if (!password) return;

            if (submitBtn) {
                submitBtn.disabled = true;
                submitBtn.innerHTML = '<i class="fa fa-spinner fa-spin"></i> Checking...';
            }
            if (errorAlert) errorAlert.style.display = 'none';

            try {
                const res = await fetch('/api/admin_login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ password: password })
                });

                const data = await res.json();

                if (res.ok && data.status === 'ok') {
                    visits = data.visits || [];
                    defaultMax = Number(data.default_max) || 50;

                    // Normalize timestamps
                    visits.forEach((v) => {
                        if (!v.epoch_ms) {
                            const parsed = v.timestamp ? Date.parse(v.timestamp.replace(' ', 'T')) : NaN;
                            v.epoch_ms = !isNaN(parsed) ? parsed : Date.now();
                        }
                    });

                    if (data.stats) {
                        if (statTotalVisits) statTotalVisits.textContent = data.stats.total_visits;
                        if (statUniqueIps) statUniqueIps.textContent = data.stats.unique_ips;
                        if (statLocations) statLocations.textContent = data.stats.unique_locations;
                    }

                    if (mapMaxInput) {
                        mapMaxInput.value = defaultMax;
                    }

                    if (loginContainer) loginContainer.style.display = 'none';
                    if (dashboardContainer) dashboardContainer.style.display = 'block';

                    isAuthenticated = true;
                    initDashboard();
                } else {
                    if (errorAlert) {
                        errorText.textContent = data.message || 'Invalid Speray Admin Password. Please try again.';
                        errorAlert.style.display = 'flex';
                    }
                    if (pwInput) {
                        pwInput.focus();
                        pwInput.select();
                    }
                }
            } catch (err) {
                loginForm.submit();
            } finally {
                if (submitBtn) {
                    submitBtn.disabled = false;
                    submitBtn.innerHTML = 'Submit';
                }
            }
        });
    }

    // --- 4. Initialize Dashboard ---
    function initDashboard() {
        if (!interactiveMapEl) return;

        computeGlobalDateBounds();
        initLeafletMap();
        refillTimeline(true);

        // Default to deselect placeholder
        clearSelection();
    }

    // Compute global min and max date bounds with blocky day-by-day granularity
    function computeGlobalDateBounds() {
        const now = new Date();
        let maxD = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
        let minD = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6, 0, 0, 0, 0);

        if (visits.length > 0) {
            const epochs = visits.map(v => v.epoch_ms).filter(Boolean);
            const earliest = Math.min(...epochs);
            const latest = Math.max(...epochs);

            const dEarly = new Date(earliest);
            const dLate = new Date(latest);

            const startEarly = new Date(dEarly.getFullYear(), dEarly.getMonth(), dEarly.getDate(), 0, 0, 0, 0);
            const endLate = new Date(dLate.getFullYear(), dLate.getMonth(), dLate.getDate(), 23, 59, 59, 999);

            const diffDays = Math.round((endLate.getTime() - startEarly.getTime()) / (24 * 3600 * 1000));
            if (diffDays < 7) {
                minD = new Date(endLate.getFullYear(), endLate.getMonth(), endLate.getDate() - 6, 0, 0, 0, 0);
                maxD = endLate;
            } else {
                minD = startEarly;
                maxD = endLate;
            }
        }

        globalMinDate = minD;
        globalMaxDate = maxD;
        viewMinDate = new Date(globalMinDate);
        viewMaxDate = new Date(globalMaxDate);
        isZoomed = false;
    }

    // Helper: calculate date for day index in current view window
    function getDateForIndex(idx) {
        return new Date(viewMinDate.getTime() + idx * 24 * 3600 * 1000);
    }

    // --- 5. Leaflet Map Initialization ---
    function initLeafletMap() {
        if (map) return;

        let initialLat = 39.3202;
        let initialLng = -84.5520;

        if (visits.length > 0 && visits[0].latitude && visits[0].longitude) {
            initialLat = Number(visits[0].latitude);
            initialLng = Number(visits[0].longitude);
        }

        map = L.map('interactive-map', {
            center: [initialLat, initialLng],
            zoom: visits.length > 1 ? 5 : 11,
            zoomControl: true
        });

        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
            maxZoom: 19
        }).addTo(map);

        setTimeout(() => {
            if (map) map.invalidateSize();
        }, 300);
    }

    // --- 6. Refill / Rescale Timeline ---
    // Rescales the timeline track to fill 100% with the active time bounds,
    // spreading out clustered ticks so they can be inspected clearly.
    function refillTimeline(resetToGlobal = false) {
        if (resetToGlobal) {
            viewMinDate = new Date(globalMinDate);
            viewMaxDate = new Date(globalMaxDate);
            isZoomed = false;
        }

        const msDiff = viewMaxDate.getTime() - viewMinDate.getTime();
        totalViewDays = Math.max(1, Math.round(msDiff / (24 * 3600 * 1000)));

        if (sliderStart && sliderEnd) {
            sliderStart.min = 0;
            sliderStart.max = totalViewDays;
            sliderStart.step = 1;
            sliderStart.value = 0;

            sliderEnd.min = 0;
            sliderEnd.max = totalViewDays;
            sliderEnd.step = 1;
            sliderEnd.value = totalViewDays;
        }

        renderTimelineTicks();
        updateTimelineVisualsAndMap(0, totalViewDays, false);
    }

    // --- 7. Render Timeline Ticks ---
    // Maps visits within the active view bounds proportionally across the entire bar.
    function renderTimelineTicks() {
        if (!timelineTicksContainer) return;
        timelineTicksContainer.innerHTML = '';

        const viewMinMs = viewMinDate.getTime();
        const viewMaxMs = viewMaxDate.getTime();
        const spanMs = viewMaxMs - viewMinMs;
        if (spanMs <= 0) return;

        const inWindowVisits = visits.filter(v => v.epoch_ms >= viewMinMs && v.epoch_ms <= viewMaxMs);

        inWindowVisits.forEach((v) => {
            const pct = Math.max(0, Math.min(100, ((v.epoch_ms - viewMinMs) / spanMs) * 100));
            const tick = document.createElement('div');
            tick.className = 'timeline-tick';
            tick.dataset.id = v.id;
            tick.style.left = `${pct}%`;

            const visitDate = new Date(v.epoch_ms).toLocaleString([], {
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            });
            tick.title = `${v.city || 'Visitor'} (${v.ip_address || '127.0.0.1'}) • ${visitDate}`;

            if (selectedVisitId === v.id) {
                tick.classList.add('glowing');
            }

            tick.addEventListener('click', (e) => {
                e.stopPropagation();
                selectVisit(v.id, { panMap: true });
            });

            timelineTicksContainer.appendChild(tick);
        });
    }

    // --- 8. Update Visuals, Tooltips, and Map Markers ---
    function updateTimelineVisualsAndMap(startVal, endVal, showTooltips = false) {
        if (startVal > endVal) {
            const temp = startVal;
            startVal = endVal;
            endVal = temp;
        }

        const pctStart = (startVal / totalViewDays) * 90 + 5;
        const pctEnd = (endVal / totalViewDays) * 90 + 5;

        if (timelineHighlight) {
            timelineHighlight.style.left = `${pctStart}%`;
            timelineHighlight.style.width = `${Math.max(0, pctEnd - pctStart)}%`;
        }

        const startDate = getDateForIndex(startVal);
        const endDate = getDateForIndex(endVal);

        // Update floating pop-up date tooltips
        if (tooltipStart && tooltipEnd) {
            tooltipStart.style.left = `${pctStart}%`;
            tooltipStart.textContent = formatOrdinalDate(startDate);

            tooltipEnd.style.left = `${pctEnd}%`;
            tooltipEnd.textContent = formatOrdinalDate(endDate);

            if (showTooltips) {
                tooltipStart.style.display = 'block';
                tooltipEnd.style.display = 'block';
            }
        }

        // Update timeline range header label
        const startStr = formatOrdinalDate(startDate);
        const endStr = formatOrdinalDate(endDate);
        if (timelineRangeLabel) {
            timelineRangeLabel.textContent = (startStr === endStr) ? startStr : `${startStr} – ${endStr}`;
            if (isZoomed) {
                timelineRangeLabel.textContent += ' (Zoomed)';
            }
        }

        // Sub-range filtering: from start of startDate to end of endDate
        const windowStartMs = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate(), 0, 0, 0, 0).getTime();
        const windowEndMs = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate(), 23, 59, 59, 999).getTime();

        const inRangeVisits = visits.filter(v => v.epoch_ms >= windowStartMs && v.epoch_ms <= windowEndMs);

        if (timelineVisitsCount) {
            timelineVisitsCount.textContent = `${inRangeVisits.length} visits`;
        }

        // Update dimming for ticks outside the active sub-selection
        if (timelineTicksContainer) {
            const allTicks = timelineTicksContainer.querySelectorAll('.timeline-tick');
            allTicks.forEach(tick => {
                const id = parseInt(tick.dataset.id, 10);
                const v = visits.find(item => item.id === id);
                if (v) {
                    if (v.epoch_ms >= windowStartMs && v.epoch_ms <= windowEndMs) {
                        tick.style.opacity = '1';
                    } else {
                        tick.style.opacity = '0.25';
                    }
                }
            });
        }

        // Max Visits control
        const sortedInRange = [...inRangeVisits].sort((a, b) => b.epoch_ms - a.epoch_ms);

        let maxN = defaultMax;
        if (mapMaxInput) {
            const parsed = parseInt(mapMaxInput.value, 10);
            if (!isNaN(parsed) && parsed > 0) {
                maxN = parsed;
            }
        }

        const displayedVisits = sortedInRange.slice(0, maxN);

        if (mapStatusBadge) {
            mapStatusBadge.textContent = `Showing ${displayedVisits.length} of ${inRangeVisits.length}`;
        }

        renderMapMarkers(displayedVisits);
    }

    // --- 9. Render Map Markers with Generic Map Pin Style ---
    function renderMapMarkers(displayedVisits) {
        if (!map) return;

        // Clear existing markers
        markers.forEach(m => map.removeLayer(m.marker));
        markers = [];

        displayedVisits.forEach((v) => {
            if (!v.latitude || !v.longitude) return;

            const isSelected = (v.id === selectedVisitId);

            const marianIcon = L.divIcon({
                className: `custom-marian-marker ${isSelected ? 'selected' : ''}`,
                html: `<div class="marian-marker-pin" id="marker-pin-${v.id}"><i class="fa fa-map-pin"></i></div>`,
                iconSize: [32, 32],
                iconAnchor: [16, 32],
                popupAnchor: [0, -32]
            });

            const marker = L.marker([v.latitude, v.longitude], { icon: marianIcon }).addTo(map);

            const popupContent = `
                <div class="map-popup-card">
                    <h5 class="popup-title">${v.city || 'Visitor Location'}${v.region ? ', ' + v.region : ''}</h5>
                    <p class="popup-sub"><i class="fa fa-network-wired icon-secondary"></i> ${v.ip_address || '127.0.0.1'}</p>
                    <p class="popup-sub"><i class="fa fa-file-code icon-secondary"></i> ${v.page_visited || '/home'}</p>
                    <p class="popup-sub"><i class="fa fa-clock icon-secondary"></i> ${v.timestamp || ''}</p>
                </div>
            `;
            marker.bindPopup(popupContent);

            marker.on('click', (e) => {
                L.DomEvent.stopPropagation(e);
                selectVisit(v.id, { panMap: false });
            });

            markers.push({ id: v.id, marker: marker, data: v });
        });

        if (selectedVisitId) {
            const selectedMarkerObj = markers.find(m => m.id === selectedVisitId);
            if (selectedMarkerObj) {
                selectedMarkerObj.marker.openPopup();
            }
        }
    }

    // --- 10. Selection & Deselection Logic ---
    function selectVisit(id, options = {}) {
        const panMap = options.panMap !== false;
        selectedVisitId = id;

        const v = visits.find(item => item.id === id);
        if (!v) return;

        // 1. Highlight Tick mark in glowing Marian Blue
        const allTicks = timelineTicksContainer.querySelectorAll('.timeline-tick');
        allTicks.forEach(tick => {
            if (parseInt(tick.dataset.id, 10) === id) {
                tick.classList.add('glowing');
            } else {
                tick.classList.remove('glowing');
            }
        });

        // 2. Highlight Map Pin
        markers.forEach(m => {
            const el = m.marker.getElement();
            if (m.id === id) {
                if (el) el.classList.add('selected');
                m.marker.openPopup();
            } else {
                if (el) el.classList.remove('selected');
            }
        });

        if (panMap && map && v.latitude && v.longitude) {
            map.flyTo([v.latitude, v.longitude], Math.max(map.getZoom(), 12), { duration: 0.6 });
        }

        // 3. Populate Visitor Portfolio Card
        if (portfolioPlaceholder) portfolioPlaceholder.style.display = 'none';
        if (portfolioContent) portfolioContent.style.display = 'block';

        const locString = `${v.city || 'Harrodsburg'}${v.region ? ', ' + v.region : ''}, ${v.country || 'United States'}`;
        if (inspectLocationTitle) inspectLocationTitle.textContent = locString;
        if (inspectPostalBadge) {
            inspectPostalBadge.textContent = v.postal ? `Postal: ${v.postal}` : 'Postal: N/A';
        }
        if (inspectTime) inspectTime.textContent = v.timestamp || new Date(v.epoch_ms).toLocaleString();
        if (inspectIp) inspectIp.textContent = v.ip_address || '127.0.0.1';
        if (inspectPage) inspectPage.textContent = v.page_visited || '/home';
        if (inspectCoords) {
            const lat = Number(v.latitude) || 37.7640;
            const lng = Number(v.longitude) || -84.8436;
            inspectCoords.textContent = `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
        }
        if (inspectOrg) inspectOrg.textContent = v.org || 'Local Network / ISP';
        if (inspectUa) inspectUa.textContent = v.user_agent || 'Mozilla/5.0 Web Browser';
        if (inspectGmapsLink) {
            inspectGmapsLink.href = `https://www.google.com/maps/search/?api=1&query=${v.latitude},${v.longitude}`;
        }
    }

    function clearSelection() {
        selectedVisitId = null;

        if (timelineTicksContainer) {
            const allTicks = timelineTicksContainer.querySelectorAll('.timeline-tick');
            allTicks.forEach(tick => tick.classList.remove('glowing'));
        }

        markers.forEach(m => {
            const el = m.marker.getElement();
            if (el) el.classList.remove('selected');
        });
        if (map) map.closePopup();

        if (portfolioContent) portfolioContent.style.display = 'none';
        if (portfolioPlaceholder) portfolioPlaceholder.style.display = 'block';
    }

    if (portfolioCloseBtn) {
        portfolioCloseBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            clearSelection();
        });
    }

    // Reset Full Range button: Restores full global bounds and refills timeline
    if (resetTimelineBtn) {
        resetTimelineBtn.addEventListener('click', () => {
            clearSelection();
            refillTimeline(true);
        });
    }

    // --- 11. Bind Timeline Range Sliders with Hover Tooltips & Auto-Zoom ---
    if (sliderStart && sliderEnd) {
        const onSliderInput = (e) => {
            let s = parseInt(sliderStart.value, 10);
            let end = parseInt(sliderEnd.value, 10);

            if (e.target === sliderStart && s > end) {
                sliderEnd.value = s;
                end = s;
            } else if (e.target === sliderEnd && end < s) {
                sliderStart.value = end;
                s = end;
            }

            updateTimelineVisualsAndMap(s, end, true);
        };

        // When user finishes sliding (change event): Auto-refill / Zoom-in to selected range
        const onSliderChange = () => {
            if (tooltipStart) tooltipStart.style.display = 'none';
            if (tooltipEnd) tooltipEnd.style.display = 'none';

            let s = parseInt(sliderStart.value, 10);
            let end = parseInt(sliderEnd.value, 10);

            if (s > end) {
                const temp = s;
                s = end;
                end = temp;
            }

            // If the user narrowed down the range, zoom in and refill
            if (s > 0 || end < totalViewDays) {
                const chosenStartDate = getDateForIndex(s);
                const chosenEndDate = getDateForIndex(end);

                viewMinDate = new Date(chosenStartDate.getFullYear(), chosenStartDate.getMonth(), chosenStartDate.getDate(), 0, 0, 0, 0);
                viewMaxDate = new Date(chosenEndDate.getFullYear(), chosenEndDate.getMonth(), chosenEndDate.getDate(), 23, 59, 59, 999);
                isZoomed = true;

                refillTimeline(false);
            }
        };

        sliderStart.addEventListener('input', onSliderInput);
        sliderEnd.addEventListener('input', onSliderInput);
        sliderStart.addEventListener('change', onSliderChange);
        sliderEnd.addEventListener('change', onSliderChange);

        // Hover listeners for tooltips
        sliderStart.addEventListener('mouseenter', () => {
            const s = parseInt(sliderStart.value, 10);
            const end = parseInt(sliderEnd.value, 10);
            updateTimelineVisualsAndMap(s, end, true);
        });
        sliderEnd.addEventListener('mouseenter', () => {
            const s = parseInt(sliderStart.value, 10);
            const end = parseInt(sliderEnd.value, 10);
            updateTimelineVisualsAndMap(s, end, true);
        });
        sliderStart.addEventListener('mouseleave', () => {
            if (tooltipStart) tooltipStart.style.display = 'none';
        });
        sliderEnd.addEventListener('mouseleave', () => {
            if (tooltipEnd) tooltipEnd.style.display = 'none';
        });
    }

    // --- 12. Bind "Displaying Max [N]" Input ---
    if (mapMaxInput) {
        mapMaxInput.addEventListener('input', () => {
            let val = parseInt(mapMaxInput.value, 10);
            if (!isNaN(val) && val > 0) {
                defaultMax = val;
                let s = sliderStart ? parseInt(sliderStart.value, 10) : 0;
                let end = sliderEnd ? parseInt(sliderEnd.value, 10) : totalViewDays;
                updateTimelineVisualsAndMap(s, end, false);

                clearTimeout(saveMaxTimeout);
                saveMaxTimeout = setTimeout(() => {
                    fetch('/api/set_map_max', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ max: val })
                    }).catch(() => {});
                }, 600);
            }
        });
    }

    // --- 13. Auto-initialize if authenticated ---
    if (isAuthenticated) {
        initDashboard();
    }
});
