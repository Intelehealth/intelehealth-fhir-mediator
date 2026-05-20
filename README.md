# OpenMRS -> OpenHIM -> FHIR MDM Mediator

This project is a small Node.js mediator for the flow you described:

1. OpenMRS sends a patient-create request to OpenHIM.
2. OpenHIM routes the request to this mediator.
3. The mediator transforms the OpenMRS payload into a FHIR `Patient`.
4. The mediator creates the patient on the FHIR server.
5. The mediator queries HAPI FHIR MDM using `/$mdm-query-links`.
6. The mediator fetches the linked golden patient.
7. The mediator returns the enterprise CR identifier to the caller.

## Runtime

This project targets Node.js `22.x`.

## Ideal mapping

For an MPI/MDM design, the ideal pattern is:

- Keep the OpenMRS patient UUID as a source identifier on the created source `Patient`.
- Let the FHIR MDM server manage source-to-golden linkage.
- Treat `goldenResourceId` such as `Patient/123` as an internal linkage reference only.
- Return the business CR identifier from the golden patient, for example `urn:intelehealth:cruid`.

That means the mediator should not map OpenMRS directly to the golden resource id. It should:

1. create the source patient,
2. resolve the golden patient link,
3. fetch the golden patient,
4. extract the CR identifier,
5. return that identifier to OpenMRS.

## Response produced by this mediator

```json
{
  "resourceType": "Patient",
  "id": "9001",
  "identifier": [
    {
      "system": "urn:intelehealth:cruid",
      "value": "CR-0000123"
    }
  ]
}
```

## Supported input

The mediator accepts either:

- a FHIR `Patient` resource directly, or
- a simplified OpenMRS-style payload, for example:

```json
{
  "patient": {
    "uuid": "5e4b57c2-7f0b-4d63-a8bb-0c8b534d6546",
    "identifiers": [
      {
        "identifier": "10001A",
        "preferred": true,
        "identifierType": {
          "name": "National ID"
        }
      }
    ],
    "person": {
      "gender": "M",
      "birthdate": "1992-05-10",
      "preferredName": {
        "givenName": "Rahim",
        "familyName": "Uddin"
      }
    }
  }
}
```

## Configuration

Copy `.env.example` to `.env` and update the values:

```sh
cp .env.example .env
```

Important variables:

- `FHIR_BASE_URL`: base URL of your FHIR server
- `FHIR_MDM_QUERY_PATH`: normally `/$mdm-query-links`
- `FHIR_CRUID_SYSTEM`: identifier system stored on the golden patient
- `OPENMRS_ID_SYSTEM`: identifier system used for the OpenMRS source UUID
- `MEDIATOR_BASIC_AUTH_USERNAME` and `MEDIATOR_BASIC_AUTH_PASSWORD`: optional credentials required by `POST /patients`
- `MEDIATOR_PATH_PREFIX`: segment before `PUT /Patient/:id` when clients use a path prefix (default `openmrs-fhir-mdm`, so both `PUT /Patient/:id` and `PUT /openmrs-fhir-mdm/Patient/:id` work). Set to empty to disable the prefixed route.
- `OPENHIM_REGISTER`: set to `true` if you want automatic mediator registration

## Run

```sh
nvm use
npm install
npm start
```

The service exposes:

- `GET /health`
- `POST /patients` — create (OpenMRS-style or FHIR `Patient` body)
- `PUT /Patient/:id` — update an existing patient on the FHIR server (FHIR `Patient` body); resolves MDM golden link and returns the same CR UID shape as create
- `PUT /{MEDIATOR_PATH_PREFIX}/Patient/:id` — same handler when the gateway uses a path prefix (default prefix `openmrs-fhir-mdm`, matching URLs such as `http://host:6001/openmrs-fhir-mdm/Patient/1001`)

If `MEDIATOR_BASIC_AUTH_USERNAME` and `MEDIATOR_BASIC_AUTH_PASSWORD` are set, `POST /patients` and `PUT /Patient/:id` require HTTP Basic Auth while `GET /health` remains open.

OpenHIM can use **one channel** for both create and update: set `methods` to `POST` and `PUT`, and use a combined `urlPattern` (see `mediatorConfig.json`), for example `^(/patients$|/Patient/[^/]+$|/openmrs-fhir-mdm/Patient/[^/]+$)$`. Add another alternation if your create URL is not `/patients` (for example `/patient-create`). If you use a different path prefix than `openmrs-fhir-mdm`, set `MEDIATOR_PATH_PREFIX` and extend the pattern to match.

## Example request

```sh
curl -X POST http://localhost:3000/patients \
  -u mpower:Admin123 \
  -H "Content-Type: application/json" \
  -d '{
    "patient": {
      "uuid": "5e4b57c2-7f0b-4d63-a8bb-0c8b534d6546",
      "person": {
        "gender": "M",
        "birthdate": "1992-05-10",
        "preferredName": {
          "givenName": "Rahim",
          "familyName": "Uddin"
        }
      }
    }
  }'
```

## OpenHIM route settings

If you enable mediator basic auth, configure the OpenHIM route to this mediator as follows:

- `Route Secured`: `Yes`
- `Basic Authentication Username`: `mpower`
- `Basic Authentication Password`: `Admin123`
- `Forward existing Authorization header`: `No`

## Notes for production

- HAPI MDM linkage may not be available instantly after patient creation, so this mediator polls for a short configurable window.
- If your FHIR server expects `resourceId=Patient/<id>` instead of just `<id>` for `/$mdm-query-links`, set `FHIR_MDM_RESOURCE_ID_MODE=reference`.
- HAPI often creates new links as `POSSIBLE_MATCH` before they become `MATCH`. If `/$mdm-query-links?matchResult=MATCH` returns no links, set `FHIR_MDM_MATCH_RESULT=MATCH,POSSIBLE_MATCH` (or `POSSIBLE_MATCH` only).
- If MDM processing is slow or asynchronous in your environment, the more robust pattern is event-based orchestration instead of a strictly synchronous request/response.
