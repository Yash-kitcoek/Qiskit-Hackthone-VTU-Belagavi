# AI and optimization integration

## Repository findings

There is no trained delay, ETA, or suitability model, training dataset, model artifact, inference package, quantum solver, or quantum simulator in this repository. The current truck matching engine is deterministic rule-based matching; it is not a trained model. Therefore, the API and dashboard do not invent prediction values or quantum comparison scores.

## Delay-model adapter contract

Configure `LOADSETU_DELAY_MODEL_URL` to enable calls to a separately deployed, trained model service. Optional service authentication uses `LOADSETU_DELAY_MODEL_API_KEY`. The adapter accepts only loads with material, positive weight, pickup, destination, and a valid pickup date. It sends JSON with schema version `loadsetu.delay-prediction.request.v1`:

```json
{
  "schemaVersion": "loadsetu.delay-prediction.request.v1",
  "requests": [{
    "loadId": "database-load-id",
    "features": {
      "material": "steel",
      "pickup": "Pune",
      "destination": "Nashik",
      "weightTonnes": 8,
      "pickupAt": "2026-10-21T12:00:00.000Z"
    }
  }]
}
```

The service must return schema version `loadsetu.delay-prediction.response.v1`, a nonempty model name/version, an ISO `generatedAt`, and exactly one prediction for every requested load. A prediction may contain a valid ISO `eta`, a `delayRiskProbability` in `[0, 1]`, or both. The adapter rejects malformed, incomplete, or stale responses and times out after the configured limit. No predictions are exposed for unsupported inputs or service errors. Model quality has not been evaluated because no held-out dataset or trained model is present.

## Classical fleet assignment

`GET /api/loads/optimization` runs an exact branch-and-bound assignment baseline against the authenticated factory's open loads, registered available trucks, and active bookings. It first applies the deterministic mandatory matching constraints, then maximizes the number of assigned loads and minimizes quoted transport cost (using a factory-offer estimate only when no transporter quote exists). The objective does not include late-delivery penalties: current load data and routing services do not supply a verified delivery deadline/ETA pair. Active bookings conservatively reserve their trucks because booking time windows are not represented consistently. The exact search accepts at most 12 loads and has a 500 ms runtime limit; timeout is reported.

The endpoint identifies its source as live database data. Results are suggestions, not reservations; booking endpoints must still validate availability at confirmation.

## Quantum comparison

No quantum or quantum-inspired implementation exists in the repository or declared dependencies. The UI/API explicitly report that comparison as unavailable. There is no quantum output, speedup, or performance claim.
