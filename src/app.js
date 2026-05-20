var express = require('express');
var config = require('./config');
var transformer = require('./openmrsToFhir');
var fhirMdmService = require('./fhirMdmService');

function shouldRequireBasicAuth() {
  return !!(config.mediatorAuth.username || config.mediatorAuth.password);
}

function unauthorized(res) {
  res.set('WWW-Authenticate', 'Basic realm="FHIR Mediator"');
  res.status(401).json({
    error: 'Unauthorized'
  });
}

function parseBasicAuthHeader(headerValue) {
  var encodedCredentials;
  var decodedCredentials;
  var separatorIndex;

  if (!headerValue || headerValue.indexOf('Basic ') !== 0) {
    return null;
  }

  encodedCredentials = headerValue.slice(6);
  decodedCredentials = Buffer.from(encodedCredentials, 'base64').toString('utf8');
  separatorIndex = decodedCredentials.indexOf(':');

  if (separatorIndex === -1) {
    return null;
  }

  return {
    username: decodedCredentials.slice(0, separatorIndex),
    password: decodedCredentials.slice(separatorIndex + 1)
  };
}

function requireBasicAuth(req, res, next) {
  var credentials;

  if (!shouldRequireBasicAuth()) {
    next();
    return;
  }

  credentials = parseBasicAuthHeader(req.headers.authorization);
  if (
    !credentials ||
    credentials.username !== config.mediatorAuth.username ||
    credentials.password !== config.mediatorAuth.password
  ) {
    unauthorized(res);
    return;
  }

  next();
}

function createErrorPayload(error) {
  var payload = {
    error: error.message || 'Unexpected error'
  };

  if (error.response && error.response.data) {
    payload.details = error.response.data;
  }

  return payload;
}

function toResponseStatus(error) {
  if (error.response && error.response.status) {
    return error.response.status;
  }

  if (String(error.message || '').indexOf('Golden patient link was not available') !== -1) {
    return 504;
  }

  return 500;
}

function buildMediatorResponse(result) {
  return {
    resourceType: 'Patient',
    id: result.sourcePatientId,
    identifier: [
      {
        system: config.fhir.cruidSystem,
        value: result.cruid
      }
    ]
  };
}

var app = express();

app.use(express.json({ limit: '1mb' }));

app.get('/health', function (req, res) {
  res.json({
    status: 'ok'
  });
});

/**
 * POST create: OpenMRS-shaped JSON or FHIR Patient (toFhirPatient passes through resourceType Patient).
 */
async function handlePostPatientCreate(req, res) {
  var fhirPatient;
  var result;

  try {
    if (!req.body || Object.keys(req.body).length === 0) {
      res.status(400).json({
        error: 'Request body is required.'
      });
      return;
    }

    fhirPatient = transformer.toFhirPatient(req.body, {
      openmrsIdSystem: config.openmrs.idSystem
    });

    result = await fhirMdmService.createPatientAndResolveGoldenRecord(fhirPatient, config);

    res.status(201).json(buildMediatorResponse(result));
  } catch (error) {
    res.status(toResponseStatus(error)).json(createErrorPayload(error));
  }
}

app.post('/patients', requireBasicAuth, handlePostPatientCreate);

if (config.mediatorPathPrefix) {
  app.post(
    '/' + config.mediatorPathPrefix + '/patient-create',
    requireBasicAuth,
    handlePostPatientCreate
  );
}

/**
 * FHIR-style update with explicit logical id (path param or body when using OpenHIM fixed route path).
 */
async function handlePutPatientById(req, res, patientId) {
  var fhirPatient;
  var result;
  var id = String(patientId || '').trim();

  try {
    if (!id) {
      res.status(400).json({
        error: 'Patient id is required (URL path or Patient.id in body for PUT /patients).'
      });
      return;
    }

    if (!req.body || Object.keys(req.body).length === 0) {
      res.status(400).json({
        error: 'Request body is required.'
      });
      return;
    }

    if (req.body.resourceType !== 'Patient') {
      res.status(400).json({
        error: 'Request body must be a FHIR Patient resource (resourceType Patient).'
      });
      return;
    }

    fhirPatient = JSON.parse(JSON.stringify(req.body));
    fhirPatient.id = id;

    result = await fhirMdmService.updatePatientAndResolveGoldenRecord(id, fhirPatient, config);

    res.status(200).json(buildMediatorResponse(result));
  } catch (error) {
    res.status(toResponseStatus(error)).json(createErrorPayload(error));
  }
}

/**
 * PUT Patient/{id} — normal FHIR-style URL.
 * Also /{mediatorPathPrefix}/Patient/:id when MEDIATOR_PATH_PREFIX is set (e.g. openmrs-fhir-mdm).
 */
function handlePutPatient(req, res) {
  return handlePutPatientById(req, res, req.params.patientId);
}

app.put('/Patient/:patientId', requireBasicAuth, handlePutPatient);

if (config.mediatorPathPrefix) {
  app.put('/' + config.mediatorPathPrefix + '/Patient/:patientId', requireBasicAuth, handlePutPatient);
}

/**
 * PUT /patients — OpenHIM forwards here when the channel route "Path" is fixed to /patients
 * (OpenHIM core ignores the incoming path in that case). Logical id must be on Patient.id in JSON.
 */
function handlePutPatientOpenhimFixedPatientsPath(req, res) {
  var fromBody = req.body && req.body.id;
  var id = fromBody != null && fromBody !== '' ? String(fromBody).trim() : '';
  return handlePutPatientById(req, res, id);
}

app.put('/patients', requireBasicAuth, handlePutPatientOpenhimFixedPatientsPath);

module.exports = app;
