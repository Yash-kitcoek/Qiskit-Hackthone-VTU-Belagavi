(() => {
    const content = document.getElementById('app-content');
    const modal = document.getElementById('form-modal');
    const modalContent = document.getElementById('modal-content');
    const toastRegion = document.getElementById('toast-region');
    const allowedPages = ['dispatch', 'overview', 'cargo', 'fleet', 'matching', 'bookings', 'optimization'];
    const initialPage = window.location.hash.slice(1);
    const state = { page: allowedPages.includes(initialPage) ? initialPage : 'dispatch', lastRenderedPage: null, role: 'transporter', data: null, search: '', cargoFilter: 'all', truckFilter: 'all', dispatchFilter: 'all', dispatchSearch: '', dispatchCity: 'All demo cities', selectedDispatchId: '', selectedTruckId: '', matchingCargoId: '', matching: null, matchingLoading: false, pendingBookings: new Set(), loading: false, controller: null };
    const vehicleLabels = { van: 'Cargo van', rigid: 'Rigid truck', flatbed: 'Flatbed', refrigerated: 'Refrigerated' };
    const statusLabels = { available: 'Available', booked: 'Booked', in_transit: 'In transit', delivered: 'Delivered', cancelled: 'Cancelled', confirmed: 'Confirmed', unavailable: 'Unavailable', maintenance: 'Maintenance' };
    const rolePermissions = {
        factory: { cargo: true, fleet: false, match: true, book: true, shipment: false },
        transporter: { cargo: false, fleet: true, match: true, book: true, shipment: true },
        broker: { cargo: true, fleet: true, match: true, book: true, shipment: true }
    };

    function esc(value) {
        return String(value ?? '').replace(/[&<>"']/g, character => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        })[character]);
    }

    function can(action) {
        return rolePermissions[state.role]?.[action] === true;
    }

    function money(value) {
        return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(value || 0);
    }

    function dateLabel(value, options = {}) {
        if (!value || Number.isNaN(new Date(value).getTime())) return 'Not set';
        return new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', ...options }).format(new Date(value));
    }

    function relativeLabel(value) {
        if (!value) return 'Scheduled';
        const hours = Math.round((new Date(value) - Date.now()) / 3600000);
        if (hours < 0) return `${Math.abs(hours)}h ago`;
        if (hours < 24) return `In ${hours}h`;
        return `In ${Math.ceil(hours / 24)} days`;
    }

    function localInput(value) {
        const date = value ? new Date(value) : new Date(Date.now() + 24 * 3600000);
        date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
        return date.toISOString().slice(0, 16);
    }

    function activeBookings() {
        return state.data.bookings.filter(booking => ['confirmed', 'in_transit'].includes(booking.status));
    }

    function isReserved(truckId) {
        return activeBookings().some(booking => booking.truckId === truckId);
    }

    function truckStatus(truck) {
        if (isReserved(truck.id)) return 'reserved';
        if (truck.availability !== 'available') return truck.availability;
        if (!truck.driverAvailable) return 'driver unavailable';
        if (!truck.compliant) return 'compliance review';
        return 'available';
    }

    function badge(status) {
        const slug = String(status || 'unknown').toLowerCase().replace(/[^a-z0-9]+/g, '-');
        return `<span class="status-badge status-${esc(slug)}"><i></i>${esc(statusLabels[status] || status)}</span>`;
    }

    function permissionHint(action) {
        if (can(action)) return '';
        return `<span class="permission-note">Available in another demo role</span>`;
    }

    async function api(path, options = {}) {
        const response = await fetch(path, {
            ...options,
            headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }
        });
        let payload;
        try {
            payload = await response.json();
        } catch (error) {
            throw new Error('The server returned an unreadable response. Please try again.');
        }
        if (!response.ok) {
            const message = payload.error || `Request failed (${response.status}).`;
            if (response.status === 409) await refreshState(false);
            throw new Error(message);
        }
        return payload;
    }

    async function refreshState(showLoading = true) {
        if (state.controller) state.controller.abort();
        state.controller = new AbortController();
        if (showLoading && !state.data) {
            state.loading = true;
            render();
        }
        try {
            const response = await fetch('/api/state', { signal: state.controller.signal });
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || 'Workspace data could not be loaded.');
            state.data = data;
            if (!state.matchingCargoId || !data.cargo.some(item => item.id === state.matchingCargoId && item.status === 'available')) {
                state.matchingCargoId = data.cargo.find(item => item.status === 'available')?.id || '';
                state.matching = null;
            }
            state.loading = false;
            render();
        } catch (error) {
            if (error.name === 'AbortError') return;
            state.loading = false;
            if (!state.data) renderError(error.message);
            else toast(error.message, 'error');
        }
    }

    function renderError(message) {
        content.innerHTML = `<section class="error-panel"><div class="error-symbol">!</div><h2>We couldn’t load the workspace</h2><p>${esc(message)}</p><button class="button button-primary" data-action="retry">Try again</button></section>`;
    }

    function toast(message, kind = 'success') {
        const item = document.createElement('div');
        item.className = `toast toast-${kind}`;
        item.setAttribute('role', kind === 'error' ? 'alert' : 'status');
        item.innerHTML = `<span class="toast-mark">${kind === 'error' ? '!' : '✓'}</span><span>${esc(message)}</span><button aria-label="Dismiss notification">×</button>`;
        toastRegion.append(item);
        item.querySelector('button').addEventListener('click', () => item.remove());
        window.setTimeout(() => item.remove(), 4800);
    }

    function pageHeading(eyebrow, title, description, action = '') {
        return `<div class="page-heading"><div><div class="eyebrow">${eyebrow}</div><h1>${title}</h1><p>${description}</p></div>${action}</div>`;
    }

    function button(label, action, style = 'button-primary', icon = '') {
        return `<button class="button ${style}" data-action="${action}">${icon ? `<span>${icon}</span>` : ''}${label}</button>`;
    }

    function render() {
        if (!state.data) {
            if (state.loading) content.innerHTML = '<div class="loading-state"><span class="spinner"></span><span>Opening your logistics workspace…</span></div>';
            return;
        }
        document.body.classList.toggle('dispatch-mode', state.page === 'dispatch');
        document.getElementById('app-shell').classList.toggle('dispatch-active', state.page === 'dispatch');
        document.getElementById('page-breadcrumb').textContent = {
            dispatch: 'Dispatch queue', overview: 'Overview', cargo: 'Cargo', fleet: 'Fleet', matching: 'Smart matching', bookings: 'Shipments', optimization: 'Optimization lab'
        }[state.page];
        document.querySelectorAll('.nav-link').forEach(link => link.classList.toggle('active', link.dataset.page === state.page));
        document.getElementById('cargo-nav-count').textContent = state.data.cargo.filter(item => item.status === 'available').length;
        renderNotifications();
        const renderer = {
            dispatch: renderDispatch,
            overview: renderOverview,
            cargo: renderCargo,
            fleet: renderFleet,
            matching: renderMatching,
            bookings: renderBookings,
            optimization: renderOptimization
        }[state.page];
        content.innerHTML = renderer();
        if (state.lastRenderedPage !== state.page) {
            content.classList.remove('page-enter');
            void content.offsetWidth;
            content.classList.add('page-enter');
            state.lastRenderedPage = state.page;
        }
    }

    function dispatchRecords() {
        const bookingRecords = state.data.bookings.map(booking => {
            const cargo = state.data.cargo.find(item => item.id === booking.cargoId);
            const truck = state.data.trucks.find(item => item.id === booking.truckId);
            return { ...booking, recordType: 'booking', cargo, truck, recordId: booking.id };
        });
        const unassignedRecords = state.data.cargo
            .filter(cargo => cargo.status === 'available')
            .map(cargo => ({ ...cargo, recordType: 'cargo', recordId: cargo.id, truck: null }));
        return [...bookingRecords, ...unassignedRecords].sort((a, b) =>
            new Date(a.pickupAt || a.createdAt) - new Date(b.pickupAt || b.createdAt)
        );
    }

    function dispatchStatus(record) {
        return record.recordType === 'cargo' ? 'waiting' : record.status;
    }

    function dispatchDistance(record) {
        if (record.routeDistanceKm) return record.routeDistanceKm;
        if (!record.cargo || !record.truck) return null;
        const route = state.matching?.cargoId === record.cargo.id
            ? state.matching.candidates.find(candidate => candidate.truckId === record.truck.id)
            : null;
        return route?.routeDistanceKm || null;
    }

    function renderDispatch() {
        const allRecords = dispatchRecords();
        const filtered = allRecords.filter(record => {
            const status = dispatchStatus(record);
            const statusMatches = state.dispatchFilter === 'all'
                || (state.dispatchFilter === 'on_route' && status === 'in_transit')
                || (state.dispatchFilter === 'waiting' && status === 'waiting')
                || (state.dispatchFilter === 'delayed' && record.delayRisk === 'High')
                || (state.dispatchFilter === 'completed' && ['delivered', 'cancelled'].includes(status));
            const search = state.dispatchSearch.toLowerCase();
            const searchMatches = !search || [
                record.reference, record.cargoReference, record.pickup, record.destination,
                record.registration, record.truck?.registration, record.cargo?.category
            ].filter(Boolean).some(value => String(value).toLowerCase().includes(search));
            const cityMatches = state.dispatchCity === 'All demo cities'
                || record.pickup === state.dispatchCity || record.destination === state.dispatchCity;
            return statusMatches && searchMatches && cityMatches;
        });
        const selectedRecord = allRecords.find(record => record.recordId === state.selectedDispatchId) || filtered[0] || allRecords[0] || null;
        if (selectedRecord) {
            state.selectedDispatchId = selectedRecord.recordId;
            state.selectedTruckId = selectedRecord.truck?.id || state.selectedTruckId || state.data.trucks[0]?.id;
        }
        const selectedTruck = state.data.trucks.find(truck => truck.id === state.selectedTruckId)
            || selectedRecord?.truck || state.data.trucks[0] || null;
        const selectedStatus = selectedRecord ? dispatchStatus(selectedRecord) : '';
        const cityOptions = ['All demo cities', ...state.data.supportedCities];
        const onRoute = allRecords.filter(record => dispatchStatus(record) === 'in_transit');
        const waiting = allRecords.filter(record => dispatchStatus(record) === 'waiting');
        const delayed = allRecords.filter(record => record.delayRisk === 'High');
        const completed = allRecords.filter(record => ['delivered', 'cancelled'].includes(dispatchStatus(record)));
        const selectedDistance = selectedRecord ? dispatchDistance(selectedRecord) : null;
        return `<div class="dispatch-shell">
            <aside class="dispatch-rail" aria-label="Dispatch navigation">
                <a class="dispatch-logo" href="#dispatch" data-page="dispatch" aria-label="SmartLoad dispatch home"><span>⌁</span></a>
                <nav>${[
                    ['overview', '◫', 'Overview'],
                    ['dispatch', '⌖', 'Dispatch queue'],
                    ['matching', '⌘', 'Smart matching'],
                    ['cargo', '▤', 'Cargo'],
                    ['fleet', '▰', 'Fleet'],
                    ['bookings', '◷', 'Shipments'],
                    ['optimization', '⌬', 'Optimization lab']
                ].map(([page, icon, label]) => `<button class="rail-link ${state.page === page ? 'rail-active' : ''}" data-page="${page}" title="${label}" aria-label="${label}">${icon}</button>`).join('')}</nav>
                <div class="rail-bottom"><span class="dispatch-rail-status"></span><button data-action="dispatch-role" title="Switch demo role" aria-label="Switch demo role">AS</button></div>
            </aside>
            <section class="dispatch-column">
                <header class="dispatch-header"><a href="#dispatch" class="dispatch-wordmark" data-page="dispatch"><span class="dispatch-brand-mark">⌁</span><strong>SmartLoad<span>.ai</span></strong></a>
                    <div class="dispatch-crumb"><span>Workspace</span><b>/</b><strong>Dispatch queue</strong></div>
                    <div class="dispatch-header-actions"><label class="dispatch-search"><span>⌕</span><input id="dispatch-search" value="${esc(state.dispatchSearch)}" type="search" placeholder="Search loads & trucks" aria-label="Search dispatch"></label>
                        <label class="dispatch-select"><span class="sr-only">Filter by pickup city</span><select id="dispatch-city-filter">${cityOptions.map(city => `<option value="${esc(city)}" ${state.dispatchCity === city ? 'selected' : ''}>${esc(city)}</option>`).join('')}</select><span>⌄</span></label>
                        <span class="dispatch-period">DEMO QUEUE</span><button class="dispatch-header-icon" data-action="dispatch-alerts" aria-label="Show dispatch alerts">♧<i></i></button><button class="dispatch-avatar" data-action="dispatch-role" aria-label="Switch demo role">AS</button></div>
                </header>
                <div class="dispatch-main">
                    <section class="dispatch-queue">
                        <div class="dispatch-queue-heading"><div><span class="dispatch-eyebrow">OPERATIONS</span><h1>Dispatch queue</h1></div><span class="queue-total">${filtered.length} <small>loads</small></span></div>
                        <div class="dispatch-tabs" role="tablist" aria-label="Filter dispatch loads">${[
                            ['all', 'All', allRecords.length], ['on_route', 'On route', onRoute.length], ['waiting', 'Waiting', waiting.length], ['delayed', 'At risk', delayed.length], ['completed', 'Completed', completed.length]
                        ].map(([key, label, count]) => `<button role="tab" aria-selected="${state.dispatchFilter === key}" class="${state.dispatchFilter === key ? 'dispatch-tab-active' : ''}" data-action="dispatch-filter" data-filter="${key}">${label}<span>${count}</span></button>`).join('')}</div>
                        <div class="queue-list">${filtered.length ? filtered.map((record, index) => dispatchRecordCard(record, index)).join('') : `<div class="dispatch-empty"><span>⌁</span><strong>No loads in this view</strong><p>Change the filter or search to see other demo records.</p><button data-action="dispatch-filter" data-filter="all">Show all loads</button></div>`}</div>
                        <div class="queue-footer"><span class="dispatch-rail-status"></span> Server-backed demo records <span class="queue-footer-count">${allRecords.length} total</span></div>
                    </section>
                    <section class="dispatch-map-column">
                        <div class="dispatch-map" role="img" aria-label="Illustrative schematic route for the selected load. Not a live map or GPS position.">
                            ${renderDispatchMap(selectedRecord, selectedTruck)}
                            <div class="map-legend"><span><i class="map-legend-route"></i>Proposed route</span><span><i class="map-legend-stop"></i>Pickup & drop</span><span><i class="map-legend-estimate"></i>Illustrative · not live GPS</span></div>
                            <div class="map-top-chip"><span class="map-chip-dot"></span>ROUTE SCHEMATIC <b>NOT TO SCALE</b></div>
                            <div class="map-route-info"><div class="map-route-title"><i></i><span>${selectedRecord ? `${esc(selectedRecord.pickup)} → ${esc(selectedRecord.destination)}` : 'No route selected'}</span></div><div class="map-route-meta"><span>${selectedDistance ? `${selectedDistance} km · estimated` : 'Route distance unavailable'}</span><span>${selectedRecord?.deadline ? `Due ${dateLabel(selectedRecord.deadline)}` : 'Select a load'}</span></div></div>
                        </div>
                        <section class="freight-schedule">
                            <div class="schedule-header"><div><span class="dispatch-eyebrow">FLEET OVERVIEW · DEMO SCHEDULE</span><h2>Freight schedule</h2></div><div class="schedule-tools"><span>Next 24 hours</span><span class="schedule-now"><i></i>Illustrative windows</span></div></div>
                            ${renderSchedule(state.data.trucks, allRecords)}
                        </section>
                    </section>
                    <aside class="dispatch-detail">
                        ${renderVehicleDetail(selectedRecord, selectedTruck, selectedStatus, selectedDistance)}
                        ${renderLoadPlanning(allRecords, selectedRecord)}
                    </aside>
                </div>
                <footer class="dispatch-footer"><span>SmartLoad AI <i>·</i> Hackathon demo</span><span>Estimated route and timing only. No live traffic, GPS, or mapping service is connected.</span><button data-page="overview">Classic dashboard ↗</button></footer>
            </section>
        </div>`;
    }

    function dispatchRecordCard(record, index) {
        const status = dispatchStatus(record);
        const label = status === 'waiting' ? 'Waiting' : status === 'in_transit' ? 'In transit' : status === 'confirmed' ? 'Confirmed' : status === 'delivered' ? 'Completed' : status === 'cancelled' ? 'Cancelled' : status === 'available' ? 'Waiting' : statusLabels[status] || status;
        const statusClass = status === 'waiting' || status === 'available' ? 'dispatch-state-waiting' : status === 'in_transit' ? 'dispatch-state-route' : status === 'confirmed' ? 'dispatch-state-booked' : status === 'delivered' ? 'dispatch-state-complete' : status === 'cancelled' ? 'dispatch-state-cancelled' : 'dispatch-state-delayed';
        const reference = record.cargoReference || record.reference || record.id;
        const driver = record.truck?.driverName || 'Driver not specified';
        const registration = record.registration || record.truck?.registration || 'No truck assigned';
        const km = dispatchDistance(record);
        const progress = status === 'in_transit' ? 62 : status === 'confirmed' ? 24 : status === 'delivered' ? 100 : 0;
        return `<button class="dispatch-record ${state.selectedDispatchId === record.recordId ? 'dispatch-record-selected' : ''}" data-action="select-dispatch" data-id="${esc(record.recordId)}" aria-pressed="${state.selectedDispatchId === record.recordId}" style="--record-delay:${Math.min(index, 5) * 35}ms">
            <div class="record-heading"><strong>${esc(reference)}</strong><span class="dispatch-state ${statusClass}"><i></i>${esc(label)}</span></div>
            <div class="record-route"><span class="record-pin"></span><span>${esc(record.pickup)}</span><b>→</b><span>${esc(record.destination)}</span></div>
            <div class="record-meta"><span>◷ &nbsp;${record.deadline ? dateLabel(record.deadline) : 'Pickup pending'}</span><span>${km ? `${km} km est.` : 'Route estimate pending'}</span></div>
            <div class="record-driver"><span class="record-avatar">${registration === 'No truck assigned' ? '—' : 'TR'}</span><span><strong>${esc(driver)}</strong><small>${esc(registration)}</small></span><span class="record-chevron">›</span></div>
            <span class="record-progress"><i class="${status === 'in_transit' ? 'progress-blue' : status === 'delivered' ? 'progress-green' : 'progress-amber'}" style="width:${progress}%"></i></span>
        </button>`;
    }

    function renderDispatchMap(record, truck) {
        const seed = record ? [...String(record.recordId)].reduce((sum, character) => sum + character.charCodeAt(0), 0) : 3;
        const bends = [
            [[92, 338], [142, 317], [143, 270], [226, 258], [238, 198], [332, 181], [378, 125], [505, 115], [556, 66]],
            [[92, 338], [155, 320], [177, 276], [252, 263], [280, 212], [367, 200], [402, 142], [500, 126], [556, 66]],
            [[92, 338], [150, 293], [209, 300], [230, 238], [302, 229], [341, 173], [420, 171], [456, 115], [556, 66]]
        ];
        const route = bends[seed % bends.length].map(point => point.join(',')).join(' ');
        const mid = bends[seed % bends.length][Math.max(2, Math.floor(bends[seed % bends.length].length * .56))];
        const mapNames = [record?.pickup, 'Illustrative waypoint', record?.destination];
        return `<div class="city-blocks" aria-hidden="true">${Array.from({ length: 27 }, (_, index) => `<i class="city-block block-${(index * 7 + seed) % 5}" style="--x:${(index * 67 + seed * 13) % 98}%;--y:${(index * 41 + seed * 9) % 87}%;--w:${35 + (index * 17) % 48}px;--h:${18 + (index * 13) % 38}px"></i>`).join('')}</div>
            <div class="map-road-grid" aria-hidden="true"></div>
            <svg class="dispatch-route-svg" viewBox="0 0 650 390" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><defs><filter id="route-glow"><feGaussianBlur stdDeviation="5" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs><polyline class="dispatch-route-shadow" points="${route}"/><polyline class="dispatch-route-line" points="${route}"/><circle class="dispatch-route-start" cx="92" cy="338" r="8"/><circle class="dispatch-route-dest" cx="556" cy="66" r="8"/><circle class="dispatch-waypoint" cx="${mid[0]}" cy="${mid[1]}" r="5"/></svg>
            <span class="map-label map-label-start">${esc(mapNames[0] || 'Pickup')}<small>PICKUP</small></span><span class="map-label map-label-end">${esc(mapNames[2] || 'Destination')}<small>DROP-OFF</small></span>
            <div class="map-intersection intersection-one" aria-hidden="true">DEMO ROUTE</div><div class="map-intersection intersection-two" aria-hidden="true">NOT TO SCALE</div>`;
    }

    function renderVehicleDetail(record, truck, status, distance) {
        if (!truck) return `<article class="detail-card detail-empty"><span>▰</span><strong>No vehicle details</strong><p>Register a truck to see fleet details.</p><button data-page="fleet">Open fleet ↗</button></article>`;
        const activeRecord = record?.truck?.id === truck.id;
        const available = truckStatus(truck);
        const capacityPct = activeRecord && record.cargo ? Math.min(100, Math.round(record.cargo.weightKg / truck.capacityKg * 100)) : 0;
        return `<article class="detail-card vehicle-detail-card"><div class="detail-card-top"><span>${esc(truck.id)}</span>${badge(available)}</div>
            <div class="truck-blueprint"><div class="blueprint-label">VEHICLE PROFILE · SCHEMATIC</div><svg viewBox="0 0 360 140" role="img" aria-label="${esc(vehicleLabels[truck.vehicleType])} vehicle illustration"><g fill="none" stroke="currentColor" stroke-width="1.5"><path d="M25 100h20l15-39h113v39h-20m-68 0H67m107 0h38l15-14h42l21 14h29v14H24v-14h20"/><path d="M60 63 74 43h83v20m-75-18v18m39-18v18m37-18v18m11 0h23l15 15v22m-93-37v37m24-37v37m68-37h34l17 24h-44m-59-18h59m33 0h35m-233 18h20m88 0h17"/><circle cx="70" cy="114" r="13"/><circle cx="70" cy="114" r="5"/><circle cx="225" cy="114" r="13"/><circle cx="225" cy="114" r="5"/></g><text x="204" y="78" fill="currentColor" font-size="7">${esc(vehicleLabels[truck.vehicleType]).toUpperCase()}</text></svg></div>
            <div class="vehicle-specs"><div><span>PAYLOAD</span><strong>${Number(truck.capacityKg).toLocaleString()} kg</strong></div><div><span>LOAD VOLUME</span><strong>${(truck.lengthM * truck.widthM * truck.heightM).toFixed(1)} m³</strong></div><div><span>ROUTE DISTANCE</span><strong>${distance ? `${distance} km est.` : 'Not estimated'}</strong></div><div><span>UTILIZATION</span><strong>${activeRecord && record.cargo ? `${capacityPct}%` : 'Unassigned'}</strong></div></div>
            <div class="capacity-meter"><span style="width:${capacityPct}%"></span></div>
            <div class="vehicle-badges">${truck.compliant ? '<span class="vehicle-tag tag-green">✓ Compliance</span>' : '<span class="vehicle-tag tag-amber">! Compliance check</span>'}${truck.driverAvailable ? '<span class="vehicle-tag tag-blue">✓ Driver ready</span>' : '<span class="vehicle-tag tag-amber">! Driver unavailable</span>'}<span class="vehicle-tag ${truck.equipment.length ? 'tag-green' : 'tag-muted'}">◇ ${truck.equipment.length ? truck.equipment.map(esc).join(', ') : 'No equipment tags'}</span></div>
            <div class="detail-driver"><span class="record-avatar">TR</span><div><strong>${esc(truck.driverName || 'Demo operator')}</strong><small>${esc(truck.registration)} · ${esc(truck.location)}</small></div><button data-action="go-fleet" aria-label="View fleet details">↗</button></div></article>`;
    }

    function renderLoadPlanning(records, selectedRecord) {
        const planned = records.filter(record => record.recordType === 'booking' && ['confirmed', 'in_transit'].includes(record.status)).slice(0, 4);
        const waiting = records.filter(record => record.recordType === 'cargo').slice(0, 3);
        const items = [...planned, ...waiting];
        return `<article class="detail-card planning-card"><div class="planning-heading"><div><h2>Load planning</h2><p>Workspace assignments · no live telematics</p></div><span>${items.length}</span></div>
            ${items.length ? `<div class="planning-list">${items.map((record, index) => {
                const isBooking = record.recordType === 'booking';
                const tag = isBooking ? (record.status === 'in_transit' ? 'In transit' : 'Booked') : 'Waiting';
                const tagClass = isBooking ? (record.status === 'in_transit' ? 'plan-tag-route' : 'plan-tag-booked') : 'plan-tag-waiting';
                const truckName = record.registration || 'Awaiting vehicle';
                return `<button class="planning-item ${selectedRecord?.recordId === record.recordId ? 'planning-selected' : ''}" data-action="select-dispatch" data-id="${esc(record.recordId)}"><span class="planning-order">${String(index + 1).padStart(2, '0')}</span><span class="planning-copy"><strong>${esc(record.cargoReference || record.reference)}</strong><small>${esc(record.pickup)} → ${esc(record.destination)} · ${esc(truckName)}</small></span><span class="planning-tag ${tagClass}">${tag}</span></button>`;
            }).join('')}</div>` : `<div class="planning-empty">No planned or waiting loads.</div>`}
            <button class="planning-footer" data-page="matching">Find a feasible match <span>↗</span></button></article>`;
    }

    function renderSchedule(trucks, records) {
        const hours = Array.from({ length: 10 }, (_, index) => `${String(index + 8).padStart(2, '0')}:00`);
        const lanes = trucks.slice(0, 5);
        return `<div class="schedule-scroll"><div class="schedule-grid">
            <div class="schedule-time-rail"><span class="schedule-now-label">DEMO</span>${hours.map(hour => `<span>${hour}</span>`).join('')}</div>
            ${lanes.map((truck, index) => {
                const assignments = records.filter(record => record.truck?.id === truck.id && ['confirmed', 'in_transit'].includes(record.status)).slice(0, 2);
                const assignment = assignments[0];
                const label = assignment
                    ? `${assignment.pickup.slice(0, 3).toUpperCase()}–${assignment.destination.slice(0, 3).toUpperCase()}`
                    : truck.availability === 'available' ? 'AVAILABLE' : truck.availability.toUpperCase();
                const left = assignment ? 8 + (index * 13) % 39 : 8 + (index * 9) % 35;
                const width = assignment ? 19 + (index * 7) % 15 : 13 + (index * 5) % 13;
                return `<div class="schedule-lane"><span class="schedule-truck-name">${esc(truck.id)}</span><div class="schedule-lane-track"><span class="schedule-assignment ${assignment ? index % 2 ? 'assignment-violet' : 'assignment-blue' : truck.availability === 'available' ? 'assignment-open' : 'assignment-offline'}" style="--slot-left:${left}%;--slot-width:${width}%"><span>${esc(label)}</span></span></div></div>`;
            }).join('')}
        </div></div>`;
    }

    function renderOverview() {
        const { cargo, trucks, bookings } = state.data;
        const openCargo = cargo.filter(item => ['available', 'booked', 'in_transit'].includes(item.status));
        const availableTrucks = trucks.filter(truck => truckStatus(truck) === 'available');
        const confirmed = bookings.filter(item => item.status === 'confirmed').length;
        const activeBookingsCount = bookings.filter(item => ['confirmed', 'in_transit'].includes(item.status)).length;
        const avgCost = activeBookingsCount
            ? Math.round(bookings.filter(item => ['confirmed', 'in_transit'].includes(item.status)).reduce((sum, item) => sum + item.estimatedCost, 0) / activeBookingsCount)
            : 0;
        const atRisk = bookings.filter(item => ['confirmed', 'in_transit'].includes(item.status) && item.delayRisk === 'High').length;
        const awaiting = cargo.filter(item => item.status === 'available').length;
        const recent = [...bookings].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 4);
        const statusCounts = [
            ['Available', cargo.filter(item => item.status === 'available').length, 'bar-blue'],
            ['Booked', cargo.filter(item => item.status === 'booked').length, 'bar-purple'],
            ['In transit', cargo.filter(item => item.status === 'in_transit').length, 'bar-green'],
            ['Delivered', cargo.filter(item => item.status === 'delivered').length, 'bar-gray'],
            ['Cancelled', cargo.filter(item => item.status === 'cancelled').length, 'bar-red']
        ];
        const statusTotal = Math.max(1, statusCounts.reduce((sum, item) => sum + item[1], 0));
        const firstCargo = cargo.find(item => item.status === 'available');
        return `
            ${pageHeading(new Intl.DateTimeFormat('en-IN', { weekday: 'long', month: 'long', day: 'numeric' }).format(new Date()).toUpperCase(), 'Your logistics, in sync.', 'A clearer view of every load, vehicle, and delivery.', button('Run Smart Match', 'go-matching', 'button-primary', '✳'))}
            <div class="mode-strip"><span class="mode-indicator"></span><div><strong>Demo workspace</strong><span>Data saves on this server. Route, cost and timing figures are illustrative estimates—not live dispatch data.</span></div><span class="mode-tag">DEMO MODE</span></div>
            <section class="metric-grid" aria-label="Workspace key performance indicators">
                <article class="metric-card metric-cargo"><div class="metric-top"><span>Active cargo</span><span class="metric-icon">▤</span></div><strong>${openCargo.length.toString().padStart(2, '0')}</strong><div class="metric-foot"><span class="metric-dot dot-blue"></span>${awaiting} need a truck</div><div class="metric-spark spark-blue"><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div></article>
                <article class="metric-card"><div class="metric-top"><span>Available fleet</span><span class="metric-icon">▰</span></div><strong>${availableTrucks.length.toString().padStart(2, '0')}</strong><div class="metric-foot"><span class="metric-dot dot-green"></span>Ready to be matched</div><div class="metric-spark spark-green"><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div></article>
                <article class="metric-card"><div class="metric-top"><span>Confirmed bookings</span><span class="metric-icon">◷</span></div><strong>${confirmed.toString().padStart(2, '0')}</strong><div class="metric-foot"><span class="metric-dot dot-purple"></span>${bookings.filter(item => item.status === 'in_transit').length} currently moving</div><div class="metric-spark spark-purple"><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div></article>
                <article class="metric-card"><div class="metric-top"><span>Average booked cost</span><span class="metric-icon">₹</span></div><strong class="metric-money">${avgCost ? money(avgCost) : '—'}</strong><div class="metric-foot"><span class="metric-dot dot-orange"></span>Configured operating rates</div><div class="metric-spark spark-orange"><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div></article>
                <article class="metric-card"><div class="metric-top"><span>At-risk shipments</span><span class="metric-icon">!</span></div><strong>${atRisk.toString().padStart(2, '0')}</strong><div class="metric-foot"><span class="metric-dot ${atRisk ? 'dot-red' : 'dot-green'}"></span>Deadline-slack heuristic</div><div class="metric-spark spark-red"><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div></article>
            </section>
            <section class="overview-grid">
                <article class="panel shipment-panel">
                    <div class="panel-heading"><div><h2>Shipment overview</h2><p>Status from this demo workspace</p></div><button class="text-button" data-page="bookings">All shipments <span>↗</span></button></div>
                    <div class="chart-summary"><strong>${cargo.length}</strong><span>total loads</span><span class="chart-legend"><i class="legend-blue"></i>Available <i class="legend-purple"></i>Booked <i class="legend-green"></i>In transit <i class="legend-gray"></i>Delivered <i class="legend-red"></i>Cancelled</span></div>
                    <div class="stacked-track" role="img" aria-label="Shipment status distribution">${statusCounts.map(([name, count, color]) => `<span class="${color}" style="width:${count / statusTotal * 100}%"></span>`).join('')}</div>
                    <div class="status-breakdown">${statusCounts.map(([name, count, color]) => `<button class="status-filter-link" data-action="filter-cargo" data-status="${name === 'Available' ? 'available' : name === 'In transit' ? 'in_transit' : name.toLowerCase()}" aria-label="Show ${name} cargo"><span><i class="${color}"></i>${name}</span><strong>${count}</strong></button>`).join('')}</div>
                </article>
                <article class="panel route-panel">
                    <div class="panel-heading"><div><h2>Route snapshot</h2><p>Illustrative route schematic · not to scale</p></div><span class="map-chip">DEMO ROUTE</span></div>
                    <div class="route-visual" aria-label="Illustrative route from Mumbai to Pune, not a live map">
                        <div class="route-graphic"><svg viewBox="0 0 440 155" role="img" aria-label="Schematic route"><path class="route-grid" d="M0 30H440M0 77H440M0 124H440M55 0V155M165 0V155M275 0V155M385 0V155"/><path class="route-line-shadow" d="M70 111C118 97 135 47 205 65s99 39 165-25"/><path class="route-line" d="M70 111C118 97 135 47 205 65s99 39 165-25"/><circle class="route-point" cx="70" cy="111" r="8"/><circle class="route-point route-destination" cx="370" cy="40" r="8"/><circle class="route-dot" cx="205" cy="65" r="5"/></svg><span class="route-city route-city-start">${esc(firstCargo?.pickup || 'Mumbai')}<small>PICKUP</small></span><span class="route-city route-city-end">${esc(firstCargo?.destination || 'Pune')}<small>DESTINATION</small></span></div>
                        <div class="route-facts"><div><span>Open loads</span><strong>${awaiting}</strong></div><div><span>Mapped demo cities</span><strong>${state.data.supportedCities.length}</strong></div><div><span>Route source</span><strong>Estimate</strong></div></div>
                    </div>
                </article>
                <article class="panel activity-panel">
                    <div class="panel-heading"><div><h2>Recent activity</h2><p>Updates from your workspace</p></div><button class="text-button" data-page="bookings">View all <span>↗</span></button></div>
                    ${recent.length ? `<div class="activity-list">${recent.map(item => `<div class="activity-item"><span class="activity-icon">${item.status === 'delivered' ? '✓' : '↗'}</span><div><strong>${esc(item.cargoReference)} · ${esc(item.pickup)} → ${esc(item.destination)}</strong><span>${esc(item.registration)} · ${dateLabel(item.createdAt)}</span></div>${badge(item.status)}</div>`).join('')}</div>` : `<div class="empty-inline"><span>◷</span><strong>No shipments yet</strong><p>Run a match to make your first booking.</p><button class="text-button" data-page="matching">Find a truck ↗</button></div>`}
                </article>
                <article class="panel insight-panel">
                    <div class="panel-heading"><div><h2>Ops signals</h2><p>Practical next steps</p></div><span class="sparkle-icon">✳</span></div>
                    <div class="signal-card"><span class="signal-icon signal-blue">▤</span><div><strong>${awaiting} load${awaiting === 1 ? '' : 's'} ready for matching</strong><p>Unassigned cargo can be checked against fleet constraints.</p></div></div>
                    <div class="signal-card"><span class="signal-icon signal-amber">◎</span><div><strong>Delay risk is an estimate</strong><p>No trained prediction service or live traffic feed is connected.</p></div></div>
                    <button class="button button-soft button-wide" data-page="matching">Open matching workspace <span>→</span></button>
                    <button class="text-button optimization-entry" data-page="optimization">Explore the optimization lab ↗</button>
                </article>
            </section>
            <div class="overview-bottom"><span>◉</span> Matching runs hard feasibility checks before comparing eligible trucks.<button class="text-button" data-page="matching">See how it works ↗</button></div>`;
    }

    function cargoRows(items) {
        if (!items.length) return `<tr><td colspan="7"><div class="table-empty"><span>▤</span><strong>No cargo found</strong><p>Try a different filter or add a load to the workspace.</p></div></td></tr>`;
        return items.map(item => `<tr>
            <td><div class="primary-cell"><strong>${esc(item.reference)}</strong><span>${esc(item.category)}</span></div></td>
            <td><div class="route-cell"><strong>${esc(item.pickup)} <span>→</span> ${esc(item.destination)}</strong><small>Pickup ${dateLabel(item.pickupAt)}</small></div></td>
            <td>${Number(item.weightKg).toLocaleString()} kg</td><td>${esc(vehicleLabels[item.vehicleType] || item.vehicleType)}</td>
            <td><span class="deadline-cell">${dateLabel(item.deadline)}</span></td><td>${badge(item.status)}</td>
            <td><div class="row-actions">${item.status === 'available' && can('cargo') ? `<button class="icon-button row-action" data-action="edit-cargo" data-id="${esc(item.id)}" aria-label="Edit ${esc(item.reference)}" title="Edit cargo">✎</button><button class="icon-button row-action danger-action" data-action="cancel-cargo" data-id="${esc(item.id)}" aria-label="Cancel ${esc(item.reference)}" title="Cancel cargo">×</button>` : ''}${item.status === 'available' ? `<button class="icon-button row-action" data-action="match-cargo" data-id="${esc(item.id)}" aria-label="Match ${esc(item.reference)}" title="Match cargo">↗</button>` : ''}</div></td>
        </tr>`).join('');
    }

    function renderCargo() {
        const items = state.data.cargo.filter(item => {
            const matchesFilter = state.cargoFilter === 'all' || item.status === state.cargoFilter;
            const query = state.search.toLowerCase();
            const matchesQuery = !query || [item.reference, item.category, item.pickup, item.destination, item.vehicleType].some(value => String(value).toLowerCase().includes(query));
            return matchesFilter && matchesQuery;
        }).sort((a, b) => new Date(a.pickupAt) - new Date(b.pickupAt));
        const action = can('cargo') ? button('Add cargo', 'add-cargo', 'button-primary', '+') : permissionHint('cargo');
        return `${pageHeading('LOAD MANAGEMENT', 'Cargo, at a glance.', 'Create and manage shipments with clear constraints and pickup windows.', action)}
            <section class="table-panel panel">
                <div class="table-toolbar"><div class="table-count"><strong>${items.length}</strong> loads <span>·</span> ${state.data.cargo.filter(item => item.status === 'available').length} need matching</div>
                    <div class="table-controls"><label class="search-field"><span>⌕</span><input id="cargo-search" type="search" value="${esc(state.search)}" placeholder="Search loads" aria-label="Search cargo"></label><label class="select-wrap"><span class="sr-only">Filter cargo by status</span><select id="cargo-filter"><option value="all">All statuses</option>${['available', 'booked', 'in_transit', 'delivered', 'cancelled'].map(status => `<option value="${status}" ${state.cargoFilter === status ? 'selected' : ''}>${statusLabels[status]}</option>`).join('')}</select><span>⌄</span></label></div>
                </div>
                <div class="table-scroll"><table><thead><tr><th>LOAD</th><th>ROUTE & PICKUP</th><th>WEIGHT</th><th>VEHICLE</th><th>DEADLINE</th><th>STATUS</th><th><span class="sr-only">Actions</span></th></tr></thead><tbody>${cargoRows(items)}</tbody></table></div>
                <div class="table-foot"><span>Showing ${items.length} of ${state.data.cargo.length} cargo records</span><span>Persistent demo data · server-backed</span></div>
            </section>
            <div class="inline-note"><span>i</span><p><strong>Supported route cities:</strong> ${state.data.supportedCities.join(', ')}. Unassigned loads only are editable or cancellable.</p></div>`;
    }

    function truckRows(items) {
        if (!items.length) return `<tr><td colspan="7"><div class="table-empty"><span>▰</span><strong>No trucks found</strong><p>Try another status filter or register a vehicle.</p></div></td></tr>`;
        return items.map(truck => {
            const status = truckStatus(truck);
            return `<tr><td><div class="primary-cell"><strong>${esc(truck.registration)}</strong><span>${esc(truck.id)}</span></div></td><td>${esc(vehicleLabels[truck.vehicleType] || truck.vehicleType)}</td>
                <td><div class="capacity-cell"><strong>${Number(truck.capacityKg).toLocaleString()} kg</strong><span>${truck.lengthM} × ${truck.widthM} × ${truck.heightM} m</span></div></td>
                <td><span class="location-cell">⌖ ${esc(truck.location)}</span></td><td>${money(truck.operatingCostPerKm)}<small class="muted-cell">/ km configured</small></td>
                <td>${badge(status)}</td><td>${can('fleet') ? `<button class="icon-button row-action" data-action="edit-truck" data-id="${esc(truck.id)}" aria-label="Edit ${esc(truck.registration)}" title="Edit truck">✎</button>` : ''}</td></tr>`;
        }).join('');
    }

    function renderFleet() {
        const items = state.data.trucks.filter(truck => {
            const status = truckStatus(truck);
            return (state.truckFilter === 'all' || status === state.truckFilter)
                && [truck.registration, truck.location, truck.vehicleType].some(value => String(value).toLowerCase().includes(state.search.toLowerCase()));
        });
        return `${pageHeading('FLEET MANAGEMENT', 'The right truck. Ready to roll.', 'Fleet capacity, equipment, driver readiness, and compliance in one place.', can('fleet') ? button('Register truck', 'add-truck', 'button-primary', '+') : permissionHint('fleet'))}
            <div class="fleet-summary">
                <div class="fleet-summary-card"><span class="fleet-symbol fleet-blue">▰</span><div><small>REGISTERED VEHICLES</small><strong>${state.data.trucks.length}</strong></div></div>
                <div class="fleet-summary-card"><span class="fleet-symbol fleet-green">✓</span><div><small>READY TO MATCH</small><strong>${state.data.trucks.filter(truck => truckStatus(truck) === 'available').length}</strong></div></div>
                <div class="fleet-summary-card"><span class="fleet-symbol fleet-amber">◷</span><div><small>RESERVED / OFFLINE</small><strong>${state.data.trucks.filter(truck => truckStatus(truck) !== 'available').length}</strong></div></div>
            </div>
            <section class="table-panel panel">
                <div class="table-toolbar"><div class="table-count"><strong>${items.length}</strong> vehicles <span>·</span> status includes active reservations</div><div class="table-controls"><label class="search-field"><span>⌕</span><input id="truck-search" type="search" value="${esc(state.search)}" placeholder="Search fleet" aria-label="Search fleet"></label><label class="select-wrap"><span class="sr-only">Filter trucks</span><select id="truck-filter"><option value="all">All vehicles</option>${['available', 'reserved', 'maintenance', 'unavailable', 'driver unavailable', 'compliance review'].map(status => `<option value="${status}" ${state.truckFilter === status ? 'selected' : ''}>${statusLabels[status] || status}</option>`).join('')}</select><span>⌄</span></label></div></div>
                <div class="table-scroll"><table><thead><tr><th>VEHICLE</th><th>TYPE</th><th>CAPACITY / INTERNAL SIZE</th><th>CURRENT CITY</th><th>OPERATING RATE</th><th>STATUS</th><th><span class="sr-only">Actions</span></th></tr></thead><tbody>${truckRows(items)}</tbody></table></div>
                <div class="table-foot"><span>Rates are operator-configured estimates, not a live quote.</span><span>Availability is rechecked by the booking API.</span></div>
            </section>
            <div class="equipment-strip"><div><strong>Equipment & readiness</strong><span>Equipment requirements are hard matching constraints.</span></div><div class="equipment-tags">${[...new Set(state.data.trucks.flatMap(truck => truck.equipment))].map(item => `<span>${esc(item)}</span>`).join('') || '<span>No equipment tags yet</span>'}</div></div>`;
    }

    function renderMatching() {
        const cargo = state.data.cargo.find(item => item.id === state.matchingCargoId && item.status === 'available');
        const feasible = state.matching?.candidates.filter(item => item.feasible) || [];
        const rejected = state.matching?.candidates.filter(item => !item.feasible) || [];
        const selected = feasible[0];
        return `${pageHeading('INTELLIGENT MATCHING', 'Every load has a best-fit truck.', 'Hard constraints first. Ranking only happens after safety and feasibility checks.', '')}
            <div class="matching-callout"><span class="matching-star">✳</span><div><strong>Feasibility is not a score.</strong><p>Overweight, incompatible, unready, non-compliant, dimensionally unsafe, reserved, or late candidates are rejected—not ranked lower.</p></div><span class="demo-chip">DETERMINISTIC DEMO</span></div>
            <section class="matching-layout">
                <div class="panel match-input-panel"><div class="panel-heading"><div><span class="step-label">01 / LOAD</span><h2>Choose cargo</h2><p>Select one open load to test against the fleet.</p></div><span class="step-count">1 of 1</span></div>
                    ${cargo ? `<label class="field-label" for="matching-cargo-select">Unassigned cargo</label><select class="form-control" id="matching-cargo-select">${state.data.cargo.filter(item => item.status === 'available').map(item => `<option value="${esc(item.id)}" ${item.id === state.matchingCargoId ? 'selected' : ''}>${esc(item.reference)} · ${esc(item.pickup)} → ${esc(item.destination)}</option>`).join('')}</select>
                        <div class="cargo-preview"><div class="preview-reference"><span class="cargo-glyph">▤</span><div><strong>${esc(cargo.reference)} · ${esc(cargo.category)}</strong><span>${esc(cargo.pickup)} → ${esc(cargo.destination)}</span></div></div><div class="preview-stats"><div><span>WEIGHT</span><strong>${Number(cargo.weightKg).toLocaleString()} kg</strong></div><div><span>DIMENSIONS</span><strong>${cargo.lengthM} × ${cargo.widthM} × ${cargo.heightM} m</strong></div><div><span>NEEDS</span><strong>${esc(vehicleLabels[cargo.vehicleType])}${cargo.handling.length ? ` · ${cargo.handling.map(esc).join(', ')}` : ''}</strong></div><div><span>DELIVER BY</span><strong>${dateLabel(cargo.deadline)}</strong></div></div></div>
                        ${can('match') ? `<button class="button button-primary button-wide match-run-button" data-action="run-matching" ${state.matchingLoading ? 'disabled' : ''}>${state.matchingLoading ? '<span class="spinner spinner-light"></span>Checking fleet…' : '✳ &nbsp; Run matching'}</button>` : permissionHint('match')}
                    ` : `<div class="empty-state"><span>▤</span><strong>No unassigned cargo</strong><p>Create a load to explore truck matching.</p>${can('cargo') ? button('Add cargo', 'add-cargo', 'button-secondary', '+') : ''}</div>`}
                    <div class="hard-check-list"><span>HARD CHECKS INCLUDED</span>${state.matching?.candidates[0]?.checks
                        ? state.matching.candidates[0].checks.map(check => `<div class="check-row ${check.passed ? 'check-passed' : 'check-failed'}"><span aria-hidden="true">${check.passed ? '✓' : '×'}</span><span>${esc(check.label)}</span></div>`).join('')
                        : '<div><span class="check-symbol">✓</span> Weight & internal dimensions</div><div><span class="check-symbol">✓</span> Vehicle type & handling equipment</div><div><span class="check-symbol">✓</span> Truck, driver & compliance status</div><div><span class="check-symbol">✓</span> Reservation overlap & delivery window</div>'}</div>
                </div>
                <div class="panel match-results-panel"><div class="panel-heading"><div><span class="step-label">02 / RECOMMENDATIONS</span><h2>Best-fit candidates</h2><p>${state.matching ? `${feasible.length} feasible · ${rejected.length} rejected` : 'Run matching to compare feasible trucks.'}</p></div>${state.matching ? '<span class="results-chip">MATCH COMPLETE</span>' : ''}</div>
                    ${state.matching ? (feasible.length ? `<div class="candidate-list">${feasible.map((candidate, index) => candidateCard(candidate, index, cargo)).join('')}</div>
                        <div class="candidate-rejections"><details><summary>${rejected.length} rejected truck${rejected.length === 1 ? '' : 's'} <span>See why</span></summary><div class="rejection-list">${rejected.map(candidate => `<div><strong>${esc(candidate.registration)}</strong><ul>${candidate.rejectionReasons.map(reason => `<li>${esc(reason)}</li>`).join('')}</ul></div>`).join('')}</div></details></div>` : `<div class="no-match"><div class="no-match-icon">⌁</div><h3>No feasible truck found</h3><p>We won't assign a truck that misses a hard requirement.</p><ul>${(state.matching.alternatives || []).map(item => `<li>${esc(item)}</li>`).join('')}</ul><div class="rejected-summary">${rejected.length} truck${rejected.length === 1 ? '' : 's'} checked · ${rejected.length} rejected</div></div>`)
                        : `<div class="results-placeholder"><div class="placeholder-route">⌁</div><strong>Your recommendations will appear here.</strong><span>Choose a load and run the feasibility check.</span></div>`}
                </div>
            </section>
            <section class="integrations-grid">
                <article class="integration-card"><span class="integration-icon ai-icon">✳</span><div><span class="integration-tag">MODEL SERVICE NOT CONNECTED</span><h3>Delay & suitability insights</h3><p>${selected ? `Deadline slack is evaluated with a transparent rule-of-thumb: ${esc(selected.delayRisk)} estimated risk for the top candidate.` : 'No trained model, confidence score, or contributing factors are available in this demo.'}</p><small>Heuristic estimate only · not an ML prediction</small></div></article>
                <article class="integration-card integration-link-card"><span class="integration-icon quantum-icon">⌘</span><div><span class="integration-tag">SOLVER NOT IMPLEMENTED</span><h3>Optimization lab</h3><p>No quantum service or quantum-inspired solver is configured. No speedup or quantum result is claimed.</p><button class="text-button" data-page="optimization">Open the lab ↗</button></div></article>
            </section>`;
    }

    function renderOptimization() {
        const cargo = state.data.cargo.find(item => item.id === state.matchingCargoId && item.status === 'available');
        const feasible = state.matching?.candidates.filter(item => item.feasible) || [];
        const best = feasible[0];
        return `${pageHeading('OPTIMIZATION LAB', 'Measure what the solver can prove.', 'Compare a real feasibility-ranked baseline with clearly disclosed solver availability.', button('Open Smart Match', 'go-matching', 'button-secondary', '⌘'))}
            <div class="lab-banner"><span class="lab-emblem">⌬</span><div><span class="step-label">QUANTUM SERVICE STATUS</span><strong>No quantum solver is connected.</strong><p>This workspace reports only the classical baseline returned by the feasibility engine. There are no quantum measurements, runtimes, speedups, or superiority claims.</p></div><span class="solver-status">NOT CONFIGURED</span></div>
            <section class="panel lab-case-panel"><div class="panel-heading"><div><span class="step-label">SAME TEST CASE · CLASSICAL BASELINE</span><h2>Optimization case</h2><p>Single-load feasibility and cost ranking, using current demo fleet data.</p></div><span class="map-chip">DETERMINISTIC DEMO</span></div>
                ${cargo ? `<div class="lab-input"><div class="lab-input-load"><span class="cargo-glyph">▤</span><div><span>SELECTED CARGO</span><strong>${esc(cargo.reference)} · ${esc(cargo.category)}</strong><small>${esc(cargo.pickup)} → ${esc(cargo.destination)} · ${Number(cargo.weightKg).toLocaleString()} kg · ${esc(vehicleLabels[cargo.vehicleType])}</small></div></div><button class="button button-primary" data-action="run-matching" ${state.matchingLoading ? 'disabled' : ''}>${state.matchingLoading ? '<span class="spinner spinner-light"></span>Evaluating…' : 'Evaluate classical baseline'}</button></div>` : `<div class="lab-empty"><span>No unassigned cargo is selected.</span><button class="button button-secondary" data-page="matching">Choose a cargo load</button></div>`}
                ${state.matching ? `<div class="solver-comparison">
                    <article class="solver-card solver-classical"><div class="solver-card-heading"><span class="solver-icon">C</span><div><strong>Classical feasibility ranking</strong><small>Measured request result · demo input</small></div><span class="solver-ready">COMPLETED</span></div>
                        ${best ? `<div class="solver-result"><span>BEST FEASIBLE ASSIGNMENT</span><strong>${esc(cargo?.reference || state.matching.cargoId)} → ${esc(best.registration)}</strong><small>${esc(vehicleLabels[best.vehicleType])} · ${best.utilizationPct}% capacity utilization</small></div><div class="solver-stats"><div><span>EST. COST</span><strong>${money(best.estimatedCost)}</strong></div><div><span>EST. DISTANCE</span><strong>${best.routeDistanceKm} km</strong></div><div><span>ETA</span><strong>${best.etaHours} hrs</strong></div><div><span>FEASIBILITY</span><strong class="feasible-value">All hard checks pass</strong></div></div><div class="assignment-link"><span>${esc(cargo?.pickup || 'Pickup')}</span><i></i><strong>${esc(best.registration)}</strong><i></i><span>${esc(cargo?.destination || 'Destination')}</span></div>` : `<div class="lab-no-solution"><strong>No feasible baseline assignment.</strong><span>${state.matching.candidates.length} truck${state.matching.candidates.length === 1 ? '' : 's'} checked · no hard constraints were relaxed.</span></div>`}
                    </article>
                    <article class="solver-card solver-quantum"><div class="solver-card-heading"><span class="solver-icon quantum-solver-icon">Q</span><div><strong>Quantum / inspired solver</strong><small>Comparable run · same case selected</small></div><span class="solver-unavailable">UNAVAILABLE</span></div><div class="solver-unavailable-content"><span class="quantum-placeholder">⌘</span><strong>No quantum result to compare</strong><p>A solver endpoint is not implemented. Runtime, objective, feasibility, and savings are therefore not reported.</p></div></article>
                </div><div class="lab-transparency"><span>i</span><span>Classical figures use the configured per-kilometre operating rate and a straight-line route estimate with a road-distance multiplier. They are not a live quote or route.</span></div>` : `<div class="lab-empty lab-needs-run"><span class="lab-emblem">⌁</span><strong>No result for this case yet.</strong><p>Run the classical check to see its actual feasibility and estimates here.</p><button class="button button-secondary" data-action="run-matching" ${state.matchingLoading ? 'disabled' : ''}>${state.matchingLoading ? 'Evaluating…' : 'Evaluate classical baseline'}</button></div>`}
            </section>
            <section class="lab-method"><span class="step-label">HOW TO READ THIS LAB</span><div><strong>Feasibility is the objective gate.</strong><p>Truck capacity, dimensions, vehicle type, handling, availability, overlapping reservations, route estimates, and deadlines are checked before any candidate is ranked. An infeasible candidate never gets a score.</p></div></section>`;
    }

    function candidateCard(candidate, index, cargo) {
        const booked = state.data.bookings.some(item => item.truckId === candidate.truckId && ['confirmed', 'in_transit'].includes(item.status));
        return `<article class="candidate-card ${index === 0 ? 'candidate-best' : ''}">
            <div class="candidate-top"><div class="candidate-rank">${index === 0 ? '✳' : `0${index + 1}`}</div><div class="candidate-title"><strong>${esc(candidate.registration)}</strong><span>${esc(vehicleLabels[candidate.vehicleType])} · ${candidate.truckId}${booked ? ' · other window reserved' : ''}</span></div><div class="candidate-score"><strong>${candidate.score}</strong><span>FIT SCORE</span></div></div>
            <p class="candidate-explanation">${esc(candidate.explanation)}</p>
            <div class="candidate-metrics"><div><span>EST. ROUTE DISTANCE</span><strong>${candidate.routeDistanceKm} km</strong></div><div><span>EST. OPERATING COST</span><strong>${money(candidate.estimatedCost)}</strong></div><div><span>EST. TRAVEL TIME</span><strong>${candidate.etaHours} hrs</strong></div><div><span>WEIGHT UTILIZATION</span><strong>${candidate.utilizationPct}%</strong><span class="utilization-track"><i style="width:${Math.min(candidate.utilizationPct, 100)}%"></i></span></div></div>
            <div class="candidate-bottom"><div><span class="risk-dot risk-${candidate.delayRisk.toLowerCase()}"></span><span>Deadline slack heuristic: <strong>${candidate.delayRisk} risk</strong></span><span class="estimate-label">ESTIMATE</span></div>${can('book') ? `<button class="button ${index === 0 ? 'button-primary' : 'button-secondary'} button-small" data-action="book-candidate" data-truck-id="${esc(candidate.truckId)}" data-cargo-id="${esc(cargo.id)}" ${state.pendingBookings.has(candidate.truckId) ? 'disabled' : ''}>${state.pendingBookings.has(candidate.truckId) ? 'Booking…' : 'Book this truck →'}</button>` : permissionHint('book')}</div>
            <details class="candidate-check-details"><summary>Feasibility checks <span>${candidate.checks?.filter(check => check.passed).length || 0}/${candidate.checks?.length || 0} passed</span></summary><ul>${(candidate.checks || []).map(check => `<li class="${check.passed ? 'check-passed' : 'check-failed'}"><i>${check.passed ? '✓' : '×'}</i><span><strong>${esc(check.label)}</strong><small>${esc(check.detail)}</small></span></li>`).join('')}</ul></details>
            ${index === 0 ? `<div class="plan-preview"><div class="mini-route" aria-label="Schematic route from ${esc(cargo.pickup)} to ${esc(cargo.destination)}"><span></span><i></i><span></span></div><span class="route-preview-copy"><strong>${esc(cargo.pickup)} <b>→</b> ${esc(cargo.destination)}</strong><small>Illustrative route · not to scale · estimated arrival ${dateLabel(candidate.estimatedDelivery)}</small></span><span class="route-cost">${money(candidate.estimatedCost)}<small>operator rate estimate</small></span></div>` : ''}
        </article>`;
    }

    function renderBookings() {
        const { bookings } = state.data;
        const activeCount = bookings.filter(item => ['confirmed', 'in_transit'].includes(item.status)).length;
        const rows = bookings.length ? bookings.map(booking => `<article class="booking-card">
            <div class="booking-status-rail rail-${esc(booking.status)}"></div><div class="booking-main"><div class="booking-heading"><div><span class="booking-ref">${esc(booking.reference)}</span><span class="booking-cargo">· ${esc(booking.cargoReference)}</span></div>${badge(booking.status)}</div>
                <div class="booking-route"><div><span>PICKUP</span><strong>${esc(booking.pickup)}</strong><small>${dateLabel(booking.pickupAt)}</small></div><span class="booking-arrow">→</span><div><span>DESTINATION</span><strong>${esc(booking.destination)}</strong><small>Deadline ${dateLabel(booking.deadline)}</small></div></div>
                <div class="booking-details"><span>▰ &nbsp;${esc(booking.registration)}</span><span>⌁ &nbsp;${booking.routeDistanceKm} km estimated</span><span>₹ &nbsp;${Number(booking.estimatedCost).toLocaleString()} estimated</span></div>
                ${['confirmed', 'in_transit'].includes(booking.status) && can('shipment') ? `<div class="milestone-track"><span class="${booking.status === 'confirmed' ? 'milestone-current' : 'milestone-done'}"><i></i>Confirmed</span><span class="${booking.status === 'in_transit' ? 'milestone-current' : ''}"><i></i>In transit</span><span><i></i>Delivered</span></div><div class="booking-actions">${booking.status === 'confirmed' ? `<button class="button button-secondary button-small" data-action="update-booking" data-status="in_transit" data-id="${esc(booking.id)}">Mark in transit</button>` : ''}${booking.status === 'in_transit' ? `<button class="button button-secondary button-small" data-action="update-booking" data-status="delivered" data-id="${esc(booking.id)}">Mark delivered</button>` : ''}<button class="text-button cancel-booking" data-action="update-booking" data-status="cancelled" data-id="${esc(booking.id)}">Cancel booking</button></div>` : ''}
            </div></article>`).join('') : `<div class="empty-state panel"><span>◷</span><strong>No shipments booked yet</strong><p>Match cargo with a feasible truck to create the first shipment.</p><button class="button button-primary" data-page="matching">Find a truck <span>→</span></button></div>`;
        return `${pageHeading('SHIPMENT TRACKING', 'From booking to delivery.', 'Follow shipment milestones and manage status updates for this workspace.', button('Find a truck', 'go-matching', 'button-primary', '✳'))}
            <div class="shipment-summary"><div><span class="summary-icon summary-purple">◷</span><div><small>ACTIVE SHIPMENTS</small><strong>${activeCount}</strong></div></div><div><span class="summary-icon summary-green">✓</span><div><small>DELIVERED</small><strong>${bookings.filter(item => item.status === 'delivered').length}</strong></div></div><div><span class="summary-icon summary-gray">↗</span><div><small>ALL BOOKINGS</small><strong>${bookings.length}</strong></div></div></div>
            <div class="booking-list">${rows}</div>
            <div class="tracking-disclaimer"><span>i</span> Milestones are workspace updates, not live GPS tracking. No driver location or traffic feed is connected.</div>`;
    }

    function renderNotifications() {
        const dot = document.getElementById('notification-dot');
        const popover = document.getElementById('notification-popover');
        const openLoads = state.data.cargo.filter(item => item.status === 'available').length;
        const signals = [];
        if (openLoads) signals.push(`${openLoads} load${openLoads === 1 ? '' : 's'} awaiting truck assignment.`);
        const active = activeBookings().length;
        if (active) signals.push(`${active} active booking${active === 1 ? '' : 's'} reserve fleet capacity.`);
        if (!signals.length) signals.push('No outstanding workspace alerts.');
        dot.hidden = !openLoads && !active;
        popover.innerHTML = `<div class="popover-heading"><strong>Workspace alerts</strong><span>DEMO</span></div>${signals.map((signal, index) => `<div class="popover-item"><i class="${index ? 'alert-purple' : 'alert-blue'}"></i><span>${esc(signal)}</span></div>`).join('')}<button class="text-button" data-page="cargo">Review cargo ↗</button>`;
    }

    function cityOptions(selected = '') {
        return state.data.supportedCities.map(city => `<option value="${esc(city)}" ${city === selected ? 'selected' : ''}>${esc(city)}</option>`).join('');
    }

    function vehicleOptions(selected = '') {
        return Object.entries(vehicleLabels).map(([value, label]) => `<option value="${value}" ${value === selected ? 'selected' : ''}>${label}</option>`).join('');
    }

    function handlingChecks(selected = []) {
        return state.data.handlingTypes.map(item => `<label class="check-option"><input type="checkbox" name="handling" value="${esc(item)}" ${selected.includes(item) ? 'checked' : ''}><span>${esc(item)}</span></label>`).join('');
    }

    function openCargoForm(cargo = null) {
        if (!can('cargo')) return toast('Switch to Factory or Broker demo role to manage cargo.', 'error');
        const editing = Boolean(cargo);
        modalContent.innerHTML = `<div class="modal-header"><div><span class="step-label">CARGO MANAGEMENT</span><h2 id="modal-title">${editing ? 'Edit cargo' : 'Add a cargo load'}</h2><p>Requirements stay explicit so unsafe matches are rejected.</p></div><button class="icon-button modal-close" aria-label="Close form">×</button></div>
            <form id="cargo-form" class="modal-form" data-id="${esc(cargo?.id || '')}" novalidate><div class="form-grid">
                <label class="form-field field-full"><span>Cargo category</span><input name="category" required maxlength="100" value="${esc(cargo?.category || '')}" placeholder="e.g. Industrial parts"></label>
                <label class="form-field"><span>Pickup city</span><select name="pickup" required><option value="">Select a city</option>${cityOptions(cargo?.pickup)}</select></label>
                <label class="form-field"><span>Destination city</span><select name="destination" required><option value="">Select a city</option>${cityOptions(cargo?.destination)}</select></label>
                <label class="form-field"><span>Weight <small>kg</small></span><input name="weightKg" type="number" min="0.1" step="any" required value="${cargo?.weightKg || ''}" placeholder="e.g. 2400"></label>
                <label class="form-field"><span>Required vehicle</span><select name="vehicleType" required>${vehicleOptions(cargo?.vehicleType)}</select></label>
                <label class="form-field"><span>Length <small>m</small></span><input name="lengthM" type="number" min="0.1" step="any" required value="${cargo?.lengthM || ''}"></label>
                <label class="form-field"><span>Width <small>m</small></span><input name="widthM" type="number" min="0.1" step="any" required value="${cargo?.widthM || ''}"></label>
                <label class="form-field"><span>Height <small>m</small></span><input name="heightM" type="number" min="0.1" step="any" required value="${cargo?.heightM || ''}"></label>
                <label class="form-field"><span>Pickup time</span><input name="pickupAt" type="datetime-local" required min="${localInput(new Date())}" value="${localInput(cargo?.pickupAt)}"></label>
                <label class="form-field"><span>Delivery deadline</span><input name="deadline" type="datetime-local" required min="${localInput(new Date())}" value="${localInput(cargo?.deadline)}"></label>
                <fieldset class="form-field field-full"><legend>Handling requirements <small>select all that apply</small></legend><div class="check-list">${handlingChecks(cargo?.handling || [])}</div></fieldset>
            </div><div class="modal-footer"><span>Demo routes support ${state.data.supportedCities.length} listed cities.</span><button type="button" class="button button-secondary modal-cancel">Cancel</button><button class="button button-primary" type="submit">${editing ? 'Save changes' : 'Create cargo'}</button></div></form>`;
        modal.showModal();
    }

    function openTruckForm(truck = null) {
        if (!can('fleet')) return toast('Switch to Transporter or Broker demo role to manage the fleet.', 'error');
        const editing = Boolean(truck);
        modalContent.innerHTML = `<div class="modal-header"><div><span class="step-label">FLEET MANAGEMENT</span><h2 id="modal-title">${editing ? 'Update truck' : 'Register a truck'}</h2><p>Capacity, availability, and equipment are checked before booking.</p></div><button class="icon-button modal-close" aria-label="Close form">×</button></div>
            <form id="truck-form" class="modal-form" data-id="${esc(truck?.id || '')}" novalidate><div class="form-grid">
                <label class="form-field field-full"><span>Vehicle registration</span><input name="registration" required maxlength="30" value="${esc(truck?.registration || '')}" placeholder="e.g. MH 12 AB 4821"></label>
                <label class="form-field"><span>Vehicle type</span><select name="vehicleType" required>${vehicleOptions(truck?.vehicleType)}</select></label>
                <label class="form-field"><span>Current city</span><select name="location" required><option value="">Select a city</option>${cityOptions(truck?.location)}</select></label>
                <label class="form-field"><span>Capacity <small>kg</small></span><input name="capacityKg" type="number" min="1" step="any" required value="${truck?.capacityKg || ''}"></label>
                <label class="form-field"><span>Availability</span><select name="availability"><option value="available" ${truck?.availability === 'available' ? 'selected' : ''}>Available</option><option value="unavailable" ${truck?.availability === 'unavailable' ? 'selected' : ''}>Unavailable</option><option value="maintenance" ${truck?.availability === 'maintenance' ? 'selected' : ''}>Maintenance</option></select></label>
                <label class="form-field"><span>Internal length <small>m</small></span><input name="lengthM" type="number" min="0.1" step="any" required value="${truck?.lengthM || ''}"></label>
                <label class="form-field"><span>Internal width <small>m</small></span><input name="widthM" type="number" min="0.1" step="any" required value="${truck?.widthM || ''}"></label>
                <label class="form-field"><span>Internal height <small>m</small></span><input name="heightM" type="number" min="0.1" step="any" required value="${truck?.heightM || ''}"></label>
                <label class="form-field"><span>Operating rate <small>₹ / km</small></span><input name="operatingCostPerKm" type="number" min="0.1" step="any" required value="${truck?.operatingCostPerKm || ''}"></label>
                <label class="form-field"><span>Fuel efficiency <small>km / L</small></span><input name="fuelEfficiencyKmPerL" type="number" min="0.1" step="any" required value="${truck?.fuelEfficiencyKmPerL || ''}"></label>
                <fieldset class="form-field field-full"><legend>Available equipment</legend><div class="check-list">${handlingChecks(truck?.equipment || [])}</div></fieldset>
                <div class="form-field field-full readiness-checks"><label><input type="checkbox" name="driverAvailable" ${truck?.driverAvailable === false ? '' : 'checked'}> Driver available</label><label><input type="checkbox" name="compliant" ${truck?.compliant === false ? '' : 'checked'}> Compliance confirmed</label></div>
            </div><div class="modal-footer"><span>Location estimate uses supported cities.</span><button type="button" class="button button-secondary modal-cancel">Cancel</button><button class="button button-primary" type="submit">${editing ? 'Save changes' : 'Register truck'}</button></div></form>`;
        modal.showModal();
    }

    function formObject(form, name) {
        const data = new FormData(form);
        const result = Object.fromEntries(data.entries());
        result[name === 'cargo' ? 'handling' : 'equipment'] = data.getAll('handling');
        if (name === 'cargo') {
            ['weightKg', 'lengthM', 'widthM', 'heightM'].forEach(key => result[key] = Number(result[key]));
        } else {
            ['capacityKg', 'lengthM', 'widthM', 'heightM', 'operatingCostPerKm', 'fuelEfficiencyKmPerL'].forEach(key => result[key] = Number(result[key]));
            result.driverAvailable = data.has('driverAvailable');
            result.compliant = data.has('compliant');
        }
        return result;
    }

    async function submitForm(event) {
        const form = event.target;
        if (form.id !== 'cargo-form' && form.id !== 'truck-form') return;
        event.preventDefault();
        if (!form.reportValidity()) return;
        const submit = form.querySelector('[type="submit"]');
        submit.disabled = true;
        const editingId = form.dataset.id;
        try {
            if (form.id === 'cargo-form') {
                const body = formObject(form, 'cargo');
                body.pickupAt = new Date(body.pickupAt).toISOString();
                body.deadline = new Date(body.deadline).toISOString();
                await api(editingId ? `/api/cargo/${encodeURIComponent(editingId)}` : '/api/cargo', {
                    method: editingId ? 'PATCH' : 'POST', body: JSON.stringify(body)
                });
                toast(editingId ? 'Cargo changes saved.' : 'Cargo load created.');
            } else {
                await api(editingId ? `/api/trucks/${encodeURIComponent(editingId)}` : '/api/trucks', {
                    method: editingId ? 'PATCH' : 'POST', body: JSON.stringify(formObject(form, 'truck'))
                });
                toast(editingId ? 'Truck details updated.' : 'Truck registered.');
            }
            modal.close();
            await refreshState(false);
        } catch (error) {
            toast(error.message, 'error');
            submit.disabled = false;
        }
    }

    async function runMatching() {
        if (state.matchingLoading) return;
        if (!state.matchingCargoId) return toast('Choose an open cargo load first.', 'error');
        state.matchingLoading = true;
        render();
        try {
            state.matching = await api('/api/matching', {
                method: 'POST', body: JSON.stringify({ cargoId: state.matchingCargoId })
            });
        } catch (error) {
            toast(error.message, 'error');
            state.matching = null;
        } finally {
            state.matchingLoading = false;
            render();
        }
    }

    async function bookCandidate(cargoId, truckId) {
        if (state.pendingBookings.has(truckId)) return;
        const candidate = state.matching?.candidates.find(item => item.truckId === truckId);
        if (!candidate?.feasible) return toast('This truck does not pass the current feasibility checks.', 'error');
        const accepted = window.confirm(`Confirm estimated booking with ${candidate.registration}?\n\nEstimated operating cost: ${money(candidate.estimatedCost)}\nEstimated distance: ${candidate.routeDistanceKm} km\n\nThe server will recheck cargo and truck availability.`);
        if (!accepted) return;
        state.pendingBookings.add(truckId);
        render();
        try {
            const booking = await api('/api/bookings', {
                method: 'POST', body: JSON.stringify({ cargoId, truckId })
            });
            state.page = 'bookings';
            state.matching = null;
            await refreshState(false);
            toast(`Booking ${booking.reference} confirmed.`);
        } catch (error) {
            toast(error.message, 'error');
            await refreshState(false);
        } finally {
            state.pendingBookings.delete(truckId);
            render();
        }
    }

    async function cancelCargo(id) {
        if (!window.confirm('Cancel this unassigned cargo load?')) return;
        try {
            await api(`/api/cargo/${encodeURIComponent(id)}/cancel`, { method: 'POST', body: '{}' });
            toast('Cargo load cancelled.');
            await refreshState(false);
        } catch (error) {
            toast(error.message, 'error');
        }
    }

    async function changeBooking(id, status) {
        const prompt = status === 'cancelled' ? 'Cancel this booking? Its cargo will return to the available queue.' : `Update shipment to "${statusLabels[status]}"?`;
        if (!window.confirm(prompt)) return;
        try {
            await api(`/api/bookings/${encodeURIComponent(id)}/status`, {
                method: 'PATCH', body: JSON.stringify({ status })
            });
            toast(status === 'cancelled' ? 'Booking cancelled; cargo is available again.' : `Shipment marked ${statusLabels[status].toLowerCase()}.`);
            await refreshState(false);
        } catch (error) {
            toast(error.message, 'error');
        }
    }

    function setPage(page) {
        if (!allowedPages.includes(page)) return;
        if (window.location.hash !== `#${page}`) window.history.pushState({ page }, '', `#${page}`);
        state.page = page;
        state.search = '';
        document.getElementById('sidebar').classList.remove('sidebar-open');
        document.getElementById('mobile-scrim').classList.remove('scrim-visible');
        render();
        window.scrollTo({ top: 0, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    }

    document.addEventListener('click', async event => {
        const pageButton = event.target.closest('[data-page]');
        if (pageButton) return setPage(pageButton.dataset.page);
        const actionButton = event.target.closest('[data-action]');
        if (!actionButton) return;
        const { action, id } = actionButton.dataset;
        if (action === 'retry') return refreshState(true);
        if (action === 'add-cargo') return openCargoForm();
        if (action === 'add-truck') return openTruckForm();
        if (action === 'go-matching') return setPage('matching');
        if (action === 'select-dispatch') {
            state.selectedDispatchId = id;
            const record = dispatchRecords().find(item => item.recordId === id);
            if (record?.truck) state.selectedTruckId = record.truck.id;
            render();
            return;
        }
        if (action === 'dispatch-filter') {
            state.dispatchFilter = actionButton.dataset.filter;
            render();
            return;
        }
        if (action === 'dispatch-role') {
            const roles = ['factory', 'transporter', 'broker'];
            updateRole(roles[(roles.indexOf(state.role) + 1) % roles.length]);
            return;
        }
        if (action === 'dispatch-alerts') {
            const count = state.data.cargo.filter(item => item.status === 'available').length;
            toast(count ? `${count} unassigned load${count === 1 ? '' : 's'} in this demo workspace.` : 'No unassigned loads in this workspace.');
            return;
        }
        if (action === 'go-fleet') return setPage('fleet');
        if (action === 'edit-cargo') return openCargoForm(state.data.cargo.find(item => item.id === id));
        if (action === 'edit-truck') return openTruckForm(state.data.trucks.find(item => item.id === id));
        if (action === 'cancel-cargo') return cancelCargo(id);
        if (action === 'match-cargo') {
            state.matchingCargoId = id;
            state.matching = null;
            setPage('matching');
            return;
        }
        if (action === 'run-matching') return runMatching();
        if (action === 'filter-cargo') {
            state.cargoFilter = actionButton.dataset.status;
            state.search = '';
            setPage('cargo');
            return;
        }
        if (action === 'book-candidate') return bookCandidate(actionButton.dataset.cargoId, actionButton.dataset.truckId);
        if (action === 'update-booking') return changeBooking(id, actionButton.dataset.status);
    });

    document.addEventListener('submit', submitForm);
    document.addEventListener('click', event => {
        if (event.target.closest('.modal-close') || event.target.closest('.modal-cancel')) modal.close();
    });
    function updateRole(role) {
        state.role = role;
        document.getElementById('role-select').value = role;
        document.getElementById('profile-role-select').value = role;
        render();
        const roleName = document.querySelector(`#role-select option[value="${role}"]`)?.textContent || role;
        toast(`Demo view switched to ${roleName}. Role selection is not backend authentication.`);
    }
    document.getElementById('role-select').addEventListener('change', event => updateRole(event.target.value));
    document.getElementById('profile-role-select').addEventListener('change', event => updateRole(event.target.value));
    document.getElementById('profile-button').addEventListener('click', event => {
        const popover = document.getElementById('profile-popover');
        popover.hidden = !popover.hidden;
        event.currentTarget.setAttribute('aria-expanded', String(!popover.hidden));
    });
    document.getElementById('notification-button').addEventListener('click', event => {
        const popover = document.getElementById('notification-popover');
        const isOpen = !popover.hidden;
        popover.hidden = isOpen;
        event.currentTarget.setAttribute('aria-expanded', String(!isOpen));
    });
    document.addEventListener('click', event => {
        if (!event.target.closest('.notification-wrap')) {
            document.getElementById('notification-popover').hidden = true;
            document.getElementById('notification-button').setAttribute('aria-expanded', 'false');
        }
        if (!event.target.closest('.sidebar-user') && !event.target.closest('.profile-popover')) {
            document.getElementById('profile-popover').hidden = true;
            document.getElementById('profile-button').setAttribute('aria-expanded', 'false');
        }
    });
    document.addEventListener('change', event => {
        if (event.target.id === 'dispatch-city-filter') {
            state.dispatchCity = event.target.value;
            render();
            const replacement = document.getElementById('dispatch-city-filter');
            if (replacement) replacement.value = state.dispatchCity;
        }
        if (event.target.id === 'cargo-filter') {
            state.cargoFilter = event.target.value;
            render();
        }
        if (event.target.id === 'truck-filter') {
            state.truckFilter = event.target.value;
            render();
        }
        if (event.target.id === 'matching-cargo-select') {
            state.matchingCargoId = event.target.value;
            state.matching = null;
            render();
        }
        if (event.target.id === 'cargo-search' || event.target.id === 'truck-search') {
            state.search = event.target.value;
            const id = event.target.id;
            const selection = event.target.selectionStart;
            render();
            const replacement = document.getElementById(id);
            replacement?.focus();
            if (replacement && selection !== null) replacement.setSelectionRange(selection, selection);
        }
    });
    document.addEventListener('input', event => {
        if (event.target.id === 'dispatch-search') {
            state.dispatchSearch = event.target.value;
            const selection = event.target.selectionStart;
            render();
            const replacement = document.getElementById('dispatch-search');
            replacement?.focus();
            if (replacement && selection !== null) replacement.setSelectionRange(selection, selection);
        }
    });
    document.getElementById('mobile-menu').addEventListener('click', () => {
        document.getElementById('sidebar').classList.toggle('sidebar-open');
        document.getElementById('mobile-scrim').classList.toggle('scrim-visible');
    });
    document.getElementById('mobile-scrim').addEventListener('click', () => {
        document.getElementById('sidebar').classList.remove('sidebar-open');
        document.getElementById('mobile-scrim').classList.remove('scrim-visible');
    });
    document.getElementById('form-modal').addEventListener('click', event => {
        if (event.target === modal) modal.close();
    });
    window.addEventListener('popstate', () => {
        const page = window.location.hash.slice(1);
        state.page = allowedPages.includes(page) ? page : 'overview';
        state.search = '';
        document.getElementById('sidebar').classList.remove('sidebar-open');
        document.getElementById('mobile-scrim').classList.remove('scrim-visible');
        render();
    });

    refreshState(true);
})();
