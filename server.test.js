const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { after, before, test } = require('node:test');

const testDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'smartload-demo-'));
const dataFile = path.join(testDirectory, 'workspace.json');
process.env.SMARTLOAD_DATA_FILE = dataFile;
const app = require('./index');
let server;
let baseUrl;

before(async () => {
    server = app.listen(0);
    await new Promise(resolve => server.once('listening', resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
    if (server) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    fs.rmSync(testDirectory, { recursive: true, force: true });
    delete process.env.SMARTLOAD_DATA_FILE;
});

async function request(pathname, options) {
    const response = await fetch(`${baseUrl}${pathname}`, options);
    return { response, body: await response.json() };
}

function post(body) {
    return { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) };
}

function future(hours) {
    return new Date(Date.now() + hours * 3600000).toISOString();
}

function cargoPayload(overrides = {}) {
    return {
        pickup: 'Mumbai',
        destination: 'Pune',
        category: 'Test components',
        weightKg: 4000,
        lengthM: 4,
        widthM: 2,
        heightM: 2,
        vehicleType: 'rigid',
        handling: [],
        pickupAt: future(6),
        deadline: future(30),
        ...overrides
    };
}

test('serves the dashboard and seeds an explicitly demo-mode workspace', async () => {
    const page = await fetch(`${baseUrl}/`);
    const state = await request('/api/state');
    assert.equal(page.status, 200);
    assert.match(await page.text(), /SmartLoad AI/);
    assert.equal(state.body.mode, 'demo');
    assert.ok(state.body.cargo.length > 0);
    assert.ok(state.body.trucks.length > 0);
});

test('validates cargo fields and rejects unsupported routes', async () => {
    const badWeight = await request('/api/cargo', post(cargoPayload({ weightKg: 0 })));
    const badRoute = await request('/api/cargo', post(cargoPayload({ pickup: 'Unknown City' })));
    const badBody = await request('/api/cargo', post(null));
    assert.equal(badWeight.response.status, 400);
    assert.match(badWeight.body.error, /positive number/);
    assert.equal(badRoute.response.status, 400);
    assert.equal(badBody.response.status, 400);
});

test('matching rejects overweight and incompatible trucks before scoring', async () => {
    const heavy = await request('/api/cargo', post(cargoPayload({ weightKg: 10000 })));
    assert.equal(heavy.response.status, 201);
    const match = await request('/api/matching', post({ cargoId: heavy.body.id }));
    assert.equal(match.response.status, 200);
    assert.ok(match.body.candidates.every(candidate => !candidate.feasible));
    const rigidTruck = match.body.candidates.find(candidate => candidate.truckId === 'T-208');
    const reeferTruck = match.body.candidates.find(candidate => candidate.truckId === 'T-214');
    assert.match(rigidTruck.rejectionReasons.join(' '), /Capacity/);
    assert.match(reeferTruck.rejectionReasons.join(' '), /vehicle/);
    assert.equal(rigidTruck.score, null);
});

test('ranks only feasible trucks and prevents overlapping double bookings', async () => {
    const firstMatch = await request('/api/matching', post({ cargoId: 'C-1048' }));
    assert.ok(firstMatch.body.candidates.some(candidate => candidate.feasible));
    assert.ok(firstMatch.body.candidates.filter(candidate => candidate.feasible).every(candidate => candidate.score > 0));
    const booking = await request('/api/bookings', post({ cargoId: 'C-1048', truckId: 'T-208' }));
    assert.equal(booking.response.status, 201);
    assert.equal(booking.body.id, booking.body.reference);

    const competingCargo = await request('/api/cargo', post(cargoPayload({
        weightKg: 3500,
        pickupAt: future(8),
        deadline: future(20)
    })));
    const competingMatch = await request('/api/matching', post({ cargoId: competingCargo.body.id }));
    const reserved = competingMatch.body.candidates.find(candidate => candidate.truckId === 'T-208');
    assert.equal(reserved.feasible, false);
    assert.match(reserved.rejectionReasons.join(' '), /reserved/);

    const conflict = await request('/api/bookings', post({ cargoId: competingCargo.body.id, truckId: 'T-208' }));
    assert.equal(conflict.response.status, 409);
    const duplicateCargo = await request('/api/bookings', post({ cargoId: 'C-1048', truckId: 'T-208' }));
    assert.equal(duplicateCargo.response.status, 409);
    const persisted = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
    assert.equal(persisted.cargo.find(item => item.id === 'C-1048').status, 'booked');
    assert.equal(persisted.bookings.length, 1);
});

test('shipment status transitions are validated and persisted', async () => {
    const state = await request('/api/state');
    const booking = state.body.bookings[0];
    const invalid = await request(`/api/bookings/${booking.id}/status`, {
        method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status: 'delivered' })
    });
    assert.equal(invalid.response.status, 409);
    const transit = await request(`/api/bookings/${booking.id}/status`, {
        method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status: 'in_transit' })
    });
    assert.equal(transit.response.status, 200);
    assert.equal(transit.body.status, 'in_transit');
});
