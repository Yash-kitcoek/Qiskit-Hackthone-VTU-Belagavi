const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const app = express();
const port = Number(process.env.PORT || 8000);
const dataFile = process.env.SMARTLOAD_DATA_FILE || path.join(__dirname, 'data', 'smartload-demo.json');

const cities = {
    Ahmedabad: [23.0225, 72.5714],
    Bengaluru: [12.9716, 77.5946],
    Chennai: [13.0827, 80.2707],
    Delhi: [28.6139, 77.209],
    Hyderabad: [17.385, 78.4867],
    Indore: [22.7196, 75.8577],
    Jaipur: [26.9124, 75.7873],
    Kolkata: [22.5726, 88.3639],
    Lucknow: [26.8467, 80.9462],
    Mumbai: [19.076, 72.8777],
    Nagpur: [21.1458, 79.0882],
    Nashik: [19.9975, 73.7898],
    Pune: [18.5204, 73.8567],
    Surat: [21.1702, 72.8311]
};
const vehicleTypes = ['van', 'rigid', 'flatbed', 'refrigerated'];
const handlingTypes = ['fragile', 'refrigerated', 'hazmat', 'liftgate'];
const bookingStatuses = ['confirmed', 'in_transit', 'delivered', 'cancelled'];

function hoursFromNow(hours) {
    return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
}

function vehicleTypeLabel(type) {
    return type === 'rigid' ? 'rigid truck' : type;
}

function seedData() {
    const pickupAt = hoursFromNow(3);
    const deadline = hoursFromNow(32);
    return {
        cargo: [
            {
                id: 'C-1048',
                reference: 'C-1048',
                pickup: 'Mumbai',
                destination: 'Pune',
                category: 'Industrial parts',
                weightKg: 5200,
                lengthM: 5.2,
                widthM: 2,
                heightM: 2,
                vehicleType: 'rigid',
                handling: [],
                pickupAt,
                deadline,
                status: 'available',
                createdAt: new Date().toISOString()
            },
            {
                id: 'C-1049',
                reference: 'C-1049',
                pickup: 'Ahmedabad',
                destination: 'Mumbai',
                category: 'Packaged food',
                weightKg: 2400,
                lengthM: 4,
                widthM: 1.8,
                heightM: 1.8,
                vehicleType: 'refrigerated',
                handling: ['refrigerated'],
                pickupAt: hoursFromNow(7),
                deadline: hoursFromNow(49),
                status: 'available',
                createdAt: new Date().toISOString()
            },
            {
                id: 'C-1050',
                reference: 'C-1050',
                pickup: 'Delhi',
                destination: 'Jaipur',
                category: 'Furniture',
                weightKg: 1300,
                lengthM: 3.5,
                widthM: 1.8,
                heightM: 2,
                vehicleType: 'van',
                handling: ['fragile'],
                pickupAt: hoursFromNow(12),
                deadline: hoursFromNow(60),
                status: 'available',
                createdAt: new Date().toISOString()
            }
        ],
        trucks: [
            {
                id: 'T-208',
                registration: 'MH 12 AB 4821',
                capacityKg: 8000,
                lengthM: 7,
                widthM: 2.4,
                heightM: 2.7,
                vehicleType: 'rigid',
                location: 'Mumbai',
                availability: 'available',
                operatingCostPerKm: 42,
                fuelEfficiencyKmPerL: 5.2,
                equipment: ['liftgate'],
                driverAvailable: true,
                compliant: true
            },
            {
                id: 'T-214',
                registration: 'GJ 01 CD 7314',
                capacityKg: 5000,
                lengthM: 6,
                widthM: 2.2,
                heightM: 2.4,
                vehicleType: 'refrigerated',
                location: 'Ahmedabad',
                availability: 'available',
                operatingCostPerKm: 51,
                fuelEfficiencyKmPerL: 4.6,
                equipment: ['refrigerated'],
                driverAvailable: true,
                compliant: true
            },
            {
                id: 'T-221',
                registration: 'RJ 14 EF 0923',
                capacityKg: 2500,
                lengthM: 4.2,
                widthM: 2,
                heightM: 2.1,
                vehicleType: 'van',
                location: 'Delhi',
                availability: 'available',
                operatingCostPerKm: 28,
                fuelEfficiencyKmPerL: 8.1,
                equipment: ['fragile'],
                driverAvailable: true,
                compliant: true
            },
            {
                id: 'T-229',
                registration: 'MH 04 GH 5501',
                capacityKg: 12000,
                lengthM: 9,
                widthM: 2.5,
                heightM: 3,
                vehicleType: 'flatbed',
                location: 'Pune',
                availability: 'maintenance',
                operatingCostPerKm: 58,
                fuelEfficiencyKmPerL: 3.9,
                equipment: [],
                driverAvailable: false,
                compliant: true
            }
        ],
        bookings: []
    };
}

function loadStore() {
    if (!fs.existsSync(dataFile)) return seedData();
    const parsed = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
    if (!parsed || !Array.isArray(parsed.cargo) || !Array.isArray(parsed.trucks) || !Array.isArray(parsed.bookings)) {
        throw new Error(`Invalid SmartLoad data file: ${dataFile}`);
    }
    return parsed;
}

let store = loadStore();

function persistStore() {
    fs.mkdirSync(path.dirname(dataFile), { recursive: true });
    const temporaryFile = `${dataFile}.${process.pid}.tmp`;
    fs.writeFileSync(temporaryFile, JSON.stringify(store, null, 2));
    fs.renameSync(temporaryFile, dataFile);
}

function fail(status, message, details) {
    const error = new Error(message);
    error.status = status;
    if (details) error.details = details;
    throw error;
}

function requiredString(value, label, maxLength = 100) {
    if (typeof value !== 'string' || !value.trim() || value.trim().length > maxLength) {
        fail(400, `${label} is required and must be ${maxLength} characters or fewer.`);
    }
    return value.trim();
}

function positiveNumber(value, label) {
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0) fail(400, `${label} must be a positive number.`);
    return number;
}

function validTime(value, label) {
    const time = new Date(value);
    if (!value || Number.isNaN(time.getTime())) fail(400, `${label} must be a valid date and time.`);
    return time.toISOString();
}

function cityExists(city) {
    return Object.prototype.hasOwnProperty.call(cities, city);
}

function validateCargo(body, current = {}) {
    const pickup = requiredString(body.pickup ?? current.pickup, 'Pickup city');
    const destination = requiredString(body.destination ?? current.destination, 'Destination city');
    if (!cityExists(pickup) || !cityExists(destination) || pickup === destination) {
        fail(400, 'Choose two different cities from the supported demo route list.');
    }
    const vehicleType = requiredString(body.vehicleType ?? current.vehicleType, 'Vehicle type');
    if (!vehicleTypes.includes(vehicleType)) fail(400, 'Choose a supported vehicle type.');
    const handling = body.handling ?? current.handling ?? [];
    if (!Array.isArray(handling) || handling.some(item => !handlingTypes.includes(item))) {
        fail(400, 'Handling requirements contain an unsupported value.');
    }
    const pickupAt = validTime(body.pickupAt ?? current.pickupAt, 'Pickup time');
    const deadline = validTime(body.deadline ?? current.deadline, 'Delivery deadline');
    if (new Date(deadline) <= new Date(pickupAt)) fail(400, 'Delivery deadline must be after pickup time.');
    if (new Date(pickupAt) < new Date(Date.now() - 60 * 60 * 1000)) fail(400, 'Pickup time cannot be in the past.');
    return {
        ...current,
        pickup,
        destination,
        category: requiredString(body.category ?? current.category, 'Cargo category'),
        weightKg: positiveNumber(body.weightKg ?? current.weightKg, 'Cargo weight'),
        lengthM: positiveNumber(body.lengthM ?? current.lengthM, 'Cargo length'),
        widthM: positiveNumber(body.widthM ?? current.widthM, 'Cargo width'),
        heightM: positiveNumber(body.heightM ?? current.heightM, 'Cargo height'),
        vehicleType,
        handling: [...new Set(handling)],
        pickupAt,
        deadline
    };
}

function validateTruck(body, current = {}) {
    const vehicleType = requiredString(body.vehicleType ?? current.vehicleType, 'Vehicle type');
    const availability = body.availability ?? current.availability ?? 'available';
    const equipment = body.equipment ?? current.equipment ?? [];
    if (!vehicleTypes.includes(vehicleType)) fail(400, 'Choose a supported vehicle type.');
    if (!['available', 'unavailable', 'maintenance'].includes(availability)) fail(400, 'Choose a supported availability status.');
    if (!Array.isArray(equipment) || equipment.some(item => !handlingTypes.includes(item))) fail(400, 'Equipment contains an unsupported value.');
    if (typeof (body.driverAvailable ?? current.driverAvailable ?? true) !== 'boolean') fail(400, 'Driver availability must be a boolean.');
    if (typeof (body.compliant ?? current.compliant ?? true) !== 'boolean') fail(400, 'Compliance status must be a boolean.');
    return {
        ...current,
        registration: requiredString(body.registration ?? current.registration, 'Registration', 30),
        capacityKg: positiveNumber(body.capacityKg ?? current.capacityKg, 'Capacity'),
        lengthM: positiveNumber(body.lengthM ?? current.lengthM, 'Truck length'),
        widthM: positiveNumber(body.widthM ?? current.widthM, 'Truck width'),
        heightM: positiveNumber(body.heightM ?? current.heightM, 'Truck height'),
        vehicleType,
        location: requiredString(body.location ?? current.location, 'Current city'),
        availability,
        operatingCostPerKm: positiveNumber(body.operatingCostPerKm ?? current.operatingCostPerKm, 'Operating cost per km'),
        fuelEfficiencyKmPerL: positiveNumber(body.fuelEfficiencyKmPerL ?? current.fuelEfficiencyKmPerL, 'Fuel efficiency'),
        equipment: [...new Set(equipment)],
        driverAvailable: body.driverAvailable ?? current.driverAvailable ?? true,
        compliant: body.compliant ?? current.compliant ?? true
    };
}

function distanceKm(from, to) {
    const [lat1, lon1] = cities[from].map(value => value * Math.PI / 180);
    const [lat2, lon2] = cities[to].map(value => value * Math.PI / 180);
    const latitudeDelta = lat2 - lat1;
    const longitudeDelta = lon2 - lon1;
    const a = Math.sin(latitudeDelta / 2) ** 2
        + Math.cos(lat1) * Math.cos(lat2) * Math.sin(longitudeDelta / 2) ** 2;
    return Math.round(6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) * 1.25);
}

function overlaps(startA, endA, startB, endB) {
    return new Date(startA) < new Date(endB) && new Date(startB) < new Date(endA);
}

function matchCargo(cargo) {
    const candidates = store.trucks.map(truck => {
        const reasons = [];
        if (truck.availability !== 'available') reasons.push(`Truck is ${truck.availability}.`);
        if (!truck.driverAvailable) reasons.push('No driver is available.');
        if (!truck.compliant) reasons.push('Compliance is not confirmed.');
        if (truck.capacityKg < cargo.weightKg) reasons.push(`Capacity is ${truck.capacityKg.toLocaleString()} kg; cargo needs ${cargo.weightKg.toLocaleString()} kg.`);
        if (truck.vehicleType !== cargo.vehicleType) reasons.push(`Requires a ${cargo.vehicleType} vehicle; this is a ${truck.vehicleType}.`);
        for (const dimension of ['lengthM', 'widthM', 'heightM']) {
            if (truck[dimension] < cargo[dimension]) reasons.push(`${dimension.replace('M', '')} clearance is insufficient.`);
        }
        const missingEquipment = cargo.handling.filter(item => !truck.equipment.includes(item));
        if (missingEquipment.length) reasons.push(`Missing handling equipment: ${missingEquipment.join(', ')}.`);
        const activeBookings = store.bookings.filter(booking =>
            booking.truckId === truck.id && ['confirmed', 'in_transit'].includes(booking.status)
            && overlaps(cargo.pickupAt, cargo.deadline, booking.pickupAt, booking.deadline)
        );
        if (activeBookings.length) reasons.push(`Truck is reserved for ${activeBookings[0].reference} during this window.`);

        const routeDistanceKm = cityExists(truck.location)
            ? distanceKm(truck.location, cargo.pickup) + distanceKm(cargo.pickup, cargo.destination)
            : null;
        if (routeDistanceKm === null) reasons.push('Truck location has no route estimate in the demo city list.');
        const etaHours = routeDistanceKm === null ? null : Math.round((routeDistanceKm / 45 + 1.5) * 10) / 10;
        const estimatedDelivery = etaHours === null
            ? null
            : new Date(Math.max(Date.now(), new Date(cargo.pickupAt).getTime()) + etaHours * 60 * 60 * 1000).toISOString();
        if (estimatedDelivery && new Date(estimatedDelivery) > new Date(cargo.deadline)) {
            reasons.push('Estimated arrival falls after the delivery deadline.');
        }
        const estimatedCost = routeDistanceKm === null
            ? null
            : Math.round(routeDistanceKm * truck.operatingCostPerKm);
        const utilizationPct = Math.round(cargo.weightKg / truck.capacityKg * 100);
        const checks = [
            { key: 'capacity', label: 'Weight capacity', passed: truck.capacityKg >= cargo.weightKg, detail: `${truck.capacityKg.toLocaleString()} kg available · ${cargo.weightKg.toLocaleString()} kg required` },
            { key: 'vehicle', label: 'Vehicle type', passed: truck.vehicleType === cargo.vehicleType, detail: `${vehicleTypeLabel(truck.vehicleType)} · requires ${vehicleTypeLabel(cargo.vehicleType)}` },
            { key: 'dimensions', label: 'Cargo dimensions', passed: ['lengthM', 'widthM', 'heightM'].every(dimension => truck[dimension] >= cargo[dimension]), detail: `${truck.lengthM} × ${truck.widthM} × ${truck.heightM} m internal` },
            { key: 'handling', label: 'Handling equipment', passed: missingEquipment.length === 0, detail: missingEquipment.length ? `Missing ${missingEquipment.join(', ')}` : 'All requirements supported' },
            { key: 'readiness', label: 'Truck readiness', passed: truck.availability === 'available' && truck.driverAvailable && truck.compliant && activeBookings.length === 0, detail: truck.availability !== 'available' ? `Truck ${truck.availability}` : !truck.driverAvailable ? 'Driver unavailable' : !truck.compliant ? 'Compliance not confirmed' : activeBookings.length ? 'Overlapping active reservation' : 'Truck, driver and compliance ready' },
            { key: 'route', label: 'Route estimate', passed: routeDistanceKm !== null, detail: routeDistanceKm === null ? 'No route estimate for truck location' : `${routeDistanceKm} km estimated from current location` },
            { key: 'deadline', label: 'Delivery window', passed: Boolean(estimatedDelivery && new Date(estimatedDelivery) <= new Date(cargo.deadline)), detail: estimatedDelivery ? `Estimated ${estimatedDelivery}` : 'ETA unavailable' }
        ];
        const delayRisk = estimatedDelivery
            ? (new Date(cargo.deadline) - new Date(estimatedDelivery) < 2 * 60 * 60 * 1000
                ? 'High'
                : new Date(cargo.deadline) - new Date(estimatedDelivery) < 8 * 60 * 60 * 1000
                    ? 'Medium'
                    : 'Low')
            : null;
        return {
            truckId: truck.id,
            registration: truck.registration,
            vehicleType: truck.vehicleType,
            feasible: reasons.length === 0,
            rejectionReasons: reasons,
            routeDistanceKm,
            estimatedCost,
            etaHours,
            estimatedDelivery,
            utilizationPct,
            delayRisk,
            checks,
            score: null,
            explanation: null
        };
    });
    const eligible = candidates.filter(candidate => candidate.feasible);
    const maxCost = Math.max(...eligible.map(candidate => candidate.estimatedCost), 1);
    for (const candidate of eligible) {
        const costPenalty = candidate.estimatedCost / maxCost * 35;
        const timePenalty = candidate.etaHours / Math.max(...eligible.map(item => item.etaHours), 1) * 25;
        const utilizationPenalty = Math.abs(candidate.utilizationPct - 75) / 100 * 15;
        candidate.score = Math.max(1, Math.round(100 - costPenalty - timePenalty - utilizationPenalty));
        candidate.explanation = `Meets every hard constraint; ${candidate.utilizationPct}% capacity use, estimated ${candidate.routeDistanceKm} km and ₹${candidate.estimatedCost.toLocaleString()} operating cost.`;
    }
    eligible.sort((left, right) => right.score - left.score || left.estimatedCost - right.estimatedCost);
    candidates.sort((left, right) => Number(right.feasible) - Number(left.feasible)
        || (right.score ?? 0) - (left.score ?? 0));
    return { candidates, alternatives: eligible.length ? [] : [
        'Add a compliant truck with the required vehicle type and handling equipment.',
        'Review the cargo dimensions, pickup window, or delivery deadline.',
        'Choose a pickup and destination from the supported demo cities.'
    ] };
}

app.use(express.json({ limit: '32kb' }));
app.use(express.urlencoded({ extended: true }));
app.use('/api', (req, res, next) => {
    if (['POST', 'PATCH'].includes(req.method)
        && (!req.body || typeof req.body !== 'object' || Array.isArray(req.body))) {
        return next(Object.assign(new Error('Request body must be a JSON object.'), { status: 400 }));
    }
    next();
});
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => res.render('dashboard'));

app.get('/posts', (req, res) => {
    const posts = [
        { username: 'apna college', title: 'My First Post', content: 'This is the content of my first post.' },
        { username: 'apna college', title: 'Internship Experience', content: 'Today my internship experience at my Meta internship is very good and I am learning new things in this internship.' },
        { username: 'apna college', title: 'Journey to the Interview', content: 'The journey to the interview was quite an experience.' }
    ];
    res.render('index.ejs', { posts });
});

app.get('/api/health', (req, res) => res.json({ status: 'ok', mode: 'demo' }));

app.get('/api/state', (req, res) => res.json({
    mode: 'demo',
    cargo: store.cargo,
    trucks: store.trucks,
    bookings: store.bookings,
    supportedCities: Object.keys(cities),
    vehicleTypes,
    handlingTypes
}));

app.post('/api/cargo', (req, res) => {
    const cargo = validateCargo(req.body);
    cargo.id = `C-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
    cargo.reference = cargo.id;
    cargo.status = 'available';
    cargo.createdAt = new Date().toISOString();
    store.cargo.unshift(cargo);
    persistStore();
    res.status(201).json(cargo);
});

app.patch('/api/cargo/:id', (req, res) => {
    const cargo = store.cargo.find(item => item.id === req.params.id);
    if (!cargo) fail(404, 'Cargo record not found.');
    if (cargo.status !== 'available') fail(409, 'Only unassigned cargo can be edited.');
    Object.assign(cargo, validateCargo(req.body, cargo));
    persistStore();
    res.json(cargo);
});

app.post('/api/cargo/:id/cancel', (req, res) => {
    const cargo = store.cargo.find(item => item.id === req.params.id);
    if (!cargo) fail(404, 'Cargo record not found.');
    if (cargo.status !== 'available') fail(409, 'Cancel the associated booking before cancelling assigned cargo.');
    cargo.status = 'cancelled';
    persistStore();
    res.json(cargo);
});

app.post('/api/trucks', (req, res) => {
    const truck = validateTruck(req.body);
    truck.id = `T-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
    store.trucks.unshift(truck);
    persistStore();
    res.status(201).json(truck);
});

app.patch('/api/trucks/:id', (req, res) => {
    const truck = store.trucks.find(item => item.id === req.params.id);
    if (!truck) fail(404, 'Truck record not found.');
    const activeBookings = store.bookings.some(booking =>
        booking.truckId === truck.id && ['confirmed', 'in_transit'].includes(booking.status)
    );
    const availability = req.body.availability ?? truck.availability;
    if (activeBookings && availability !== 'available') {
        fail(409, 'This truck has an active booking. Cancel or complete it before changing availability.');
    }
    Object.assign(truck, validateTruck(req.body, truck));
    persistStore();
    res.json(truck);
});

app.post('/api/matching', (req, res) => {
    const cargo = store.cargo.find(item => item.id === req.body.cargoId);
    if (!cargo) fail(404, 'Select an existing cargo record to run matching.');
    if (cargo.status !== 'available') fail(409, 'Only unassigned cargo can be matched.');
    res.json({ cargoId: cargo.id, ...matchCargo(cargo), mode: 'deterministic_demo_estimate' });
});

app.post('/api/bookings', (req, res) => {
    const cargo = store.cargo.find(item => item.id === req.body.cargoId);
    const truck = store.trucks.find(item => item.id === req.body.truckId);
    if (!cargo || !truck) fail(404, 'Cargo or truck record not found. Refresh and try again.');
    if (cargo.status !== 'available') fail(409, 'This cargo is no longer available. Refresh cargo and try again.');
    const match = matchCargo(cargo).candidates.find(candidate => candidate.truckId === truck.id);
    if (!match || !match.feasible) {
        fail(409, 'This truck is no longer feasible for the selected cargo. Refresh availability and run matching again.', match?.rejectionReasons);
    }
    const bookingId = `B-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
    const booking = {
        id: bookingId,
        reference: bookingId,
        cargoId: cargo.id,
        cargoReference: cargo.reference,
        truckId: truck.id,
        registration: truck.registration,
        pickup: cargo.pickup,
        destination: cargo.destination,
        pickupAt: cargo.pickupAt,
        deadline: cargo.deadline,
        status: 'confirmed',
        estimatedCost: match.estimatedCost,
        routeDistanceKm: match.routeDistanceKm,
        etaHours: match.etaHours,
        estimatedDelivery: match.estimatedDelivery,
        delayRisk: match.delayRisk,
        createdAt: new Date().toISOString()
    };
    store.bookings.unshift(booking);
    cargo.status = 'booked';
    persistStore();
    res.status(201).json(booking);
});

app.patch('/api/bookings/:id/status', (req, res) => {
    const booking = store.bookings.find(item => item.id === req.params.id);
    if (!booking) fail(404, 'Booking record not found.');
    const nextStatus = req.body.status;
    if (!bookingStatuses.includes(nextStatus)) fail(400, 'Choose a supported shipment status.');
    const allowedTransitions = {
        confirmed: ['in_transit', 'cancelled'],
        in_transit: ['delivered', 'cancelled'],
        delivered: [],
        cancelled: []
    };
    if (!allowedTransitions[booking.status].includes(nextStatus)) {
        fail(409, `A ${booking.status} booking cannot be changed to ${nextStatus}.`);
    }
    booking.status = nextStatus;
    booking.updatedAt = new Date().toISOString();
    const cargo = store.cargo.find(item => item.id === booking.cargoId);
    if (cargo) cargo.status = nextStatus === 'cancelled' ? 'available' : nextStatus;
    persistStore();
    res.json(booking);
});

app.use((req, res) => res.status(404).json({ error: 'Endpoint not found.' }));
app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    const status = error.status || (error.type === 'entity.parse.failed' ? 400 : 500);
    if (status === 500) console.error(error);
    res.status(status).json({
        error: status === 500 ? 'The server could not complete the request.' : error.message,
        ...(error.details ? { details: error.details } : {})
    });
});

if (require.main === module) {
    app.listen(port, () => console.log(`SmartLoad AI demo is running at http://localhost:${port}`));
}

module.exports = app;
